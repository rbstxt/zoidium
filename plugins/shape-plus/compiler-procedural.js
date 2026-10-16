"use strict";
const { primitivePath } = require("./primitives.js");
const { flattenPath } = require("./path.js");
const { triangulate } = require("./fill.js");
const { stroke } = require("./stroke.js");
const { trim, roundCorners, clamp } = require("./operators.js");
const { gradient } = require("./paint.js");
const identity = [1, 0, 0, 1, 0, 0];
function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function inverse(m) {
  const d = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(d) < 1e-12) return null;
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
}
function transformed(path, m, transform) {
  const result = { ...path, points: path.points.map((p) => transform(p, m)) };
  if (path.vertices)
    result.vertices = path.vertices.map((v) => {
      const vector = (h) => [
        m[0] * h[0] + m[2] * h[1],
        m[1] * h[0] + m[3] * h[1],
      ];
      return {
        ...v,
        point: transform(v.point, m),
        in: vector(v.in),
        out: vector(v.out),
      };
    });
  return result;
}
function repeaterCopies(p, matrix) {
  const count = clamp(p.copies, 0, 128),
    n = Math.ceil(count),
    result = [];
  for (let i = 0; i < n; i++) {
    const exponent = i + p.offset;
    const power = (s) => {
      if (s < 0 && !Number.isInteger(exponent))
        throw Error(
          "Shape+ fractional repeater offsets require nonnegative scale",
        );
      if (s === 0 && exponent < 0)
        throw Error("Shape+ negative repeater offsets require nonzero scale");
      return exponent === 0 ? 1 : Math.pow(s, exponent);
    };
    const anchor = p.anchor || [0, 0];
    const m = matrix({
      anchor,
      position: anchor.map((v, k) => v + p.position[k] * exponent),
      scale: p.scale.map(power),
      rotation: p.rotation * exponent,
    });
    if (!m.every(Number.isFinite))
      throw Error("Invalid Shape+ repeater transform");
    result.push({
      matrix: m,
      opacity:
        clamp(
          p.startOpacity +
            (p.endOpacity - p.startOpacity) * (n > 1 ? i / (n - 1) : 0),
        ) * Math.min(1, count - i),
    });
  }
  return result;
}
function procedural(contents, tolerance, depth, budget, api) {
  const { matrix, transform, transformCommand } = api;
  let descriptorVisits = 0;
  const viewPaths = (view) =>
    view.base.paths.map((path) => transformed(path, view.matrix, transform));
  function scope(list, tolerance, depth) {
    if (depth > 16) throw Error("Shape+ group depth budget exceeded");
    let views = [],
      commands = [];
    const futureScales = new Array(list.length);
    let futureScale = 1;
    for (let i = list.length - 1; i >= 0; i--) {
      futureScales[i] = futureScale;
      const item = list[i];
      if (item.kind === "repeater" && item.properties.enabled !== 0) {
        const copies = repeaterCopies(item.properties, matrix);
        const scale = Math.max(
          1,
          ...copies.map((copy) =>
            Math.max(
              Math.hypot(copy.matrix[0], copy.matrix[1]),
              Math.hypot(copy.matrix[2], copy.matrix[3]),
            ),
          ),
        );
        futureScale *= scale;
        if (!Number.isFinite(futureScale))
          throw Error("Shape+ transform quality budget exceeded");
      }
    }
    for (const [index, item] of list.entries()) {
      const itemTolerance = tolerance / futureScales[index];
      const p = item.properties;
      if (p.enabled === 0) continue;
      if (item.kind === "group") {
        const m = matrix(p),
          scale = Math.max(
            Math.hypot(m[0], m[1]),
            Math.hypot(m[2], m[3]),
            1e-6,
          );
        const child = scope(item.contents, itemTolerance / scale, depth + 1);
        views.push(
          ...child.views.map((view) => ({
            ...view,
            matrix: multiply(m, view.matrix),
          })),
        );
        const nested = {
          kind: "group",
          id: item.id,
          matrix: m,
          opacity: clamp(p.opacity),
          commands: child.commands,
        };
        commands.unshift(nested);
      } else if (
        ["fill", "stroke", "gradientFill", "gradientStroke"].includes(item.kind)
      ) {
        const paint = {
          kind: "paint",
          id: item.id,
          views: views.slice(),
          properties: p,
          type: item.kind,
          tolerance: itemTolerance,
          matrix: identity,
        };
        if (p.composite === "above") commands.push(paint);
        else commands.unshift(paint);
      } else if (item.kind === "trim" || item.kind === "roundCorners") {
        const paths = views.flatMap((view, index) =>
          viewPaths(view).map((path) => ({ ...path, owner: index })),
        );
        const changed =
          item.kind === "trim"
            ? trim(paths, p)
            : paths.map((path) => roundCorners(path, p.radius, itemTolerance));
        views.forEach((view, index) => {
          const inv = inverse(view.matrix);
          const selected = changed.filter((path) => path.owner === index);
          if (!inv && selected.length)
            throw Error(
              "Shape+ cannot modify paths under a singular transform",
            );
          view.base.paths = selected.map((path) => {
            const result = transformed(path, inv, transform);
            delete result.owner;
            return result;
          });
        });
      } else if (item.kind === "repeater") {
        const originalViews = views,
          originalCommands = commands;
        views = [];
        commands = [];
        for (const [index, copy] of repeaterCopies(p, matrix).entries()) {
          const bases = new Map();
          function cloneView(view) {
            if (!bases.has(view.base))
              bases.set(view.base, {
                paths: view.base.paths.map((path) => ({ ...path })),
              });
            return { ...view, base: bases.get(view.base) };
          }
          function cloneCommand(command) {
            if (++descriptorVisits > 4096)
              throw Error("Shape+ command budget exceeded");
            return command.kind === "paint"
              ? { ...command, views: command.views.map(cloneView) }
              : { ...command, commands: command.commands.map(cloneCommand) };
          }
          views.push(
            ...originalViews.map((view) => ({
              ...cloneView(view),
              matrix: multiply(copy.matrix, view.matrix),
            })),
          );
          const group = {
            kind: "group",
            id: item.id + ":" + index,
            matrix: copy.matrix,
            opacity: copy.opacity,
            commands: originalCommands.map(cloneCommand),
          };
          if (p.composite === "above") commands.push(group);
          else commands.unshift(group);
        }
      } else {
        const cubic = primitivePath(item),
          path = {
            ...flattenPath(cubic, itemTolerance),
            vertices: cubic.vertices,
          };
        views.push({ base: { paths: [path] }, matrix: identity });
      }
      const points = views.reduce(
        (sum, view) =>
          sum + view.base.paths.reduce((s, path) => s + path.points.length, 0),
        0,
      );
      if (points > 16384 || views.length > 2048)
        throw Error("Shape+ path collection budget exceeded");
    }
    return { views, commands };
  }
  function render(command) {
    if (command.kind === "group") {
      const children = command.commands
        .flatMap(render)
        .map((c) => transformCommand(c, command.matrix));
      if (!children.length) return [];
      return command.opacity < 1
        ? [
            {
              kind: "isolation",
              id: command.id,
              opacity: command.opacity,
              commands: children,
            },
          ]
        : children;
    }
    const p = command.properties,
      paths = command.views.flatMap(viewPaths),
      fill = command.type === "fill" || command.type === "gradientFill";
    const positions = fill
      ? triangulate(
          paths.map((path) => path.points),
          p.fillRule,
        )
      : stroke(paths, p, command.tolerance);
    budget.coordinates += positions.length;
    if (budget.coordinates > 1800000 || !positions.every(Number.isFinite))
      throw Error("Shape+ geometry budget exceeded");
    return [
      {
        kind: "paint",
        id: command.id,
        positions,
        color: p.color?.slice() || [1, 1, 1],
        opacity: clamp(p.opacity),
        ...(command.type.startsWith("gradient")
          ? { gradient: gradient(p) }
          : {}),
      },
    ];
  }
  const result = scope(contents, tolerance, depth);
  const paths = result.views.flatMap(viewPaths),
    commands = result.commands.flatMap(render);
  function finite(list) {
    for (const command of list) {
      if (command.kind === "isolation") finite(command.commands);
      else if (
        !command.positions.every(Number.isFinite) ||
        (command.gradient && !command.gradient.matrix.every(Number.isFinite))
      )
        throw Error("Shape+ geometry must be finite");
    }
  }
  finite(commands);
  if (paths.some((path) => !path.points.flat().every(Number.isFinite)))
    throw Error("Shape+ geometry must be finite");
  return { paths, commands };
}
module.exports = { procedural, multiply, inverse, repeaterCopies };
