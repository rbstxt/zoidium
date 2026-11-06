"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/temporal-sampler-host.cjs");

test("unloading frame samplers releases native compositor pass geometries", async () => {
  const h = host(false);
  const disposed = new Set();
  function attach(compositor, id) {
    for (const key of ["copyPass", "mixPass"]) {
      compositor[key] ||= {};
      compositor[key].quad = { geometry: { dispose() { disposed.add(id + key); } } };
    }
  }
  attach(h.root, "root");
  for (let i = 0; i < 20; i++) {
    await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
    const runtime = h.state.frameSamplerRuntimes.get(h.root);
    assert.equal(runtime.captures.length, 1);
    attach(runtime.captures[0], String(i));
    h.state.releaseFrameSamplerTargets(h.owner);
    assert.ok(disposed.has(i + "copyPass"));
    assert.ok(disposed.has(i + "mixPass"));
  }
  h.root.unload();
  assert.ok(disposed.has("rootcopyPass"));
  assert.ok(disposed.has("rootmixPass"));
});
