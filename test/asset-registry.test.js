"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");

const { fixture } = require("./asset-registry-fixture.js");
const plain = value => JSON.parse(JSON.stringify(value));
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("nested groups and plugin child categories report authored property paths", () => {
  const f = fixture(); f.asset("image");
  const clip = f.child(f.project.sequence, new f.Clip("V2 Text"));
  const group = f.child(clip, new f.Obj("Group"));
  const form = f.child(group, new f.Obj("Form"));
  const instance = f.child(form, new f.Obj("Form 1"));
  const list = f.properties(instance, {});
  f.category(list, "particle", { texture: new f.Property("Texture", "image") });
  f.category(list, "layerMaps", { map: new f.Property("Color map", "image") });
  const particular = f.child(group, new f.Obj("Particular"));
  f.category(f.properties(f.child(particular, new f.Obj("System 2")), {}), "audio", { audio: new f.Property("Audio", "image") });
  const item = f.api.snapshot().items[0];
  assert.equal(item.usages.length, 3);
  assert.deepEqual(plain(item.usages[0].path), ["V2 Text", "Group", "Form", "Form 1", "Particle", "Texture"]);
  assert.ok(item.usages.every(u => u.address && u.revealable && u.frame === null));
});

test("asset keyframes record distinct values with their first authored frame", () => {
  const f = fixture(); f.asset("a"); f.asset("b");
  const property = new f.Property("Texture", null);
  property.keyframes = [{ value: "a", frame: 0 }, { value: "b", frame: 10 }, { value: "a", frame: 20 }, { value: null, frame: 30 }];
  f.properties(f.child(f.project.sequence, new f.Obj("Image")), { texture: property });
  const snapshot = f.api.snapshot();
  assert.equal(snapshot.counts.used, 2);
  assert.deepEqual(plain(snapshot.items.map(i => i.usages.map(u => [u.kind, u.frame]))), [[["keyframe", 0]], [["keyframe", 10]]]);
});

test("geometry assetType quirk is inferred from its property", () => {
  const f = fixture(); f.asset("mesh", { filename: "mesh.json", file: { size: 1, type: "application/json" } });
  f.properties(f.child(f.project.sequence, new f.Obj("Shape")), { customGeometry: new f.Property("Custom geometry", "mesh") });
  assert.equal(f.api.snapshot().items[0].kind, "geometry");
});

test("Media holds mark imported footage without becoming authored usages", () => {
  const f = fixture(), asset = f.asset("a");
  asset.references = 200; asset.mediaReferences = 7;
  f.project.media.push({ assets: [asset] });
  const item = f.api.snapshot().items[0];
  assert.equal(item.inMedia, true); assert.equal(item.usages.length, 0);
  assert.equal(item.asset, asset); assert.equal(Object.keys(item).includes("asset"), false);
  assert.equal(asset.references, 200); assert.equal(asset.mediaReferences, 7);
});

test("closed Precomp+ and stored Main usages exclude the stale open snapshot", () => {
  const f = fixture(); f.asset("a");
  f.properties(f.child(f.project.sequence, new f.Clip("Live Intro")), { image: new f.Property("Image", "a") });
  const stored = [{ clips: [{ properties: { name: "V1 Logo" }, object: { type: 2, compId: "intro", properties: { image: "a" } } }] }];
  f.PZ.precomp = { entries: () => [{ id: "main", name: "Main", isMain: true, length: 50 }, { id: "intro", name: "Intro", length: 50 }],
    referenceSources: () => [{ id: "main", name: "Main", tracks: stored, editing: false }, { id: "intro", name: "Intro", tracks: stored, editing: true }] };
  const snapshot = f.api.snapshot();
  const item = snapshot.items.find(i => i.id === "a");
  assert.equal(item.usages.length, 2);
  assert.deepEqual(plain(item.usages[1].path), ['Comp "Main"', "V1 Logo", "Image"]);
  assert.equal(item.usages[1].composition.id, "main"); assert.equal(f.api.reveal(item.usages[1]), false);
  assert.equal(snapshot.items.find(i => i.id === "comp:intro").usages.length, 1);
});

test("live composition placements preserve the placement path", () => {
  const f = fixture();
  const clip = f.child(f.project.sequence, new f.Clip("Intro placement"));
  const layer = f.child(clip, new f.Obj()); layer.type = 2; layer.compId = "intro";
  f.PZ.precomp = { entries: () => [{ id: "intro", name: "Intro", length: 60 }] };
  const usage = f.api.snapshot().items[0].usages[0];
  assert.deepEqual(plain(usage.path), ["Intro placement"]); assert.equal(usage.kind, "composition");
});

test("Material+ graph adapter reports each node and excludes the UI mirror", () => {
  const f = fixture(); f.asset("a");
  const material = f.child(f.project.sequence, new f.Obj("Node Material"));
  f.properties(material, { graph: new f.Property("Graph", JSON.stringify({ nodes: [{ id: "one", params: { asset: "a" } }, { id: "two", params: { asset: "a" } }] }), 7),
    nodeImage: new f.Property("Selected node image", "a") });
  const dispose = f.adapter("material-plus");
  const usages = f.api.snapshot().items[0].usages;
  assert.equal(usages.length, 2); assert.equal(usages[0].plugin, "material-plus/graph-images");
  assert.equal(usages[1].kind, "plugin"); assert.ok(usages[1].path.at(-1).includes("two"));
  dispose(); f.flush(); assert.equal(f.api.snapshot().items[0].usages.length, 0);
});

test("Material+ graph adapter reads JSON strings in closed compositions", () => {
  const f = fixture(); f.asset("a");
  f.PZ.precomp = { referenceSources: () => [{ id: "intro", name: "Intro", tracks: [{ properties: { name: "Node Material", graph: JSON.stringify({ nodes: [{ id: 1, params: { asset: "a" } }] }) } }] }] };
  f.adapter("material-plus");
  const usage = f.api.snapshot().items[0].usages[0];
  assert.equal(usage.composition.id, "intro"); assert.equal(usage.revealable, false); assert.equal(usage.kind, "plugin");
});

test("IES adapter deduplicates embedded bytes and preserves each owner", () => {
  const f = fixture();
  for (const name of ["Left", "Right"]) {
    const light = f.child(f.project.sequence, new f.Obj(name));
    f.properties(light, { iesData: new f.Property("IES Data", "IESNA:LM-63-2002\nTILT=NONE", 7), iesFilename: new f.Property("IES File", "spot.ies", 7) });
  }
  const dispose = f.adapter("trapcode-suite");
  const item = f.api.snapshot().items[0];
  assert.match(item.id, /^ies:[0-9a-f]{16}$/); assert.equal(item.kind, "ies"); assert.equal(item.source, "embedded");
  assert.equal(item.name, "spot.ies"); assert.equal(item.usages.length, 2); assert.equal(item.key, null);
  dispose(); f.flush(); assert.equal(f.api.snapshot().items.length, 0);
});

test("unused built-ins are hidden; missing files and used failed presets are problems", () => {
  const f = fixture(); f.asset("absent", { file: null });
  const preset = f.asset("preset", { source: 3, filename: "", file: null, url: "/assets/fonts/Roboto.json" });
  preset.data.set(f.PZ.asset.font, { zoidiumFont3dState: "failed", zoidiumFont3dError: { message: "Invalid font metrics." } });
  // An unused built-in is an internal dependency and is not listed at all.
  assert.deepEqual([...f.api.snapshot().items.map(item => item.id)], ["absent"]);
  f.properties(f.child(f.project.sequence, new f.Obj("Text")), { font: new f.Property("Font", "preset") });
  f.api.refresh();
  const snapshot = f.api.snapshot();
  assert.equal(snapshot.items[0].status, "missing"); assert.equal(snapshot.items[1].status, "failed");
  assert.equal(snapshot.items[1].name, "Roboto"); assert.equal(snapshot.items[1].kind, "font");
  assert.equal(snapshot.counts.problems, 2);
});

test("used failed fonts report the core loader reason", () => {
  const f = fixture(), asset = f.asset("font");
  asset.data.set(f.PZ.asset.font, { zoidiumFont3dState: "failed", zoidiumFont3dError: { message: "Invalid font." } });
  f.properties(f.child(f.project.sequence, new f.Obj("Text")), { font: new f.Property("Font", "font") });
  const snapshot = f.api.snapshot(); assert.equal(snapshot.items[0].error, "Invalid font."); assert.equal(snapshot.counts.problems, 1);
});

test("preset and plugin data URLs are not missing files", () => {
  const f = fixture(); f.asset("preset", { source: 3, file: null, url: "/assets/fonts/Roboto.json" });
  f.asset("sprite", { source: 3, file: null, url: "data:image/png;base64,AAAA" });
  f.properties(f.child(f.project.sequence, new f.Obj("Text")), { font: new f.Property("Font", "preset") });
  f.properties(f.child(f.project.sequence, new f.Obj("Particles")), { texture: new f.Property("Texture", "sprite") });
  const snapshot = f.api.snapshot(); assert.equal(snapshot.counts.problems, 0);
  assert.equal(snapshot.items[0].source, "preset"); assert.equal(snapshot.items[1].source, "plugin");
});

test("pending image decoding settles to ready without polling", async () => {
  const f = fixture(), asset = f.asset("a"); let resolve;
  const data = { image: null, loading: new Promise(fn => { resolve = fn; }) };
  asset.data.set(f.PZ.asset.image, data);
  const snapshots = [], stop = f.api.subscribe(s => snapshots.push(s)); f.flush();
  assert.equal(snapshots[0].items[0].status, "loading"); assert.equal(f.raf.size, 0);
  data.image = { width: 20, height: 10 }; resolve(); await settle(); f.flush();
  assert.equal(snapshots.at(-1).items[0].status, "ready"); assert.equal(snapshots.at(-1).items[0].info.width, 20);
  f.flush();
  assert.equal(f.raf.size, 0); stop();
});

test("settled missing image, rejected decode and GIF placeholder fail", async () => {
  const f = fixture();
  f.asset("empty").data.set(f.PZ.asset.image, { image: null, loading: Promise.resolve() });
  f.asset("rejected").data.set(f.PZ.asset.image, { image: null, loading: Promise.reject(new Error("Bad image bytes.")) });
  f.asset("gif").data.set(f.PZ.asset.image, { image: { width: 1, height: 1 }, loading: Promise.resolve(), gif: { frames: null } });
  f.api.snapshot(); await settle(); f.flush();
  assert.deepEqual(plain(f.api.snapshot().items.map(i => i.status)), ["failed", "failed", "failed"]);
});

test("image events invalidate status and every event listener is released", () => {
  const f = fixture(), handlers = new Map();
  const image = { complete: false, naturalWidth: 0, naturalHeight: 0,
    addEventListener(k, fn) { handlers.set(k, fn); }, removeEventListener(k) { handlers.delete(k); } };
  f.asset("a").data.set(f.PZ.asset.image, { image }); f.api.snapshot();
  image.complete = true; handlers.get("error")(); f.flush(); assert.equal(f.api.snapshot().items[0].status, "failed");
  f.api.dispose(); assert.equal(handlers.size, 0);
});

test("Magic Looks LUT errors and video decode hints are read without changing decoders", () => {
  const f = fixture(), asset = f.asset("video", { filename: "clip.mov", file: { type: "video/quicktime", size: 12 } });
  f.sandbox.ZoidiumVideoDecodeStatus = { get: a => a === asset ? "failed" : null };
  f.asset("lut", { filename: "look.cube", file: { size: 12, type: "" } });
  const effect = f.child(f.project.sequence, new f.Effect("Looks")); effect._looksCubeError = "Invalid LUT header.";
  f.properties(effect, { lutData: new f.Property("LUT data", "lut") });
  const snapshot = f.api.snapshot(); assert.equal(snapshot.items[0].status, "failed");
  assert.equal(snapshot.items[1].error, "Invalid LUT header.");
});

test("snapshots cache by revision and changes rebuild lazily", () => {
  const f = fixture(), prop = new f.Property("Image", "a"); f.asset("a"); f.asset("b");
  f.properties(f.child(f.project.sequence, new f.Obj("Image")), { image: prop });
  const before = f.api.snapshot(); assert.equal(f.api.snapshot(), before);
  prop.set("b"); prop.set("a"); prop.set("b");
  assert.equal(f.api.snapshot(), before); // No second build in the same frame.
  f.flush(); assert.equal(f.raf.size, 0);
  const after = f.api.snapshot(); assert.equal(after.revision, before.revision + 1);
  assert.equal(after.items[1].usages.length, 1); assert.equal(f.api.snapshot(), after);
});

test("subscribers coalesce property, history and keyframe changes once per animation frame", () => {
  const f = fixture(), prop = new f.Property("Image", "a"); f.asset("a");
  f.properties(f.child(f.project.sequence, new f.Obj("Image")), { image: prop });
  const revisions = [], stop = f.api.subscribe(s => revisions.push(s.revision)); f.flush();
  prop.onChanged.update(); prop.onKeyframeChanged.update(); f.project.ui.onChanged.update();
  assert.equal(f.raf.size, 1); f.flush(); assert.equal(revisions.length, 2); f.flush(); assert.equal(revisions.length, 2);
  stop(); prop.onChanged.update(); assert.equal(f.raf.size, 0);
});

test("new asset, remove asset, project replacement and composition switch invalidate", () => {
  const f = fixture(); let compositionChanged;
  f.PZ.precomp = { subscribe(fn) { compositionChanged = fn; return () => {}; } };
  const before = f.api.snapshot(); f.asset("new"); f.project.assets.onAssetCreated.update();
  f.flush(); assert.equal(f.api.snapshot().items.length, 1); delete f.project.assets.list.new; f.project.assets.onAssetRemoved.update();
  f.flush(); assert.equal(f.api.snapshot().items.length, 0); compositionChanged(); f.flush(); assert.ok(f.api.snapshot().revision > before.revision);
  const previous = f.editor.project; f.editor.project = { ...previous, assets: { list: {} } }; f.editor.onProjectChanged.update();
  f.flush(); f.api.snapshot(); assert.equal(previous.assets.onAssetCreated.listeners.size, 0);
});

test("adapter validation and teardown remove registrations and all observations", () => {
  const f = fixture(); assert.throws(() => f.api.registerReferences({}), /require/);
  const dispose = f.api.registerReferences({ id: "example", collect() {} });
  assert.throws(() => f.api.registerReferences({ id: "example", collect() {} }), /already/);
  dispose(); dispose(); f.api.snapshot(); assert.equal(f.project.ui.onChanged.listeners.size, 1);
  f.api.dispose(); assert.equal(f.project.ui.onChanged.listeners.size, 0); assert.equal(f.events.size, 0);
});

test("a 200-clip authored project can rebuild without touching refs or bytes", () => {
  const f = fixture(); f.asset("a");
  for (let i = 0; i < 200; i++) f.properties(f.child(f.project.sequence, new f.Clip("Clip " + i)), { image: new f.Property("Image", "a") });
  const start = performance.now(), snapshot = f.api.snapshot(), elapsed = performance.now() - start;
  assert.equal(snapshot.items[0].usages.length, 200); assert.ok(elapsed < 100, "200-clip VM walk exceeded 100 ms");
});

test("reveal uses native selection without entering drag handlers or changing project data", () => {
  const f = fixture(), clip = f.child(f.project.sequence, new f.Clip("V1 Text"));
  const owner = f.child(clip, new f.Obj("Text")), prop = new f.Property("Font", "font");
  f.properties(owner, { font: prop }); f.asset("font");
  let selectionCalls = 0, scrolled = false;
  function classes() { const set = new Set(); return { add: key => set.add(key), contains: key => set.has(key) }; }
  const clipEl = { pz_object: clip, classList: classes(), dispatchEvent() { throw new Error("Reveal entered clip drag"); } };
  const ownerRow = { pz_object: owner, classList: classes(), firstElementChild: {}, parentElement: null };
  const propRow = { pz_object: prop, scrollIntoView() { scrolled = true; }, parentElement: null };
  class Tracks {
    deselectClips() { selectionCalls++; }
    selectClips() { selectionCalls++; }
  }
  class Edit {
    constructor() { this.list = { contains: row => row === ownerRow }; this.options = { selectionFilter: () => true }; }
    deselectItems() { selectionCalls++; }
    selectItems() { selectionCalls++; }
  }
  f.PZ.ui = { timeline: { tracks: Tracks }, edit: Edit };
  f.editor.windows = [{ panel: { timeline: new Tracks(), objects: new Edit() } }];
  f.sandbox.document = { querySelectorAll(selector) {
    if (selector === ".clip") return [clipEl];
    if (selector === ".elevatortabs a") return [];
    return [ownerRow, propRow];
  } };
  const usage = f.api.snapshot().items[0].usages[0];
  const children = clip.children.slice();
  assert.equal(f.api.reveal(usage), true); assert.equal(scrolled, true); assert.equal(selectionCalls, 4);
  assert.deepEqual(clip.children, children); assert.equal(prop.value, "font");
  owner.parent = null; assert.equal(f.api.reveal(usage), false);
});

test("external and cloud assets without attached local bytes are not missing files", () => {
  const f = fixture(); f.asset("external", { file: null, external: true }); f.asset("cloud", { file: null, source: 4 });
  assert.equal(f.api.snapshot().counts.problems, 0);
});

test("Precomp+ referenceSources detaches private Main and stored composition data", () => {
  const { createEnvironment, addClip, addCompMedia } = require("./precomp-fixtures.js");
  const env = createEnvironment();
  addClip(env, 0, { start: 0, length: 30, name: "Main clip" });
  const media = addCompMedia(env, "intro", "Intro", [{ type: 0, clips: [] }]);
  assert.equal(env.PZ.precomp.openComp(env.editor, "intro").ok, true);
  const source = env.PZ.precomp.referenceSources(env.editor);
  assert.equal(source[0].editing, false); assert.equal(source[0].tracks[0].clips[0].properties.name, "Main clip");
  assert.equal(source[1].editing, true); assert.equal(source[1].tracks, null);
  source[0].tracks[0].clips.length = 0;
  assert.equal(env.PZ.precomp.referenceSources(env.editor)[0].tracks[0].clips.length, 1);
  env.PZ.precomp.openComp(env.editor, "main");
  const stored = env.PZ.precomp.referenceSources(env.editor)[1]; stored.tracks.push({ type: 1 });
  assert.equal(media.data.length, 1);
});

test("Precomp render clones never become live properties or plugin adapter usages", () => {
  const f = fixture(); f.asset("a");
  const comp = f.child(f.project.sequence, new f.Obj("Intro")); comp.type = 2; comp.compId = "intro";
  comp.objects = []; comp.children.push(comp.objects);
  const clone = new f.Obj("Render clone"); comp.objects.push(clone);
  f.properties(clone, { image: new f.Property("Image", "a"),
    graph: new f.Property("Graph", JSON.stringify({ nodes: [{ id: 1, params: { asset: "a" } }] }), 7),
    iesData: new f.Property("IES Data", "IESNA", 7), iesFilename: new f.Property("IES File", "a.ies", 7) });
  f.adapter("material-plus"); f.adapter("trapcode-suite");
  const snapshot = f.api.snapshot(); assert.equal(snapshot.items.find(i => i.id === "a").usages.length, 0);
  assert.equal(snapshot.items.some(i => i.kind === "ies"), false);
});

test("native history completion reports non-reference property edits", () => {
  const f = fixture(), numeric = new f.Property("Size", 20, 0);
  f.properties(f.child(f.project.sequence, new f.Obj("Text")), { size: numeric });
  const revisions = []; f.api.subscribe(s => revisions.push(s.revision)); f.flush();
  numeric.set(30); f.project.ui.onChanged.update(); f.flush();
  assert.equal(revisions.length, 2); assert.ok(revisions[1] > revisions[0]);
});

test("each late subscriber receives its current revision without repeating existing listeners", () => {
  const f = fixture(), first = [], second = [];
  f.api.subscribe(s => first.push(s.revision)); f.flush();
  f.api.subscribe(s => second.push(s.revision)); f.flush();
  assert.equal(first.length, 1); assert.equal(second.length, 1); assert.equal(first[0], second[0]);
});
