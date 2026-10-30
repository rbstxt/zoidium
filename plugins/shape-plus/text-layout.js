"use strict";
const { createCache, fontId } = require("./text-cache.js");
const contoursCache = createCache(2 * 1024 * 1024);
const { shapeRuns, clusters } = require("./text-shaping.js");
const { parsePath } = require("./svg-path.js");
const cjk = text => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
function tokens(text) {
  const result = [];
  for (const part of clusters(text)) {
    const kind = cjk(part.text) ? "cjk" : /\s/u.test(part.text) ? "space" : "word";
    if (kind !== "cjk" && result.at(-1)?.kind === kind) result.at(-1).text += part.text;
    else result.push({ kind, text: part.text });
  }
  return result.map(part => part.text);
}
function layoutText(primary, fallback, p) {
  const size = Math.max(0, p.fontSize ?? 100), sx = (p.horizontalScale ?? 100) / 100, sy = (p.verticalScale ?? 100) / 100;
  const coordinates = Object.fromEntries(Object.keys(primary.axes).map(tag => [tag, p["axis_" + tag] ?? primary.axes[tag].default]));
  const tracking = (p.tracking || 0) * size / 1000, leading = p.leading ?? size * 1.2;
  const box = p.textMode === "box", boxWidth = Math.max(0, p.boxSize?.[0] ?? 600), boxHeight = Math.max(0, p.boxSize?.[1] ?? 400);
  const rows = [], glyphs = [], shapedCache = new Map();
  function shape(text) {
    if (shapedCache.has(text)) return shapedCache.get(text);
    let source = text;
    if (p.caps === "all") source = text.toUpperCase();
    const shaped = p.caps === "small" ? clusters(text).flatMap(cluster => {
      const small = cluster.text !== cluster.text.toUpperCase();
      return shapeRuns(primary, fallback, cluster.text.toUpperCase(), coordinates).map(g => ({ ...g, cl: cluster.index, character: cluster.text, small: small ? .75 : 1 }));
    }) : shapeRuns(primary, fallback, source, coordinates);
    let x = 0;
    for (const [i, g] of shaped.entries()) {
      g.scaleX = size / g.font.upem * sx * (g.small || 1); g.scaleY = size / g.font.upem * sy * (g.small || 1);
      g.x = x + g.dx * g.scaleX; g.y = g.dy * g.scaleY;
      g.advance = g.ax * g.scaleX;
      x += g.advance + (i + 1 < shaped.length ? tracking : 0);
    }
    const result = { glyphs: shaped, width: x, text: source };
    shapedCache.set(text, result); return result;
  }
  let y = 0;
  for (const paragraph of String(p.sourceText ?? "Text").replace(/\r\n?/g, "\n").split("\n")) {
    y -= p.spaceBefore || 0;
    const lines = [];
    if (!box) lines.push(paragraph);
    else {
      let line = "", first = true;
      for (const token of tokens(paragraph)) {
        const available = boxWidth - (first ? p.firstLineIndent || 0 : 0);
        if (line && shape(line + token).width > available) { lines.push(line.trimEnd()); line = token.trimStart(); first = false; }
        else line += token;
        // A Latin word wider than the box breaks only as a last resort.
        if (shape(line).width > (first ? available : boxWidth)) {
          let partial = "";
          for (const cluster of clusters(line)) {
            if (partial && shape(partial + cluster.text).width > (first ? available : boxWidth)) { lines.push(partial); partial = ""; first = false; }
            partial += cluster.text;
          }
          line = partial;
        }
      }
      lines.push(line);
    }
    for (const [lineIndex, text] of lines.entries()) {
      const shaped = shape(text), indent = lineIndex === 0 ? p.firstLineIndent || 0 : 0;
      const available = box ? boxWidth - indent : shaped.width;
      const last = lineIndex === lines.length - 1, align = p.alignment || "left";
      const justify = box && align.startsWith("justify") && (!last || align === "justifyAll");
      const spaces = shaped.glyphs.filter(g => /\s/u.test(g.character)).length;
      const characterGaps = !spaces && cjk(text) ? Math.max(0, new Set(shaped.glyphs.map(g => g.cl)).size - 1) : 0;
      const gaps = spaces || characterGaps;
      const gap = justify && gaps ? Math.max(0, available - shaped.width) / gaps : 0;
      const effective = align === "justifyCenter" ? "center" : align === "justifyRight" ? "right" : align;
      let x = indent;
      if (!justify && effective === "center") x += (box ? available - shaped.width : -shaped.width) / 2;
      if (!justify && effective === "right") x += box ? available - shaped.width : -shaped.width;
      const visible = !box || -y < boxHeight;
      if (visible) for (const [glyphIndex, g] of shaped.glyphs.entries()) {
        glyphs.push({ ...g, line: rows.length, x: g.x + x + (p.position?.[0] || 0), y: g.y + y + (p.baselineShift || 0) + (p.position?.[1] || 0), coordinates });
        if (/\s/u.test(g.character) || characterGaps && shaped.glyphs[glyphIndex+1] && shaped.glyphs[glyphIndex+1].cl !== g.cl) x += gap;
      }
      rows.push({ text, characters: clusters(shaped.text), width: shaped.width, baseline: y, visible }); y -= leading;
    }
    y -= p.spaceAfter || 0;
  }
  const parsed = new Map(), coordinatesKey = JSON.stringify(coordinates);
  for (const glyph of glyphs) {
    const key=fontId(glyph.font)+":"+glyph.g+":"+coordinatesKey;
    if(!parsed.has(key)) {
      let contours=contoursCache.get(key);
      if(!contours){const outline=glyph.font.outline(glyph.g,coordinates);contours=outline.length?parsePath(outline.map(c=>c.type+c.values.join(",")).join("")):[];contoursCache.set(key,contours,128+contours.reduce((n,p)=>n+p.vertices.length*256,0));}
      parsed.set(key,contours);
    }
    glyph.contours = parsed.get(key);
    glyph.paths = glyph.contours.map(path => ({ closed: path.closed, vertices: path.vertices.map(v => ({
      point: [v.point[0] * glyph.scaleX + glyph.x, v.point[1] * glyph.scaleY + glyph.y],
      in: [v.in[0] * glyph.scaleX, v.in[1] * glyph.scaleY], out: [v.out[0] * glyph.scaleX, v.out[1] * glyph.scaleY],
    })) }));
  }
  return { glyphs, rows };
}
module.exports = { layoutText, tokens, cjk, contoursStats: contoursCache.stats };
