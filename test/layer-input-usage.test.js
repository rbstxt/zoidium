"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const LayerInput = require("../plugins/layer-input/layer-input");

function createContext() {
  const project = {};
  const style = {
    id: "",
    textContent: "",
    remove() {},
  };
  return {
    project,
    context: {
      editor: { project },
      PZ: {
        property: { type: { LIST: 10 } },
        ui: {
          objectTypes: { get: () => [] },
        },
      },
      document: {
        activeElement: null,
        createElement: () => style,
        getElementById: () => null,
        head: { appendChild() {} },
      },
      window: {
        clearTimeout,
        setTimeout,
      },
    },
  };
}

function createCompositorContext() {
  const context = createContext();
  let originalCalls = 0;
  let originalArguments = null;

  class Group {}
  class Compositor {
    renderSequence() {}
    renderEffects(effects, width, height) {
      originalCalls += 1;
      originalArguments = [effects, width, height];
    }
    unload() {}
  }

  context.context.PZ.compositor = Compositor;
  context.context.PZ.effect = { group: Group };
  context.originalRenderEffects = Compositor.prototype.renderEffects;
  context.renderState = {
    get originalCalls() {
      return originalCalls;
    },
    get originalArguments() {
      return originalArguments;
    },
  };
  return context;
}

test("Layer Input counts only Custom Shaders that have a Layer Input property", () => {
  const { context, project } = createContext();
  const api = LayerInput.activate(context);
  try {
    const ordinaryShader = {
      type: 1,
      parentProject: project,
      customProperties: [],
    };
    api.registerConsumer(ordinaryShader);
    assert.equal(LayerInput.isInUse(), false);

    const layerProperty = {
      definition: {
        _zoidiumLayerSource: true,
        _zoidiumShaderLayerSource: true,
      },
      get: () => "",
    };
    const layerShader = {
      type: 1,
      parentProject: project,
      customProperties: [layerProperty],
    };
    api.registerConsumer(layerShader);
    assert.equal(LayerInput.isInUse(), true);

    api.unregisterConsumer(layerShader);
    assert.equal(LayerInput.isInUse(), false);
  } finally {
    LayerInput.deactivate();
  }
});

test("Custom Shader Layer Input stores an independent capture mode per property", () => {
  const { context, project } = createContext();
  const api = LayerInput.activate(context);
  try {
    const sharedType = {
      custom: true,
      _zoidiumLayerInputMode: "effects-masks",
    };
    const firstProperty = {
      definition: {
        _zoidiumLayerSource: true,
        _zoidiumShaderLayerSource: true,
      },
      type: sharedType,
      get: () => "",
      onChanged: { update() {} },
    };
    const secondProperty = {
      definition: {
        _zoidiumLayerSource: true,
        _zoidiumShaderLayerSource: true,
      },
      type: sharedType,
      get: () => "",
    };
    const shader = {
      type: 1,
      parentProject: project,
      customProperties: [firstProperty, secondProperty],
    };
    firstProperty.parentObject = shader;
    secondProperty.parentObject = shader;

    assert.deepEqual(api.getSourceModeOptions(), [
      { value: "source", label: "Source" },
      { value: "masks", label: "Masks" },
      { value: "effects-masks", label: "Effects & Masks" },
    ]);
    assert.equal(api.getSourceMode(shader, firstProperty), "effects-masks");
    assert.equal(api.setSourceMode(shader, "masks", { sourceProperty: firstProperty }), true);
    assert.equal(api.getSourceMode(shader, firstProperty), "masks");
    assert.equal(api.getSourceMode(shader, secondProperty), "effects-masks");
    assert.equal(firstProperty.type._zoidiumLayerInputMode, "masks");
    assert.equal(secondProperty.type, sharedType);
    assert.equal(shader.fragmentShaderNeedsUpdate, true);

    assert.equal(api.setSourceMode(shader, "unknown", { sourceProperty: firstProperty }), true);
    assert.equal(api.getSourceMode(shader, firstProperty), "effects-masks");
  } finally {
    LayerInput.deactivate();
  }
});

test("Layer Input captures the selected compositor stage", () => {
  const fixture = createCompositorContext();
  const { context, originalRenderEffects, renderState } = fixture;
  LayerInput.activate(context);
  try {
    const rendered = [];
    const pass = (name) => ({
      enabled: true,
      needsSwap: true,
      uniforms: {
        uvScale: {
          value: {
            set() {},
          },
        },
      },
      render() {
        rendered.push(name);
      },
    });
    const source = { type: "source", pass: pass("source") };
    const mask = { type: "mask", pass: pass("mask") };
    const effect = { type: "blur", pass: pass("effect") };
    const groupMask = { type: "mask", pass: pass("group-mask") };
    const group = Object.assign(new context.PZ.effect.group(), {
      enabled: true,
      objects: [groupMask, effect],
    });
    const compositor = {
      renderer: {},
      writeBuffer: {},
      readBuffer: {},
      swapBuffers() {},
    };

    compositor.__zoidiumLayerInputMode = "source";
    context.PZ.compositor.prototype.renderEffects.call(
      compositor,
      [source, mask, effect, group],
      0.5,
      0.75,
    );
    assert.deepEqual(rendered, []);
    assert.equal(renderState.originalCalls, 0);

    compositor.__zoidiumLayerInputMode = "masks";
    context.PZ.compositor.prototype.renderEffects.call(
      compositor,
      [source, mask, effect, group],
      0.5,
      0.75,
    );
    assert.deepEqual(rendered, ["mask", "group-mask"]);
    assert.equal(renderState.originalCalls, 0);

    compositor.__zoidiumLayerInputMode = "effects-masks";
    context.PZ.compositor.prototype.renderEffects.call(
      compositor,
      [source, mask, effect, group],
      0.5,
      0.75,
    );
    assert.equal(renderState.originalCalls, 1);
    assert.deepEqual(renderState.originalArguments, [
      [source, mask, effect, group],
      0.5,
      0.75,
    ]);
  } finally {
    LayerInput.deactivate();
  }
  assert.equal(context.PZ.compositor.prototype.renderEffects, originalRenderEffects);
});
