"use strict";
// Context: {project, clip: {start, offset}, overlay, paths, observe(refresh)}.
// Each path is {id, kind: "mask" | "shape", name, host}; host.data is a
// P3.1 path item, host.commit(next) records one atomic snapshot, and
// host.seek(projectFrame) moves the playhead. observe returns an unsubscribe.
// Call bind after context identity changes, and refresh after host data changes.
// Rows and selections contain logical frames only, never native property objects.
const animation = require("./path-animation.js");
const copy = (value) => JSON.parse(JSON.stringify(value));
function offset(clip) {
  const start = clip?.start ?? 0, trim = clip?.offset ?? 0;
  if (!Number.isFinite(start) || !Number.isFinite(trim)) throw Error("Invalid clip time");
  return start - trim;
}
function projectFrame(frame, clip) { return frame + offset(clip); }
function localFrame(frame, clip) { return frame - offset(clip); }
function available(entry) {
  try { return animation.frames(entry.host.data); } catch (_error) { return []; }
}
function create(initial, onRefresh = () => {}) {
  let context = null, identity = null, unsubscribe = null, generation = 0, committing = false;
  const selection = new Map();
  function paths() { return context?.paths || []; }
  function path(id) { return paths().find((entry) => entry.id === id); }
  function detach() {
    generation++;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  }
  function refresh() {
    if (!context) return;
    for (const [id, selected] of selection) {
      const entry = path(id);
      if (!entry) { selection.delete(id); continue; }
      const frames = new Set(available(entry));
      for (const frame of selected) if (!frames.has(frame)) selected.delete(frame);
    }
    onRefresh();
  }
  function bind(next) {
    detach();
    const previous = identity;
    context = next || null;
    identity = next ? [next.project, next.clip, next.overlay] : null;
    if (!identity || !previous || identity.some((value, i) => value !== previous[i])) selection.clear();
    if (context?.observe) {
      const token = generation;
      const stop = context.observe(() => { if (token === generation && !committing) refresh(); });
      if (typeof stop !== "function") throw Error("Observer must return a detach function");
      unsubscribe = stop;
    }
    refresh();
  }
  function rows() {
    if (!context) return [];
    const groups = [];
    for (const entry of paths()) {
      const label = entry.kind === "mask" ? "Masks" : "Shape+";
      let group = groups.find((row) => row.label === label);
      if (!group) { group = { label, children: [] }; groups.push(group); }
      const selected = selection.get(entry.id) || new Set();
      const diamonds = available(entry).map((frame) => ({
        localFrame: frame, frame: projectFrame(frame, context.clip), selected: selected.has(frame),
      }));
      group.children.push({ id: entry.id, label: entry.name, children: [{
        id: entry.id, label: entry.kind === "mask" ? "Mask Path" : "Path", diamonds,
      }] });
    }
    return groups;
  }
  function selectedFrames(entry, frames) {
    if (!Array.isArray(frames) || frames.some((frame) => !Number.isFinite(frame))) throw Error("Invalid timeline frames");
    const keys = new Set(available(entry));
    return [...new Set(frames.map((frame) => localFrame(frame, context.clip)))].filter((frame) => keys.has(frame));
  }
  function select(id, frames) {
    const entry = path(id);
    if (!entry) return false;
    selection.set(id, new Set(selectedFrames(entry, frames)));
    onRefresh();
    return true;
  }
  function seek(id, frame) {
    const entry = path(id);
    if (!entry || !selectedFrames(entry, [frame]).length) return false;
    entry.host.seek(frame);
    return true;
  }
  function change(id, frames, delta, remove) {
    const entry = path(id);
    if (!entry || entry.locked || entry.host.data.locked) return false;
    if (!remove && !Number.isFinite(delta)) throw Error("Invalid timeline delta");
    const targets = new Set(selectedFrames(entry, frames));
    if (!targets.size || (!remove && delta === 0)) return false;
    const list = animation.channels(entry.host.data);
    for (const channel of list) {
      const moved = channel.keyframes.filter((key) => targets.has(key.frame));
      if (remove && moved.length === channel.keyframes.length) return false;
      if (!remove && moved.some((key) => channel.keyframes.some((other) =>
        !targets.has(other.frame) && other.frame === key.frame + delta))) return false;
    }
    for (const channel of list) {
      if (remove) channel.keyframes = channel.keyframes.filter((key) => !targets.has(key.frame));
      else channel.keyframes.forEach((key) => { if (targets.has(key.frame)) key.frame += delta; });
      channel.keyframes.sort((a, b) => a.frame - b.frame);
    }
    const next = copy(entry.host.data), property = next.properties.path;
    property.objects = list;
    delete property.animated;
    delete property.keyframes;
    committing = true;
    try { entry.host.commit(next); } finally { committing = false; }
    const old = selection.get(id);
    if (old) {
      const updated = new Set();
      for (const frame of old) {
        if (!targets.has(frame)) updated.add(frame);
        else if (!remove) updated.add(frame + delta);
      }
      selection.set(id, updated);
    }
    refresh();
    return true;
  }
  function dispose() { detach(); context = null; identity = null; selection.clear(); }
  bind(initial);
  return { bind, refresh, rows, select, seek, move: (id, frames, delta) => change(id, frames, delta, false),
    remove: (id, frames) => change(id, frames, 0, true), dispose };
}
module.exports = { create, projectFrame, localFrame };
