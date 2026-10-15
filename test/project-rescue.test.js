"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { createHarness } = require("./project-files.test.js");
const source = fs.readFileSync(path.join(__dirname, "../about/rescue/project-rescue.js"), "utf8");

// CM3's asset ID: the first 32 hex digits of SHA-256 read as little-endian words.
function cm3Id(text) {
  const digest = crypto.createHash("sha256").update(text).digest();
  const words = new Uint32Array(digest.buffer, digest.byteOffset, 8);
  return Array.from(words, (word) => word.toString(16).padStart(8, "0")).join("").slice(0, 32);
}

class Archive {
  constructor() { this.files = []; }
  addFile(name, data) { this.files.push({ name, data }); }
  peekFile(name) { return this.files.find((entry) => entry.name === name); }
}

function element(tag, page) {
  const node = {
    tag, style: {}, children: [], textContent: "", id: "",
    appendChild(child) { node.children.push(child); return child; },
    addEventListener() {},
    remove() {},
    dispatchEvent() {},
    click() { if (tag === "a") page.downloads.push({ name: node.download, blob: page.urls.get(node.href) }); },
  };
  return node;
}

function asset(text, filename, extra = {}) {
  const id = cm3Id(text);
  return { sha256: id, source: 1, external: false, filename, size: text.length, file: new Blob([text]), ...extra };
}

// A CM3-like page: project.toJSON mirrors { assets, media, sequence } and
// PZ.project.save mirrors CM3's JSON.stringify into "meta" and "project".
function createPage({ list = {}, sequence = { objects: [] }, media = [], editorExtra = {}, timeouts = {}, restore = null } = {}) {
  const page = { downloads: [], urls: new Map(), logs: [], warnings: [], errors: [] };
  const project = {
    assets: { list, toJSON() { return list; } },
    media, sequence, children: [],
    toJSON() { return { assets: this.assets, media: this.media, sequence: this.sequence }; },
  };
  for (const [key, value] of Object.entries(list)) {
    value.toJSON = function (name) {
      return name === key ? { sha256: this.sha256, source: this.source, external: this.external, size: this.size, filename: this.filename } : key;
    };
  }
  const PZ = {
    archive: Archive,
    project: { save(archive, value) {
      archive.addFile("meta", new Blob([JSON.stringify({ version: "1.0.102" })]));
      archive.addFile("project", new Blob([JSON.stringify(value)]));
    } },
    compatibility: { getCurrentVersion: () => "1.0.102" },
  };
  const documentElement = element("html", page);
  let url = 0;
  const window = {
    PZ, CM: { project, ...editorExtra },
    console: {
      log: (...args) => page.logs.push(args.join(" ")), warn: (...args) => page.warnings.push(args.join(" ")),
      error: (...args) => page.errors.push(args.join(" ")), table() {},
    },
    setTimeout: (callback, milliseconds) => {
      const timer = setTimeout(callback, timeouts[milliseconds] ?? milliseconds);
      // Object URLs are revoked after 10 minutes; do not hold the test open.
      if (milliseconds >= 600000) timer.unref();
      return timer;
    },
    clearTimeout, setInterval, clearInterval, performance,
    URL: { createObjectURL(blob) { const key = "blob:test/" + (url += 1); page.urls.set(key, blob); return key; }, revokeObjectURL() {} },
    document: {
      documentElement, body: documentElement,
      createElement: (tag) => element(tag, page), getElementById: () => null, querySelectorAll: () => [],
    },
    fetch: async (target) => {
      if (!page.urls.has(target)) throw new TypeError("Failed to fetch");
      return new Response(page.urls.get(target));
    },
    crypto: globalThis.crypto, indexedDB: restore,
    CompressionStream, DecompressionStream,
  };
  page.window = window;
  page.project = project;
  page.run = async () => {
    vm.runInNewContext(source, {
      window, Blob, Response, TextEncoder, TextDecoder, Uint8Array, Uint32Array, ArrayBuffer, MouseEvent: class {},
    });
    return window.PZRescue.done;
  };
  return page;
}

// Minimal gzip TAR reader for the produced files.
async function readPz(blob) {
  const tar = Buffer.from(await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = header.subarray(0, 100).toString().split("\0")[0];
    const size = parseInt(header.subarray(124, 136).toString().split("\0")[0], 8);
    entries.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return { entries, project: JSON.parse(entries.get("project").toString()), meta: JSON.parse(entries.get("meta").toString()) };
}

test("a healthy project is packaged with its assets and integrity data, then downloaded", async () => {
  const image = asset("image bytes", "photo.png");
  const page = createPage({ list: { [image.sha256]: image }, sequence: { objects: [{ type: "text", properties: { text: "hi" } }] } });
  const api = await page.run();
  assert.equal(api.best, "rescued");
  assert.deepEqual(Object.keys(api.outputs).sort(), ["json", "rescued"]);
  const pz = await readPz(api.outputs.rescued.blob);
  assert.equal(pz.meta.version, "1.0.102");
  assert.equal(pz.project.sequence.objects[0].properties.text, "hi");
  assert.equal(pz.entries.get(image.sha256).toString(), "image bytes");
  const metadata = JSON.parse(pz.entries.get("zoidium.json").toString());
  assert.equal(metadata.integrity[image.sha256].size, 11);
  assert.equal(page.downloads.length, 1);
  assert.match(page.downloads[0].name, /rescued\.pz$/);
  assert.equal(api.steps.every((record) => record.status === "ok"), true, JSON.stringify(api.steps));
});

test("one object whose toJSON throws is isolated instead of losing the project", async () => {
  const broken = { type: "plugin-layer", toJSON() { throw new Error("plugin exploded"); } };
  const keeper = { type: "text", properties: { text: "kept" } };
  const page = createPage({ sequence: { objects: [keeper, broken, { type: "glitch", properties: { amount: 1 }, toJSON() { throw new Error("half broken"); } }] } });
  const api = await page.run();
  const pz = await readPz(api.outputs.rescued.blob);
  assert.deepEqual(pz.project.sequence.objects.map((object) => object.type), ["text", "glitch"]);
  assert.equal(pz.project.sequence.objects[1].properties.amount, 1);
  assert.ok(api.issues.some((entry) => /plugin exploded.*left out/.test(entry.text)));
  assert.ok(api.steps.find((record) => /PZ\.project\.save/.test(record.step)).status === "FAILED");
});

test("a stale node image selection gets a repaired copy and an untouched raw copy", async () => {
  const missing = "ab116c5d984be6edf981692f9271b981";
  const material = { type: "nodes", properties: { nodeImage: missing, graph: JSON.stringify({ nodes: [] }) } };
  const used = { type: "nodes", properties: { nodeImage: missing, graph: JSON.stringify({ nodes: [{ asset: missing }] }) } };
  const page = createPage({ sequence: { objects: [{ material }, { material: used }] } });
  const before = JSON.stringify(page.project);
  const api = await page.run();
  assert.equal(api.best, "repaired");
  const repaired = await readPz(api.outputs.repaired.blob);
  const raw = await readPz(api.outputs.raw.blob);
  assert.equal(repaired.project.sequence.objects[0].material.properties.nodeImage, null);
  assert.equal(repaired.project.sequence.objects[1].material.properties.nodeImage, missing, "a graph that uses the ID keeps it");
  assert.equal(raw.project.sequence.objects[0].material.properties.nodeImage, missing);
  assert.equal(JSON.stringify(page.project), before, "the live project is unchanged");
  assert.ok(api.diagnosis.some((text) => /missing assets/.test(text)));
});

test("unreadable files fall back to the in-page blob URL, and missing bytes are reported", async () => {
  const video = asset("video bytes", "clip.mp4");
  const gone = asset("never read", "gone.png");
  const page = createPage({ list: { [video.sha256]: video, [gone.sha256]: gone } });
  video.url = page.window.URL.createObjectURL(new Blob(["video bytes"]));
  video.file = { size: 11, arrayBuffer: () => Promise.reject(Object.assign(new Error("file moved"), { name: "NotReadableError" })) };
  gone.file = null;
  const api = await page.run();
  const pz = await readPz(api.outputs.rescued.blob);
  assert.equal(pz.entries.get(video.sha256).toString(), "video bytes");
  assert.equal(pz.entries.has(gone.sha256), false);
  assert.equal(api.assets.find((entry) => entry.filename === "gone.png").status, "MISSING");
  assert.ok(api.issues.some((entry) => /gone\.png.*Locate/.test(entry.text)));
});

test("a hanging serializer is reported as STUCK and the fallback still rescues the project", async () => {
  const page = createPage({
    sequence: { objects: [{ type: "text", properties: { text: "after hang" } }] },
    editorExtra: { _zoidiumSavePromise: new Promise(() => {}) },
    timeouts: { 60000: 200 },
  });
  page.window.PZ.project.save = () => new Promise(() => {});
  const api = await page.run();
  assert.equal(api.steps.find((record) => /PZ\.project\.save/.test(record.step)).status, "STUCK");
  assert.ok(page.errors.some((line) => /STUCK at "Serialize with CM3/.test(line)));
  assert.ok(api.diagnosis.some((text) => /previous Save has never finished/.test(text)));
  assert.equal((await readPz(api.outputs.rescued.blob)).project.sequence.objects[0].properties.text, "after hang");
});

test("without an editor it names the failed step and still lists and rebuilds restore points", async () => {
  const image = asset("restored image", "r.png");
  const stream = (entries) => {
    const parts = [];
    for (const [name, text] of entries) {
      const header = new Uint8Array(512);
      header.set(new TextEncoder().encode(name));
      header.set(new TextEncoder().encode(text.length.toString(8).padStart(11, "0") + "\0"), 124);
      header[156] = 48;
      parts.push(header, new TextEncoder().encode(text), new Uint8Array((512 - text.length % 512) % 512));
    }
    parts.push(new Uint8Array(1024));
    return new Response(new Blob(parts).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  };
  const projectBlob = await stream([["meta", "{\"version\":\"1.0.102\"}"], ["project", "{\"assets\":{},\"media\":[],\"sequence\":{}}"]]);
  const records = {
    snapshots: [{ id: "p1", projectName: "Saved", createdAt: 2, projectBlob, assetRefs: [{ id: "a1", name: image.sha256 }] },
      { id: "__zoidium_restore_writer_lease__", expiresAt: Date.now() + 60000 }],
    assets: { a1: { id: "a1", blob: new Blob(["restored image"]) } },
  };
  const request = (result) => { const value = { result }; setTimeout(() => value.onsuccess && value.onsuccess()); return value; };
  const database = {
    close() {},
    transaction: (store) => ({ objectStore: () => ({
      getAll: () => request(records[store]),
      get: (id) => request(records[store][id]),
    }) }),
  };
  const indexedDB = {
    databases: async () => [{ name: "zoidium-restore-points" }],
    open() { const value = request(database); return value; },
  };
  const page = createPage({ restore: indexedDB });
  delete page.window.CM;
  const api = await page.run();
  assert.equal(api.steps[0].status, "FAILED");
  assert.ok(page.errors.some((line) => /No \.pz file could be built\. Stuck at "Find the open editor/.test(line)));
  assert.equal(api.restorePointList.length, 1);
  assert.ok(api.diagnosis.some((text) => /write lock/.test(text)));
  await api.downloadRestorePoint(0);
  const pz = await readPz(page.downloads.at(-1).blob);
  assert.equal(pz.entries.get(image.sha256).toString(), "restored image");
  assert.match(page.downloads.at(-1).name, /^Saved-restore-point-/);
});

test("the rescued files pass Zoidium's own open validator, and its saver is diagnosed", async () => {
  const harness = createHarness();
  const image = asset("validated image", "v.png");
  const missing = "ab116c5d984be6edf981692f9271b981";
  const page = createPage({
    list: { [image.sha256]: image },
    sequence: { objects: [{ type: "nodes", properties: { nodeImage: missing, graph: "{\"nodes\":[]}" } }] },
  });
  const save = page.window.PZ.project.save;
  page.window.PZ = harness.PZ;
  harness.PZ.project.save = save;
  const api = await page.run();
  assert.equal(api.outputs.repaired.validator, "accepted");
  assert.equal(api.outputs.raw.validator, "accepted");
  assert.ok(api.outputs.zoidium, "Zoidium's saver works from the Console in this page");
  assert.ok(api.diagnosis.some((text) => /Save button flow/.test(text)));
  const zoidium = await readPz(api.outputs.zoidium.blob);
  assert.equal(zoidium.entries.get(image.sha256).toString(), "validated image");
});

// Runs about/rescue/rescue-page.js against a fake help page and returns the
// bookmarklet URL it builds from the served script.
async function buildBookmarklet() {
  const elements = new Map();
  const make = (id) => {
    const node = {
      id, dataset: {}, hidden: id === "rescue-opener", disabled: true, href: "#", textContent: "", value: "",
      classList: { remove() {}, toggle() {} }, listeners: {},
      addEventListener(type, listener) { node.listeners[type] = listener; },
      removeAttribute() {}, select() {},
    };
    elements.set(id, node);
    return node;
  };
  ["rescue-tool", "rescue-bookmarklet", "rescue-status", "rescue-copy", "rescue-opener", "rescue-source"].forEach(make);
  elements.get("rescue-tool").dataset = { ready: "ready {size}", dragHint: "drag", loadFailed: "failed" };
  let served = null;
  const window = {
    document: { getElementById: (id) => elements.get(id) || null },
    fetch: async (url) => { served = url; return new Response(source); },
    navigator: {}, opener: null,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../about/rescue/rescue-page.js"), "utf8"), { window });
  for (let index = 0; index < 20 && elements.get("rescue-bookmarklet").href === "#"; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { href: elements.get("rescue-bookmarklet").href, elements, served };
}

test("the help page bookmarklet carries the whole rescue tool and rescues a project", async () => {
  const { href, elements, served } = await buildBookmarklet();
  assert.equal(served, "/about/rescue/project-rescue.js");
  assert.match(href, /^javascript:void function\(\)\{/);
  // A URL parser drops raw newlines and tabs, and "#" would start a fragment.
  assert.doesNotMatch(href, /[\n\r\t#]/);
  assert.ok(href.length < source.length, "comment lines and indentation are removed");
  // Firefox does not store bookmark URLs of 64 KB or more.
  assert.ok(href.length < 64000, "bookmarklet is " + href.length + " characters");
  assert.match(elements.get("rescue-status").textContent, /^ready \d+ KB$/);
  let prevented = false;
  elements.get("rescue-bookmarklet").listeners.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true, "clicking it on the help page does not run it there");

  const image = asset("bookmarklet image", "b.png");
  const page = createPage({ list: { [image.sha256]: image }, sequence: { objects: [{ type: "text", properties: { text: "via bookmark" } }] } });
  // Browsers percent-decode a javascript: URL before running it.
  const result = vm.runInNewContext(decodeURIComponent(href.slice("javascript:".length)), { window: page.window, Blob, Response, TextEncoder, TextDecoder, Uint8Array, Uint32Array, ArrayBuffer, MouseEvent: class {} });
  assert.equal(result, undefined, "a bookmarklet must evaluate to undefined or the page is replaced");
  const api = await page.window.PZRescue.done;
  const pz = await readPz(api.outputs.rescued.blob);
  assert.equal(pz.project.sequence.objects[0].properties.text, "via bookmark");
  assert.equal(pz.entries.get(image.sha256).toString(), "bookmarklet image");
});
