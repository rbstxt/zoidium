"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const { installSessionPolicy, hardenContents, runnerDocument } = require("../desktop/community-runner.cjs");
function policy() {
  const session = new EventEmitter(); let handler;
  session.webRequest = { onBeforeRequest: fn => { handler = fn; } };
  for (const method of ["setPermissionRequestHandler", "setPermissionCheckHandler", "setDevicePermissionHandler", "setDisplayMediaRequestHandler"]) session[method] = fn => { session[method + "Callback"] = fn; };
  const url = "http://127.0.0.1:23456/__zoidium-community/abc";
  const seal = installSessionPolicy(session, url, () => 42);
  function request(values) { let result; handler(values, r => { result = r; }); return result.cancel; }
  return { session, seal, request, bootstrap: { url, method: "GET", resourceType: "mainFrame", webContentsId: 42 } };
}
test("runner allows the exact bootstrap once, then denies every request without frame metadata", () => {
  const { request, bootstrap } = policy();
  for (const change of [{ url: bootstrap.url + "?x" }, { url: bootstrap.url + "/" }, { method: "POST" },
    { webContentsId: undefined }, { webContentsId: 43 }, { resourceType: "subFrame" },
    { url: bootstrap.url.replace("127.0.0.1", "localhost") }, { url: bootstrap.url.replace("23456", "23457") }]) {
    assert.equal(request({ ...bootstrap, ...change }), true);
  }
  assert.equal(request(bootstrap), false);
  for (const url of [bootstrap.url, "http://127.0.0.1:23456/", "https://example.invalid/", "ws://127.0.0.1:23456/", "file:///tmp/data", "data:text/html,blocked"]) {
    assert.equal(request({ url, method: "GET", resourceType: "mainFrame" }), true);
  }
});
test("runner failure seals the bootstrap and denies permissions, devices, downloads, and display capture", () => {
  const { seal, request, session, bootstrap } = policy(); seal(); assert.equal(request(bootstrap), true);
  let granted; session.setPermissionRequestHandlerCallback(null, "clipboard-read", value => { granted = value; });
  assert.equal(granted, false); assert.equal(session.setPermissionCheckHandlerCallback(), false);
  assert.equal(session.setDevicePermissionHandlerCallback(), false);
  session.setDisplayMediaRequestHandlerCallback({}, value => { granted = value; }); assert.deepEqual(granted, {});
  let stopped = false; session.emit("will-download", { preventDefault() { stopped = true; } }); assert.equal(stopped, true);
});
test("runner denies child and frame navigation, redirects, popups, and webview attachment", () => {
  const contents = new EventEmitter(); let open;
  contents.setWindowOpenHandler = fn => { open = fn; }; hardenContents(contents);
  assert.deepEqual(open({ url: "http://127.0.0.1/" }), { action: "deny" });
  for (const event of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
    let prevented = false; contents.emit(event, { preventDefault() { prevented = true; } }); assert.equal(prevented, true, event);
  }
});
test("runner response and early meta CSP permit only fixed nonce script and local Worker bytes", () => {
  const { policy, html } = runnerDocument();
  assert.match(policy, /connect-src 'none'/); assert.match(policy, /frame-src 'none'/);
  assert.match(policy, /worker-src blob:/); assert.match(policy, /frame-ancestors 'none'/);
  assert.ok(html.includes('content="' + policy + '"'));
  const nonce = /nonce-([a-f0-9]+)/.exec(policy)[1]; assert.ok(html.includes('nonce="' + nonce + '"'));
  for (const forbidden of ["'unsafe-eval'", "report-uri", "report-to", "sourceMappingURL", "http://", "https://"]) assert.equal(policy.includes(forbidden), false);
});
