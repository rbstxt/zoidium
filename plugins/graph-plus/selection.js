"use strict";
const { expressionOf } = require("./property-state.js");

// UI-only property identities. Nothing here writes project properties or history.
const controllers = new WeakMap();
const FOLLOW_KEY = "zoidium.graph-plus.follow-selection";
function readFollow(storage) {
  try { return storage?.getItem(FOLLOW_KEY) !== "false"; } catch (_error) { return true; }
}
function curvesFor(PZ, property) {
  const dynamic = PZ.property.dynamic;
  if (property instanceof dynamic.keyframes) return [property];
  if (property instanceof dynamic.group) return Array.from(property.objects || []).flatMap(child => curvesFor(PZ, child));
  return [];
}
function animatedCurves(PZ, objects) {
  const seen = new Set(), result = [];
  function visit(object) {
    if (!object || seen.has(object)) return;
    seen.add(object);
    if (object instanceof PZ.property.dynamic.keyframes) {
      if (expressionOf(object) || (object.animated && object.keyframes?.length)) result.push(object);
      return;
    }
    // CM3 children include property lists, nested materials, geometry and plugin lists.
    for (const child of object.children || []) visit(child);
    if (object instanceof PZ.property.dynamic.group) for (const child of object.objects || []) visit(child);
    if (Array.isArray(object) || (PZ.propertyList && object instanceof PZ.propertyList)) {
      for (const child of object) visit(child);
    }
  }
  for (const object of objects || []) visit(object);
  return result;
}
function sameSet(a, b) {
  return a.length === b.length && a.every(item => b.includes(item));
}
class Selection {
  constructor(PZ, storage) {
    this.PZ = PZ;
    this.storage = storage;
    this.follow = readFollow(storage);
    this.properties = [];
    this.objectSelection = [];
    this.curves = [];
    this.panels = new Set();
  }
  select(properties, additive = false, refresh = false) {
    const next = Array.from(new Set(additive ? [...this.properties, ...properties] : properties));
    if (sameSet(next, this.properties)) { if (refresh) this.sync(); return false; }
    this.properties = next;
    this.objectSelection = [];
    this.curves = Array.from(new Set(next.flatMap(property => curvesFor(this.PZ, property))));
    this.sync();
    return true;
  }
  objects(objects) {
    const next = Array.from(new Set(objects || []));
    const curves = animatedCurves(this.PZ, next);
    if (!this.properties.length && sameSet(next, this.objectSelection) && sameSet(curves, this.curves)) return;
    this.objectSelection = next;
    this.properties = [];
    this.curves = curves;
    this.sync();
  }
  setFollow(value) {
    this.follow = !!value;
    try { this.storage?.setItem(FOLLOW_KEY, String(this.follow)); } catch (_error) { /* Session preference still applies. */ }
    this.syncButtons();
    if (this.follow) this.sync();
  }
  syncButtons() {
    for (const panel of this.panels) {
      const button = panel._right.followBtn;
      button?.classList.toggle("on", this.follow);
      button?.setAttribute("aria-pressed", String(this.follow));
      if (button) button.title = this.follow ? "Follow selection: on" : "Follow selection: off (curves pinned)";
    }
  }
  attach(panel) {
    this.panels.add(panel);
    this.syncButtons();
    if (this.follow) this.apply(panel);
  }
  apply(panel) {
    const selection = panel._left.selection;
    if (sameSet(Array.from(selection), this.curves)) return false;
    // Suppress the graph's first-curve fit: fit once after the complete set.
    panel._right._didInitView = true;
    panel._right._hidden = {};
    selection.splice(0, selection.length, ...this.curves);
    if (panel._right.width > 1 && panel._right.height > 1) panel._right.fitAll(false);
    else panel._right._selectionFitPending = true;
    // The native picker only marks rows on pointer gestures. Reflect this
    // programmatic selection too, including hidden component rows.
    for (const row of panel._left.list?.querySelectorAll("li") || []) {
      row.classList.toggle("selected", this.curves.includes(row.pz_object));
    }
    return true;
  }
  sync() { if (this.follow) for (const panel of this.panels) this.apply(panel); }
  show(property, panel) {
    this.properties = [property];
    this.objectSelection = [];
    this.curves = curvesFor(this.PZ, property);
    this.apply(panel);
  }
  dispose() { this.panels.clear(); this.properties = []; this.objectSelection = []; this.curves = []; }
}
module.exports = { controllers, Selection, curvesFor, animatedCurves, sameSet, readFollow, FOLLOW_KEY };
