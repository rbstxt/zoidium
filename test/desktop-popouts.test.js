"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("desktop/main.cjs", "utf8");
function policy() {
  const start = source.indexOf("function installPopupPolicy("), end = source.indexOf("async function createWindow()", start);
  let open, navigate; const external = [];
  const install = vm.runInNewContext(source.slice(start, end) + "installPopupPolicy", {
    isLocalUrl: url => url.startsWith("http://127.0.0.1:17823/"), openExternal: url => external.push(url),
  });
  install({ setWindowOpenHandler: handler => { open = handler; }, on: (_event, handler) => { navigate = handler; } });
  return { open, navigate, external };
}
test("named empty editor popups keep sandbox, isolation, and web security without Node or a preload", () => {
  const { open } = policy();
  const allowed = open({ url: "about:blank", frameName: "zoidium-popout-graph" });
  assert.equal(allowed.action, "allow");
  const prefs = allowed.overrideBrowserWindowOptions.webPreferences;
  assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true);
  assert.equal(prefs.webSecurity, true); assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.preload, "");
  assert.equal(open({ url: "about:blank", frameName: "other" }).action, "deny");
  assert.equal(open({ url: "https://example.com/", frameName: "zoidium-popout-other" }).action, "deny");
  assert.equal(open({ url: "http://127.0.0.1:17823/index.html" }).action, "allow");
});
test("child navigation keeps the local URL boundary", () => {
  const { navigate, external } = policy(); let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  navigate(event, "http://127.0.0.1:17823/index.html"); assert.equal(prevented, 0);
  navigate(event, "https://example.com/"); assert.equal(prevented, 1);
  assert.deepEqual(external, ["https://example.com/"]);
});
