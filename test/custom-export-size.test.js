"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function element(tag) {
  return {
    tag, children: [], style: {}, attributes: {}, classList: { add() {} },
    value: "", textContent: "", selectedIndex: 4,
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    insertBefore(child, next) {
      child.parentElement = this;
      this.children.splice(this.children.indexOf(next), 0, child);
    },
    get options() { return this.tag === "select" ? this.children : undefined; },
    addEventListener(type, fn) { this[type + "Listener"] = fn; },
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(selector.includes("button") && child.tag === "button" ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    },
    querySelector() { return this.select; },
  };
}

function harness(storage = new Map(), storageFails = false) {
  const resolutions = [[426, 240], [640, 360], [854, 480], [1280, 720],
    [1920, 1080], [2560, 1440], [3840, 2160]];
  let renders = 0, exports = 0;
  class Device {
    createOptionsPage() {
      this.params = { width: 1920, height: 1080 };
      const page = element("page"), row = page.appendChild(element("div"));
      const select = row.appendChild(element("div")).appendChild(element("select"));
      resolutions.forEach(size => select.appendChild(Object.assign(element("option"), { text: size.join("x") })));
      select.onchange = () => {
        assert.ok(resolutions[select.selectedIndex], "native handler must never receive Custom");
        [this.params.width, this.params.height] = resolutions[select.selectedIndex];
      };
      page.select = select;
      const start = page.appendChild(element("button")); start.textContent = "Start";
      return page;
    }
    async render() { renders++; throw new Error("Codec rejected configuration"); }
  }
  const PZ = { export: function (_sequence, params) { this.params = params; exports++; },
    ui: { export: { device: Device }, controls: { legacy: {
      generateDropdown(spec) { return Object.assign(element("div"), { spec }); },
    } } } };
  vm.runInNewContext(fs.readFileSync("plugins/core/render-aspect-ratio.js", "utf8"), {
    PZ, document: { createElement: element }, localStorage: {
      getItem(key) { if (storageFails) throw new Error("Storage blocked"); return storage.get(key); },
      setItem(key, value) { if (storageFails) throw new Error("Storage blocked"); storage.set(key, value); },
    },
  });
  function open() {
    const owner = new Device(), page = owner.createOptionsPage();
    const all = function walk(node) { return [node, ...node.children.flatMap(walk)]; }(page);
    const input = name => all.find(node => node.attributes["aria-label"] === name);
    return { owner, page, select: page.select, width: input("Output width (px)"),
      height: input("Output height (px)"), ratioWidth: input("Aspect ratio width"),
      ratioHeight: input("Aspect ratio height"), start: all.find(node => node.tag === "button"),
      message: all.find(node => node.attributes.role === "alert") };
  }
  return { PZ, open, storage, counts: () => ({ renders, exports }) };
}
function custom(ui, width, height) {
  ui.select.selectedIndex = 7; ui.select.onchange();
  ui.width.value = String(width); ui.height.value = String(height); ui.width.onchange();
}
function size(params) { return [params.width, params.height]; }

test("Custom preserves exact landscape and portrait dimensions through repeated export construction", () => {
  const h = harness(), ui = h.open();
  for (const target of [[3440, 1440], [2560, 1080], [1080, 2560]]) {
    custom(ui, ...target);
    assert.deepEqual(size(ui.owner.params), target);
    for (let i = 0; i < 2; i++) {
      const exporter = new h.PZ.export({}, ui.owner.params);
      assert.deepEqual(size(exporter.params), target);
    }
  }
});

test("every preset retains the long-edge aspect rule after leaving Custom", () => {
  const h = harness(), ui = h.open(); custom(ui, 3440, 1440);
  for (let i = 0; i < 7; i++) {
    ui.select.selectedIndex = i; ui.select.onchange();
    assert.equal(ui.owner.params.resolutionMode, undefined);
    assert.equal(ui.owner.params.width, [426, 640, 854, 1280, 1920, 2560, 3840][i]);
  }
  ui.select.selectedIndex = 5; ui.select.onchange();
  ui.ratioWidth.value = "64"; ui.ratioHeight.value = "27"; ui.ratioWidth.onchange();
  assert.deepEqual(size(ui.owner.params), [2560, 1080]);
  ui.select.selectedIndex = 7; ui.select.onchange();
  assert.deepEqual(size(ui.owner.params), [3440, 1440]);
});

test("custom ratio edits retain the long edge and update the exact-size fields", () => {
  const h = harness(), ui = h.open(); custom(ui, 3440, 1440);
  ui.ratioWidth.value = "4"; ui.ratioHeight.value = "3"; ui.ratioWidth.onchange();
  assert.deepEqual(size(ui.owner.params), [3440, 2580]);
  assert.deepEqual([ui.width.value, ui.height.value], ["3440", "2580"]);
});

for (const invalid of [[3441, 1440], [0, 1080], [8194, 1080], [2.5, 1440],
  [8192, 8192], ["", 1080], ["abc", 1080], [Infinity, 1080]]) {
  test(`invalid Custom size ${invalid.join("x")} cannot reach Start or change the remembered valid size`, () => {
    const h = harness(), ui = h.open(); custom(ui, 3440, 1440);
    custom(ui, ...invalid);
    assert.equal(ui.start.disabled, true);
    assert.match(ui.message.textContent, /even whole numbers|33,554,432/);
    let prevented = false, stopped = false;
    ui.start.clickListener({ preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
    assert.ok(prevented && stopped);
    assert.deepEqual(size(ui.owner.params), [3440, 1440]);
    const reopened = h.open(); assert.deepEqual(size(reopened.owner.params), [3440, 1440]);
    custom(ui, 2560, 1080); assert.equal(ui.start.disabled, false);
  });
}

test("resolution preference survives closing, a new runtime, and JSON storage without entering project data", () => {
  const h = harness(), ui = h.open(); custom(ui, 3440, 1440);
  ui.owner.params.aspectRatioMode = 1; ui.owner.__zoidiumResolutionControls.update();
  const restored = harness(new Map(JSON.parse(JSON.stringify([...h.storage]))));
  const reopened = restored.open();
  assert.equal(reopened.select.selectedIndex, 7);
  assert.deepEqual(size(reopened.owner.params), [3440, 1440]);
  assert.equal(reopened.owner.params.aspectRatioMode, 1);
  reopened.select.selectedIndex = 4; reopened.select.onchange();
  const preset = harness(restored.storage).open();
  assert.equal(preset.select.selectedIndex, 4);
  assert.equal(preset.owner.params.resolutionMode, undefined);
});

test("unavailable or corrupt preference storage leaves default exports usable", () => {
  for (const h of [harness(new Map(), true), harness(new Map([["zoidium.export.device-resolution", "{"]]))]) {
    const ui = h.open();
    assert.deepEqual(size(ui.owner.params), [1920, 1080]);
    custom(ui, 2560, 1080); assert.deepEqual(size(ui.owner.params), [2560, 1080]);
  }
});

test("invalid serialized Custom dimensions fail before allocating an exporter", () => {
  const h = harness();
  assert.throws(() => new h.PZ.export({}, { __zoidiumDeviceRender: true,
    resolutionMode: "custom", customResolution: [3441, 1440] }), /even whole numbers/);
  assert.equal(h.counts().exports, 0);
});

test("native codec rejection includes the custom size and recovery options; presets keep their original error", async () => {
  const h = harness(), ui = h.open(); custom(ui, 3440, 1440);
  await assert.rejects(ui.owner.render(), /3440×1440.*smaller Resolution.*another Format.*Codec rejected/);
  ui.select.selectedIndex = 4; ui.select.onchange();
  await assert.rejects(ui.owner.render(), { message: "Codec rejected configuration" });
});
