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

  if (typeof module === "object" && module.exports) {
    module.exports = {
      PATCH_MARKER,
      ZOOM_MULTIPLIER,
      FRAME_TIME_FORMAT,
      applyTimelineDefaults,
      installTimelineDefaults,
    };
    return;
  }

  const scope = global || {};
  installTimelineDefaults(
    scope.VE,
    scope.PZ && scope.PZ.ui,
    scope.ZOIDIUM_LAYOUT,
  );
})(typeof window !== "undefined" ? window : null);
