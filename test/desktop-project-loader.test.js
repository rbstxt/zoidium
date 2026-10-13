"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function harness() {
  const events = [];
  const listeners = new Map();
  const calls = [];
  const bridge = {
    onFile(callback) { this.receive = callback; },
    ready() { calls.push("ready"); },
    complete(id) { calls.push(["complete", id]); },
  };
  class Archive {
    async untar(file) {
      calls.push(["untar", file.name]);
      this.files = [
        { name: "project", data: '{"sequence":{},"media":[]}' },
        { name: "zoidium.json", data: new TextEncoder().encode('{"name":"Saved project"}') },
      ];
    }
    peekFile(name) { return this.files.find((entry) => entry.name === name); }
  }
  class Editor {
    confirmIfDirty() { calls.push("confirm"); return this.approved !== false; }
    showFilePicker(callback) { this.pick = callback; }
    async loadProject() { calls.push("load"); return this.nextProject; }
  }
  const PZ = { archive: Archive, ui: { editor: Editor }, zoidium: { define(name, value) { this[name] = value; } } };
  const window = {
    PZ, Blob, File, ZoidiumDesktopProjects: bridge,
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatchEvent(event) { events.push(event); },
    async fetch(url) { calls.push(["fetch", url]); return new Response("archive bytes"); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugins/core/project-files.js"), "utf8"), {
    window, Blob, ArrayBuffer, TextEncoder, TextDecoder, Uint8Array,
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
  });
  const editor = new Editor();
  editor.project = { previous: true };
  editor.nextProject = { children: [] };
  window.CM = editor;
  return { window, editor, bridge, listeners, calls, events };
}

const file = () => new File(["project archive"], "Saved.PZ");

test("desktop and toolbar files run the same confirmed, validated loading path", async () => {
  const direct = harness();
  await direct.editor.open(file());
  const toolbar = harness();
  toolbar.editor.open();
  const input = { files: [file()], value: "filename" };
  await toolbar.editor.pick({ currentTarget: input });
  assert.deepEqual(direct.calls, toolbar.calls);
  assert.deepEqual(direct.events.map((event) => event.type), toolbar.events.map((event) => event.type));
  assert.equal(direct.editor.project, direct.editor.nextProject);
  assert.equal(direct.editor._zoidiumSaveFileHandle, null);
  assert.equal(input.value, "");
  assert.equal(direct.window.PZ.zoidium.projectFiles.getProjectName(direct.editor), "Saved project");
});

test("rejecting the existing unsaved confirmation does not parse or replace the project", async () => {
  const run = harness();
  const project = run.editor.project;
  run.editor.approved = false;
  await run.editor.open(file());
  assert.equal(run.editor.project, project);
  assert.deepEqual(run.calls, ["confirm"]);
  assert.equal(run.events.length, 0);
});

test("desktop readiness waits for zoidium:ready and a usable editor", () => {
  const run = harness();
  assert.deepEqual(run.calls, []);
  const editor = run.window.CM;
  run.window.CM = null;
  run.listeners.get("zoidium:ready")();
  assert.deepEqual(run.calls, []);
  run.window.CM = editor;
  run.listeners.get("zoidium:ready")();
  assert.deepEqual(run.calls, ["ready"]);
});

test("desktop completion awaits plugin activation and nested asset loads", async () => {
  const run = harness();
  let finishActivation;
  let finishAsset;
  run.editor.nextProject = {
    _zoidiumPluginActivationPending: new Promise((resolve) => { finishActivation = resolve; }),
    children: [{ loading: new Promise((resolve) => { finishAsset = resolve; }) }],
  };
  const operation = run.bridge.receive({ id: "id", name: "Saved.PZ", url: "/_zoidium/desktop-project/id" });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  assert.equal(run.calls.some((call) => Array.isArray(call) && call[0] === "complete"), false);
  finishActivation();
  await settle();
  assert.equal(run.calls.some((call) => Array.isArray(call) && call[0] === "complete"), false);
  finishAsset();
  await operation;
  assert.deepEqual(run.calls.at(-1), ["complete", "id"]);
  assert.equal(run.editor.project, run.editor.nextProject);
});

test("cancelled and unavailable desktop files release the queue without replacing the project", async () => {
  for (const scenario of ["cancel", "missing"]) {
    const run = harness();
    const project = run.editor.project;
    if (scenario === "cancel") run.editor.approved = false;
    else run.window.fetch = async () => new Response("", { status: 404 });
    await run.bridge.receive({ id: "id", name: "Saved.PZ", url: "/_zoidium/desktop-project/id" });
    assert.equal(run.editor.project, project);
    assert.deepEqual(run.calls.at(-1), ["complete", "id"]);
    if (scenario === "missing") assert.match(run.events.at(-1).detail.message, /no longer available/);
  }
});

test("sandboxed preload exposes fixed channels without leaking the IPC event", () => {
  let api;
  let receive;
  const sent = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../desktop/preload.cjs"), "utf8"), {
    require(name) {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, "ZoidiumDesktopProjects"); api = value; } },
        ipcRenderer: { on(channel, callback) { assert.equal(channel, "zoidium:desktop-project-file"); receive = callback; }, send: (...args) => sent.push(args) },
      };
    },
  });
  assert.deepEqual(Object.keys(api), ["onFile", "ready", "complete"]);
  let args;
  api.onFile((...values) => { args = values; });
  receive({ sender: "privileged" }, { id: "id" });
  assert.deepEqual(args, [{ id: "id" }]);
  api.ready();
  api.complete("id");
  api.complete({ arbitrary: "message" });
  assert.deepEqual(sent, [["zoidium:desktop-project-ready"], ["zoidium:desktop-project-done", "id"]]);
});
