"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

async function retentionProbe() {
  const geometry = require("../plugins/text-plus/text-plus-geometry.js");
  const { state } = require("../plugins/text-plus/text-plus-utils.js");
  const make = () => {
    const project = {}, parent = { parentProject: project }, text = { parentObject: parent };
    project.objects = [parent];
    parent.objects = [text];
    geometry.getSplitState(text);
    return { project, text };
  };
  const refs = [];
  for (let index = 0; index < 20; index += 1) refs.push(new WeakRef(make().project));
  const owned = make();
  const firstState = geometry.getSplitState(owned.text);
  assert.equal(geometry.getSplitState(owned.text), firstState, "one split state per live text");
  for (let index = 0; index < 8; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
  }
  assert.equal(refs.filter(ref => ref.deref()).length, 0, "the shutdown index must release abandoned Text+ graphs");
  assert.equal(state.splitStates.has(owned.text), true);
  geometry.restoreTextRendering(owned.text);
  assert.equal(state.splitStates.has(owned.text), false);
  assert.equal(state.splitTexts.size, 0, "collection and explicit restoration remove the shutdown entries");
}

if (process.argv.includes("--retention-probe")) {
  retentionProbe().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  test("Text+ split rendering tracks still-owned text without retaining abandoned projects", () => {
    const result = spawnSync(process.execPath, ["--expose-gc", __filename, "--retention-probe"], {
      encoding: "utf8", timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
