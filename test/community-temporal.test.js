"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/temporal-sampler-host.cjs");

test("isolated preflight is awaited at the exact control clock before the synchronous getter", async () => {
  const h = host(false), calls = [];
  let ready = false, resume;
  h.effect._zoidiumFrameSampler = {
    async preflight(_effect, frame, context) {
      calls.push(["preflight", frame, context.frameSamplerDepth]);
      await new Promise(resolve => { resume = resolve; }); ready = true;
    },
    getRequest(_effect, frame) { assert.ok(ready); calls.push(["get", frame]); return null; },
  };
  const work = h.effect.prepare(20.125, { frameSamplerRoot: h.root });
  assert.deepEqual(calls, [["preflight", 20.125, 1]]);
  resume(); await work;
  assert.deepEqual(calls, [["preflight", 20.125, 1], ["get", 20.125]]);
});

test("a failed isolated preflight never calls the synchronous getter or decoder", async () => {
  const h = host(false);
  h.effect._zoidiumFrameSampler = {
    resourcePolicy: { check() {} },
    preflight() { throw new Error("LOCAL_DEPENDENCY_UNAVAILABLE: unavailable fixture"); },
    getRequest() { assert.fail("getter ran after failed preflight"); },
  };
  await assert.rejects(h.effect.prepare(20.5), /LOCAL_DEPENDENCY_UNAVAILABLE/);
  assert.equal(h.decoded.length, 0);
});
