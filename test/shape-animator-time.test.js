"use strict";
// Fix 1 (perf/shape-model-time-ids): Text Animator time is an evaluated input
// only while the Wiggly Selector is on. Range selectors never read time, so a
// static animator must evaluate identically at every frame and stay on the
// layer compile cache. Wiggly-on, stacked, and Wiggle deform behavior is
// unchanged.
const { test, before } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { PZ } = require("./shape-plus-host");
const { createModel } = require("../plugins/shape-plus/model");
const { createLoader } = require("../plugins/shape-plus/text-engine"), { layoutText } = require("../plugins/shape-plus/text-layout");
const { compile } = require("../plugins/shape-plus/compiler");
const { applyAnimators } = require("../plugins/shape-plus/text-animate");
let engine, font;
before(async () => {
  engine = await createLoader((_, name) => fs.readFileSync(name, "utf8"), name => require("../plugins/shape-plus/" + name))();
  const b = fs.readFileSync("test/fixtures/shape-text/RobotoFlex-subset.ttf");
  font = engine.open(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), "fixture");
});
const service = () => ({ evaluate: (_, p) => layoutText(font, null, p) });
const held = value => ({ animated: false, keyframes: [{ frame: 0, value, tween: 1 }] });
const fullRange = { selectorStart: held(0), selectorEnd: held(100), selectorAmount: held(100) };
const on = key => ({ ["enabled_" + key]: 1 });
const fill = () => ({ id: "fill", kind: "fill", properties: { enabled: 1, color: [1, 1, 1], opacity: 1, fillRule: "nonzero" }, vertexIds: [] });
function setup(sourceText, animatorProps = {}, rate = 30) {
  const { Content } = createModel(PZ, service());
  const text = new Content("text");
  text.load({ id: "text", properties: { sourceText: held(sourceText) } });
  const anim = new Content("textAnimator");
  anim.load({ id: "anim", properties: { ...animatorProps } });
  return { at: frame => ({ text: text.evaluate(frame, rate), anim: anim.evaluate(frame, rate) }) };
}
test("static animator omits time and evaluates identically across frames", () => {
  const { at } = setup("AV office", { ...on("position"), position: held([10, 20]), ...fullRange });
  const first = at(0), second = at(30);
  assert.equal(first.anim.properties.time, undefined);
  assert.equal(second.anim.properties.time, undefined);
  assert.deepEqual(second.anim.properties, first.anim.properties);
  assert.deepEqual(second.text.properties, first.text.properties);
  assert.deepEqual(compile([second.text, second.anim, fill()]), compile([first.text, first.anim, fill()]));
});
test("wiggly-on animator keeps frame-derived time and deterministic output", () => {
  const wiggly = { wigglyOn: 1, wigglesPerSecond: held(2), wigglySeed: held(3), selectorAmount: held(0) };
  const { at } = setup("ABC", { ...on("position"), position: held([100, 100]), ...fullRange, ...wiggly });
  const first = at(0), second = at(30);
  assert.equal(first.anim.properties.time, 0);
  assert.equal(second.anim.properties.time, 1);
  const again = at(30);
  assert.deepEqual(applyAnimators(again.text, [again.anim]), applyAnimators(second.text, [second.anim]));
  assert.notDeepEqual(
    applyAnimators(second.text, [second.anim]).levels.get("0:0")[0].position,
    applyAnimators(first.text, [first.anim]).levels.get("0:0")[0].position,
  );
});
test("wiggly-off animator does not mask a later wiggly-on animator", () => {
  const { Content } = createModel(PZ, service());
  const text = new Content("text");
  text.load({ id: "text", properties: { sourceText: held("ABC") } });
  const off = new Content("textAnimator");
  off.load({ id: "a1", properties: { enabled_position: 1, position: held([10, 0]), ...fullRange } });
  const wiggly = { wigglyOn: 1, wigglesPerSecond: held(2), wigglySeed: held(3), selectorAmount: held(0) };
  const wiggled = new Content("textAnimator");
  wiggled.load({ id: "a2", properties: { enabled_position: 1, position: held([100, 100]), ...fullRange, ...wiggly } });
  const frame = 30, evaluated = text.evaluate(frame), first = off.evaluate(frame), second = wiggled.evaluate(frame);
  assert.equal(first.properties.time, undefined);
  assert.equal(second.properties.time, frame / 30);
  const animation = applyAnimators(evaluated, [first, second]);
  assert.equal(animation.levels.get("0:0").length, 2);
  const earlier = applyAnimators(text.evaluate(0), [off.evaluate(0), wiggled.evaluate(0)]);
  assert.notDeepEqual(animation.levels.get("0:1")[1].position, earlier.levels.get("0:1")[1].position);
  // Reversed order still resolves time from the wiggly-on animator.
  const flipped = applyAnimators(evaluated, [second, first]);
  assert.equal(flipped.levels.get("0:0").length, 2);
});
test("wiggle paths and wiggle transform keep frame-derived time", () => {
  const { Content } = createModel(PZ);
  for (const kind of ["wigglePaths", "wiggleTransform"]) {
    const node = new Content(kind);
    node.load({ id: kind });
    const first = node.evaluate(0), second = node.evaluate(30);
    assert.equal(first.properties.time, 0);
    assert.equal(second.properties.time, 1);
    const drop = ({ time: _ignored, ...rest }) => rest;
    assert.deepEqual(drop(second.properties), drop(first.properties));
  }
});
