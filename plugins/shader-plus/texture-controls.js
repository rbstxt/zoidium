"use strict";
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
    const anchor = box.firstElementChild, toolbar = node("div", "zsp-text-options"); box.append(toolbar);
    const write = patch => commit(anchor, property, JSON.stringify({ ...read(), ...patch }));
    const interpolation = select("Gradient interpolation", ["linear", "constant", "ease", "cardinal"], interpolation => write({ interpolation }));
    const space = select("Gradient color space", ["srgb", "linear", "oklab"], space => write({ space }));
    const cycleLabel = node("label", "zsp-inline"), cycle = node("input"); cycle.type = "checkbox"; cycle.setAttribute("aria-label", "Cyclic gradient"); cycle.onchange = () => write({ cyclic: cycle.checked });
    cycleLabel.append(cycle, doc.createTextNode("Cyclic")); toolbar.append(interpolation, space, cycleLabel);
    const interpolate = node("input"); interpolate.type = "checkbox"; interpolate.setAttribute("aria-label", "Interpolate");
    interpolate.onchange = () => write({ interpolation: interpolate.checked ? "linear" : "constant" });
    const interpolateLabel = node("label", "zsp-inline"); interpolateLabel.append(interpolate, doc.createTextNode("Interpolate")); toolbar.append(interpolateLabel);
    const repetitions = node("input", "pz-inputbox"); repetitions.type = "number"; repetitions.min = 1; repetitions.step = "any"; repetitions.setAttribute("aria-label", "Cycle repetitions"); repetitions.title = "Cycle repetitions";
    repetitions.onchange = () => { const n = Number(repetitions.value); if (Number.isFinite(n) && n >= 1) write({ repetitions: n }); };
    const repsLabel = node("label", "zsp-inline"); repsLabel.append(doc.createTextNode("Cycle repetitions"), repetitions); toolbar.append(repsLabel);
    const update = box.pz_update;
    box.pz_update = () => { update(); const value = read(); interpolation.value = value.interpolation || "linear"; space.value = value.space || "srgb"; cycle.checked = !!value.cyclic; repsLabel.hidden = !value.cyclic; interpolateLabel.hidden = !value.cyclic; interpolate.checked = value.interpolation !== "constant"; if (doc.activeElement !== repetitions) repetitions.value = value.repetitions || 1; };
    box.pz_update(); return box;
  });
  register("shader-plus/curve", PZ.property.type.TEXT, property => {
    const raw = () => parseJSON(property.get());
    const root = node("div", "editbox zsp-box zsp-curve"), host = node("div"), anchor = node("span", "zsp-anchor"), toolbar = node("div", "zsp-text-options");
    root.append(anchor, host, toolbar);
    let widget, shownChannels;
    function build() {
      const rgba = raw().channels === "rgba";
      root.classList.toggle("zsp-curve-rgba", rgba);
      const channels = [{ id: "composite", shortName: rgba ? "RGB" : "Y", name: rgba ? "RGB" : "Value" }];
      if (rgba) channels.push(...[["red", "R"], ["green", "G"], ["blue", "B"], ["alpha", "A"]].map(([id, shortName]) => ({ id, shortName, name: id })));
      widget = curves.createCurveControl(property, { document: doc, controls: PZ.ui.controls, PZ, channels,
        parseState: value => parseCurve(value, curves),
        serializeState: state => JSON.stringify({ ...raw(), ...state, points: state.composite }),
      });
      host.replaceChildren(widget); shownChannels = raw().channels;
    }
    const write = patch => commit(anchor, property, JSON.stringify({ ...raw(), ...patch }));
    const channel = select("Curve channels", ["single", "rgba"], channels => write({ channels })); toolbar.append(channel);
    const ranges = ["Curve minimum", "Curve maximum"].map((label, i) => {
      const input = node("input", "pz-inputbox"); input.type = "number"; input.step = "any"; input.title = label; input.setAttribute("aria-label", label);
      input.onchange = () => { const range = parseCurve(property.get(), curves).range.slice(); const value = Number(input.value); if (Number.isFinite(value)) { range[i] = value; write({ range }); } }; toolbar.append(input); return input;
    });
    root.pz_update = () => {
      if (!widget || shownChannels !== raw().channels) build();
      widget.pz_update(); const state = parseCurve(property.get(), curves); channel.value = state.channels;
      ranges.forEach((input, i) => { if (doc.activeElement !== input) input.value = state.range[i]; });
    };
    root.pz_update(); return root;
  });
}
module.exports = { installTextureControls };
