"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDocument } = require("./fake-dom.js");
const { createQualityMenu, createOverflow } = require("../plugins/player-plus/toolbar-menus.js");

const ADAPTIVE_HINT = "Lowers quality while playback is slow. Lowest is the limit.";

function qualityOptions(state) {
  return { getState: () => state,
    setQuality: value => { state.quality = state.effective = value; },
    setAdaptive: value => { state.enabled = value; }, setLimit: value => { state.limit = value; },
    setUpscale: value => { state.upscale = value; }, setExact: value => { state.exact = value; } };
}

test("quality menu reflects and changes quality, adaptive, and limit", () => {
  const document = makeDocument();
  const state = { quality: 1, effective: 1, enabled: false, limit: "auto" };
  const menu = createQualityMenu(document, qualityOptions(state));
  const popup = document.body.children[0];
  assert.equal(menu.button.textContent, "Full");
  popup.children[2].dispatch("click"); assert.equal(state.quality, 0.25);
  const checkbox = popup.querySelector(".zoidium-player-plus-adaptive");
  checkbox.checked = true; checkbox.dispatch("change");
  assert.equal(state.enabled, true);
  const select = popup.querySelector(".zoidium-player-plus-limit");
  assert.equal(select.parentElement.hidden, false);
  select.value = "0.125"; select.dispatch("change");
  assert.equal(state.limit, "0.125"); state.effective = 0.125; menu.update();
  assert.equal(menu.button.textContent, "Auto · 1/8");
  menu.dispose(); assert.equal(document.body.children.length, 0);
});

test("quality menu explains adaptive quality and shows the effective quality", () => {
  const document = makeDocument();
  const state = { quality: 1, effective: 1, enabled: true, limit: "auto" };
  const menu = createQualityMenu(document, qualityOptions(state));
  const popup = document.body.children[0];
  const hint = popup.querySelector(".zoidium-player-plus-hint");
  assert.ok(hint, "the menu shows an adaptive hint");
  assert.equal(hint.textContent, ADAPTIVE_HINT);
  const adaptive = popup.querySelector(".zoidium-player-plus-adaptive");
  assert.equal(adaptive.title, ADAPTIVE_HINT);
  assert.equal(popup.querySelector(".zoidium-player-plus-limit").title, ADAPTIVE_HINT);
  assert.equal(hint.parentElement, popup);
  assert.equal(popup.children[popup.children.indexOf(adaptive.parentElement) + 1], hint);
  assert.equal(menu.button.textContent, "Full");
  state.effective = 0.5; menu.update();
  assert.equal(menu.button.textContent, "Auto · 1/2");
  menu.dispose();
});

test("the history reads the Exact toggle and explains the adaptive hint for it", () => {
  const document = makeDocument();
  const state = { quality: 0.5, effective: 0.5, enabled: true, limit: "auto",
    upscale: "sharp", exact: true, exactAvailable: true, exactReason: "" };
  const menu = createQualityMenu(document, qualityOptions(state));
  const popup = document.body.children[0];
  assert.equal(popup.querySelector(".zoidium-player-plus-upscale").value, "sharp");
  const exact = popup.querySelector(".zoidium-player-plus-exact");
  assert.equal(exact.checked, true);
  assert.equal(exact.disabled, false);
  assert.match(exact.title, /sequence resolution/);
  assert.match(popup.querySelector(".zoidium-player-plus-hint").textContent, /viewport size/);
  const upscale = popup.querySelector(".zoidium-player-plus-upscale");
  upscale.value = "smooth"; upscale.dispatch("change");
  assert.equal(state.upscale, "smooth");
  exact.checked = false; exact.dispatch("change");
  assert.equal(state.exact, false);
  state.exact = true; state.exactAvailable = false;
  state.exactReason = "Exact effects are unavailable above 4096 px on a side (5000 × 2800).";
  menu.update();
  assert.equal(exact.disabled, true);
  assert.match(exact.title, /4096 px/);
  assert.equal(popup.querySelector(".zoidium-player-plus-hint").textContent, ADAPTIVE_HINT);
  menu.dispose();
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
