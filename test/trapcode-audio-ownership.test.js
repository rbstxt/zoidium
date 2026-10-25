"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env");

function buffer(index) {
  const samples = new Float32Array(48000);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (index + 1) / 20 * Math.sin(2 * Math.PI * (440 + index * 37) * i / 48000);
  }
  return { length: samples.length, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => samples };
}

for (const kind of ["Form", "Plexus", "Particular"]) {
  test(`${kind}: nine live audio consumers retain their decoded levels`, async () => {
    const { PZ, THREE } = loadSuite(["trapcode-common.js", "form.js", "plexus.js", "particular.js"]);
    THREE.Material = class { dispose() {} };
    const T = PZ.trapcode;
    const savedWindow = global.window;
    let loads = 0;
    global.window = { OfflineAudioContext: class {
      decodeAudioData(data, resolve) { resolve(buffer(new Uint8Array(data)[0])); }
    } };
    const project = { assets: { load: source => {
      loads++;
      return { file: { arrayBuffer: async () => Uint8Array.of(Number(source.slice(7))).buffer } };
    } } };
    const findParent = T.findParent;
    T.findParent = (owner, cls) => cls === PZ.project ? project : findParent(owner, cls);
    T.audioClipTime = (_owner, _source, frame) => frame / 30;
    T.setTime(15);
    const owners = [];
    const expected = [];
    async function prepare(owner) {
      if (kind === "Particular") await owner.prepareAudio(15);
      else await Promise.all(owner.requestAssets().map(entry => entry.promise));
    }
    function level(owner) {
      if (kind === "Form") return owner.audioLevel(15);
      if (kind === "Particular") return PZ.object3d.particular.system.simulation.audioLevel(owner, 15);
      const positions = new Float64Array([1, 2, 3]);
      owner.applySound(positions, 1, owner.properties.effector);
      return positions[0] - 1;
    }
    try {
      for (let i = 0; i < 9; i++) {
        const owner = kind === "Form" ? new PZ.object3d.form.instance()
          : kind === "Plexus" ? new PZ.object3d.plexus.object() : new PZ.object3d.particular.system();
        owner.sceneRate = () => 30;
        const audio = kind === "Plexus" ? owner.properties.effector : owner.properties.audio;
        audio.audioLayer.set(`source-${i}`);
        if (kind === "Form") audio.reactor1.set(1);
        else if (kind === "Particular") audio.reactor1Enabled.set(1);
        else {
          owner.objectKind = 1;
          owner.properties.common.enabled.set(1);
          audio.effectorType.set(6);
        }
        owners.push(owner);
        await prepare(owner);
        expected.push(level(owner));
        assert.ok(expected[i] > 0, `source ${i} has an audible level`);
      }
      for (const i of [0, 8, 3, 1, 7, 2, 6, 4, 5, 0]) {
        assert.equal(level(owners[i]), expected[i], `source ${i} survives other preparations`);
        await prepare(owners[i]);
        assert.equal(level(owners[i]), expected[i], `source ${i} stays ready`);
      }
      assert.equal(loads, 9, "no source is re-decoded");
      if (kind !== "Particular") {
        for (let i = 0; i < owners.length; i++) {
          assert.ok(owners[i]._assets.ready("audio", `source-${i}`).buffer, "ready entry owns PCM");
        }
      }
    } finally { global.window = savedWindow; }
  });
}

test("unowned PCM remains bounded at eight records and live owners survive cache churn", () => {
  const output = execFileSync(process.execPath, ["--expose-gc", "-e", `
    const assert = require("node:assert/strict");
    const { loadSuite } = require(${JSON.stringify(require.resolve("./trapcode-env"))});
    const T = loadSuite(["trapcode-common.js"]).PZ.trapcode;
    const owners = Array.from({length: 9}, () => new T.AssetCache());
    const buffer = () => ({length: 2048, sampleRate: 48000, numberOfChannels: 1,
      getChannelData: () => new Float32Array(2048)});
    (async () => {
      for (let i = 0; i < owners.length; i++) {
        await owners[i].request("audio", "owned-" + i,
          source => T.audioAnalysis.register(source, buffer())).promise;
      }
      for (let i = 0; i < 24; i++) T.audioAnalysis.register("unowned-" + i, buffer());
      await new Promise(resolve => setImmediate(resolve));
      global.gc();
      for (let i = 0; i < 9; i++) assert.equal(T.audioAnalysis.levelAt("owned-" + i, 0), 0);
      for (let i = 0; i < 24; i++) assert.equal(T.audioAnalysis.has("unowned-" + i), i >= 16);
      for (const owner of owners) owner.clear();
      await new Promise(resolve => setImmediate(resolve));
      global.gc();
      for (let i = 0; i < 9; i++) assert.equal(T.audioAnalysis.has("owned-" + i), false);
      console.log("9 owned records retained; 8 unowned records cached; cleared owners released");
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { encoding: "utf8" });
  assert.match(output, /cleared owners released/);
});
