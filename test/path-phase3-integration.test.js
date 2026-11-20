"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture, path, mask, group, vertex } = require("./helpers/path-editor-fixture.cjs");
const { channels, frames } = require("../plugins/shape-plus/path-animation.js");
const { coercePath } = require("../plugins/shape-plus/path-native-channels.js");
const { find } = require("../plugins/shape-plus/editor-tree-data.js");
const { FIELD, getMasks } = require("../plugins/shape-plus/mask-model.js");
const { clone } = require("../plugins/shape-plus/model.js");
const { evaluate, verticesToCubics } = require("../plugins/shape-plus/path.js");

function setup(t, kind, flags = {}) {
  const shape = kind === "shape";
  const make = shape ? path : mask;
  const points = shape ? [vertex([-60, 20], [0, 0], [18, 6]), vertex([25, 20], [-16, 5])] :
    [vertex([40, 44], [0, 0], [18, 6]), vertex([96, 44], [-16, 5])];
  const item = make("p", points, flags);
  if (flags.edit) flags.edit(item);
  const h = fixture(t, { phase3: true, offset: 5, ...(shape ? { contents: [item] } : { masks: [item] }) });
  return { ...h, item, saved: () => h.snapshot().find(item => item.id === "p") };
}
function button(container, label) {
  const result = container.querySelectorAll("button").find(node => node.title === label);
  assert.ok(result, label);
  return result;
}
function press(h, element, props) {
  assert.ok(element);
  return h.fire(element, "click", props);
}
function screenPoints(h) {
  const canvas = h.state().canvasApi;
  return canvas.cssPoints(canvas.active()).map(vertex => vertex.point);
}
function near(actual, expected) {
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-7, `${value} != ${expected[i]}`));
}
function history(h, size) {
  assert.equal(h.editor.history.undoStack.length, size);
  assert.equal(h.editor.history.operation, null);
}
function row(h, layer = h.layer) {
  return h.editRow(layer);
}

for (const kind of ["shape", "mask"]) {
  test(kind + " row and overlay share off, armed and keyed states with offset-aware navigation", t => {
    const h = setup(t, kind);
    const shape = kind === "shape";
    let properties;
    if (shape) {
      properties = h.editRow(h.layer.contents[0].properties.path);
      h.PZ.ui.controls.createControls(properties, properties.pz_object, false);
    } else properties = row(h);
    assert.equal(h.activate("p"), true);
    const overlay = h.state().canvas.parentElement.querySelector(".zoidium-path-keys");
    const diamond = button(overlay, "Toggle path keyframe");
    assert.equal(diamond.getAttribute("data-key-state"), "off");
    press(h, shape ? button(properties, "Toggle path keyframe") : properties.querySelector(".mask-row-key"));
    h.frame();
    assert.equal(diamond.getAttribute("data-key-state"), "keyed");
    assert.ok(frames(h.saved()).includes(15));
    h.editor.playback.currentFrame = 28;
    h.frame();
    assert.equal(diamond.getAttribute("data-key-state"), "armed");
    if (!shape) assert.match(properties.querySelector(".mask-row-key").title, /Animation on/);
    press(h, diamond);
    assert.deepEqual(frames(h.saved()), [0, 15, 23]);
    history(h, 2);
    press(h, button(overlay, "Previous path keyframe"));
    assert.equal(h.editor.playback.currentFrame, 20);
    press(h, button(overlay, "Next path keyframe"));
    assert.equal(h.editor.playback.currentFrame, 28);
    press(h, diamond);
    assert.deepEqual(frames(h.saved()), [0, 15]);
    history(h, 3);
    press(h, button(overlay, "Toggle path animation"));
    assert.equal(diamond.getAttribute("data-key-state"), "off");
    assert.deepEqual(frames(h.saved()), [0]);
    history(h, 4);
    h.editor.history.undo();
    h.frame();
    assert.equal(diamond.getAttribute("data-key-state"), "armed");
  });

  test(kind + " V drag updates all selected vertices in one logical key and supports cancel, undo and redo", t => {
    const h = setup(t, kind, { animated: true });
    assert.equal(h.activate("p"), true);
    h.state().snap = false;
    h.key("v");
    h.key("a", { ctrlKey: true });
    const before = h.saved(), values = h.points();
    const start = screenPoints(h)[0], end = [start[0] + 8, start[1] + 12];
    h.pointer("pointerdown", start);
    h.pointer("pointermove", end);
    assert.deepEqual(frames(h.saved()), [0, 15, 40]);
    h.key("Escape");
    assert.deepEqual(h.saved(), before);
    history(h, 0);
    h.drag(start, end);
    assert.deepEqual(frames(h.saved()), [0, 15, 40]);
    assert.deepEqual(channels(h.saved()).map(channel => channel.keyframes.length), Array(12).fill(3));
    h.points().forEach((point, i) => near(point.point, [values[i].point[0] + 8, values[i].point[1] + (kind === "shape" ? -12 : 12)]));
    history(h, 1);
    const after = h.saved();
    h.editor.history.undo();
    assert.deepEqual(h.saved(), before);
    h.editor.history.redo();
    assert.deepEqual(h.saved(), after);
  });

  test(kind + " Pen splits a keyed cubic, deletes globally and appends an endpoint", t => {
    const h = setup(t, kind, { animated: true, edit(item) { item.properties.path.keyframes[1].tween = 3; } });
    h.activate("p");
    h.state().snap = false;
    const property = () => h.state().active().properties.path;
    const pointsAt = frame => {
      const values = property().get(frame);
      return Array.from({ length: values.length / 6 }, (_, i) => {
        const [x, y, ix, iy, ox, oy] = values.slice(i * 6, i * 6 + 6);
        return { point: [x, y], in: [ix, iy], out: [ox, oy] };
      });
    };
    const times = [0, 9.5, 15, 21.5, 40];
    const curves = times.map(frame => verticesToCubics(pointsAt(frame), false)[0]);
    const canvas = h.state().canvasApi;
    const mid = canvas.screen(evaluate(curves[2], .5), canvas.active().matrix);
    h.key("q");
    const split = canvas.hit(mid).t;
    h.click(mid);
    const inserted = h.saved().vertexIds[1];
    assert.notEqual(inserted, "p-1");
    assert.deepEqual(frames(h.saved()), [0, 40]);
    times.forEach((frame, i) => {
      const [left, right] = verticesToCubics(pointsAt(frame), false);
      near(evaluate(left, .42), evaluate(curves[i], .42 * split));
      near(evaluate(right, .42), evaluate(curves[i], split + .42 * (1 - split)));
    });
    history(h, 1);
    h.key("Delete");
    assert.deepEqual(h.saved().vertexIds, ["p-0", "p-1"]);
    history(h, 2);
    h.click(screenPoints(h).at(-1));
    h.click([225, 115]);
    assert.equal(h.saved().vertexIds.length, 3);
    assert.deepEqual(frames(h.saved()), [0, 40]);
    history(h, 3);
  });

  test(kind + " surfaces native topology certification failures without changing data or history", t => {
    const h = setup(t, kind, { closed: true, animated: true, edit(item) {
      item.properties.path.keyframes[1].tween = 3;
      const separate = coercePath(item.properties.path, "objects");
      separate.objects[1].keyframes[1].frame = 33;
      item.properties.path = separate;
    } });
    h.activate("p");
    const before = h.saved();
    h.command(screenPoints(h)[1]).action();
    assert.match(h.notices.at(-1), /Synchronization changes interpolation/);
    history(h, 0);
    assert.deepEqual(h.saved(), before);
  });

  test(kind + " timeline click, native drag and Delete use clip time and one entry per write", t => {
    const h = setup(t, kind, { animated: true });
    const { panel, timeline } = h;
    const nodes = () => panel.container.querySelectorAll(".keyframe");
    const label = kind === "mask" ? ["Masks", "Mask p", "Mask Path"] : ["Shape+", "Path", "Path"];
    assert.deepEqual(panel.labels.children.map(node => node.textContent), label);
    assert.deepEqual(nodes().map(node => node.style.left), ["10px", "90px"]);
    h.clip.start = 30;
    h.clip.offset = 8;
    panel.objectOffsetChanged({ pz_offset: 10 }, h.clip);
    nodes()[0].pz_frame = 9999;
    panel.zoom();
    assert.deepEqual(nodes().map(node => node.style.left), ["44px", "124px"]);
    let node = nodes()[0];
    h.fire(node, "mousedown", { pageX: 44 });
    h.fire(h.document, "mouseup", { pageX: 44 });
    assert.equal(h.editor.playback.currentFrame, 22);
    history(h, 0);
    node = nodes()[0];
    h.fire(node, "mousedown", { pageX: 44 });
    h.fire(h.document, "mousemove", { pageX: 54, shiftKey: true });
    h.fire(h.document, "mouseup", { pageX: 54, shiftKey: true });
    assert.deepEqual(frames(h.saved()), [5, 40]);
    history(h, 1);
    panel.el.onkeydown({ key: "Delete", stopPropagation() {}, preventDefault() {} });
    assert.deepEqual(frames(h.saved()), [40]);
    history(h, 2);
    h.editor.history.undo();
    assert.deepEqual(frames(h.saved()), [5, 40]);
    h.editor.history.undo();
    assert.deepEqual(frames(h.saved()), [0, 40]);
    h.switchClip(null);
    assert.deepEqual(nodes(), []);
    h.switchClip(h.clip);
    assert.equal(nodes().length, 2);
    if (kind === "mask") {
      const headlessRow = nodes()[0];
      assert.equal(h.activate("p"), true);
      h.frame();
      assert.notEqual(nodes()[0], headlessRow);
      const mountedRow = nodes()[0];
      h.maskOverlay.setMode("off");
      h.frame();
      assert.notEqual(nodes()[0], mountedRow);
    }
    const replacement = new h.PZ.project();
    h.editor.sequence = replacement.sequence;
    h.editor.project = replacement;
    assert.deepEqual(nodes(), []);
    h.dispose();
    assert.notEqual(timeline.keyframes.keyframe_drag.start, undefined);
  });
}

const settled = () => new Promise(resolve => setImmediate(resolve));

test("path clipboard uses the existing Ctrl/Cmd handler, evaluates source space at paste, and forwards native text", async t => {
  const h = setup(t, "mask", { animated: true });
  const shape = h.addClip({ contents: [] });
  h.activate("p");
  assert.equal(h.key("c", { metaKey: true }).defaultPrevented, true);
  await settled();
  const envelope = JSON.parse(h.clipboard.text);
  assert.equal(envelope.type, "zoidium-path");
  h.layer.properties.position.set([24, -10, 0], 0);
  h.switchClip(shape);
  h.state().canvas.focus();
  assert.equal(h.key("v", { ctrlKey: true }).defaultPrevented, true);
  await settled();
  const group = shape.object.contents[0];
  assert.equal(group.kind, "group");
  assert.equal(group.contents[1].kind, "fill");
  const copied = clone(group.contents[0]);
  assert.notEqual(copied.id, "p");
  assert.notEqual(copied.vertexIds[0], "p-0");
  const saved = channels(copied);
  assert.deepEqual(frames(copied), [0, 40]);
  near(saved.slice(0, 6).map(channel => channel.keyframes[0].value), [-56, 26, 0, 0, 18, -6]);
  history(h, 1);
  h.editor.history.undo();
  assert.equal(shape.object.contents.length, 0);
  h.editor.history.redo();
  assert.deepEqual(clone(shape.object.contents[0].contents[0]), copied);
  let forwarded = 0;
  h.state().canvas.addEventListener("keydown", () => { forwarded++; });
  h.clipboard.text = "native package";
  h.key("v", { ctrlKey: true });
  await settled();
  assert.equal(forwarded, 1);
  history(h, 1);
});

test("cut removes only after clipboard success and the same shortcut respects mask locks", async t => {
  const h = setup(t, "mask");
  h.activate("p");
  const write = h.clipboard.writeText;
  h.clipboard.writeText = async () => { throw Error("Clipboard is unavailable"); };
  h.key("x", { ctrlKey: true });
  await settled();
  assert.ok(h.saved());
  assert.match(h.notices.at(-1), /Clipboard is unavailable/);
  history(h, 0);
  h.clipboard.writeText = write;
  h.key("x", { ctrlKey: true });
  await settled();
  assert.equal(h.saved(), undefined);
  history(h, 1);
  h.editor.history.undo();
  h.activate("p");
  const maskRow = row(h);
  press(h, maskRow.querySelector(".mask-row-lock"));
  h.state().canvas.focus();
  h.key("x", { ctrlKey: true });
  await settled();
  assert.match(h.notices.at(-1), /locked/);
  assert.ok(h.saved());
  history(h, 1);
});

test("Shape+ clipboard certifies mixed linear schedules under a rotated group and preserves them in a mask", async t => {
  const source = path("p", [vertex([-60, 20]), vertex([25, 20])], { animated: true });
  const separate = coercePath(source.properties.path, "objects");
  separate.objects[1].keyframes[1].frame = 25;
  source.properties.path = separate;
  const angle = .37, cos = Math.cos(angle), sin = Math.sin(angle);
  const h = fixture(t, { phase3: true, contents: [group("parent", [source], {
    position: [4, -7], scale: [1, 1], rotation: angle,
  })] });
  const scene = h.addClip({ masks: [] });
  h.activate("p");
  const times = [0, 7.5, 25, 31.5, 40];
  const expected = times.map(frame => {
    const [x, y] = h.state().active().properties.path.get(frame);
    return [124 + cos * x - sin * y, 87 - sin * x - cos * y];
  });
  h.key("c", { ctrlKey: true });
  await settled();
  h.switchClip(scene);
  h.viewport.el.focus();
  h.key("q");
  h.state().canvas.focus();
  h.key("v", { metaKey: true });
  await settled();
  const [saved] = getMasks(scene.object);
  assert.ok(saved, h.notices.join(", "));
  assert.deepEqual(frames(saved), [0, 25, 40]);
  assert.ok(saved.properties.path.objects);
  const property = h.sessionFor(scene.object).find(saved.id).properties.path;
  times.forEach((frame, i) => near(Array.from(property.get(frame)).slice(0, 2), expected[i]));
  history(h, 1);
});

test("Mask and Objects row menus convert in both directions, preserving source on failure", t => {
  const h = setup(t, "mask", { animated: true });
  const shape = h.addClip({ contents: [group("parent", [], { position: [0, 0], scale: [1, 1], rotation: 0 })] });
  const maskRow = row(h);
  h.fire(maskRow.querySelector(".mask-row-name"), "contextmenu", { clientX: 17, clientY: 23 });
  const toShape = h.menu().find(item => item.label === "Convert to Shape+");
  assert.ok(toShape);
  const before = h.saved();
  h.viewport.renderMode = true;
  toShape.action();
  assert.match(h.notices.at(-1), /composited view/);
  assert.deepEqual(h.saved(), before);
  h.viewport.renderMode = false;
  shape.object.properties.scale.set([0, 1, 1], 0);
  toShape.action();
  assert.match(h.notices.at(-1), /invertible/);
  assert.deepEqual(h.saved(), before);
  history(h, 0);
  shape.object.properties.scale.set([1, 1, 1], 0);
  toShape.action();
  assert.equal(h.saved(), undefined);
  history(h, 1);
  const painted = shape.object.contents[1];
  assert.equal(painted.contents[1].kind, "fill");
  const copied = painted.contents[0], objectRow = h.editRow(copied);
  h.switchClip(shape);
  objectRow.oncontextmenu({ clientX: 24, clientY: 48, preventDefault() {}, stopPropagation() {} });
  const toMask = h.menu().find(item => item.label === "Convert to Mask");
  assert.ok(toMask);
  toMask.action();
  assert.equal(find(shape.object.contents, copied.id), null);
  const [converted] = getMasks(h.layer);
  assert.equal(converted.mode, "add");
  assert.deepEqual(frames(converted), [0, 40]);
  assert.deepEqual(channels(converted).map(c => c.keyframes.map(key => key.value)),
    channels(before).map(c => c.keyframes.map(key => key.value)));
  history(h, 2);
  h.editor.history.undo();
  assert.ok(find(shape.object.contents, copied.id));
  assert.deepEqual(getMasks(h.layer), []);
  h.editor.history.undo();
  assert.deepEqual(h.saved(), before);
  assert.equal(shape.object.contents.length, 1);
});

test("Shift-click row selection drives one animated V transform and order change across unlocked masks", t => {
  const h = fixture(t, { phase3: true, masks: [
    mask("a", [vertex([30, 50]), vertex([65, 50])], { animated: true }),
    mask("spacer", [vertex([42, 125]), vertex([70, 125])]),
    mask("b", [vertex([86, 72]), vertex([115, 72])]),
    mask("lock", [vertex([165, 88]), vertex([205, 88])], { locked: true }),
  ] });
  const panel = row(h);
  const names = () => panel.querySelectorAll(".mask-row-name");
  const choose = (id, shiftKey = false) => press(h, names().find(node => node.textContent.startsWith("Mask " + id)), { shiftKey });
  for (const id of ["lock", "a", "b"]) {
    choose(id, id !== "lock");
    assert.equal(h.paths.controller.activePathId, id);
    h.click(screenPoints(h)[0]);
  }
  assert.equal(panel.querySelectorAll(".mask-row-view.is-selected").length, 3);
  h.state().snap = false;
  h.key("v");
  const before = h.snapshot(), [x, y] = screenPoints(h)[0];
  h.pointer("pointerdown", [x, y]);
  h.pointer("pointermove", [x + 10, y + 8]);
  assert.deepEqual(frames(h.snapshot()[0]), [0, 10, 40]);
  h.key("Escape");
  assert.deepEqual(h.snapshot(), before);
  history(h, 0);
  h.drag([x, y], [x + 10, y + 8]);
  const after = h.snapshot();
  assert.deepEqual(frames(after[0]), [0, 10, 40]);
  near(channels(after[0]).slice(0, 2).map(c => c.keyframes[1].value), [47.5, 70.5]);
  near(channels(after[2]).slice(0, 2).map(c => c.keyframes[0].value), [96, 80]);
  assert.deepEqual(after[3], before[3]);
  history(h, 1);
  h.editor.history.undo();
  assert.deepEqual(h.snapshot(), before);
  h.editor.history.redo();
  assert.deepEqual(h.snapshot(), after);
  const maskB = panel.querySelectorAll(".mask-row-view").find(node => node.getAttribute("aria-label") === "Mask b");
  press(h, maskB.querySelector(".mask-row-up"));
  assert.deepEqual(h.snapshot().map(mask => mask.id), ["a", "b", "lock", "spacer"]);
  history(h, 2);
  choose("b", true);
  assert.equal(panel.querySelectorAll(".mask-row-view.is-selected").length, 2);
  assert.equal(h.paths.controller.activePathId, "a");
});

test("legacy grouped masks save byte-identically before editing and after undo", t => {
  const h = setup(t, "mask", { animated: true });
  const original = JSON.stringify(h.layer.toJSON());
  row(h);
  h.activate("p");
  h.frame();
  assert.equal(JSON.stringify(h.layer.toJSON()), original);
  const data = h.layer.toJSON();
  const fresh = h.addClip({ masks: [], load: false }).object;
  fresh.load(clone(data));
  assert.equal(JSON.stringify(fresh[FIELD]), JSON.stringify(data[FIELD]));
  h.state().canvas.focus();
  h.editor.playback.currentFrame = 19;
  h.frame();
  const overlay = h.state().canvas.parentElement.querySelector(".zoidium-path-keys");
  press(h, button(overlay, "Toggle path keyframe"));
  const keyed = h.layer.toJSON();
  const reloaded = h.addClip({ masks: [], load: false }).object;
  reloaded.load(clone(keyed));
  assert.equal(JSON.stringify(reloaded[FIELD]), JSON.stringify(keyed[FIELD]));
  assert.deepEqual(frames(reloaded[FIELD][0]), [0, 14, 40]);
  h.editor.history.undo();
  assert.equal(JSON.stringify(h.layer.toJSON()), original);
});

test("independent mask schedules survive a real row edit and native save and reload", t => {
  const h = setup(t, "mask", { animated: true, edit(item) {
    const separate = coercePath(item.properties.path, "objects");
    separate.objects[1].keyframes[1].frame = 35;
    item.properties.path = separate;
  } });
  const before = JSON.stringify(h.layer.toJSON());
  const properties = row(h);
  press(h, properties.querySelector(".mask-row-key"));
  const after = h.layer.toJSON();
  const loaded = h.addClip({ masks: [], load: false }).object;
  loaded.load(clone(after));
  assert.equal(JSON.stringify(loaded[FIELD]), JSON.stringify(after[FIELD]));
  assert.deepEqual(loaded[FIELD][0].properties.path.objects[1].keyframes.map(key => key.frame), [0, 15, 35]);
  history(h, 1);
  h.editor.history.undo();
  assert.equal(JSON.stringify(h.layer.toJSON()), before);
});

test("opening Shape+ keys and the timeline leaves an old project's serialized paths unchanged", t => {
  const h = setup(t, "shape", { animated: true, edit(item) { item.properties.path.keyframes[1].tween = 3; } });
  const original = JSON.stringify(h.layer.toJSON()), native = h.layer.contents[0].properties.path;
  const evaluated = [0, 10, 30, 40].map(frame => Array.from(native.get(frame)));
  h.activate("p");
  h.frame();
  assert.equal(JSON.stringify(h.layer.toJSON()), original);
  const reloaded = h.addClip({ contents: [], load: false }).object;
  reloaded.load(JSON.parse(original));
  assert.equal(JSON.stringify(reloaded.toJSON()), original);
  assert.deepEqual([0, 10, 30, 40].map(frame => Array.from(reloaded.contents[0].properties.path.get(frame))), evaluated);
  const overlay = h.state().canvas.parentElement.querySelector(".zoidium-path-keys");
  press(h, button(overlay, "Toggle path keyframe"));
  const keyed = JSON.stringify(h.layer.toJSON()), keyedLayer = h.addClip({ contents: [], load: false }).object;
  keyedLayer.load(JSON.parse(keyed));
  assert.equal(JSON.stringify(keyedLayer.toJSON()), keyed);
  assert.deepEqual(frames(clone(keyedLayer.contents[0])), [0, 15, 40]);
});
