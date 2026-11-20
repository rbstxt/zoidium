"use strict";
// Transfer contract: the caller evaluates a six-number affine matrix
// [a,b,c,d,tx,ty] at the paste playhead. It maps source layer coordinates
// to destination layer coordinates. The caller must reject perspective before
// supplying the matrix. Hosts expose P1.6 snapshot methods. For a Shape+
// destination, createPainted(group) inserts the supplied group with its default fill;
// its host snapshot must cover the entire contents tree changed by the callback.
// A history object follows P1.6's operation/command interface. The caller
// supplies an ID generator unique within both affected contents trees.
const animation = require("./path-animation.js");
const { createMask } = require("./mask-model.js");
const metadata = require("./mask-metadata.js");
const VERSION = 1;
const clone = value => JSON.parse(JSON.stringify(value));
const modes = ["corner", "smooth", "symmetric", "independent"];
function validId(id) { return typeof id === "string" && id.length > 0 && id.length <= 128; }
function validate(envelope) {
  if (!envelope || envelope.type !== "zoidium-path" || envelope.version !== VERSION)
    throw Error("Unsupported path clipboard version or envelope");
  const p = envelope.path;
  if (!p || !validId(p.id) || !Array.isArray(p.vertexIds) || !p.vertexIds.length || p.vertexIds.length > 256 ||
      !p.vertexIds.every(validId) || new Set(p.vertexIds).size !== p.vertexIds.length ||
      !p.vertexModes || typeof p.vertexModes !== "object" || Array.isArray(p.vertexModes) ||
      Object.entries(p.vertexModes).some(([id, mode]) => !p.vertexIds.includes(id) || !modes.includes(mode)) ||
      ![0, 1, false, true].includes(p.closed)) throw Error("Invalid clipboard path topology");
  if (!Array.isArray(p.channels) || p.channels.length !== p.vertexIds.length * 6)
    throw Error("Invalid clipboard path channels");
  for (const channel of p.channels) {
    if (!channel || channel.expression) throw Error("Expression-driven paths cannot be transferred");
    if (!Array.isArray(channel.keyframes) || !channel.keyframes.length) throw Error("Invalid path keyframes");
    const frames = new Set();
    for (const key of channel.keyframes) {
      if (!key || !Number.isFinite(key.frame) || !Number.isFinite(key.value) || frames.has(key.frame))
        throw Error("Invalid path keyframes");
      frames.add(key.frame);
    }
  }
  return clone(envelope);
}
function copyPath(item) {
  const channels = animation.channels(item);
  return validate({ type: "zoidium-path", version: VERSION, path: {
    id: item.id, vertexIds: clone(item.vertexIds), vertexModes: clone(item.vertexModes || {}),
    closed: item.properties.closed, channels,
  } });
}
function matrixValues(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 6 || !matrix.every(Number.isFinite))
    throw Error("Path transfer requires a finite affine mapping");
  const [a, b, c, d] = matrix;
  if (!Number.isFinite(a * d - b * c) || a * d - b * c === 0)
    throw Error("Path transfer requires an invertible affine mapping");
  return matrix;
}
function keyShape(channel) {
  const result = clone(channel);
  for (const key of result.keyframes) delete key.value;
  return JSON.stringify(result);
}
function mint(nextId, taken) {
  for (let i = 0; i < 1024; i++) {
    const id = nextId();
    if (validId(id) && !taken.has(id)) { taken.add(id); return id; }
  }
  throw Error("Could not create a fresh path ID");
}
function transformPair(x, y, m, translate, adapter) {
  const [a, b, c, d, tx, ty] = m;
  adapter?.validatePair?.([x, y], m);
  // Mixing channels with distinct key metadata can change interpolation.
  // A native adapter may synchronize and certify the pair before transfer.
  let pair = [x, y];
  if ((c !== 0 || b !== 0) && keyShape(x) !== keyShape(y)) {
    if (typeof adapter?.preparePair !== "function")
      throw Error("Cannot preserve animation across this affine mapping");
    pair = adapter.preparePair(clone(pair), m.slice());
    if (!Array.isArray(pair) || pair.length !== 2 || keyShape(pair[0]) !== keyShape(pair[1]) ||
        adapter.certifyPair?.(clone([x, y]), clone(pair), m.slice()) !== true)
      throw Error("Cannot preserve animation across this affine mapping");
  }
  const [px, py] = pair;
  const out = clone(pair);
  if (c !== 0 || b !== 0) {
    out[0].keyframes.forEach((key, i) => { key.value = a * px.keyframes[i].value + c * py.keyframes[i].value + (translate ? tx : 0); });
    out[1].keyframes.forEach((key, i) => { key.value = b * px.keyframes[i].value + d * py.keyframes[i].value + (translate ? ty : 0); });
  } else {
    out[0].keyframes.forEach(key => { key.value = a * key.value + (translate ? tx : 0); });
    out[1].keyframes.forEach(key => { key.value = d * key.value + (translate ? ty : 0); });
  }
  if (out.some(channel => channel.keyframes.some(key => !Number.isFinite(key.value))))
    throw Error("Affine mapping produced invalid path values");
  return out;
}
function grouped(channels) {
  if (!channels.every(channel => keyShape(channel) === keyShape(channels[0]))) return null;
  const first = channels[0];
  return { animated: !!first.animated, keyframes: first.keyframes.map((key, i) => ({
    ...clone(key), value: channels.map(channel => channel.keyframes[i].value),
  })) };
}
function materialize(envelope, matrix, nextId, existingIds = [], adapter) {
  const p = validate(envelope).path, m = matrixValues(matrix);
  if (typeof nextId !== "function") throw Error("Path transfer needs an ID generator");
  const taken = new Set([...existingIds, p.id, ...p.vertexIds]);
  const id = mint(nextId, taken), vertexIds = p.vertexIds.map(() => mint(nextId, taken));
  const vertexModes = {};
  p.vertexIds.forEach((old, i) => { if (p.vertexModes[old]) vertexModes[vertexIds[i]] = p.vertexModes[old]; });
  const list = [];
  for (let i = 0; i < p.channels.length; i += 2)
    list.push(...transformPair(p.channels[i], p.channels[i + 1], m, i % 6 === 0, adapter));
  const path = adapter?.encodePath?.(list) || grouped(list) || { objects: list };
  return { id, kind: "path", vertexIds, vertexModes, properties: { name: "Path", enabled: 1, closed: Number(p.closed), path } };
}
function restore(payload) {
  const current = payload.hosts.map(host => host.readSnapshot());
  payload.hosts.forEach((host, i) => host.restoreSnapshot(payload.snapshots[i]));
  payload.history.pushCommand(restore, { ...payload, snapshots: current });
}
function idsIn(items) {
  return items.flatMap(item => [item.id, ...(item.vertexIds || []), ...idsIn(item.contents || [])]);
}
function execute({ envelope, source = null, pathId = null, destination, matrix, nextId, history, createPainted, adapter }) {
  if (!destination || !["mask", "shape"].includes(destination.kind) || !history || history.operation != null)
    throw Error("Path transfer needs a destination and a free history");
  if (source && (source === destination || source.kind === destination.kind))
    throw Error("Conversion needs different source and destination hosts");
  if (source && source.isLocked(pathId)) throw Error("The source path is locked");
  const hosts = source ? [destination, source] : [destination];
  const snapshots = hosts.map(host => host.readSnapshot());
  const existing = snapshots.flatMap(idsIn);
  const item = materialize(envelope, matrix, nextId, existing, adapter);
  if (destination.kind === "mask") {
    if (!destination.separateChannels && !item.properties.path.keyframes)
      throw Error("Cannot preserve separate channel keys in a mask");
    Object.assign(item, { ...createMask(item.id, "Path", [0, 0]), ...item, mode: "add", feather: 0, opacity: 1, invert: 0,
      locked: false, expansion: 0, outlineColor: metadata.nextOutlineColor(snapshots[0]) });
  } else if (typeof createPainted !== "function") throw Error("Shape+ transfer needs a painted group factory");
  history.startOperation();
  try {
    if (destination.kind === "mask") destination.writeSnapshot([...snapshots[0], item]);
    else {
      const taken = new Set([...existing, item.id, ...item.vertexIds]);
      const group = { id: mint(nextId, taken), kind: "group", properties: {},
        contents: [item, { id: mint(nextId, taken), kind: "fill", properties: {} }] };
      createPainted(group);
    }
    if (source) source.deletePath(pathId);
    history.pushCommand(restore, { hosts, snapshots, history });
    history.finishOperation();
    return item.id;
  } catch (error) {
    try { hosts.forEach((host, i) => host.restoreSnapshot(snapshots[i])); }
    finally { history.discardOperation(); }
    throw error;
  }
}
function paste(options) { return execute(options); }
function convert(options) {
  const item = options.source?.findPath?.(options.pathId) ||
    options.source?.readSnapshot().find(entry => entry.id === options.pathId);
  if (!item) throw Error("Unknown source path");
  return execute({ ...options, envelope: copyPath(item) });
}

function editorTransfer({ editor, viewport, sessionFor, nextId, notify, openMenu }) {
  const { createGesture } = require("./editor-history.js");
  const { replaceContents, writePathRecords } = require("./editor-model.js");
  const tree = require("./editor-tree-data.js");
  const { getMasks, ensureNames } = require("./mask-model.js");
  const { coercePath } = require("./path-native-channels.js");
  const { isPerspectiveView } = require("./path-projection.js");
  const { matrix, identity } = require("./compiler.js");
  const { inverse, multiply } = require("./editor-geometry.js");
  let copied = null;
  const project = () => editor.project;
  const report = error => notify(error.message || String(error));
  const kindOf = state => state.pathHost ? "mask" : "shape";
  const selected = () => viewport.objects?.length === 1 ? viewport.objects[0].object : null;
  function affineView() {
    if (isPerspectiveView(viewport)) throw Error("Path transfer requires the composited view. Press C to switch views.");
  }
  function groupsFor(state, id, insert = false) {
    const entry = state.pathHost || !id ? null : tree.find(state.layer.contents, id);
    if (!entry) return [];
    const groups = insert && entry.item.kind === "group" ? [...entry.ancestors, entry.item] : entry.ancestors;
    return groups.map(group => group.id);
  }
  function space(state, groups) {
    const frame = state.localFrame(), p = state.layer.properties;
    const read = (props, names) => Object.fromEntries(names.map(name => [name, props[name]?.get(frame)]));
    let world = matrix(read(p, ["position", "scale", "rotation"]));
    world = multiply(world, state.layer.layerSpaceMatrix || identity);
    for (const id of groups) {
      const group = tree.find(state.layer.contents, id)?.item;
      if (group?.kind !== "group") throw Error("The source path group is unavailable");
      world = multiply(world, matrix(read(group.properties, ["position", "scale", "rotation", "anchor", "skew", "skewAxis"])));
    }
    return matrixValues(world);
  }
  function hostFor(state, layer) {
    const kind = kindOf(state), address = layer.getAddress();
    const owner = project(), Content = state.Content;
    const resolve = () => {
      const target = editor.project === owner ? owner.addressLookup(address) : null;
      if (!target || target.type !== layer.type) throw Error("The path layer is unavailable");
      return target;
    };
    const readSnapshot = () => {
      const target = resolve();
      return clone(kind === "mask" ? getMasks(target) : target.contents);
    };
    function restoreSnapshot(data) {
      const target = resolve();
      if (kind === "mask") state.pathHost.writeHistory(target, data);
      else replaceContents(target, data, Content);
    }
    function writeSnapshot(data) {
      if (kind === "mask") {
        const stored = new Set(readSnapshot().map(mask => mask.id));
        data = data.map(mask => {
          if (stored.has(mask.id)) return mask;
          const item = clone(mask);
          item.properties.path = coercePath(item.properties.path);
          return item;
        });
        // Reserve existing names without renaming legacy masks.
        const names = data.map(mask => ({ properties: { name: mask.properties.name } }));
        ensureNames(names);
        data.forEach((mask, i) => { if (!stored.has(mask.id)) mask.properties.name = names[i].properties.name; });
      }
      restoreSnapshot(data);
    }
    return {
      kind, separateChannels: true, readSnapshot, restoreSnapshot, writeSnapshot,
      isLocked: id => state.pathLocked(id),
      findPath: id => state.pathFor(id).data,
      deletePath(id) {
        state.requireEditablePath(id);
        const target = resolve(), data = readSnapshot();
        if (kind === "mask") restoreSnapshot(data.filter(mask => mask.id !== id));
        else {
          const records = [];
          const visit = items => {
            for (const item of items) {
              if (item.kind === "path" && item.id !== id) records.push(item);
              if (item.contents) visit(item.contents);
            }
          };
          visit(data);
          writePathRecords(target, Content, records, new Map());
        }
      },
      createPainted(group, parentId) {
        const data = readSnapshot(), list = parentId ? tree.find(data, parentId)?.item.contents : data;
        if (!list) throw Error("The destination path group is unavailable");
        list.push(group);
        writeSnapshot(data);
      },
    };
  }
  function settle(state) {
    state.pointer?.commit();
    state.finishNudge?.();
    state.finishTextEdit?.();
  }
  function capture(target, nativeState, key) {
    const layer = selected(), state = layer && sessionFor(layer);
    if (!state?.valid()) return null;
    const control = target?.closest?.("[data-zoidium-path-control], .zoidium-masks");
    const focused = state.canvas?.contains(target) || control || nativeState?.layer === layer && nativeState.items?.length === 1 &&
      nativeState.items[0].kind === "path";
    if (!focused) return null;
    const id = nativeState?.layer === layer ? nativeState.ids[0] || state.activeId : state.activeId;
    if (key !== "v" && !state.pathFor(id).data) return null;
    return { layer, state, id, activeId: state.activeId, project: project() };
  }
  function current(capture) {
    return !!capture && project() === capture.project && selected() === capture.layer &&
      capture.state.valid() && capture.state.activeId === capture.activeId;
  }
  function copy(capture, cut) {
    const { state, id, layer } = capture;
    affineView();
    settle(state);
    if (cut) state.requireEditablePath(id);
    const item = state.pathFor(id).data, envelope = copyPath(item);
    const groups = groupsFor(state, id), token = nextId();
    envelope.sourceSpace = { token, matrix: space(state, groups) };
    copied = { token, layer, groups, project: project() };
    const text = JSON.stringify(envelope);
    if (text.length > 262144) throw Error("Path clipboard text budget exceeded");
    const remove = () => {
      if (!current(capture) || JSON.stringify(state.pathFor(id).data) !== JSON.stringify(item)) return;
      const host = hostFor(state, layer);
      const history = createGesture(editor.history, host.readSnapshot, host.restoreSnapshot, undefined, project);
      if (!history.run(() => host.deletePath(id))) throw Error("Finish the current edit before cutting a path");
    };
    return { text, remove };
  }
  function options(state, layer, parentId, from, to) {
    const destination = hostFor(state, layer);
    const backward = inverse(to);
    if (!backward) throw Error("Path transfer requires an invertible destination mapping");
    return {
      destination, matrix: multiply(backward, from), nextId, history: editor.history, adapter: state.pathAdapter,
      createPainted: group => destination.createPainted(group, parentId),
    };
  }
  function decode(text) {
    if (!text.trimStart().startsWith("{")) return null;
    let envelope;
    try { envelope = JSON.parse(text); } catch (_error) { return null; }
    if (envelope?.type !== "zoidium-path") return null;
    if (text.length > 262144) throw Error("Path clipboard text budget exceeded");
    return validate(envelope);
  }
  function pastePath(capture, envelope) {
    if (!current(capture)) return;
    affineView();
    const { state, id, layer } = capture;
    settle(state);
    const groups = groupsFor(state, id, true), to = space(state, groups);
    let from = envelope.sourceSpace ? matrixValues(envelope.sourceSpace.matrix) : to;
    if (copied && copied.project === project() && envelope.sourceSpace?.token === copied.token) {
      const source = sessionFor(copied.layer);
      if (source?.valid()) from = space(source, copied.groups);
    }
    return paste({ ...options(state, layer, groups.at(-1), from, to), envelope });
  }
  function convertPath(layer, id, destinationLayer) {
    try {
      affineView();
      const state = sessionFor(layer), destination = sessionFor(destinationLayer);
      if (!state?.valid() || !destination?.valid() || kindOf(state) === kindOf(destination))
        throw Error("Choose an available layer of the other path type");
      settle(state);
      settle(destination);
      return convert({ ...options(destination, destinationLayer, null, space(state, groupsFor(state, id)), space(destination, [])),
        source: hostFor(state, layer), pathId: id });
    } catch (error) { report(error); return false; }
  }
  function destinations(layer) {
    const state = sessionFor(layer);
    if (!state?.valid()) return [];
    const frame = editor.playback.currentFrame;
    return Array.from(editor.sequence?.videoTracks || []).flatMap(track => Array.from(track.clips))
      .filter(clip => clip.object !== layer && frame >= clip.start && frame < clip.start + clip.length)
      .filter(clip => {
        const target = sessionFor(clip.object);
        return target?.valid() && kindOf(target) !== kindOf(state);
      });
  }
  function conversionCommand(layer, id, x, y) {
    const mask = !!sessionFor(layer)?.pathHost;
    return {
      label: mask ? "Convert to Shape+" : "Convert to Mask",
      action() {
        const clips = destinations(layer);
        if (!clips.length) {
          notify(mask ? "Add a Shape+ clip at the playhead to receive the path." :
            "Add a Scene or Adjustment clip at the playhead to receive the mask.");
        } else if (clips.length === 1) convertPath(layer, id, clips[0].object);
        else openMenu({ x, y, title: "Choose destination clip", items: clips.map(clip => ({
          label: clip.properties.name.get(), action: () => convertPath(layer, id, clip.object),
        })) });
      },
    };
  }
  return { capture, current, copy, decode, paste: pastePath, conversionCommand };
}
module.exports = { VERSION, validate, copyPath, materialize, paste, convert, editorTransfer };
