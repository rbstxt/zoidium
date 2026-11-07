"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

async function retentionProbe() {
  class Object3d {
    constructor() {
      this.properties = { name: { set() {} }, add(name) { this[name] = { load() {} }; } };
    }
    load() {}
    unload() {}
  }
  Object3d.create = () => new Object3d();
  class Shape extends Object3d { load(data) { this.value = data.value; } }
  class List extends Array {
    push(object) { object.parent = this; return super.push(object); }
    splice(start, count, ...objects) {
      for (const object of objects) object.parent = this;
      return super.splice(start, count, ...objects);
    }
  }
  const context = vm.createContext({ console, CM: { project: null },
    PZ: { zoidium: { define(name, api) { this[name] = api; } }, object3d: Object3d, property: { type: { TEXT: 10 } } },
    ZoidiumPluginApis: { props: { cloneJson: value => JSON.parse(JSON.stringify(value)) } },
  });
  vm.runInContext(fs.readFileSync(require.resolve("../plugins/core/object3d-registry.js"), "utf8"), context);
  const api = context.PZ.zoidium.object3d;
  api.registerClass({ type: "zoidium:test/shape", factory: () => new Shape() });
  const open = missing => {
    const project = { objects: new List() };
    project.objects.parent = project;
    const object = context.PZ.object3d.create(missing ? "zoidium:test/missing" : "zoidium:test/shape");
    project.objects.push(object);
    object.load({ type: object.type, value: 7 });
    context.CM.project = project;
    return project;
  };
  const refs = [];
  for (let index = 0; index < 20; index += 1) refs.push(new WeakRef(open(index % 2 === 0)));
  const owned = open(false), missing = open(true);
  for (let index = 0; index < 8; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
  }
  assert.equal(refs.filter(ref => ref.deref()).length, 0, "registry indices must release abandoned live and missing objects");
  assert.equal(api.getTrackedObjects().length, 2);
  let tracked = 0;
  api.setUsageTracker({ track() { tracked += 1; }, untrack() {} });
  assert.equal(tracked, 2, "late tracker installation still visits owned objects");
  api.registerClass({ type: "zoidium:test/missing", factory: () => new Shape() });
  await api.restoreMissing("test");
  assert.equal(missing.objects[0].value, 7);
  assert.equal(missing.objects[0]._zoidiumMissingObject, false);
  assert.equal(api.isInUse("test"), true, "restored active objects still protect their class");
  assert.equal(api.getTrackedObjects().includes(owned.objects[0]), true);
  owned.objects[0].unload();
  assert.equal(api.getTrackedObjects().length, 1);
}

if (process.argv.includes("--retention-probe")) {
  retentionProbe().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  test("3D object registry releases abandoned projects and preserves missing-object restoration", () => {
    const result = spawnSync(process.execPath, ["--expose-gc", __filename, "--retention-probe"], {
      encoding: "utf8", timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
