"use strict";
const { lengthTable } = require("./path.js");
const { at, widthAt, dash } = require("./operators.js");
function profile(paths, style) {
  const variable =
    style.startLength > 0 || style.endLength > 0 || style.waveAmount > 0;
  if (!variable) return dash(paths, style);
  let samples = 0;
  return dash(paths, style).map((path) => {
    const table = lengthTable(path.points, path.closed),
      total = path.totalLength ?? table.total;
    if (total < 1e-9)
      return {
        ...path,
        widths: path.points.map(() => widthAt(0, total, style)),
      };
    const points = [],
      widths = [];
    const cycles =
      style.waveUnits === "length"
        ? total / Math.max(0.01, style.wavelength)
        : (style.waveCycles ?? 1);
    const step = total / Math.max(128, Math.ceil(cycles * 32));
    if (!(step > 0) || total / step > 4096)
      throw Error("Shape+ width profile budget exceeded");
    for (let i = 1; i < table.lengths.length; i++) {
      const a = table.lengths[i - 1],
        b = table.lengths[i],
        count = Math.max(1, Math.ceil((b - a) / step));
      for (let j = 0; j < count; j++) {
        const s = a + ((b - a) * j) / count;
        const domain = path.distances
          ? path.distances[i - 1] +
            ((path.distances[i] - path.distances[i - 1]) * j) / count
          : s;
        points.push(at(path, s, table));
        widths.push(
          widthAt(domain > total ? domain % total : domain, total, style),
        );
        if (points.length > 4096 || ++samples > 16384)
          throw Error("Shape+ width profile budget exceeded");
      }
    }
    if (!path.closed) {
      points.push(path.points.at(-1));
      widths.push(widthAt(path.distances?.at(-1) ?? total, total, style));
    }
    return { ...path, points, widths };
  });
}
module.exports = { profile };
