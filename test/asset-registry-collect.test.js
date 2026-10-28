"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const zlib = require("node:zlib");
const { createHash, webcrypto } = require("node:crypto");
const { retainedFixture } = require("./asset-retention-fixture.js");

// Reads a stored (uncompressed) ZIP through its central directory.
function readZip(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const end = buffer.byteLength - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, "end of central directory");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    assert.equal(view.getUint16(offset + 8, true) & 0x0800, 0x0800, "UTF-8 names");
    assert.equal(view.getUint16(offset + 10, true), 0, "stored");
    const crc = view.getUint32(offset + 16, true), size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), local = view.getUint32(offset + 42, true);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = buffer.subarray(start, start + size);
    assert.equal(zlib.crc32(data), crc, "CRC of " + name);
    entries.set(name, data.toString("utf8"));
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return entries;
}

function owner(f, name, key) {
  const prop = new f.Property("Image", key, 8, f.PZ.asset.type.IMAGE);
  f.properties(f.child(f.project.sequence, new f.Obj(name)), { image: prop });
  return prop;
}

test("Collect Files zips every attached file in its panel folders and reports missing files", async () => {
  const f = retainedFixture();
  const a = await f.add("logo.png", "image/png", "first bytes");
  const b = await f.add("logo.png", "image/png", "other bytes");
  const c = await f.add("Logo.PNG", "image/png", "third bytes");
  const clip = await f.add("clip.mp4", "video/mp4", "video bytes");
  f.project.assets.list.lost = { key: "lost", filename: "lost.png", source: 1, file: null, url: null, data: new Map(), references: 1 };
  owner(f, "Layer", "lost");
  owner(f, "Other", a.key);
  const footage = f.api.createFolder("Footage"), stills = f.api.createFolder("Stills: old", footage);
  f.api.moveItems([a.key, b.key, c.key], stills);
  f.api.moveItems([clip.key], footage);
  const result = await f.api.collectFiles({ name: "My project" });
  assert.equal(result.ok, true);
  assert.equal(result.filename, "My project folder.zip");
  assert.equal(result.blob.type, "application/zip");
  const entries = readZip(Buffer.from(await result.blob.arrayBuffer()));
  assert.deepEqual(Array.from(entries.keys()).sort(), [
    "Collect Files Report.txt",
    "Footage/",
    "Footage/Stills_ old/",
    "Footage/Stills_ old/Logo (3).PNG",
    "Footage/Stills_ old/logo (2).png",
    "Footage/Stills_ old/logo.png",
    "Footage/clip.mp4",
  ]);
  assert.equal(entries.get("Footage/Stills_ old/logo.png"), "first bytes");
  assert.equal(entries.get("Footage/Stills_ old/logo (2).png"), "other bytes");
  assert.equal(entries.get("Footage/Stills_ old/Logo (3).PNG"), "third bytes");
  assert.equal(entries.get("Footage/clip.mp4"), "video bytes");
  assert.deepEqual(JSON.parse(JSON.stringify(result.missing.map(entry => [entry.name, entry.uses]))), [["lost.png", 1]]);
  const report = entries.get("Collect Files Report.txt");
  assert.match(report, /Collected 4 files/);
  assert.match(report, /Missing items: 1/);
  assert.match(report, /lost\.png {2}\(used 1 time\)/);
  // Collecting changes nothing in the project.
  assert.equal(f.editor.history.undoStack.length, 4);
});

test("Collect Files tooltip describes root files and Assets window folders without a new Assets directory", async () => {
  const { createActions } = require("../plugins/asset-manager/assets-actions.js");
  const f = retainedFixture();
  await f.add("one.txt", "text/plain", "one");
  const command = createActions({ document: {}, registry: () => f.api }).collectCommand(f.api.snapshot());
  assert.equal(command.hint, "Download a ZIP with available files in the Assets window's folder structure and a missing-file report");
  const result = await f.api.collectFiles();
  const entries = readZip(Buffer.from(await result.blob.arrayBuffer()));
  assert.deepEqual(Array.from(entries.keys()), ["one.txt", "Collect Files Report.txt"]);
  assert.equal(entries.get("one.txt"), "one");
});

test("identical archives come out for the same files", async () => {
  const f = retainedFixture();
  await f.add("a.png", "image/png", "aaa");
  const first = Buffer.from(await (await f.api.collectFiles({ name: "p" })).blob.arrayBuffer());
  const second = Buffer.from(await (await f.api.collectFiles({ name: "p" })).blob.arrayBuffer());
  assert.deepEqual(first, second);
});

test("Collect Files keeps an existing collision-free archive byte-identical", async () => {
  const f = retainedFixture();
  try {
    await f.add("root.txt", "text/plain", "root");
    const clip = await f.add("clip.txt", "text/plain", "clip");
    const footage = f.api.createFolder("Footage");
    const nested = f.api.createFolder("Nested", footage);
    f.api.moveItems([clip.key], nested);
    const result = await f.api.collectFiles({ name: "Stable project" });
    assert.equal(result.ok, true);
    const bytes = Buffer.from(await result.blob.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"),
      "21c5343ff7ad7e66fcebba6635a91f57e0d2c256c85cef6589539cb835f40da0");
  } finally { f.api.dispose(); }
});

test("Collect Files preserves archive bytes when a missing file shares an attached file name", async () => {
  const f = retainedFixture();
  try {
    f.project.assets.list.lost = { key: "lost", filename: "same.png", source: 1,
      file: null, url: null, data: new Map(), references: 1 };
    owner(f, "Layer", "lost");
    const file = await f.add("same.png", "image/png", "attached");
    const footage = f.api.createFolder("Footage");
    f.api.moveItems(["lost", file.key], footage);
    const result = await f.api.collectFiles({ name: "Stable missing" });
    assert.equal(result.ok, true);
    const bytes = Buffer.from(await result.blob.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"),
      "dc4b3bfcb849db7485a9929eb525f2c76d0c6231baa7b1225ae99fc74dc93ffd");
  } finally { f.api.dispose(); }
});

test("Collect Files shares case-insensitive names between folders, files, and the report", async () => {
  const f = retainedFixture();
  try {
    await f.add("footage", "text/plain", "root file");
    const child = await f.add("clip.txt", "text/plain", "child file");
    const nestedFile = await f.add("NESTED", "text/plain", "nested file");
    const reportChild = await f.add("notes.txt", "text/plain", "report child");
    const footage = f.api.createFolder("Footage");
    const reportFolder = f.api.createFolder("collect files report.TXT");
    f.project.assets.list.lost = { key: "lost", filename: "lost.png", source: 1,
      file: null, url: null, data: new Map(), references: 1 };
    owner(f, "Missing", "lost");
    const nested = f.api.createFolder("Nested", footage);
    f.api.moveItems([nestedFile.key], footage);
    f.api.moveItems([child.key], nested);
    f.api.moveItems([reportChild.key, "lost"], reportFolder);
    const result = await f.api.collectFiles();
    assert.equal(result.ok, true);
    const entries = readZip(Buffer.from(await result.blob.arrayBuffer()));
    const names = Array.from(entries.keys());
    const normalized = names.map(name => name.replace(/\/$/, "").toLowerCase());
    assert.equal(new Set(normalized).size, names.length, "files and directories must coexist on extraction");
    assert.equal(entries.get("footage (2)"), "root file");
    assert.equal(entries.get("Footage/NESTED (2)"), "nested file");
    assert.equal(entries.get("Footage/Nested/clip.txt"), "child file");
    assert.equal(entries.get("collect files report (2).TXT/notes.txt"), "report child");
    assert.equal(result.missing[0].path, "collect files report (2).TXT/lost.png");
    assert.ok(result.report.includes("  " + result.missing[0].path + "  ("));
    for (const item of result.collected) {
      assert.ok(entries.has(item.path));
      assert.ok(result.report.includes("  " + item.path + "  ("));
    }
  } finally { f.api.dispose(); }
});

function presetFixture() {
  const f = retainedFixture();
  f.sandbox.crypto = webcrypto;
  // Preset export resolves URLs; keep the fixture's Blob URL bookkeeping.
  const blobUrls = f.sandbox.URL;
  f.sandbox.URL = class extends URL {
    static createObjectURL(file) { return blobUrls.createObjectURL(file); }
    static revokeObjectURL(url) { return blobUrls.revokeObjectURL(url); }
  };
  const served = new Map();
  f.sandbox.fetch = async url => {
    const bytes = served.get(url);
    return bytes ? { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(bytes).buffer } : { ok: false, status: 404 };
  };
  function preset(url, bytes) {
    served.set(url.slice(1), bytes);
    return f.project.assets.list[url] = { key: url, url, filename: "", source: 3, file: null, data: new Map(), references: 1, mediaReferences: 0 };
  }
  return { ...f, preset };
}

test("Consolidate merges a file into the built-in preset with the same bytes in one undo step", async () => {
  const f = presetFixture();
  const preset = f.preset("/assets/textures/particles/circle_soft.png", "circle bytes");
  const file = await f.add("circle_soft.png", "image/png", "circle bytes");
  const other = await f.add("other.png", "image/png", "different!!!");
  const usesPreset = owner(f, "Particles", preset.key);
  const usesFile = owner(f, "Layer", file.key);
  owner(f, "Other", other.key);
  const before = f.editor.history.undoStack.length;
  const result = await f.api.consolidate();
  assert.equal(result.ok, true);
  assert.equal(result.consolidated, 1);
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(result.groups.map(group => [group.keep.id, group.merged.map(item => item.id)])), [[preset.key, [file.key]]]);
  assert.deepEqual(plain(result.removed.map(item => item.id)), [file.key]);
  assert.equal(usesFile.get(), preset.key);
  assert.equal(usesPreset.get(), preset.key);
  assert.equal(f.project.assets.list[file.key], undefined);
  assert.equal(f.editor.history.undoStack.length, before + 1, "one undo step");
  f.editor.history.undo();
  assert.equal(usesFile.get(), file.key);
  assert.equal(f.project.assets.list[file.key], file);
  f.editor.history.redo();
  assert.equal(usesFile.get(), preset.key);
});

test("Consolidate without duplicates changes nothing", async () => {
  const f = presetFixture();
  const preset = f.preset("/assets/textures/a.png", "preset bytes");
  const file = await f.add("b.png", "image/png", "file bytes!!");
  owner(f, "A", preset.key); owner(f, "B", file.key);
  const before = f.editor.history.undoStack.length;
  const result = await f.api.consolidate();
  assert.deepEqual({ ok: result.ok, consolidated: result.consolidated }, { ok: true, consolidated: 0 });
  assert.equal(f.editor.history.undoStack.length, before);
});
