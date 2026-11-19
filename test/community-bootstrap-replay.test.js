"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunner } = require("../zoidium/community-bootstrap");
const { hashBytes } = require("../zoidium/community-plugin-store");
const V = require("../zoidium/community-protocol");
const manifest = require("../examples/community-filter/manifest.json");

async function fixture(t) {
  class Channel {
    constructor() {
      this.port1 = { close() {}, postMessage: message => {
        if (message.terminate) return;
        queueMicrotask(() => this.port1.onmessage({ ports: [], data: { ...message, operation: "ready", payload: {} } }));
      } };
      this.port2 = { close() {} };
      Channel.current = this;
    }
  }
  const prior = new Map(); let runner;
  t.after(() => {
    runner?.dispose();
    for (const [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  for (const [name, value] of Object.entries({ MessageChannel: Channel, ZoidiumDesktopCommunity: {},
    location: { origin: "http://localhost" }, addEventListener() {}, removeEventListener() {},
    window: { postMessage() { queueMicrotask(() => Channel.current.port1.onmessage({ ports: [], data: { booted: true } })); } },
  })) {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, manifest, assets: { [manifest.entry]: "" } }));
  runner = await createRunner({ bytes, approvedHash: await hashBytes(bytes), runtimeSource: "trusted" });
  const message = { protocolVersion: 1, interpreterVersion: V.INTERPRETER, ...runner.binding,
    instanceId: "instance", instanceGeneration: 1, projectGeneration: 1, revision: 1,
    frameKey: "frame", operation: "initialize", payload: {} };
  return { runner, send: id => runner.request({ ...message, requestId: "request-" + id }) };
}
test("browser broker accepts long sessions and out-of-order IDs within the replay window", async t => {
  const f = await fixture(t);
  for (let i = 1; i <= 10000; i++) await f.send(i);
  await f.send(10002); await f.send(10001);
  await assert.rejects(f.send(10001), /Duplicate or expired/);
});
test("browser broker rejects IDs at or below the replay low-water mark", async t => {
  const f = await fixture(t);
  for (let i = 1; i <= 4098; i++) await f.send(i);
  await assert.rejects(f.send(1), /Duplicate or expired/);
});
