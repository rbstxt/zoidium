#!/usr/bin/env node
"use strict";

// Kept outside Node's automatic test discovery. Missing Chromium is a failure.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const net = require("node:net");
const { chromium } = require("playwright");
const { startFixture, bootstrapDocument, runInFrame } = require("../test/community-fixtures/fixture.cjs");
const { networkProbes } = require("../test/community-fixtures/network-probes");
const { runtimeSource } = require("./community-runtime-source");
const { pack } = require("./pack-community-plugin");
const V = require("../zoidium/community-protocol");
const B = require("../zoidium/community-bootstrap");
const lock = "/tmp/zoidium-browser.lock";
const report = { started: new Date().toISOString(), cases: [], assertions: [] };
function check(condition, name) { assert.ok(condition, name); report.assertions.push(name); }
async function acquire() {
  for (;;) {
    try { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, "owner"), process.pid + " community-network\n"); return; }
    catch (error) { if (error.code !== "EEXIST") throw error; console.log("Waiting for shared browser lock"); await new Promise(resolve => setTimeout(resolve, 60000)); }
  }
}
async function controls(page, fixture) {
  await page.evaluate(async target => {
    await fetch(target + "/control/http");
    await new Promise(resolve => { const ws = new WebSocket(target.replace("http:", "ws:") + "/control/ws"); ws.onerror = resolve; });
  }, fixture.targets.sink);
  await new Promise((resolve, reject) => { const socket = net.connect(fixture.targets.port, "127.0.0.1", () => { socket.end(); resolve(); }); socket.on("error", reject); });
  await new Promise((resolve, reject) => {
    const udp = dgram.createSocket("udp4");
    fixture.datagrams.length = 0;
    udp.send(Buffer.from("control"), fixture.targets.udpPort, "127.0.0.1", error => { udp.close(); if (error) reject(error); else resolve(); });
  });
  await page.waitForTimeout(100);
  report.controls = { http: fixture.requests.filter(r => r.url === "/control/http").length, ws: fixture.requests.filter(r => r.url === "/control/ws").length, tcp: fixture.connections.length, udp: fixture.datagrams.length };
  for (const [name, count] of Object.entries(report.controls)) check(count > 0, "positive control " + name);
}
async function rawPolicies(page, fixture) {
  for (const scheme of ["blob", "data"]) {
    const doc = bootstrapDocument(scheme);
    const source = "(" + networkProbes.toString() + ")(" + JSON.stringify(fixture.targets) + ").then(result=>postMessage(result),error=>postMessage({fatal:String(error)}));";
    const result = await page.evaluate(runInFrame, { html: doc.html, scheme, source });
    check(!result.fatal, scheme + " raw runtime completed");
    check(result.origin === "null", scheme + " opaque worker origin");
    check(result.results.every(r => r.value !== "pending"), scheme + " no inconclusive probes");
    check(result.violations.some(v => v.directive === "connect-src"), scheme + " connect CSP violations");
    check(result.violations.some(v => v.directive === "script-src-elem" || v.directive === "script-src"), scheme + " script CSP violations");
    const nested = result.results.find(r => r.name === "nested-worker-blob");
    check(nested.outcome === "returned" && !nested.value.includes("LEAK"), scheme + " descendant blob worker policy");
    if (scheme === "data") {
      check(result.secure === true, "secure data worker positive context");
      check(result.globals.WebTransport === "function", "secure worker exposes WebTransport");
      check(result.results.find(r => r.name === "webtransport").outcome === "rejected", "secure WebTransport blocked");
    }
    report.cases.push({ kind: "raw-policy", scheme, ...result });
  }
}
async function runnerCases(page, fixture, folder) {
  const result = pack(path.join(__dirname, "../examples/community-filter"), folder);
  const bytes = Array.from(fs.readFileSync(result.output));
  const scripts = ["community-safe-json.js", "community-package.js", "community-protocol.js", "community-bootstrap.js"];
  for (const name of scripts) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, "../zoidium", name), "utf8") });
  // Ignore fixed test-page setup; no runner operation has begun yet.
  fixture.reset();
  const results = await page.evaluate(async options => {
    const B = globalThis.ZoidiumCommunityBootstrap, V = globalThis.ZoidiumCommunityProtocol;
    const bytes = new Uint8Array(options.bytes), runtimeSource = options.runtime;
    const results = [];
    const base = { protocolVersion: 1, interpreterVersion: V.INTERPRETER, instanceId: "instance", instanceGeneration: 1, projectGeneration: 1, revision: 1, frameKey: "exact-frame-0.5" };
    let counter = 0;
    async function start(source = runtimeSource) { return B.createRunner({ bytes, approvedHash: options.hash, runtimeSource: source }); }
    async function guestRunner(code) {
      const bundle = JSON.parse(new TextDecoder().decode(bytes)); bundle.assets[bundle.manifest.entry] = code;
      const changed = new TextEncoder().encode(JSON.stringify(bundle));
      const approvedHash = "sha256-" + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", changed))));
      return B.createRunner({ bytes: changed, approvedHash, runtimeSource });
    }
    function message(runner, operation, payload) { return { ...base, ...runner.binding, requestId: "request-" + (++counter), operation, payload }; }
    const input = { properties: { gain: 0.5 }, frame: 0.5, time: 1 / 60, frameRate: 30, width: 64, height: 64, pixelAspect: 1, seed: 1 };
    const effectId = options.effectId;
    const r = await start();
    try {
      results.push({ name: "initialize", ok: (await r.request(message(r, "initialize", {}))).operation === "ready" });
      results.push({ name: "prepare", ok: (await r.request(message(r, "prepareEffect", { effectId, input }))).payload.uniforms.gain === 0.5 });
      results.push({ name: "UI event", ok: (await r.request(message(r, "uiEvent", { effectId, input: { action: "reset", state: { gain: 0.5 } } }))).payload.state.gain === 1 });
      const duplicate = message(r, "initialize", {}); await r.request(duplicate);
      results.push({ name: "duplicate request rejected", ok: await r.request(duplicate).then(() => false, () => true) });
      const bad = message(r, "initialize", {}); bad.protocolVersion = 2;
      results.push({ name: "incompatible protocol rejected", ok: await r.request(bad).then(() => false, () => true) });
      const incompatible = message(r, "initialize", {}); incompatible.interpreterVersion = "unknown-runtime";
      results.push({ name: "incompatible interpreter rejected", ok: await r.request(incompatible).then(() => false, () => true) });
      const urlInput = message(r, "prepareEffect", { effectId, input: { ...input, url: options.sink } });
      results.push({ name: "URL-bearing host operation rejected", ok: await r.request(urlInput).then(() => false, () => true) });
      const foreign = message(r, "initialize", {}); foreign.packageHash = "sha256-" + "B".repeat(43) + "=";
      results.push({ name: "foreign binding rejected", ok: await r.request(foreign).then(() => false, () => true) });
      const handle = message(r, "initialize", {}), channel = new MessageChannel(); handle.payload = { port: channel.port1 };
      results.push({ name: "transferred MessagePort rejected", ok: await r.request(handle).then(() => false, () => true) }); channel.port1.close(); channel.port2.close();
      results.push({ name: "dispose", ok: (await r.request(message(r, "dispose", {}))).operation === "disposed" });
    } finally { r.dispose(); }
    results.push({ name: "exact-hash approval", ok: await B.createRunner({ bytes, approvedHash: "wrong", runtimeSource }).then(() => false, () => true) });
    for (const [name, code, expected] of [
      ["guest network calls denied", `function prepare(){const attempts=[()=>fetch(${JSON.stringify(options.sink)}),()=>new WebSocket(${JSON.stringify(options.sink.replace('http:','ws:'))}),()=>new Worker(${JSON.stringify(options.sink)}),()=>Function('return this')().fetch(${JSON.stringify(options.sink)}),()=>({}).constructor.constructor('return this')().fetch(${JSON.stringify(options.sink)})];return {uniforms:{gain:attempts.every(f=>{try{f();return false}catch(e){return true}})?0.5:999}}}`, "prepared"],
      ["temporal dependency fails locally", "function prepare(){return {uniforms:{},temporal:{offsets:[0]}}}", "LOCAL_DEPENDENCY_UNAVAILABLE"],
    ]) {
      const runner = await guestRunner(code);
      try {
        const reply = await runner.request(message(runner, "prepareEffect", { effectId, input })).then(value => value, error => error);
        results.push({ name, ok: expected === "prepared" ? reply.payload?.uniforms.gain === 0.5 : reply.message?.includes(expected) });
      } finally { runner.dispose(); }
    }
    // Trusted hostile-runtime fixtures exercise host checks independently of guest code.
    for (const [name, body] of [
      ["stale reply rejected", "postMessage({...e.data,revision:e.data.revision+1,operation:'prepared',payload:{uniforms:{gain:1}}})"],
      ["hang terminated", "for(;;){}"],
      ["runtime handle rejected", "const c=new MessageChannel();postMessage({...e.data,operation:'prepared',payload:{port:c.port1}},[c.port1])"],
      ["unsolicited reply rejected", "postMessage({...e.data,operation:'prepared',payload:{uniforms:{gain:1}}});postMessage({...e.data,operation:'prepared',payload:{uniforms:{gain:1}}})"],
    ]) {
      const source = "let boot=false;onmessage=e=>{if(!boot){boot=true;postMessage({booted:true});return;}" + body + "}";
      const runner = await start(source); const begin = performance.now();
      try {
        let failed = await runner.request(message(runner, "prepareEffect", { effectId, input })).then(() => false, () => true);
        if (name === "unsolicited reply rejected") { await new Promise(resolve => setTimeout(resolve, 30)); failed = await runner.request(message(runner, "initialize", {})).then(() => false, () => true); }
        results.push({ name, ok: failed, elapsedMs: performance.now() - begin });
      } finally { runner.dispose(); }
    }
    return results;
  }, { bytes, hash: result.hash, runtime: runtimeSource(), sink: fixture.targets.sink + "/probe/guest-operation", effectId: require("../examples/community-filter/manifest.json").effects[0].id });
  for (const result of results) check(result.ok, "production runner " + result.name);
  report.runner = results;
}
async function guestCases(page) {
  const I = fs.readFileSync(path.join(__dirname, "../zoidium/community-interpreter.js"), "utf8");
  const Q = fs.readFileSync(path.join(__dirname, "../zoidium/vendor/quickjs/quickjs.js"), "utf8");
  const S = fs.readFileSync(path.join(__dirname, "../zoidium/community-safe-json.js"), "utf8");
  const names = ["fetch", "XMLHttpRequest", "WebSocket", "WebTransport", "EventSource", "Worker", "SharedWorker", "importScripts", "Blob", "navigator", "document", "RTCPeerConnection", "RTCDataChannel", "BroadcastChannel", "WebAssembly", "MessagePort", "Date", "Promise", "Function"];
  const code = `function prepare(){return {names:${JSON.stringify(names)}.map(k=>typeof globalThis[k]),chain:typeof ({}).constructor.constructor}}`;
  const jobs = [
    { id: "capabilities", code },
    { id: "loop", code: "function prepare(){for(;;){}}" },
    { id: "allocator", code: "function prepare(){const a=[];for(;;)a.push(new Array(10000).fill(42));}" },
    { id: "recovery", code: "function prepare(){return {uniforms:{gain:0.5}}}" },
    { id: "dynamic import", code: "function prepare(){import('https://zoidium-plugin-network-probe.invalid/module.js')}" },
  ];
  const source = Q + "\n;" + S + "\n;" + I + `\nself.onmessage=async e=>{try{postMessage({id:e.data.id,result:await ZoidiumCommunityInterpreter.evaluate(e.data.code,'prepareEffect',{})})}catch(error){postMessage({id:e.data.id,error:String(error)})}};`;
  const result = await page.evaluate(runInFrame, { html: bootstrapDocument("blob").html, scheme: "blob", source, jobs });
  check(Array.isArray(result) && result.length === jobs.length, "guest jobs complete");
  check(result[0].result.value.names.every(v => v === "undefined") && result[0].result.value.chain === "undefined", "guest browser capabilities absent");
  check(/interrupted/.test(result[1].error), "guest loop interrupted");
  check(/memory/i.test(result[2].error), "guest allocator exhausted");
  check(result[3].result.value.uniforms.gain === 0.5, "fresh context recovers after failures");
  check(/synchronous/.test(result[4].error), "guest dynamic import rejected before execution");
  report.guest = result;
}
async function productionPolicy(page, fixture) {
  const challenge = "a".repeat(48), nonce = "b".repeat(48);
  const html = B.documentSource(fixture.targets.host, challenge, nonce);
  const result = await page.evaluate(async options => {
    const frame = document.createElement("iframe"); frame.sandbox = "allow-scripts";
    const channel = new MessageChannel();
    return new Promise((resolve, reject) => {
      let value;
      const timer = setTimeout(() => { frame.remove(); reject(new Error("Production bootstrap timeout")); }, 10000);
      channel.port1.onmessage = e => {
        if (e.data.terminated) { clearTimeout(timer); channel.port1.close(); frame.remove(); resolve(value); }
        else { value = e.data; channel.port1.postMessage({ terminate: options.challenge }); }
      };
      addEventListener("message", function ready(e) {
        if (e.source !== frame.contentWindow || e.data?.communityReady !== options.challenge) return;
        removeEventListener("message", ready);
        frame.contentWindow.postMessage({ challenge: options.challenge, runtimeSource: options.source, config: {} }, "*", [channel.port2]);
      });
      frame.srcdoc = options.html; document.body.append(frame);
    });
  }, { html, challenge, source: "(" + networkProbes.toString() + ")(" + JSON.stringify(fixture.targets) + ").then(r=>postMessage(r));" });
  check(result.origin === "null" && result.violations.length > 0, "production bootstrap raw CSP enforced");
  report.cases.push({ kind: "production-bootstrap", ...result });
}
async function main() {
  assert.ok(fs.existsSync(chromium.executablePath()), "Chromium is required. Run pnpm exec playwright install chromium");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-network-"));
  const netlog = path.join(folder, "netlog.json");
  let browser, fixture, locked = false;
  try {
    await acquire(); locked = true;
    fixture = await startFixture();
    browser = await chromium.launch({ headless: true, args: ["--log-net-log=" + netlog, "--net-log-capture-mode=Default"] });
    report.chromium = browser.version();
    const page = await browser.newPage();
    const errors = []; page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 500)); });
    await page.goto(fixture.targets.host);
    await controls(page, fixture); fixture.reset();
    await page.evaluate(() => {
      globalThis.communityBroadcastLeaks = [];
      globalThis.communityBroadcastControl = new BroadcastChannel("zoidium-host-probe");
      globalThis.communityBroadcastControl.onmessage = event => globalThis.communityBroadcastLeaks.push(event.data);
    });
    // A deliberately weakened policy must leak into the sink. The suite detects it.
    const doc = bootstrapDocument("blob");
    await page.evaluate(runInFrame, { html: doc.html.replace("connect-src 'none'", "connect-src *"), scheme: "blob", source: "fetch(" + JSON.stringify(fixture.targets.sink + "/control/policy-failure") + ").then(()=>postMessage({done:true}));" });
    check(fixture.requests.some(r => r.url === "/control/policy-failure"), "weakened-policy leak detected");
    fixture.reset();
    await rawPolicies(page, fixture);
    await productionPolicy(page, fixture);
    await guestCases(page);
    report.policyCounts = { requests: fixture.requests.length, tcp: fixture.connections.length, udp: fixture.datagrams.length };
    for (const [name, count] of Object.entries(report.policyCounts)) check(count === 0, "raw and guest zero " + name);
    await runnerCases(page, fixture, path.join(folder, "package"));
    await page.waitForTimeout(200);
    report.runnerCounts = { requests: fixture.requests.length, tcp: fixture.connections.length, udp: fixture.datagrams.length };
    for (const [name, count] of Object.entries(report.runnerCounts)) check(count === 0, "production runner zero " + name);
    report.broadcastMessages = await page.evaluate(() => {
      globalThis.communityBroadcastControl.close();
      return globalThis.communityBroadcastLeaks.length;
    });
    check(report.broadcastMessages === 0, "opaque workers cannot reach editor BroadcastChannel");
    report.diagnostics = errors;
    await browser.close(); browser = null;
    const events = JSON.parse(fs.readFileSync(netlog, "utf8")).events;
    report.dnsSentinelEvents = events.filter(e => JSON.stringify(e).includes("zoidium-plugin-network-probe.invalid")).length;
    check(report.dnsSentinelEvents === 0, "DNS sentinel absent from Chromium NetLog");
    report.passed = true;
  } finally {
    if (browser) await browser.close();
    if (fixture) await fixture.close();
    if (locked) fs.rmSync(lock, { recursive: true });
    report.finished = new Date().toISOString();
    const output = process.env.ZOIDIUM_COMMUNITY_NETWORK_REPORT;
    if (output) {
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
      if (fs.existsSync(netlog)) fs.copyFileSync(netlog, output + ".netlog.json");
    }
    fs.rmSync(folder, { recursive: true, force: true });
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
