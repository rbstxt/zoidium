"use strict";
const { parseJSON, parseCurve } = require("./bake.js");
const { PRESETS, createGraphSampler, segmentHandles, moveHandle, movePointHandles } = require("./curve-math.js");

// Both Shader+ views use the Color Curves widget. Graph only selects its
// optional fill, range/axis labels and authoring toolbar.
function createCurveGraph(property, { doc, PZ, curves }) {
  const raw = () => parseJSON(property.get());
  const rgba = raw().channels === "rgba", graph = (property.definition.zoidiumShader?.editor || "graph") === "graph";
  const channels = [{ id: "composite", shortName: rgba ? "RGB" : "Y", name: rgba ? "RGB" : "Value" }];
  if (rgba) channels.push(...[["red", "R"], ["green", "G"], ["blue", "B"], ["alpha", "A"]].map(([id, shortName]) => ({ id, shortName, name: id })));
  const axis = property.definition.zoidiumShader?.axis;
  const names = Array.isArray(axis) && axis.length >= 2 ? axis.slice(0, 3).map(String) : typeof axis === "string" && axis.includes("/") ? axis.split("/").map(s => s.trim()).slice(0, 3) : ["0", "1"];
  return curves.createCurveControl(property, {
    document: doc, controls: PZ.ui.controls, PZ, channels,
    parseState: value => parseCurve(value, curves),
    createSampler: points => createGraphSampler(points, curves),
    serializeState: state => JSON.stringify({ ...raw(), ...state, points: state.composite }),
    handles: { get: segmentHandles, move: moveHandle, movePoint: movePointHandles },
    options: {
      filled: graph, tools: true, presets: PRESETS, axis: graph ? names : null,
      range: () => parseCurve(property.get(), curves).range,
      reset: channel => {
        const value = property.definition.zoidiumShader?.default ?? property.definition.value;
        return parseCurve(value, curves)[channel];
      },
    },
  });
}
module.exports = { createCurveGraph };
