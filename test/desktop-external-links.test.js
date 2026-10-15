"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../desktop/main.cjs"), "utf8");

test("desktop opens only web and mail links outside the app", () => {
  const start = source.indexOf("const EXTERNAL_PROTOCOLS");
  const end = source.indexOf("\n}\n", source.indexOf("function openExternal(")) + 3;
  const opened = [];
  const logged = [];
  const openExternal = vm.runInNewContext(source.slice(start, end) + "\nopenExternal", {
    URL,
    shell: { openExternal: (url) => { opened.push(url); return Promise.resolve(); } },
    logMain: (level, message) => logged.push([level, message]),
  });
  for (const url of ["https://example.com/", "http://example.com/a", "mailto:hello@example.com"]) openExternal(url);
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "evil-handler:run", "not a url"]) openExternal(url);
  assert.deepEqual(opened, ["https://example.com/", "http://example.com/a", "mailto:hello@example.com"]);
  assert.equal(logged.length, 4);
  assert.ok(logged.every(([level]) => level === "warn"));
});
