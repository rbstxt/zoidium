"use strict";
// Install before CM3 constructs its keyframes panel. attach(panel, context)
// binds the P3.4 model; bind(context) replaces clip/project/overlay state.
// The integration owns panel discovery and calls dispose on teardown. Only one
// path is selected at a time, so an edit is one host snapshot transaction.
const timelineModel = require("./path-timeline-model.js");

function install(PZ) {
  const proto = PZ?.ui?.timeline?.keyframes?.prototype;
  if (!proto) throw Error("Timeline keyframes panel is unavailable");
  const panels = new Map(), originals = new Map(), wrappers = new Map();
  function patch(name, handler) {
    const original = proto[name];
    if (typeof original !== "function") throw Error("Missing timeline method: " + name);
    const wrapper = function (...args) { return handler.call(this, original, ...args); };
    originals.set(name, original); wrappers.set(name, wrapper); proto[name] = wrapper;
  }
  function state(receiver) { return panels.get(receiver.ctx || receiver); }
  function diamond(node) { return node && node.zoidiumPathDiamond; }
  patch("objectsChanged", function (original, ...args) {
    const s = state(this); if (s) s.clear();
    const result = original.apply(this, args); if (s) s.render(); return result;
  });
  for (const name of ["zoom", "objectOffsetChanged"]) patch(name, function (original, ...args) {
    const result = original.apply(this, args); const s = state(this); if (s) s.render(); return result;
  });
  patch("selectKeyframe", function (original, node, ...args) {
    const s = state(this), d = diamond(node);
    if (s && d) return s.select(d, true);
    return original.call(this, node, ...args);
  });
  patch("deselectKeyframe", function (original, node, ...args) {
    const s = state(this), d = diamond(node);
    if (s && d) return s.select(d, false);
    return original.call(this, node, ...args);
  });
  patch("deselectAll", function (original, ...args) {
    const s = state(this); if (s) s.clearSelection();
    return original.apply(this, args);
  });
  patch("keydown", function (original, event) {
    const s = state(this);
    if (s && s.hasSelection() && ["Delete", "Del", "Backspace"].includes(event.key)) {
      event.stopPropagation(); event.preventDefault(); return s.remove();
    }
    // Native clipboard code expects property objects and cannot copy path rows.
    if (s && s.hasSelection() && event.ctrlKey && ["c", "x"].includes(event.key)) {
      event.stopPropagation(); event.preventDefault(); return;
    }
    return original.call(this, event);
  });
  patch("keyframeDragStart", function (original, event) {
    const s = state(this), d = diamond(event.currentTarget);
    if (s && d) return s.dragStart(this, event, d);
    return original.call(this, event);
  });
  patch("keyframeDrag", function (original, event) {
    const s = this.zoidiumPathOwner; if (s && this.zoidiumPathDrag) return s.drag(this, event);
    return original.call(this, event);
  });
  patch("keyframeDragUpdate", function (original, ...args) {
    const s = this.zoidiumPathOwner; if (s && this.zoidiumPathDrag) return s.dragUpdate(this);
    return original.apply(this, args);
  });
  patch("keyframeDragEnd", function (original, event, ...args) {
    const s = this.zoidiumPathOwner; if (s && this.zoidiumPathDrag) return s.dragEnd(this, event);
    return original.call(this, event, ...args);
  });
  function attach(panel, context) {
    if (panels.has(panel)) throw Error("Timeline panel already attached");
    let model, muted = false, disposed = false, generation = 0, nodes = [], tracks = [], selectedId = null;
    let activeDrag = null, currentContext = context;
    const doc = panel.container.ownerDocument;
    const restoreInstance = [];
    // Panels constructed before the plugin loaded already hold callbacks.
    for (const [slot, method] of Object.entries({
      start: "keyframeDragStart", move: "keyframeDrag", update: "keyframeDragUpdate", end: "keyframeDragEnd",
    })) {
      const drag = panel.keyframe_drag;
      if (drag[slot] === originals.get(method)) drag[slot] = wrappers.get(method);
      if (drag[slot] !== wrappers.get(method)) continue;
      restoreInstance.push(() => { if (drag[slot] === wrappers.get(method)) drag[slot] = originals.get(method); });
    }
    const originalKeydown = panel.el.onkeydown;
    if (typeof originalKeydown === "function") {
      const keydown = panel.keydown.bind(panel);
      panel.el.onkeydown = keydown;
      restoreInstance.push(() => { if (panel.el.onkeydown === keydown) panel.el.onkeydown = originalKeydown; });
    }
    if (panel.objectsChanged_bound) {
      const change = panel.objectsChanged.bind(panel), original = panel.objectsChanged_bound;
      const swap = (from, to) => {
        panel.objects?.onListChanged.unwatch(from);
        panel.objectsChanged_bound = to;
        panel.objects?.onListChanged.watch(to);
      };
      swap(original, change);
      restoreInstance.push(() => { if (panel.objectsChanged_bound === change) swap(change, original); });
    }
    function clear() {
      for (const node of nodes) {
        const fn = panel.keyframe_drag.startfn_bound;
        if (fn) { node.removeEventListener("mousedown", fn); node.removeEventListener("touchstart", fn); }
        node.remove();
      }
      for (const track of tracks) { track.pz_label.remove(); track.remove(); }
      nodes = []; tracks = [];
    }
    function position() {
      for (const node of nodes) {
        node.pz_frame = node.zoidiumPathDiamond.frame;
        node.style.left = panel.timeline.frameToPx(node.zoidiumPathDiamond.frame) + "px";
      }
    }
    function render() {
      if (muted || !model) return;
      generation++; clear();
      const add = (row, depth) => {
        const label = doc.createElement("div"), track = doc.createElement("div");
        label.classList.add("noselect"); label.textContent = row.label; label.title = row.label;
        label.style.height = "20px"; label.style.lineHeight = "20px";
        label.style.color = "var(--zui-text,#ddd)";
        label.style.paddingLeft = (5 + depth * 14) + "px";
        track.classList.add("kftrack"); track.style.height = "20px";
        track.style.width = Math.max(panel.container.clientWidth, parseFloat(panel.timeline.scrollBar.firstElementChild.style.width) || 0) + "px";
        track.pz_label = label; track.pz_color = "hsl(210, 40%, 45%)"; track.pz_borderColor = "hsl(210, 40%, 60%)";
        panel.labels.appendChild(label); panel.container.appendChild(track); tracks.push(track);
        for (const item of row.diamonds || []) {
          const node = doc.createElement("div"); node.classList.add("keyframe");
          if (item.selected) node.classList.add("selected");
          node.zoidiumPathDiamond = { id: row.id, frame: item.frame };
          track.appendChild(node); nodes.push(node); panel.keyframe_drag.addElts(node);
          panel.updateKeyframeColor(node);
        }
        for (const child of row.children || []) add(child, depth + 1);
      };
      for (const row of model.rows()) add(row, 0);
      position(); panel.updateTrackColors(panel.container);
    }
    function frames(id) { return nodes.filter((n) => n.zoidiumPathDiamond.id === id && n.classList.contains("selected")).map((n) => n.zoidiumPathDiamond.frame); }
    function update(id, values) {
      muted = true; try { model.select(id, values); } finally { muted = false; }
      for (const node of nodes) if (node.zoidiumPathDiamond.id === id) node.classList.toggle("selected", values.includes(node.zoidiumPathDiamond.frame));
    }
    function clearSelection() { if (selectedId !== null) update(selectedId, []); selectedId = null; }
    function select(d, on) {
      if (selectedId !== null && selectedId !== d.id) clearSelection();
      selectedId = d.id;
      const values = frames(d.id).filter((frame) => frame !== d.frame);
      if (on) values.push(d.frame);
      update(d.id, values);
    }
    function pageX(event) { return event.touches?.[0]?.pageX ?? event.pageX; }
    function dragStart(drag, event, d) {
      if (event.button > 0) return false;
      panel.el.focus();
      const wasSelected = frames(d.id).includes(d.frame);
      if (!wasSelected) { if (!event.shiftKey) panel.deselectAll(); select(d, true); }
      activeDrag = drag;
      drag.zoidiumPathOwner = s;
      drag.zoidiumPathDrag = { generation, scroll: panel.container.scrollLeft, id: d.id, frame: d.frame, frames: frames(d.id), x: pageX(event), originX: pageX(event),
        startLeft: parseFloat(event.currentTarget.style.left), delta: 0, wasSelected };
      event.stopPropagation();
    }
    function drag(drag, event) { drag.zoidiumPathDrag.x = pageX(event); drag.zoidiumPathDrag.snap = !event.shiftKey; }
    function dragUpdate(drag) {
      const g = drag.zoidiumPathDrag;
      if (disposed || g.generation !== generation) return;
      const px = g.startLeft + g.x - g.originX + panel.container.scrollLeft - g.scroll;
      if (g.x !== g.originX && panel.timeline.keepInView) panel.timeline.keepInView(px);
      const target = g.x === g.originX && panel.container.scrollLeft === g.scroll ? g.frame : panel.snap(px, g.snap);
      g.delta = target - g.frame;
      for (const node of nodes) if (node.zoidiumPathDiamond.id === g.id && g.frames.includes(node.zoidiumPathDiamond.frame))
        node.style.left = panel.timeline.frameToPx(node.zoidiumPathDiamond.frame + g.delta) + "px";
    }
    function dragEnd(drag, event) {
      activeDrag = null;
      const g = drag.zoidiumPathDrag; delete drag.zoidiumPathDrag; delete drag.zoidiumPathOwner;
      if (disposed || g.generation !== generation) return;
      if (event.key === "Escape" || event.type === "touchcancel") { render(); return; }
      run(() => {
        if (g.delta) model.move(g.id, g.frames, g.delta);
        else { model.seek(g.id, g.frame); if (event.shiftKey && g.wasSelected) select({ id: g.id, frame: g.frame }, false); }
      });
      render();
    }
    function run(command) {
      try { return command(); }
      catch (error) {
        if (!currentContext?.onError) throw error;
        currentContext.onError(error);
      }
    }
    function bind(next) {
      const sameClip = currentContext && next && currentContext.project === next.project && currentContext.clip === next.clip;
      if (!sameClip) { generation++; selectedId = null; }
      currentContext = next;
      // Opening or closing the overlay replaces the observer on this clip.
      // An in-progress timeline drag still owns the existing diamonds.
      muted = !!(sameClip && activeDrag);
      try { model.bind(next); } finally { muted = false; }
      if (!next) clear();
    }
    const s = { clear, render, position, select, clearSelection, dragStart, drag, dragUpdate, dragEnd,
      hasSelection: () => selectedId !== null && frames(selectedId).length > 0,
      remove: () => { if (selectedId !== null) run(() => model.remove(selectedId, frames(selectedId))); },
      bind,
      dispose() {
        disposed = true;
        generation++;
        if (activeDrag?.drag?.dragging) activeDrag.drag.endfn(activeDrag, {
          type: "keydown", key: "Escape", currentTarget: doc, preventDefault() {},
        });
        model.dispose();
        clear();
        restoreInstance.forEach(restore => restore());
        panels.delete(panel);
      },
    };
    panels.set(panel, s); model = timelineModel.create(context, render); render(); return s;
  }
  function dispose() {
    for (const s of [...panels.values()]) s.dispose();
    for (const [name, wrapper] of wrappers) if (proto[name] === wrapper) proto[name] = originals.get(name);
  }
  return { attach, dispose };
}
module.exports = { install };
