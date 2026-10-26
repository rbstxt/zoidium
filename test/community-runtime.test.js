"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageChannel } = require("node:worker_threads");
const I = require("../zoidium/community-interpreter");
const V = require("../zoidium/community-protocol");
const S = require("../zoidium/community-safe-json");
const manifest = require("../examples/community-filter/manifest.json");
const effect = manifest.effects[0];
function request(operation = "prepareEffect", id = "one") {
  return { protocolVersion: 1, interpreterVersion: V.INTERPRETER, packageId: manifest.id, packageHash: "sha256-" + "A".repeat(43) + "=", runnerGeneration: 1, instanceId: "instance", instanceGeneration: 1, projectGeneration: 1, revision: 1, requestId: id, frameKey: "frame-0.5", operation,
    payload: { effectId: effect.id, input: { properties: { gain: 1 }, frame: 0.5, time: 1 / 60, frameRate: 30, width: 64, height: 64, pixelAspect: 1, seed: 1 } } };
}
module.exports = { request };
test("protocol rejects stale, reordered, foreign and incompatible replies", () => {
  const m = request(); const reply = { ...m, operation: "prepared", payload: { uniforms: { gain: 1 } } };
  assert.equal(V.matches(reply, m), reply);
  for (const key of V.FIELDS) {
    const bad = { ...reply, [key]: typeof reply[key] === "number" ? reply[key] + 1 : reply[key] + "x" };
    assert.throws(() => V.matches(bad, m), undefined, key);
  }
  assert.throws(() => V.matches({ ...reply, operation: "uiPatch" }, m));
  assert.throws(() => V.message({ ...m, operation: "fetch" }));
  assert.throws(() => V.message({ ...m, extra: "https://example.invalid" }));
  assert.throws(() => V.message({ ...m, payload: { value: "x".repeat(65536) } }), /size/);
});
test("protocol rejects transferred handles, buffers, accessors and platform objects", () => {
  const channel = new MessageChannel();
  try {
    for (const value of [channel.port1, new ArrayBuffer(4), new SharedArrayBuffer(4), new Uint8Array(4), new Date(), new Map(), new Set(), new URL("https://example.invalid"), () => 0]) assert.throws(() => S.data({ value }));
    assert.throws(() => S.data({ get value() { throw new Error("must not run"); } }), /accessors/);
    assert.throws(() => S.data(JSON.parse('{"__proto__":0}')), /poisoned/);
  } finally { channel.port1.close(); channel.port2.close(); }
});
test("protocol validates local input ownership, textures, UI state and temporal refusal", () => {
  const m = request(); V.requestPayload(m, { manifest });
  for (const change of [i => { i.url = "https://example.invalid"; }, i => { i.properties.foreign = 1; }, i => { i.width = 0; }, i => { i.properties.gain = "1+1"; }]) {
    const bad = structuredClone(m); change(bad.payload.input); assert.throws(() => V.requestPayload(bad, { manifest }));
  }
  assert.deepEqual(V.result({ uniforms: { gain: 1 } }, effect, "prepareEffect"), { uniforms: { gain: 1 } });
  for (const value of [{ uniforms: { url: "https://example.invalid" } }, { uniforms: { gain: Infinity } }, { uniforms: {}, temporal: { offsets: [0] } }, { uniforms: {}, textures: [{ id: "a", width: 1, height: 1, pixels: [0] }] }, { uniforms: {}, textures: [{ id: "a", width: 257, height: 1, pixels: [] }] }]) assert.throws(() => V.result(value, effect, "prepareEffect"));
  assert.throws(() => V.result({ uniforms: {}, temporal: {} }, effect, "prepareEffect"), /LOCAL_DEPENDENCY_UNAVAILABLE/);
  assert.throws(() => V.result({ state: { other: 1 } }, effect, "uiEvent"));
});
test("interpreter exposes no browser or network capabilities, including constructor chains", async () => {
  const names = ["fetch", "XMLHttpRequest", "WebSocket", "WebTransport", "EventSource", "Worker", "SharedWorker", "importScripts", "Blob", "Image", "FontFace", "navigator", "document", "RTCPeerConnection", "RTCDataChannel", "BroadcastChannel", "WebAssembly", "MessagePort", "MessageChannel", "SharedArrayBuffer", "std", "os", "require", "Date", "Promise", "eval", "Function", "setTimeout"];
  const code = "function prepare(){return {names:" + JSON.stringify(names) + ".map(k=>typeof globalThis[k]), chain:typeof ({}).constructor.constructor, random:typeof Math.random}}";
  const result = await I.evaluate(code, "prepareEffect", {});
  assert.ok(result.value.names.every(value => value === "undefined"), JSON.stringify(result.value));
  assert.equal(result.value.chain, "undefined"); assert.equal(result.value.random, "undefined");
});
test("interpreter interrupts loops and allocator exhaustion, then starts a fresh context", async () => {
  await assert.rejects(I.evaluate("function prepare(){for(;;){}}", "prepareEffect", {}), /interrupted/);
  await assert.rejects(I.evaluate("function prepare(){const a=[];for(;;)a.push(new Array(10000).fill(42));}", "prepareEffect", {}), /memory/i);
  const code = "let n=0;function prepare(input){try{input.x=9}catch(e){}return {n:++n,x:input.x}}";
  for (let i = 0; i < 2; i++) assert.deepEqual({ ...(await I.evaluate(code, "prepareEffect", { x: 1 })).value }, { n: 1, x: 1 });
});
test("interpreter bounds syntax, serialized output and invalid results", async () => {
  await assert.rejects(I.evaluate("function prepare(){return {x:'a'.repeat(70000)}}", "prepareEffect", {}), /size/);
  await assert.rejects(I.evaluate("function prepare(){return undefined}", "prepareEffect", {}), /JSON record/);
  await assert.rejects(I.evaluate("function prepare(){return {constructor:1}}", "prepareEffect", {}), /poisoned/);
});
