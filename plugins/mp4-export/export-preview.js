"use strict";

// The export progress page shows the last finished frame, like a render queue
// viewer. The exporter already owns that frame, so the preview copies it with
// drawImage into a small canvas and never renders or reads back for itself.

const THROTTLE_MS = 400;
const MAX_PREVIEW_WIDTH = 480;
const ESTIMATE_MIN_FRAMES = 5;
const STORAGE_KEY = "zoidium.mp4Export.showPreview";

function defaultNow() {
  const performance = globalThis.performance;
  return performance && typeof performance.now === "function" ? performance.now() : Date.now();
}

function defaultStorage() {
  // Accessing localStorage can throw when storage is blocked by the browser.
  try {
    return globalThis.localStorage || null;
  } catch (_error) {
    return null;
  }
}

function formatClock(milliseconds, round) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = milliseconds / 1000;
  const totalSeconds = round ? Math.round(seconds) : Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0");
}

function estimateRemaining(framesRendered, totalFrames, elapsedMs) {
  if (!(framesRendered >= ESTIMATE_MIN_FRAMES)) return null;
  if (!(totalFrames > framesRendered) || !(elapsedMs > 0)) return null;
  return elapsedMs / framesRendered * (totalFrames - framesRendered);
}

function formatElapsed(elapsedMs) {
  return formatClock(elapsedMs, false);
}

function formatRemaining(remainingMs) {
  if (remainingMs === null || !Number.isFinite(remainingMs)) return "—";
  return formatClock(remainingMs, true);
}

function progressText(framesRendered, totalFrames, elapsedMs) {
  const total = Number.isFinite(totalFrames) && totalFrames > 0 ? Math.floor(totalFrames) : 0;
  const done = total > 0 && Number.isFinite(framesRendered) && framesRendered > 0
    ? Math.min(Math.floor(framesRendered), total) : 0;
  const percent = total > 0 ? Math.floor(done / total * 100) : 0;
  let remaining = estimateRemaining(done, total, elapsedMs);
  if (remaining === null && total > 0 && done >= total) remaining = 0;
  return percent + "% (" + done + " of " + total + ")  Elapsed " +
    formatElapsed(elapsedMs) + "  Remaining " +
    formatRemaining(remaining);
}

function readPreference(storage, key) {
  try {
    const value = storage && storage.getItem(key);
    if (value === null || value === undefined) return true;
    return value !== "0";
  } catch (_error) {
    return true;
  }
}

function writePreference(storage, key, enabled) {
  try {
    storage?.setItem(key, enabled ? "1" : "0");
  } catch (_error) {
    // A full or blocked storage area must not stop the export.
  }
}

function inactivePanel() {
  return {
    element: null,
    canvas: null,
    checkbox: null,
    status: null,
    isEnabled: () => false,
    setEnabled() {},
    update: () => false,
    updateProgress() {},
    dispose() {},
  };
}

function createPreviewPanel(config) {
  const options = config || {};
  const document = options.document ||
    (typeof globalThis.document !== "undefined" ? globalThis.document : null);
  if (!document) return inactivePanel();
  const now = options.now || defaultNow;
  const storage = Object.prototype.hasOwnProperty.call(options, "storage")
    ? options.storage : defaultStorage();
  const key = options.storageKey || STORAGE_KEY;
  const maxWidth = Number.isFinite(options.maxWidth) && options.maxWidth > 0
    ? Math.floor(options.maxWidth) : MAX_PREVIEW_WIDTH;

  const element = document.createElement("div");
  element.classList.add("proprow", "noselect");
  element.style.display = "flex";
  element.style.flexDirection = "column";
  element.style.alignItems = "stretch";
  element.style.padding = "6px 0";

  const frame = document.createElement("div");
  frame.style.display = "flex";
  frame.style.justifyContent = "center";
  frame.style.background = "#000";
  frame.style.padding = "6px";
  frame.style.minHeight = "24px";
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.maxWidth = maxWidth + "px";
  canvas.style.height = "auto";
  frame.appendChild(canvas);
  element.appendChild(frame);

  const toggleRow = document.createElement("div");
  toggleRow.classList.add("proprow", "noselect");
  const label = document.createElement("label");
  label.style.display = "flex";
  label.style.alignItems = "center";
  label.style.gap = "6px";
  label.style.cursor = "pointer";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  const toggleText = document.createElement("span");
  toggleText.textContent = "Show preview";
  label.appendChild(checkbox);
  label.appendChild(toggleText);
  toggleRow.appendChild(label);
  element.appendChild(toggleRow);

  const lineRow = document.createElement("div");
  lineRow.classList.add("proprow", "noselect");
  const status = document.createElement("span");
  status.style.whiteSpace = "normal";
  status.style.fontVariantNumeric = "tabular-nums";
  lineRow.appendChild(status);
  element.appendChild(lineRow);

  let enabled = readPreference(storage, key);
  let disposed = false;
  let lastDrawAt = -Infinity;
  let context = null;
  let contextChecked = false;

  function paintToggle() {
    checkbox.checked = enabled;
    frame.style.display = enabled ? "flex" : "none";
  }
  paintToggle();

  function setEnabled(value) {
    if (disposed) return;
    enabled = Boolean(value);
    paintToggle();
    writePreference(storage, key, enabled);
    if (!enabled) lastDrawAt = -Infinity;
  }

  checkbox.onchange = function previewToggleChanged() {
    setEnabled(checkbox.checked);
  };

  function targetContext() {
    if (contextChecked) return context;
    contextChecked = true;
    try {
      context = canvas.getContext("2d");
    } catch (_error) {
      context = null;
    }
    return context;
  }

  function update(source) {
    if (disposed || !enabled || !source) return false;
    // The preview may only copy frames the export already produced, and no
    // more often than the throttle allows.
    const time = now();
    if (!(time - lastDrawAt >= THROTTLE_MS)) return false;
    const width = Number(source.displayWidth || source.videoWidth || source.codedWidth || source.width || 0);
    const height = Number(source.displayHeight || source.videoHeight || source.codedHeight || source.height || 0);
    if (!(width > 0 && height > 0)) return false;
    lastDrawAt = time;
    const painter = targetContext();
    if (!painter) return false;
    try {
      const scale = Math.min(1, maxWidth / width);
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      painter.fillStyle = "#000";
      painter.fillRect(0, 0, targetWidth, targetHeight);
      painter.drawImage(source, 0, 0, targetWidth, targetHeight);
      return true;
    } catch (_error) {
      // A lost drawing buffer or a detached frame source must not stop the
      // export. The next frame tries again after the throttle interval.
      return false;
    }
  }

  function updateProgress(framesRendered, totalFrames, startedAt) {
    if (disposed) return;
    const elapsed = Number.isFinite(startedAt) ? now() - startedAt : 0;
    status.textContent = progressText(framesRendered, totalFrames, elapsed);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    enabled = false;
    try {
      checkbox.onchange = null;
    } catch (_error) {
      // Detached DOM nodes can reject handler assignment in test doubles.
    }
    if (context) {
      try {
        context.clearRect(0, 0, canvas.width, canvas.height);
      } catch (_error) {
        // Releasing the canvas below also releases its backing store.
      }
      context = null;
    }
    canvas.width = 1;
    canvas.height = 1;
    if (typeof element.remove === "function") element.remove();
    else element.parentElement?.removeChild?.(element);
    status.textContent = "";
  }

  return {
    element,
    canvas,
    checkbox,
    status,
    frame,
    isEnabled: () => enabled,
    setEnabled,
    update,
    updateProgress,
    dispose,
  };
}

module.exports = {
  THROTTLE_MS,
  MAX_PREVIEW_WIDTH,
  STORAGE_KEY,
  createPreviewPanel,
  estimateRemaining,
  formatElapsed,
  formatRemaining,
  progressText,
  readPreference,
  writePreference,
};
