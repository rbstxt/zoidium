"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

global.PZ = { property: { type: { OPTION: 10, NUMBER: 0 } } };
require("../zoidium/plugin-apis.js");
const apis = global.ZoidiumPluginApis;

function toFailAfter(ms, message) {
  return new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

function withTimeout(promise, ms, message) {
  return Promise.race([promise, toFailAfter(ms, message)]);
}

function temporalSpec(kind) {
  return {
    kind,
    displayName: "Posterize Time",
    properties: {
      enabled: { dynamic: true, name: "Enabled", value: 1 },
      fps: { dynamic: true, name: "Frame rate", value: 12 },
    },
    getOperator(effect, frame) {
      return {
        kind,
        enabled: effect.properties.enabled.get(frame) === 1,
        fps: Number(effect.properties.fps.get(frame)) || 1,
      };
    },
  };
}

function makeHostInstance() {
  const host = {
    type: "posterizetime",
    properties: {
      added: null,
      addAll(defs) {
        this.added = defs;
      },
      load() {},
    },
  };
  return host;
}

function frameSamplerSpec() {
  return {
    displayName: "Echo",
    properties: {
      enabled: { dynamic: true, name: "Enabled", value: 1 },
      echoes: { dynamic: true, name: "Echoes", value: 4 },
    },
    getRequest(effect, frame) {
      return {
        count: effect.properties.echoes.get(frame),
        offsetFrames: -3,
      };
    },
  };
}

test("defineTemporal replaces the inherited host load so CM3 base load terminates", async () => {
  const host = makeHostInstance();
  let baseCalls = 0;
  const factory = function factory() {
    apis.defineTemporal.call(this, temporalSpec("posterize-time"));
  };
  const ready = Promise.resolve(factory);
  async function baseLoad(data) {
    baseCalls += 1;
    if (baseCalls > 5) throw new Error("host load recursed");
    await ready;
    factory.call(host);
    await host.load(data);
  }
  host.load = baseLoad;
  await withTimeout(host.load({}), 2000, "temporal load hung");
  assert.equal(baseCalls, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(host, "load"), true);
  assert.equal(host._zoidiumTemporal.kind, "posterize-time");
  assert.deepEqual(Object.keys(host.properties.added), ["enabled", "fps"]);
  await withTimeout(host.load({}), 2000, "second temporal load hung");
  assert.equal(baseCalls, 1);
});

test("defineTemporal installs every lifecycle default as an own property", () => {
  const host = makeHostInstance();
  apis.defineTemporal.call(host, temporalSpec("time-offset"));
  for (const name of ["load", "update", "prepare", "resize", "unload", "toJSON"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(host, name), true, name);
  }
  assert.deepEqual(host.toJSON(), { type: "posterizetime", properties: host.properties });
});

test("defineTemporal keeps explicit lifecycle overrides", () => {
  const host = makeHostInstance();
  let customLoads = 0;
  const spec = temporalSpec("posterize-time");
  spec.lifecycle = {
    load() {
      customLoads += 1;
    },
  };
  apis.defineTemporal.call(host, spec);
  host.load({});
  assert.equal(customLoads, 1);
});

test("defineTemporal rejects unknown time kinds", () => {
  const host = makeHostInstance();
  assert.throws(() => apis.defineTemporal.call(host, temporalSpec("freeze")), /kind/);
});

test("defineFrameSampler installs a deterministic request descriptor", () => {
  const host = makeHostInstance();
  apis.defineFrameSampler.call(host, frameSamplerSpec());

  assert.equal(host.defaultName, "Echo");
  assert.equal(typeof host._zoidiumFrameSampler.getRequest, "function");
  assert.deepEqual(Object.keys(host.properties.added), ["enabled", "echoes"]);
  for (const name of ["load", "update", "prepare", "resize", "unload", "toJSON"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(host, name), true, name);
  }
});

test("defineFrameSampler rejects effects without a request function", () => {
  const host = makeHostInstance();
  const spec = frameSamplerSpec();
  delete spec.getRequest;
  assert.throws(() => apis.defineFrameSampler.call(host, spec), /getRequest/);
});

test("defineFrameSampler delegates asynchronous source preparation to the host", async () => {
  const host = makeHostInstance();
  const calls = [];
  global.PZ.zoidium = {
    temporal: {
      async prepareFrameSamples(effect, frame, context) {
        calls.push({ effect, frame, context });
      },
    },
  };
  apis.defineFrameSampler.call(host, frameSamplerSpec());
  const context = { id: "export" };

  await host.prepare(18, context);

  assert.deepEqual(calls, [{ effect: host, frame: 18, context }]);
  delete global.PZ.zoidium;
});
