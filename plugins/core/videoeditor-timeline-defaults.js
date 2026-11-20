(function installVideoEditorTimelineDefaults(global) {
  "use strict";

  const PATCH_MARKER = "__zoidiumVideoEditorTimelineDefaultsPatch";
  // Video Editor 2 builds its timeline at zoom .012 while Clipmaker 3 uses .3,
  // so the same project spans 25x less width and the ruler starts almost
  // collapsed. Scale the layout's own value instead of hardcoding one, so the
  // multiplier keeps meaning "wider than the layout intended" if the layout
  // changes its default. .012 x 30 is .36.
  const ZOOM_MULTIPLIER = 30;
  // PZ.ui.timeline.formatTime returns the raw frame number when timeFormat is
  // 2, which is what clipmaker-3.0.106.js selects. Video Editor 2 leaves the
  // default 0 (HH:MM:SS.mmm), which is why its ruler and timestamp read as
  // timecode. The user can still cycle the format by right-clicking the
  // timestamp; Clipmaker 3 behaves the same way.
  const FRAME_TIME_FORMAT = 2;

  function applyTimelineDefaults(timeline) {
    if (!timeline || timeline[PATCH_MARKER]) return false;
    timeline[PATCH_MARKER] = true;

    timeline.timeFormat = FRAME_TIME_FORMAT;

    // Assigned directly instead of through updateZoom(): updateZoom reads
    // playback.totalFrames, which dereferences the sequence and throws before
    // a project is loaded. The sequence's rate watcher calls updateZoom() with
    // this value as soon as the project loads, and that call is what sizes the
    // scroll bar, the ruler labels, and the tracks.
    const zoom = timeline.zoom;
    if (typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0) {
      timeline.zoom = zoom * ZOOM_MULTIPLIER;
    }
    return true;
  }

  function installTimelineDefaults(editor, ui, layout) {
    if (layout !== "videoeditor") return false;
    if (!editor || typeof editor.setUpEditor !== "function") return false;
    if (!ui || typeof ui.timeline !== "function") return false;
    if (editor[PATCH_MARKER]) return false;

    const originalSetUpEditor = editor.setUpEditor;
    const originalTimeline = ui.timeline;

    editor.setUpEditor = function setUpEditorWithTimelineDefaults(account) {
      let timeline = null;

      // Swap the constructor only for the duration of setUpEditor(). Video
      // Editor 2 builds exactly one PZ.ui.timeline there and assigns
      // `zoom = .012` after the constructor returns, so the instance is
      // captured during the call and corrected once it has finished.
      function TimelineProxy(editorInstance, options) {
        const instance = new originalTimeline(editorInstance, options);
        if (editorInstance === editor) timeline = instance;
        return instance;
      }
      TimelineProxy.prototype = originalTimeline.prototype;
      Object.keys(originalTimeline).forEach((key) => {
        TimelineProxy[key] = originalTimeline[key];
      });

      ui.timeline = TimelineProxy;
      try {
        return originalSetUpEditor.call(this, account);
      } finally {
        ui.timeline = originalTimeline;
        applyTimelineDefaults(timeline);
      }
    };

    editor[PATCH_MARKER] = true;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Timeline clip trimming
  //
  // CM3 computes one shared frame delta across every handle that carries the
  // `selected` class, but a clip click selects clips and leaves the handles
  // untouched. Dragging one edge of a multi-selection therefore trimmed only
  // that clip. These patches mark the matching edge of every selected clip
  // before the native gesture starts, so the native drag applies one delta and
  // one history operation to the whole set.
  //
  // The same block owns the trim hit zone: CM3 sizes a handle to 20% of the
  // clip width (up to 50 px), which leaves a few pixels on short clips. The
  // replacement keeps a usable minimum and still leaves a middle third for
  // moving the clip.

  const TRIM_PATCH_MARKER = "__zoidiumTimelineTrimPatch";
  const TRIM_STATE_KEY = "__zoidiumTimelineTrimState";
  const MIN_HANDLE_WIDTH = 8;
  const MAX_HANDLE_WIDTH = 50;
  const HANDLE_WIDTH_RATIO = 0.2;
  const HANDLE_MAX_SHARE = 1 / 3;

  function handleEdge(handle) {
    return handle && parseFloat(handle.style.right) === 0 ? "end" : "start";
  }

  function edgeHandle(clipElement, edge) {
    if (!clipElement || typeof clipElement.getElementsByClassName !== "function") return null;
    const handles = clipElement.getElementsByClassName("handle");
    for (let index = 0; index < handles.length; index += 1) {
      if (handleEdge(handles[index]) === edge) return handles[index];
    }
    return null;
  }

  function handleWidthPx(clipWidth) {
    if (!Number.isFinite(clipWidth) || clipWidth <= 0) return null;
    return Math.min(
      MAX_HANDLE_WIDTH,
      Math.max(MIN_HANDLE_WIDTH, clipWidth * HANDLE_WIDTH_RATIO),
      clipWidth * HANDLE_MAX_SHARE,
    );
  }

  function trimKeyframeValue(clip, index) {
    const keyframes = clip && clip.properties && clip.properties.time &&
      clip.properties.time.keyframes;
    const key = keyframes && keyframes[index];
    return key && Number.isFinite(key.value) ? key.value : null;
  }

  function trimBounds(clip, edge, rate, adjustTime) {
    let lower = -Infinity;
    let upper = Infinity;
    if (edge === "start") {
      lower = Math.max(lower, -clip.start);
      if (adjustTime) {
        const value = trimKeyframeValue(clip, 0);
        if (value !== null) lower = Math.max(lower, -value * rate);
      }
      upper = Math.min(upper, clip.length - 1);
    } else {
      lower = Math.max(lower, 1 - clip.length);
      if (adjustTime) {
        const value = trimKeyframeValue(clip, 1);
        const mediaLength = clip.mediaLength;
        if (value !== null && Number.isFinite(mediaLength)) {
          upper = Math.min(upper, mediaLength - value * rate);
        }
      }
    }
    return { lower, upper };
  }

  // One frame delta satisfies every clipped edge, so the selected clips keep
  // their relative positions. The limits mirror a single CM3 trim: the sequence
  // start, media length, and a one-frame minimum length.
  function resolveTrimDelta(tasks, rawDelta, rate, adjustTime) {
    if (!Number.isFinite(rawDelta)) return 0;
    let lower = -Infinity;
    let upper = Infinity;
    for (const task of tasks) {
      const bounds = trimBounds(task.clip, task.edge, rate, adjustTime);
      lower = Math.max(lower, bounds.lower);
      upper = Math.min(upper, bounds.upper);
    }
    const epsilon = 1e-9;
    lower = Math.ceil(lower - epsilon);
    upper = Math.floor(upper + epsilon);
    return Math.max(lower, Math.min(rawDelta, upper));
  }

  function collectTrimTargets(tracks, clipElement, options) {
    const container = tracks && tracks.container;
    if (!container || !clipElement) return null;
    const selected = Array.from(container.querySelectorAll(".clip.selected"));
    if (selected.length < 2 || selected.indexOf(clipElement) < 0) return null;
    const wanted = new Set(selected);
    if (!options || !options.altKey) {
      for (const element of selected) {
        const link = element.pz_object && element.pz_object.link;
        if (!link || !link.clips) continue;
        for (const member of link.clips) {
          let linked = null;
          try {
            linked = tracks.addressToEl(member.getAddress());
          } catch (error) {
            linked = null;
          }
          if (linked && linked.classList.contains("clip") &&
            !linked.classList.contains("proxy")) wanted.add(linked);
        }
      }
    }
    const targets = Array.from(container.querySelectorAll(".clip"))
      .filter(element => wanted.has(element) && !element.classList.contains("proxy"));
    return targets.length > 1 ? targets : null;
  }

  function applyTrimDelta(dragCtx, delta) {
    const timeline = dragCtx.ctx.timeline;
    for (const proxy of dragCtx.clip_proxies) {
      const clip = proxy.pz_object;
      proxy.pz_start = clip.start;
      proxy.pz_length = clip.length;
      if (proxy.leftHandle) {
        proxy.pz_start += delta;
        proxy.pz_length -= delta;
        if (dragCtx.adjustTime) {
          const value = trimKeyframeValue(clip, 0);
          proxy.pz_offset = -delta;
          proxy.pz_timeStart = (value === null ? 0 : value) + delta / dragCtx.rate;
        }
      }
      if (proxy.rightHandle) {
        proxy.pz_length += delta;
        if (dragCtx.adjustTime) {
          const value = trimKeyframeValue(clip, 1);
          proxy.pz_timeEnd = (value === null ? 0 : value) + delta / dragCtx.rate;
        }
      }
      if (dragCtx.rateStretch) proxy.pz_scale = proxy.pz_length / clip.length;
      proxy.style.left = timeline.frameToPx(proxy.pz_start) + "px";
      proxy.style.width = timeline.frameToPx(proxy.pz_length) + "px";
    }
  }

  function updateMultiTrim(dragCtx) {
    const tracks = dragCtx.ctx;
    const timeline = tracks.timeline;
    let point = (dragCtx.currentPt.x + timeline.scrollBar.scrollLeft) / timeline.zoom;
    point += dragCtx.offset;
    timeline.keepInView(point * timeline.zoom);
    const frame = tracks.snap(point * timeline.zoom, dragCtx.snap);
    const clip = dragCtx.clip.pz_object;
    const rawDelta = dragCtx.isRightHandle
      ? frame - clip.start - clip.length
      : frame - clip.start;
    if (rawDelta !== 0 && dragCtx.moved !== true) {
      dragCtx.moved = true;
      for (const proxy of dragCtx.clip_proxies) proxy.style.display = "";
    }
    if (dragCtx.moved !== true) return;
    const tasks = [];
    for (const proxy of dragCtx.clip_proxies) {
      if (proxy.leftHandle) tasks.push({ clip: proxy.pz_object, edge: "start" });
      if (proxy.rightHandle) tasks.push({ clip: proxy.pz_object, edge: "end" });
    }
    applyTrimDelta(dragCtx, resolveTrimDelta(tasks, rawDelta, dragCtx.rate, dragCtx.adjustTime));
  }

  function releaseTrimState(dragCtx, state, keepClicked, event) {
    if (state) {
      for (const handle of state.added) {
        try {
          handle.classList.remove("selected");
        } catch (error) {
          // A removed clip element no longer needs its handle state.
        }
      }
      const shiftClick = Boolean(event && event.shiftKey && dragCtx.moved !== true);
      if (keepClicked && !shiftClick && state.clicked) {
        try {
          state.clicked.classList.add("selected");
        } catch (error) {
          // A removed clip element no longer needs its handle state.
        }
      }
    }
    delete dragCtx[TRIM_STATE_KEY];
  }

  function installTrimPatch(PZ) {
    const tracks = PZ && PZ.ui && PZ.ui.timeline && PZ.ui.timeline.tracks;
    const prototype = tracks && tracks.prototype;
    if (!prototype || prototype[TRIM_PATCH_MARKER]) return false;
    if (
      typeof prototype.handleDragStart !== "function" ||
      typeof prototype.handleDragUpdate !== "function" ||
      typeof prototype.handleDragEnd !== "function"
    ) return false;

    const originalStart = prototype.handleDragStart;
    const originalUpdate = prototype.handleDragUpdate;
    const originalEnd = prototype.handleDragEnd;
    const originalResizeClip = prototype.resizeClip;

    prototype.handleDragStart = function zoidiumTrimDragStart(event) {
      const tracksInstance = this.ctx;
      const handle = event && event.currentTarget;
      const clipElement = handle && handle.parentElement;
      let state = null;
      if (tracksInstance && clipElement) {
        const targets = collectTrimTargets(tracksInstance, clipElement, event);
        if (targets) {
          const edge = handleEdge(handle);
          const added = [];
          if (typeof tracksInstance.deselectHandles === "function") {
            tracksInstance.deselectHandles();
          }
          for (const target of targets) {
            const targetHandle = edgeHandle(target, edge);
            if (!targetHandle) continue;
            if (!targetHandle.classList.contains("selected")) added.push(targetHandle);
            targetHandle.classList.add("selected");
          }
          state = { added, clicked: handle, edge };
          this[TRIM_STATE_KEY] = state;
        }
      }
      if (!state) delete this[TRIM_STATE_KEY];
      let result;
      try {
        result = originalStart.apply(this, arguments);
      } catch (error) {
        releaseTrimState(this, state, false, event);
        throw error;
      }
      if (result === false) releaseTrimState(this, state, false, event);
      return result;
    };

    prototype.handleDragUpdate = function zoidiumTrimDragUpdate() {
      if (!this[TRIM_STATE_KEY]) return originalUpdate.apply(this, arguments);
      return updateMultiTrim(this);
    };

    prototype.handleDragEnd = function zoidiumTrimDragEnd(event) {
      const state = this[TRIM_STATE_KEY];
      try {
        return originalEnd.apply(this, arguments);
      } finally {
        releaseTrimState(this, state, true, event);
      }
    };

    if (typeof originalResizeClip === "function") {
      prototype.resizeClip = function zoidiumTrimResizeClip(clipElement) {
        const result = originalResizeClip.apply(this, arguments);
        const width = clipElement && clipElement.style && parseFloat(clipElement.style.width);
        const zone = handleWidthPx(width);
        if (zone !== null) {
          const handles = clipElement.getElementsByClassName("handle");
          for (let index = 0; index < handles.length; index += 1) {
            handles[index].style.width = zone + "px";
          }
        }
        return result;
      };
    }

    prototype[TRIM_PATCH_MARKER] = true;
    return true;
  }

  function installClipDragPatch(PZ) {
    const prototype = PZ?.ui?.timeline?.tracks?.prototype;
    const marker = "__zoidiumStationaryClipDragPatch";
    if (!prototype || prototype[marker]) return false;
    const { clipDragStart, clipDrag, clipDragUpdate } = prototype;
    if ([clipDragStart, clipDrag, clipDragUpdate].some(method => typeof method !== "function")) return false;

    // CM3 runs a final drag update even on a click. The scroll position can
    // change during selection, so an unmoved pointer can map to another track.
    const presses = new WeakMap();
    const pointerEvent = event => event?.touches?.[0] ?? event ?? {};
    prototype.clipDragStart = function (event) {
      presses.delete(this);
      const result = clipDragStart.apply(this, arguments);
      const { pageX, pageY } = pointerEvent(event);
      if (result !== false && Number.isFinite(pageX) && Number.isFinite(pageY)) {
        presses.set(this, [pageX, pageY]);
      }
      return result;
    };
    prototype.clipDrag = function (event) {
      const press = presses.get(this);
      if (press) {
        const { pageX, pageY } = pointerEvent(event);
        if (press[0] !== pageX || press[1] !== pageY) presses.delete(this);
      }
      return clipDrag.apply(this, arguments);
    };
    prototype.clipDragUpdate = function () {
      if (!presses.has(this)) return clipDragUpdate.apply(this, arguments);
    };
    prototype[marker] = true;
    return true;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      PATCH_MARKER,
      ZOOM_MULTIPLIER,
      FRAME_TIME_FORMAT,
      TRIM_PATCH_MARKER,
      TRIM_STATE_KEY,
      MIN_HANDLE_WIDTH,
      MAX_HANDLE_WIDTH,
      HANDLE_WIDTH_RATIO,
      HANDLE_MAX_SHARE,
      applyTimelineDefaults,
      installTimelineDefaults,
      handleEdge,
      edgeHandle,
      handleWidthPx,
      trimBounds,
      resolveTrimDelta,
      collectTrimTargets,
      applyTrimDelta,
      updateMultiTrim,
      installTrimPatch,
      installClipDragPatch,
    };
    return;
  }

  const scope = global || {};
  installTimelineDefaults(
    scope.VE,
    scope.PZ && scope.PZ.ui,
    scope.ZOIDIUM_LAYOUT,
  );
  installTrimPatch(scope.PZ);
  installClipDragPatch(scope.PZ);
})(typeof window !== "undefined" ? window : null);
