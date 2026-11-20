"use strict";
// Mask property view: labelled expandable row with mode dropdown, numeric
// controls, Edit toggle and tooltips (plan package P1.3).
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeElement, makeDocument } = require("./fake-dom.js");
const {
  MODES, MODE_LABELS, KEYFRAME_STATES, LIMITS, DEFAULTS,
  keyframeGlyph, describeKeyframe, renderMaskRow,
} = require("../plugins/shape-plus/mask-row-view.js");

function model(overrides = {}) {
  return {
    id: "m1",
    name: "Mask 1",
    mode: "add",
    invert: 0,
    enabled: 1,
    feather: 0,
    opacity: 1,
    expansion: 0,
    outlineColor: "#58a6ff",
    locked: false,
    ...overrides,
  };
}

function render(over = {}, state = {}, callbacks = {}) {
  const document = makeDocument();
  const calls = [];
  const wrap = {};
  for (const [key, fn] of Object.entries(callbacks)) {
    wrap[key] = (...args) => { calls.push([key, ...args]); return fn?.(...args); };
  }
  const element = renderMaskRow(document, model(over), { active: false, expanded: true, ...state }, wrap);
  document.body.appendChild(element);
  assert.ok(element instanceof FakeElement);
  return { document, element, calls, byClass: name => element.querySelector(name) };
}

test("module constants describe modes, keyframe states and numeric limits", () => {
  assert.deepEqual(MODES, ["add", "subtract", "intersect"]);
  assert.deepEqual(MODE_LABELS, { add: "Add", subtract: "Subtract", intersect: "Intersect" });
  assert.deepEqual(KEYFRAME_STATES, ["off", "armed", "keyed"]);
  assert.equal(LIMITS.featherMin, 0);
  assert.equal(LIMITS.featherMax, 500);
  assert.equal(LIMITS.opacityMin, 0);
  assert.equal(LIMITS.opacityMax, 100);
  assert.ok(LIMITS.expansionMin < 0 && LIMITS.expansionMax > 0);
  assert.equal(DEFAULTS.mode, "add");
  assert.equal(DEFAULTS.expansion, 0);
  assert.equal(DEFAULTS.locked, false);
});

test("keyframe diamond has three distinct states with accessible descriptions", () => {
  const glyphs = KEYFRAME_STATES.map(keyframeGlyph);
  assert.equal(new Set(glyphs).size, 3, "each animation state needs a distinct glyph");
  assert.match(describeKeyframe("off", "Mask 1"), /animation off/i);
  assert.match(describeKeyframe("armed", "Mask 1"), /no keyframe.*playhead|armed/i);
  assert.match(describeKeyframe("keyed", "Mask 1"), /keyframe at.*playhead/i);
  for (const state of KEYFRAME_STATES) {
    const { byClass } = render({}, { keyframeState: state });
    const key = byClass(".mask-row-key");
    assert.equal(key.getAttribute("aria-label"), describeKeyframe(state, "Mask 1"));
    assert.equal(key.textContent, keyframeGlyph(state));
  }
});

test("every control carries an accessible name and tooltip", () => {
  const { byClass } = render();
  const named = [
    ".mask-row-expander", ".mask-row-enable", ".mask-row-name", ".mask-row-mode",
    ".mask-row-invert", ".mask-row-key", ".mask-row-key-prev", ".mask-row-key-next",
    ".mask-row-edit", ".mask-row-delete", ".mask-row-feather", ".mask-row-opacity",
    ".mask-row-expansion", ".mask-row-color", ".mask-row-name-input",
    ".mask-row-lock", ".mask-row-duplicate", ".mask-row-up", ".mask-row-down",
  ];
  for (const selector of named) {
    const node = byClass(selector);
    assert.ok(node, selector + " exists");
    const label = node.getAttribute("aria-label");
    assert.ok(label && label.length > 0, selector + " has an accessible name");
    assert.ok(node.title && node.title.length > 0, selector + " has a tooltip");
    assert.match(label, /mask 1/i, selector + " names its mask");
  }
});

test("mode dropdown lists Add, Subtract and Intersect and reports changes", () => {
  const seen = [];
  const { byClass } = render({ mode: "subtract" }, {}, { onModeChange: (id, value) => seen.push(value) });
  const select = byClass(".mask-row-mode");
  assert.equal(select.tagName, "SELECT");
  assert.equal(select.value, "subtract");
  const options = select.children.map(option => [option.value || option.textContent, option.textContent]);
  assert.deepEqual(options, [["add", "Add"], ["subtract", "Subtract"], ["intersect", "Intersect"]]);
  select.value = "intersect";
  select.dispatch("change", { target: select });
  assert.deepEqual(seen, ["intersect"]);
});

test("header events fire activation, expand, edit, delete and keyframe callbacks", () => {
  const { byClass, calls } = render({}, { active: false, expanded: false }, {
    onActivate: () => {}, onToggleExpand: () => {}, onToggleEdit: () => {},
    onDelete: () => {}, onKeyframeToggle: () => {}, onKeyframePrev: () => {}, onKeyframeNext: () => {},
  });
  byClass(".mask-row-name").click();
  byClass(".mask-row-expander").click();
  byClass(".mask-row-edit").click();
  byClass(".mask-row-delete").click();
  byClass(".mask-row-key").click();
  byClass(".mask-row-key-prev").click();
  byClass(".mask-row-key-next").click();
  assert.deepEqual(calls.map(call => call[0]),
    ["onActivate", "onToggleExpand", "onToggleEdit", "onDelete", "onKeyframeToggle", "onKeyframePrev", "onKeyframeNext"]);
  // Clicking the name reports the mask id so panels can activate its path.
  assert.deepEqual(calls[0], ["onActivate", "m1"]);
});

test("invert, enable, lock and duplicate report through callbacks", () => {
  const { byClass, calls } = render({}, {}, {
    onToggleInvert: () => {}, onToggleEnabled: () => {}, onToggleLock: () => {}, onDuplicate: () => {},
  });
  byClass(".mask-row-invert").click();
  byClass(".mask-row-enable").click();
  byClass(".mask-row-lock").click();
  byClass(".mask-row-duplicate").click();
  assert.deepEqual(calls.map(call => call[0]),
    ["onToggleInvert", "onToggleEnabled", "onToggleLock", "onDuplicate"]);
});

test("reorder buttons report direction and disable at the ends", () => {
  const up = [], down = [];
  const first = render({}, { canMoveUp: false, canMoveDown: true }, {
    onMove: (id, direction) => (direction < 0 ? up : down).push(direction),
  });
  assert.equal(first.byClass(".mask-row-up").disabled, true);
  assert.equal(first.byClass(".mask-row-down").disabled, false);
  first.byClass(".mask-row-down").click();
  assert.deepEqual(down, [1]);
  const last = render({}, { canMoveUp: true, canMoveDown: false }, {
    onMove: (id, direction) => (direction < 0 ? up : down).push(direction),
  });
  assert.equal(last.byClass(".mask-row-down").disabled, true);
  last.byClass(".mask-row-up").click();
  assert.deepEqual(up, [-1]);
});

test("numeric controls validate ranges and restore the previous value", () => {
  const seen = {};
  const { byClass } = render({ feather: 4, opacity: 0.5, expansion: 2 }, {}, {
    onFeatherChange: (id, value) => { seen.feather = value; },
    onOpacityChange: (id, value) => { seen.opacity = value; },
    onExpansionChange: (id, value) => { seen.expansion = value; },
  });
  const feather = byClass(".mask-row-feather");
  const opacity = byClass(".mask-row-opacity");
  const expansion = byClass(".mask-row-expansion");
  assert.equal(feather.value, "4");
  assert.equal(opacity.value, "50");
  assert.equal(expansion.value, "2");
  feather.value = "12";
  feather.dispatch("change", { target: feather });
  assert.equal(seen.feather, 12);
  opacity.value = "80";
  opacity.dispatch("change", { target: opacity });
  assert.equal(seen.opacity, 0.8);
  expansion.value = "-8";
  expansion.dispatch("change", { target: expansion });
  assert.equal(seen.expansion, -8);
  // Out-of-range and non-numeric edits commit nothing and restore the field.
  feather.value = "9999";
  feather.dispatch("change", { target: feather });
  assert.equal(seen.feather, 12);
  assert.equal(feather.value, "12");
  opacity.value = "abc";
  opacity.dispatch("change", { target: opacity });
  assert.equal(seen.opacity, 0.8);
  assert.equal(opacity.value, "80");
  expansion.value = String(LIMITS.expansionMax + 50);
  expansion.dispatch("change", { target: expansion });
  assert.equal(seen.expansion, -8);
});

test("rename commits non-empty names and restores blank ones", () => {
  const seen = [];
  const { byClass } = render({}, {}, { onRename: (id, value) => seen.push(value) });
  const input = byClass(".mask-row-name-input");
  assert.equal(input.value, "Mask 1");
  input.value = "Hero";
  input.dispatch("change", { target: input });
  assert.deepEqual(seen, ["Hero"]);
  input.value = "   ";
  input.dispatch("change", { target: input });
  assert.deepEqual(seen, ["Hero"]);
  assert.equal(input.value, "Hero");
});

test("outline colour control reports valid colours only", () => {
  const seen = [];
  const { byClass } = render({}, {}, { onOutlineColorChange: (id, value) => seen.push(value) });
  const color = byClass(".mask-row-color");
  assert.equal(color.value, "#58a6ff");
  color.value = "#ff0000";
  color.dispatch("change", { target: color });
  assert.deepEqual(seen, ["#ff0000"]);
  color.value = "not-a-color";
  color.dispatch("change", { target: color });
  assert.deepEqual(seen, ["#ff0000"]);
});

test("active mask is highlighted and Edit reflects editing state", () => {
  const idle = render({}, { active: false, editing: false });
  assert.equal(idle.element.getAttribute("aria-current"), null);
  assert.equal(idle.byClass(".mask-row-edit").getAttribute("aria-pressed"), "false");
  const live = render({}, { active: true, editing: true });
  assert.equal(live.element.getAttribute("aria-current"), "true");
  assert.ok(live.element.classList.contains("is-active"));
  assert.equal(live.byClass(".mask-row-edit").getAttribute("aria-pressed"), "true");
});

test("locked masks keep selection but block mutation controls", () => {
  const { byClass, calls } = render({ locked: true }, {}, {
    onActivate: () => {}, onToggleEdit: () => {}, onDelete: () => {}, onModeChange: () => {},
  });
  // Activation still works: locked paths remain selectable, never editable.
  byClass(".mask-row-name").click();
  assert.deepEqual(calls.map(call => call[0]), ["onActivate"]);
  for (const selector of [".mask-row-mode", ".mask-row-invert", ".mask-row-enable",
    ".mask-row-key", ".mask-row-edit", ".mask-row-delete", ".mask-row-feather",
    ".mask-row-opacity", ".mask-row-expansion", ".mask-row-color",
    ".mask-row-name-input", ".mask-row-duplicate"]) {
    assert.equal(byClass(selector).disabled, true, selector + " is disabled while locked");
  }
  // Reordering stays available on locked masks: order is a collection
  // property, not an edit to the locked mask itself.
  assert.equal(byClass(".mask-row-up").disabled, false, ".mask-row-up stays enabled while locked");
  assert.equal(byClass(".mask-row-down").disabled, false, ".mask-row-down stays enabled while locked");
  // The lock toggle itself stays enabled so the mask can be unlocked.
  assert.equal(byClass(".mask-row-lock").disabled, false);
  assert.equal(byClass(".mask-row-lock").getAttribute("aria-pressed"), "true");
});

test("collapsed rows hide the detail body but keep the header usable", () => {
  const { byClass } = render({}, { expanded: false });
  assert.equal(byClass(".mask-row-body").hidden, true);
  assert.equal(byClass(".mask-row-expander").getAttribute("aria-expanded"), "false");
  assert.ok(byClass(".mask-row-name"), "header name stays available while collapsed");
});

test("legacy snapshots without new fields render defaults unchanged", () => {
  const document = makeDocument();
  const legacy = {
    id: "m1",
    mode: "add",
    invert: 0,
    feather: 0,
    opacity: 1,
    properties: { name: "Mask 1" },
  };
  const element = renderMaskRow(document, legacy, {}, {});
  assert.equal(element.querySelector(".mask-row-name").textContent, "Mask 1");
  assert.equal(element.querySelector(".mask-row-mode").value, "add");
  assert.equal(element.querySelector(".mask-row-feather").value, "0");
  assert.equal(element.querySelector(".mask-row-opacity").value, "100");
  assert.equal(element.querySelector(".mask-row-expansion").value, "0");
});
