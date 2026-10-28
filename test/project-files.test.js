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

// Mimics the File handle the CM3 archive worker posts back for the
// origin-private file named "out": it stays valid until a later render or
// cleanup rewrites the file, and then every read fails.
function fileBackedExport(bytes) {
  const data = new Uint8Array(bytes);
  const state = { source: new Blob([data]) };
  const blob = {
    name: "out",
    // A File handle keeps the length it reported when it was created.
    size: data.length,
    slice(start, end) {
      return state.source.slice(start, end);
    },
    stream() {
      if (!state.source) throw new Error("NotReadableError");
      return state.source.stream();
    },
    arrayBuffer() {
      if (!state.source) throw new Error("NotReadableError");
      return state.source.arrayBuffer();
    },
  };
  return {
    blob,
    invalidate() {
      state.source = null;
    },
  };
}

// Writes the "meta" and "project" entries that CM3 writes for a project, so
// tests that replace PZ.project.save still produce a valid archive.
function addProjectEntries(archive, project) {
  archive.addFile("meta", new TextEncoder().encode(JSON.stringify({ version: "1.0.102" })));
  archive.addFile(
    "project",
    new TextEncoder().encode(JSON.stringify(project || { assets: {}, media: [], sequence: {} })),
  );
}

function createHarness(options = {}) {
  const events = [];
  let tarCalls = 0;
  let downloads = 0;
  const listeners = {};

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

    peekFile(name) {
      return this.files.find((entry) => entry.name === name);
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
  Editor.prototype.loadProject = async function () { return this.loadedProject; };
  Editor.prototype.confirmIfDirty = function () {
    return true;
  };
  Editor.prototype.showFilePicker = function () {};

  const PZ = {
    archive: Archive,
    project: {
      // Mirrors CM3: a "meta" entry plus a "project" entry shaped like
      // PZ.project.prototype.toJSON ({ assets, media, sequence }).
      save(archive, project) {
        archive.addFile(
          "meta",
          new TextEncoder().encode(JSON.stringify({ version: "1.0.102" })),
        );
        archive.addFile(
          "project",
          new TextEncoder().encode(
            JSON.stringify({ assets: {}, media: [], sequence: {}, data: project.data }),
          ),
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
    addEventListener(type, callback) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(callback);
    },
    removeEventListener(type, callback) {
      listeners[type] = (listeners[type] || []).filter((value) => value !== callback);
    },
    document: {
      body: {
        appendChild() {},
      },
      createElement() {
        return {
          style: {},
          click() {
            downloads += 1;
          },
          remove() {},
        };
      },
    },
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {},
    },
    setTimeout,
  };
  windowObject.window = windowObject;
  const context = vm.createContext({
    ArrayBuffer,
    Blob,
    Response,
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
  const sharedSource = fs.readFileSync(
    path.join(__dirname, "../plugins/core/project-files-shared.js"),
    "utf8",
  );
  const archiveIO = require("./project-archive-harness.cjs").installArchive(windowObject, options);
  const encode = archiveIO.encode;
  archiveIO.encode = function (archive) { tarCalls += 1; return encode(archive); };
  vm.runInContext(sharedSource, context);
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
    listeners,
    makeEditor,
    projectFiles: PZ.zoidium.projectFiles,
    tarCalls: () => tarCalls,
    downloads: () => downloads,
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

test("a user-gesture picker failure falls back to downloading the project", async () => {
  const harness = createHarness();
  harness.windowObject.showSaveFilePicker = function () {
    const error = new Error(
      "Failed to execute 'showSaveFilePicker' on 'Window': Must be handling a user gesture to show a file picker.",
    );
    error.name = "SecurityError";
    return Promise.reject(error);
  };
  const editor = harness.makeEditor();

  const result = await editor.save();

  assert.ok(result);
  assert.equal(harness.downloads(), 1);
  assert.equal(editor.project.ui.dirty, false);
  const saved = harness.events.find((event) => event.type === "zoidium:project-saved");
  assert.equal(saved.detail.delivery, "download");
  assert.equal(
    harness.events.some((event) => event.type === "zoidium:project-error"),
    false,
  );
});

test("project names keep their real value in UI labels", () => {
  const harness = createHarness();

  assert.equal(harness.projectFiles.displayNameForUi("project"), "project");
  assert.equal(harness.projectFiles.displayNameForUi("うお"), "うお");
  assert.equal(
    harness.projectFiles.displayNameForUi("Project [U+3046 U+304A]"),
    "うお",
  );
  assert.equal(
    harness.projectFiles.displayNameForUi("Project [U+3046] custom"),
    "Project [U+3046] custom",
  );
  assert.equal(
    harness.projectFiles.fileNameForProject("うお"),
    "うお.pz",
  );
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

test("project saves use memory independently of the shared export workspace", async () => {
  const harness = createHarness();
  harness.PZ.zoidiumIoSerialization = {
    run() { throw new Error("The video workspace is busy."); },
    tarWithoutLock() { throw new Error("The video workspace is busy."); },
  };
  const result = await harness.projectFiles.createArchive(harness.makeEditor());
  assert.ok(result.blob instanceof Blob);
  const reopened = await harness.projectFiles.openValidatedArchive(result.blob, "open");
  assert.ok(reopened.peekFile("project"));
  assert.ok(reopened.peekFile("zoidium.json"));
});

test("a project archive that cannot be read back fails the save", async () => {
  const harness = createHarness();
  const entry = fileBackedExport([0x1f, 0x8b, 8, 0, 1, 2, 3]);
  harness.PZ.zoidiumProjectArchive.encode = () => {
    entry.invalidate();
    return Promise.resolve(entry.blob);
  };
  const editor = harness.makeEditor();
  editor._zoidiumSaveFileHandle = {
    name: "project.pz",
    async createWritable() {
      return {
        async write() {},
        async close() {},
      };
    },
  };

  assert.equal(await editor.save(), null);
  const error = harness.events.find((event) => event.type === "zoidium:project-error");
  assert.ok(error, "the save reports a project error");
  assert.match(error.detail.message, /not readable|NotReadable|cannot be read|decompression|empty|header|stream/);
});


test("project TAR entries copy attached media once before compression", async () => {
  const harness = createHarness();
  const media = new Blob(["media bytes"]);
  let reads = 0;
  const original = media.arrayBuffer.bind(media);
  media.arrayBuffer = function () { reads += 1; return original(); };
  harness.PZ.project.save = function (archive) { addProjectEntries(archive); archive.addFile("media", media); };
  let captured;
  const encode = harness.PZ.zoidiumProjectArchive.encode;
  harness.PZ.zoidiumProjectArchive.encode = function (archive) { captured = archive; return encode(archive); };
  const result = await harness.projectFiles.createArchive(harness.makeEditor());
  assert.notEqual(captured.files.find((entry) => entry.name === "media").data, media);
  assert.equal(reads, 1, "attached bytes are copied once before compression");
  assert.match(result.fingerprint, /^entries-v4:/);
});

test("archive fingerprints are independent of entry insertion order", async () => {
  const harness = createHarness();
  const files = [["b", "second"], ["a", "first"]];
  const editor = harness.makeEditor();
  harness.PZ.project.save = (archive) => { addProjectEntries(archive); for (const [name, text] of files) archive.addFile(name, new Blob([text])); };
  const first = await harness.projectFiles.createArchive(editor);
  files.reverse();
  const second = await harness.projectFiles.createArchive(editor);
  assert.equal(first.fingerprint, second.fingerprint);
  files[0][1] = "changed";
  const third = await harness.projectFiles.createArchive(editor);
  assert.notEqual(first.fingerprint, third.fingerprint);
});


test("project loading awaits plugin activation and lazily created nested effects", async () => {
  const harness = createHarness();
  const activation = deferred();
  const layerLoad = deferred();
  const effectLoad = deferred();
  const effect = { loading: effectLoad.promise, children: [] };
  const layer = { loading: layerLoad.promise, children: [] };
  const project = { _zoidiumPluginActivationPending: activation.promise, children: [layer] };
  const editor = harness.makeEditor();
  editor.loadedProject = project;
  let finished = false;
  const loaded = editor.loadProject({}).then((value) => { finished = true; return value; });
  await flush();
  assert.equal(finished, false, "plugin activation finishes first");
  activation.resolve();
  await flush();
  assert.equal(finished, false, "the layer load is awaited");
  layer.children = [[effect, layer]];
  layerLoad.resolve();
  await flush();
  assert.equal(finished, false, "nested effects created by the layer are awaited");
  effectLoad.resolve();
  assert.equal(await loaded, project);
  assert.equal(finished, true);
});

test("a failed nested effect load leaves the rest of the project openable, as in CM3", async () => {
  const harness = createHarness();
  const editor = harness.makeEditor();
  const later = deferred();
  const project = { children: [{ loading: Promise.reject(new Error("Effect load failed.")) }, { loading: later.promise }] };
  editor.loadedProject = project;
  let finished = false;
  const loaded = editor.loadProject({}).then((value) => { finished = true; return value; });
  await flush();
  assert.equal(finished, false, "later objects are still awaited");
  later.resolve();
  assert.equal(await loaded, project);
});

module.exports = { createHarness, addProjectEntries, flush };

test('project loading restores track fields after plugin activation and nested loads, before editor replacement', async () => {
  const harness = createHarness(); const editor = harness.makeEditor();
  const previous = editor.project; const activation = deferred(); const trackLoad = deferred();
  const project = { _zoidiumPluginActivationPending: activation.promise, children: [{ loading: trackLoad.promise }] };
  editor.loadedProject = project;
  const restored = [];
  harness.windowObject.ZoidiumPluginApis = { timeline: { restoreTrackFields(target) {
    assert.equal(editor.project, previous); restored.push(target);
  } } };
  const loading = editor.loadProject({});
  await flush(); assert.equal(restored.length, 0);
  activation.resolve(); await flush(); assert.equal(restored.length, 0);
  trackLoad.resolve(); assert.equal(await loading, project);
  assert.deepEqual(restored, [project]);
});

test("community payloads survive archives and restore points without package bytes or approvals", async () => {
  const h = createHarness(), editor = h.makeEditor();
  const manifest = require("../examples/community-filter/manifest.json");
  const payload = { type: manifest.effects[0].id, community: { schemaVersion: 500, dataSchema: "future",
    packageId: manifest.id, packageHash: "retained-hash" }, properties: { unknown: [null, false, 7] } };
  const data = { assets: {}, sequence: {}, media: [{ data: { effects: [payload] } }],
    plugins: [{ id: manifest.id, name: "Saved plugin", requirements: [{ effect: payload.type,
      packageHash: "retained-hash", dataSchema: "future", schemaVersion: 500 }] }] };
  editor.project.toJSON = () => data;
  // Installation state belongs to the host, never the project serializer.
  h.windowObject.ZoidiumCommunityInstalledPackages = { bytes: "PRIVATE_PACKAGE_CODE", approvals: "PRIVATE_APPROVAL" };
  h.PZ.project.save = archive => addProjectEntries(archive, editor.project);
  const result = await h.projectFiles.createArchive(editor);
  const archive = await h.projectFiles.openValidatedArchive(result.blob, "open");
  const read = async value => new TextDecoder().decode(await h.windowObject.PZ.zoidiumProjectArchive.bytes(value));
  const saved = await read(archive.peekFile("project").data);
  assert.equal(saved, JSON.stringify(data));
  for (const entry of archive.files) assert.doesNotMatch(await read(entry.data), /PRIVATE_PACKAGE_CODE|PRIVATE_APPROVAL/);
  h.windowObject.__zoidiumRestoreParts = { store: { getSnapshot() {}, loadAssets() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../zoidium/project-restore-snapshots.js"), "utf8"), {
    window: h.windowObject, TextEncoder, TextDecoder, Uint8Array, Blob,
  });
  const restored = await h.windowObject.__zoidiumRestoreParts.snapshots.restorePointToArchive({
    projectBlob: result.blob, assetRefs: [],
  }, []);
  assert.equal(await read(restored.peekFile("project").data), saved);
  for (const entry of restored.files) assert.doesNotMatch(await read(entry.data), /PRIVATE_PACKAGE_CODE|PRIVATE_APPROVAL/);
});
