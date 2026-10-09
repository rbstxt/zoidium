"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const CONTENT_HASH = "a".repeat(64);

// A Blob whose bytes are known up front; the fake archive reads its entries
// from this list when it is "untarred".
function archiveBlob(entries) {
  const blob = new Blob([JSON.stringify(entries.map((entry) => entry.name))]);
  blob.entries = entries;
  return blob;
}

function text(value) {
  return new TextEncoder().encode(value);
}

function validProjectEntries(project) {
  return [
    { name: "meta", data: text(JSON.stringify({ version: "1.0.102" })) },
    {
      name: "project",
      data: text(JSON.stringify(project || { assets: {}, media: [], sequence: {} })),
    },
  ];
}

function createHarness(options = {}) {
  const events = [];
  const tarOutputs = [];
  let tarCalls = 0;

  class Archive {
    constructor() {
      this.files = [];
    }

    addFile(name, data) {
      this.files.push({ name, data });
    }

    addFileString(name, value) {
      this.addFile(name, text(value));
    }

    fileExists(name) {
      return this.files.some((entry) => entry.name === name);
    }

    peekFile(name) {
      return this.files.find((entry) => entry.name === name);
    }

    getFile(name) {
      const index = this.files.findIndex((entry) => entry.name === name);
      return index < 0 ? null : this.files.splice(index, 1)[0];
    }

    async untar(source) {
      if (!source || !Array.isArray(source.entries)) throw new Error("not an archive");
      this.files = source.entries.map((entry) => ({ name: entry.name, data: entry.data }));
    }

    tar() {
      tarCalls += 1;
      const output = options.tarOutput
        ? options.tarOutput()
        : new Blob([new Uint8Array([0x1f, 0x8b, 8, 0, 1])]);
      tarOutputs.push(output);
      return Promise.resolve(output);
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
    compatibility: options.compatibility || undefined,
    project: {
      save: options.projectSave || function (archive) {
        validProjectEntries().forEach((entry) => archive.addFile(entry.name, new Blob([entry.data])));
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
    crypto: webcrypto,
    dispatchEvent(event) {
      events.push(event);
    },
    document: { body: { appendChild() {} }, createElement() { return { style: {}, click() {}, remove() {} }; } },
    URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
    setTimeout,
  };
  windowObject.window = windowObject;
  const context = vm.createContext({
    ArrayBuffer,
    Blob,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    Response,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL: windowObject.URL,
    window: windowObject,
  });
  const source = fs.readFileSync(path.join(__dirname, "../plugins/core/project-files.js"), "utf8");
  vm.runInContext(source, context);

  function makeEditor() {
    const editor = new Editor();
    editor.project = {
      assets: { list: {} },
      ui: { dirty: true, onChanged: { watch() {}, unwatch() {} } },
    };
    return editor;
  }

  function errorEvents() {
    return events.filter((event) => event.type === "zoidium:project-error");
  }

  return {
    PZ,
    windowObject,
    events,
    errorEvents,
    makeEditor,
    projectFiles: PZ.zoidium.projectFiles,
    tarCalls: () => tarCalls,
    tarOutputs,
  };
}

// A file handle that records every writable it creates.
function recordingHandle(name) {
  const handle = {
    name,
    writables: 0,
    writes: [],
    async createWritable() {
      handle.writables += 1;
      return {
        async write(blob) {
          handle.writes.push(blob);
        },
        async close() {},
        async abort() {},
      };
    },
  };
  return handle;
}

async function expectSaveRefused(harness, pattern) {
  const editor = harness.makeEditor();
  const handle = recordingHandle("project.pz");
  editor._zoidiumSaveFileHandle = handle;
  assert.equal(await editor.save(), null);
  assert.equal(handle.writables, 0, "no file is opened for writing");
  const [error] = harness.errorEvents();
  assert.ok(error, "the save reports a project error");
  assert.match(error.detail.message, pattern);
  return error;
}

test("a project entry that holds the text undefined is refused and never written", async () => {
  const harness = createHarness({
    projectSave(archive) {
      // What PZ.project.save produces when JSON.stringify returns undefined.
      archive.addFile("meta", new Blob([JSON.stringify({ version: "1.0.102" })]));
      archive.addFile("project", new Blob([undefined]));
    },
  });
  await expectSaveRefused(harness, /^Nothing was saved\. The project data contains the placeholder text "undefined"/);
});

test("a missing project entry is refused, for example when a save wrapper finishes late", async () => {
  const harness = createHarness({
    projectSave(archive) {
      // A wrapper that returns before the project data is written.
      setTimeout(() => validProjectEntries().forEach((entry) => archive.addFile(entry.name, new Blob([entry.data]))), 50);
      return Promise.resolve();
    },
  });
  await expectSaveRefused(harness, /The project data is missing from the archive\./);
});

test("an empty project entry is refused", async () => {
  const harness = createHarness({
    projectSave(archive) {
      archive.addFile("meta", new Blob([JSON.stringify({ version: "1" })]));
      archive.addFile("project", new Blob([]));
    },
  });
  await expectSaveRefused(harness, /The project data is empty\./);
});

test("a project entry that is not JSON is refused", async () => {
  const harness = createHarness({
    projectSave(archive) {
      archive.addFile("meta", new Blob([JSON.stringify({ version: "1" })]));
      archive.addFile("project", new Blob(["{\"media\": [oops"]));
    },
  });
  await expectSaveRefused(harness, /The project data is not valid JSON\./);
});

test("a project document without the sequence or media list is refused", async () => {
  const harness = createHarness({
    projectSave(archive) {
      archive.addFile("meta", new Blob([JSON.stringify({ version: "1" })]));
      archive.addFile("project", new Blob([JSON.stringify({ title: "only a title" })]));
    },
  });
  await expectSaveRefused(harness, /The project data has no sequence or media list\./);
});

test("a save without its metadata entry is refused", async () => {
  const harness = createHarness({
    projectSave(archive) {
      archive.addFile("project", new Blob([JSON.stringify({ assets: {}, media: [], sequence: {} })]));
    },
  });
  await expectSaveRefused(harness, /The project metadata is missing from the archive\./);
});

test("a serializer that throws reports its cause and writes nothing", async () => {
  const harness = createHarness({
    projectSave() {
      throw new TypeError("plugin toJSON failed");
    },
  });
  await expectSaveRefused(harness, /The project could not be serialized \(plugin toJSON failed\)\./);
});

test("an empty TAR result is refused", async () => {
  const harness = createHarness({ tarOutput: () => new Blob([]) });
  await assert.rejects(
    harness.projectFiles.createArchive(harness.makeEditor()),
    /Could not create the project archive\. Nothing was saved\./,
  );
});

test("a valid project is written exactly once with the validated archive", async () => {
  const harness = createHarness();
  const editor = harness.makeEditor();
  const handle = recordingHandle("project.pz");
  editor._zoidiumSaveFileHandle = handle;

  const result = await editor.save();
  assert.ok(result && result.blob);
  assert.equal(handle.writables, 1);
  assert.equal(handle.writes.length, 1);
  assert.equal(harness.errorEvents().length, 0);
  assert.ok(harness.events.some((event) => event.type === "zoidium:project-saved"));
});

test("opening a file that is empty reports a recoverable project data error", async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.projectFiles.openValidatedArchive(new Blob([]), "open"),
    (error) => {
      assert.equal(harness.projectFiles.isProjectDataError(error), true);
      assert.equal(error.message, "This project file cannot be opened. The archive is empty.");
      return true;
    },
  );
});

test("opening a damaged project keeps the file unchanged and names the missing entry", async () => {
  const harness = createHarness();
  const damaged = archiveBlob([{ name: "meta", data: text("{\"version\":\"1\"}") }]);
  await assert.rejects(
    harness.projectFiles.openValidatedArchive(damaged, "open"),
    (error) => {
      assert.equal(error.message, "This project file cannot be opened. The project data is missing from the archive.");
      return true;
    },
  );
});

test("restore points use restore wording for the same checks", async () => {
  const harness = createHarness();
  const damaged = archiveBlob([
    { name: "meta", data: text("{\"version\":\"1\"}") },
    { name: "project", data: text("undefined") },
  ]);
  await assert.rejects(
    harness.projectFiles.openValidatedArchive(damaged, "restore"),
    (error) => {
      assert.equal(error.message, "This restore point cannot be opened. The project data contains the placeholder text \"undefined\" instead of JSON.");
      return true;
    },
  );
});

test("a readable project archive opens and its entries stay in place", async () => {
  const harness = createHarness();
  const archive = await harness.projectFiles.openValidatedArchive(
    archiveBlob(validProjectEntries({ assets: {}, media: [{}], sequence: {} })),
    "open",
  );
  assert.equal(archive.files.length, 2, "validation only reads the entries");
});

test("a CM2 archive is left to CM3's compatibility loader", async () => {
  const harness = createHarness({
    compatibility: { CM2: { check: (archive) => archive.fileExists("objects") } },
  });
  const legacy = archiveBlob([{ name: "objects", data: text("[]") }]);
  const archive = new harness.PZ.archive();
  await archive.untar(legacy);
  const result = await harness.projectFiles.validateProjectArchive(archive, "open");
  assert.equal(result.legacy, true);
  assert.equal(result.mediaCount, 0);
  await assert.rejects(harness.projectFiles.validateProjectArchive(archive, "save"));
});

test("an archive that is not readable is reported as a project data error", async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.projectFiles.openValidatedArchive({ size: 4, entries: undefined }, "open"),
    (error) => {
      assert.equal(harness.projectFiles.isProjectDataError(error), true);
      assert.equal(error.message, "This project file cannot be opened. The archive is not readable.");
      return true;
    },
  );
});

test("automatic backups can stop before the TAR is built", async () => {
  const harness = createHarness();
  const result = await harness.projectFiles.createArchive(harness.makeEditor(), {
    shouldSkip: async () => true,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.blob, null);
  assert.equal(harness.tarCalls(), 0);
  assert.match(result.fingerprint, /^entries-v3:/);
});

test("media stored under a content hash is fingerprinted by name and size only", async () => {
  const harness = createHarness();
  let reads = 0;
  const media = new Blob(["0123456789"]);
  media.arrayBuffer = async () => {
    reads += 1;
    return new ArrayBuffer(0);
  };
  harness.PZ.project.save = function (archive) {
    validProjectEntries().forEach((entry) => archive.addFile(entry.name, new Blob([entry.data])));
  };
  const editor = harness.makeEditor();
  editor.project.assets.list = { one: { sha256: CONTENT_HASH, file: media } };

  const first = await harness.projectFiles.createArchive(editor, { shouldSkip: () => true });
  assert.equal(reads, 0, "the media bytes are not read for the fingerprint");

  const resized = new Blob(["0123456789abc"]);
  editor.project.assets.list = { one: { sha256: CONTENT_HASH, file: resized } };
  const second = await harness.projectFiles.createArchive(editor, { shouldSkip: () => true });
  assert.notEqual(first.fingerprint, second.fingerprint, "a size change still changes the fingerprint");
});

test("with no saved file the picker opens, but nothing is written when the archive is invalid", async () => {
  const harness = createHarness({
    projectSave(archive) {
      archive.addFile("meta", new Blob([JSON.stringify({ version: "1" })]));
      archive.addFile("project", new Blob(["undefined"]));
    },
  });
  const handle = recordingHandle("chosen.pz");
  let pickerCalls = 0;
  harness.windowObject.showSaveFilePicker = async () => {
    pickerCalls += 1;
    return handle;
  };
  const editor = harness.makeEditor();
  assert.equal(await editor.save(), null);
  assert.equal(pickerCalls, 1, "the picker runs first so the user gesture is kept");
  assert.equal(handle.writables, 0, "the chosen file is left untouched");
  assert.equal(harness.errorEvents().length, 1);
});

test("without a save picker the valid project is delivered as a download, not an error", async () => {
  const harness = createHarness();
  const editor = harness.makeEditor();
  const result = await editor.save();
  assert.ok(result && result.blob, "the archive is produced");
  assert.equal(harness.errorEvents().length, 0);
  const saved = harness.events.find((event) => event.type === "zoidium:project-saved");
  assert.ok(saved, "the save reports success");
  assert.equal(saved.detail.delivery, "download");
});
