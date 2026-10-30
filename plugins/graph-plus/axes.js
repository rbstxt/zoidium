"use strict";
const { expressionOf } = require("./property-state.js");
const COLORS = { X: "#ed6a68", Y: "#81c784", Z: "#64b5f6", W: "#c792ea",
  R: "#ed6a68", G: "#81c784", B: "#64b5f6", A: "#c792ea" };
function axisInfo(PZ, prop) {
  const parent = prop.parent?.parent;
  if (!(parent instanceof PZ.property.dynamic.group)) return null;
  const index = parent.objects.indexOf(prop);
  const suffix = String(prop.definition.name || "").split(".").pop().toUpperCase();
  const names = parent.definition.type === PZ.property.type?.COLOR ? ["R", "G", "B", "A"] : ["X", "Y", "Z", "W"];
  const axis = COLORS[suffix] ? suffix : names[index];
  return { parent, index, axis, color: COLORS[axis] };
}
module.exports = function ({ PZ, addrString }) {
  const proto = PZ.ui.graph.prototype;
  proto.axisInfo = function (prop) { return axisInfo(PZ, prop); };
  proto.pruneDetachedProperties = function () {
    const project = this.editor.project;
    if (!project?.addressLookup || !this.objects?.splice) return;
    for (const property of Array.from(this.objects)) {
      let live = false;
      try { live = project.addressLookup(property.getAddress()) === property; } catch (_error) { /* Deleted properties have no live address. */ }
      if (!live) this.objects.splice(this.objects.indexOf(property), 1);
    }
  };
  proto.editableGroups = function () {
    return this.propGroups().filter(g => !expressionOf(g.pz_object) && g.style.display !== "none" &&
      (!this._selectedAxes?.size || this._selectedAxes.has(g.pz_object)));
  };
  proto.selectAxes = function (groups, additive) {
    if (!additive) { this.deselectAllKeyframes(); this._selectedAxes = new Set(); }
    if (!this._selectedAxes) this._selectedAxes = new Set();
    for (const group of groups) this._selectedAxes.add(group.pz_object);
    for (const group of this.propGroups()) {
      group.style.display = this._selectedAxes.has(group.pz_object) ? "" : "none";
      this._hidden[addrString(group.pz_object)] = group.style.display === "none";
    }
    for (const group of groups) for (const key of group._keys.children) this.selectKeyframe(key);
    this.updateViewBox(); this.updateLegend(); this.updateStatus();
  };
  proto.timeKeys = function (keys) {
    if (!this.options.linkAxes) return keys;
    const result = new Set(keys);
    for (const key of keys) {
      const group = key.parentElement.parentElement;
      const info = this.axisInfo(group.pz_object);
      if (!info) continue;
      for (const sibling of this.propGroups()) {
        if (expressionOf(sibling.pz_object) || this.axisInfo(sibling.pz_object)?.parent !== info.parent) continue;
        for (const candidate of sibling._keys.children) if (candidate.pz_object.frame === key.pz_object.frame) result.add(candidate);
      }
    }
    return Array.from(result);
  };
};
module.exports.axisInfo = axisInfo;

module.exports.pasteKey = function (data, name, axis, singleDestination) {
  if (data[name]) return name;
  const keys = Object.keys(data);
  const match = axis && keys.find(key => key.split(".").pop().toUpperCase() === axis);
  return match || (singleDestination && keys.length === 1 ? keys[0] : null);
};
