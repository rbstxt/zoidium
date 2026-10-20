"use strict";

// ESLint runs in `pnpm run verify` with one rule, no-undef: split files share
// helpers through explicit imports, and a missing import otherwise only fails
// at runtime on the path that uses it.

const globals = require("globals");

// Names the CM3 host page or the Zoidium loaders provide to evaluated code.
const hostGlobals = {
  PZ: "readonly", THREE: "readonly", CM: "readonly",
  ZoidiumUI: "readonly", ZoidiumPluginApis: "readonly",
  PZVERSION: "readonly", PZTOOLVERSION: "readonly", ISNODE: "readonly",
  // Overlay scripts also export themselves to node tests behind
  // `typeof module === "object"` guards.
  module: "readonly", require: "readonly",
};

module.exports = [
  {
    ignores: ["plugins/alipfx/**", "plugins/mp4-export/vendor/**", "**/bundle.json", "node_modules/**", "dist/**", ".zoidium-resources/**"],
  },
  {
    files: ["**/*.js", "**/*.cjs"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: { ...globals.browser, ...globals.worker, ...hostGlobals },
    },
    rules: { "no-undef": "error" },
  },
  {
    // Plugin sources run as function bodies (module, exports, require, plus
    // the loader scope: context, parts, T, ...), so a top-level return is legal.
    files: ["plugins/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node, context: "readonly", parts: "readonly", T: "readonly", plugin: "readonly" },
    },
  },
  {
    files: ["tools/**", "desktop/**", "test/**", "eslint.config.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
  },
];
