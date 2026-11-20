"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  class Effect {
    constructor() { this.parent = null; }
    get parentObject() { return null; }
    getAddress() { return [0]; }
    load() {}
    prepare() {}
    toJSON() { return { type: this.type }; }
  }
  Effect.create = type => {
    const effect = new Effect();
    effect.type = type;
    return effect;
  };
  class Edit {
    generateListItem(parent, object) {
      const row = { pz_object: object, button: null };
      row.ownerDocument = {
        createElement: () => ({
          className: "",
          type: "",
          textContent: "",
          style: {},
          title: "",
          attributes: {},
          setAttribute(key, value) { this.attributes[key] = value; },
          getAttribute(key) { return this.attributes[key]; },
          onclick: null,
        }),
      };
      row.children = [null, { prepend: button => { row.button = button; } }];
      row.querySelector = selector => (selector === ".zoidium-effect-bypass" ? row.button : null);
      return row;
    }
  }
  const window = { PZ: { effect: Effect, ui: { edit: Edit } }, WeakRef };
  vm.runInNewContext(fs.readFileSync("plugins/core/effect-bypass.js", "utf8"), { window });
  return window;
}

test("eye button uses dimmed struck-through state without combining character", () => {
  const window = setup();
  const api = window.PZ.zoidium.effectBypass;
  const effect = window.PZ.effect.create("test");
  const editor = { history: { operation: null, startOperation() {}, pushCommand() {}, finishOperation() {} } };
  const row = window.PZ.ui.edit.prototype.generateListItem.call({ editor, options: {} }, null, effect);
  const button = row.button;
  const combining = /[\u0300-\u036F\u20D0-\u20FF\uFE20-\uFE2F]/;

  assert.equal(button.textContent, "◉");
  assert.equal([...button.textContent].length, 1);
  assert.equal(combining.test(button.textContent), false);
  assert.equal(button.style.textDecoration, "none");
  assert.equal(button.style.opacity, "1");
  assert.equal(button.title, "Bypass effect");
  assert.equal(button.attributes["aria-label"], "Bypass effect");
  assert.equal(button.attributes["aria-pressed"], "true");

  effect.zoidiumBypassed = true;
  api.refresh();
  assert.equal(button.textContent, "◉");
  assert.equal([...button.textContent].length, 1);
  assert.equal(combining.test(button.textContent), false);
  assert.equal(button.style.textDecoration, "line-through");
  assert.equal(button.style.opacity, "0.45");
  assert.equal(button.title, "Enable effect");
  assert.equal(button.attributes["aria-label"], "Enable effect");
  assert.equal(button.attributes["aria-pressed"], "false");
});
