"use strict";
const { parsePath } = require("./svg-path.js");
const { multiply } = require("./compiler-procedural.js");
const { validate } = require("./model.js");
const d = (value) => ({
  animated: false,
  keyframes: [{ frame: 0, value, tween: 1 }],
});
const identity = [1, 0, 0, 1, 0, 0];
function numbers(text) {
  const tokens = String(text)
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const result = tokens.map(Number);
  if (!result.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6))
    throw Error("Invalid SVG number");
  return result;
}
function transform(text = "") {
  let result = identity.slice(),
    end = 0,
    count = 0;
  for (const match of text.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    if (!/^[\s,]*$/.test(text.slice(end, match.index)) || ++count > 64)
      throw Error("Invalid SVG transform");
    const p = numbers(match[2]);
    let m;
    if (match[1] === "matrix" && p.length === 6) m = p;
    else if (match[1] === "translate" && p.length >= 1 && p.length <= 2)
      m = [1, 0, 0, 1, p[0], p[1] || 0];
    else if (match[1] === "scale" && p.length >= 1 && p.length <= 2)
      m = [p[0], 0, 0, p[1] ?? p[0], 0, 0];
    else if (match[1] === "rotate" && [1, 3].includes(p.length)) {
      const a = (p[0] * Math.PI) / 180,
        c = Math.cos(a),
        s = Math.sin(a),
        x = p[1] || 0,
        y = p[2] || 0;
      m = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
    } else if (["skewX", "skewY"].includes(match[1]) && p.length === 1) {
      const t = Math.tan((p[0] * Math.PI) / 180);
      m = match[1] === "skewX" ? [1, 0, t, 1, 0, 0] : [1, t, 0, 1, 0, 0];
    } else throw Error("Unsupported SVG transform");
    result = multiply(result, m);
    end = match.index + match[0].length;
    if (!result.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6))
      throw Error("SVG transform budget exceeded");
  }
  if (!/^[\s,]*$/.test(text.slice(end))) throw Error("Invalid SVG transform");
  return result;
}
function pathItem(path, nextId) {
  return {
    kind: "path",
    id: nextId(),
    vertexIds: path.vertices.map(() => nextId()),
    vertexModes: {},
    properties: {
      closed: path.closed ? 1 : 0,
      path: d(path.vertices.flatMap((v) => [...v.point, ...v.in, ...v.out])),
    },
  };
}
function affineGroup(contents, m, nextId, opacity = 1, name = "SVG") {
  // SVD expresses any affine matrix as two native rotations and a signed
  // nonuniform scale. Keeping transforms as groups also preserves strokes.
  const [a, b, c, e, x, y] = m,
    aa = a * a + b * b,
    bb = c * c + e * e,
    ab = a * c + b * e;
  const theta = 0.5 * Math.atan2(2 * ab, aa - bb),
    v = [Math.cos(theta), Math.sin(theta)];
  const u = [a * v[0] + c * v[1], b * v[0] + e * v[1]],
    s1 = Math.hypot(...u),
    det = a * e - b * c;
  const s2 = s1 ? det / s1 : 0,
    rotation = s1 ? Math.atan2(u[1], u[0]) : 0;
  const inner = {
    kind: "group",
    id: nextId(),
    properties: { rotation: d(-theta) },
    contents,
  };
  return {
    kind: "group",
    id: nextId(),
    properties: {
      name,
      position: d([x, y]),
      rotation: d(rotation),
      scale: d([s1, s2]),
      opacity: d(opacity),
    },
    contents: [inner],
  };
}
function color(text) {
  const names = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    green: "#008000",
    blue: "#0000ff",
    yellow: "#ffff00",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    orange: "#ffa500",
    purple: "#800080",
    gray: "#808080",
    grey: "#808080",
    transparent: "#00000000",
  };
  text = names[text.toLowerCase()] || text;
  if (/^#[0-9a-f]{3,4}$/i.test(text))
    text =
      "#" +
      text
        .slice(1)
        .split("")
        .map((v) => v + v)
        .join("");
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(text))
    return [
      parseInt(text.slice(1, 3), 16) / 255,
      parseInt(text.slice(3, 5), 16) / 255,
      parseInt(text.slice(5, 7), 16) / 255,
      text.length === 9 ? parseInt(text.slice(7, 9), 16) / 255 : 1,
    ];
  const match = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (match) {
    const parts = match[1].split(/\s*,\s*/);
    if (![3, 4].includes(parts.length)) throw Error("Unsupported SVG color");
    return parts
      .map((v, i) => {
        const n = Number(v.replace(/%$/, ""));
        if (!Number.isFinite(n)) throw Error("Invalid SVG color");
        return Math.max(
          0,
          Math.min(1, n / (v.endsWith("%") ? 100 : i < 3 ? 255 : 1)),
        );
      })
      .concat(parts.length === 3 ? [1] : []);
  }
  throw Error("Unsupported SVG color: " + text);
}
const styleKeys = new Set([
  "fill",
  "stroke",
  "fill-rule",
  "fill-opacity",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "display",
  "visibility",
]);
function style(attributes, inherited = {}) {
  const result = { ...inherited };
  delete result.opacity;
  for (const key of styleKeys)
    if (attributes[key] !== undefined) result[key] = attributes[key];
  for (const declaration of (attributes.style || "").split(";")) {
    if (!declaration.trim()) continue;
    const i = declaration.indexOf(":"),
      key = declaration.slice(0, i).trim(),
      value = declaration.slice(i + 1).trim();
    if (i < 0 || !styleKeys.has(key))
      throw Error("Unsupported SVG style: " + key);
    result[key] = value;
  }
  return result;
}
function shapePath(tag, a) {
  const n = (key, fallback = 0) =>
    a[key] === undefined ? fallback : numbers(a[key])[0];
  if (tag === "path") return a.d || "";
  if (tag === "polygon" || tag === "polyline") {
    const p = numbers(a.points || "");
    if (p.length % 2 || p.length < 4) throw Error("Invalid SVG points");
    return (
      "M" +
      p.slice(0, 2).join(" ") +
      " L" +
      p.slice(2).join(" ") +
      (tag === "polygon" ? " Z" : "")
    );
  }
  if (tag === "circle" || tag === "ellipse") {
    const x = n("cx"),
      y = n("cy"),
      rx = tag === "circle" ? n("r") : n("rx"),
      ry = tag === "circle" ? rx : n("ry");
    if (rx < 0 || ry < 0) throw Error("Invalid SVG radius");
    return `M${x - rx} ${y} A${rx} ${ry} 0 1 0 ${x + rx} ${y} A${rx} ${ry} 0 1 0 ${x - rx} ${y} Z`;
  }
  if (tag === "rect") {
    const x = n("x"),
      y = n("y"),
      w = n("width"),
      h = n("height"),
      rx = Math.min(w / 2, n("rx", n("ry"))),
      ry = Math.min(h / 2, n("ry", rx));
    if (w < 0 || h < 0 || rx < 0 || ry < 0)
      throw Error("Invalid SVG rectangle");
    if (!rx || !ry) return `M${x} ${y} h${w} v${h} h${-w} Z`;
    return `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
  }
  throw Error("Unsupported SVG element: " + tag);
}
function parseXML(text) {
  if (/<!|<\?(?!xml\s)/i.test(text))
    throw Error("SVG declarations and entities are not supported");
  const root = { tag: "root", attributes: {}, children: [] },
    stack = [root];
  let count = 0,
    end = 0;
  for (const match of text.matchAll(/<[^>]*>/g)) {
    if (text.slice(end, match.index).trim())
      throw Error("SVG text content is not supported");
    end = match.index + match[0].length;
    const token = match[0];
    if (/^<\?xml\s[^?]*\?>$/.test(token)) continue;
    const close = /^<\/([\w:-]+)\s*>$/.exec(token);
    if (close) {
      if (stack.length === 1 || stack.pop().tag !== close[1])
        throw Error("Malformed SVG nesting");
      continue;
    }
    const open = /^<([\w:-]+)([\s\S]*?)(\/?)>$/.exec(token);
    if (!open || ++count > 512 || stack.length > 16)
      throw Error("SVG element budget exceeded");
    const attributes = Object.create(null);
    let attrEnd = 0;
    for (const attr of open[2].matchAll(
      /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    )) {
      if (
        open[2].slice(attrEnd, attr.index).trim() ||
        Object.hasOwn(attributes, attr[1])
      )
        throw Error("Malformed SVG attribute");
      let value = attr[2] ?? attr[3];
      if (value.includes("&")) throw Error("SVG entities are not supported");
      if (
        /^on/i.test(attr[1]) ||
        /(?:href|src)$/i.test(attr[1]) ||
        /url\s*\(/i.test(value)
      )
        throw Error("Active or external SVG content is not supported");
      attributes[attr[1]] = value;
      attrEnd = attr.index + attr[0].length;
    }
    if (open[2].slice(attrEnd).trim()) throw Error("Malformed SVG attributes");
    const node = { tag: open[1], attributes, children: [] };
    stack.at(-1).children.push(node);
    if (!open[3]) stack.push(node);
  }
  if (
    stack.length !== 1 ||
    text.slice(end).trim() ||
    root.children.length !== 1 ||
    root.children[0].tag !== "svg"
  )
    throw Error("Expected one complete SVG document");
  return root.children[0];
}
function importSVG(text, nextId) {
  if (typeof text !== "string" || text.length > 262144)
    throw Error("SVG text budget exceeded");
  let sequence = 0;
  nextId = nextId || (() => "svg-" + ++sequence);
  if (!text.trim().startsWith("<"))
    return [
      affineGroup(
        [
          ...parsePath(text).map((path) => pathItem(path, nextId)),
          { kind: "fill", id: nextId(), properties: { color: d([1, 1, 1]) } },
        ],
        [1, 0, 0, -1, 0, 0],
        nextId,
        1,
        "SVG path",
      ),
    ];
  const root = parseXML(text.trim());
  function visit(node, inherited = {}) {
    const a = node.attributes,
      s = style(a, inherited),
      opacity = Number(s.opacity ?? 1);
    const allowed = new Set([
      ...styleKeys,
      "id",
      "xmlns",
      "version",
      "viewBox",
      "width",
      "height",
      "transform",
      "style",
      "d",
      "x",
      "y",
      "cx",
      "cy",
      "r",
      "rx",
      "ry",
      "points",
    ]);
    for (const key of Object.keys(a))
      if (!allowed.has(key)) throw Error("Unsupported SVG attribute: " + key);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw Error("Invalid SVG opacity");
    if (s.display === "none" || s.visibility === "hidden") return [];
    const m = transform(a.transform);
    let contents;
    if (node.tag === "svg" || node.tag === "g") {
      contents = node.children.flatMap((child) => visit(child, s));
      // Reverse only painted siblings: CM3 contents paint bottom to top.
      contents.reverse();
    } else {
      if (node.children.length) throw Error("Unexpected SVG child element");
      contents = parsePath(shapePath(node.tag, a)).map((path) =>
        pathItem(path, nextId),
      );
      const paint = (kind, key) => {
        if ((s[key] ?? (key === "fill" ? "black" : "none")) === "none") return;
        const rgba = color(s[key] || "black"),
          alpha = Number(s[key + "-opacity"] ?? 1) * rgba[3];
        if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1)
          throw Error("Invalid SVG paint opacity");
        const properties = { color: d(rgba.slice(0, 3)), opacity: d(alpha) };
        if (kind === "fill")
          properties.fillRule =
            s["fill-rule"] === "evenodd" ? "even-odd" : "nonzero";
        else {
          const width = Number(s["stroke-width"] ?? 1);
          if (!Number.isFinite(width) || width < 0 || width > 1e6)
            throw Error("Invalid SVG stroke width");
          Object.assign(properties, {
            width: d(width),
            cap: s["stroke-linecap"] || "butt",
            join: s["stroke-linejoin"] || "miter",
            miterLimit: d(Number(s["stroke-miterlimit"] ?? 4)),
          });
          if (
            !["butt", "round", "square"].includes(properties.cap) ||
            !["miter", "round", "bevel"].includes(properties.join) ||
            !Number.isFinite(properties.miterLimit.keyframes[0].value)
          )
            throw Error("Unsupported SVG stroke");
          if (s["stroke-dasharray"] && s["stroke-dasharray"] !== "none") {
            let dash = numbers(s["stroke-dasharray"]);
            if (dash.length % 2) dash = dash.concat(dash);
            if (
              dash.length > 6 ||
              dash.some((v) => v < 0) ||
              !dash.some((v) => v > 0)
            )
              throw Error("Unsupported SVG dash pattern");
            properties.dashPairs = dash.length / 2;
            dash.forEach(
              (v, i) =>
                (properties[
                  (i % 2 ? "gap" : "dash") + (Math.floor(i / 2) + 1)
                ] = d(v)),
            );
            properties.dashOffset = d(Number(s["stroke-dashoffset"] || 0));
          }
        }
        contents.push({ kind, id: nextId(), properties });
      };
      paint("stroke", "stroke");
      paint("fill", "fill");
    }
    return [affineGroup(contents, m, nextId, opacity, a.id || node.tag)];
  }
  const items = visit(root),
    view = root.attributes.viewBox ? numbers(root.attributes.viewBox) : null;
  if (view && (view.length !== 4 || view[2] <= 0 || view[3] <= 0))
    throw Error("Invalid SVG viewBox");
  const result = [
    affineGroup(
      items,
      [
        1,
        0,
        0,
        -1,
        view ? -(view[0] + view[2] / 2) : 0,
        view ? view[1] + view[3] / 2 : 0,
      ],
      nextId,
      1,
      "Imported SVG",
    ),
  ];
  validate(result);
  return result;
}
module.exports = { importSVG, parseXML, transform, affineGroup, pathItem, d };
