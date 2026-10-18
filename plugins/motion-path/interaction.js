"use strict";
// Pointer handling for motion paths. Presses are hit-tested in the capture
// phase on the viewport element; only presses on a path key or handle are
// consumed, so Shape+'s overlay, widget2d, widget3d and the camera controls
// receive every other event. Escape (or an undo shortcut) cancels a drag;
// lost capture, blur, playback or a vanished path commit what is shown.
const edit = require("./path-edit.js");
const { createSession } = require("./edit-session.js");
const { hit } = require("./overlay.js");
const DRAG_DISTANCE = 3;

const sub = (a, b) => a.map((x, i) => x - b[i]);
function channelsFrom(session, model) {
  return model.channels.map((ch, i) => {
    const base = session?.base(i);
    return base ? { keys: base, animated: true, editable: ch.editable } : ch;
  });
}
function merge(...lists) {
  return lists[0].map((_x, i) => lists.reduce((found, list) => found || list[i], null));
}
function createInteraction(s) {
  const { viewport, canvas, window } = s;
  const doc = canvas.ownerDocument;
  let active = null;
  function selectionFor(model) {
    let set = s.selection.get(model.path.id);
    if (!set) s.selection.set(model.path.id, (set = new Set()));
    return set;
  }
  function plane(model, point, frame) {
    return (model.path.spaceAt?.(frame) || model.path.space).plane(point);
  }
  // Ensure keys on the axes an edit touches, then return planning channels.
  function prepare(g, axes, frames) {
    if (!g.session) {
      g.session = createSession({ PZ: s.PZ, editor: s.editor, path: g.model.path, easings: s.easings });
      if (!g.session) return null;
    }
    const needed = edit.materialFrames(g.model.frames, frames);
    for (const a of axes) if (g.model.channels[a].editable) g.session.ensure(a, needed);
    return channelsFrom(g.session, g.model);
  }
  const editable = model => model.channels.map((ch, i) => (ch.editable ? i : -1)).filter(i => i >= 0);
  function update(g, event) {
    const at = g.toParent(event.clientX, event.clientY);
    if (!at) return;
    const raw = sub(at, g.start), delta = edit.constrain(raw, event.shiftKey);
    if (event.altKey) g.alt = true;
    const frame = g.key.frame;
    let planned = null;
    if (g.type === "key") {
      const axes = editable(g.model);
      const channels = prepare(g, axes, g.frames);
      if (channels) planned = edit.moveKeys(channels, g.frames, delta);
    } else if (g.type === "pull") {
      const channels = prepare(g, editable(g.model), [frame]);
      if (!channels) return;
      const pulled = edit.pullHandles(channels, frame, s.easings);
      const base = channels.map((ch, i) => (pulled[i] ? { ...ch, keys: pulled[i] } : ch));
      const target = base.map((ch, i) => (ch.editable ? delta[i] : null));
      planned = merge(edit.setHandle(base, frame, g.side, target, { easings: s.easings }), pulled);
    } else {
      const touched = delta.map((d, i) => (d ? i : -1)).filter(i => i >= 0);
      const channels = prepare(g, g.alt ? editable(g.model) : touched, [frame]);
      if (!channels) return;
      const target = delta.map((d, i) => (d ? g.vector[i] + d : null));
      planned = edit.setHandle(channels, frame, g.side, target, { breakTangent: g.alt, easings: s.easings });
    }
    if (planned && g.session) g.session.preview(planned);
    s.requestDraw();
  }
  function click(g, event) {
    const set = selectionFor(g.model), frame = g.key.frame;
    if (g.type === "pull") {
      // Alt-click toggles the key between linear and smooth bezier.
      const channels = prepare(g, editable(g.model), [frame]);
      if (channels) g.session.preview(edit.toggleKey(channels, frame, s.easings));
      return;
    }
    if (g.type !== "key") return;
    if (event.shiftKey) {
      if (set.has(frame)) set.delete(frame);
      else set.add(frame);
    } else { set.clear(); set.add(frame); }
  }
  function finish(cancel, event) {
    const g = active;
    if (!g) return;
    active = null;
    try {
      if (!cancel && !g.moved && event) click(g, event);
      if (g.session) {
        if (cancel) g.session.cancel();
        else g.session.commit();
      }
    } catch (error) {
      try { g.session?.cancel(); } catch (_ignored) { /* The operation is already closed. */ }
      console.error("[Zoidium] motion-path: the edit failed", error);
    } finally {
      if (canvas.hasPointerCapture?.(g.pointerId)) canvas.releasePointerCapture(g.pointerId);
      canvas.style.pointerEvents = "none";
      s.requestDraw();
    }
  }
  function begin(event, found) {
    const { model, key, side } = found, set = selectionFor(model);
    const g = {
      model, key, side: side === "in" ? 0 : 1, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, moved: false, alt: event.altKey, session: null,
      frame: s.editor.playback.currentFrame,
    };
    if (side) {
      g.type = "handle";
      g.vector = key.handles[side].vector.slice();
      g.toParent = plane(model, key.handles[side].point, key.frame);
      g.start = key.handles[side].point;
    } else {
      g.type = event.altKey ? "pull" : "key";
      // Shift-click toggles the key on release; Shift during a drag only
      // constrains it, so a press never changes the selection with Shift.
      if (g.type === "key" && !event.shiftKey && !set.has(key.frame)) { set.clear(); set.add(key.frame); }
      // Pulling handles starts at the key; the out handle follows the
      // pointer (the in handle on the last key).
      const last = key.frame === model.frames[model.frames.length - 1];
      g.side = last ? 0 : 1;
      g.vector = model.channels.map(() => 0);
      g.frames = set.has(key.frame) ? [...set].filter(f => model.frames.includes(f)).sort((a, b) => a - b) : [key.frame];
      g.toParent = plane(model, key.point, key.frame);
      g.start = key.point;
    }
    const start = g.toParent(event.clientX, event.clientY);
    if (!start) return null;
    g.start = start;
    return g;
  }
  function down(event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (active && active.pointerId !== event.pointerId) return;
    if (active) finish(false);
    const found = hit(s.models, event.clientX, event.clientY);
    if (!found) {
      // A press elsewhere in the viewport clears the path key selection but
      // stays with its owner (Shape+, widget2d/3d, the camera controls).
      if (s.selection.size) { s.selection.clear(); s.requestDraw(); }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    let g;
    try { g = begin(event, found); } catch (error) { console.error("[Zoidium] motion-path: the edit could not start", error); }
    if (!g) return;
    active = g;
    canvas.style.pointerEvents = "auto";
    try { canvas.setPointerCapture(event.pointerId); } catch (_error) { /* Events still arrive over the overlay. */ }
    s.requestDraw();
  }
  function hover(event) {
    if (active) return;
    const found = event.buttons ? null : hit(s.models, event.clientX, event.clientY);
    canvas.style.pointerEvents = found ? "auto" : "none";
    canvas.style.cursor = found ? (found.side ? "crosshair" : "move") : "";
  }
  function move(event) {
    const g = active;
    if (!g || g.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerType === "mouse" && event.buttons === 0) { finish(false, event); return; }
    if (!g.moved && Math.hypot(event.clientX - g.x, event.clientY - g.y) < DRAG_DISTANCE) return;
    g.moved = true;
    try { update(g, event); } catch (error) {
      finish(true);
      console.error("[Zoidium] motion-path: the drag failed", error);
    }
  }
  function up(event) {
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    finish(false, event);
  }
  function interrupt(event) {
    if (active && (event?.pointerId === undefined || event.pointerId === active.pointerId)) finish(false);
  }
  function key(event) {
    if (!active) return;
    const undo = (event.ctrlKey || event.metaKey) && /^[zy]$/i.test(event.key);
    if (event.key === "Escape" || undo) {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    }
  }
  viewport.el.addEventListener("pointerdown", down, true);
  viewport.el.addEventListener("pointermove", hover, true);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", interrupt);
  canvas.addEventListener("lostpointercapture", interrupt);
  window.addEventListener("blur", interrupt);
  doc.addEventListener("keydown", key, true);
  return {
    get active() { return active; },
    // Playback, a vanished path or teardown end a drag where it is.
    check(models) {
      if (!active) return;
      const alive = models.some(m => m.path.id === active.model.path.id);
      if (!alive || s.editor.playback.currentFrame !== active.frame) finish(false);
    },
    commit: () => finish(false),
    dispose() {
      finish(false);
      viewport.el.removeEventListener("pointerdown", down, true);
      viewport.el.removeEventListener("pointermove", hover, true);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", interrupt);
      canvas.removeEventListener("lostpointercapture", interrupt);
      window.removeEventListener("blur", interrupt);
      doc.removeEventListener("keydown", key, true);
    },
  };
}
module.exports = { createInteraction };
