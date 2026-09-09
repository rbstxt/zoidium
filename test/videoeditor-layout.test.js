"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const patchSource = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "plugins",
    "core-patches",
    "remove-videoeditor-legacy-message.js"
  ),
  "utf8"
);

test("Video Editor setup omits the unsupported-app panel", () => {
  let setupAccount = null;
  const context = {
    ZOIDIUM_LAYOUT: "videoeditor",
    VE: {
      setUpEditor(account) {
        setupAccount = account;
      },
    },
  };
  context.window = context;

  vm.runInNewContext(patchSource, context);
  context.VE.setUpEditor(null);

  assert.equal(setupAccount.hasSubscription, true);
  assert.equal(context.VE.__zoidiumLegacyMessageRemoved, true);
});

test("Clipmaker setup is not changed by the Video Editor patch", () => {
  const original = function () {};
  const context = {
    ZOIDIUM_LAYOUT: "clipmaker",
    VE: { setUpEditor: original },
  };
  context.window = context;

  vm.runInNewContext(patchSource, context);

  assert.equal(context.VE.setUpEditor, original);
});
