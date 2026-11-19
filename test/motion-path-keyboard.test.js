"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom.js");
const { createInteraction } = require("../plugins/motion-path/interaction.js");

test("composing or editable keys do not cancel an active motion path gesture", () => {
  const doc = new FakeElement("document"), canvas = new FakeElement("canvas"), viewport = new FakeElement("div"), win = new FakeElement("window");
  canvas.ownerDocument = doc;
  const key = { frame: 0, point: [0, 0], client: [0, 0], handles: {} };
  const model = { path: { id: "p", space: { plane: () => () => [0, 0] } }, keys: [key], frames: [0], channels: [{ editable: true }] };
  const interaction = createInteraction({ viewport: { el: viewport }, canvas, window: win, models: [model], selection: new Map(),
    editor: { playback: { currentFrame: 0 } }, requestDraw() {} });
  viewport.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  assert.ok(interaction.active);
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { target: { closest: () => ({}) } }]) {
    const event = doc.dispatch("keydown", { key: "Escape", ...extra });
    assert.ok(interaction.active);
    assert.equal(event.defaultPrevented, undefined);
  }
  doc.dispatch("keydown", { key: "Escape" });
  assert.equal(interaction.active, null);
  interaction.dispose();
});
