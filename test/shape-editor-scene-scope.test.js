"use strict";
// Fix 3: operation-scoped editor scene snapshots. The old full-walk scene is
// kept here as the exactness reference: the same picks, bounds, snap results
// and drawn handle positions as before.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { PZ } = require("./shape-plus-host.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const canvasModule = require("../plugins/shape-plus/editor-canvas.js");
const { scene } = canvasModule;
const { matrix, identity } = require("../plugins/shape-plus/compiler.js");
const g = require("../plugins/shape-plus/editor-geometry.js");

// Reference: the pre-fix walk. A group calls item.evaluate(), which evaluates
// its whole subtree, and then the walk evaluates every child again. Text reads
// properties and layout through two separate evaluate() calls.
function oldScene(contents, frame, parent = identity, enabled = true, result = []) {
  const { primitivePath } = require("../plugins/shape-plus/primitives.js");
  for (const item of contents) {
    const p = item.evaluate(frame).properties,
      visible = enabled && p.enabled !== 0;
    if (item.kind === "group")
      oldScene(item.contents, frame, g.multiply(parent, matrix(p)), visible, result);
    else if (item.kind === "text") {
      const layout = item.evaluate(frame).textLayout;
      const points = layout.glyphs.flatMap(glyph => glyph.paths.flatMap(path => path.vertices.map(v => v.point)));
      const x = points.length ? Math.min(...points.map(p => p[0])) : p.position[0], y = points.length ? Math.min(...points.map(p => p[1])) : p.position[1];
      const right = points.length ? Math.max(...points.map(p => p[0])) : x + 200, top = points.length ? Math.max(...points.map(p => p[1])) : y + 100;
      result.push({ item, matrix: parent, enabled: visible, properties: p, path: { closed: true, vertices: [[x, y], [right, y], [right, top], [x, top]].map(point => ({ point, in: [0, 0], out: [0, 0] })) } });
    }
    else if (["path", "rectangle", "ellipse", "polystar"].includes(item.kind))
      result.push({
        item,
        matrix: parent,
        enabled: visible,
        path: primitivePath({ id: item.id, kind: item.kind, vertexIds: item.vertexIds, properties: p }),
        properties: p,
      });
  }
  return result;
}

PZ.property.prototype.set = function (value, frame) {
  if (this.objects) this.objects.forEach((p, i) => p.set(value[i], frame));
  else if (this.data) this.data.keyframes[0].value = value;
  else this.value = value;
};

// Nested groups with transforms, a disabled group, and an animated group.
function buildLayer() {
  const { Content } = createModel(PZ);
  const layer = { contents: new PZ.objectList(null, Content) };
  const data = [
    {
      id: "outer", kind: "group",
      properties: { position: { animated: false, keyframes: [{ frame: 0, value: [100, 0], tween: 1 }] } },
      contents: [
        {
          id: "inner", kind: "group",
          properties: {
            position: { animated: true, keyframes: [{ frame: 0, value: [0, 0], tween: 1 }, { frame: 30, value: [60, 20], tween: 1 }] },
            scale: { animated: false, keyframes: [{ frame: 0, value: [2, 2], tween: 1 }] },
          },
          contents: [
            { id: "rect", kind: "rectangle", properties: {} },
            { id: "path", kind: "path", vertexIds: ["a", "b", "c"], properties: {} },
          ],
        },
        {
          id: "off", kind: "group", properties: { enabled: 0 }, contents: [
            { id: "hidden-path", kind: "path", vertexIds: ["h1", "h2"], properties: {} },
          ],
        },
      ],
    },
    { id: "top", kind: "path", vertexIds: ["t1", "t2", "t3", "t4"], properties: {} },
  ];
  for (const item of data) { const node = new Content(item.kind, item); layer.contents.push(node); node.load(item); }
  return { layer, Content };
}

function summarize(list) {
  return list.map((e) => ({
    id: e.item.id,
    kind: e.item.kind,
    matrix: e.matrix,
    enabled: e.enabled,
    properties: e.properties,
    path: e.path,
  }));
}

function countNodes(contents) {
  let leaves = 0, groups = 0;
  (function walk(list) {
    for (const item of list) {
      if (item.kind === "group") { groups++; walk(item.contents); }
      else leaves++;
    }
  })(contents);
  return { leaves, groups };
}

test("scene without group over-evaluation matches the old walk exactly", () => {
  for (const frame of [0, 7, 15, 30, 45]) {
    const { layer } = buildLayer();
    const expected = summarize(oldScene(layer.contents, frame));
    const { layer: fresh } = buildLayer();
    const actual = summarize(scene(fresh.contents, frame));
    assert.deepEqual(actual, expected, `frame ${frame}`);
  }
});

test("each node is evaluated exactly once per scene build", () => {
  const { layer } = buildLayer();
  let leaves = 0, groups = 0;
  (function walk(list) {
    for (const item of list) {
      if (item.kind === "group") {
        groups++;
        // The walk must never evaluate a group: that call evaluates the
        // whole subtree and the walk would evaluate every child again.
        item.evaluate = () => { throw Error("group over-evaluation"); };
      } else {
        leaves++;
        const original = item.evaluate.bind(item);
        let calls = 0;
        item.evaluate = (frame, rate) => { calls++; return original(frame, rate); };
        item.evaluate.calls = () => calls;
      }
      if (item.contents) walk(item.contents);
    }
  })(layer.contents);
  assert.ok(groups > 0 && leaves > 0, "fixture nests groups");
  scene(layer.contents, 15);
  (function walk(list) {
    for (const item of list) {
      if (item.kind !== "group") assert.equal(item.evaluate.calls(), 1, `${item.id} evaluated once`);
      if (item.contents) walk(item.contents);
    }
  })(layer.contents);
});
