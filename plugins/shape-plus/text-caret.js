"use strict";
// Pure caret geometry for Shape+ in-place text editing (see text-inline.js).
//
// A caret session edits the evaluated Source Text while the real Shape+
// render stays visible. All index math lives here so it runs in Node tests
// against real evaluated layouts (see test/shape-text-caret.test.js): the
// editor only maps the resulting layout coordinates through its screen
// transform and forwards input through a hidden textarea.
//
// Index spaces:
// - Source offsets count UTF-16 code units in the normalized Source Text
//   (\r\n and \r become \n). Insertions and deletions apply here.
// - Display offsets count UTF-16 code units inside one laid-out row
//   (row.text, already shaped for caps). Glyph `cl` values and row
//   `characters` indexes live in this space.
// rowSpans() bridges the two: box wrapping trims whitespace and caps may
// restyle the text, so a source offset maps to its row plus a display
// sub-offset, clamped to the row's cluster boundaries.
//
// Overlay boxes use a fixed share of the evaluated leading above the
// baseline (ASCENT_RATIO). They only position the editor's caret and
// selection highlight, never the rendered output.
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
const words = new Intl.Segmenter("und", { granularity: "word" });
const ASCENT_RATIO = 0.8;
const isSpaceCluster = text => /^\s$/u.test(text);

function normalizeSource(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n");
}

function splitParagraphs(source) {
  const paragraphs = [];
  let start = 0;
  for (const part of String(source).split("\n")) {
    paragraphs.push({ text: part, start });
    start += part.length + 1;
  }
  return paragraphs;
}

function displayOfParagraph(text, caps) {
  return caps === "all" || caps === "small" ? text.toUpperCase() : text;
}

// Map every laid-out row to its span in source offsets. Rows partition their
// paragraph's clusters in order; box wrapping may skip whitespace between
// rows (trimEnd/trimStart) and caps may restyle the display text, so the
// match runs on display clusters while spans track source clusters by
// ordinal. Length-changing case mappings (such as ß to SS) cannot align and
// fall back to a degenerate span at the match cursor.
function rowSpans(source, rows, caps = "normal") {
  const text = normalizeSource(source);
  const paragraphs = splitParagraphs(text);
  const spans = [];
  let pi = 0;
  let srcClusters = Array.from(graphemes.segment(paragraphs[0]?.text ?? ""), part => ({ text: part.segment, index: part.index }));
  let dispClusters = Array.from(graphemes.segment(displayOfParagraph(paragraphs[0]?.text ?? "", caps)), part => part.segment);
  let srcCursor = 0, dispCursor = 0, firstOfParagraph = true;
  const srcIndex = ordinal => ordinal < srcClusters.length
    ? srcClusters[ordinal].index + (paragraphs[pi]?.start ?? 0)
    : (paragraphs[pi]?.start ?? 0) + (paragraphs[pi]?.text.length ?? 0);
  const srcEndOf = ordinal => {
    const cluster = srcClusters[Math.min(ordinal, srcClusters.length - 1)];
    if (!cluster) return (paragraphs[pi]?.start ?? 0) + (paragraphs[pi]?.text.length ?? 0);
    return (paragraphs[pi]?.start ?? 0) + cluster.index + cluster.text.length;
  };
  for (const row of rows) {
    const para = paragraphs[pi];
    if (!para) {
      spans.push({ srcStart: text.length, srcEnd: text.length });
      continue;
    }
    if (!firstOfParagraph) {
      while (dispCursor < dispClusters.length && srcCursor < srcClusters.length && isSpaceCluster(dispClusters[dispCursor])) {
        dispCursor++;
        srcCursor = Math.min(srcCursor + 1, srcClusters.length);
      }
    }
    const wanted = (row.characters || []).map(cluster => cluster.text);
    let matched = 0;
    while (matched < wanted.length && dispCursor + matched < dispClusters.length && dispClusters[dispCursor + matched] === wanted[matched]) matched++;
    if (matched === 0 && wanted.length > 0 && srcCursor < srcClusters.length) {
      // Best effort: keep ordinal progress so later rows still resolve.
      spans.push({ srcStart: srcIndex(srcCursor), srcEnd: srcEndOf(srcCursor) });
      srcCursor++;
      dispCursor++;
    } else {
      const srcStart = srcIndex(srcCursor);
      spans.push({ srcStart, srcEnd: matched > 0 ? srcEndOf(srcCursor + matched - 1) : srcStart });
      srcCursor += matched;
      dispCursor += matched;
    }
    firstOfParagraph = false;
    let rest = dispCursor;
    while (rest < dispClusters.length && isSpaceCluster(dispClusters[rest])) rest++;
    if (rest >= dispClusters.length) {
      // The paragraph is consumed: trailing whitespace belongs to this row
      // so End and click mapping reach the paragraph end.
      spans[spans.length - 1].srcEnd = para.start + para.text.length;
      pi++;
      srcCursor = 0;
      dispCursor = 0;
      firstOfParagraph = true;
      srcClusters = Array.from(graphemes.segment(paragraphs[pi]?.text ?? ""), part => ({ text: part.segment, index: part.index }));
      dispClusters = Array.from(graphemes.segment(displayOfParagraph(paragraphs[pi]?.text ?? "", caps)), part => part.segment);
    }
  }
  return spans;
}

function displayLength(row) {
  // Row `text` keeps the source case while `characters` indexes the shaped
  // (caps-transformed) text, so measure the display from the characters.
  let length = 0;
  for (const cluster of row?.characters || []) length = Math.max(length, cluster.index + cluster.text.length);
  return length || (row?.text || "").length;
}

function lineGlyphs(glyphs, line) {
  return (glyphs || []).filter(glyph => glyph.line === line);
}

// Glyph `cl` values count into the row text. A ligature glyph (such as the
// "ffi" glyph in the Roboto Flex fixture) owns several characters: the caret
// moves inside its advance proportionally.
function endClOf(line, i, length) {
  for (let j = i + 1; j < line.length; j++) {
    if (line[j].cl !== line[i].cl) return line[j].cl;
  }
  return length;
}

function xForSub(line, length, sub, emptyX = 0) {
  if (!line.length) return emptyX;
  if (sub <= line[0].cl) return line[0].x;
  for (let i = 0; i < line.length; i++) {
    const end = endClOf(line, i, length);
    if (end <= line[i].cl) {
      if (sub <= line[i].cl) return line[i].x;
      continue;
    }
    if (sub <= end) return line[i].x + ((sub - line[i].cl) / (end - line[i].cl)) * line[i].advance;
  }
  const last = line[line.length - 1];
  return last.x + last.advance;
}

function rowBoundaries(row) {
  const length = displayLength(row);
  const set = new Set([0, length]);
  for (const cluster of row?.characters || []) {
    set.add(cluster.index);
    set.add(cluster.index + cluster.text.length);
  }
  return [...set].filter(value => value >= 0 && value <= length).sort((a, b) => a - b);
}

function subForX(line, length, row, x) {
  let best = 0, bestDist = Infinity;
  for (const sub of rowBoundaries(row)) {
    const dist = Math.abs(xForSub(line, length, sub) - x);
    if (dist < bestDist - 1e-9) {
      bestDist = dist;
      best = sub;
    }
  }
  return best;
}

function rowTop(baseline, lineHeight) {
  return baseline - lineHeight * ASCENT_RATIO;
}

function isRowVisible(row) {
  return row?.visible !== false;
}

function rowForY(rows, y, lineHeight) {
  let best = -1, bestScore = Infinity;
  rows.forEach((row, i) => {
    if (!isRowVisible(row)) return;
    const top = rowTop(row.baseline, lineHeight);
    const outside = y < top ? top - y : y > top + lineHeight ? y - (top + lineHeight) : 0;
    const score = outside * 1e6 + Math.abs(y - (top + lineHeight / 2));
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function rowAtOffset(spans, offset) {
  let row = -1;
  spans.forEach((span, i) => {
    if (span.srcStart <= offset) row = i;
  });
  return row;
}

function xForOffset(rows, glyphs, spans, offset, emptyX = 0) {
  const i = rowAtOffset(spans, offset);
  if (i < 0) return emptyX;
  const length = displayLength(rows[i]);
  const sub = Math.min(Math.max(offset - spans[i].srcStart, 0), length);
  return xForSub(lineGlyphs(glyphs, i), length, sub, emptyX);
}

function clusterBoundaries(text) {
  const set = new Set([0, text.length]);
  for (const part of graphemes.segment(text)) {
    set.add(part.index);
    set.add(part.index + part.segment.length);
  }
  return [...set].sort((a, b) => a - b);
}

function snapCluster(text, offset) {
  let best = 0, bestDist = Infinity;
  for (const boundary of clusterBoundaries(text)) {
    const dist = Math.abs(boundary - offset);
    if (dist < bestDist - 1e-9) {
      bestDist = dist;
      best = boundary;
    }
  }
  return best;
}

function stepCluster(text, offset, direction) {
  if (direction < 0) {
    let prev = 0;
    for (const boundary of clusterBoundaries(text)) {
      if (boundary < offset) prev = boundary;
      else break;
    }
    return prev;
  }
  for (const boundary of clusterBoundaries(text)) {
    if (boundary > offset) return boundary;
  }
  return text.length;
}

function offsetForPoint(source, rows, glyphs, spans, x, y, lineHeight) {
  const text = normalizeSource(source);
  const i = rowForY(rows, y, lineHeight);
  if (i < 0 || !spans[i]) return 0;
  const sub = subForX(lineGlyphs(glyphs, i), displayLength(rows[i]), rows[i], x);
  return snapCluster(text, Math.min(Math.max(spans[i].srcStart + sub, spans[i].srcStart), spans[i].srcEnd));
}

function rectsForRange(rows, glyphs, spans, a, b, lineHeight, emptyX = 0) {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const rects = [];
  rows.forEach((row, i) => {
    const span = spans[i];
    if (!span || !isRowVisible(row)) return;
    const s = Math.max(from, span.srcStart), e = Math.min(to, span.srcEnd);
    if (e <= s) return;
    const length = displayLength(row);
    const line = lineGlyphs(glyphs, i);
    const x1 = xForSub(line, length, Math.min(Math.max(s - span.srcStart, 0), length), emptyX);
    const x2 = xForSub(line, length, Math.min(Math.max(e - span.srcStart, 0), length), emptyX);
    if (x2 === x1) return;
    rects.push({ x: Math.min(x1, x2), y: rowTop(row.baseline, lineHeight), width: Math.abs(x2 - x1), height: lineHeight });
  });
  return rects;
}

function rowHome(spans, offset) {
  const i = rowAtOffset(spans, offset);
  return i < 0 ? 0 : spans[i].srcStart;
}

function rowEnd(spans, offset) {
  const i = rowAtOffset(spans, offset);
  return i < 0 ? offset : spans[i].srcEnd;
}

function moveVertically(source, rows, glyphs, spans, offset, direction, goalX, lineHeight, emptyX = 0) {
  const text = normalizeSource(source);
  const order = rows.map((row, i) => i).filter(i => isRowVisible(rows[i]));
  const current = rowAtOffset(spans, offset);
  const at = order.indexOf(current);
  const next = order[Math.min(Math.max(at + direction, 0), Math.max(order.length - 1, 0))];
  if (next === undefined || next === current) return { offset, x: xForOffset(rows, glyphs, spans, offset, emptyX) };
  const x = goalX ?? xForOffset(rows, glyphs, spans, offset, emptyX);
  const sub = subForX(lineGlyphs(glyphs, next), displayLength(rows[next]), rows[next], x);
  const raw = Math.min(Math.max(spans[next].srcStart + sub, spans[next].srcStart), spans[next].srcEnd);
  return { offset: snapCluster(text, raw), x };
}

// Double-click selects the word-like segment under the pointer; other
// segments (spaces, punctuation) select the grapheme cluster there.
function wordAt(text, offset) {
  const source = String(text ?? "");
  if (!source.length) return null;
  const at = Math.min(Math.max(offset, 0), source.length - 1);
  for (const part of words.segment(source)) {
    if (part.index <= at && at < part.index + part.segment.length) {
      if (part.isWordLike) return { start: part.index, end: part.index + part.segment.length };
      for (const cluster of graphemes.segment(source)) {
        if (cluster.index <= at && at < cluster.index + cluster.segment.length) {
          return { start: cluster.index, end: cluster.index + cluster.segment.length };
        }
      }
      return { start: part.index, end: part.index + part.segment.length };
    }
  }
  const boundaries = clusterBoundaries(source);
  return { start: boundaries[0], end: boundaries[1] ?? source.length };
}

module.exports = {
  ASCENT_RATIO,
  normalizeSource,
  splitParagraphs,
  displayOfParagraph,
  rowSpans,
  displayLength,
  lineGlyphs,
  xForSub,
  rowBoundaries,
  subForX,
  rowTop,
  rowForY,
  rowAtOffset,
  xForOffset,
  clusterBoundaries,
  snapCluster,
  stepCluster,
  offsetForPoint,
  rectsForRange,
  rowHome,
  rowEnd,
  moveVertically,
  wordAt,
};
