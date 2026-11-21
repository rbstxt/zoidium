"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./fake-dom.js");
const { createQualityMenu, createOverflow } = require("../plugins/player-plus/toolbar-menus.js");

test("quality menu reflects and changes quality, adaptive, and limit", () => {
  const document = makeDocument();
  const state = { quality: 1, effective: 1, enabled: false, limit: "auto" };
  const menu = createQualityMenu(document, { getState: () => state,
    setQuality: value => { state.quality = state.effective = value; },
    setAdaptive: value => { state.enabled = value; }, setLimit: value => { state.limit = value; } });
  const popup = document.body.children[0];
  assert.equal(menu.button.textContent, "Full");
  popup.children[2].dispatch("click"); assert.equal(state.quality, 0.25);
  const checkbox = popup.children[4].children[0]; checkbox.checked = true; checkbox.dispatch("change");
  assert.equal(state.enabled, true); assert.equal(popup.children[5].hidden, false);
  const select = popup.children[5].children[1]; select.value = "0.125"; select.dispatch("change");
  assert.equal(state.limit, "0.125"); state.effective = 0.125; menu.update();
  assert.equal(menu.button.textContent, "Auto · 1/8");
  menu.dispose(); assert.equal(document.body.children.length, 0);
});

test("overflow moves controls as width changes and cleans up", () => {
  const document = makeDocument(), toolbar = document.createElement("div");
  const native = document.createElement("button"), a = document.createElement("button"), b = document.createElement("button");
  toolbar.appendChild(native); toolbar.appendChild(a); toolbar.appendChild(b);
  for (const [node, left, width] of [[native, 0, 100], [a, 100, 30], [b, 130, 30]]) {
    node.offsetParent = toolbar; node.offsetLeft = left; node.offsetWidth = width;
  }
  toolbar.clientWidth = 200;
  const overflow = createOverflow(document, toolbar, [a, b]);
  assert.equal(overflow.layout(), false);
  toolbar.clientWidth = 150; assert.equal(overflow.layout(), true);
  assert.equal(a.parentElement, document.body.children[0]);
  // Simulate the browser recalculating positions after the move.
  b.offsetLeft = 100; toolbar.clientWidth = 200;
  assert.equal(overflow.layout(), true); assert.equal(a.parentElement, toolbar);
  overflow.dispose(); assert.equal(document.body.children.length, 0);
});

test("extreme overflow compresses spacing and restores it on widen and dispose", () => {
  const document = makeDocument(), toolbar = document.createElement("div");
  const native = document.createElement("button"), control = document.createElement("button");
  toolbar.appendChild(native); toolbar.appendChild(control);
  native.offsetParent = toolbar; native.offsetLeft = 0; native.offsetWidth = 29;
  control.offsetParent = toolbar; control.offsetLeft = 29; control.offsetWidth = 30;
  toolbar.clientWidth = 40;
  const overflow = createOverflow(document, toolbar, [control]);
  overflow.layout();
  assert.equal(toolbar.classList.contains("is-player-plus-compressed"), true);
  assert.equal(native.offsetWidth, 29);
  toolbar.clientWidth = 200;
  overflow.layout();
  assert.equal(toolbar.classList.contains("is-player-plus-compressed"), false);
  toolbar.clientWidth = 40; overflow.layout();
  overflow.dispose();
  assert.equal(toolbar.classList.contains("is-player-plus-compressed"), false);
});
