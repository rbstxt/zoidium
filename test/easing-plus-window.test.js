"use strict";

// Easing+ opens its curve editor as a shared floating window (context.ui)
// instead of a fullscreen overlay. These checks drive the patched ease
// dropdown against a minimal DOM stub.

const assert = require("node:assert/strict");
const test = require("node:test");

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.innerHTML = "";
    this.textContent = "";
    this.parentElement = null;
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains() { return false; }
  focus() {}
  blur() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 520, height: 420, right: 520, bottom: 420 }; }
}

function installGlobals() {
  const calls = { documentListeners: [], history: [] };
  const document = {
    body: new FakeElement("body"),
    head: new FakeElement("head"),
    activeElement: null,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (namespace, tag) => new FakeElement(tag),
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: (type) => calls.documentListeners.push(type),
    removeEventListener() {},
  };
  class KeyframesChannel {}
  class GroupChannel {}
  const windowStub = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
    PZ: {
      tween: { correctCurve: () => 1 },
      editor: { showEaseDropDown: () => "original" },
      property: { dynamic: { group: GroupChannel, keyframes: KeyframesChannel } },
      ui: {
        properties: class {},
        controls: {},
      },
    },
  };
  globalThis.window = windowStub;
  globalThis.document = document;
  return { calls, document, windowStub, KeyframesChannel };
}

function makeEditor(calls) {
  return {
    playback: { currentFrame: 60 },
    project: {},
    history: {
      startOperation() { calls.history.push("start"); },
      finishOperation() { calls.history.push("finish"); },
    },
  };
}

function makeEaseButton(property, calls) {
  const interpolation = new FakeElement("button");
  interpolation.pz_value = 1;
  interpolation.querySelector = () => null;
  const controlRow = new FakeElement("div");
  controlRow.querySelector = (selector) => (selector === "button.pz-tweens" ? interpolation : null);
  const holder = new FakeElement("div");
  const propertyRow = new FakeElement("div");
  const controlsHost = new FakeElement("div");
  holder.parentElement = propertyRow;
  controlRow.parentElement = holder;
  propertyRow.parentElement = controlsHost;
  propertyRow.pz_object = property;
  controlsHost.pz_controls = { editor: makeEditor(calls) };
  const button = new FakeElement("button");
  button.parentElement = controlRow;
  return button;
}

test("Easing+ opens its curve editor as a floating window, not a fullscreen overlay", () => {
  const { calls, document, windowStub, KeyframesChannel } = installGlobals();
  const EasingPlus = require("../plugins/easing-plus/easing-plus");
  const numbers = [];
  const opened = [];
  const ui = {
    controls: {
      number(options) {
        const control = { options, value: options.value, element: new FakeElement("div") };
        control.get = () => control.value;
        control.set = (value) => { control.value = value; };
        numbers.push(control);
        return control;
      },
      section() {
        return { element: new FakeElement("section"), body: new FakeElement("div") };
      },
    },
    openWindow(options) {
      let cleanup = null;
      const handle = {
        id: options.id,
        element: new FakeElement("section"),
        closed: false,
        close() {
          if (this.closed) return;
          this.closed = true;
          if (cleanup) cleanup();
          if (options.onClose) options.onClose();
        },
      };
      cleanup = options.mount(new FakeElement("div"), handle) || null;
      opened.push({ options, handle });
      return handle;
    },
  };

  const property = Object.assign(new KeyframesChannel(), {
    frameOffset: 0,
    definition: { name: "Position X" },
    parentObject: {},
    getKeyframe: () => current,
    getPreviousKeyframe: () => previous,
  });
  const current = { frame: 60, value: 1, controlPoints: [[-10, 0], [0, 0]] };
  const previous = { frame: 30, value: 0, controlPoints: [[0, 0], [10, 0]] };
  EasingPlus.activate({ ui, editor: makeEditor(calls), getAsset: undefined });
  assert.deepEqual(calls.documentListeners, [], "no document-level key handler");

  windowStub.PZ.editor.showEaseDropDown(makeEaseButton(property, calls));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].options.id, "curve-editor");
  assert.equal(opened[0].options.className, "easing-plus-window");
  assert.equal(opened[0].options.persistKey, "curve-editor");
  assert.equal(opened[0].options.subtitle, "Position X");
  assert.equal(document.body.children.length, 0, "no overlay appended to the document body");
  assert.equal(numbers.length, 4, "handle fields are CM3-style number controls");

  // Reopening replaces the previous editor instead of focusing a stale one.
  windowStub.PZ.editor.showEaseDropDown(makeEaseButton(property, calls));
  assert.equal(opened[0].handle.closed, true);
  assert.equal(opened.length, 2);
  assert.equal(opened[1].handle.closed, false);

  // An untouched curve closes without writing history.
  EasingPlus.deactivate();
  assert.equal(opened[1].handle.closed, true);
  assert.deepEqual(calls.history, []);
});

test("Easing+ commits an edited curve once when its window closes", () => {
  const { calls, windowStub, KeyframesChannel } = installGlobals();
  const EasingPlus = require("../plugins/easing-plus/easing-plus");
  const originalError = console.error;
  console.error = () => {};
  try {
    const numbers = [];
    const opened = [];
    const ui = {
      controls: {
        number(options) {
          const control = { options, value: options.value, element: new FakeElement("div") };
          control.get = () => control.value;
          control.set = (value) => { control.value = value; };
          numbers.push(control);
          return control;
        },
        section() {
          return { element: new FakeElement("section"), body: new FakeElement("div") };
        },
      },
      openWindow(options) {
        let cleanup = null;
        const handle = {
          element: new FakeElement("section"),
          closed: false,
          close() {
            if (this.closed) return;
            this.closed = true;
            if (cleanup) cleanup();
            if (options.onClose) options.onClose();
          },
        };
        cleanup = options.mount(new FakeElement("div"), handle) || null;
        opened.push(handle);
        return handle;
      },
    };
    const property = Object.assign(new KeyframesChannel(), {
      frameOffset: 0,
      definition: {},
      parentObject: {},
      getKeyframe: () => current,
      getPreviousKeyframe: () => previous,
    });
    const current = { frame: 60, value: 1, controlPoints: [[-10, 0], [0, 0]] };
    const previous = { frame: 30, value: 0, controlPoints: [[0, 0], [10, 0]] };

    EasingPlus.activate({ ui, editor: makeEditor(calls), getAsset: undefined });
    windowStub.PZ.editor.showEaseDropDown(makeEaseButton(property, calls));
    assert.equal(opened.length, 1);

    // Typing into a handle field goes through onChange and marks the curve dirty.
    numbers[0].value = 0.25;
    numbers[0].options.onChange(0.25);
    assert.deepEqual(calls.history, [], "nothing is recorded until the window closes");

    opened[0].close();
    assert.deepEqual(calls.history, ["start", "finish"]);
    EasingPlus.deactivate();
    assert.deepEqual(calls.history, ["start", "finish"], "closing again does not commit twice");
  } finally {
    console.error = originalError;
  }
});
