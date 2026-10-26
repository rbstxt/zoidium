"use strict";

const { getTextPlusControls } = require("./text-plus-controls.js");
const { controlSource } = require("./text-plus-2d-properties.js");

function isNeutral(controls) {
  return controls.position[0] === 0 && controls.position[1] === 0 &&
    controls.scale[0] === 1 && controls.scale[1] === 1 &&
    controls.rotation[2] === 0 && controls.shake === 0;
}

// Match the native path transform, including its half-unit alignment offset.
// This reads the existing path and never rebuilds the font layout.
function glyphBounds(glyph, frame, cache) {
  const path = glyph.path;
  if (!path?.commands?.length || !path.getBoundingBox) return null;
  let box = cache.get(path);
  if (!box) { box = path.getBoundingBox(); cache.set(path, box); }
  const position = glyph.properties.position.get(frame);
  const scale = glyph.properties.scale.get(frame);
  const angle = glyph.properties.rotation.get(frame);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const a = scale[0] * cos, b = -scale[0] * sin;
  const c = scale[1] * sin, d = scale[1] * cos;
  const x = position[0] + 0.5 - (a + c) * 0.5;
  const y = -position[1] + 0.5 - (b + d) * 0.5;
  const points = [[box.x1, box.y1], [box.x1, box.y2],
    [box.x2, box.y1], [box.x2, box.y2]].map(([px, py]) => [a * px + c * py + x, b * px + d * py + y]);
  const result = { minX: Math.min(...points.map(p => p[0])), minY: Math.min(...points.map(p => p[1])),
    maxX: Math.max(...points.map(p => p[0])), maxY: Math.max(...points.map(p => p[1])) };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function center(bounds) {
  return bounds ? [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2] : [0, 0];
}

function unionBounds(boxes) {
  const visible = boxes.filter(Boolean);
  if (!visible.length) return null;
  return { minX: Math.min(...visible.map(box => box.minX)), minY: Math.min(...visible.map(box => box.minY)),
    maxX: Math.max(...visible.map(box => box.maxX)), maxY: Math.max(...visible.map(box => box.maxY)) };
}

function drawCharacters(layer, list, context, originalDraw, args, cache) {
  const source = controlSource(list);
  const glyphs = layer.objects?.[0]?.objects;
  if (!source || !glyphs?.length) return originalDraw.apply(layer, args);
  const frame = Number.isFinite(layer.frame) ? layer.frame : 0;
  const controls = Array.from(glyphs, (_, index) => getTextPlusControls(source, frame, index, glyphs.length));
  // Neutral values call the original renderer with no extra canvas calls,
  // wrappers, path replacement, or changes to native property values.
  if (controls.every(isNeutral)) return originalDraw.apply(layer, args);
  const bounds = Array.from(glyphs, glyph => glyphBounds(glyph, frame, cache));
  const textCenter = center(unionBounds(bounds)), restore = [];
  try {
    for (let index = 0; index < glyphs.length; index++) {
      const controlsForGlyph = controls[index];
      if (isNeutral(controlsForGlyph)) continue;
      const glyph = glyphs[index], original = glyph.draw;
      const descriptor = Object.getOwnPropertyDescriptor(glyph, "draw");
      const pivot = controlsForGlyph.pivot === "text" ? textCenter : center(bounds[index]);
      glyph.draw = function drawCharacter(frame, ctx) {
        ctx.save();
        try {
          ctx.translate(pivot[0] + controlsForGlyph.position[0], pivot[1] - controlsForGlyph.position[1]);
          ctx.rotate(-controlsForGlyph.rotation[2] - controlsForGlyph.shake);
          ctx.scale(controlsForGlyph.scale[0], controlsForGlyph.scale[1]);
          ctx.translate(-pivot[0], -pivot[1]);
          return original.call(this, frame, ctx);
        } finally { ctx.restore(); }
      };
      restore.push(() => {
        if (descriptor) Object.defineProperty(glyph, "draw", descriptor);
        else delete glyph.draw;
      });
    }
    return originalDraw.apply(layer, args);
  } finally {
    for (const undo of restore.reverse()) undo();
  }
}

module.exports = { isNeutral, glyphBounds, unionBounds, center, drawCharacters };
