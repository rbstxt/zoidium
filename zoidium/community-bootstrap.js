"use strict";

(function (root) {
  const commonJS = typeof module === "object" && module.exports;
  const S = commonJS ? require("./community-safe-json") : root.ZoidiumCommunityJSON;
  const P = commonJS ? require("./community-package") : root.ZoidiumCommunityPackage;
  const V = commonJS ? require("./community-protocol") : root.ZoidiumCommunityProtocol;
  const activePackages = new Set();
  function bootstrap(parentOrigin, challenge) {
    let port, worker, url;
    function stop() { if (worker) worker.terminate(); if (url) URL.revokeObjectURL(url); if (port) port.close(); }
    addEventListener("pagehide", stop);
    addEventListener("message", function start(event) {
      if (event.source !== parent || event.origin !== parentOrigin || event.data?.challenge !== challenge) return;
      removeEventListener("message", start);
      if (event.ports.length !== 1) { stop(); return; }
      port = event.ports[0];
      try {
        url = URL.createObjectURL(new Blob([event.data.runtimeSource], { type: "text/javascript" }));
        worker = new Worker(url);
        worker.onmessage = e => {
          if (e.ports.length) { stop(); return; }
          port.postMessage(e.data);
          if (e.data?.booted && url) { URL.revokeObjectURL(url); url = null; }
        };
        worker.onerror = () => { port.postMessage({ fatal: "Worker failed" }); stop(); };
        port.onmessage = e => {
          if (e.ports.length) { port.postMessage({ fatal: "Transferred handles are forbidden" }); stop(); return; }
          if (e.data?.terminate === challenge) { worker.terminate(); port.postMessage({ terminated: true }); stop(); }
          else worker.postMessage(e.data);
        };
        port.start();
        worker.postMessage(event.data.config);
      } catch (_) { port.postMessage({ fatal: "Bootstrap failed" }); stop(); }
    });
    parent.postMessage({ communityReady: challenge }, parentOrigin);
  }
  function documentSource(parentOrigin, challenge, nonce) {
    for (const value of [challenge, nonce]) if (!/^[a-f0-9]{32,128}$/.test(value)) throw new Error("Invalid bootstrap token");
    if (!/^https?:\/\//.test(parentOrigin) || new URL(parentOrigin).origin !== parentOrigin) throw new Error("Unsupported parent origin");
    const policy = "default-src 'none'; connect-src 'none'; script-src 'nonce-" + nonce + "' 'wasm-unsafe-eval'; worker-src blob:; img-src 'none'; font-src 'none'; style-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
    const script = "(" + bootstrap.toString() + ")(" + JSON.stringify(parentOrigin) + "," + JSON.stringify(challenge) + ")";
    return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + policy + '"><script nonce="' + nonce + '">' + script + '</script>';
  }
  function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, "0")).join(""); }
  async function createRunner({ bytes, approvedHash, runtimeSource, runnerGeneration = 1 }) {
    // runtimeSource must be supplied by trusted application build tooling, never by a package.
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > P.LIMITS.packageBytes) throw new Error("Invalid package bytes");
    bytes = bytes.slice();
    const hash = "sha256-" + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))));
    if (hash !== approvedHash) throw new Error("Exact-hash approval required");
    const bundle = P.parse(bytes), binding = { packageId: bundle.manifest.id, packageHash: hash, runnerGeneration };
    if (!Number.isSafeInteger(runnerGeneration) || runnerGeneration < 0) throw new Error("Invalid runner generation");
    if (activePackages.size >= 4 || activePackages.has(bundle.manifest.id)) throw new Error("Runner capacity reached");
    activePackages.add(bundle.manifest.id);
    const challenge = randomToken(), nonce = randomToken();
    const desktop = Boolean(root.ZoidiumDesktopCommunity);
    const frame = desktop ? null : document.createElement("iframe");
    if (frame) { frame.sandbox = "allow-scripts"; frame.hidden = true; }
    const channel = new MessageChannel(); let pending, closed = false, initialized = false;
    function close(reason = "Runner disposed") {
      if (closed) return; closed = true;
      activePackages.delete(bundle.manifest.id);
      removeEventListener("message", ready);
      clearTimeout(startupTimer);
      channel.port1.postMessage({ terminate: desktop ? true : challenge });
      channel.port1.close(); channel.port2.close(); frame?.remove();
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error(reason)); pending = null; }
    }
    let bootResolve, bootReject;
    const boot = new Promise((resolve, reject) => { bootResolve = resolve; bootReject = reject; });
    const startupTimer = setTimeout(() => { bootReject(new Error("Runner startup timed out")); close(); }, 10000);
    function ready(event) {
      if (event.source !== frame.contentWindow || event.origin !== "null" || event.data?.communityReady !== challenge) return;
      removeEventListener("message", ready);
      frame.contentWindow.postMessage({ challenge, runtimeSource, config: { binding, bundle } }, "*", [channel.port2]);
    }
    if (!desktop) addEventListener("message", ready);
    channel.port1.onmessage = event => {
      try {
        if (event.ports.length) throw new Error("Transferred handles are forbidden");
        if (!initialized && event.data?.booted === true) { S.keys(event.data, ["booted"]); initialized = true; clearTimeout(startupTimer); bootResolve(); return; }
        if (event.data?.fatal) throw new Error(String(event.data.fatal));
        if (!pending) throw new Error("Unsolicited or duplicate reply");
        const reply = V.matches(event.data, pending.message);
        const effect = V.requestPayload(pending.message, bundle);
        if (reply.operation === "error") { S.keys(reply.payload, ["code", "message"]); throw new Error(String(reply.payload.message).slice(0, 4096)); }
        if (effect) V.result(reply.payload, effect, pending.message.operation); else S.keys(reply.payload, []);
        const done = pending; pending = null; clearTimeout(done.timer); done.resolve(reply);
      } catch (error) { bootReject(error); close(error.message); }
    };
    channel.port1.onmessageerror = () => { bootReject(new Error("Invalid runner message")); close("Invalid runner message"); };
    if (desktop) {
      window.postMessage({ type: "zoidium:community-connect", config: { bytes, approvedHash, runnerGeneration } }, location.origin, [channel.port2]);
    } else { frame.srcdoc = documentSource(location.origin, challenge, nonce); document.body.append(frame); }
    try { await boot; } catch (error) { close(); throw error; }
    const seen = new Set();
    return {
      binding,
      request(message) {
        if (closed) return Promise.reject(new Error("Runner is closed"));
        try {
          V.message(message); V.binding(message, binding); V.requestPayload(message, bundle);
          if (pending || seen.has(message.requestId) || seen.size >= 4096) throw new Error("Duplicate request or runner request limit reached");
          seen.add(message.requestId);
          // Copy before queuing; a caller cannot mutate the pending authority.
          message = S.parse(JSON.stringify(message), 65536);
          return new Promise((resolve, reject) => {
            pending = { message, resolve, reject, timer: setTimeout(() => close("Runner watchdog expired"), 250) };
            channel.port1.postMessage(message);
          });
        } catch (error) { return Promise.reject(error); }
      },
      dispose: close,
    };
  }
  const api = { documentSource, createRunner };
  if (commonJS) module.exports = api; else root.ZoidiumCommunityBootstrap = api;
})(globalThis);
