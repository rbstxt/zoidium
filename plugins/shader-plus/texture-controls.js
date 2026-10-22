"use strict";
const { createGraphSampler } = require("./curve-math.js");
const { createCurveGraph } = require("./curve-graph.js");
const { parseJSON, parseCurve, bakeGradient } = require("./bake.js");
function installTextureControls({ PZ, doc, register, curves, commit }) {
  function node(tag, className) { const el = doc.createElement(tag); el.className = className || ""; return el; }
  function select(label, values, change) {
    const el = node("select", "pz-inputbox"); el.setAttribute("aria-label", label); el.title = label;
    for (const value of values) { const o = node("option"); o.value = value; o.textContent = value; el.append(o); }
    el.onchange = () => change(el.value); return el;
  }
  register("shader-plus/gradient", PZ.property.type.TEXT, property => {
    const read = () => parseJSON(property.get());
    const box = window.ZoidiumGradientEditor.propertyControl(property, {
      advanced: true, read, bake: value => bakeGradient(value.stops, value),
      write: value => property.set(JSON.stringify(value)),
    });
    box.classList.add("zsp-box", "zsp-gradient");
    // Gradient settings use the same labeled field grid as Text rows.
    const anchor = box.firstElementChild, grid = node("div", "zsp-fields zsp-gradient-fields"); box.append(grid);
    const write = patch => commit(anchor, property, JSON.stringify({ ...read(), ...patch }));
    function labeled(label, control) {
      const name = node("span", "zsp-field-label"); name.textContent = label;
      control.setAttribute("aria-label", label); grid.append(name, control); return [name, control];
    }
    const [, interpolation] = labeled("Blend", select("Gradient interpolation", ["linear", "constant", "ease", "cardinal"], interpolation => write({ interpolation })));
    const [, space] = labeled("Space", select("Gradient color space", ["srgb", "linear", "oklab"], space => write({ space })));
    const [, cycle] = labeled("Cyclic", select("Cyclic gradient", ["off", "on"], value => write({ cyclic: value === "on" })));
    const repetitions = node("input", "pz-inputbox"); repetitions.type = "number"; repetitions.min = 1; repetitions.step = "any"; repetitions.title = "Cycle repetitions";
    repetitions.onchange = () => { const n = Number(repetitions.value); if (Number.isFinite(n) && n >= 1) write({ repetitions: n }); };
    const repsLabel = labeled("Repeat", repetitions);
    for (const el of [interpolation, space, cycle]) el.classList.add("zsp-option");
    const update = box.pz_update;
    box.pz_update = () => { update(); const value = read(); interpolation.value = value.interpolation || "linear"; space.value = value.space || "srgb"; cycle.value = value.cyclic ? "on" : "off"; for (const el of repsLabel) el.hidden = !value.cyclic; if (doc.activeElement !== repetitions) repetitions.value = value.repetitions || 1; };
    box.pz_update(); return box;
  });
  register("shader-plus/curve", PZ.property.type.TEXT, property => {
    const raw = () => parseJSON(property.get());
    const root = node("div", "editbox zsp-box zsp-curve"), host = node("div"), anchor = node("span", "zsp-anchor"), toolbar = node("div", "zsp-text-options");
    root.append(anchor, host, toolbar);
    let widget, shownChannels, shownStyle;
    function build() {
      const rgba = raw().channels === "rgba";
      root.classList.toggle("zsp-curve-rgba", rgba);
      const style = property.definition.zoidiumShader?.editor || "graph";
      if (!rgba && style === "graph") {
        widget?.dispose?.(); widget = createCurveGraph(property, { doc, PZ, curves }); host.replaceChildren(widget);
        shownChannels = raw().channels; shownStyle = style; return;
      }
      const channels = [{ id: "composite", shortName: rgba ? "RGB" : "Y", name: rgba ? "RGB" : "Value" }];
      if (rgba) channels.push(...[["red", "R"], ["green", "G"], ["blue", "B"], ["alpha", "A"]].map(([id, shortName]) => ({ id, shortName, name: id })));
      widget?.dispose?.();
      widget = curves.createCurveControl(property, { document: doc, controls: PZ.ui.controls, PZ, channels,
        parseState: value => parseCurve(value, curves), createSampler: points => createGraphSampler(points, curves),
        serializeState: state => JSON.stringify({ ...raw(), ...state, points: state.composite }),
      });
      host.replaceChildren(widget); shownChannels = raw().channels; shownStyle = style;
    }
    const write = patch => commit(anchor, property, JSON.stringify({ ...raw(), ...patch }));
    const channel = select("Curve channels", ["single", "rgba"], channels => write({ channels })); toolbar.append(channel);
    const ranges = ["Curve minimum", "Curve maximum"].map((label, i) => {
      const input = node("input", "pz-inputbox"); input.type = "number"; input.step = "any"; input.title = label; input.setAttribute("aria-label", label);
      input.onchange = () => { const range = parseCurve(property.get(), curves).range.slice(); const value = Number(input.value); if (Number.isFinite(value)) { range[i] = value; write({ range }); } }; toolbar.append(input); return input;
    });
    root.pz_update = () => {
      if (!widget || shownChannels !== raw().channels || shownStyle !== (property.definition.zoidiumShader?.editor || "graph")) build();
      widget.pz_update(); const state = parseCurve(property.get(), curves); channel.value = state.channels;
      ranges.forEach((input, i) => { if (doc.activeElement !== input) input.value = state.range[i]; });
    };
    root.pz_update(); return root;
  });
}
module.exports = { installTextureControls };
