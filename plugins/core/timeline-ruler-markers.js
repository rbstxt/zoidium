"use strict";

// Ruler labels use the native keyframe gesture, selection, snapping and
// property operations. A hidden native marker row supplies those operations
// when another property panel owns the visible keyframe rows.
module.exports = {
  activate(context) {
    const PZ = context.PZ;
    const Timeline = PZ?.ui?.timeline;
    const keyframesPrototype = Timeline?.keyframes?.prototype;
    if (!Timeline?.prototype || !keyframesPrototype) return;
    const timelines = new Map();
    const patches = [];
    let disposed = false;

    function patch(target, key, replacement) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      patches.push(() => {
        if (target[key] !== replacement) return;
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else delete target[key];
      });
      target[key] = replacement;
    }

    function markerElement(timeline, marker) {
      return Array.from(timeline.keyframes.container.getElementsByClassName("kfobject"))
        .find(element => element.pz_object === marker);
    }

    function refresh(timeline) {
      const state = timelines.get(timeline);
      if (!state || !timeline.keyframes) return;
      if (state.track?.parentElement) hideTrack(state.track);
      else state.track = null;
      for (const [label, original] of state.labels) {
        if (!label.parentElement) {
          state.labels.delete(label);
          continue;
        }
        const selected = markerElement(timeline, label.pz_marker)?.classList.contains("selected") || false;
        label.setAttribute("aria-pressed", String(selected));
        label.style.backgroundColor = selected ? "var(--zui-accent, #526183)" : original.backgroundColor;
      }
    }

    function hideTrack(track) {
      // Native move notifications skip display:none tracks. Keep this track
      // active, with no visible row or label, so the moved key stays selected.
      for (const element of [track, track.pz_label]) {
        element.style.height = "0px";
        element.style.visibility = "hidden";
        element.style.overflow = "hidden";
      }
    }

    function decorate(timeline) {
      const state = timelines.get(timeline);
      if (!state) return;
      for (const label of timeline.markers || []) {
        if (state.labels.has(label)) continue;
        state.labels.set(label, {
          pointerEvents: label.style.pointerEvents, cursor: label.style.cursor,
          backgroundColor: label.style.backgroundColor, title: label.getAttribute("title"),
          pressed: label.getAttribute("aria-pressed"),
        });
        label.style.pointerEvents = "auto";
        label.style.cursor = "ew-resize";
        label.title = "Marker " + label.pz_marker.value;
      }
      refresh(timeline);
    }

    function nativeMarker(timeline, marker, state) {
      let element = markerElement(timeline, marker);
      if (element) return element;
      const panel = timeline.keyframes;
      if (state.track?.parentElement) panel.unloadKeyframeTrack(state.track);
      state.track = panel.createKeyframeTrack(panel.container, timeline.sequence.properties.markers);
      hideTrack(state.track);
      return markerElement(timeline, marker);
    }

    function install(timeline) {
      if (disposed || timelines.has(timeline) || !timeline.timerule) return;
      const state = { labels: new Map(), track: null, observer: null, down: null };
      timelines.set(timeline, state);
      state.down = event => {
        if (event.button !== 0) return;
        let label = event.target;
        while (label && label !== timeline.timerule && !label.pz_marker) label = label.parentElement;
        if (!label?.pz_marker || !timeline.sequence?.properties.markers.keyframes.includes(label.pz_marker)) return;
        const element = nativeMarker(timeline, label.pz_marker, state);
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        timeline.setFrame(timeline.frameToPx(label.pz_marker.frame));
        // Native drag expects the actual keyframe as currentTarget. Forward
        // the real coordinates and modifiers; subsequent moves/releases are
        // handled by its own document listeners and its single history step.
        timeline.keyframes.keyframe_drag.startfn_bound({
          currentTarget: element, target: element, button: event.button,
          pageX: event.pageX, pageY: event.pageY,
          shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
          preventDefault() { event.preventDefault(); }, stopPropagation() { event.stopPropagation(); },
        });
        refresh(timeline);
      };
      timeline.timerule.addEventListener("mousedown", state.down, true);
      // Existing timelines bound their original redraw method during startup.
      // Observe only child replacement, not the per-frame text/style updates.
      state.observer = new context.window.MutationObserver(() => decorate(timeline));
      state.observer.observe(timeline.timerule, { childList: true });
      decorate(timeline);
    }

    context.lifecycle.onDispose(() => {
      disposed = true;
      for (const [timeline, state] of timelines) {
        state.observer?.disconnect();
        timeline.timerule.removeEventListener("mousedown", state.down, true);
        // Finish a native gesture before releasing its hidden row.
        const drag = timeline.keyframes?.keyframe_drag;
        if (drag?.dragging && drag.endfn_bound) {
          drag.endfn_bound({ type: "mouseup", currentTarget: timeline.el.ownerDocument, preventDefault() {} });
        }
        if (state.track?.parentElement) timeline.keyframes.unloadKeyframeTrack(state.track);
        for (const [label, original] of state.labels) {
          for (const key of ["pointerEvents", "cursor", "backgroundColor"]) label.style[key] = original[key];
          for (const [key, value] of [["title", original.title], ["aria-pressed", original.pressed]]) {
            if (value === null) label.removeAttribute(key);
            else label.setAttribute(key, value);
          }
        }
      }
      timelines.clear();
      for (const restore of patches.reverse()) restore();
    });

    const create = Timeline.prototype.create;
    patch(Timeline.prototype, "create", function () {
      const result = create.apply(this, arguments);
      install(this);
      return result;
    });
    const redraw = Timeline.prototype.redrawMarkers;
    patch(Timeline.prototype, "redrawMarkers", function () {
      const result = redraw.apply(this, arguments);
      install(this);
      decorate(this);
      return result;
    });
    for (const key of ["selectKeyframe", "deselectKeyframe", "deselectAll", "objectsChanged", "keydown", "keyframeDragEnd"]) {
      const original = keyframesPrototype[key];
      patch(keyframesPrototype, key, function () {
        try { return original.apply(this, arguments); }
        finally { refresh(this.timeline || this.ctx?.timeline); }
      });
    }
    for (const element of context.document.querySelectorAll(".editorpanel")) {
      if (element.pz_panel instanceof Timeline) install(element.pz_panel);
    }
  },
};
