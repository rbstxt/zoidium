"use strict";

// Coverage for the grouped Plugins panel: registry packs, the per-pack
// master switch that enables or disables every plugin at once, and the
// compatibility badge rule that AfterClip depends on (it is a CM3-compatible
// shader pack that also carries an advisory migration notice).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { validateRegistryCategories } = require("../tools/validate-plugin-manifests");

const projectRoot = path.resolve(__dirname, "..");
const managerSource = fs.readFileSync(
  path.join(projectRoot, "plugins/plugin-manager.js"),
  "utf8"
);
const registry = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "plugins/registry.json"), "utf8")
);

function pluginEntry(id) {
  const entry = registry.plugins.find((plugin) => plugin.id === id);
  assert.ok(entry, `${id} is registered`);
  return entry;
}

test("every visible plugin belongs to a declared pack", () => {
  validateRegistryCategories(registry);

  const packs = new Map();
  for (const plugin of registry.plugins) {
    if (plugin.visibility === "hidden" || plugin.alwaysEnabled === true) continue;
    assert.ok(plugin.category, `${plugin.id} declares a category`);
    if (!packs.has(plugin.category)) packs.set(plugin.category, []);
    packs.get(plugin.category).push(plugin.id);
  }

  assert.deepEqual(Object.fromEntries(packs), {
    utilities: ["easing-plus", "player-plus"],
    scene: [
      "light-plus",
      "geometry-plus",
      "repeater",
      "material-plus",
      "text-plus",
      "particles-plus",
    ],
    adjustment: [
      "native-fx",
      "afterclip",
      "alipfx-shader-pack-4",
      "ccfx-shader-pack",
    ],
    experimental: ["layer-input"],
  });
});

test("pack order follows the registry category order", () => {
  assert.deepEqual(
    registry.categories.map((category) => category.id),
    ["utilities", "scene", "adjustment", "experimental"]
  );
});

test("only the experimental pack starts folded", () => {
  const folded = registry.categories
    .filter((category) => category.collapsed === true)
    .map((category) => category.id);
  assert.deepEqual(folded, ["experimental"]);
});

test("the registry validator rejects unknown categories and duplicate ids", () => {
  const plugins = [{ id: "demo", name: "Demo", category: "utilities" }];
  const categories = [{ id: "utilities", name: "Utilities" }];

  assert.doesNotThrow(() =>
    validateRegistryCategories({ categories, plugins })
  );
  assert.throws(
    () => validateRegistryCategories({ categories, plugins: [{ ...plugins[0], category: "nope" }] }),
    /unknown category "nope"/
  );
  assert.throws(
    () => validateRegistryCategories({ categories, plugins: [{ ...plugins[0], category: undefined }] }),
    /must declare a category/
  );
  assert.throws(
    () =>
      validateRegistryCategories({
        categories: [...categories, { id: "utilities", name: "Again" }],
        plugins,
      }),
    /Duplicate registry category/
  );
  // Hidden built-ins (Zoidium Core) stay out of the panel entirely.
  assert.doesNotThrow(() =>
    validateRegistryCategories({
      categories,
      plugins: [{ id: "core", visibility: "hidden", alwaysEnabled: true }],
    })
  );
});

// Runs the badge builders against real plugin descriptors so the rule stays
// behavioral rather than a source pattern.
function loadBadgeScope() {
  const start = managerSource.indexOf("  function compatBadgeHtml(plugin) {");
  const end = managerSource.indexOf("  function pluginSwitchHtml(options) {");
  assert.ok(start >= 0 && end > start, "badge builders are present");
  const script =
    managerSource.slice(start, end) + "\n__scope = { compatBadgeHtml, experimentalBadgeHtml };";
  const sandbox = { __scope: null };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "plugin-manager-badges.js" });
  return sandbox.__scope;
}

test("AfterClip is CM3 compatible but keeps its migration notice", () => {
  const afterclip = pluginEntry("afterclip");
  assert.equal(afterclip.zoidiumOnly, undefined);
  assert.ok(afterclip.warning, "the temporary-plugin notice stays visible");

  const badges = loadBadgeScope();
  const cm3 = badges.compatBadgeHtml(afterclip);
  assert.match(cm3, /data-compat="cm3"/);
  assert.match(cm3, /CM3 compatible/);
  assert.doesNotMatch(cm3, /Zoidium only/);

  // warning text alone must never flip the badge; only zoidiumOnly does.
  const advisory = badges.compatBadgeHtml({ id: "demo", name: "Demo", warning: "Careful." });
  assert.match(advisory, /data-compat="cm3"/);

  const zoidiumOnly = badges.compatBadgeHtml({
    id: "demo",
    name: "Demo",
    zoidiumOnly: true,
    warning: "Careful.",
  });
  assert.match(zoidiumOnly, /data-compat="zoidium"/);
  assert.match(zoidiumOnly, /title="Careful\."/);

  const unlabelled = badges.compatBadgeHtml({ id: "demo", name: "Demo", zoidiumOnly: true });
  assert.match(unlabelled, /Requires Zoidium/);

  // Every other pack keeps its declared compatibility.
  assert.equal(pluginEntry("alipfx-shader-pack-4").zoidiumOnly, undefined);
  assert.equal(pluginEntry("ccfx-shader-pack").zoidiumOnly, undefined);
  assert.equal(pluginEntry("native-fx").zoidiumOnly, true);
  assert.equal(pluginEntry("layer-input").zoidiumOnly, true);
});

// The group block runs against stubbed DOM-facing helpers: the master switch
// tally and the bulk enable/disable loop are what these tests exercise.
function loadGroupScope(options) {
  const config = options || {};
  const refuse = config.refuse || new Set();
  const start = managerSource.indexOf("  // ---- plugin groups");
  const end = managerSource.indexOf("  function createPanel(registry) {");
  assert.ok(start >= 0 && end > start, "group block is present");
  const script =
    managerSource.slice(start, end) +
    "\n__scope = { createGroupSection, createPluginGroup, syncGroupSwitch, syncGroupForPlugin, setGroupEnabled, pluginEnabledForGroup };";

  const calls = { enabled: [], disabled: [], busyWhileEnabling: [] };
  const sandbox = {
    pluginGroups: [],
    pluginGroupByPluginId: new Map(),
    document: {
      // Enough of an element for createGroupSection: it only sets properties
      // and queries its own markup through querySelector.
      createElement() {
        return {
          className: "",
          dataset: {},
          innerHTML: "",
          open: false,
          querySelector: () => null,
        };
      },
    },
    pluginSwitchHtml: () => "",
    enablePlugin: async (state, persist) => {
      calls.enabled.push([state.plugin.id, persist]);
      calls.busyWhileEnabling.push(state.groupToggleDisabled);
      state.card.dataset.phase = "enabled";
      state.card.dataset.enabled = "true";
    },
    disablePlugin: (state, persist) => {
      calls.disabled.push([state.plugin.id, persist]);
      // disablePlugin refuses to unload plugins the current project uses.
      if (refuse.has(state.plugin.id)) return;
      state.card.dataset.phase = "disabled";
      state.card.dataset.enabled = "false";
    },
    __scope: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "plugin-manager-groups.js" });
  return { scope: sandbox.__scope, calls };
}

function makeState(id, enabled) {
  return {
    plugin: { id },
    card: {
      dataset: {
        enabled: String(enabled),
        phase: enabled ? "enabled" : "disabled",
      },
    },
  };
}

function makeGroup(states) {
  const group = {
    id: "test",
    name: "Test Pack",
    toggle: { checked: false, indeterminate: false, disabled: false },
    count: { textContent: "" },
    members: states,
    busy: false,
  };
  for (const state of states) {
    Object.defineProperty(state, "groupToggleDisabled", {
      configurable: true,
      get: () => group.toggle.disabled,
    });
  }
  return group;
}

test("packs start open unless the category asks to start folded", () => {
  const { scope } = loadGroupScope();

  assert.equal(scope.createGroupSection({ id: "utilities", name: "Utilities" }).open, true);
  assert.equal(
    scope.createGroupSection({ id: "scene", name: "Scene Extensions", collapsed: false }).open,
    true
  );
  assert.equal(
    scope.createGroupSection({ id: "experimental", name: "Experimental", collapsed: true }).open,
    false
  );

  // The real registry folds only Experimental.
  const experimental = registry.categories.find((category) => category.id === "experimental");
  assert.equal(scope.createGroupSection(experimental).open, false);
  for (const category of registry.categories.filter((entry) => entry.id !== "experimental")) {
    assert.equal(scope.createGroupSection(category).open, true, category.id);
  }
});

test("the master switch reports how much of the pack is on", () => {
  const { scope } = loadGroupScope();

  const mixed = makeGroup([makeState("a", true), makeState("b", false), makeState("c", false)]);
  scope.syncGroupSwitch(mixed);
  assert.equal(mixed.toggle.checked, false);
  assert.equal(mixed.toggle.indeterminate, true);
  assert.equal(mixed.count.textContent, "1 of 3 on");

  const all = makeGroup([makeState("a", true), makeState("b", true)]);
  scope.syncGroupSwitch(all);
  assert.equal(all.toggle.checked, true);
  assert.equal(all.toggle.indeterminate, false);
  assert.equal(all.count.textContent, "2 of 2 on");

  const none = makeGroup([makeState("a", false), makeState("b", false)]);
  scope.syncGroupSwitch(none);
  assert.equal(none.toggle.checked, false);
  assert.equal(none.toggle.indeterminate, false);
  assert.equal(none.count.textContent, "0 of 2 on");
});

test("a card that has not been toggled yet still counts from its initial flag", () => {
  const { scope } = loadGroupScope();
  const fresh = { plugin: { id: "fresh" }, card: { dataset: { enabled: "true" } } };
  assert.equal(scope.pluginEnabledForGroup(fresh), true);

  const failed = { plugin: { id: "failed" }, card: { dataset: { enabled: "false", phase: "error" } } };
  assert.equal(scope.pluginEnabledForGroup(failed), false);
});

test("enabling a pack loads every plugin that is still off", async () => {
  const { scope, calls } = loadGroupScope();
  const group = makeGroup([makeState("a", true), makeState("b", false), makeState("c", false)]);

  await scope.setGroupEnabled(group, true);

  assert.deepEqual(calls.enabled, [
    ["b", true],
    ["c", true],
  ]);
  assert.deepEqual(calls.disabled, []);
  assert.equal(group.busy, false);
  assert.equal(group.toggle.disabled, false);
  assert.equal(group.toggle.checked, true);
  assert.equal(group.count.textContent, "3 of 3 on");
  // The master switch is locked while the pack loads so clicks cannot race.
  assert.deepEqual(calls.busyWhileEnabling, [true, true]);
});

test("disabling a pack unloads only the plugins that are on", async () => {
  const { scope, calls } = loadGroupScope();
  const group = makeGroup([makeState("a", true), makeState("b", false), makeState("c", true)]);

  await scope.setGroupEnabled(group, false);

  assert.deepEqual(calls.disabled, [
    ["a", true],
    ["c", true],
  ]);
  assert.deepEqual(calls.enabled, []);
  assert.equal(group.toggle.checked, false);
  assert.equal(group.toggle.indeterminate, false);
  assert.equal(group.count.textContent, "0 of 3 on");
});

test("a plugin that refuses to unload leaves the pack mixed", async () => {
  const { scope, calls } = loadGroupScope({ refuse: new Set(["b"]) });
  const group = makeGroup([makeState("a", true), makeState("b", true)]);

  await scope.setGroupEnabled(group, false);

  assert.deepEqual(calls.disabled, [
    ["a", true],
    ["b", true],
  ]);
  assert.equal(scope.pluginEnabledForGroup(group.members[0]), false);
  assert.equal(scope.pluginEnabledForGroup(group.members[1]), true);
  assert.equal(group.toggle.checked, false);
  assert.equal(group.toggle.indeterminate, true);
  assert.equal(group.count.textContent, "1 of 2 on");
});

test("an empty pack leaves the master switch alone", async () => {
  const { scope, calls } = loadGroupScope();
  const group = makeGroup([]);
  await scope.setGroupEnabled(group, true);
  assert.deepEqual(calls.enabled, []);
  assert.equal(group.count.textContent, "");
});

test("the panel wires pack sections, master switches, and filtered groups", () => {
  const panel = managerSource.slice(
    managerSource.indexOf("function createPanel(registry)"),
    managerSource.indexOf("function createTab(panel)")
  );
  assert.match(panel, /createPluginGroup\(category\)/, "declared categories render as packs");
  assert.match(panel, /groupForPlugin\(plugin\)/, "each card lands in its pack");
  assert.match(panel, /group\.section\.remove\(\)/, "empty packs are dropped");
  assert.match(panel, /onUpdate: syncGroupSearchState/, "the filter reports what stayed visible");
  assert.match(panel, /group\.section\.hidden = visible === 0/, "empty packs hide while filtering");

  const group = managerSource.slice(
    managerSource.indexOf("function createPluginGroup(category)"),
    managerSource.indexOf("function syncGroupSwitch(group)")
  );
  assert.match(group, /addEventListener\("change", \(\) => \{\s*setGroupEnabled\(group, group\.toggle\.checked\);/, "the master switch toggles the pack");
  assert.match(group, /zoidium-plugin-category-switch/, "the switch lives in the pack summary");
});

test("plugin cards show credits below descriptions without active counts", () => {
  assert.equal(pluginEntry("alipfx-shader-pack-4").credits, "Credits: AlipFX");
  assert.equal(pluginEntry("ccfx-shader-pack").credits, "Credits: CCFX");
  assert.equal(pluginEntry("text-plus").credits, "Credits: DaviFX");
  assert.match(managerSource, /zoidium-plugin-credits/, "credits have a dedicated line");
  assert.doesNotMatch(managerSource, /\b(?:active|Enabled|Disabled)\b/, "plugin cards no longer expose status labels");
});
