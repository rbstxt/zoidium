"use strict";

// Shape+ loads the variable twin for built-in presets. When the variable
// file fails to load (stale stage, bad cache), prepare() must fall back to
// the static preset instead of landing in missing/error, and note the
// fallback on the record (node.textState.variableFallback).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const { createService } = require("../plugins/shape-plus/text-service");

const PRESET_REF = "/assets/fonts/2d/geist mono.ttf";
const VARIABLE_REF = "/assets/fonts/2d-variable/geist mono.ttf";

function repoBytes(relativePath) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function makeContext(failVariable) {
  const PZ = {
    project: class FakeProject {},
    property: { type: { NUMBER: "number" } },
    asset: {
      source: { PRESET: 3, FILE: 1 },
      font: class FakeFontWrapper {
        constructor(asset) {
          this.asset = asset;
        }

        async readFileRemote() {
          if (this.asset.key === VARIABLE_REF && failVariable) {
            throw new Error("The file is missing from the project.");
          }
          if (this.asset.key === VARIABLE_REF) return repoBytes("fonts/presets-variable/geist mono.ttf");
          if (this.asset.key === PRESET_REF) return repoBytes("fonts/presets/geist mono.ttf");
          throw new Error(`unexpected font reference: ${this.asset.key}`);
        }
      },
    },
  };
  const getAsset = (kind, reference) => {
    if (kind === "text" && reference.endsWith("harfbuzz.wasm.base64")) {
      return fs.readFileSync(
        path.join(root, "plugins", "shape-plus", "vendor", "harfbuzz.wasm.base64"), "utf8");
    }
    throw new Error(`unexpected asset request: ${kind} ${reference}`);
  };
  return { PZ, getAsset, lifecycle: { onDispose() {} } };
}

function makeNode(fontRef, fallbackRef = null) {
  const property = (ref) => ({
    expression: undefined,
    keyframes: undefined,
    data: undefined,
    get: () => ref,
  });
  const project = {
    assets: {
      load: (ref) => ({ source: 3, file: null, key: ref }),
      unload: () => {},
    },
  };
  const properties = {
    font: property(fontRef),
    fallbackFont: property(fallbackRef),
    fontStyle: { animated: false, definition: { items: [] } },
    add(key, definition) {
      this[key] = { definition, load() {} };
    },
    remove(key) {
      delete this[key];
    },
  };
  return {
    properties,
    textFrame: 0,
    tryGetParentOfType: () => project,
  };
}

test("variable failure falls back to the static preset and notes it", async () => {
  const service = createService(makeContext(true));
  const node = makeNode(PRESET_REF);
  await service.prepare(node);
  assert.equal(node.textState.state, "ready");
  assert.equal(node.textState.variableFallback, true);
  assert.equal(node.textState.primary.reference, PRESET_REF);
  assert.deepEqual(node.textState.primary.axes, {});
  service.release(node);
});

test("working variable file loads with axes and no fallback note", async () => {
  const service = createService(makeContext(false));
  const node = makeNode(PRESET_REF);
  await service.prepare(node);
  assert.equal(node.textState.state, "ready");
  assert.ok(!node.textState.variableFallback);
  assert.equal(node.textState.primary.reference, VARIABLE_REF);
  assert.deepEqual(Object.keys(node.textState.primary.axes), ["wght"]);
  service.release(node);
});
