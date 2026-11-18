"use strict";

// Easing+ curve text: the CSS `cubic-bezier(x1, y1, x2, y2)` syntax, a plain
// four-number list, or a JSON array of four numbers. Formatting and parsing are
// pure so the editor and the unit tests share them. The last copied values stay
// in memory for the running activation, so paste also works when the clipboard
// read is denied, as it can be in the desktop shell.

const NUMBER_SOURCE = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";

const CSS_PATTERN = new RegExp(
  "^cubic-bezier\\(\\s*(" +
    NUMBER_SOURCE +
    ")\\s*,\\s*(" +
    NUMBER_SOURCE +
    ")\\s*,\\s*(" +
    NUMBER_SOURCE +
    ")\\s*,\\s*(" +
    NUMBER_SOURCE +
    ")\\s*\\)$",
  "i"
);

const PLAIN_PATTERN = new RegExp(
  "^(" +
    NUMBER_SOURCE +
    ")(?:\\s*,\\s*|\\s+)(" +
    NUMBER_SOURCE +
    ")(?:\\s*,\\s*|\\s+)(" +
    NUMBER_SOURCE +
    ")(?:\\s*,\\s*|\\s+)(" +
    NUMBER_SOURCE +
    ")$"
);

let lastCurve = null;

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function roundValue(value) {
  return Number(Number(value).toFixed(4));
}

function validValues(values) {
  if (!Array.isArray(values) || values.length !== 4) return null;
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }
  // X stays inside the normalized interval, like the editor's handle drag.
  // Y is free so pasted overshoot survives.
  return [clampUnit(values[0]), values[1], clampUnit(values[2]), values[3]];
}

// CSS or plain text always yields strings; JSON yields numbers. Both entry
// points reject anything that is not finite after conversion.
function parseNumbers(groups) {
  const values = groups.map(Number);
  if (!values.every(Number.isFinite)) return null;
  return validValues(values);
}

function parseCurve(text) {
  if (typeof text !== "string") return null;
  const input = text.trim();
  if (!input) return null;
  if (input.startsWith("[")) {
    let data;
    try {
      data = JSON.parse(input);
    } catch (_error) {
      return null;
    }
    return validValues(data);
  }
  const match = CSS_PATTERN.exec(input) || PLAIN_PATTERN.exec(input);
  if (!match) return null;
  return parseNumbers(match.slice(1, 5));
}

function formatCurve(values) {
  if (!Array.isArray(values) || values.length !== 4) {
    throw new TypeError("Easing+ needs four curve values to format a curve.");
  }
  return `cubic-bezier(${values.map(roundValue).join(", ")})`;
}

function rememberCurve(values) {
  const normalized = validValues(values);
  if (!normalized) return null;
  lastCurve = normalized;
  return lastCurve.slice();
}

function rememberedCurve() {
  return lastCurve ? lastCurve.slice() : null;
}

function forgetRememberedCurve() {
  lastCurve = null;
}

function isEditableTarget(target) {
  return Boolean(
    target &&
      typeof target.closest === "function" &&
      target.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])"
      )
  );
}

// Ctrl/Cmd+C and Ctrl/Cmd+V only while the window has focus and no text or
// number field is being edited; a focused field keeps the native clipboard.
function shortcutFor(event) {
  if (!event || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
    return null;
  }
  const key = String(event.key || "").toLowerCase();
  if (key !== "c" && key !== "v") return null;
  if (isEditableTarget(event.target)) return null;
  return key;
}

module.exports = {
  parseCurve,
  formatCurve,
  rememberCurve,
  rememberedCurve,
  forgetRememberedCurve,
  isEditableTarget,
  shortcutFor,
};
