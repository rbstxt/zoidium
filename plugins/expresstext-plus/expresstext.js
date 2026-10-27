"use strict";

// ExpressText+ — tracked-letter text effector stack.
//
// One ExpressText+ container parents a 3D Text object and splits it into
// separately tracked letters (own namespace, so Text+ and the stock text
// pipeline are untouched). Effectors are stock Custom properties: the
// container's customs list is scoped so its + dialog offers only Shake,
// Plain, Random, Formula, Delay, Spline, Orbit, Repeater, Twist, Wrap
// and Voronoi, each a group of
// XYZ/strength/selection/field rows evaluated per letter per frame.
// Stock panel, stock undo, stock save/load — no custom DOM.
//
// Pure math (selection, strength, fields, stagger, effector envelopes) is
// DOM/THREE-free and covered by unit tests through the _test export.
//
// The implementation lives in the sibling files, loaded through the shared
// bundle loader in the shipped bundle and through local files in Node
// (tests). This entry only binds the parts and delegates.

function loadExpressPlugin(context) {
  if (
    context &&
    context.apis &&
    context.apis.modules &&
    typeof context.apis.modules.createRequire === "function" &&
    typeof context.getAsset === "function"
  ) {
    const bundleRequire = context.apis.modules.createRequire(context.getAsset, {
      root: "./plugins/expresstext-plus/",
    });
    return bundleRequire("./expresstext-plugin.js");
  }
  return require("./expresstext-plugin.js");
}

let plugin = null;

// The sibling files need no host context under plain Node require, but the
// bundle loader does; when neither is available yet, stay unbound and let
// ensureExpressPlugin(context) bind later at activation.
try {
  if (typeof require === "function") plugin = loadExpressPlugin(null);
} catch (error) {
  plugin = null;
}

function ensureExpressPlugin(context) {
  if (!plugin) plugin = loadExpressPlugin(context);
  return plugin;
}

module.exports = {
  activate(context) {
    return ensureExpressPlugin(context).activate(context);
  },
  deactivate() {
    if (plugin) return plugin.deactivate();
    return undefined;
  },
  get _test() {
    return (plugin && plugin._test) || {};
  },
};
