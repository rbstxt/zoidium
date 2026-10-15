"use strict";

// Fix test for A4: Matcap (material-plus.js) and UV Custom (uv-custom.js)
// register lifecycle cleanup before mutating the host material registry.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const Matcap = require("../plugins/material-plus/material-plus.js");
const UvCustom = require("../plugins/material-plus/uv-custom.js");

function trackedVariants() {
  const events = [];
  const disposers = [];
  const fnList = new Proxy({}, {
    set(target, key, value) {
      events.push(`mutate:${String(key)}`);
      target[key] = value;
      return true;
    },
    deleteProperty(target, key) {
      events.push(`unmutate:${String(key)}`);
      delete target[key];
      return true;
    },
  });
  const context = {
    PZ: {
      material: { fnList },
      asset: { type: { IMAGE: "image" }, image: class {} },
      property: { type: { ASSET: "asset", COLOR: "color", NUMBER: "number", OPTION: "option", VECTOR2: "vector2" } },
    },
    window: { THREE: { ShaderMaterial: class {}, MeshStandardMaterial: class {} } },
    plugin: { id: "material-plus", version: "11" },
    lifecycle: { onDispose(fn) { events.push("dispose"); disposers.push(fn); } },
    getAsset(kind, name) {
      if (String(name).includes("uv-layout.js")) {
        return fs.readFileSync(require.resolve("../plugins/material-plus/uv-layout.js"), "utf8");
      }
      return "void main() {}";
    },
  };
  return { events, disposers, context, fnList };
}

test("Matcap registers disposal before mutating the host factory", () => {
  const { events, disposers, context } = trackedVariants();
  Matcap.activate(context);
  assert.deepEqual(events, ["dispose", "mutate:matcap"]);
  assert.equal(typeof context.PZ.material.fnList.matcap, "object");
  for (const dispose of disposers.reverse()) dispose();
  assert.equal("matcap" in context.PZ.material.fnList, false);
  assert.deepEqual(events.at(-1), "unmutate:matcap");
});

test("UV Custom registers disposal before mutating the host factory", () => {
  const { events, disposers, context } = trackedVariants();
  UvCustom.activate(context);
  assert.deepEqual(events, ["dispose", "mutate:uvcustom"]);
  assert.equal(typeof context.PZ.material.fnList.uvcustom, "object");
  for (const dispose of disposers.reverse()) dispose();
  assert.equal("uvcustom" in context.PZ.material.fnList, false);
  assert.deepEqual(events.at(-1), "unmutate:uvcustom");
});
