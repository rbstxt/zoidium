"use strict";
// Objects panel hints that make AE paint scope visible: a color swatch on
// fill/stroke rows and dim text on rows that draw nothing. Pure helpers are
// exported for tests; createHints() owns the row decorations and one
// requestAnimationFrame loop that runs only while decorated rows exist.
const { GEOMETRY, PAINTS, paintScope } = require("./contents-ops.js");
const { stops } = require("./paint.js");
const RULE = "A fill or stroke draws the paths above it in the same group.";
const NO_PAINT = "no fill or stroke", NO_PATHS = "no paths above";
const HINT_STYLE = "color:#7d7d7d;margin-left:6px;font-size:11px;white-space:nowrap;pointer-events:none";
const SWATCH_STYLE = "display:inline-block;box-sizing:border-box;width:10px;height:10px;margin-left:6px;vertical-align:middle;pointer-events:none;";
const valueOf = property => property && typeof property.get === "function" ? property.get() : property;
// Live Content objects or plain contents -> the minimal plain tree that
// paintScope reads. Its JSON is the structural signature: ids, kinds,
// enabled flags, nesting and order, but no animated values.
function outline(items) {
  return Array.from(items || [], item => {
    const node = { id: item.id, kind: item.kind, properties: { enabled: valueOf(item.properties?.enabled) === 0 ? 0 : 1 } };
    if (item.contents) node.contents = outline(item.contents);
    return node;
  });
}
function hintFor(scope, item) {
  const entry = scope.get(item.id);
  if (!entry?.enabled) return "";
  if (GEOMETRY.includes(item.kind)) return entry.painted ? "" : NO_PAINT;
  if (PAINTS.includes(item.kind)) return entry.paths ? "" : NO_PATHS;
  return "";
}
const channel = value => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255);
const rgb = color => "rgb(" + [0, 1, 2].map(i => channel(color[i])).join(",") + ")";
function gradientCss(value) {
  const list = stops(value);
  return "linear-gradient(90deg," + list.map(([position, color]) =>
    "rgba(" + [0, 1, 2].map(i => channel(color[i])).join(",") + "," + +color[3].toFixed(3) + ") " + +(position * 100).toFixed(2) + "%").join(",") + ")";
}
// Fill: solid square. Stroke: hollow ring; the inset outline draws the 1px
// black edge over the colored 3px border, leaving a 2px colored ring.
function swatchStyle(kind, value) {
  const gradient = kind === "gradientFill" || kind === "gradientStroke";
  const paint = gradient ? gradientCss(value) : rgb(value);
  if (kind === "fill" || kind === "gradientFill") return SWATCH_STYLE + "border:1px solid #000;background:" + paint;
  return SWATCH_STYLE + (gradient ? "border:3px solid transparent;border-image:" + paint + " 1" : "border:3px solid " + paint) +
    ";background:transparent;outline:1px solid #000;outline-offset:-1px";
}
function createHints({ PZ, Layer, Content, document, view = document.defaultView }) {
  const rows = new Map(), cache = new WeakMap();
  let handle = 0;
  function layerOf(object) {
    for (let node = object, depth = 0; node && depth < 64; depth++, node = node.parent ? node.parentObject : null)
      if (node instanceof Layer) return node;
    return null;
  }
  function localFrame(layer) {
    let clip = null;
    try { clip = layer.tryGetParentOfType(PZ.clip); } catch (_error) { /* Detached layer. */ }
    return (view.CM?.playback?.currentFrame || 0) - (clip?.start || 0) + (clip?.offset || 0);
  }
  function layerState(layer) {
    const plain = outline(layer.contents), signature = JSON.stringify(plain);
    let entry = cache.get(layer);
    if (!entry || entry.signature !== signature) cache.set(layer, entry = { signature, scope: paintScope(plain) });
    return { scope: entry.scope, frame: localFrame(layer) };
  }
  function update(entry, state) {
    const { content, hint, swatch, cell } = entry;
    const text = hintFor(state.scope, content);
    if (entry.text !== text) {
      entry.text = text; hint.textContent = text;
      if (text) cell.title = RULE; else cell.removeAttribute("title");
    }
    if (!swatch) return;
    let css = null;
    try {
      const property = content.kind.startsWith("gradient") ? content.properties.stops : content.properties.color;
      css = swatchStyle(content.kind, property.get(state.frame));
    } catch (_error) { /* Keep the last valid swatch while a value is incomplete. */ }
    // Native rename resets every child's display; restore the inline block.
    if (css && (entry.css !== css || swatch.style.display !== "inline-block")) { entry.css = css; swatch.style.cssText = css; }
  }
  function tick() {
    handle = 0;
    const states = new Map();
    for (const [row, entry] of rows) {
      if (!row.isConnected || row.classList.contains("editing")) continue;
      const layer = layerOf(entry.content);
      if (!layer) continue;
      if (!states.has(layer)) states.set(layer, layerState(layer));
      update(entry, states.get(layer));
    }
    schedule();
  }
  function schedule() { if (!handle && rows.size) handle = view.requestAnimationFrame(tick); }
  function attach(row, content) {
    if (!(content instanceof Content) || rows.has(row)) return;
    const cell = row.firstElementChild, name = cell?.querySelector("span");
    if (!name) return;
    const hint = document.createElement("span");
    hint.className = "shape-plus-scope-hint"; hint.style.cssText = HINT_STYLE;
    let swatch = null;
    if (PAINTS.includes(content.kind)) {
      swatch = document.createElement("span");
      swatch.className = "shape-plus-paint-swatch"; swatch.setAttribute("aria-hidden", "true");
      name.after(swatch, hint);
    } else name.after(hint);
    rows.set(row, { content, hint, swatch, cell, text: "", css: "" });
    schedule();
  }
  function detach(row) {
    rows.delete(row);
    if (!rows.size && handle) { view.cancelAnimationFrame(handle); handle = 0; }
  }
  function dispose() {
    if (handle) view.cancelAnimationFrame(handle);
    handle = 0; rows.clear();
  }
  return { attach, detach, dispose, tick, get size() { return rows.size; } };
}
module.exports = { RULE, NO_PAINT, NO_PATHS, outline, hintFor, swatchStyle, gradientCss, createHints };
