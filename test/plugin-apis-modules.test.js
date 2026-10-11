"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

function apis() {
  const context = { PZ: {}, console };
  vm.runInNewContext(fs.readFileSync("zoidium/plugin-apis.js", "utf8"), context);
  return context.ZoidiumPluginApis;
}

function assets(files) {
  const calls = [];
  const getAsset = (kind, path) => { calls.push([kind, path]); return files[path]; };
  return { getAsset, calls };
}

test("createRequire loads bundle files once and resolves relative paths", () => {
  const { getAsset, calls } = assets({
    "./plugins/demo/main.js": "const a = require('./lib/a.js'); module.exports = a.value + require('./lib/b.js').value + extra;",
    "./plugins/demo/lib/a.js": "exports.value = 1;",
    "./plugins/demo/lib/b.js": "module.exports = { value: require('./a.js').value + 1 };",
  });
  const require = apis().modules.createRequire(getAsset, { root: "./plugins/demo/", scope: { extra: 10 } });
  assert.equal(require("./main.js"), 13);
  assert.equal(require("./main.js"), 13);
  assert.equal(calls.filter(([, path]) => path === "./plugins/demo/lib/a.js").length, 1);
  assert.ok(calls.every(([kind]) => kind === "text"));
});

test("createRequire keeps modules inside the plugin root and reports missing files", () => {
  const { getAsset } = assets({ "./plugins/demo/x.js": "require('../other/y.js');" });
  const require = apis().modules.createRequire(getAsset, { root: "./plugins/demo/" });
  assert.throws(() => require("./x.js"), /outside/);
  assert.throws(() => require("../../../etc/passwd"), /leaves the bundle|outside/);
  assert.throws(() => require("./missing.js"), /missing module/);
});

test("createRequire returns partial exports for cycles and retries after a throw", () => {
  let fail = true;
  const files = {
    "./plugins/demo/a.js": "exports.early = 1; exports.fromB = require('./b.js').seen;",
    "./plugins/demo/b.js": "exports.seen = require('./a.js').early;",
  };
  const getAsset = (kind, path) => {
    if (path === "./plugins/demo/flaky.js") return fail ? "throw new Error('boom');" : "module.exports = 5;";
    return files[path];
  };
  const require = apis().modules.createRequire(getAsset, { root: "./plugins/demo/" });
  assert.equal(require("./a.js").fromB, 1);
  assert.throws(() => require("./flaky.js"), /boom/);
  fail = false;
  assert.equal(require("./flaky.js"), 5);
});
