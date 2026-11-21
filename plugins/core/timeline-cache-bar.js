(function installTimelineCacheBar(global) {
  "use strict";

  function createBar(win, timeline, cache) {
    const canvas = win.document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, { position: "absolute", top: "0", left: "0", height: "3px", width: "100%", pointerEvents: "none", zIndex: "2" });
    timeline.timerule.appendChild(canvas);
    let pending = null, last = "", disposed = false;
    function draw() {
      pending = null;
      if (disposed) return;
      const width = timeline.timerule.clientWidth;
      canvas.width = width;
      canvas.height = 3;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, width, 3);
      context.fillStyle = "#53c86b";
      const scroll = timeline.scrollBar.scrollLeft;
      for (const [start, end] of cache.ranges(timeline.editor.mainViewport)) {
        const left = Math.max(0, timeline.frameToPx(start) - scroll);
        const right = Math.min(width, timeline.frameToPx(end) - scroll);
        if (right > left) context.fillRect(left, 0, right - left, 3);
      }
    }
    function schedule() {
      if (timeline.el?.isConnected === false) { dispose(); return; }
      if (!disposed && pending === null) pending = win.requestAnimationFrame(draw);
    }
    const unsubscribe = cache.subscribe(schedule);
    function update() {
      const key = [timeline.timerule.clientWidth, timeline.scrollBar.scrollLeft, timeline.zoom,
        timeline.editor.playback?.frameRate].join(":");
      if (key !== last) { last = key; schedule(); }
    }
    schedule();
    function dispose() { disposed = true; unsubscribe(); if (pending !== null) win.cancelAnimationFrame(pending); canvas.remove(); }
    return { update, dispose };
  }

  if (typeof module === "object" && module.exports) { module.exports = { createBar }; return; }
  const prototype = global.PZ?.ui?.timeline?.prototype;
  if (!prototype || typeof prototype.update !== "function") return;
  const original = prototype.update;
  prototype.update = function () {
    if (!this.__zoidiumCacheBar && this.timerule && global.ZoidiumFrameCache) {
      this.__zoidiumCacheBar = createBar(global, this, global.ZoidiumFrameCache);
    }
    this.__zoidiumCacheBar?.update();
    return original.apply(this, arguments);
  };
})(typeof window !== "undefined" ? window : globalThis);
