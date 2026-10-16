"use strict";
const titles = { group: "Group", rectangle: "Rectangle", ellipse: "Ellipse", polystar: "Polystar", path: "Path", fill: "Fill", stroke: "Stroke" };
function definitions(PZ, kind, vertexIds) {
  const T = PZ.property.type;
  const number = (name, value, extra) => ({ name, value, dynamic: true, type: T.NUMBER, step: 1, decimals: 2, ...extra });
  const vector = (name, value, type = T.VECTOR2) => ({ name, type, dynamic: true, group: true, objects: value.map((v, i) => number(name + "." + (type === T.COLOR ? "RGB" : "XY")[i], v)) });
  const list = (name, value, values) => ({ name, value, type: T.LIST, items: values.map(v => ({ name: v, value: v })) });
  const result = { name: { name: "Name", type: T.TEXT, value: titles[kind], visible: false }, enabled: { name: "Enabled", type: T.OPTION, value: 1, items: "off;on" } };
  if (kind === "group") Object.assign(result, { anchor: vector("Anchor", [0, 0]), position: vector("Position", [0, 0]), scale: vector("Scale", [1, 1]), rotation: number("Rotation", 0, { scaleFactor: Math.PI / 180 }), opacity: number("Opacity", 1, { min: 0, max: 1, step: .01 }) });
  if (["rectangle", "ellipse"].includes(kind)) Object.assign(result, { size: vector("Size", [200, 200]), position: vector("Position", [0, 0]) });
  if (kind === "rectangle") result.roundness = number("Roundness", 0, { min: 0 });
  if (kind === "polystar") Object.assign(result, {
    mode: list("Type", "star", ["star", "polygon"]), points: number("Points", 5, { min: 3, max: 128, decimals: 0 }), position: vector("Position", [0, 0]),
    innerRadius: number("Inner radius", 50, { min: 0 }), outerRadius: number("Outer radius", 100, { min: 0 }),
    innerRoundness: number("Inner roundness", 0, { min: 0, max: 100 }), outerRoundness: number("Outer roundness", 0, { min: 0, max: 100 }), rotation: number("Rotation", 0, { scaleFactor: Math.PI / 180 }),
  });
  if (kind === "path") {
    result.closed = { name: "Closed", type: T.OPTION, value: 1, items: "off;on" };
    const initial = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
    result.path = { name: "Path", type: T.NUMBER, dynamic: true, group: true, zoidiumControl: "shape-plus/path", objects: vertexIds.flatMap((id, i) => {
      const point = initial[i % 4];
      return ["X", "Y", "In X", "In Y", "Out X", "Out Y"].map((channel, j) => number(id + " " + channel, j < 2 ? point[j] : 0));
    }) };
  }
  if (["fill", "stroke"].includes(kind)) Object.assign(result, { color: vector("Color", [1, 1, 1], T.COLOR), opacity: number("Opacity", 1, { min: 0, max: 1, step: .01 }) });
  if (kind === "fill") result.fillRule = list("Fill rule", "nonzero", ["nonzero", "even-odd"]);
  if (kind === "stroke") Object.assign(result, { width: number("Width", 10, { min: 0 }), cap: list("Cap", "butt", ["butt", "round", "square"]), join: list("Join", "miter", ["miter", "round", "bevel"]), miterLimit: number("Miter limit", 4, { min: 1 }) });
  return result;
}
module.exports = { definitions, titles };
