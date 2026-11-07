"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { host, fixture, editorFor } = require("./helpers/editor-identity-host.cjs");

test("fixed-seed native edits, undo, and redo match an independent snapshot history", () => {
  const context = host(), { PZ } = context;
  vm.runInContext(fs.readFileSync("plugins/core/property-history.js", "utf8"), context);
  const { project, layer } = fixture(context), editor = editorFor(PZ, project);
  const ops = new PZ.ui.properties(editor), p = layer.properties.position.objects[0];
  p.animated = true; p.keyframes.push(new PZ.keyframe(10, 24, 1));
  const undo = [], redo = [], json = () => JSON.stringify(project);
  let seed = 0x554e444f, current = json(), edits = 0, undos = 0, redos = 0;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let step = 0; step < 600; step++) {
    const action = random(10), label = `seed 0x554e444f, step ${step}, action ${action}`;
    if (action < 3 && undo.length) {
      redo.push(current); current = undo.pop(); editor.history.undo(); undos++;
    } else if (action === 3 && redo.length) {
      undo.push(current); current = redo.pop(); editor.history.redo(); redos++;
    } else {
      const before = json(), previousLength = editor.history.undoStack.length;
      editor.history.startOperation();
      const address = p.getAddress(), frame = random(60), value = random(10000) / 100;
      if (action === 4) ops.setExpression({ property: address, expression: "value + " + value });
      else if (action === 5 && !p.hasKeyframe(frame)) {
        ops.createKeyframe({ property: address, data: new PZ.keyframe(value, frame, 1) });
      } else if (action === 6 && p.keyframes.length > 1) {
        ops.deleteKeyframe({ property: address, frame: p.keyframes[random(p.keyframes.length)].frame });
      } else if (action === 7) {
        const key = p.keyframes[random(p.keyframes.length)];
        ops.setTween({ property: address, frame: key.frame, tween: key.tween === 1 ? 2 : 1 });
      } else if (action === 8) {
        const key = p.keyframes[random(p.keyframes.length)];
        ops.setControlPoints({ property: address, frame: key.frame, controlPoints: [[-3, value], [3, -value]] });
      } else ops.setValue({ property: address, frame, value });
      editor.history.finishOperation();
      current = json(); assert.notEqual(current, before, label);
      undo.push(before); if (undo.length > 100) undo.shift(); redo.length = 0;
      assert.equal(editor.history.undoStack.length, Math.min(100, previousLength + 1), label);
      edits++;
    }
    assert.equal(editor.history.operation, null, label);
    assert.equal(json(), current, label);
    assert.equal(editor.history.undoStack.length, undo.length, label);
    assert.equal(editor.history.redoStack.length, redo.length, label);
  }
  assert.ok(edits > 200 && undos > 50 && redos > 5, `${edits} edits, ${undos} undos, ${redos} redos`);
});
