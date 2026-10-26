"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const S = require("../zoidium/community-safe-json");
const P = require("../zoidium/community-package");
const V = require("../zoidium/community-protocol");

// This document runs only trusted bootstrap code. Package source enters the
// embedded interpreter as data, never the document's JavaScript realm.
function runnerBootstrap() {
  let worker, port, url;
  function stop() { worker?.terminate(); if (url) URL.revokeObjectURL(url); port?.close(); }
  addEventListener("pagehide", stop);
  addEventListener("message", function receive(event) {
    if (event.source !== window || event.data !== "zoidium-community-port" || event.ports.length !== 1 || port) return;
    removeEventListener("message", receive); port = event.ports[0];
    port.onmessage = e => {
      if (e.ports.length) { stop(); return; }
      if (!worker) {
        url = URL.createObjectURL(new Blob([e.data.runtimeSource], { type: "text/javascript" }));
        worker = new Worker(url);
        worker.onmessage = reply => {
          if (reply.ports.length) { stop(); return; }
          if (reply.data?.booted && url) { URL.revokeObjectURL(url); url = null; }
          port.postMessage(reply.data);
        };
        worker.onerror = () => { port.postMessage({ fatal: "Community Worker failed." }); stop(); };
        worker.postMessage(e.data.config);
      } else worker.postMessage(e.data);
    };
    port.start(); port.postMessage({ connected: true });
  });
}
function runnerDocument() {
  const nonce = randomBytes(24).toString("hex");
  const policy = `default-src 'none'; connect-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; worker-src blob:; img-src 'none'; font-src 'none'; style-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  return { policy, html: `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><script nonce="${nonce}">(${runnerBootstrap.toString()})()</script>` };
}
function installSessionPolicy(session, bootstrapURL, getContentsId) {
  let available = true;
  // This module owns the session and its sole WebRequest listener. It does
  // not infer worker ownership from frame, referrer, or initiator metadata.
  session.webRequest.onBeforeRequest((details, callback) => {
    const allow = available && details.url === bootstrapURL && details.method === "GET" &&
      details.resourceType === "mainFrame" && details.webContentsId === getContentsId();
    if (allow) available = false;
    callback({ cancel: !allow });
  });
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  session.on("will-download", event => event.preventDefault());
  return () => { available = false; };
}
function hardenContents(contents) {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  for (const event of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
    contents.on(event, e => e.preventDefault());
  }
}
function runtimeSource() {
  const files = ["vendor/quickjs/quickjs.js", "community-safe-json.js", "community-package.js", "community-protocol.js", "community-interpreter.js", "community-worker.js"];
  return files.map(file => fs.readFileSync(path.join(__dirname, "../zoidium", file), "utf8")).join("\n;\n");
}
function createRunnerHost({ electron, origin, config, editorPort, authorized, route }) {
  const { BrowserWindow, session, MessageChannelMain } = electron;
  const partition = "zoidium-community-" + randomBytes(24).toString("hex");
  const isolated = session.fromPartition(partition, { cache: false });
  const url = origin + "/__zoidium-community/" + randomBytes(24).toString("hex");
  let window, closed = false, booted = false, connected = false, pending, timer;
  const seen = new Set();
  const seal = installSessionPolicy(isolated, url, () => window?.webContents.id);
  const document = runnerDocument();
  route(url, document);
  window = new BrowserWindow({ show: false, webPreferences: {
    session: isolated, preload: path.join(__dirname, "community-runner-preload.cjs"),
    nodeIntegration: false, nodeIntegrationInWorker: false, contextIsolation: true,
    sandbox: true, webSecurity: true, backgroundThrottling: false, webviewTag: false,
  } });
  const channel = new MessageChannelMain(), workerPort = channel.port1;
  function close(reason = "Community runner disposed.") {
    if (closed) return; closed = true; clearTimeout(timer); seal(); route(url, null);
    try { editorPort.postMessage({ fatal: String(reason).slice(0, 4096) }); } catch (_) { /* The editor may already be gone. */ }
    editorPort.close(); workerPort.close(); channel.port2.close();
    if (!window.isDestroyed()) window.destroy();
    void isolated.closeAllConnections().catch(() => {});
  }
  function noHandles(event) {
    if (event.ports?.length) { for (const port of event.ports) port.close(); throw new Error("Transferred handles are forbidden."); }
  }
  editorPort.on("message", event => {
    void (async () => {
      noHandles(event);
      if (event.data?.terminate === true) { S.keys(event.data, ["terminate"]); close(); return; }
      if (!booted || pending) throw new Error("Concurrent or premature community request.");
      const message = V.message(event.data); V.binding(message, config.binding); V.requestPayload(message, config.bundle);
      if (seen.has(message.requestId) || seen.size >= 4096) throw new Error("Community request limit reached.");
      // Reserve before awaiting the local authorization check.
      pending = message; seen.add(message.requestId);
      if (!await authorized()) throw new Error("Community package authorization changed.");
      if (closed) return;
      timer = setTimeout(() => close("Community runner watchdog expired."), 250);
      workerPort.postMessage(message);
    })().catch(error => close(error.message));
  });
  workerPort.on("message", event => {
    try {
      noHandles(event);
      if (!connected) {
        S.keys(event.data, ["connected"]); if (event.data.connected !== true) throw new Error("Invalid runner handshake.");
        connected = true; workerPort.postMessage({ runtimeSource: runtimeSource(), config }); return;
      }
      if (!booted) {
        S.keys(event.data, ["booted"]); if (event.data.booted !== true) throw new Error("Invalid runner startup.");
        booted = true; clearTimeout(timer); editorPort.postMessage({ booted: true }); return;
      }
      if (!pending) throw new Error("Unsolicited community reply.");
      const reply = V.matches(event.data, pending), effect = V.requestPayload(pending, config.bundle);
      if (reply.operation === "error") S.keys(reply.payload, ["code", "message"]);
      else if (effect) V.result(reply.payload, effect, pending.operation); else S.keys(reply.payload, []);
      pending = null; clearTimeout(timer); editorPort.postMessage(reply);
    } catch (error) { close(error.message); }
  });
  editorPort.on("close", () => close()); workerPort.on("close", () => close());
  editorPort.start(); workerPort.start();
  window.on("closed", () => close());
  window.webContents.on("render-process-gone", () => close("Community runner process ended."));
  hardenContents(window.webContents);
  timer = setTimeout(() => close("Community runner startup timed out."), 10000);
  const ready = window.loadURL(url).then(() => {
    seal(); if (!closed) window.webContents.postMessage("zoidium:community-runner-port", null, [channel.port2]);
  }).catch(error => close(error.message));
  return { close, ready, window, session: isolated, url };
}
module.exports = { createRunnerHost, installSessionPolicy, hardenContents, runnerDocument };
