"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

test("deployed site sends framing, object, and MIME-sniffing protections", () => {
  const fs = require("node:fs");
  const headers = fs.readFileSync(path.join(__dirname, "..", "_headers"), "utf8");
  assert.match(headers, /Content-Security-Policy: frame-ancestors 'self'; object-src 'none'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  // The staged CM3 page carries inline scripts, so script-src would break it.
  assert.doesNotMatch(headers, /script-src/);
});

// SEC-12: Electron deny-by-default permission handlers.


test("desktop allows only clipboard permissions and denies the rest", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const start = source.indexOf("const ALLOWED_PERMISSIONS");
  const end = source.indexOf("\n}\n", source.indexOf("function isAllowedPermission(")) + 3;
  const isAllowedPermission = vm.runInNewContext(`${source.slice(start, end)}\nisAllowedPermission`, {});
  assert.equal(isAllowedPermission("clipboard-read"), true);
  assert.equal(isAllowedPermission("clipboard-sanitized-write"), true);
  for (const permission of [
    "camera", "microphone", "geolocation", "notifications", "fullscreen",
    "midi", "pointerLock", "mediaKeySystem", "openExternal",
  ]) {
    assert.equal(isAllowedPermission(permission), false, permission);
  }
  for (const marker of [
    "setPermissionRequestHandler",
    "setPermissionCheckHandler",
    "setDevicePermissionHandler",
    "installPermissionHandlers(window.webContents.session)",
  ]) {
    assert.ok(source.includes(marker), `missing: ${marker}`);
  }
});

// SEC-10: dev server Host validation.


test("development server only serves loopback hosts on its own port", () => {
  const { isAllowedHost } = require("../tools/serve-with-resources");
  assert.equal(isAllowedHost("127.0.0.1:8346", 8346), true);
  assert.equal(isAllowedHost("localhost:8346", 8346), true);
  assert.equal(isAllowedHost("[::1]:8346", 8346), true);
  assert.equal(isAllowedHost("localhost", 8346), true);
  assert.equal(isAllowedHost("evil.example:8346", 8346), false);
  assert.equal(isAllowedHost("attacker.test", 8346), false);
  assert.equal(isAllowedHost("127.0.0.1:9999", 8346), false);
  assert.equal(isAllowedHost(undefined, 8346), false);
  assert.equal(isAllowedHost("", 8346), false);
  assert.equal(isAllowedHost("127.0.0.1:8346.", 8346), false);
  const fs = require("node:fs");
  const source = fs.readFileSync(path.join(__dirname, "..", "tools", "serve-with-resources.js"), "utf8");
  assert.ok(source.includes("isAllowedHost(request.headers"), "handleRequest must check Host");
});

// SEC-11: snapshot decompression ceiling.
