"use strict";
const { parseJSON, parseColor, parseCurve, bakeGradient } = require("./bake.js");
function installTextureControls({ PZ, doc, register, curves, commit, rampControl }) {
  function node(tag, className) { const el = doc.createElement(tag); el.className = className || ""; return el; }
  function select(label, values, change) {
    const el = node("select", "pz-inputbox"); el.setAttribute("aria-label", label); el.title = label;
    for (const value of values) { const o = node("option"); o.value = value; o.textContent = value; el.append(o); }
    el.onchange = () => change(el.value); return el;
  }
  register("shader-plus/gradient", PZ.property.type.TEXT, property => {
    const box = node("div", "editbox zsp-box zsp-gradient"), anchor = node("span", "zsp-anchor"), host = node("div"), toolbar = node("div", "zsp-text-options");
    box.append(anchor, host, toolbar);
    const read = () => parseJSON(property.get());
    const write = patch => commit(anchor, property, JSON.stringify({ ...read(), ...patch }));
    const interpolation = select("Gradient interpolation", ["linear", "constant", "ease", "cardinal"], interpolation => write({ interpolation }));
    const space = select("Gradient color space", ["srgb", "linear", "oklab"], space => write({ space }));
    const cycleLabel = node("label", "zsp-inline"), cycle = node("input"); cycle.type = "checkbox"; cycle.setAttribute("aria-label", "Cyclic gradient"); cycle.onchange = () => write({ cyclic: cycle.checked });
    cycleLabel.append(cycle, doc.createTextNode("Cyclic")); toolbar.append(interpolation, space, cycleLabel);
    const selection = new Map(); let shown;
    box.pz_update = () => {
      if (property.get() === shown) return;
      shown = property.get(); const value = read();
      const stops = (value.stops || [{ position: 0, color: [0, 0, 0, 1] }, { position: 1, color: [1, 1, 1, 1] }]).map(s => [s.position, ...parseColor(s.color)]);
      const lut = bakeGradient(shown);
      const widget = rampControl({ document: doc, readOnly: !!property.definition.readOnly, selection, stops,
        interpolation: 3, sample(stops, t, mode, out) { for (let c = 0; c < 4; c++) out[c] = lut[Math.round(t * 255) * 4 + c] / 255; return out; },
        onChange: stops => write({ stops: stops.map(s => ({ position: s[0], color: s.slice(1) })) }),
      });
      host.replaceChildren(widget);
      interpolation.value = value.interpolation || "linear"; space.value = value.space || "srgb"; cycle.checked = !!value.cyclic;
      if (value.cyclic) {
        const ring = node("div", "zsp-ring"); ring.title = "Cyclic gradient"; ring.setAttribute("aria-label", "Cyclic gradient preview");
        ring.style.background = "conic-gradient(" + Array.from({ length: 33 }, (_, i) => {
          const at = Math.round(i / 32 * 255) * 4; return `rgba(${lut[at]},${lut[at + 1]},${lut[at + 2]},${lut[at + 3] / 255}) ${i / 32 * 100}%`;
        }).join(",") + ")"; host.append(ring);
      }
    };
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
