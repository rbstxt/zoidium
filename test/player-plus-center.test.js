"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { playSpaces } = require("../plugins/player-plus/player-plus.js");

// Layout of the default toolbar at 8px separators: play starts at 295px, the
// last control ends at 685px.
const layout = { right: 685, before: 8, after: 8, playLeft: 295, playWidth: 29 };

test("separators put play at the toolbar center when there is room", () => {
  for (const width of [800, 1299, 2099]) {
    const [before, after] = playSpaces({ ...layout, width });
    const center = layout.playLeft + (before - 8) + layout.playWidth / 2;
    // Separators are whole pixels, so play sits within half a pixel of center.
    assert.ok(Math.abs(center - width / 2) <= 0.5);
    assert.ok(Number.isInteger(before) && Number.isInteger(after));
    // The last control stays one pixel inside the padding, so fractional
    // control widths can never overflow into a scrollbar.
    assert.equal(layout.right + (before - 8) + (after - 8), width - 6);
  }
});

test("current separator widths are measured out before recomputing", () => {
  const first = playSpaces({ ...layout, width: 1299 });
  const again = playSpaces({ width: 1299, before: first[0], after: first[1], right: 1293, playLeft: 295 + first[0] - 8, playWidth: 29 });
  assert.deepEqual(again, first);
});

test("a toolbar without room keeps the minimum separators and play moves as close as fits", () => {
  assert.deepEqual(playSpaces({ ...layout, width: 600 }), [8, 8]);
  const [before, after] = playSpaces({ ...layout, width: 700 });
  assert.equal(before, 17); assert.equal(after, 8);
});

test("play right of center never shrinks separators below the minimum", () => {
  assert.deepEqual(playSpaces({ width: 400, right: 380, before: 8, after: 8, playLeft: 300, playWidth: 29 }), [8, 22]);
});

test("separators never fill fractional room up to the edge", () => {
  // A toolbar at a fractional width (zoom or display scaling): the slack is floored and
  // one pixel stays free, so the real content width stays below the box.
  const [before, after] = playSpaces({ ...layout, width: 1299.4 });
  const contentRight = layout.right + (before - 8) + (after - 8) + 5;
  assert.ok(contentRight <= 1299.4 - 1);
  assert.equal(Number.isInteger(before + after), true);
});

test("recomputing from the rounded layout it produced gives the same widths", () => {
  // Offsets are measured as whole pixels; with whole-pixel separators the next
  // pass sees exactly the layout it set, so it never alternates.
  for (const width of [801, 1000, 1299, 1920, 2099]) {
    const first = playSpaces({ ...layout, width });
    const right = layout.right + (first[0] - 8) + (first[1] - 8);
    const again = playSpaces({ width, before: first[0], after: first[1], right, playLeft: layout.playLeft + first[0] - 8, playWidth: 29 });
    assert.deepEqual(again, first);
  }
});
