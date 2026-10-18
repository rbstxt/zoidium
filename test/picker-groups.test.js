"use strict";

// Collapsible object/effect picker groups: category headings collapse on
// click, Enter or Space by detaching their rows (headings stay), persist
// per picker in localStorage, and stay expanded while searching. Detached
// rows are unreachable to the picker's stock keyboard handling.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { FakeElement } = require("./fake-dom.js");
const { loadSharedTables } = require("./shared-test-apis");
const { managerFiles } = require("./plugin-manager-source");

function loadPickerManager() {
  const storage = new Map();
  const sandbox = {
    console,
    ZoidiumPluginApis: loadSharedTables(),
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    requestAnimationFrame: (callback) => { callback(); },
    setTimeout() {},
    clearTimeout() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const root = path.resolve(__dirname, "..");
  for (const file of managerFiles()) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file });
  }
  const manager = sandbox.ZoidiumPluginManagerInternals;
  const effectTypes = [
    { name: "Color Overlay", desc: "Blends a solid color.", _zoidiumPluginId: "fixture" },
    { name: "Negative", desc: "Inverts colors.", _zoidiumPluginId: "other" },
    { name: "Bloom", desc: "Adds a glow.", _zoidiumPluginId: "other" },
  ];
  const objectTypes = [{ name: "Shape", desc: "A box.", type: 0 }];
  sandbox.PZ = {
    effect: {},
    object3d: {},
    ui: { objectTypes: { get: (key) => (key === sandbox.PZ.effect ? effectTypes : objectTypes) } },
  };
  return { sandbox, manager, storage, effectTypes, objectTypes };
}

function buildPicker(entries) {
  // Panel: cancel button, filter input, option list. Headings are SPANs,
  // rows are LIs carrying the registry entry, like CM3's generateAdd.
  const panel = new FakeElement("div");
  panel.appendChild(new FakeElement("button"));
  const filter = new FakeElement("input");
  filter.classList.add("pz-filterbox");
  panel.appendChild(filter);
  const list = new FakeElement("ul");
  list.classList.add("pz-options");
  panel.appendChild(list);
  for (const entry of entries) {
    if (entry.category === true) {
      const heading = new FakeElement("span");
      heading.textContent = entry.name;
      list.appendChild(heading);
    } else {
      const row = new FakeElement("li");
      row.pz_item = entry;
      list.appendChild(row);
    }
  }
  return { panel, filter, list };
}

function childTags(list) {
  return list.children.map((child) => `${child.tagName}:${child.tagName === "SPAN" ? child.textContent : child.pz_item.name}`);
}

test("headings become buttons and collapse detaches their rows", () => {
  const { manager, storage, effectTypes: entries } = loadPickerManager();
  const { filter, list } = buildPicker([
    { name: "LAYER", category: true }, entries[0],
    { name: "COLOR", category: true }, entries[1],
  ]);
  manager.decoratePickerList(list);
  const headings = list.children.filter((child) => child.tagName === "SPAN");
  assert.equal(headings.length, 2);
  for (const heading of headings) {
    assert.ok(heading.classList.contains("zoidium-picker-group"));
    assert.equal(heading.getAttribute("tabindex"), "0");
    assert.equal(heading.getAttribute("role"), "button");
    assert.equal(heading.getAttribute("aria-expanded"), "true");
  }
  headings[1].click();
  assert.deepEqual(childTags(list), ["SPAN:LAYER", "LI:Color Overlay", "SPAN:COLOR"]);
  assert.equal(headings[1].getAttribute("aria-expanded"), "false");
  assert.ok(headings[1].classList.contains("zoidium-picker-group--collapsed"));
  assert.deepEqual(JSON.parse(storage.get("zoidium.picker.collapsed.effects")), ["color"]);
  assert.equal(filter.value, "");
  // Headings stay, so stock keyboard handling keeps working over them.
  assert.equal(list.children.filter((child) => child.tagName === "SPAN").length, 2);
});

test("expanding reinserts rows in their original position", () => {
  const { manager, effectTypes: entries } = loadPickerManager();
  const { list } = buildPicker([
    { name: "LAYER", category: true }, entries[0],
    { name: "COLOR", category: true }, entries[1],
    { name: "ENHANCE", category: true }, entries[2],
  ]);
  manager.decoratePickerList(list);
  const headings = list.children.filter((child) => child.tagName === "SPAN");
  headings[0].click();
  headings[1].click();
  assert.deepEqual(childTags(list), ["SPAN:LAYER", "SPAN:COLOR", "SPAN:ENHANCE", "LI:Bloom"]);
  headings[0].click();
  assert.deepEqual(childTags(list), [
    "SPAN:LAYER", "LI:Color Overlay", "SPAN:COLOR", "SPAN:ENHANCE", "LI:Bloom",
  ]);
  headings[1].click();
  assert.deepEqual(childTags(list), [
    "SPAN:LAYER", "LI:Color Overlay", "SPAN:COLOR", "LI:Negative", "SPAN:ENHANCE", "LI:Bloom",
  ]);
});

test("double collapse and double expand are safe", () => {
  const { manager, effectTypes: entries } = loadPickerManager();
  const { list } = buildPicker([{ name: "COLOR", category: true }, entries[1]]);
  manager.decoratePickerList(list);
  const heading = list.children.find((child) => child.tagName === "SPAN");
  manager.setPickerGroupCollapsed(list, heading, true);
  manager.setPickerGroupCollapsed(list, heading, true);
  assert.deepEqual(childTags(list), ["SPAN:COLOR"]);
  manager.setPickerGroupCollapsed(list, heading, false);
  manager.setPickerGroupCollapsed(list, heading, false);
  assert.deepEqual(childTags(list), ["SPAN:COLOR", "LI:Negative"]);
});

test("collapsed state restores on the next open of the same picker", () => {
  const first = loadPickerManager();
  const open1 = buildPicker([{ name: "COLOR", category: true }, first.effectTypes[1]]);
  first.manager.decoratePickerList(open1.list);
  open1.list.children.find((child) => child.tagName === "SPAN").click();
  const saved = first.storage.get("zoidium.picker.collapsed.effects");
  // A new manager with the persisted storage collapses the group again.
  const second = loadPickerManager();
  second.storage.set("zoidium.picker.collapsed.effects", saved);
  const open2 = buildPicker([{ name: "COLOR", category: true }, second.effectTypes[1]]);
  second.manager.decoratePickerList(open2.list);
  assert.deepEqual(childTags(open2.list), ["SPAN:COLOR"]);
});

test("object and effect pickers persist independently", () => {
  const { manager, storage } = loadPickerManager();
  storage.set("zoidium.picker.collapsed.effects", JSON.stringify(["color"]));
  storage.set("zoidium.picker.collapsed.objects", JSON.stringify(["objects"]));
  assert.deepEqual(Array.from(manager.readPickerCollapsed("effects")), ["color"]);
  assert.deepEqual(Array.from(manager.readPickerCollapsed("objects")), ["objects"]);
  assert.deepEqual(Array.from(manager.readPickerCollapsed("unknown")), []);
  assert.deepEqual(Array.from(manager.readPickerCollapsed(null)), []);
});

test("search matches reattach regardless of collapse", () => {
  const { manager, effectTypes: entries } = loadPickerManager();
  const { filter, list } = buildPicker([{ name: "COLOR", category: true }, entries[1]]);
  manager.decoratePickerList(list);
  list.children.find((child) => child.tagName === "SPAN").click();
  assert.deepEqual(childTags(list), ["SPAN:COLOR"]);
  // CM3 rebuilds search output by appending the matching row elements; the
  // decorator runs after and must not detach them while querying.
  const match = entries[1];
  const row = new FakeElement("li");
  row.pz_item = match;
  list.appendChild(row);
  filter.value = "Negative";
  manager.decoratePickerList(list);
  assert.ok(list.children.includes(row), "matches show regardless of collapse");
  filter.value = "";
  manager.decoratePickerList(list);
  assert.deepEqual(childTags(list), ["SPAN:COLOR"], "clearing the query restores collapse");
});

test("keyboard toggles headings with Enter and Space", () => {
  const { manager, effectTypes: entries } = loadPickerManager();
  const { list } = buildPicker([{ name: "COLOR", category: true }, entries[1]]);
  manager.decoratePickerList(list);
  const heading = list.children.find((child) => child.tagName === "SPAN");
  heading.dispatch("keydown", { key: "Enter", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(childTags(list), ["SPAN:COLOR"]);
  heading.dispatch("keydown", { key: " ", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(childTags(list), ["SPAN:COLOR", "LI:Negative"]);
  heading.dispatch("keydown", { key: "x", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(childTags(list), ["SPAN:COLOR", "LI:Negative"], "other keys are ignored");
});

test("drilled-in sub-lists have no identity and stay untouched", () => {
  const { manager } = loadPickerManager();
  const { list } = buildPicker([{ name: "Nested", desc: "sub entry", type: 99 }]);
  assert.equal(manager.pickerIdentity(list), null);
  manager.decoratePickerList(list);
  assert.equal(list.children.filter((child) => child.tagName === "SPAN").length, 0);
  assert.equal(list.children.length, 1);
});

test("corrupt stored collapse never hides anything", () => {
  const { manager, storage, effectTypes: entries } = loadPickerManager();
  storage.set("zoidium.picker.collapsed.effects", "not-json{");
  const { list } = buildPicker([{ name: "COLOR", category: true }, entries[1]]);
  manager.decoratePickerList(list);
  assert.deepEqual(childTags(list), ["SPAN:COLOR", "LI:Negative"]);
});

test("plugin categories nest under their heading, start collapsed and count their rows", () => {
  const { manager, storage, effectTypes } = loadPickerManager();
  const pack = { name: "PACK", category: true, _zoidiumPluginId: "pack" };
  const blur = { name: "Gaussian", desc: "", _zoidiumPluginId: "pack", _zoidiumPluginEffectId: "g" };
  const warp = { name: "Twirl", desc: "", _zoidiumPluginId: "pack", _zoidiumPluginEffectId: "t" };
  const loose = { name: "Loose", desc: "", _zoidiumPluginId: "pack", _zoidiumPluginEffectId: "l" };
  const entries = manager.categorizedEffectEntries(pack, [warp, blur, loose], (entry) => ({ g: "Blur", t: "Distort" })[entry._zoidiumPluginEffectId]);
  assert.deepEqual(Array.from(entries, (entry) => entry.name), ["PACK", "Loose", "Blur", "Gaussian", "Distort", "Twirl"]);
  assert.equal(entries[2].subcategory, true);
  effectTypes.splice(0, effectTypes.length, { name: "COLOR", category: true }, effectTypes[1], ...entries);
  const { list } = buildPicker(effectTypes);
  manager.decoratePickerList(list);
  assert.deepEqual(childTags(list), ["SPAN:COLOR", "LI:Negative", "SPAN:PACK", "LI:Loose", "SPAN:Blur", "SPAN:Distort"]);
  const spans = list.children.filter((child) => child.tagName === "SPAN");
  assert.equal(spans[1].getAttribute("data-zoidium-count"), "3");
  assert.equal(spans[2].getAttribute("data-zoidium-count"), "1");
  assert.ok(spans[2].classList.contains("zoidium-picker-subgroup"));
  spans[2].click();
  assert.deepEqual(childTags(list), ["SPAN:COLOR", "LI:Negative", "SPAN:PACK", "LI:Loose", "SPAN:Blur", "LI:Gaussian", "SPAN:Distort"]);
  assert.deepEqual(JSON.parse(storage.get("zoidium.picker.expanded.effects")), ["pack/blur"]);
  // Collapsing the parent also hides its nested headings; expanding restores them as they were.
  spans[1].click();
  assert.deepEqual(childTags(list), ["SPAN:COLOR", "LI:Negative", "SPAN:PACK"]);
  spans[1].click();
  assert.deepEqual(childTags(list), ["SPAN:COLOR", "LI:Negative", "SPAN:PACK", "LI:Loose", "SPAN:Blur", "LI:Gaussian", "SPAN:Distort"]);
});

test("a heading that already exists takes a plugin's entries instead of appearing twice", () => {
  const { manager } = loadPickerManager();
  const effects = [
    { name: "COLOR", category: true }, { name: "Negative", type: "negative" },
    { name: "MISC", category: true }, { name: "Custom", type: "custom" },
  ];
  manager.insertEffectEntries(effects, [{ name: "COLOR", category: true, _zoidiumPluginId: "looks" }, { name: "Looks", _zoidiumPluginId: "looks" }]);
  manager.insertEffectEntries(effects, [{ name: "NATIVE FX", category: true, _zoidiumPluginId: "a" }, { name: "A1", _zoidiumPluginId: "a" }]);
  manager.insertEffectEntries(effects, [{ name: "Native FX", category: true, _zoidiumPluginId: "b" }, { name: "B1", _zoidiumPluginId: "b" }]);
  assert.deepEqual(effects.map((entry) => entry.name), ["COLOR", "Negative", "Looks", "NATIVE FX", "A1", "B1", "MISC", "Custom"]);
  // Removing the heading's first owner keeps it for the remaining entries.
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    if (effects[index]._zoidiumPluginId === "a" && !manager.keepsSharedHeading(effects, index, "a")) effects.splice(index, 1);
  }
  assert.deepEqual(effects.map((entry) => entry.name), ["COLOR", "Negative", "Looks", "NATIVE FX", "B1", "MISC", "Custom"]);
  assert.equal(effects[3]._zoidiumPluginId, "b");
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    if (effects[index]._zoidiumPluginId === "b" && !manager.keepsSharedHeading(effects, index, "b")) effects.splice(index, 1);
  }
  assert.deepEqual(effects.map((entry) => entry.name), ["COLOR", "Negative", "Looks", "MISC", "Custom"]);
});

test("recently added effects are listed first as working copies of their rows", () => {
  const { sandbox, manager, effectTypes } = loadPickerManager();
  sandbox.document.createElement = (tag) => new FakeElement(tag);
  FakeElement.prototype.cloneNode = function () {
    const copy = new FakeElement(this.tagName);
    copy.textContent = this.textContent;
    return copy;
  };
  try {
    effectTypes[1].type = "negative";
    effectTypes[2].type = "bloom";
    const { list } = buildPicker([{ name: "COLOR", category: true }, effectTypes[1], effectTypes[2]]);
    const negative = list.children[1];
    negative.onclick = () => "added";
    manager.recordPickerUse(effectTypes[2]);
    manager.recordPickerUse(effectTypes[1]);
    manager.recordPickerUse({ name: "Group", list: [] });
    manager.decoratePickerList(list);
    assert.deepEqual(childTags(list), ["SPAN:RECENT", "LI:Negative", "LI:Bloom", "SPAN:COLOR", "LI:Negative", "LI:Bloom"]);
    const copy = list.children[1];
    assert.notEqual(copy, negative);
    assert.equal(copy.pz_item, negative.pz_item);
    assert.equal(copy.onclick(), "added");
    assert.equal(list.children[0].getAttribute("data-zoidium-count"), "2");
    // A second pass with the same recent list changes nothing.
    const before = list.children.slice();
    manager.decoratePickerList(list);
    assert.ok(list.children.every((child, index) => child === before[index]));
  } finally {
    delete FakeElement.prototype.cloneNode;
  }
});
