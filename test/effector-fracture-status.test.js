"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const fracture = require("../plugins/scene-plus/effector-fracture.js");
const { createMeshJobs } = require("../plugins/scene-plus/effector-jobs.js");
const status = require("../plugins/scene-plus/effector-fracture-status.js");

function prism() {
  const polygon = [[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]];
  const positions = [];
  for (const face of [[0,1,3],[1,2,3],[0,3,5],[3,4,5]]) {
    for (const i of face.slice().reverse()) positions.push(...polygon[i],0);
    for (const i of face) positions.push(...polygon[i],1);
  }
  for (let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    positions.push(...a,0,...b,0,...b,1,...a,0,...b,1,...a,1);
  }
  return { positions: new Float32Array(positions) };
}

test("invalid closed caps fall back to the exact open surface with a specific warning", () => {
  const source = prism(), options = { cells: 12, seed: 3, closed: true };
  const fallback = fracture.buildVoronoiFracture(source, options, { maxCapVertices: 3 });
  assert.equal(fallback.warning, "cap-invalid");
  assert.equal(fallback.error, undefined);
  assert.equal(fallback.closed, false);
  assert.ok(fallback.count > 0);
  const open = fracture.buildVoronoiFracture(source, { ...options, closed: false });
  delete fallback.warning;
  assert.deepEqual(fallback, open);
  assert.match(fracture.fractureErrorText("cap-invalid"), /cap contour.*rendering open fragments/);
});

test("non-finite source vertices stop before clipping and leave a useful diagnostic", () => {
  const source = prism(); source.positions[0] = NaN;
  assert.deepEqual(fracture.buildVoronoiFracture(source, { cells: 24 }), { error: "invalid" });
  assert.match(fracture.fractureErrorText("invalid"), /invalid vertices/);
  assert.match(fracture.fractureErrorText("work-limit"), /too many cells/);
  assert.match(fracture.fractureErrorText("degenerate"), /degenerate input/);
});

test("worker status stays pending until every mesh completes and keeps fallback warnings", async () => {
  const owner = { properties: { addAll(defs) { Object.assign(this, defs); } } };
  status.installFractureStatus(owner, { property: { type: { TEXT: 3 } } });
  owner.setFractureJobStatus = (...args) => status.setFractureJobStatus(owner, ...args);
  const first = { parent: { __zoidiumEffectorOwner: owner } }, second = { parent: first.parent };
  let worker, notices = [];
  const host = { Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    ZoidiumUI: { notify: detail => notices.push(detail) },
    Worker: class { constructor() { worker = this; } terminate() {} postMessage(message) { this.message = message; }
      finish(value) { this.onmessage({ data: { id: this.message.id, value } }); } } };
  const jobs = createMeshJobs("source", host);
  const a = jobs.request(first, "first", { commands: [{ kind: "fracture" }] });
  const b = jobs.request(second, "second", { commands: [{ kind: "fracture" }] });
  assert.equal(owner._fractureStatus, "Computing fracture...");
  worker.finish({ positions: new Float32Array([1]), errors: [], warnings: ["cap-invalid"] });
  await a.promise;
  assert.equal(owner._fractureStatus, "Computing fracture...");
  worker.finish({ positions: new Float32Array([2]), errors: [], warnings: [] });
  await b.promise;
  assert.match(owner._fractureStatus, /Warning: cap contour/);
  assert.equal(notices.length, 1);
  jobs.release(first); jobs.release(second);
  assert.match(owner._fractureStatus, /rendering open fragments/);
  jobs.request(first, "next", { commands: [{ kind: "fracture" }] });
  assert.equal(owner._fractureStatus, "Computing fracture...");
  jobs.release(first);
  assert.equal(owner._fractureStatus, "Ready");
  assert.equal(owner.properties.fractureStatus.value, "", "job state is never serialized into the property");
  jobs.dispose(); status.disposeFractureStatus(owner);
});

test("bundled worker keeps fallback diagnostics when the topology comes from its cache", () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const { createWorkerSource } = require("../plugins/scene-plus/effector-jobs.js");
  const sources = {};
  for (const name of ["earcut.js", "effector-core.js", "effector-fracture.js", "effector-mesh.js", "effector-evaluate.js"]) {
    sources[name] = fs.readFileSync(require.resolve("../plugins/scene-plus/" + name), "utf8");
  }
  const outputs = [];
  const realm = vm.createContext({ postMessage: value => outputs.push(value), console });
  vm.runInContext(createWorkerSource(sources), realm);
  const source = prism();
  const input = { sourceId: "cap-warning", polygonCount: 1, base: {
    kind: "source", smooth: false, positions: source.positions, count: source.positions.length / 3,
    index: null, uvs: null, attributes: {}, groups: [],
  }, commands: [{ kind: "fracture", topology: { cells: 12, seed: 3, closed: true },
    limits: { maxCapVertices: 3 }, relation: { identity: true }, motion: { distance: 0 } }] };
  realm.onmessage({ data: { id: 1, input } });
  assert.equal(outputs[0].error, undefined);
  assert.deepEqual(Array.from(outputs[0].value.warnings), ["cap-invalid"]);
  assert.equal(outputs[0].value.errors.length, 0);
  assert.equal(outputs[0].value.groups.length, 1, "open fallback has no cap material group");
  input.commands[0].motion.distance = 2;
  realm.onmessage({ data: { id: 2, input } });
  assert.deepEqual(Array.from(outputs[1].value.warnings), ["cap-invalid"]);
  assert.equal(outputs[1].value.topologyKey, outputs[0].value.topologyKey);
});
