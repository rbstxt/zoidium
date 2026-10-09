"use strict";

// Offline audio analysis for Trapcode audio reactors: the level at a media
// time depends only on the decoded samples and that time (never on playback
// state), silence reads as zero, clip offset and trim map project time to
// media time, and an undecoded source keeps reactors neutral.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const suiteDir = path.join(projectRoot, "plugins/trapcode-suite");
const RATE = 48000;

function loadCommon() {
  const PZ = {};
  const THREE = {};
  const common = fs.readFileSync(path.join(suiteDir, "trapcode-common.js"), "utf8");
  new Function("PZ", "THREE", common)(PZ, THREE);
  return PZ.trapcode;
}

function sineBuffer(frequency, amplitude, seconds = 2, channels = 2) {
  const length = Math.round(RATE * seconds);
  const data = [];
  for (let c = 0; c < channels; c++) {
    const channel = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      channel[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE + c * 0.1);
    }
    data.push(channel);
  }
  return {
    sampleRate: RATE,
    length,
    numberOfChannels: channels,
    getChannelData: (c) => data[c],
  };
}

function silentBuffer(seconds = 2) {
  const length = Math.round(RATE * seconds);
  const channel = new Float32Array(length);
  return { sampleRate: RATE, length, numberOfChannels: 1, getChannelData: () => channel };
}

test("levels are undefined until a source is registered, then deterministic per time", () => {
  const T = loadCommon();
  const analysis = T.audioAnalysis;
  assert.equal(analysis.levelAt("clip.wav", 0.5), null, "undecoded source reads as null");
  analysis.register("clip.wav", sineBuffer(1000, 0.5));
  const first = analysis.levelAt("clip.wav", 0.5);
  assert.ok(first > 0 && first <= 1, `level in range, got ${first}`);
  assert.equal(analysis.levelAt("clip.wav", 0.5), first, "memoized repeat");
  assert.equal(analysis.levelAt("clip.wav", 0.5004), first, "same 1 ms bucket");

  analysis.register("clip.wav", sineBuffer(1000, 0.5));
  assert.equal(analysis.levelAt("clip.wav", 0.5), first, "fresh memo after re-registration");
});

test("out-of-order and repeated queries return the same value as a fresh analysis", () => {
  const T = loadCommon();
  const times = [1.25, 0.2, 1.25, 0.9, 0.2, 1.7];
  T.audioAnalysis.register("a.wav", sineBuffer(440, 0.3));
  const shuffled = times.map((t) => T.audioAnalysis.levelAt("a.wav", t));

  const other = loadCommon();
  other.audioAnalysis.register("a.wav", sineBuffer(440, 0.3));
  const ordered = [...times].sort((x, y) => x - y).map((t) => [t, other.audioAnalysis.levelAt("a.wav", t)]);
  for (let i = 0; i < times.length; i++) {
    const match = ordered.find(([t]) => t === times[i]);
    assert.equal(shuffled[i], match[1], `time ${times[i]}`);
  }
});

test("silence reads as zero and louder material reads higher", () => {
  const T = loadCommon();
  T.audioAnalysis.register("silent.wav", silentBuffer());
  T.audioAnalysis.register("loud.wav", sineBuffer(1000, 0.5));
  T.audioAnalysis.register("quiet.wav", sineBuffer(1000, 0.05));
  assert.equal(T.audioAnalysis.levelAt("silent.wav", 1), 0);
  const loud = T.audioAnalysis.levelAt("loud.wav", 1);
  const quiet = T.audioAnalysis.levelAt("quiet.wav", 1);
  assert.ok(loud > quiet && quiet > 0, `loud ${loud} quiet ${quiet}`);
});

test("load decodes an asset once and shares the pending promise", async () => {
  const T = loadCommon();
  const savedWindow = global.window;
  let decodes = 0;
  let reads = 0;
  global.window = {
    OfflineAudioContext: class {
      constructor(channels, length, rate) {
        this.rate = rate;
      }
      decodeAudioData(data, resolve) {
        decodes++;
        setTimeout(() => resolve(sineBuffer(880, 0.4, 1)), 0);
      }
    },
  };
  const project = {
    assets: {
      load: () => ({
        file: {
          arrayBuffer: () => {
            reads++;
            return Promise.resolve(new ArrayBuffer(8));
          },
        },
      }),
    },
  };
  try {
    const first = T.audioAnalysis.load(project, "song.mp3");
    const second = T.audioAnalysis.load(project, "song.mp3");
    assert.equal(first, second, "pending promise shared");
    assert.equal(await first, true);
    assert.equal(T.audioAnalysis.has("song.mp3"), true);
    assert.equal(await T.audioAnalysis.load(project, "song.mp3"), true);
    assert.equal(decodes, 1);
    assert.equal(reads, 1);
    assert.ok(T.audioAnalysis.levelAt("song.mp3", 0.5) > 0);
  } finally {
    global.window = savedWindow;
  }
});

function loadParticularSystem() {
  const PZ = {};
  const THREE = {};
  const common = fs.readFileSync(path.join(suiteDir, "trapcode-common.js"), "utf8");
  new Function("PZ", "THREE", common)(PZ, THREE);

  class StubObject {
    constructor() {
      this.onParentChanged = { watch() {} };
      this.parent = null;
      this.children = [];
    }
    getParentOfType() {
      return null;
    }
    tryGetParentOfType() {
      return null;
    }
  }
  PZ.object = StubObject;
  PZ.object3d = class extends StubObject {};
  PZ.objectList = class extends Array {
    constructor() {
      super();
    }
  };
  class StubProperty {
    constructor(definition) {
      const value = definition.group && definition.objects
        ? definition.objects.map((child) => child.value)
        : definition.value;
      this.value = Array.isArray(value) ? value.slice() : value;
    }
    get animated() {
      return false;
    }
    get(frame) {
      return this.value;
    }
    set(value) {
      this.value = value;
    }
    toJSON() {
      return this.value;
    }
  }
  PZ.property = {
    type: {
      NUMBER: 0, VECTOR2: 1, VECTOR3: 2, VECTOR4: 3, COLOR: 4, GRADIENT: 5, CURVE: 10,
      OPTION: 6, TEXT: 7, ASSET: 8, LIST: 9, SHADER: 11,
    },
    create: (definition) => new StubProperty(definition),
  };
  PZ.propertyList = class {
    constructor(definitions) {
      if (!definitions) return;
      for (const key of Object.keys(definitions)) {
        const def = definitions[key];
        this[key] = def instanceof StubProperty || def instanceof PZ.propertyList ? def : PZ.property.create(def);
      }
    }
  };
  PZ.asset = { type: { IMAGE: 0, AV: 3 } };
  class Vec {
    constructor(...values) {
      this.values = values;
    }
    set(...values) {
      this.values = values;
    }
  }
  class Plain {
    constructor(...args) {
      this.args = args;
      this.attributes = {};
    }
    addAttribute(name, attribute) {
      this.attributes[name] = attribute;
    }
    dispose() {}
  }
  THREE.Object3D = class extends Plain {};
  THREE.Points = Plain;
  THREE.BufferGeometry = Plain;
  THREE.Material = Plain;
  THREE.ShaderMaterial = Plain;
  THREE.Vector2 = Vec;
  THREE.Vector3 = Vec;
  THREE.Vector4 = Vec;
  THREE.DataTexture = class {
    constructor(data) {
      this.image = { data: data };
    }
    dispose() {}
  };
  THREE.NormalBlending = 1;
  THREE.AdditiveBlending = 2;
  THREE.LinearFilter = 1;
  THREE.RGBAFormat = 1;
  const source = fs.readFileSync(path.join(suiteDir, "particular.js"), "utf8");
  new Function("PZ", "THREE", source)(PZ, THREE);
  const system = new PZ.object3d.particular.system();
  system.sceneRate = () => 30;
  return { system, T: PZ.trapcode, simulation: PZ.object3d.particular.system.simulation };
}

test("audio reactor level maps project time through clip offset and trim", () => {
  const { system, T, simulation } = loadParticularSystem();
  const audio = system.properties.audio;
  audio.reactor1Enabled.set(1);
  audio.audioLayer.set("clip.wav");
  audio.audioOffset.set(1);
  audio.audioTrimIn.set(0.25);
  audio.audioTrimOut.set(0.75);
  T.audioAnalysis.register("clip.wav", sineBuffer(1000, 0.5));

  assert.equal(simulation.audioLevel(system, 15), 0, "before the clip starts (0.5 s before offset): silence");
  assert.equal(simulation.audioLevel(system, 30 * 1.2), T.audioAnalysis.levelAt("clip.wav", 0.25 + 0.2));
  assert.equal(simulation.audioLevel(system, 30 * 1.6), 0, "after trim out: silence");
  assert.equal(simulation.audioLevel(system, 30 * 1.2), simulation.audioLevel(system, 30 * 1.2), "stable");
});

test("undecoded or missing sources keep reactors neutral", () => {
  const { system, simulation } = loadParticularSystem();
  const audio = system.properties.audio;
  audio.reactor1Enabled.set(1);
  assert.equal(simulation.audioLevel(system, 30), 0.5, "no source");
  audio.audioLayer.set("not-decoded.wav");
  assert.equal(simulation.audioLevel(system, 30), 0.5, "source not decoded");
});
