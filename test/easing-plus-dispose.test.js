"use strict";

// A4: Easing+ registers cleanup with context.lifecycle.onDispose before each
// host mutation, so a failed activation rolls back fully. The first test
// throws mid-activation (inside the shape-preservation install, after the
// stylesheet and the earlier patches landed) and replays the collected
// disposers; the host must be pristine afterwards.

const assert = require("node:assert/strict");
const test = require("node:test");

const EasingPlus = require("../plugins/easing-plus/easing-plus");

function FakeElement() {
  return {
    children: [],
    id: "",
    rel: "",
    href: "",
    textContent: "",
    removeCalled: false,
    remove() {
      this.removeCalled = true;
    },
  };
}

function installFakes(throwOnProperties) {
  const created = [];
  const originals = {
    correctCurve(start, end) {
      return { start, end };
    },
    showEaseDropDown() {
      return "original";
    },
    createKeyframeControls() {
      return {};
    },
    moveKeyframe() {
      return "move";
    },
    setValue() {
      return "set";
    },
    startMove() {
      return "start";
    },
    finishMove() {
      return "finish";
    },
    scaleKeyframes() {
      return "scale";
    },
  };
  const propertiesPrototype = {
    moveKeyframe: originals.moveKeyframe,
    setValue: originals.setValue,
    startMove: originals.startMove,
    finishMove: originals.finishMove,
  };
  const keyframesPrototype = { scaleKeyframes: originals.scaleKeyframes };
  const controls = { createKeyframeControls: originals.createKeyframeControls };
  const ui = { controls };
  if (throwOnProperties) {
    Object.defineProperty(ui, "properties", {
      configurable: true,
      get() {
        throw new Error("mid-activation failure");
      },
    });
  } else {
    ui.properties = { prototype: propertiesPrototype };
  }
  const tween = { correctCurve: originals.correctCurve };
  const editor = { showEaseDropDown: originals.showEaseDropDown };
  const styleElement = FakeElement();
  const headChildren = [];
  const document = {
    getElementById: (id) => headChildren.find((child) => child.id === id) || null,
    createElement: (tag) => {
      const element = tag === "style" || tag === "link" ? styleElement : FakeElement();
      created.push(element);
      return element;
    },
    head: {
      appendChild(child) {
        headChildren.push(child);
      },
    },
    querySelectorAll: () => [],
  };
  const windowStub = { PZ: { tween, editor, ui, property: { dynamic: { keyframes: { prototype: keyframesPrototype } } } } };
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = windowStub;
  globalThis.document = document;
  return {
    originals,
    propertiesPrototype,
    keyframesPrototype,
    controls,
    tween,
    editor,
    styleElement,
    headChildren,
    restore() {
      globalThis.window = saved.window;
      globalThis.document = saved.document;
    },
  };
}

function makeContext(disposers, editor) {
  return {
    ui: null,
    editor: editor || {},
    getAsset: undefined,
    lifecycle: {
      onDispose(step) {
        disposers.push(step);
      },
    },
  };
}

test("a mid-activation throw rolls back through the registered disposers", () => {
  const fakes = installFakes(true);
  const disposers = [];
  try {
    assert.throws(
      () => EasingPlus.activate(makeContext(disposers)),
      /mid-activation failure/
    );
    assert.ok(disposers.length >= 4, `expected rollback steps, got ${disposers.length}`);
    for (const step of disposers.splice(0).reverse()) step();
    assert.equal(fakes.tween.correctCurve, fakes.originals.correctCurve);
    assert.equal(fakes.editor.showEaseDropDown, fakes.originals.showEaseDropDown);
    assert.equal(fakes.controls.createKeyframeControls, fakes.originals.createKeyframeControls);
    assert.equal(fakes.styleElement.removeCalled, true);
    assert.doesNotThrow(() => EasingPlus.deactivate());
    assert.equal(fakes.tween.correctCurve, fakes.originals.correctCurve);
  } finally {
    try {
      EasingPlus.deactivate();
    } catch (error) {
      // Already clean.
    }
    fakes.restore();
  }
});

test("a successful activation registers rollback steps and undoes everything", () => {
  const fakes = installFakes(false);
  const disposers = [];
  try {
    EasingPlus.activate(makeContext(disposers));
    assert.ok(disposers.length >= 6, `expected rollback steps, got ${disposers.length}`);
    EasingPlus.deactivate();
    assert.equal(fakes.tween.correctCurve, fakes.originals.correctCurve);
    assert.equal(fakes.editor.showEaseDropDown, fakes.originals.showEaseDropDown);
    assert.equal(fakes.controls.createKeyframeControls, fakes.originals.createKeyframeControls);
    assert.equal(fakes.propertiesPrototype.moveKeyframe, fakes.originals.moveKeyframe);
    assert.equal(fakes.propertiesPrototype.setValue, fakes.originals.setValue);
    assert.equal(fakes.propertiesPrototype.startMove, fakes.originals.startMove);
    assert.equal(fakes.propertiesPrototype.finishMove, fakes.originals.finishMove);
    assert.equal(fakes.keyframesPrototype.scaleKeyframes, fakes.originals.scaleKeyframes);
    for (const step of disposers.splice(0).reverse()) step();
    assert.equal(fakes.tween.correctCurve, fakes.originals.correctCurve);
  } finally {
    try {
      EasingPlus.deactivate();
    } catch (error) {
      // Already clean.
    }
    fakes.restore();
  }
});
