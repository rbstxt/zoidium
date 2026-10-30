"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createLoader, createEngine, openAsset } = require("../plugins/shape-plus/text-engine");
const root = path.resolve(__dirname, "..");
const bytes = fs.readFileSync(path.join(__dirname, "fixtures/shape-text/RobotoFlex-subset.ttf"));
const buffer = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
function loader() {
  return createLoader((type, name) => fs.readFileSync(path.join(root, name), "utf8"), name => require("../plugins/shape-plus/" + name));
}

test("text engine compiles lazily, shares initialization, and retries missing assets", async () => {
  let reads = 0;
  const load = createLoader(() => { reads++; return null; });
  assert.equal(reads, 0);
  await assert.rejects(load(), /missing from the bundle/);
  await assert.rejects(load(), /missing from the bundle/);
  assert.equal(reads, 2);
  const ready = loader();
  assert.equal(ready(), ready());
  await ready();
});

test("gvar outlines and advances are deterministic across axis changes and reloads", async () => {
  const engine = await loader()(), font = engine.open(buffer(), "font-ref");
  assert.ok(font.axes.wght);
  assert.ok(font.axes.wdth);
  const thin = font.shape("AV office", { wght: 100, wdth: 75 });
  const heavy = font.shape("AV office", { wght: 900, wdth: 125 });
  const before = font.outline(thin[0].g, { wght: 100 });
  assert.notDeepEqual(before, font.outline(thin[0].g, { wght: 900 }));
  assert.notDeepEqual(thin, heavy);
  assert.deepEqual(font.shape("AV office", { wght: 100, wdth: 75 }), thin);
  assert.equal(font.outline(thin[0].g, { wght: 100 }), before);
  assert.equal(font.reference, "font-ref");
  assert.equal(font.coordinates({ wght: Infinity }).wght, font.axes.wght.default);
  assert.equal(font.coordinates({ wght: -100 }).wght, font.axes.wght.min);
  const other = engine.open(buffer(), "font-ref");
  assert.deepEqual(other.outline(thin[0].g, { wght: 100 }), before);
  other.dispose(); font.dispose(); font.dispose();
  assert.equal(engine.stats().outlineEntries, 0);
  assert.throws(() => font.shape("A"), /released/);
});

test("GPOS kerning, ligatures, combining marks and unsupported glyphs remain explicit", async () => {
  const engine = await loader()(), font = engine.open(buffer(), "fixture");
  const width = glyphs => glyphs.reduce((sum, glyph) => sum + glyph.ax, 0);
  assert.ok(width(font.shape("AV")) < width(font.shape("A")) + width(font.shape("V")));
  assert.ok(font.shape("office").length < "office".length);
  assert.ok(font.shape("a\u0301").every(glyph => glyph.g > 0));
  const marks = font.shape("a\u0301\u0301");
  assert.ok(marks.at(-1).dy > 0); assert.equal(marks.at(-1).ax, 0);
  assert.equal(font.shape("\u65e5")[0].g, 0);
  font.dispose();
});

test("outline LRU evicts within its byte budget and releases per font", async () => {
  const hb = require("../plugins/shape-plus/vendor/harfbuzz-api");
  const factory = require("../plugins/shape-plus/vendor/harfbuzz");
  const binary = Buffer.from(fs.readFileSync(path.join(root, "plugins/shape-plus/vendor/harfbuzz.wasm.base64"), "utf8"), "base64");
  const engine = createEngine(hb(await factory({ wasmBinary: binary })), () => 0, 12000);
  const font = engine.open(buffer(), "fixture");
  for (let wght = 100; wght <= 900; wght += 10) {
    for (const glyph of font.shape("AVoffice")) font.outline(glyph.g, { wght });
    assert.ok(engine.stats().outlineBytes <= 12000);
  }
  assert.ok(engine.stats().outlineEntries < 10);
  font.dispose();
  assert.equal(engine.stats().outlineBytes, 0);
});

test("missing assets and compressed or corrupt font bytes produce explicit states", async () => {
  const engine = await loader()();
  assert.equal((await openAsset(engine, null, "missing-ref")).state, "missing");
  const compressed = new ArrayBuffer(12);
  new DataView(compressed).setUint32(0, 0x774f4632);
  const error = await openAsset(engine, { asset: { file: { arrayBuffer: async () => compressed } } }, "compressed-ref");
  assert.equal(error.state, "error");
  assert.match(error.message, /Unsupported font format/);
  assert.throws(() => engine.open(new ArrayBuffer(12)), /not supported/);
  const ready = await openAsset(engine, { asset: {}, readFileRemote: async () => buffer() }, "remote-ref");
  assert.equal(ready.state, "ready"); ready.font.dispose();
});

test("CFF2 outlines apply variations in font units", async () => {
  const file = fs.readFileSync(path.join(__dirname, "fixtures/shape-text/CFF2-test.otf"));
  const engine = await loader()(), font = engine.open(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "cff2");
  const glyph = font.shape("A")[0].g;
  assert.ok(glyph > 0);
  assert.notDeepEqual(font.outline(glyph, { wght: 200 }), font.outline(glyph, { wght: 900 }));
  assert.deepEqual(font.outline(glyph, { wght: 200 }), font.outline(glyph, { wght: 200 }));
  font.dispose();
});

test("named instances, Japanese primary font and explicit grapheme fallback", async () => {
  const { shapeRuns, clusters } = require("../plugins/shape-plus/text-shaping");
  const engine = await loader()(), primary = engine.open(buffer(), "latin");
  assert.ok(primary.instances.length > 0);
  assert.ok(primary.family.length > 0);
  const file = fs.readFileSync(path.join(__dirname, "fixtures/shape-text/NotoSansJP-subset.ttf"));
  const jp = engine.open(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "jp");
  assert.ok(shapeRuns(jp, null, "ABC日本語").every(g => g.g > 0));
  const mixed = shapeRuns(primary, jp, "AV日本語");
  assert.equal(mixed[0].font, primary); assert.equal(mixed.at(-1).font, jp);
  assert.ok(mixed.every(g => g.g > 0));
  assert.equal(clusters("a\u0301").length, 1);
  assert.equal(shapeRuns(primary, null, "日")[0].g, 0);
  primary.dispose(); jp.dispose();
});

test("WOFF1 decompression preserves variable font shaping and outlines", async () => {
  const { deflateSync } = require("node:zlib"), { decompress } = require("../plugins/shape-plus/text-font");
  const raw = buffer(), view = new DataView(raw), count = view.getUint16(4), tables = [];
  let size = 44 + count * 20;
  for (let i=0;i<count;i++) {
    const p=12+i*16, offset=view.getUint32(p+8), length=view.getUint32(p+12);
    const original=Buffer.from(raw,offset,length), compressed=deflateSync(original), data=compressed.length<length?compressed:original;
    tables.push({p,length,data,offset:size});size+=(data.length+3)&~3;
  }
  const woff=new ArrayBuffer(size), out=new DataView(woff);
  out.setUint32(0,0x774f4646);out.setUint32(4,view.getUint32(0));out.setUint32(8,size);out.setUint16(12,count);out.setUint32(16,raw.byteLength);
  for(const [i,t]of tables.entries()) {
    const p=44+i*20;out.setUint32(p,view.getUint32(t.p));out.setUint32(p+4,t.offset);out.setUint32(p+8,t.data.length);out.setUint32(p+12,t.length);out.setUint32(p+16,view.getUint32(t.p+4));new Uint8Array(woff,t.offset,t.data.length).set(t.data);
  }
  const engine=await loader()(), a=engine.open(raw,"ttf"), b=engine.open(await decompress(woff),"woff");
  assert.deepEqual(a.shape("AV office",{wght:700}),b.shape("AV office",{wght:700}));
  const glyph=a.shape("A")[0].g;assert.deepEqual(a.outline(glyph,{wght:700}),b.outline(glyph,{wght:700}));a.dispose();b.dispose();
});
