"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createActions } = require("../plugins/asset-manager/assets-actions.js");

function setup(precomp = null) {
  const calls = [], notices = [];
  const registry = { capabilities: () => ({ reload: true, locate: true, exportFile: true }),
    reload() {}, locate() {}, replace() {}, exportFile() {}, removeUnused() {}, removeItems() {} };
  const editor = {};
  const actions = createActions({
    document: {}, registry: () => registry, notify: (detail) => notices.push(detail), confirm: async () => true,
    reveal() {}, resolveFonts() {}, editor: () => editor, precomp: () => precomp,
    rename: (item, commit) => calls.push(["rename", item.id, commit("Renamed")]),
    select: (id) => calls.push(["select", id]),
  });
  return { actions, calls, notices, editor };
}
const ids = (commands, menu) => commands.filter((command) => !menu || !command.hidden).map((command) => command.id);

test("an unused file can still be replaced, downloaded and deleted; inapplicable commands leave the menu", () => {
  const { actions } = setup();
  const item = { id: "a", kind: "image", source: "file", status: "ready", usages: [] };
  const commands = actions.list(item);
  assert.deepEqual(ids(commands, true), ["reload", "replace", "export", "delete"]);
  assert.deepEqual(ids(commands), ["reveal", "reload", "locate", "replace", "export", "delete"], "the icon bar keeps its places");
  for (const command of commands.filter((entry) => !entry.hidden)) assert.equal(command.enabled, true, command.id);
  const missing = actions.list({ ...item, status: "missing", usages: [{ revealable: true }] });
  assert.deepEqual(ids(missing, true), ["reveal", "reload", "locate", "replace", "export", "delete"]);
});

test("composition items open, rename, duplicate and delete through Precomp+", () => {
  const precomp = {
    openComp: (editor, id) => ({ ok: id === "intro" }),
    renameComp: (editor, id, name) => ({ ok: name === "Renamed" }),
    duplicateComp: () => ({ ok: true, id: "intro-copy" }),
  };
  const { actions, calls, notices } = setup(precomp);
  const item = { id: "comp:intro", kind: "composition", source: "composition", name: "Intro", usages: [] };
  const commands = actions.list(item);
  assert.deepEqual(ids(commands, true), ["open", "rename", "duplicate", "delete"]);
  assert.ok(commands.filter((command) => !command.hidden).every((command) => command.enabled));
  const run = (id) => commands.find((command) => command.id === id).run();
  run("open"); run("rename"); run("duplicate");
  assert.deepEqual(calls, [["rename", "comp:intro", true], ["select", "comp:intro-copy"]]);
  assert.equal(notices.length, 0);
  const used = actions.list({ ...item, usages: [{ revealable: true }] });
  assert.deepEqual(ids(used, true), ["open", "reveal", "rename", "duplicate", "delete"]);
  assert.equal(used.find((command) => command.id === "delete").enabled, false, "Precomp+ refuses to delete a used composition");
});
