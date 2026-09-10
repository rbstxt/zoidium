"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadColorCurves() {
  const source = fs.readFileSync(
    path.join(__dirname, "../plugins/native-fx/effects/colorcurves.js"),
    "utf8"
  );
  const effect = { properties: { addAll() {} } };
  const context = vm.createContext({
    console,
    effect,
    globalThis: null,
    PZ: {
      property: { type: { OPTION: 6, TEXT: 7 } },
    },
    THREE: {
      Vector2: class Vector2 {
        constructor(x, y) {
          this.x = x;
          this.y = y;
        }
      },
    },
    ZoidiumPluginApis: {
      propertyControls: { register() {} },
      defineFilter(spec) {
        this._spec = spec;
      },
    },
  });
  context.globalThis = context;
  vm.runInContext(`(function () {\n${source}\n}).call(effect);`, context);
  return { curves: context.ZoidiumColorCurves, spec: effect._spec };
}

function identityState() {
  return {
    version: 1,
    composite: [[0, 0], [1, 1]],
    red: [[0, 0], [1, 1]],
    green: [[0, 0], [1, 1]],
    blue: [[0, 0], [1, 1]],
  };
}

test("Color Curves builds an exact identity LUT by default", () => {
  const { curves, spec } = loadColorCurves();
  const lut = curves.buildLut(curves.defaultValue);
  assert.equal(spec.displayName, "Color Curves");
  assert.equal(lut.length, 256 * 4);
  for (let index = 0; index < 256; index += 1) {
    assert.deepEqual(Array.from(lut.slice(index * 4, index * 4 + 4)), [
      index,
      index,
      index,
      255,
    ]);
  }
});

test("Color Curves combines the composite curve with individual channels", () => {
  const { curves } = loadColorCurves();
  const state = identityState();
  state.composite = [[0, 0], [0.5, 0.75], [1, 1]];
  state.red = [[0, 0.2], [1, 1]];
  const lut = curves.buildLut(JSON.stringify(state));
  const middle = 128 * 4;
  assert.ok(lut[middle] > lut[middle + 1]);
  assert.ok(lut[middle + 1] > 180 && lut[middle + 1] < 200);
  assert.equal(lut[middle + 3], 255);
});
