"use strict";

// Project fonts in every font picker: the list builder (groups, sort,
// de-duplication, separator rules), descriptor dispatch including keyboard
// navigation that skips the separator, project selection setting the
// existing key in one history step (static and animated with a frame), the
// button preview, unchanged preset behaviour, and the failed badge.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const pickerSource = fs.readFileSync(path.join(root, "plugins", "core", "font-picker.js"), "utf8");
const pickerListSource = fs.readFileSync(path.join(root, "plugins", "core", "font-picker-list.js"), "utf8");
const emptySource = fs.readFileSync(path.join(root, "plugins", "core", "font-empty-state.js"), "utf8");

// ---- Minimal fake DOM -----------------------------------------------------

class FakeClassList {
  constructor() { this.items = new Set(); }
  add(...names) { for (const name of names) this.items.add(name); }
  remove(...names) { for (const name of names) this.items.delete(name); }
  contains(name) { return this.items.has(name); }
}

class FakeElement {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc || null;
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.classList = new FakeClassList();
    this.attributes = {};
    this._text = "";
    this.title = "";
    this.hidden = false;
    this.onclick = null;
    this.onmouseenter = null;
    this.onkeydown = null;
    this.onblur = null;
    this.offsetHeight = 25;
    this.scrollTop = 0;
    this.scrollHeight = 25;
  }
  get textContent() { return this._text; }
  set textContent(value) {
    this._text = String(value);
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const at = this.children.indexOf(child);
    if (at >= 0) this.children.splice(at, 1);
    child.parentElement = null;
    return child;
  }
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }
  querySelector(selector) {
    const want = String(selector).toLowerCase();
    const stack = [...this.children];
    while (stack.length) {
      const node = stack.shift();
      if (want === "span" && node.tagName === "SPAN") return node;
      if (want === "canvas" && node.tagName === "CANVAS") return node;
      stack.push(...node.children);
    }
    return null;
  }
  closest() { return null; }
  blur() { if (typeof this.onblur === "function") this.onblur(); }
  focus() {}
  getContext() {
    return {
      fillStyle: "",
      clearRect() {},
      fill() {},
      drawImage() {},
      getImageData() { return { data: new Uint8ClampedArray(400 * 50 * 4) }; },
    };
  }
}

function makeDocument() {
  const doc = {
    body: null,
    createElement(tag) { return new FakeElement(tag, doc); },
  };
  doc.body = new FakeElement("body", doc);
  return doc;
}

// ---- Sandbox --------------------------------------------------------------

function loadPicker(options = {}) {
  const doc = options.document || makeDocument();
  const preset = options.preset || ["bebas", "inter", "vt323"];
  const history = [];
  const scrolls = [];
  const createdPresets = [];
  const assets = options.assets || { list: {}, createFromPreset() { throw new Error("unexpected preset create"); } };
  const currentFrame = options.currentFrame ?? 10;

  function hostSpan() {
    const span = new FakeElement("span", doc);
    span.style = { backgroundPositionY: "0px" };
    return span;
  }

  const controls = {
    generateFontInput(property) {
      const buttonDiv = new FakeElement("div", doc);
      const button = new FakeElement("button", doc);
      const span = hostSpan();
      button.appendChild(span);
      buttonDiv.appendChild(button);
      button.pz_value = 0;
      button.pz_update = function () {
        hostButtonUpdates.push(button.pz_value);
        span.style.backgroundPositionY = -25 * button.pz_value + "px";
      };
      const fileRow = new FakeElement("span", doc);
      const fileDiv = new FakeElement("div", doc);
      fileDiv.style = { display: "none" };
      fileDiv.appendChild(fileRow);
      fileDiv.pz_update = function () {
        hostFileUpdates.push(property.get());
        const value = property.get();
        const asset = assets.list[value];
        fileRow.textContent = asset ? (asset.filename || value) : "(none)";
      };
      buttonDiv.pz_update = function () {
        hostUpdates.push(property.get());
        const value = property.get();
        let index = preset.length;
        if (typeof value === "string" && value.charAt(0) === "/") {
          fileDiv.style.display = "none";
          const name = /([^/]+)\.ttf$/.exec(value)[1];
          index = preset.indexOf(name);
        } else {
          fileDiv.style.display = "";
          fileDiv.pz_update();
        }
        button.pz_value = index;
        button.pz_update();
      };
      return [buttonDiv, fileDiv];
    },
    editStart(property) {
      history.push("start");
      this.parentElement.pz_frame = currentFrame - (property.frameOffset || 0);
    },
    editFinish(property, discard) {
      history.push(discard ? "discard" : "finish");
      delete this.parentElement.pz_frame;
    },
  };

  const hostButtonUpdates = [];
  const hostUpdates = [];
  const hostFileUpdates = [];

  const editor = {
    fontDropDown: undefined,
    onProjectChanged: { watchers: [], watch(fn) { this.watchers.push(fn); } },
    showFontDropDown(button) {
      let dropdown = editor.fontDropDown;
      if (dropdown === undefined) {
        dropdown = new FakeElement("ul", doc);
        dropdown.pz_scrollTo = index => scrolls.push(index);
        for (let i = 0; i < preset.length + 1; i += 1) {
          const row = new FakeElement("li", doc);
          row.appendChild(new FakeElement("span", doc));
          dropdown.appendChild(row);
        }
        dropdown.onblur = function () { this.remove(); };
        editor.fontDropDown = dropdown;
      }
      doc.body.appendChild(dropdown);
      dropdown.pz_input = button;
      dropdown.focus();
      return dropdown;
    },
  };

  const font2dByKey = options.font2dByKey || {};
  function FontWrapper(asset) { this.asset = asset; }
  FontWrapper.prototype.getFont = function () {
    const key = this.asset && this.asset.key;
    if (Object.prototype.hasOwnProperty.call(font2dByKey, key)) {
      return Promise.resolve(font2dByKey[key]);
    }
    return Promise.resolve(null);
  };
  FontWrapper.preset = preset.slice();

  const sandbox = {
    console,
    Promise,
    PZ: {
      asset: {
        font: FontWrapper,
        type: { FONT: 8 },
      },
      ui: { controls },
      editor,
    },
    CM: { playback: { currentFrame }, project: { assets } },
    document: doc,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  if (options.withEmptyState) vm.runInContext(emptySource, sandbox);
  vm.runInContext(pickerListSource, sandbox);
  vm.runInContext(pickerSource, sandbox);
  return {
    sandbox, doc, editor, controls, assets, history, scrolls,
    createdPresets, hostButtonUpdates, hostUpdates, hostFileUpdates, preset,
    FontWrapper, font2dByKey,
  };
}

function fakeFont2d(family, subfamily) {
  return {
    getEnglishName(kind) {
      if (kind === "fontFamily") return family;
      if (kind === "fontSubfamily") return subfamily;
      return null;
    },
    getAdvanceWidth() { return 100; },
    getPath() { return {}; },
  };
}

function fontAsset(key, filename) {
  return { key, filename, file: { name: filename }, data: { has: () => true } };
}

function staticProperty(value, assets, definitionValue) {
  return {
    definition: { value: definitionValue === undefined ? "/assets/fonts/2d/bebas.ttf" : definitionValue },
    parentProject: { assets },
    animated: false,
    frameOffset: 0,
    _value: value,
    getFrames: [],
    setCalls: [],
    get(frame) { this.getFrames.push(frame); return this._value; },
    set(value, frame) { this.setCalls.push([value, frame]); this._value = value; },
  };
}

function animatedProperty(value, assets) {
  const property = staticProperty(value, assets, null);
  property.animated = true;
  property.frameOffset = 2;
  return property;
}

function partsOf(control) {
  const buttonDiv = control[0];
  return { buttonDiv, fileDiv: control[1], button: buttonDiv.children[0], span: buttonDiv.children[0].children[0] };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

// ---- Pure helpers ---------------------------------------------------------

test("preset paths and key classification", () => {
  const { sandbox } = loadPicker();
  const api = sandbox.__zoidiumFontPicker;
  assert.equal(api.presetPath("bebas"), "/assets/fonts/2d/bebas.ttf");
  assert.equal(api.isProjectKey("abc123"), true);
  assert.equal(api.isProjectKey("/assets/fonts/2d/bebas.ttf"), false);
  assert.equal(api.isProjectKey(""), false);
  assert.equal(api.isProjectKey(null), false);
  assert.equal(api.presetNameFromKey("/assets/fonts/2d/bebas.ttf"), "bebas");
  assert.equal(api.presetNameFromKey("abc123"), null);
  assert.equal(api.presetNameFromKey("/assets/fonts/2d-variable/geist.ttf"), "geist");
});

test("project font collection dedupes and skips presets and non-fonts", () => {
  const { sandbox } = loadPicker();
  const api = sandbox.__zoidiumFontPicker;
  const PZ = sandbox.PZ;
  const list = {
    "/assets/fonts/2d/bebas.ttf": { key: "/assets/fonts/2d/bebas.ttf", data: { has: () => true } },
    abc: fontAsset("abc", "Alpha.ttf"),
    dup: fontAsset("dup", "Dup.ttf"),
    img: { key: "img", filename: "photo.png", data: { has: () => false } },
  };
  const found = api.collectProjectFonts(list, PZ);
  assert.deepEqual(JSON.parse(JSON.stringify(found.map(entry => entry.key))).sort(), ["abc", "dup"]);
  assert.equal(api.assetIsFont({ filename: "a.woff2" }, null), true);
  assert.equal(api.assetIsFont({ filename: "a.png" }, null), false);
  assert.equal(api.assetIsFont(null, PZ), false);
});

test("labels prefer the name table and fall back to the file name", () => {
  const { sandbox } = loadPicker();
  const api = sandbox.__zoidiumFontPicker;
  assert.equal(api.labelFor({ key: "k", asset: fontAsset("k", "K.ttf"), font2d: fakeFont2d("K Family", "Bold") }), "K Family Bold");
  assert.equal(api.labelFor({ key: "k", asset: fontAsset("k", "K.ttf"), font2d: fakeFont2d("K Family", "Regular") }), "K Family");
  assert.equal(api.labelFor({ key: "k", asset: fontAsset("k", "File Name.ttf"), font2d: null }), "File Name.ttf");
  assert.equal(api.labelFor({ key: "k", asset: { key: "k" }, font2d: null }), "k");
  assert.equal(api.labelFor({ key: "k", asset: fontAsset("k", "K.ttf"), font2d: { getEnglishName() { throw new Error("no table"); } } }), "K.ttf");
});

test("project fonts sort by name with a stable key order", () => {
  const { sandbox } = loadPicker();
  const api = sandbox.__zoidiumFontPicker;
  const entries = [
    { key: "b", asset: fontAsset("b", "b.ttf"), font2d: fakeFont2d("Zulu", "Regular") },
    { key: "a", asset: fontAsset("a", "a.ttf"), font2d: fakeFont2d("alpha", "Regular") },
    { key: "c", asset: fontAsset("c", "c.ttf"), font2d: fakeFont2d("Alpha", "Bold") },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(api.sortProjectFonts(entries).map(entry => entry.key))), ["a", "c", "b"]);
});

test("descriptors group presets, an optional separator, projects, and custom", () => {
  const { sandbox } = loadPicker();
  const api = sandbox.__zoidiumFontPicker;
  const seen = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(seen(api.buildDescriptors(["bebas"], [])), [
    { kind: "preset", index: 0, name: "bebas" },
    { kind: "custom" },
  ]);
  assert.deepEqual(seen(api.buildDescriptors(["bebas"], [{ key: "k" }])), [
    { kind: "preset", index: 0, name: "bebas" },
    { kind: "separator" },
    { kind: "project", key: "k" },
    { kind: "custom" },
  ]);
});

test("descriptor lookup keeps the preset index mapping and custom fallback", () => {
  const { sandbox } = loadPicker();
  const api = sandbox.__zoidiumFontPicker;
  const descriptors = api.buildDescriptors(["bebas", "inter"], [{ key: "k" }]);
  assert.equal(api.descriptorIndexForValue(descriptors, ["bebas", "inter"], "/assets/fonts/2d/inter.ttf"), 1);
  assert.equal(api.descriptorIndexForValue(descriptors, ["bebas", "inter"], "k"), 3);
  assert.equal(api.descriptorIndexForValue(descriptors, ["bebas", "inter"], "/assets/fonts/2d/removed.ttf"), 4);
  assert.equal(api.descriptorIndexForValue(descriptors, ["bebas", "inter"], "gone"), 4);
  assert.equal(api.descriptorIndexForValue(descriptors, ["bebas", "inter"], null), 4);
});

test("keyboard steps skip the separator and clamp at the ends", () => {
  const { sandbox } = loadPicker();
  const api = sandbox.__zoidiumFontPicker;
  const descriptors = api.buildDescriptors(["a", "b"], [{ key: "k" }]);
  // 0:a 1:b 2:separator 3:k 4:custom
  assert.equal(api.stepIndex(descriptors, 1, 1), 3);
  assert.equal(api.stepIndex(descriptors, 3, -1), 1);
  assert.equal(api.stepIndex(descriptors, 0, -1), 0);
  assert.equal(api.stepIndex(descriptors, 4, 1), 4);
  assert.equal(api.stepIndex(descriptors, 2, 1), 3);
});

// ---- Static properties keep the host path ---------------------------------

test("static preset values keep the host rendering untouched", () => {
  const env = loadPicker({ withEmptyState: true });
  const assets = { list: {}, createFromPreset: () => { throw new Error("no preset create expected"); } };
  const property = staticProperty("/assets/fonts/2d/inter.ttf", assets);
  const control = env.sandbox.PZ.ui.controls.generateFontInput(property);
  const parts = partsOf(control);
  control[0].pz_update();
  assert.equal(env.hostUpdates.length, 1);
  assert.equal(parts.button.pz_value, 1);
  assert.equal(parts.span.style.backgroundPositionY, "-25px");
  assert.equal(parts.span.classList.contains("zoidium-font-project"), false);
  assert.equal(parts.fileDiv.style.display, "none");
});

test("static project values hide the file row and paint a preview", async () => {
  const asset = fontAsset("abc123", "Alpha.ttf");
  const env = loadPicker({
    withEmptyState: true,
    assets: { list: { abc123: asset }, createFromPreset() { throw new Error("no preset create expected"); } },
    font2dByKey: { abc123: fakeFont2d("Alpha", "Regular") },
  });
  const property = staticProperty("abc123", env.assets);
  const control = env.sandbox.PZ.ui.controls.generateFontInput(property);
  const parts = partsOf(control);
  control[0].pz_update();
  assert.equal(env.hostUpdates.length, 1);
  assert.equal(parts.fileDiv.style.display, "none");
  assert.equal(parts.span.textContent, "Alpha.ttf");
  await tick();
  await tick();
  const canvas = parts.span.querySelector("canvas");
  assert.ok(canvas, "button shows the runtime preview canvas");
  assert.equal(canvas.width, 400);
  assert.ok(parts.span.classList.contains("zoidium-font-project"));
});

test("static missing values never crash and show the missing state", () => {
  const env = loadPicker({ withEmptyState: true });
  const assets = { list: {}, createFromPreset() { throw new Error("no preset create expected"); } };
  const property = staticProperty("gone", assets);
  const control = env.sandbox.PZ.ui.controls.generateFontInput(property);
  const parts = partsOf(control);
  control[0].pz_update();
  assert.equal(env.hostUpdates.length, 0);
  assert.equal(parts.span.textContent, "Missing font");
  assert.ok(parts.span.classList.contains("zoidium-font-missing"));
  assert.equal(parts.fileDiv.style.display, "");
  assert.equal(parts.fileDiv.children[0].textContent, "(missing)");
});

test("static empty values still show None through the shared wrapper", () => {
  const env = loadPicker({ withEmptyState: true });
  const assets = { list: {} };
  const property = staticProperty(null, assets, null);
  const control = env.sandbox.PZ.ui.controls.generateFontInput(property);
  control[0].pz_update();
  assert.equal(partsOf(control).span.textContent, "None");
});

test("selecting a project font sets the existing key in one history step", () => {
  const asset = fontAsset("abc123", "Alpha.ttf");
  const env = loadPicker({ assets: { list: { abc123: asset } } });
  const property = staticProperty("/assets/fonts/2d/bebas.ttf", env.assets);
  const control = env.sandbox.PZ.ui.controls.generateFontInput(property);
  const parts = partsOf(control);
  parts.button.pz_setDescriptor({ kind: "project", key: "abc123" });
  assert.deepEqual(property.setCalls, [["abc123", undefined]]);
  assert.deepEqual(env.history, ["start", "finish"]);
  assert.deepEqual(Object.keys(env.assets.list), ["abc123"]);
});

test("selecting a preset reuses the existing asset key", () => {
  const existing = { key: "/assets/fonts/2d/inter.ttf" };
  const env = loadPicker({
    assets: { list: { "/assets/fonts/2d/inter.ttf": existing }, createFromPreset(type, key) { return env.assets.list[key]; } },
  });
  const property = staticProperty("abc", env.assets);
  const control = env.sandbox.PZ.ui.controls.generateFontInput(property);
  partsOf(control).button.pz_setDescriptor({ kind: "preset", index: 1 });
  assert.deepEqual(property.setCalls, [["/assets/fonts/2d/inter.ttf", undefined]]);
  assert.deepEqual(env.history, ["start", "finish"]);
});

test("custom descriptors clear the value in one history step", () => {
  const env = loadPicker({ assets: { list: {} } });
  const property = staticProperty("abc", env.assets);
  const control = env.sandbox.PZ.ui.controls.generateFontInput(property);
  partsOf(control).button.pz_setDescriptor({ kind: "custom" });
  assert.deepEqual(property.setCalls, [[null, undefined]]);
  assert.deepEqual(env.history, ["start", "finish"]);
});

// ---- Animated properties pass a frame -------------------------------------

test("animated project values read and write with the current frame", async () => {
  const asset = fontAsset("abc123", "Alpha.ttf");
  const env = loadPicker({
    assets: { list: { abc123: asset } },
    currentFrame: 10,
    font2dByKey: { abc123: fakeFont2d("Alpha", "Regular") },
  });
  const property = animatedProperty("abc123", env.assets);
  const control = env.sandbox.PZ.ui.controls.generateFontInput(property);
  const parts = partsOf(control);
  control[0].pz_update();
  assert.deepEqual(property.getFrames, [8]);
  await tick();
  await tick();
  assert.ok(parts.span.querySelector("canvas"), "animated button shows the runtime preview");
  parts.button.pz_setDescriptor({ kind: "project", key: "abc123" });
  assert.deepEqual(property.setCalls, [["abc123", 8]]);
  assert.deepEqual(env.history, ["start", "finish"]);
});

test("animated empty values show None without touching the host update", () => {
  const env = loadPicker({ assets: { list: {} }, currentFrame: 10 });
  const property = animatedProperty(null, env.assets);
  const control = env.sandbox.PZ.ui.controls.generateFontInput(property);
  const parts = partsOf(control);
  control[0].pz_update(4);
  assert.deepEqual(property.getFrames, [4]);
  assert.equal(env.hostUpdates.length, 0);
  assert.equal(parts.span.textContent, "None");
});

// ---- Dropdown ---------------------------------------------------------------

function openDropdown(env, property) {
  const control = env.sandbox.PZ.ui.controls.generateFontInput(property);
  const parts = partsOf(control);
  env.editor.showFontDropDown(parts.button);
  return { control, parts, dropdown: env.editor.fontDropDown };
}

test("the dropdown lists presets, the separator, sorted projects, and custom", async () => {
  const zebra = fontAsset("z", "Zulu.ttf");
  const alpha = fontAsset("a", "Alpha.ttf");
  const env = loadPicker({ assets: { list: { z: zebra, a: alpha } } });
  const property = staticProperty("/assets/fonts/2d/bebas.ttf", env.assets);
  const { dropdown } = openDropdown(env, property);
  await tick();
  assert.equal(dropdown.children.length, 3 + 1 + 2 + 1);
  assert.equal(dropdown.children[3].className, "zoidium-font-separator");
  assert.equal(dropdown.children[3].children[0].textContent, "Project fonts");
  assert.equal(dropdown.children[4]._zoidiumFontKey, "a");
  assert.equal(dropdown.children[5]._zoidiumFontKey, "z");
  assert.ok(dropdown.children[0].classList.contains("pz-active"));
  assert.deepEqual(env.scrolls, [0]);
  assert.deepEqual(JSON.parse(JSON.stringify(dropdown._zoidiumDescriptors)).map(entry => entry.kind),
    ["preset", "preset", "preset", "separator", "project", "project", "custom"]);
});

test("no project fonts means no separator", () => {
  const env = loadPicker({ assets: { list: {} } });
  const property = staticProperty("/assets/fonts/2d/bebas.ttf", env.assets);
  const { dropdown } = openDropdown(env, property);
  assert.equal(dropdown.children.length, 4);
  assert.ok(!dropdown._zoidiumDescriptors.some(entry => entry.kind === "separator"));
});

test("clicking a project row sets the existing key", async () => {
  const asset = fontAsset("a", "Alpha.ttf");
  const env = loadPicker({ assets: { list: { a: asset } }, currentFrame: 10 });
  const property = animatedProperty("/assets/fonts/2d/bebas.ttf", env.assets);
  const { dropdown } = openDropdown(env, property);
  await tick();
  dropdown.children[4].onclick();
  assert.deepEqual(property.setCalls, [["a", 8]]);
  assert.deepEqual(env.history, ["start", "finish"]);
});

test("arrow keys skip the separator and Enter dispatches", async () => {
  const asset = fontAsset("a", "Alpha.ttf");
  const env = loadPicker({
    assets: { list: { a: asset }, createFromPreset: (type, key) => ({ key }) },
    currentFrame: 10,
  });
  const property = animatedProperty("/assets/fonts/2d/bebas.ttf", env.assets);
  const { dropdown } = openDropdown(env, property);
  await tick();
  const prevented = [];
  const event = key => ({ key, preventDefault() { prevented.push(key); } });
  const active = () => dropdown.children.findIndex(row => row.classList.contains("pz-active"));
  assert.equal(active(), 0);
  dropdown.onkeydown.call(dropdown, event("ArrowDown"));
  assert.equal(active(), 1);
  dropdown.onkeydown.call(dropdown, event("ArrowDown"));
  assert.equal(active(), 2);
  dropdown.onkeydown.call(dropdown, event("ArrowDown"));
  assert.equal(active(), 4);
  dropdown.onkeydown.call(dropdown, event("ArrowUp"));
  assert.equal(active(), 2);
  dropdown.onkeydown.call(dropdown, event("Enter"));
  assert.deepEqual(property.setCalls, [["/assets/fonts/2d/vt323.ttf", 8]]);
  assert.deepEqual(env.history, ["start", "finish"]);
  assert.deepEqual(env.scrolls, [0, 1, 2, 4, 2]);
  assert.deepEqual(prevented, ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp", "Enter"]);
});

test("failed fonts show the file name with a failed badge", async () => {
  const asset = fontAsset("bad", "Broken.ttf");
  const env = loadPicker({ assets: { list: { bad: asset } }, font2dByKey: { bad: null } });
  const property = staticProperty("bad", env.assets);
  const { control, parts, dropdown } = openDropdown(env, property);
  control[0].pz_update();
  await tick();
  await tick();
  assert.ok(parts.span.classList.contains("zoidium-font-failed"));
  const badge = parts.span.children.find(child => child.tagName === "SPAN" && child.textContent === "failed");
  assert.ok(badge, "button carries the failed badge");
  const row = dropdown.children.find(child => child._zoidiumFontKey === "bad");
  const rowBadge = row.children[0].children.find(child => child.textContent === "failed");
  assert.ok(rowBadge, "the row carries the failed badge");
});

// ---- Wiring -----------------------------------------------------------------

test("the picker installs once and registers its core scripts", () => {
  const env = loadPicker();
  const before = env.sandbox.PZ.ui.controls.generateFontInput;
  vm.runInContext(pickerListSource, env.sandbox);
  vm.runInContext(pickerSource, env.sandbox);
  assert.equal(env.sandbox.PZ.ui.controls.generateFontInput, before);
  assert.ok(env.sandbox.PZ.editor.showFontDropDown.__zoidiumFontPicker);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugins", "core", "manifest.json"), "utf8"));
  const ids = (manifest.coreScripts || []).map(script => script.id);
  assert.ok(ids.includes("font-picker-list"));
  assert.ok(ids.includes("font-picker"));
  assert.ok(ids.indexOf("font-picker-list") > ids.indexOf("font-empty-state"));
  assert.ok(ids.indexOf("font-picker") > ids.indexOf("font-picker-list"));
  const config = fs.readFileSync(path.join(root, "zoidium", "runtime-config.js"), "utf8");
  assert.ok(config.includes("./plugins/core/font-picker-list.js"));
  assert.ok(config.includes("./plugins/core/font-picker.js"));
});

test("the stylesheet covers project rows, badges, and the separator", () => {
  const css = fs.readFileSync(path.join(root, "zoidium", "ui-overrides.css"), "utf8");
  for (const selector of [
    "span.zoidium-font-project",
    "span.zoidium-font-text",
    "span.zoidium-font-failed",
    ".zoidium-font-badge",
    "li.zoidium-font-separator",
  ]) {
    assert.ok(css.includes(selector), "missing style: " + selector);
  }
});
