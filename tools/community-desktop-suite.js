#!/usr/bin/env node
"use strict";

// Desktop acceptance is explicit, outside automatic Node test discovery.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { _electron } = require("playwright");
const { prepareRuntimeStage, cleanupStage } = require("./runtime-resources");
const { pack } = require("./pack-community-plugin");
const manifest = require("../examples/community-filter/manifest.json");
const { desktopBoundaries } = require("./community-desktop-boundaries");
const lock = process.env.ZOIDIUM_BROWSER_LOCK;
const output = process.env.ZOIDIUM_COMMUNITY_DESKTOP_REPORT;
const report = { started: new Date().toISOString(), assertions: [] };
function check(value, name) { assert.ok(value, name); report.assertions.push(name); }
async function acquire() {
  for (;;) {
    try { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, "owner"), process.pid + " community-desktop\n"); return; }
    catch (error) { if (error.code !== "EEXIST") throw error; console.log("Waiting for shared browser lock"); await new Promise(resolve => setTimeout(resolve, 30000)); }
  }
}
async function main() {
  const folder = fs.mkdtempSync(path.join(output ? path.dirname(path.resolve(output)) : os.tmpdir(), "desktop-acceptance-"));
  const profile = path.join(folder, "profile"), netlog = path.join(folder, "netlog.json");
  let application, stage, sink, locked = false;
  const requests = [], connections = [];
  try {
    if (lock) { await acquire(); locked = true; }
    const executablePath = process.env.ZOIDIUM_COMMUNITY_DESKTOP_EXECUTABLE;
    if (!executablePath) {
      stage = path.join(folder, "stage"); await prepareRuntimeStage({ destinationRoot: stage, includeDesktopFiles: true });
    }
    sink = http.createServer((req, res) => { requests.push(req.url); res.end("local control"); });
    sink.on("connection", () => connections.push(true));
    await new Promise(resolve => sink.listen(0, "127.0.0.1", resolve));
    const target = "http://127.0.0.1:" + sink.address().port;
    const packed = pack(path.join(__dirname, "../examples/community-filter"), path.join(folder, "package"));
    const bytes = Array.from(fs.readFileSync(packed.output));
    const env = { ...process.env, ZOIDIUM_DESKTOP_PORT: "18473" }; delete env.ELECTRON_RUN_AS_NODE;
    async function launch(extra = []) {
      application = await _electron.launch({ ...(executablePath ? { executablePath } : {}),
        args: [...(stage ? [stage] : []), "--user-data-dir=" + profile, ...extra], env, timeout: 90000 });
      const page = await application.firstWindow();
      await page.waitForFunction(() => globalThis.CM?.mainViewport && globalThis.ZoidiumPluginManagerInternals?.registryReady, { timeout: 90000 });
      await page.evaluate(async () => {
        await globalThis.ZoidiumPluginManagerInternals.registryReady;
        if (!CM.mainViewport.__zoidiumPlayerPlusPaused) document.querySelector('button[title="Pause drawing"]')?.click();
        const quality = document.querySelector('select[title="Preview quality"]');
        if (quality) { quality.value = "0.125"; quality.dispatchEvent(new Event("change", { bubbles: true })); }
      });
      return page;
    }
    let page = await launch();
    report.runtime = await application.evaluate(({ app }) => ({ versions: process.versions, userData: app.getPath("userData"), packaged: app.isPackaged }));
    check(report.runtime.userData === profile, "isolated acceptance profile");
    check(await page.evaluate(() => !localStorage.getItem("zoidium.community-preview")), "preview starts disabled");
    check(await page.evaluate(() => globalThis.ZoidiumDesktopCommunity.load().then(() => false, () => true)), "disabled preview rejects desktop storage");
    check(!fs.existsSync(path.join(profile, "community-plugins")), "disabled preview creates no community files");
    check(await application.evaluate(({ BrowserWindow, session }) => BrowserWindow.getAllWindows().length === 1 && BrowserWindow.getAllWindows()[0].webContents.session === session.defaultSession), "editor retains its default session");
    await page.evaluate(() => localStorage.setItem("zoidium.community-preview", "1"));
    await page.evaluate(async options => {
      const store = globalThis.ZoidiumCommunityStore.createStore(); await store.open({ reload: true });
      await store.importFile(new Blob([new Uint8Array(options.bytes)]), store.view().revision);
      let item = store.view().packages[0]; await store.approve(item.id, item.hash, store.view().revision);
      await store.setEnabled(item.id, true, store.view().revision);
      const selected = await store.beforeEvaluation(item.id, item.hash);
      const runner = await globalThis.ZoidiumCommunityBootstrap.createRunner({ bytes: selected.bytes, approvedHash: selected.hash,
        runtimeSource: "throw new Error('renderer runtime must be ignored')", runnerGeneration: 1 });
      await store.completeActivation(item.id, item.hash, store.view().revision);
      globalThis.desktopSuite = { store, runner, counter: 0, effectId: options.effectId };
    }, { bytes, effectId: manifest.effects[0].id });
    check(true, "installed approved package starts using trusted desktop runtime bytes");
    report.protocol = await page.evaluate(async () => {
      const s = globalThis.desktopSuite, V = globalThis.ZoidiumCommunityProtocol;
      function message(operation, payload) { return { protocolVersion: 1, interpreterVersion: V.INTERPRETER, ...s.runner.binding,
        instanceId: "desktop-instance", instanceGeneration: 1, projectGeneration: 1, revision: 1,
        requestId: "request-" + (++s.counter), frameKey: "frame-0.5", operation, payload }; }
      const ready = await s.runner.request(message("initialize", {}));
      const prepared = await s.runner.request(message("prepareEffect", { effectId: s.effectId,
        input: { properties: { gain: 0.5 }, frame: 0.5, time: 1 / 60, frameRate: 30, width: 64, height: 64, pixelAspect: 1, seed: 1 } }));
      const ui = await s.runner.request(message("uiEvent", { effectId: s.effectId, input: { action: "reset", state: { gain: 0.5 } } }));
      const invalid = message("initialize", { url: "https://example.invalid" });
      const refused = await s.runner.request(invalid).then(() => false, () => true);
      return { ready: ready.operation, gain: prepared.payload.uniforms.gain, ui: ui.payload.state.gain, refused };
    });
    check(report.protocol.ready === "ready" && report.protocol.gain === 0.5 && report.protocol.ui === 1, "actual desktop ports route initialize, preparation, and UI results");
    check(report.protocol.refused, "URL-bearing host operations refused");
    report.security = await application.evaluate(async ({ BrowserWindow, session, net, app }, args) => {
      const window = BrowserWindow.getAllWindows().find(w => w.webContents.session !== session.defaultSession);
      if (!window) throw new Error("Dedicated runner window missing");
      const isolated = window.webContents.session, preferences = window.webContents.getLastWebPreferences();
      await session.defaultSession.fetch(args.target + "/control");
      const denied = [];
      await app.whenReady(); await netLogStart();
      async function netLogStart() { await session.defaultSession.netLog.startLogging(args.netlog); }
      for (const url of [window.webContents.getURL(), args.target + "/probe/redirect", "http://zoidium-plugin-network-probe.invalid/probe"]) {
        denied.push(await new Promise(resolve => {
          const request = net.request({ url, session: isolated }); request.on("error", () => resolve(true));
          request.on("response", response => { response.resume(); resolve(false); }); request.end();
        }));
      }
      const popup = await window.webContents.executeJavaScript("window.open('" + args.target + "/popup') === null");
      const download = await window.webContents.executeJavaScript("fetch('" + args.target + "/csp-canary').then(()=>false,()=>true)");
      await session.defaultSession.netLog.stopLogging();
      return { denied, popup, csp: download, persistent: isolated.isPersistent(), preferences: {
        nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation,
        sandbox: preferences.sandbox, webSecurity: preferences.webSecurity, nodeIntegrationInWorker: preferences.nodeIntegrationInWorker,
      }, runnerURL: window.webContents.getURL() };
    }, { target, netlog });
    check(requests.includes("/control") && connections.length > 0, "positive HTTP and TCP controls reach the sink");
    report.network = { requests: requests.slice(), tcp: connections.length };
    check(requests.length === 1 && connections.length === 1, "runner sends zero HTTP requests or TCP connections to the sink");
    check(report.security.denied.every(Boolean), "post-bootstrap session denies loopback and DNS sentinel requests");
    check(report.security.popup && report.security.csp, "runner popup and trusted document fetch are denied");
    check(!report.security.persistent, "runner session is nonpersistent");
    const p = report.security.preferences;
    check(!p.nodeIntegration && !p.nodeIntegrationInWorker && p.contextIsolation && p.sandbox && p.webSecurity, "runner preserves renderer security flags");
    const events = JSON.parse(fs.readFileSync(netlog, "utf8")).events;
    // URL cancellation may be logged. DNS activity for the sentinel must not be.
    const constants = JSON.parse(fs.readFileSync(netlog, "utf8")).constants.logEventTypes;
    const dnsTypes = new Set(Object.entries(constants).filter(([name]) => /HOST_RESOLVER|DNS_TRANSACTION/.test(name)).map(([, id]) => id));
    report.dnsEvents = events.filter(event => dnsTypes.has(event.type) && JSON.stringify(event).includes("zoidium-plugin-network-probe.invalid")).length;
    check(report.dnsEvents === 0, "denied sentinel never reaches DNS resolution in NetLog");
    report.portAttacks = await page.evaluate(async options => {
      const config = { bytes: new Uint8Array(options.bytes), approvedHash: options.hash, runnerGeneration: 2 };
      async function forged(extra) {
        const c = new MessageChannel(), transferred = [c.port2];
        if (extra) transferred.push(new MessageChannel().port2);
        const result = new Promise(resolve => { c.port1.onmessage = e => { c.port1.close(); resolve(Boolean(e.data.fatal)); }; });
        window.postMessage({ type: "zoidium:community-connect", config: extra ? config : { ...config, path: "../package" } }, location.origin, transferred);
        return result;
      }
      return [await forged(true), await forged(false)];
    }, { bytes, hash: packed.hash });
    check(report.portAttacks.every(Boolean), "extra ports and path-bearing runner configurations are rejected");
    report.boundaries = await application.evaluate(desktopBoundaries, { target, bytes, hash: packed.hash, packageId: manifest.id });
    check(report.boundaries.navigationDenied && report.boundaries.unchangedURL, "runner self-navigation is cancelled");
    check(Object.values(report.boundaries.permissions).every(value => value === "denied" || value === "NotAllowedError"), "runner denies clipboard, notifications, geolocation, and media permissions");
    check(report.boundaries.downloadDenied, "runner cancels local Blob downloads");
    const redirect = report.boundaries.redirect;
    check(redirect.requests.length === 1 && redirect.requests[0].url === redirect.expected && redirect.runnerDestroyed, "exact bootstrap redirect is cancelled and closes its runner");
    check(requests.length === 1 && connections.length === 1, "navigation, child frames, and redirects create no sink connection");
    if (process.env.ZOIDIUM_COMMUNITY_DESKTOP_EDITOR_PROBE) {
      report.editor = await page.evaluate(fs.readFileSync(process.env.ZOIDIUM_COMMUNITY_DESKTOP_EDITOR_PROBE, "utf8"));
      check(report.editor.passed, "authored editor fixture renders through the desktop controller and native shader pass");
    }
    report.persistence = await page.evaluate(async () => {
      const { store, runner } = globalThis.desktopSuite; runner.dispose();
      const original = store.view().packages[0], saved = await store.beforeEvaluation(original.id, original.hash);
      await store.completeActivation(original.id, original.hash, store.view().revision);
      const bundle = JSON.parse(new TextDecoder().decode(saved.bytes)); bundle.manifest.version = "2";
      await store.importFile(new Blob([JSON.stringify(bundle)]), store.view().revision);
      let item = store.view().packages[0]; await store.approve(item.id, item.hash, store.view().revision);
      await store.stageOnReload(item.id, store.view().revision);
      await store.open({ reload: true }); item = store.view().packages[0];
      return { original: original.selected, selected: item.selected, previous: item.previous };
    });
    check(report.persistence.previous === report.persistence.original && report.persistence.selected !== report.persistence.original, "approved update keeps one rollback selection");
    await application.close(); application = null;
    page = await launch(["--community-safe-mode"]);
    report.reopened = await page.evaluate(async () => {
      const store = globalThis.ZoidiumCommunityStore.createStore(); await store.open({ reload: true });
      const state = store.view(), item = state.packages[0];
      const refused = await store.beforeEvaluation(item.id, item.hash).then(() => false, () => true);
      return { safeMode: state.safeMode, selected: item.selected, previous: item.previous, approved: item.approved, refused };
    });
    check(report.reopened.selected === report.persistence.selected && report.reopened.previous === report.persistence.original && report.reopened.approved, "packages and exact approvals persist across application restart");
    check(report.reopened.safeMode && report.reopened.refused, "desktop launch safe mode precedes guest activation");
    check(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1), "safe mode creates no runner");
    report.passed = true;
  } finally {
    if (application) await application.close();
    if (sink) { sink.closeAllConnections(); await new Promise(resolve => sink.close(resolve)); }
    if (stage) await cleanupStage(stage);
    if (locked) fs.rmSync(lock, { recursive: true });
    report.finished = new Date().toISOString();
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    fs.rmSync(folder, { recursive: true, force: true });
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { report.error = String(error.stack || error); if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n"); console.error(error); process.exitCode = 1; });
