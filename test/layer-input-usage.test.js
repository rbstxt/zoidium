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
