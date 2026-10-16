"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "plugins", "core", "empty-keyframes.js"), "utf8");

// Mirrors CM3's keyframed property: load() only adds the default keyframe
// when the data is missing, and get() reads keyframes[0] unguarded.
function createRealm() {
  class Keyframe {
    constructor(value, frame, tween) { Object.assign(this, { value, frame, tween }); }
    load(data) { Object.assign(this, data); }
  }
  class Keyframes {
    constructor(definition) { this.definition = definition; this.keyframes = []; this.defaultTween = 1; this.expression = null; }
    getDefaultValue() { return this.definition.value; }
    load(data) {
      if (data) {
        if (data.keyframes) for (const entry of data.keyframes) { const key = new Keyframe(); key.load(entry); this.keyframes.push(key); }
      } else if (!this.definition.allowEmpty) this.keyframes.push(new Keyframe(this.getDefaultValue(), 0, this.defaultTween));
    }
    get() { return this.keyframes[0].value; }
  }
  const PZ = { keyframe: Keyframe, property: { dynamic: { keyframes: Keyframes } } };
  const realm = { PZ };
  realm.window = realm;
  vm.runInNewContext(source, realm);
  return PZ;
}

test("a saved empty keyframe list loads with the default keyframe", () => {
  const PZ = createRealm();
  const seed = new PZ.property.dynamic.keyframes({ value: 7 });
  seed.load({ animated: false, keyframes: [] });
  assert.equal(seed.keyframes.length, 1);
  assert.equal(seed.get(0), 7);
  assert.equal(seed.keyframes[0].frame, 0);
  assert.equal(seed.keyframes[0].tween, 1);
});

test("saved keyframes, missing data and allowEmpty definitions are left as CM3 loads them", () => {
  const PZ = createRealm();
  const saved = new PZ.property.dynamic.keyframes({ value: 7 });
  saved.load({ keyframes: [{ value: 3, frame: 10 }] });
  assert.deepEqual(saved.keyframes.map(key => [key.value, key.frame]), [[3, 10]]);
  const fresh = new PZ.property.dynamic.keyframes({ value: 7 });
  fresh.load(undefined);
  assert.equal(fresh.keyframes.length, 1);
  const empty = new PZ.property.dynamic.keyframes({ value: 7, allowEmpty: true });
  empty.load({ keyframes: [] });
  assert.equal(empty.keyframes.length, 0);
});

test("installation is idempotent", () => {
  const PZ = createRealm();
  const load = PZ.property.dynamic.keyframes.prototype.load;
  vm.runInNewContext(source, { PZ, window: { PZ } });
  assert.equal(PZ.property.dynamic.keyframes.prototype.load, load);
});
