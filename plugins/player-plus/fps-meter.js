"use strict";

const KEY = "zoidium.player-plus.fps-meter";
function readEnabled(storage) {
  try { return storage?.getItem(KEY) === "true"; } catch (_error) { return false; }
}
function writeEnabled(storage, value) {
  try { storage?.setItem(KEY, String(value)); } catch (_error) { /* Keep the session setting. */ }
}
function createTracker() {
  let lastFrame = null, samples = [];
  function reset() { lastFrame = null; samples = []; }
  function sample(now, frame, target) {
    if (!Number.isFinite(frame) || !Number.isFinite(now) || !(target > 0)) return null;
    if (lastFrame === frame) return null;
    lastFrame = frame;
    samples.push(now);
    while (samples.length > 2 && now - samples[0] > 1000) samples.shift();
    if (samples.length < 3 || now <= samples[0]) return null;
    const fps = (samples.length - 1) * 1000 / (now - samples[0]);
    return { fps, notRealtime: fps < target * 0.95 };
  }
  return { sample, reset };
}
function createMeter(win) {
  const tracker = createTracker();
  let storage;
  try { storage = win.localStorage; } catch (_error) { storage = null; }
  let enabled = readEnabled(storage), element = null, lastUpdate = 0;
  function hide() { tracker.reset(); if (element) element.hidden = true; }
  function setEnabled(value) { enabled = value; writeEnabled(storage, value); if (!value) hide(); }
  function sample(viewport) {
    if (!enabled || viewport.editor?.mainViewport !== viewport) return;
    const playback = viewport.editor?.playback;
    if (!playback?.speed || viewport.renderMode || viewport.__zoidiumPlayerPlusPaused) { hide(); return; }
    const target = Number(playback.frameRate);
    const now = win.performance.now();
    const result = tracker.sample(now, viewport.lastFrame, target);
    if (!result || now - lastUpdate < 200) return;
    lastUpdate = now;
    if (!element) {
      element = win.document.createElement("div");
      element.className = "zoidium-fps-meter";
      Object.assign(element.style, { position: "fixed", zIndex: "1000", pointerEvents: "none", padding: "4px 6px", background: "rgba(0,0,0,.75)", color: "white", font: "12px monospace", whiteSpace: "nowrap" });
      win.document.body.appendChild(element);
    }
    const rect = viewport.canvas.getBoundingClientRect();
    element.style.left = rect.left + 6 + "px";
    element.style.top = rect.top + 6 + "px";
    element.style.color = result.notRealtime ? "#ff6060" : "white";
    element.textContent = result.fps.toFixed(2) + " / " + target + " fps" + (result.notRealtime ? " (not realtime)" : "");
    element.hidden = false;
  }
  return { sample, hide, setEnabled, get enabled() { return enabled; }, dispose() { element?.remove(); element = null; } };
}
module.exports = { readEnabled, writeEnabled, createTracker, createMeter };
