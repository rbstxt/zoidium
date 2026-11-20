"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  const listeners = {};
  const document = {
    createElement: () => ({
      className: "", type: "", textContent: "", style: {}, title: "", attributes: {},
      children: [], appendChild(child) { this.children.push(child); this.lastChild = child; },
      ownerDocument: document, setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return this.attributes[key]; }, focus() {},
      closest() { return this; },
    }),
    createElementNS() { return this.createElement(); },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; },
    elementFromPoint() { return this.target; },
    dispatch(type, event) { listeners[type]?.(event); },
  };
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
      row.ownerDocument = document;
      const native = parent?.native ? [{ native: true }] : [];
      row.children = [null, { style: {}, children: native, appendChild(button) { this.children.push(button); row.button = button; } }];
      row.querySelector = selector => (selector === ".zoidium-effect-bypass" ? row.button : null);
      return row;
    }
  }
  const window = { PZ: { effect: Effect, ui: { edit: Edit } }, WeakRef };
  vm.runInNewContext(fs.readFileSync("plugins/core/effect-bypass.js", "utf8"), { window });
  window.document = document;
  return window;
}

test("eye button uses a dimmed struck-through state", () => {
  const window = setup();
  const api = window.PZ.zoidium.effectBypass;
  const effect = window.PZ.effect.create("test");
  const editor = { history: { operation: null, startOperation() {}, pushCommand() {}, finishOperation() {} } };
  const row = window.PZ.ui.edit.prototype.generateListItem.call({ editor, options: {} }, null, effect);
  const button = row.button;
  assert.equal(button.children[0].attributes.viewBox, "0 0 17 17");
  assert.equal(button.lastChild.style.display, "none");
  assert.equal(button.style.opacity, "1");
  assert.equal(button.title, "Bypass effect");
  assert.equal(button.attributes["aria-label"], "Bypass effect");
  assert.equal(button.attributes["aria-pressed"], "true");

  effect.zoidiumBypassed = true;
  api.refresh();
  assert.equal(button.lastChild.style.display, "block");
  assert.equal(button.style.opacity, "0.45");
  assert.equal(button.title, "Enable effect");
  assert.equal(button.attributes["aria-label"], "Enable effect");
  assert.equal(button.attributes["aria-pressed"], "false");
});


test("eyes occupy the last column with and without native buttons", () => {
  const w = setup(), edit = { editor: {}, options: {}, list: {} };
  for (const native of [false, true]) {
    const row = w.PZ.ui.edit.prototype.generateListItem.call(edit, { native }, w.PZ.effect.create("test"));
    assert.equal(row.children[1].children.at(-1), row.button);
    assert.equal(row.children[1].style.justifyContent, "flex-end");
    assert.equal(row.children[1].style.alignItems, "center");
  }
});

test("drag sets three eyes in one undo operation, and click toggles one", () => {
  const w = setup(), effects = [0, 1, 2].map(i => {
    const effect = w.PZ.effect.create("test"); effect.getAddress = () => [i]; return effect;
  });
  const operations = [], history = { operation: null,
    startOperation() { this.operation = []; },
    pushCommand(fn, data) { this.operation.push({ fn, data }); },
    finishOperation() { operations.push(this.operation); this.operation = null; },
  };
  const editor = { history, project: { addressLookup: address => effects[address[0]] } };
  const edit = { editor, options: {}, list: {} };
  const eyes = effects.map(effect => w.PZ.ui.edit.prototype.generateListItem.call(edit, {}, effect).button);
  const otherEdit = { editor, options: {}, list: {} };
  const outsider = w.PZ.ui.edit.prototype.generateListItem.call(otherEdit, {}, effects[2]).button;
  const event = { button: 0, pointerId: 1, currentTarget: eyes[0], stopPropagation() {}, preventDefault() {} };
  eyes[0].onpointerdown(event);
  w.document.target = outsider; w.document.dispatch("pointermove", event);
  assert.equal(effects[2].zoidiumBypassed, undefined);
  for (const eye of eyes.slice(1)) { w.document.target = eye; w.document.dispatch("pointermove", event); }
  w.document.dispatch("pointerup", event);
  assert.deepEqual(effects.map(effect => effect.zoidiumBypassed), [true, true, true]);
  assert.equal(operations.length, 1);
  assert.equal(operations[0].length, 3);
  history.startOperation();
  for (const command of operations[0].slice().reverse()) command.fn(command.data);
  history.finishOperation();
  assert.deepEqual(effects.map(effect => effect.zoidiumBypassed), [false, false, false]);
  eyes[1].onclick({ detail: 0, stopPropagation() {} });
  assert.deepEqual(effects.map(effect => effect.zoidiumBypassed), [false, true, false]);
  const touch = { ...event, pointerId: 2, pointerType: "touch", currentTarget: eyes[0] };
  eyes[0].onpointerdown(touch);
  w.document.target = eyes[2]; w.document.dispatch("pointermove", touch);
  w.document.dispatch("pointercancel", touch);
  assert.deepEqual(effects.map(effect => effect.zoidiumBypassed), [true, true, true]);
  assert.equal(history.operation, null);
});
