"use strict";
// Fix 3: operation-scoped editor scene snapshots. The old full-walk scene is
// kept here as the exactness reference: the same picks, bounds, snap results
// and drawn handle positions as before.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { PZ } = require("./shape-plus-host.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const canvasModule = require("../plugins/shape-plus/editor-canvas.js");
const { scene, createCanvas } = canvasModule;
const { matrix, identity, transform } = require("../plugins/shape-plus/compiler.js");
const { find } = require("../plugins/shape-plus/editor-tree-data.js");
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

// A canvas harness with stub DOM: CSS pixels, a real display mapping, and a
// recording 2d context. isPointInPath stays false so itemAt resolves through
// the shared g.hit path in both old and new code.
global.ResizeObserver ??= class { constructor() {} observe() {} disconnect() {} };
function makeContext() {
  const ctx = { calls: [] };
  for (const name of ["save", "restore", "setTransform", "beginPath", "moveTo", "lineTo",
    "bezierCurveTo", "closePath", "stroke", "fillRect", "strokeRect", "arc", "fill",
    "clearRect", "setLineDash"])
    ctx[name] = (...args) => { ctx.calls.push([name, ...args]); };
  ctx.isPointInPath = () => false;
  return ctx;
}
function pathValues(vertices) {
  return vertices.flatMap(([[px, py], [ix, iy], [ox, oy]]) => [px, py, ix, iy, ox, oy]);
}
function buildCanvasLayer() {
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
            position: {
              animated: true,
              keyframes: [{ frame: 0, value: [0, 0], tween: 1 }, { frame: 30, value: [60, 20], tween: 1 }],
            },
            scale: { animated: false, keyframes: [{ frame: 0, value: [2, 2], tween: 1 }] },
          },
          contents: [
            {
              id: "path", kind: "path", vertexIds: ["a", "b", "c"],
              properties: {
                closed: 0,
                path: {
                  animated: false,
                  keyframes: [{
                    frame: 0,
                    value: pathValues([
                      [[10, 10], [0, 0], [0, 0]],
                      [[110, 10], [0, 0], [30, -30]],
                      [[110, 110], [-30, 30], [0, 0]],
                    ]),
                    tween: 1,
                  }],
                },
              },
            },
            { id: "rect", kind: "rectangle", properties: {} },
          ],
        },
        {
          id: "off", kind: "group", properties: { enabled: 0 }, contents: [
            {
              id: "hidden-path", kind: "path", vertexIds: ["h1", "h2"],
              properties: {
                closed: 0,
                path: {
                  animated: false,
                  keyframes: [{
                    frame: 0,
                    value: pathValues([[[300, 300], [0, 0], [0, 0]], [[350, 300], [0, 0], [0, 0]]]),
                    tween: 1,
                  }],
                },
              },
            },
          ],
        },
      ],
    },
    {
      id: "top", kind: "path", vertexIds: ["t1", "t2", "t3", "t4"],
      properties: {
        closed: 1,
        path: {
          animated: false,
          keyframes: [{
            frame: 0,
            value: pathValues([
              [[400, 400], [0, 0], [0, 0]], [[500, 400], [0, 0], [0, 0]],
              [[500, 500], [0, 0], [0, 0]], [[400, 500], [0, 0], [0, 0]],
            ]),
            tween: 1,
          }],
        },
      },
    },
  ];
  for (const item of data) { const node = new Content(item.kind, item); layer.contents.push(node); node.load(item); }
  return layer;
}
function host(frameState) {
  const layer = buildCanvasLayer();
  layer.properties = {
    position: { get: () => [0, 0] },
    scale: { get: () => [1, 1] },
    rotation: { get: () => 0 },
  };
  const rect = { left: 0, top: 0, width: 800, height: 600 };
  const ctx = makeContext();
  const canvas = {
    style: {}, width: 0, height: 0,
    ownerDocument: { defaultView: { devicePixelRatio: 1 } },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ ...rect }),
    focus() {},
    addEventListener() {},
    removeEventListener() {},
  };
  const s = {
    layer, frame: frameState.value,
    localFrame: () => s.frame,
    activeId: "path",
    selection: new Set(), treeSelection: new Set(["outer"]),
    tool: "select", penFinished: false, snap: true,
    hover: null, pointer: { active: false }, dirty: false,
    viewport: {
      canvas: { getBoundingClientRect: () => ({ ...rect }) },
      el: { getBoundingClientRect: () => ({ left: 0, top: 0 }), clientLeft: 0 },
    },
    editor: { sequence: { properties: { resolution: { get: () => [1280, 720] } } } },
    find: (id) => find(layer.contents, id)?.item || null,
    active: () => s.find(s.activeId),
    refresh() { s.dirty = true; },
  };
  const api = createCanvas(s, canvas);
  s.canvasApi = api;
  // Mirrors the production wiring in editor-model.js: a mutation ends the
  // current read scope so later reads see fresh data.
  s.preview = () => api.invalidateScene();
  assert.ok(api.resize(), "projection builds");
  return { s, api, layer, ctx };
}
// Independent reference for picks: the old walk plus the documented screen
// projection, resolved through the same g.hit contract.
function refCss(projection, entry) {
  const combined = g.multiply(projection, entry.matrix);
  return entry.path.vertices.map((v) => ({
    point: transform(v.point, combined),
    in: g.sub(transform(g.add(v.point, v.in), combined), transform(v.point, combined)),
    out: g.sub(transform(g.add(v.point, v.out), combined), transform(v.point, combined)),
  }));
}
function refHit(contents, frame, projection, activeId, point, tool = "select") {
  const entry = oldScene(contents, frame).find((e) => e.item.id === activeId);
  if (!entry?.enabled || entry.item.kind !== "path") return null;
  return g.hit(refCss(projection, entry), entry.path.closed, point, 1, true, tool === "pen");
}
function refItemAt(contents, frame, projection, point) {
  for (const e of oldScene(contents, frame)) {
    if (!e.enabled) continue;
    // isPointInPath is stubbed false, so only the shared outline band picks.
    if (g.hit(refCss(projection, e), e.path.closed, point, 1, false)) return e.item.id;
  }
  return null;
}
function queryGrid() {
  const points = [];
  for (let x = 100; x <= 700; x += 40)
    for (let y = 60; y <= 540; y += 40) points.push([x, y]);
  return points;
}
// One scene build serves a whole read-only event: hit, active lookup, local
// conversion, snap and selection outline reads share it.
test("one scene build per read scope", () => {
  const { s, api, layer } = host({ value: 15 });
  let leaves = 0, counted = 0;
  (function walk(list) {
    for (const item of list) {
      if (item.kind === "group") walk(item.contents);
      else {
        leaves++;
        const original = item.evaluate.bind(item);
        item.evaluate = (frame, rate) => { counted++; return original(frame, rate); };
      }
    }
  })(layer.contents);
  const results = api.scoped(() => {
    api.active();
    api.hit([300, 300]);
    api.itemAt([300, 300]);
    api.local([300, 300]);
    api.snap([60, 30], []);
    api.outlines("outer");
    api.cssPoints(api.active());
    return true;
  });
  assert.ok(results);
  assert.equal(counted, leaves, `one build evaluates each leaf once (${leaves} leaves)`);
});
test("the scope ends after the event and a write starts a fresh build", () => {
  const { s, api, layer } = host({ value: 15 });
  let builds = 0;
  const path = find(layer.contents, "path").item;
  const original = path.evaluate.bind(path);
  path.evaluate = (frame, rate) => { builds++; return original(frame, rate); };
  api.scoped(() => { api.entries(); });
  assert.equal(builds, 1);
  api.scoped(() => { api.entries(); });
  assert.equal(builds, 2, "no snapshot is retained across scopes");
  const before = api.scoped(() => api.hit([494, 275])?.kind);
  assert.equal(builds, 3, "each closed scope rebuilds");
  api.scoped(() => {
    api.entries();
    assert.equal(builds, 4);
    const points = g.vertices(path.properties.path.get(15));
    points[0].point = [1000, 1000];
    path.properties.path.set(g.values(points), 15);
    s.preview();
    assert.equal(api.hit([494, 275]), null, "the moved anchor no longer hits its old pixel");
    assert.equal(builds, 5, "reads after the write rebuild once");
  });
  assert.equal(before, "anchor");
});
test("scoped reads match unscoped reads exactly", () => {
  const { api } = host({ value: 15 });
  const readAll = () => ({
    hit: api.hit([300, 300]),
    item: api.itemAt([300, 300])?.item.id || null,
    local: api.local([300, 300]),
    snap: api.snap([60, 30], []),
    outlines: api.outlines("outer").map((e) => e.item.id),
    css: api.cssPoints(api.active()),
    entryIds: api.entries().map((e) => e.item.id),
  });
  const unscoped = readAll();
  const scoped = api.scoped(readAll);
  assert.deepEqual(scoped, unscoped);
});
test("picks match the old walk under nested transforms, disabled groups and frame changes", () => {
  for (const frame of [0, 15, 30]) {
    const { s, api, layer } = host({ value: frame });
    s.frame = frame;
    const projection = api.projection();
    for (const point of queryGrid()) {
      assert.deepEqual(api.hit(point), refHit(layer.contents, frame, projection, "path", point), `hit frame ${frame} point ${point}`);
      assert.equal(api.itemAt(point)?.item.id || null, refItemAt(layer.contents, frame, projection, point), `itemAt frame ${frame} point ${point}`);
    }
    // Snapping and bounds inputs match too: css vertices per entry by id.
    const fresh = {};
    for (const e of oldScene(layer.contents, frame)) fresh[e.item.id] = refCss(projection, e);
    for (const e of api.entries())
      assert.deepEqual(api.cssPoints(e), fresh[e.item.id], `css frame ${frame} ${e.item.id}`);
    for (const point of [[60, 30], [150, 40], [500, 300], [10, 10]]) {
      assert.deepEqual(api.snap(point, []), (() => {
        const entry = oldScene(layer.contents, frame).find((e) => e.item.id === "path");
        const world = transform(point, g.multiply(projection, entry.matrix));
        let closest = null, distance = 8;
        for (const other of oldScene(layer.contents, frame).filter((e) => e.enabled))
          other.path.vertices.forEach((v) => {
            const p = transform(v.point, g.multiply(projection, other.matrix));
            const d = Math.hypot(...g.sub(world, p));
            if (d < distance) { closest = p; distance = d; }
          });
        if (!closest) return point;
        const inv = g.inverse(g.multiply(projection, entry.matrix));
        return inv ? transform(closest, inv) : point;
      })(), `snap frame ${frame} point ${point}`);
    }
  }
});
test("marquee inputs match the old walk", () => {
  const { api, layer } = host({ value: 15 });
  const projection = api.projection();
  const start = [450, 250], end = [650, 450];
  const lo = [Math.min(start[0], end[0]), Math.min(start[1], end[1])],
    hi = [Math.max(start[0], end[0]), Math.max(start[1], end[1])];
  const inside = (p) => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1];
  // Anchor marquee over the active path.
  const pathEntry = api.scoped(() => api.active());
  const selected = [];
  api.scoped(() => {
    api.cssPoints(pathEntry).forEach((v, i) => {
      if (inside(v.point)) selected.push(pathEntry.item.vertexIds[i]);
    });
  });
  const refSelected = [];
  const refEntry = oldScene(layer.contents, 15).find((e) => e.item.id === "path");
  refCss(projection, refEntry).forEach((v, i) => {
    if (inside(v.point)) refSelected.push(refEntry.item.vertexIds[i]);
  });
  assert.deepEqual(selected, refSelected);
  // Whole-item marquee over top-level items.
  const picked = api.scoped(() => {
    const result = new Set();
    for (const top of layer.contents) {
      const points = api.outlines(top.id).flatMap((leaf) => api.cssPoints(leaf).map((v) => v.point));
      if (!points.length) continue;
      const min = [Math.min(...points.map((v) => v[0])), Math.min(...points.map((v) => v[1]))],
        max = [Math.max(...points.map((v) => v[0])), Math.max(...points.map((v) => v[1]))];
      if (min[0] <= hi[0] && max[0] >= lo[0] && min[1] <= hi[1] && max[1] >= lo[1]) result.add(top.id);
    }
    return [...result];
  });
  const refPicked = [];
  for (const top of layer.contents) {
    const entry = find(layer.contents, top.id);
    const insideIds = new Set([top.id]);
    (function walk(item) { for (const child of item.contents || []) { insideIds.add(child.id); walk(child); } })(entry.item);
    const points = oldScene(layer.contents, 15)
      .filter((e) => e.enabled && insideIds.has(e.item.id))
      .flatMap((e) => refCss(projection, e).map((v) => v.point));
    if (!points.length) continue;
    const min = [Math.min(...points.map((v) => v[0])), Math.min(...points.map((v) => v[1]))],
      max = [Math.max(...points.map((v) => v[0])), Math.max(...points.map((v) => v[1]))];
    if (min[0] <= hi[0] && max[0] >= lo[0] && min[1] <= hi[1] && max[1] >= lo[1]) refPicked.push(top.id);
  }
  assert.deepEqual(picked, refPicked);
});
test("CSS vertices are cached within a scope and rebuilt across scopes", () => {
  const { api } = host({ value: 15 });
  const same = api.scoped(() => {
    const a = api.active();
    const first = api.cssPoints(a), second = api.cssPoints(a);
    assert.equal(first, second, "same array within a scope");
    api.itemAt([300, 300]);
    assert.equal(api.cssPoints(a), first, "itemAt shares the cached vertices");
    return first;
  });
  const next = api.scoped(() => api.cssPoints(api.active()));
  assert.notEqual(next, same, "a new scope rebuilds");
  assert.deepEqual(next, same, "rebuilt vertices are equal");
});
test("repeated reads in one scope still build the scene once", () => {
  const { api, layer } = host({ value: 15 });
  let counted = 0, leaves = 0;
  (function walk(list) {
    for (const item of list) {
      if (item.kind === "group") walk(item.contents);
      else {
        leaves++;
        const original = item.evaluate.bind(item);
        item.evaluate = (frame, rate) => { counted++; return original(frame, rate); };
      }
    }
  })(layer.contents);
  api.scoped(() => {
    for (let i = 0; i < 3; i++) {
      api.hit([300, 300]);
      api.itemAt([200, 200]);
      api.itemAt([10, 10]);
      api.snap([60, 30], []);
      api.active();
      api.outlines("outer");
      api.cssPoints(api.active());
    }
  });
  assert.equal(counted, leaves, `repeated reads share one build (${leaves} leaves)`);
});
test("drawn handle positions match the old walk", () => {
  const frameState = { value: 15 };
  const { s, api, layer, ctx } = host(frameState);
  s.treeSelection = new Set(["path"]);
  s.activeId = "path";
  api.scoped(() => api.draw());
  const squares = ctx.calls.filter(([name]) => name === "fillRect").map(([, ...args]) => args);
  const knobs = ctx.calls.filter(([name]) => name === "arc").map(([, ...args]) => args);
  const refEntry = oldScene(layer.contents, 15).find((e) => e.item.id === "path");
  const css = refCss(api.projection(), refEntry);
  const expectedSquares = css.map((v) => [v.point[0] - 4, v.point[1] - 4, 8, 8]);
  const expectedKnobs = [];
  css.forEach((v, i) => {
    for (const side of ["in", "out"]) {
      if ((side === "in" && i === 0) || (side === "out" && i === css.length - 1)) continue;
      if (Math.hypot(...v[side]) < 1e-8) continue;
      const p = [v.point[0] + v[side][0], v.point[1] + v[side][1]];
      expectedKnobs.push([p[0], p[1], 3.5, 0, Math.PI * 2]);
    }
  });
  assert.deepEqual(squares, expectedSquares, "anchor squares");
  assert.deepEqual(knobs, expectedKnobs, "handle knobs");
});
