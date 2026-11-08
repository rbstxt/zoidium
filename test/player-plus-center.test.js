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
    assert.equal(center, width / 2);
    // The last control stays at the right edge, inside the padding.
    assert.equal(layout.right + (before - 8) + (after - 8), width - 5);
  }
});

test("current separator widths are measured out before recomputing", () => {
  const first = playSpaces({ ...layout, width: 1299 });
  const again = playSpaces({ width: 1299, before: first[0], after: first[1], right: 1294, playLeft: 295 + first[0] - 8, playWidth: 29 });
  assert.deepEqual(again, first);
});

test("a toolbar without room keeps the minimum separators and play moves as close as fits", () => {
  assert.deepEqual(playSpaces({ ...layout, width: 600 }), [8, 8]);
  const [before, after] = playSpaces({ ...layout, width: 700 });
  assert.equal(before, 18); assert.equal(after, 8);
});

test("play right of center never shrinks separators below the minimum", () => {
  assert.deepEqual(playSpaces({ width: 400, right: 380, before: 8, after: 8, playLeft: 300, playWidth: 29 }), [8, 23]);
});
