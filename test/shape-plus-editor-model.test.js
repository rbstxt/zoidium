"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { PZ } = require("./shape-plus-host.js");
const { createModel, clone } = require("../plugins/shape-plus/model.js");
const { createEditorModel } = require("../plugins/shape-plus/editor-model.js");
const { selectionKey } = require("../plugins/shape-plus/editor-selection.js");
class History {
  constructor() {
    this.operation = null;
    this.entries = [];
  }
  startOperation() {
    this.operation = [];
  }
  pushCommand(fn, p) {
    this.operation.push({ fn, p });
  }
  finishOperation() {
    if (this.operation.length) this.entries.push(this.operation);
    this.operation = null;
  }
  discardOperation() {
    this.operation = null;
  }
}
PZ.clip = class {};
PZ.keyframe = class {
  constructor(value, frame, tween) {
    Object.assign(this, {
      value,
      frame,
      tween,
      controlPoints: [
        [-10, 0],
        [10, 0],
      ],
    });
  }
};
Object.defineProperties(PZ.property.prototype, {
  keyframes: {
    get() {
      return this.data?.keyframes;
    },
  },
  animated: {
    get() {
      return this.objects
        ? this.objects.some((p) => p.animated)
        : !!this.data?.animated;
    },
    set(value) {
      this.data.animated = value;
    },
  },
  onKeyframeCreated: {
    get() {
      return { update() {} };
    },
  },
});
PZ.property.prototype.hasKeyframe = function (frame) {
  return this.keyframes.some((k) => k.frame === frame);
};
PZ.property.prototype.getClosestKeyframeIndex = function (frame) {
  const index = this.keyframes.findIndex((k) => k.frame >= frame);
  return index < 0 ? this.keyframes.length - 1 : index;
};
PZ.property.prototype.addKeyframe = function (key) {
  this.keyframes.push(key);
  this.keyframes.sort((a, b) => a.frame - b.frame);
};
PZ.property.prototype.set = function (value, frame) {
  if (this.objects) this.objects.forEach((p, i) => p.set(value[i], frame));
  else if (this.data)
    this.keyframes[this.getClosestKeyframeIndex(frame)].value = value;
  else this.value = value;
};
function host() {
  const { Content } = createModel(PZ),
    layer = {
      type: "shape",
      getAddress: () => [0],
      contents: null,
      tryGetParentOfType: () => ({ start: 10, offset: 5 }),
    };
  layer.contents = new PZ.objectList(null, Content);
  const path = new Content("path", { id: "path", vertexIds: ["a:in", "b"] });
  path.load({
    id: "path",
    vertexIds: ["a:in", "b"],
    properties: {
      closed: 0,
      path: {
        animated: true,
        keyframes: [
          {
            frame: 0,
            value: [0, 0, 0, 0, 10, 10, 50, 0, -10, 10, 0, 0],
            tween: 7,
          },
          {
            frame: 30,
            value: [0, 10, 0, 0, 10, 10, 50, 10, -10, 10, 0, 0],
            tween: 7,
          },
        ],
      },
    },
  });
  layer.contents.push(path);
  const project = {
      target: layer,
      addressLookup() {
        return this.target;
      },
      ui: {
        onChanged: {
          count: 0,
          update() {
            this.count++;
          },
        },
      },
    },
    editor = {
      project,
      history: new History(),
      playback: { currentFrame: 20 },
    };
  const s = {
    PZ,
    Content,
    layer,
    editor,
    project,
    activeId: "path",
    selection: new Set([selectionKey("a:in")]),
    treeSelection: new Set(["path"]),
    nextId: () => "new",
    message: (text) => {
      throw Error(text);
    },
  };
  createEditorModel(s);
  return { s, project, editor, layer, path, Content };
}
test("editor edits create synchronized native keys at local clip time, with one gesture entry", () => {
  const { s, project, editor, path } = host();
  assert.equal(s.localFrame(), 15);
  const before = clone(s.layer.contents);
  assert.equal(s.gesture.begin(), true);
  const points = s.pathPoints();
  points[0].point[0] += 20;
  s.setPoints(points);
  assert.equal(
    project.ui.onChanged.count,
    0,
    "preview must not publish project revisions during a gesture",
  );
  assert.ok(
    path.properties.path.objects.every(
      (p) => JSON.stringify(p.keyframes.map((k) => k.frame)) === "[0,15,30]",
    ),
  );
  s.gesture.finish();
  assert.equal(editor.history.entries.length, 1);
  editor.history.startOperation();
  const entry = editor.history.entries[0][0];
  entry.fn(entry.p);
  editor.history.finishOperation();
  assert.deepEqual(clone(s.layer.contents), before);
});
test("target deletion cannot restore canceled geometry into another layer at the same address", () => {
  const { s, project, editor, layer } = host();
  s.gesture.begin();
  s.setPoints(s.pathPoints().map((v) => ({ ...v, point: [100, 100] })));
  const other = { type: "shape", contents: [] };
  project.target = other;
  s.gesture.finish(true);
  assert.deepEqual(other.contents, []);
  assert.equal(editor.history.operation, null);
  assert.equal(editor.history.entries.length, 0);
  assert.notEqual(layer, other);
});
test("deleting punctuation-bearing anchor IDs updates every path key", () => {
  const { s } = host();
  s.deleteAnchors();
  assert.deepEqual(s.active().vertexIds, ["b"]);
  assert.equal(s.active().properties.path.objects.length, 6);
  assert.ok(
    s
      .active()
      .properties.path.objects.every(
        (p) => JSON.stringify(p.keyframes.map((k) => k.frame)) === "[0,30]",
      ),
  );
});
