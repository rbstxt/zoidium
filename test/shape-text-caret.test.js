"use strict";
const { test, before } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { createLoader } = require("../plugins/shape-plus/text-engine.js"), { layoutText } = require("../plugins/shape-plus/text-layout.js");
const caret = require("../plugins/shape-plus/text-caret.js");
let latin, japanese;
before(async () => {
  const engine = await createLoader((_, name) => fs.readFileSync(name, "utf8"), name => require("../plugins/shape-plus/" + name))();
  function open(file) { const b = fs.readFileSync("test/fixtures/shape-text/" + file); return engine.open(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), file); }
  latin = open("RobotoFlex-subset.ttf"); japanese = open("NotoSansJP-subset.ttf");
});
const p = { sourceText: "", fontSize: 100, horizontalScale: 100, verticalScale: 100, leading: 120 };
const layoutOf = (font, settings) => layoutText(font, null, { ...p, ...settings });
const spansOf = (source, layout, caps) => caret.rowSpans(source, layout.rows, caps);

test("multi-line text maps source offsets to rows and back", () => {
  const source = "one\ntwo\nthree";
  const layout = layoutOf(latin, { sourceText: source });
  const spans = spansOf(source, layout);
  assert.deepEqual(spans, [{ srcStart: 0, srcEnd: 3 }, { srcStart: 4, srcEnd: 7 }, { srcStart: 8, srcEnd: 13 }]);
  assert.equal(caret.rowAtOffset(spans, 5), 1);
  // A click between rows resolves to the nearest baseline.
  assert.equal(caret.offsetForPoint(source, layout.rows, layout.glyphs, spans, 1000, -116, 120), 7);
  // Up and Down keep x across lines of different widths.
  const down = caret.moveVertically(source, layout.rows, layout.glyphs, spans, 3, 1, undefined, 120);
  assert.equal(down.offset, 7);
  const up = caret.moveVertically(source, layout.rows, layout.glyphs, spans, down.offset, -1, down.x, 120);
  assert.equal(up.offset, 3);
  assert.equal(caret.rowHome(spans, 6), 4);
  assert.equal(caret.rowEnd(spans, 6), 7);
});

test("box wrapping partitions the source and skips trimmed whitespace", () => {
  const width = layoutOf(latin, { sourceText: "office" }).rows[0].width;
  const source = "AV office";
  const layout = layoutOf(latin, { sourceText: source, textMode: "box", boxSize: [width + 1, 400] });
  assert.deepEqual(layout.rows.map(row => row.text), ["AV", "office"]);
  const spans = spansOf(source, layout);
  assert.deepEqual(spans, [{ srcStart: 0, srcEnd: 2 }, { srcStart: 3, srcEnd: 9 }]);
  // The wrapped space at offset 2 has no display position: it renders at the
  // end of the first row, and stepping right enters the second row.
  assert.equal(caret.xForOffset(layout.rows, layout.glyphs, spans, 2), layout.glyphs[1].x + layout.glyphs[1].advance);
  assert.equal(caret.rowAtOffset(spans, 3), 1);
  // A selection across the wrap produces one rect per row.
  const rects = caret.rectsForRange(layout.rows, layout.glyphs, spans, 1, 5, 120);
  assert.equal(rects.length, 2);
  assert.ok(rects[0].width > 0 && rects[1].width > 0);
  assert.equal(rects[1].y - rects[0].y, -120);
});

test("CJK box text breaks per grapheme cluster", () => {
  const source = "日本語日本語";
  const layout = layoutOf(japanese, { sourceText: source, textMode: "box", boxSize: [201, 600] });
  assert.deepEqual(layout.rows.map(row => row.text), ["日本", "語日", "本語"]);
  const spans = spansOf(source, layout);
  assert.deepEqual(spans.map(span => [span.srcStart, span.srcEnd]), [[0, 2], [2, 4], [4, 6]]);
  assert.equal(caret.stepCluster(source, 0, 1), 1);
  assert.equal(caret.stepCluster(source, 2, -1), 1);
  assert.equal(caret.xForOffset(layout.rows, layout.glyphs, spans, 2), layout.glyphs[2].x);
});

test("the ffi ligature owns three characters with a proportional caret", () => {
  const source = "office";
  const layout = layoutOf(latin, { sourceText: source });
  const ffi = layout.glyphs[1];
  assert.equal(ffi.character, "f");
  const next = layout.glyphs[2];
  assert.equal(ffi.cl, 1);
  assert.equal(next.cl, 4);
  const line = caret.lineGlyphs(layout.glyphs, 0);
  const x1 = caret.xForSub(line, 6, 1), x2 = caret.xForSub(line, 6, 2), x3 = caret.xForSub(line, 6, 3), x4 = caret.xForSub(line, 6, 4);
  assert.ok(x1 < x2 && x2 < x3 && x3 < x4);
  assert.ok(Math.abs((x2 - x1) - (x3 - x2)) < 1e-9);
  assert.ok(Math.abs((x3 - x2) - (x4 - x3)) < 1e-9);
  assert.equal(caret.subForX(line, 6, layout.rows[0], (x1 + x4) / 2), 2);
});

test("combining marks move as one cluster", () => {
  assert.deepEqual(caret.clusterBoundaries("ét"), [0, 2, 3]);
  assert.equal(caret.stepCluster("école", 0, 1), 2);
  assert.equal(caret.stepCluster("école", 2, -1), 0);
  const layout = layoutOf(latin, { sourceText: "école" });
  // The laid-out row keeps both code units in one display cluster.
  assert.equal(layout.rows[0].characters[0].text, "é");
  const spans = spansOf("école", layout);
  assert.deepEqual(spans, [{ srcStart: 0, srcEnd: 6 }]);
});

test("empty lines keep their paragraph offsets and draw no rects", () => {
  const source = "a\n\nb";
  const layout = layoutOf(latin, { sourceText: source });
  assert.equal(layout.rows.length, 3);
  const spans = spansOf(source, layout);
  assert.deepEqual(spans, [{ srcStart: 0, srcEnd: 1 }, { srcStart: 2, srcEnd: 2 }, { srcStart: 3, srcEnd: 4 }]);
  assert.equal(caret.xForOffset(layout.rows, layout.glyphs, spans, 2, 7), 7);
  assert.deepEqual(caret.rectsForRange(layout.rows, layout.glyphs, spans, 0, 4, 120).length, 2);
});

test("right and centre alignment move the caret with the glyphs", () => {
  const left = layoutOf(latin, { sourceText: "AV" });
  const right = layoutOf(latin, { sourceText: "AV", alignment: "right" });
  const centre = layoutOf(latin, { sourceText: "AV", alignment: "center" });
  const leftSpans = spansOf("AV", left), rightSpans = spansOf("AV", right), centreSpans = spansOf("AV", centre);
  assert.equal(caret.xForOffset(right.rows, right.glyphs, rightSpans, 0), right.glyphs[0].x);
  assert.equal(caret.xForOffset(centre.rows, centre.glyphs, centreSpans, 2), centre.glyphs[1].x + centre.glyphs[1].advance);
  assert.ok(right.glyphs[0].x < left.glyphs[0].x);
  assert.ok(Math.abs(centre.glyphs[0].x - (left.glyphs[0].x - right.rows[0].width / 2)) < 1e-6);
  const row = right.rows[0];
  const at = caret.offsetForPoint("AV", right.rows, right.glyphs, rightSpans, right.glyphs[0].x - 1000, row.baseline, 120);
  assert.equal(at, 0);
});

test("tracking widens caret positions without extra logic", () => {
  const plain = layoutOf(latin, { sourceText: "AV" });
  const tracked = layoutOf(latin, { sourceText: "AV", tracking: 100 });
  const plainSpans = spansOf("AV", plain), trackedSpans = spansOf("AV", tracked);
  const xPlain = caret.xForOffset(plain.rows, plain.glyphs, plainSpans, 1);
  const xTracked = caret.xForOffset(tracked.rows, tracked.glyphs, trackedSpans, 1);
  // The caret hugs the previous glyph, so the tracking gap appears after it.
  assert.ok(Math.abs(xTracked - xPlain) < 1e-6);
  const endPlain = caret.xForOffset(plain.rows, plain.glyphs, plainSpans, 2);
  const endTracked = caret.xForOffset(tracked.rows, tracked.glyphs, trackedSpans, 2);
  assert.ok(Math.abs(endTracked - endPlain - 10) < 1e-6);
});

test("word selection and vertical navigation edge cases", () => {
  assert.deepEqual(caret.wordAt("hello world", 7), { start: 6, end: 11 });
  assert.deepEqual(caret.wordAt("hello world", 5), { start: 5, end: 6 });
  assert.equal(caret.wordAt("", 0), null);
  const source = "one\ntwo";
  const layout = layoutOf(latin, { sourceText: source });
  const spans = spansOf(source, layout);
  // Down from the last row and up from the first row stay put.
  assert.equal(caret.moveVertically(source, layout.rows, layout.glyphs, spans, 6, 1, undefined, 120).offset, 6);
  assert.equal(caret.moveVertically(source, layout.rows, layout.glyphs, spans, 1, -1, undefined, 120).offset, 1);
  // Home and End outside any span clamp to the document.
  assert.equal(caret.rowHome([], 4), 0);
  assert.equal(caret.rowEnd([], 4), 4);
});

test("caps map display positions back to source clusters", () => {
  const source = "office";
  const layout = layoutOf(latin, { sourceText: source, caps: "all" });
  assert.equal(layout.glyphs.map(glyph => glyph.character).join(""), "OFFICE");
  const spans = spansOf(source, layout, "all");
  assert.deepEqual(spans, [{ srcStart: 0, srcEnd: 6 }]);
  assert.equal(caret.xForOffset(layout.rows, layout.glyphs, spans, 0), layout.glyphs[0].x);
  assert.equal(caret.offsetForPoint(source, layout.rows, layout.glyphs, spans, layout.glyphs[0].x, layout.rows[0].baseline, 120), 0);
});
