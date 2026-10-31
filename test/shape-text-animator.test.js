"use strict";
const { test, before } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { PZ } = require("./shape-plus-host");
const { createModel, clone } = require("../plugins/shape-plus/model");
const { createLoader } = require("../plugins/shape-plus/text-engine"), { layoutText } = require("../plugins/shape-plus/text-layout");
const { compile } = require("../plugins/shape-plus/compiler");
const { applyAnimators, matchAnimators, computeUnits, shiftCodepoint } = require("../plugins/shape-plus/text-animate");
const { planAnimator, setAnimatorFlag, paintScope } = require("../plugins/shape-plus/contents-ops");
const { NO_TEXT, hintFor } = require("../plugins/shape-plus/native-hints");
let engine, font;
before(async () => {
  engine = await createLoader((_, name) => fs.readFileSync(name, "utf8"), name => require("../plugins/shape-plus/" + name))();
  const b = fs.readFileSync("test/fixtures/shape-text/RobotoFlex-subset.ttf");
  font = engine.open(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), "fixture");
});
const close = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) <= eps, "expected " + expected + " got " + actual);
const service = () => ({ evaluate: (_, p) => layoutText(font, null, p) });
const held = value => ({ animated: false, keyframes: [{ frame: 0, value, tween: 1 }] });
function setup(sourceText, animatorProps = {}, textProps = {}) {
  const { Content } = createModel(PZ, service());
  const text = new Content("text");
  text.load({ id: "text", properties: { sourceText: held(sourceText), ...textProps } });
  const anim = new Content("textAnimator");
  anim.load({ id: "anim", properties: { ...animatorProps } });
  return { Content, text: text.evaluate(0), anim: anim.evaluate(0) };
}
const fullRange = { selectorStart: held(0), selectorEnd: held(100), selectorAmount: held(100) };
class MutableLists extends PZ.propertyList {
  add(key, definition) { this[key] = new PZ.property(definition); this[key].parent = this; }
  remove(key) { delete this[key]; }
}
const mutableHost = { ...PZ, propertyList: MutableLists };
function setupAxis(sourceText, animatorProps = {}) {
  const { animatorAxes } = require("../plugins/shape-plus/text-animator-properties");
  const { Content } = createModel(mutableHost, service());
  const text = new Content("text");
  text.load({ id: "text", properties: { sourceText: held(sourceText) } });
  const anim = new Content("textAnimator");
  animatorAxes(mutableHost, anim, [font]);
  anim.load({ id: "anim", properties: { ...animatorProps } });
  return { Content, text: text.evaluate(0), anim: anim.evaluate(0) };
}
const on = key => ({ ["enabled_" + key]: 1 });
const fill = () => ({ id: "fill", kind: "fill", properties: { enabled: 1, color: [1, 1, 1], opacity: 1, fillRule: "nonzero" }, vertexIds: [] });
test("position offset applies per selected character group", () => {
  const { text, anim } = setup("AV", { ...on("position"), position: held([10, 20]), ...fullRange });
  const animation = applyAnimators(text, [anim]);
  assert.ok(animation);
  for (const key of ["0:0", "0:1"]) {
    const level = animation.levels.get(key)[0];
    close(level.position[0] - level.anchor[0], 10);
    close(level.position[1] - level.anchor[1], 20);
    close(level.anchor[0], key === "0:0" ? 29.1259765625 : 89.013671875);
    assert.equal(level.anchor[1], 0);
  }
  const plain = compile([setup("AV").text, fill()]);
  const moved = compile([text, anim, fill()]);
  assert.equal(moved.commands.length, 1);
  const triangles = positions => {
    const result = [];
    for (let i = 0; i < positions.length; i += 9) result.push(Array.from(new Float32Array(positions.slice(i, i + 9))).join(","));
    return result.sort();
  };
  const shift = (positions, dx, dy) => positions.map((v, i) => i % 3 === 2 ? v : v + (i % 3 === 0 ? dx : dy));
  assert.deepEqual(triangles(moved.commands[0].positions), triangles(shift(plain.commands[0].positions, 10, 20)));
});
test("scale, rotation, skew and anchor reshape the group transform", () => {
  const { text, anim } = setup("A", {
    ...on("scale"), scale: held([50, 200]), ...on("rotation"), rotation: held(Math.PI / 2),
    ...on("skew"), skew: held(Math.PI / 4), skewAxis: held(0), ...fullRange,
  });
  const level = applyAnimators(text, [anim]).levels.get("0:0")[0];
  assert.deepEqual(level.scale, [0.5, 2]);
  assert.equal(level.rotation, Math.PI / 2);
  assert.equal(level.skew, Math.PI / 4);
  const second = setup("A", { ...on("anchor"), anchor: held([5, 7]), ...on("scale"), scale: held([50, 50]), ...fullRange });
  const anchored = applyAnimators(second.text, [second.anim]).levels.get("0:0")[0];
  close(anchored.anchor[0], 31.25 + 5);
  assert.equal(anchored.anchor[1], 7);
});
test("disabled properties contribute nothing and hide no-ops", () => {
  const { text, anim } = setup("AV", { position: held([10, 20]), ...fullRange });
  assert.equal(applyAnimators(text, [anim]), null);
  const second = setup("AV", { ...on("position"), position: held([0, 0]), ...fullRange });
  assert.equal(applyAnimators(second.text, [second.anim]), null);
});
test("tracking shifts later characters cumulatively after alignment", () => {
  const { text, anim } = setup("AV", { ...on("tracking"), tracking: held(200), ...fullRange });
  const glyphs = applyAnimators(text, [anim]).glyphs;
  assert.equal(glyphs[0].x, 0);
  close(glyphs[1].x, 58.251953125 + 20);
  const centered = setup("AV", {}, { alignment: held("center") });
  const tracked = setup("AV", { ...on("tracking"), tracking: held(200), ...fullRange });
  const moved = applyAnimators(centered.text, [tracked.anim]).glyphs;
  const base = centered.text.textLayout.glyphs;
  close(moved[0].x, base[0].x);
  close(moved[1].x - moved[0].x, (base[1].x - base[0].x) + 20);
});
test("character offset wraps within its class and replaces the advance", () => {
  assert.equal(shiftCodepoint("A", 1), "B");
  assert.equal(shiftCodepoint("Z", 1), "A");
  assert.equal(shiftCodepoint("z", 1), "a");
  assert.equal(shiftCodepoint("9", 1), "0");
  assert.equal(shiftCodepoint("A", -1), "Z");
  assert.equal(shiftCodepoint(".", 5), ".");
  const { text, anim } = setup("AZaz09.", { ...on("charOffset"), charOffset: held(1), ...fullRange });
  const glyphs = applyAnimators(text, [anim]).glyphs;
  assert.deepEqual(glyphs.map(g => g.character), ["B", "A", "b", "a", "1", "0", "."]);
  const direct = font.shape("B", font.coordinates({}))[0];
  close(glyphs[0].advance, direct.ax * glyphs[0].scaleX);
  assert.notDeepEqual(glyphs[0].paths, text.textLayout.glyphs[0].paths);
  close(glyphs[1].x, glyphs[0].x + glyphs[0].advance);
});
test("variable-axis offsets reshape the outline and shift later glyphs", () => {
  const { text, anim } = setupAxis("A", { axis_wght: held(100), enabled_axis_wght: 1, ...fullRange });
  const glyphs = applyAnimators(text, [anim]).glyphs;
  const direct = layoutText(font, null, { sourceText: "A", fontSize: 100, axis_wght: 500 });
  assert.equal(glyphs[0].advance, direct.glyphs[0].advance);
  assert.deepEqual(glyphs[0].paths, direct.glyphs[0].paths);
  assert.notDeepEqual(glyphs[0].paths, text.textLayout.glyphs[0].paths);
  const pair = setupAxis("AV", { axis_wght: held(100), enabled_axis_wght: 1, ...fullRange });
  const moved = applyAnimators(pair.text, [pair.anim]).glyphs;
  const base = pair.text.textLayout.glyphs;
  close(moved[1].x - moved[0].x, (base[1].x - base[0].x) + (moved[0].advance - base[0].advance));
});
test("grouping pivots follow character, word, line and all spans", () => {
  const { text } = setup("AV office");
  const pivot = grouping => applyAnimators(text, [setup("AV office", {
    ...on("scale"), scale: held([50, 50]), anchorGrouping: grouping, ...fullRange,
  }).anim]).levels;
  const glyphs = text.textLayout.glyphs;
  const office = glyphs.filter(g => g.cl >= 3);
  const span = [Math.min(...office.map(g => g.x)), Math.max(...office.map(g => g.x + g.advance))];
  const word = pivot("word").get("0:3")[0].anchor;
  close(word[0], (span[0] + span[1]) / 2);
  assert.equal(word[1], 0);
  assert.notEqual(word[0], pivot("character").get("0:3")[0].anchor[0]);
  const two = setup("A B\nCD");
  const linePivot = grouping => applyAnimators(two.text, [setup("A B\nCD", {
    ...on("scale"), scale: held([50, 50]), anchorGrouping: grouping, ...fullRange,
  }).anim]).levels;
  close(linePivot("line").get("1:0")[0].anchor[0], 44.3359375);
  close(linePivot("line").get("1:0")[0].anchor[1], -120);
  close(linePivot("all").get("1:1")[0].anchor[0], 65.625);
  assert.equal(linePivot("all").get("1:1")[0].anchor[1], 0);
});
test("grouping alignment moves the pivot by a percentage of the group box", () => {
  const { text, anim } = setup("A", { ...on("groupingAlignment"), groupingAlignment: held([100, 50]), ...on("scale"), scale: held([50, 50]), ...fullRange });
  const anchor = applyAnimators(text, [anim]).levels.get("0:0")[0].anchor;
  close(anchor[0], 31.25 + 62.5);
  close(anchor[1], 0.5 * (1900 + 500) / 2048 * 100);
});
test("based on counts characters, words and lines over two lines with spaces", () => {
  const two = setup("A B\nCD");
  assert.deepEqual(computeUnits(two.text.textLayout, "characters"), { count: 5, map: [0, 1, 2, 3, 4] });
  assert.deepEqual(computeUnits(two.text.textLayout, "noSpaces"), { count: 4, map: [0, -1, 1, 2, 3] });
  assert.deepEqual(computeUnits(two.text.textLayout, "words"), { count: 3, map: [0, -1, 1, 2, 2] });
  assert.deepEqual(computeUnits(two.text.textLayout, "lines"), { count: 2, map: [0, 0, 0, 1, 1] });
  const position = basedOn => setup("A B\nCD", {
    ...on("position"), position: held([10, 0]), selectorBasedOn: basedOn,
    selectorStart: held(0), selectorEnd: held(50), selectorAmount: held(100),
  }).anim;
  const chars = applyAnimators(two.text, [position("characters")]).levels;
  close(chars.get("0:0")[0].position[0] - chars.get("0:0")[0].anchor[0], 10);
  close(chars.get("0:2")[0].position[0] - chars.get("0:2")[0].anchor[0], 5);
  assert.ok(!chars.has("1:0") && !chars.has("1:1"));
  const bare = applyAnimators(two.text, [position("noSpaces")]).levels;
  close(bare.get("0:2")[0].position[0] - bare.get("0:2")[0].anchor[0], 10);
  const ramps = applyAnimators(two.text, [setup("A B\nCD", {
    ...on("position"), position: held([12, 0]), selectorBasedOn: "words", selectorShape: "rampUp", ...fullRange,
  }).anim]).levels;
  for (const [key, expected] of [["0:0", 2], ["0:2", 6], ["1:0", 10]]) {
    const level = ramps.get(key)[0];
    close(level.position[0] - level.anchor[0], expected);
  }
  const lineSel = applyAnimators(two.text, [setup("A B\nCD", {
    ...on("position"), position: held([10, 0]), selectorBasedOn: "lines",
    selectorStart: held(50), selectorEnd: held(100), selectorAmount: held(100),
  }).anim]).levels;
  assert.ok(!lineSel.has("0:0") && !lineSel.has("0:2"));
  close(lineSel.get("1:0")[0].position[0] - lineSel.get("1:0")[0].anchor[0], 10);
});
test("index units count in selector units with an end-of-text default", () => {
  const { text, anim } = setup("ABCD", { ...on("position"), position: held([8, 0]), selectorUnits: "index", selectorStart: held(1), selectorEnd: held(3), selectorAmount: held(100) });
  const levels = applyAnimators(text, [anim]).levels;
  assert.ok(!levels.has("0:0"));
  close(levels.get("0:1")[0].position[0] - levels.get("0:1")[0].anchor[0], 8);
  close(levels.get("0:2")[0].position[0] - levels.get("0:2")[0].anchor[0], 8);
  assert.ok(!levels.has("0:3"));
});
test("stacked animators compose nested levels in list order", () => {
  const { Content } = createModel(PZ, service());
  const text = new Content("text");
  text.load({ id: "text", properties: { sourceText: held("A") } });
  const first = new Content("textAnimator");
  first.load({ id: "a1", properties: { name: "Animator 1", enabled_position: 1, position: held([10, 0]), selectorStart: held(0), selectorEnd: held(100), selectorAmount: held(100) } });
  const second = new Content("textAnimator");
  second.load({ id: "a2", properties: { name: "Animator 2", enabled_scale: 1, scale: held([50, 50]), selectorStart: held(0), selectorEnd: held(100), selectorAmount: held(100) } });
  const evaluated = text.evaluate(0);
  const animation = applyAnimators(evaluated, [first.evaluate(0), second.evaluate(0)]);
  const levels = animation.levels.get("0:0");
  assert.equal(levels.length, 2);
  close(levels[0].position[0] - levels[0].anchor[0], 10);
  assert.deepEqual(levels[1].scale, [0.5, 0.5]);
  const { textPaths } = require("../plugins/shape-plus/text-paths");
  let id = 0;
  const tree = textPaths(evaluated, () => "n" + id++, animation);
  assert.deepEqual(tree.contents[0].properties.scale, [0.5, 0.5]);
  const inner = tree.contents[0].contents[0].properties;
  close(inner.position[0] - inner.anchor[0], 10);
  assert.equal(inner.position[1] - inner.anchor[1], 0);
});
test("matchAnimators scopes below-text siblings including nested groups", () => {
  const t = id => ({ id, kind: "text", properties: {} });
  const a = id => ({ id, kind: "textAnimator", properties: { enabled: 1 } });
  const contents = [t("t1"), a("a1"), { id: "g", kind: "group", properties: {}, contents: [t("t2"), a("a2")] }, a("a3")];
  const matches = matchAnimators(contents);
  assert.deepEqual(matches.get("t1").map(i => i.id), ["a1", "a3"]);
  assert.deepEqual(matches.get("t2").map(i => i.id), ["a2", "a3"]);
  const off = [t("t1"), { id: "ax", kind: "textAnimator", properties: { enabled: 0 } }];
  assert.deepEqual(matchAnimators(off).get("t1"), []);
});
test("animator scope hints report textless animators", () => {
  const t = id => ({ id, kind: "text", properties: {} });
  const a = id => ({ id, kind: "textAnimator", properties: {} });
  assert.equal(hintFor(paintScope([a("a1")]), a("a1")), NO_TEXT);
  assert.equal(hintFor(paintScope([t("t1"), a("a1")]), a("a1")), "");
  assert.equal(hintFor(paintScope([{ id: "g", kind: "group", properties: {}, contents: [t("t1")] }, a("a1")]), a("a1")), "");
  assert.equal(hintFor(paintScope([a("a1"), t("t1")]), a("a1")), NO_TEXT);
});
test("persistence round-trips animator properties, flags and axis store", () => {
  const { animatorAxes } = require("../plugins/shape-plus/text-animator-properties");
  const { Content } = createModel(mutableHost, service());
  const anim = new Content("textAnimator");
  animatorAxes(mutableHost, anim, [font]);
  anim.load({ id: "anim", properties: { name: "Animator 1", enabled_position: 1, position: held([10, 20]), selectorShape: "rampUp", wigglyOn: 1, axis_wght: held(50), enabled_axis_wght: 1 }, axisStore: { axis_custom: held(3) } });
  const saved = clone(anim);
  assert.equal(saved.properties.position.objects[0].keyframes[0].value, 10);
  assert.equal(saved.properties.axis_wght.keyframes[0].value, 50);
  assert.equal(saved.properties.selectorShape, "rampUp");
  assert.deepEqual(saved.axisStore.axis_custom, held(3));
  const reopened = new Content("textAnimator");
  reopened.load(saved);
  assert.deepEqual(clone(reopened), saved);
  const root = new Content("group");
  root.load({ contents: [clone(anim)] });
  const original = root.contents[0], copy = new Content("textAnimator");
  root.contents.push(copy);
  copy.load(clone(original));
  assert.notEqual(copy.id, original.id);
  assert.deepEqual(clone(copy).properties.position, clone(original).properties.position);
});
test("animator add and flag toggles are single history steps with undo", () => {
  const { createGesture } = require("../plugins/shape-plus/editor-history");
  const project = {};
  let current = project;
  const store = { contents: [{ id: "t", kind: "text", properties: {} }] };
  const history = { operation: null, commands: [], startOperation() { this.operation = {}; }, finishOperation() { this.operation = null; }, discardOperation() { this.operation = null; }, pushCommand(fn, params) { this.commands.push({ fn, params }); } };
  const read = (forHistory = false) => forHistory && current !== project ? null : clone(store.contents);
  const write = (data, forHistory = false) => { if (!forHistory && current !== project) return; store.contents = data; };
  const notify = () => {};
  const currentProject = () => project;
  const run = work => createGesture(history, read, write, notify, currentProject).run(() => { const data = read(); work(data); write(data); });
  let sequence = 0;
  const nextId = () => "anim-" + (++sequence);
  const pristine = clone(store.contents);
  assert.ok(run(data => planAnimator(data, "t", nextId, "position")));
  assert.equal(history.commands.length, 1);
  assert.equal(store.contents[1].properties.enabled_position, 1);
  assert.equal(store.contents[1].properties.name, "Animator 1");
  history.commands.pop().fn({ history, read, write, data: pristine, project, currentProject });
  assert.deepEqual(store.contents, pristine);
  assert.equal(history.commands.length, 1);
  assert.throws(() => run(data => setAnimatorFlag(data, "t", "position", 1)), /Text Animator/);
  store.contents = clone(pristine);
  history.commands = [];
  assert.ok(run(data => { const added = planAnimator(data, "t", nextId, "position"); setAnimatorFlag(data, added.id, "wiggly", 1); }));
  assert.equal(history.commands.length, 1);
  assert.equal(store.contents[1].properties.wigglyOn, 1);
});
test("zero-amount and empty-range animators compile identically to plain text", () => {
  const { text } = setup("AV office");
  const plain = compile([text, fill()]);
  for (const animatorProps of [
    { ...on("position"), position: held([10, 20]), selectorStart: held(0), selectorEnd: held(100), selectorAmount: held(0) },
    { ...on("position"), position: held([10, 20]), selectorStart: held(40), selectorEnd: held(40), selectorAmount: held(100) },
    { ...on("tracking"), tracking: held(200), selectorStart: held(0), selectorEnd: held(100), selectorAmount: held(0) },
    { ...on("charOffset"), charOffset: held(5), selectorStart: held(30), selectorEnd: held(30), selectorAmount: held(100) },
  ]) {
    const anim = setup("AV office", animatorProps).anim;
    assert.deepEqual(compile([text, anim, fill()]), plain);
  }
  const disabled = setup("AV office", { ...on("position"), position: held([10, 20]), ...fullRange }).anim;
  assert.deepEqual(compile([text, { ...disabled, properties: { ...disabled.properties, enabled: 0 } }, fill()]), plain);
});
test("unanimated text keeps its geometry and cache behavior", () => {
  const geometry = require("../plugins/shape-plus/text-geometry");
  const { text } = setup("AV office");
  const first = compile([text, fill()]);
  const mid = geometry.stats();
  const second = compile([text, fill()]);
  assert.deepEqual(second, first);
  const after = geometry.stats();
  assert.equal(after.geometry.misses, mid.geometry.misses);
  assert.ok(after.geometry.hits > mid.geometry.hits);
});
test("wiggly selectors share locked values and split vector components", () => {
  const wiggly = { wigglyOn: 1, wigglyMax: held(100), wigglyMin: held(-100), wigglesPerSecond: held(2), correlation: held(50), wigglySeed: held(3), selectorAmount: held(0) };
  const { text } = setup("ABC");
  const unlocked = setup("ABC", { ...on("position"), position: held([100, 100]), selectorStart: held(0), selectorEnd: held(100), ...wiggly }).anim;
  const levels = applyAnimators(text, [unlocked]).levels;
  const offsets = ["0:0", "0:1", "0:2"].map(key => {
    const level = levels.get(key)[0];
    return [level.position[0] - level.anchor[0], level.position[1] - level.anchor[1]];
  });
  assert.ok(new Set(offsets.map(([x, y]) => x.toFixed(4) + "/" + y.toFixed(4))).size > 1);
  assert.ok(offsets.every(([x, y]) => Math.abs(x - y) > 1e-9), "unlocked components must differ: " + JSON.stringify(offsets));
  const locked = setup("ABC", { ...on("position"), position: held([100, 100]), selectorStart: held(0), selectorEnd: held(100), ...wiggly, lockDimensions: 1 }).anim;
  const same = applyAnimators(text, [locked]).levels;
  for (const key of ["0:0", "0:1", "0:2"]) {
    const level = same.get(key)[0];
    assert.equal(level.position[0] - level.anchor[0], level.position[1] - level.anchor[1]);
  }
  const shared = setup("ABC", { ...on("position"), position: held([100, 100]), selectorStart: held(0), selectorEnd: held(100), ...wiggly, correlation: held(100) }).anim;
  const equal = applyAnimators(text, [shared]).levels;
  const offsetOf = key => { const level = equal.get(key)[0]; return [level.position[0] - level.anchor[0], level.position[1] - level.anchor[1]]; };
  assert.deepEqual(offsetOf("0:1"), offsetOf("0:0"));
  assert.deepEqual(offsetOf("0:2"), offsetOf("0:0"));
  const again = applyAnimators(text, [shared]).levels;
  assert.deepEqual(again.get("0:1")[0].position, equal.get("0:1")[0].position);
});
test("conversion bakes the animated frame into static paths", () => {
  const { createShapes } = require("../plugins/shape-plus/text-convert");
  const { Content } = createModel(PZ, service());
  const text = new Content("text");
  text.load({ id: "text", properties: { sourceText: held("AV") } });
  const anim = new Content("textAnimator");
  anim.load({ id: "anim", properties: { enabled_position: 1, position: held([30, -15]), enabled_skew: 1, skew: held(Math.PI / 6), skewAxis: held(0), selectorStart: held(0), selectorEnd: held(100), selectorAmount: held(100) } });
  const frame = 0, evaluated = text.evaluate(frame), animator = anim.evaluate(frame);
  const paints = [new Content("fill"), new Content("trim")];
  for (const item of paints) item.load({});
  const paintItems = paints.map(item => item.evaluate(frame));
  let id = 0;
  const converted = createShapes(evaluated, () => "c" + id++, [animator]).map(data => { const item = new Content("group", data); item.load(data); return item; });
  assert.deepEqual(converted.map(item => item.kind), ["group", "group"]);
  for (const group of converted) for (const path of group.contents) assert.equal(path.kind, "path");
  const triangles = values => { const result = []; for (let i = 0; i < values.length; i += 9) result.push(Array.from(new Float32Array(values.slice(i, i + 9))).join(",")); return result.sort(); };
  const before = compile([evaluated, animator, ...paintItems], 0.125);
  const after = compile([...converted.map(item => item.evaluate(frame)), ...paintItems], 0.125);
  assert.deepEqual(after.commands.map(({ positions, ...rest }) => ({ ...rest, positions: triangles(positions) })), before.commands.map(({ positions, ...rest }) => ({ ...rest, positions: triangles(positions) })));
});
test("animator axes register the union and preserve inactive channels", () => {
  const { animatorAxes } = require("../plugins/shape-plus/text-animator-properties");
  const { Content } = createModel(mutableHost, service());
  const node = new Content("textAnimator");
  const other = { axes: { custom: { min: 0, default: 1, max: 10, name: "Custom" } } };
  animatorAxes(mutableHost, node, [font, other]);
  assert.ok(node.properties.axis_wght);
  assert.ok(node.properties.axis_custom);
  assert.equal(node.properties.axis_wght.get(), 0);
  animatorAxes(mutableHost, node, [font]);
  assert.ok(node.properties.axis_wght);
  assert.equal(node.properties.axis_custom, undefined);
  assert.ok(node.hiddenAxes.axis_custom);
  const saved = clone(node);
  assert.ok(saved.axisStore.axis_custom);
  const reopened = new Content("textAnimator");
  reopened.load(saved);
  animatorAxes(mutableHost, reopened, [font, other]);
  assert.ok(reopened.properties.axis_custom);
  assert.equal(clone(reopened).axisStore, undefined);
});
test("native rows hide disabled animator properties and menu-owned switches", () => {
  const { visible } = require("../plugins/shape-plus/native-properties");
  const { Content } = createModel(PZ, service());
  const make = properties => { const item = new Content("textAnimator"); item.load({ properties }); return item; };
  const anim = make({ enabled_position: 1, wigglyOn: 0 });
  const before = JSON.stringify(anim);
  assert.equal(visible("position", anim.properties), true);
  assert.equal(visible("scale", anim.properties), false);
  assert.equal(visible("enabled_position", anim.properties), false);
  assert.equal(visible("wigglyOn", anim.properties), false);
  assert.equal(visible("wigglyMax", anim.properties), false);
  assert.equal(visible("selectorStart", anim.properties), true);
  assert.equal(visible("anchorGrouping", anim.properties), true);
  assert.equal(visible("position", make({ enabled_position: 0 }).properties), false);
  assert.equal(visible("wigglyMax", make({ wigglyOn: 1 }).properties), true);
  assert.equal(JSON.stringify(anim), before);
  const group = new Content("group");
  group.load({});
  assert.equal(visible("position", group.properties), true);
});
test("planAnimator places numbered animators directly below their text", () => {
  const contents = [{ id: "t", kind: "text", properties: {} }, { id: "f", kind: "fill", properties: {} }];
  let id = 0;
  const first = planAnimator(contents, "t", () => "a" + (++id), "position");
  assert.deepEqual(contents.map(i => i.id), ["t", "a1", "f"]);
  assert.equal(first.properties.name, "Animator 1");
  const second = planAnimator(contents, "t", () => "a" + (++id), "scale");
  assert.deepEqual(contents.map(i => i.id), ["t", "a2", "a1", "f"]);
  assert.equal(second.properties.name, "Animator 2");
  assert.throws(() => planAnimator(contents, "missing", () => "x", "position"), /Text item/);
  assert.throws(() => planAnimator(contents, "t", () => "x", "opacity"), /Unknown animator/);
});
