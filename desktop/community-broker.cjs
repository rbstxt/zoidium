"use strict";
const { createDiskAdapter, digest } = require("./community-plugins.cjs");
const { createRunnerHost } = require("./community-runner.cjs");
const P = require("../zoidium/community-package");
const S = require("../zoidium/community-safe-json");

function createCommunityBroker({ electron, userData, getWindow, getOrigin, safeMode = false }) {
  const { ipcMain } = electron, routes = new Map(), runners = new Map();
  let adapter;
  const storage = () => adapter ||= createDiskAdapter(userData);
  function isEditor(event) {
    const contents = getWindow()?.webContents, frame = event.senderFrame;
    if (!contents || contents.isDestroyed() || event.sender !== contents || !frame || frame !== contents.mainFrame) return false;
    try {
      const url = new URL(frame.url);
      return url.origin === getOrigin() && ["/", "/index.html", "/video-editor.html"].includes(url.pathname);
    } catch (_) { return false; }
  }
  async function assertEditor(event) {
    if (!isEditor(event)) throw new Error("Community IPC requires the editor main frame.");
    const frame = event.senderFrame;
    if (!await event.sender.executeJavaScript('localStorage.getItem("zoidium.community-preview") === "1"') ||
        !isEditor(event) || event.senderFrame !== frame) throw new Error("Community preview is disabled.");
  }
  async function approved(id, hash) {
    const state = await storage().load(), record = state?.records.find(r => r.id === id);
    return Boolean(!safeMode && !state?.safeMode && record?.enabled && !record.quarantine &&
      record.selected === hash && record.approvals.includes(hash) && record.verified.includes(hash) &&
      state.blobs[hash] && digest(state.blobs[hash]) === hash);
  }
  ipcMain.handle("zoidium:community-store", async (event, request) => {
    await assertEditor(event);
    if (request?.operation === "load") { S.keys(request, ["operation"]); return storage().load(); }
    S.keys(request, ["operation", "revision", "next"]);
    if (request.operation !== "commit") throw new Error("Unknown community storage operation.");
    await storage().commit(request.revision, request.next);
    // Disable and uninstall close their runner before the store call resolves.
    for (const [id, runner] of runners) if (!await approved(id, runner.hash)) runner.host.close("Community package selection changed.");
    return null;
  });
  ipcMain.on("zoidium:community-connect", (event, request) => {
    void (async () => {
      if (event.ports.length !== 1) throw new Error("Exactly one community port is required.");
      await assertEditor(event);
      S.keys(request, ["bytes", "approvedHash", "runnerGeneration"]);
      if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength > P.LIMITS.packageBytes ||
          !Number.isSafeInteger(request.runnerGeneration) || request.runnerGeneration < 0 || digest(request.bytes) !== request.approvedHash) throw new Error("Invalid community runner configuration.");
      const bundle = P.parse(request.bytes), id = bundle.manifest.id;
      if (!await approved(id, request.approvedHash)) throw new Error("Exact-hash approval required.");
      if (!isEditor(event) || runners.has(id) || runners.size >= 4) throw new Error("Community runner capacity reached.");
      const config = { binding: { packageId: id, packageHash: request.approvedHash, runnerGeneration: request.runnerGeneration }, bundle };
      const host = createRunnerHost({ electron, origin: getOrigin(), config, editorPort: event.ports[0],
        authorized: async () => { await assertEditor(event); return approved(id, request.approvedHash); },
        route: (url, document) => { if (document) routes.set(url, document); else { routes.delete(url); runners.delete(id); } },
      });
      runners.set(id, { host, hash: request.approvedHash });
    })().catch(error => {
      for (const port of event.ports) {
        try { port.postMessage({ fatal: String(error.message).slice(0, 4096) }); } finally { port.close(); }
      }
    });
  });
  function close() { for (const runner of [...runners.values()]) runner.host.close(); routes.clear(); runners.clear(); }
  function serve(request, response, origin) {
    const document = routes.get(origin + request.url);
    if (!document || request.method !== "GET" || request.headers.host !== new URL(origin).host) return false;
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": document.policy,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    response.end(document.html); return true;
  }
  return { close, serve };
}
module.exports = { createCommunityBroker };
