"use strict";

// Regression coverage for "Failed to execute 'createObjectURL' on 'URL'": a
// media item's thumbnail must never reach a saved file or the loader as a
// non-string, non-Blob value.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const pluginManagerSource = fs.readFileSync(
  path.join(__dirname, "../plugins/plugin-manager.js"),
  "utf8",
);
const projectFilesSource = fs.readFileSync(
  path.join(__dirname, "../plugins/core/project-files.js"),
  "utf8",
);
const plain = (value) => JSON.parse(JSON.stringify(value));

// Runs only installSerializedFieldPreservation from plugin-manager.js. The
// outer Object is passed in so plain test literals share the prototype the
// extracted code compares against.
function mediaHarness() {
  class Media {
    constructor() {
      this.properties = { name: "Media" };
      this.data = [];
    }
    async load(data) {
      data = await data;
      this.properties.name = data.properties.name;
      this.data = data.data;
      this.thumbnail = data.thumbnail;
    }
    toJSON() {
      return { data: this.data, properties: this.properties };
    }
  }
  class Layer {
    load() {}
    toJSON() { return {}; }
  }
  class Clip {
    load() {}
    toJSON() { return {}; }
  }
  const PZ = { layer: Layer, clip: Clip, media: Media };
  const start = pluginManagerSource.indexOf("  function installSerializedFieldPreservation() {");
  const end = pluginManagerSource.indexOf("  function installProjectPluginHooks() {", start);
  vm.runInNewContext(
    pluginManagerSource.slice(start, end) + "\ninstallSerializedFieldPreservation();",
    { PZ, cloneJson: plain, Object },
  );
  return PZ;
}

test("a Blob thumbnail from an import is never written back into media JSON", async () => {
  const PZ = mediaHarness();
  const media = new PZ.media();
  await media.load(Promise.resolve({
    properties: { name: "clip.mp4" },
    data: [],
    thumbnail: new Blob(["jpeg bytes"]),
  }));
  assert.equal("thumbnail" in plain(media.toJSON()), false);
  assert.equal(JSON.stringify(media.toJSON()).includes('"thumbnail"'), false);
});

test("a synchronous load does not keep a Blob thumbnail either", async () => {
  const PZ = mediaHarness();
  const media = new PZ.media();
  await media.load({
    properties: { name: "still.png" },
    data: [],
    thumbnail: new Blob(["png bytes"]),
  });
  assert.equal("thumbnail" in plain(media.toJSON()), false);
});

test("an already-broken thumbnail object from an old save is not re-emitted", async () => {
  const PZ = mediaHarness();
  const media = new PZ.media();
  await media.load(Promise.resolve({
    properties: { name: "old.mp4" },
    data: [],
    thumbnail: {},
  }));
  assert.equal("thumbnail" in plain(media.toJSON()), false);
});

test("plugin fields keep plain JSON values and drop non-JSON values", async () => {
  const PZ = mediaHarness();
  const media = new PZ.media();
  await media.load(Promise.resolve({
    properties: { name: "Plugin media", seed: 7, handle: new Blob(["x"]) },
    data: [],
    comp: { id: "comp-1" },
    pluginState: { mode: 2, nested: [1, "two", null] },
    liveHandle: new Blob(["y"]),
  }));
  const json = plain(media.toJSON());
  assert.deepEqual(json.comp, { id: "comp-1" });
  assert.deepEqual(json.pluginState, { mode: 2, nested: [1, "two", null] });
  assert.equal(json.properties.seed, 7);
  assert.equal("handle" in json.properties, false);
  assert.equal("liveHandle" in json, false);
});

// ---------------------------------------------------------------------------
// project-files.js: the sanitizer runs on save and before open/restore loads.

function projectFilesHarness({ archiveFiles = null } = {}) {
  const captured = [];
  class Archive {
    constructor() {
      this.files = [];
    }
    addFile(name, data) {
      this.files.push({ name, data });
    }
    addFileString(name, value) {
      this.addFile(name, new Blob([value]));
    }
    fileExists(name) {
      return this.files.some((entry) => entry.name === name);
    }
    peekFile(name) {
      return this.files.find((entry) => entry.name === name);
    }
    async untar() {
      this.files = (archiveFiles || []).map((entry) => ({ name: entry.name, data: new TextEncoder().encode(entry.text) }));
    }
    async tar() {
      captured.push(this);
      return new Blob([new Uint8Array([0x1f, 0x8b, 8, 0, 1])]);
    }
  }

  function Editor() {}
  Editor.prototype.confirmIfDirty = () => true;
  Editor.prototype.showFilePicker = () => {};

  const PZ = {
    archive: Archive,
    project: {
      // Mirrors CM3's PZ.project.save: JSON.stringify of a project whose media
      // carries a Blob thumbnail (what an import leaves behind).
      save(archive, project) {
        archive.addFile("meta", new Blob([JSON.stringify({ version: "1.0.102" })]));
        archive.addFile("project", new Blob([JSON.stringify({
          assets: {},
          media: project.media,
          sequence: {},
        })]));
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
    dispatchEvent() {},
    document: { body: { appendChild() {} }, createElement: () => ({ style: {}, click() {}, remove() {} }) },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
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
    URL: windowObject.URL,
    Uint8Array,
    window: windowObject,
  });
  vm.runInContext(projectFilesSource, context);
  return { PZ, projectFiles: PZ.zoidium.projectFiles, captured, Editor };
}

// Entries are bytes after an open (CM3 reads them with getFileString) and
// Blobs once materialized for tar; both must hold the same JSON text.
async function readProjectEntry(archive) {
  const entry = archive.peekFile("project");
  const bytes = entry.data instanceof Uint8Array
    ? entry.data
    : new Uint8Array(await entry.data.arrayBuffer());
  return JSON.parse(new TextDecoder().decode(bytes));
}

test("save never writes a non-string media thumbnail into the archive", async () => {
  const harness = projectFilesHarness();
  const editor = new harness.Editor();
  editor.project = {
    assets: { list: {} },
    media: [
      { properties: { name: "clip.mp4" }, thumbnail: new Blob(["jpeg"]) },
      { properties: { name: "kept.png" }, thumbnail: "https://example.test/thumb.jpg" },
      { properties: { name: "plain.png" } },
    ],
    sequence: {},
    ui: { dirty: true },
  };
  // The saved archive is the one CM3 serializes; JSON.stringify turns the Blob
  // into {}, which the sanitizer must remove before the archive is written.
  const result = await harness.projectFiles.createArchive(editor);
  assert.equal(result.blob.size > 0, true);
  const written = harness.captured[0];
  const document = await readProjectEntry(written);
  assert.equal(document.media.length, 3);
  assert.equal("thumbnail" in document.media[0], false);
  assert.equal(document.media[1].thumbnail, "https://example.test/thumb.jpg");
  assert.equal("thumbnail" in document.media[2], false);
});

test("open drops a broken thumbnail from an older save before CM3 loads it", async () => {
  const oldProject = {
    assets: {},
    sequence: {},
    media: [
      { properties: { name: "clip.mp4" }, data: [], assets: [], thumbnail: {} },
      { properties: { name: "kept.png" }, data: [], assets: [], thumbnail: "https://example.test/thumb.jpg" },
      { properties: { name: "plain.png" }, data: [], assets: [] },
      { properties: { name: "null.png" }, data: [], assets: [], thumbnail: null },
    ],
  };
  const harness = projectFilesHarness({
    archiveFiles: [
      { name: "meta", text: JSON.stringify({ version: "1.0.102" }) },
      { name: "project", text: JSON.stringify(oldProject) },
      { name: "zoidium.json", text: JSON.stringify({ version: 1, name: "old" }) },
    ],
  });
  const archive = await harness.projectFiles.openValidatedArchive(new Blob(["archive"]), "open");
  const document = await readProjectEntry(archive);
  assert.equal("thumbnail" in document.media[0], false);
  assert.equal(document.media[1].thumbnail, "https://example.test/thumb.jpg");
  assert.equal("thumbnail" in document.media[2], false);
  assert.equal("thumbnail" in document.media[3], false);
  // CM3's getFileString reads new Uint8Array(entry.data); a Blob would yield
  // an empty string and "Unexpected end of JSON input".
  const raw = new Uint8Array(archive.peekFile("project").data);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(raw)).media[0].properties, { name: "clip.mp4" });
  // The other media data is unchanged.
  assert.deepEqual(document.media[0].properties, { name: "clip.mp4" });
  assert.equal(archive.peekFile("zoidium.json") !== undefined, true);
});

test("sanitizer leaves a clean archive untouched and reports how many it removed", async () => {
  const cleanProject = { assets: {}, sequence: {}, media: [{ properties: { name: "a" }, data: [] }] };
  const harness = projectFilesHarness({
    archiveFiles: [
      { name: "meta", text: JSON.stringify({ version: "1.0.102" }) },
      { name: "project", text: JSON.stringify(cleanProject) },
    ],
  });
  const archive = new harness.PZ.archive();
  await archive.untar();
  const before = archive.peekFile("project");
  assert.equal(await harness.projectFiles.sanitizeProjectArchive(archive), 0);
  assert.equal(archive.peekFile("project"), before);
});

test("sanitizer does not repair unreadable project data (validation reports it)", async () => {
  const harness = projectFilesHarness({
    archiveFiles: [
      { name: "meta", text: JSON.stringify({ version: "1.0.102" }) },
      { name: "project", text: "{not json" },
    ],
  });
  const archive = new harness.PZ.archive();
  await archive.untar();
  assert.equal(await harness.projectFiles.sanitizeProjectArchive(archive), 0);
  await assert.rejects(
    () => harness.projectFiles.openValidatedArchive(new Blob(["archive"]), "open"),
    (error) => error.name === "ProjectDataError" && /not valid JSON/.test(error.message),
  );
});
