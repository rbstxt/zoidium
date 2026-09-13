"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const PlayerPlus = require("../plugins/player-plus/player-plus.js");

test("Player+ keeps full quality in the free 3D scene preview", () => {
  assert.equal(PlayerPlus._test.isScenePreview({ edit: true }), true);
  assert.equal(
    PlayerPlus._test.getViewportQuality({ renderMode: true }, 0.25),
    1,
  );
  assert.equal(
    PlayerPlus._test.getViewportQuality({ edit: false, renderMode: false }, 0.25),
    0.25,
  );
});
