"use strict";

// Characterization of the assembled ZoidiumUI surface: every public member,
// the skin scoping rules, the search filter, the chrome button and the
// controls builders. The scripts load in zoidium/runtime-config.js order, so
// these pins hold before and after the ui-kit.js split without changes.

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const { kitScripts, readScript } = require("./uikit-files");
const { makeDocument, FakeElement } = require("./fake-dom");

function loadKit() {
  const files = kitScripts();
  assert.ok(files.includes("zoidium/ui-kit.js"), "runtime-config still loads ui-kit.js, got: " + files.join(","));
  const head = new FakeElement("head");
  const context = {
    console: { error() {} },
    document: makeDocument(),
  };
  context.document.head = head;
  context.window = context;
  vm.createContext(context);
  for (const file of files) vm.runInContext(readScript(file), context, { filename: file });
  assert.equal(context.ZoidiumUIModules, undefined, "the module queue is consumed");
  assert.ok(Object.isFrozen(context.ZoidiumUI), "ZoidiumUI is frozen");
  return { context, api: context.ZoidiumUI, head };
}

test("the assembled surface keeps every public member", () => {
  const { api } = loadKit();
  assert.deepEqual(Object.keys(api).sort(), [
    "acquirePreview",
    "attachSearchFilter",
    "closeWindows",
    "confirm",
    "controls",
    "createButton",
    "createMenubarTab",
    "createPageHeader",
    "createSearchBox",
    "createSidePanel",
    "getElevator",
    "getWindow",
    "nodeEditor",
    "notify",
    "openAttributePanel",
    "openMenu",
    "openWindow",
    "properties",
    "refreshEditors",
    "registerAttributePanel",
    "registerEditor",
    "registerMenuExtension",
    "registerSkin",
    "removeMenubarTab",
  ]);
  assert.deepEqual(Object.keys(api.controls).sort(), [
    "button",
    "buttonRow",
    "checkbox",
    "color",
    "list",
    "note",
    "number",
    "section",
    "select",
    "slider",
    "tabs",
    "text",
  ]);
  assert.ok(Object.isFrozen(api.controls));
});

test("skins scope selectors, drop comments and scope media queries", () => {
  const { api, head } = loadKit();
  const remove = api.registerSkin("suite:designer", [
    "/* comment */",
    ":scope { color: red; }",
    ".tc-preset:hover, .tc-block.active { color: #fff; }",
    "body { margin: 0; }",
    ".a:not(.b, .c) { top: 0; }",
    "@media (prefers-reduced-motion: reduce) { .tc-designer * { animation: none; } }",
  ].join("\n"));
  const css = head.children[0].textContent;
  const scope = '.zoidium-window[data-zui-skin="suite:designer"]';
  assert.ok(css.includes(`${scope}{ color: red; }`), css);
  assert.ok(css.includes(`${scope} .tc-preset:hover,${scope} .tc-block.active{`), css);
  assert.ok(css.includes(`${scope}{ margin: 0; }`), css);
  assert.ok(css.includes(`${scope} .a:not(.b, .c){`), "commas inside :not() are not split: " + css);
  assert.ok(css.includes(`@media (prefers-reduced-motion: reduce){${scope} .tc-designer *{`), css);
  assert.ok(!css.includes("comment"), css);
  remove();
  assert.equal(head.children.length, 0, "removing the skin removes its style element");
});

test("the search filter matches dataset text and Escape clears the query", () => {
  const { api } = loadKit();
  const search = api.createSearchBox({ placeholder: "find thing" });
  assert.equal(search.input.placeholder, "find thing");
  assert.equal(search.input.getAttribute("aria-label"), "find thing");
  const list = new FakeElement("div");
  for (const name of ["Bloom Effect", "Vignette", "Grain"]) {
    const entry = new FakeElement("div");
    entry.className = "zoidium-plugin-entry";
    entry.dataset.searchText = name.toLowerCase();
    list.appendChild(entry);
  }
  const seen = [];
  api.attachSearchFilter(search.input, list, { onUpdate: () => seen.push(true) });
  search.input.value = "  ETTE  ";
  search.input.dispatch("input", {});
  assert.deepEqual(list.children.map((entry) => entry.hidden), [true, false, true]);
  assert.ok(seen.length >= 1);
  search.input.dispatch("keydown", { key: "Escape" });
  assert.equal(search.input.value, "");
  assert.deepEqual(list.children.map((entry) => entry.hidden), [false, false, false]);
});

test("the chrome button falls back to a labeled button without legacy controls", () => {
  const { api } = loadKit();
  const clicked = [];
  const button = api.createButton({ title: "Download", hint: "Save the file", onClick: () => clicked.push(true) });
  assert.equal(button.textContent, "Download");
  assert.equal(button.title, "Save the file");
  assert.equal(button.getAttribute("aria-label"), "Download");
  button.click();
  assert.deepEqual(clicked, [true]);
});

test("controls builders round-trip values through get and set", () => {
  const { api } = loadKit();
  const controls = api.controls;

  const numberControl = controls.number({ label: "Size", value: 1.23456, min: 0, max: 10, step: 0.01 });
  assert.equal(numberControl.get(), 1.23456);
  assert.equal(numberControl.input.value, "1.23");
  numberControl.set(99);
  assert.equal(numberControl.get(), 10, "set clamps to max");
  numberControl.setDisabled(true);
  assert.equal(numberControl.input.disabled, true);

  const sliderControl = controls.slider({ label: "Mix", value: 0.5, min: 0, max: 1, step: 0.01 });
  assert.equal(sliderControl.get(), 0.5);
  sliderControl.set(0.25);
  assert.equal(sliderControl.get(), 0.25);

  const checkboxControl = controls.checkbox({ label: "On", value: false });
  assert.equal(checkboxControl.get(), false);
  checkboxControl.set(true);
  assert.equal(checkboxControl.get(), true);

  const selectControl = controls.select({
    label: "Mode",
    value: "b",
    options: [{ value: "a", label: "A" }, { value: "b", label: "B", group: "G" }],
  });
  assert.equal(selectControl.get(), "b");
  selectControl.setOptions(["x", "y"], "y");
  assert.equal(selectControl.get(), "y");

  const colorControl = controls.color({ label: "Tint", value: "nope" });
  assert.equal(colorControl.get(), "#ffffff");
  colorControl.set("#ff0000");
  assert.equal(colorControl.get(), "#ff0000");

  const textControl = controls.text({ label: "Name", value: "hi" });
  assert.equal(textControl.get(), "hi");
  textControl.set("bye");
  assert.equal(textControl.get(), "bye");

  const noteControl = controls.note("Careful.", "warning");
  assert.ok(noteControl.element.classList.contains("warning"));
  assert.equal(noteControl.element.textContent, "Careful.");
});

test("section, tabs and list builders manage their own state", () => {
  const { api } = loadKit();
  const controls = api.controls;

  const sectionControl = controls.section({ title: "Tape", collapsed: true });
  assert.ok(sectionControl.element.classList.contains("collapsed"));
  sectionControl.setCollapsed(false);
  assert.ok(!sectionControl.element.classList.contains("collapsed"));

  const rendered = [];
  const tabsControl = controls.tabs({
    tabs: [
      { id: "a", title: "A", render: (panel) => rendered.push(["a", panel]) },
      { id: "b", title: "B", render: (panel) => rendered.push(["b", panel]) },
    ],
  });
  assert.deepEqual(rendered.map((entry) => entry[0]), ["a"], "first tab renders eagerly");
  tabsControl.show("b");
  assert.deepEqual(rendered.map((entry) => entry[0]), ["a", "b"], "second tab renders lazily on show");

  const selected = [];
  const activated = [];
  const listControl = controls.list({
    items: [{ id: "n1", title: "Noise" }, { id: "n2", title: "Mix", detail: "color" }],
    onSelect: (id) => selected.push(id),
    onActivate: (id) => activated.push(id),
  });
  assert.equal(listControl.get(), null);
  listControl.element.children[1].click();
  assert.equal(listControl.get(), "n2");
  assert.deepEqual(selected, ["n2"]);
  listControl.element.children[1].dispatch("dblclick", {});
  assert.deepEqual(activated, ["n2"]);
  listControl.setItems([]);
  assert.equal(listControl.element.children[0].textContent, "Nothing here yet.");
});
