"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function flush(rounds = 8) {
  let result = Promise.resolve();
  for (let index = 0; index < rounds; index += 1) {
    result = result.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return result;
}

class Observable {
  constructor() {
    this.watchers = [];
  }

  watch(callback) {
    this.watchers.push(callback);
  }

  unwatch(callback) {
    this.watchers = this.watchers.filter((value) => value !== callback);
  }

  update() {
    for (const watcher of this.watchers.slice()) watcher();
  }
}

function createHarness() {
  const events = [];
  let tarCalls = 0;

  class Archive {
    constructor() {
      this.files = [];
    }

    addFile(name, data) {
      this.files.push({ name, data });
    }

    addFileString(name, value) {
      this.addFile(name, new TextEncoder().encode(value));
    }

    fileExists(name) {
      return this.files.some((entry) => entry.name === name);
    }

    tar() {
      tarCalls += 1;
      return Promise.resolve(
        new Blob([new Uint8Array([0x1f, 0x8b, 8, 0, 1])]),
      );
    }
  }

  function Editor() {}
  Editor.prototype.save = function () {};
  Editor.prototype.new = function () {};
  Editor.prototype.confirmIfDirty = function () {
    return true;
  };
  Editor.prototype.showFilePicker = function () {};

  const PZ = {
    archive: Archive,
    project: {
      save(archive, project) {
        archive.addFile(
          "project",
          new TextEncoder().encode(JSON.stringify(project.data)),
        );
      },
    },
    ui: { editor: Editor },
    zoidium: {
      define(name, value) {
        this[name] = value;
      },
    },
  };
  const windowObject = {
    PZ,
    crypto: null,
    dispatchEvent(event) {
      events.push(event);
    },
    document: {},
    setTimeout,
  };
  windowObject.window = windowObject;
  const context = vm.createContext({
    ArrayBuffer,
    Blob,
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    TextDecoder,
    TextEncoder,
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {},
    },
    Uint8Array,
    window: windowObject,
  });
  const source = fs.readFileSync(
    path.join(__dirname, "../plugins/core/project-files.js"),
    "utf8",
  );
  vm.runInContext(source, context);

  function makeEditor() {
    const editor = new Editor();
    editor.project = {
      assets: { list: {} },
      data: { title: "test" },
      ui: { dirty: true, onChanged: new Observable() },
    };
    return editor;
  }

  return {
    PZ,
    events,
    makeEditor,
    projectFiles: PZ.zoidium.projectFiles,
    tarCalls: () => tarCalls,
    windowObject,
  };
}

test("rapid saves join one picker, archive, and write operation", async () => {
  const harness = createHarness();
  const picker = deferred();
  let pickerCalls = 0;
  let writes = 0;
  harness.windowObject.showSaveFilePicker = function () {
    pickerCalls += 1;
    return picker.promise;
  };
  const handle = {
    name: "joined-save.pz",
    async createWritable() {
      return {
        async write() {
          writes += 1;
        },
        async close() {},
      };
    },
  };
  const editor = harness.makeEditor();
  harness.PZ.downloadBlob = new Blob(["finished video"]);
  harness.PZ.downloadFilename = "video.webm";

  const first = editor.save();
  const second = editor.save();
  assert.equal(first, second);
  assert.equal(pickerCalls, 1);
  picker.resolve(handle);
  await first;

  assert.equal(harness.tarCalls(), 1);
  assert.equal(writes, 1);
  assert.equal(editor.project.ui.dirty, false);
  assert.equal(harness.PZ.downloadFilename, "video.webm");
  assert.equal(await harness.PZ.downloadBlob.text(), "finished video");
});

test("an edit made while a save is writing stays dirty", async () => {
  const harness = createHarness();
  const writeGate = deferred();
  let writeStarted = false;
  const editor = harness.makeEditor();
  editor._zoidiumSaveFileHandle = {
    name: "project.pz",
    async createWritable() {
      return {
        async write() {
          writeStarted = true;
          await writeGate.promise;
        },
        async close() {},
      };
    },
  };

  const save = editor.save();
  while (!writeStarted) await flush(1);
  editor.project.data.title = "edited during save";
  editor.project.ui.dirty = true;
  editor.project.ui.onChanged.update();
  writeGate.resolve();
  await save;

  assert.equal(editor.project.ui.dirty, true);
});

test("project construction and tar run inside one coordinated operation", async () => {
  const harness = createHarness();
  const calls = [];
  harness.PZ.zoidiumIoSerialization = {
    run(kind, task) {
      calls.push(kind + "-start");
      return Promise.resolve(task()).then((value) => {
        calls.push(kind + "-end");
        return value;
      });
    },
    tarWithoutLock() {
      calls.push("tar-with-permit");
      return Promise.resolve(
        new Blob([new Uint8Array([0x1f, 0x8b, 8, 0, 1])]),
      );
    },
  };
  const editor = harness.makeEditor();

  await harness.projectFiles.createArchive(editor);
  assert.deepEqual(calls, [
    "project-save-start",
    "tar-with-permit",
    "project-save-end",
  ]);
  assert.equal(harness.tarCalls(), 0);
});
