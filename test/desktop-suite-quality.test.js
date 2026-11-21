"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { selectPreviewQuality } = require("../tools/select-preview-quality");

test("desktop quality helper opens the overflow and chooses 1/8 quality", async () => {
  const calls = [];
  const quality = { evaluate: async fn => fn({ tagName: "BUTTON" }), isVisible: async () => false, click: async () => calls.push("quality") };
  const overflow = { click: async () => calls.push("overflow"), getAttribute: async () => "true" };
  const page = { locator: selector => selector === ".zoidium-player-plus-overflow" ? overflow : quality, getByRole: (role, options) => {
    assert.equal(role, "menuitemradio");
    assert.equal(options.name, "1/8 quality");
    return { click: async () => calls.push("choice") };
  } };
  await selectPreviewQuality(page, "0.125");
  assert.deepEqual(calls, ["overflow", "quality", "choice", "overflow"]);
});
