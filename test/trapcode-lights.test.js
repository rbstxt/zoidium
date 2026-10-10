"use strict";

// Coverage for the C4D-style lights: install/uninstall restores the stock Light
// class, each type names the backend it renders with, legacy ids keep loading,
// and the per-frame sync writes the properties to the THREE light.

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite, createPZ, createTHREE, readSource } = require("./trapcode-env");

function stockLightClass(PZ, THREE) {
  const defs = {
    position: { dynamic: true, group: true, name: "Position", type: PZ.property.type.VECTOR3, objects: [
      { dynamic: true, name: "Position.X", type: 0, value: 0 },
      { dynamic: true, name: "Position.Y", type: 0, value: 10 },
      { dynamic: true, name: "Position.Z", type: 0, value: 0 },
    ] },
    target: { dynamic: true, group: true, name: "Target", type: PZ.property.type.VECTOR3, objects: [
      { dynamic: true, name: "Target.X", type: 0, value: 0 },
      { dynamic: true, name: "Target.Y", type: 0, value: 0 },
      { dynamic: true, name: "Target.Z", type: 0, value: 0 },
    ] },
    color: { dynamic: true, group: true, name: "Color", type: PZ.property.type.COLOR, objects: [
      { dynamic: true, name: "Color.R", type: 0, value: 1 },
      { dynamic: true, name: "Color.G", type: 0, value: 1 },
      { dynamic: true, name: "Color.B", type: 0, value: 1 },
    ] },
    skyColor: { dynamic: true, group: true, name: "Sky", type: PZ.property.type.COLOR, objects: [
      { dynamic: true, name: "Sky.R", type: 0, value: 1 },
      { dynamic: true, name: "Sky.G", type: 0, value: 1 },
      { dynamic: true, name: "Sky.B", type: 0, value: 1 },
    ] },
    groundColor: { dynamic: true, group: true, name: "Ground", type: PZ.property.type.COLOR, objects: [
      { dynamic: true, name: "Ground.R", type: 0, value: 0 },
      { dynamic: true, name: "Ground.G", type: 0, value: 0 },
      { dynamic: true, name: "Ground.B", type: 0, value: 0 },
    ] },
    intensity: { dynamic: true, name: "Intensity", type: 0, value: 1 },
    angle: { dynamic: true, name: "Angle", type: 0, value: 60 },
  };

  class StockLight extends PZ.object3d {
    constructor() {
      super();
      this.threeObj = null;
      this.objectType = 1;
    }
    load(e) {
      if (typeof e === "object") this.objectType = e.objectType;
      this.changeObjectType(this.objectType);
      this.properties.load(e && e.properties);
    }
    changeObjectType(e) {
      this.objectType = e;
      this.threeObj = e === 4 ? new THREE.HemisphereLight(16777215, 16777215, 1) : new THREE.SpotLight(16777215, 1, 0, Math.PI / 3, 0.5, 1);
      this.properties.addAll({
        color: PZ.property.create(defs.color),
        position: PZ.property.create(defs.position),
        target: PZ.property.create(defs.target),
        intensity: PZ.property.create(defs.intensity),
        angle: PZ.property.create(defs.angle),
        ...(e === 4 ? { groundColor: PZ.property.create(defs.groundColor) } : {}),
      });
      this.properties.name.set("Light");
      this.parentChanged();
    }
    update() {}
  }
  StockLight.propertyDefinitions = Object.assign({
    name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Light" },
  }, defs);
  return StockLight;
}

function setup(files = ["trapcode-common.js", "lights-c4d.js"]) {
  const { PZ, THREE } = loadSuite([]);
  PZ.object3d.light = stockLightClass(PZ, THREE);
  const stockPrototype = Object.assign({}, PZ.object3d.light.prototype);
  const stock = {
    changeObjectType: PZ.object3d.light.prototype.changeObjectType,
    update: PZ.object3d.light.prototype.update,
    load: PZ.object3d.light.prototype.load,
  };
  // The common and lights sources see the same PZ/THREE globals as the runtime.
  new Function("PZ", "THREE", readSource("trapcode-common.js"))(PZ, THREE);
  new Function("PZ", "THREE", readSource("lights-c4d.js"))(PZ, THREE);
  return { PZ, THREE, stock, stockPrototype, Light: PZ.object3d.light };
}

test("stock methods remain untouched and legacy load wrapper restores on disable", () => {
  const { PZ, Light, stock } = setup();
  PZ.trapcode.lights.install(PZ);
  assert.equal(Light.prototype.changeObjectType, stock.changeObjectType);
  assert.equal(Light.prototype.update, stock.update);
  assert.equal(Light.propertyDefinitions.decay, undefined);
  PZ.trapcode.lights.uninstall();
  assert.equal(Light.prototype.load, stock.load);
});

for (const [label, data, backend, expectedType] of [
  ["Light+ alone Hemisphere", { objectType: 4, properties: { color: [0.3, 0.5, 0.8], groundColor: [0, 0, 0], name: "Saved hemisphere" } }, "HemisphereLight", 3],
  ["both enabled Hemisphere", { objectType: 4, properties: { color: [0.3, 0.5, 0.8], groundColor: [0, 0, 0], name: "Saved hemisphere" } }, "HemisphereLight", 3],
  ["DaviFX Area", { objectType: 4, properties: { width: 20, height: 30, color: [1, 0, 0], name: "Saved area" } }, "PointLight", "zoidium:trapcode-suite/area-light"],
  ["both enabled Area", { objectType: 4, properties: { width: 20, height: 30, name: "Saved area" } }, "PointLight", "zoidium:trapcode-suite/area-light"],
  ["DaviFX Hemisphere", { objectType: 5, properties: { skyColor: [0.3, 0.5, 0.8], groundColor: [0, 0, 0], name: "Saved sky" } }, "HemisphereLight", "zoidium:trapcode-suite/hemisphere-light"],
  ["legacy IES", { objectType: 6, properties: { name: "Saved IES" } }, "SpotLight", "zoidium:trapcode-suite/ies-light"],
  ["legacy Portal", { objectType: 8, properties: { name: "Saved portal" } }, "PointLight", "zoidium:trapcode-suite/portal-light"],
]) {
  test(label + " loads without changing its saved name", () => {
    const { PZ, THREE, Light } = setup();
    PZ.trapcode.lights.install(PZ);
    const light = new Light(); light.type = 3; light.load(data); light.update(0);
    assert.ok(light.threeObj instanceof THREE[backend]);
    assert.equal(light.type, expectedType);
    assert.equal(light.properties.name.get(), data.properties.name);
    PZ.trapcode.lights.uninstall();
    light.update(0);
  });
}

test("new Trapcode lights have separate namespaced factories and type-specific names", () => {
  const { PZ, Light, stock } = setup();
  const registrations = new Map();
  PZ.trapcode.lights.install(PZ, { registerClass(entry) {
    registrations.set(entry.type, entry); return () => registrations.delete(entry.type);
  } });
  for (const entry of registrations.values()) {
    const light = entry.factory(); light.load(null); light.update(0);
    assert.equal(light.toJSON().type, entry.type);
    assert.equal(light.properties.name.get(), entry.name);
  }
  const hemi = new Light(); hemi.load({objectType: 4, properties: {groundColor: [0,0,0]}});
  assert.equal(hemi.changeObjectType, stock.changeObjectType);
  assert.ok(hemi.threeObj.groundColor);
  PZ.trapcode.lights.uninstall();
  assert.equal(registrations.size, 0);
});


test("adding Light+ Hemisphere with no stored properties uses the stock backend", () => {
  const {PZ, THREE, Light, stock} = setup();
  PZ.trapcode.lights.install(PZ);
  const light = new Light(); light.type = 3;
  light.load({objectType: 4});
  assert.equal(light.type, 3);
  assert.equal(light.changeObjectType, stock.changeObjectType);
  assert.ok(light.threeObj instanceof THREE.HemisphereLight);
  light.update(0);
  PZ.trapcode.lights.uninstall();
});

test("all eight catalogue entries are listed with donor names and backends", () => {
  const { PZ, THREE } = setup();
  const listed = PZ.trapcode.lights.catalogue.filter((entry) => entry.listed);
  assert.equal(listed.length, 8);
  assert.deepEqual(listed.map((entry) => entry.id).sort(), [1, 2, 3, 4, 5, 6, 7, 8]);

  const registrations = new Map();
  PZ.trapcode.lights.install(PZ, { registerClass(entry) {
    registrations.set(entry.type, entry); return () => registrations.delete(entry.type);
  } });
  try {
    const ies = registrations.get("zoidium:trapcode-suite/ies-light").factory();
    ies.load(null);
    assert.equal(ies.properties.name.get(), "Photometric IES Light");
    assert.ok(ies.threeObj instanceof THREE.SpotLight);
    assert.equal(ies.properties.iesProfile.get(), "Downlight");
    assert.ok(ies.properties.angle && ies.properties.penumbra);

    const portal = registrations.get("zoidium:trapcode-suite/portal-light").factory();
    portal.load(null);
    assert.equal(portal.properties.name.get(), "Portal Light");
    // Portal samples a rectangle with one-sided spot lights.
    assert.ok(portal.threeObj instanceof THREE.PointLight);
    assert.equal(portal.properties.width.get(), 10);
    assert.equal(portal.properties.height.get(), 10);
  } finally {
    PZ.trapcode.lights.uninstall();
  }
});

test("donor-shaped IES and Portal JSON load with their parameters", () => {
  const { PZ, THREE, Light } = setup();
  PZ.trapcode.lights.install(PZ);
  try {
    const ies = new Light(); ies.type = 3;
    ies.load({ objectType: 6, properties: { name: "Stage IES", iesProfile: "stage.ies", angle: 45, penumbra: 0.3 } });
    assert.ok(ies.threeObj instanceof THREE.SpotLight);
    assert.equal(ies.properties.iesProfile.get(), "stage.ies");
    assert.equal(ies.properties.angle.get(), 45);
    ies.update(11);
    assert.equal(ies.threeObj.decay, 1);

    const portal = new Light(); portal.type = 3;
    portal.load({ objectType: 8, properties: { name: "Window portal", width: 12, height: 16 } });
    assert.equal(portal.properties.width.get(), 12);
    assert.equal(portal.properties.height.get(), 16);
    portal.update(11);
  } finally {
    PZ.trapcode.lights.uninstall();
  }
});

test("light sync is deterministic under shuffled frame order", () => {
  const { PZ, Light } = setup();
  const registrations = new Map();
  PZ.trapcode.lights.install(PZ, { registerClass(entry) {
    registrations.set(entry.type, entry); return () => registrations.delete(entry.type);
  } });
  try {
    for (const type of ["zoidium:trapcode-suite/ies-light", "zoidium:trapcode-suite/portal-light",
      "zoidium:trapcode-suite/sun-light", "zoidium:trapcode-suite/point-light"]) {
      const direct = registrations.get(type).factory();
      direct.load(null);
      direct.update(7);
      const expected = JSON.stringify([direct.threeObj.color, direct.threeObj.intensity,
        direct.threeObj.position, direct.threeObj.width, direct.threeObj.height]);
      const history = registrations.get(type).factory();
      history.load(null);
      for (const frame of [2, 9, 4, 0, 7]) history.update(frame);
      assert.equal(JSON.stringify([history.threeObj.color, history.threeObj.intensity,
        history.threeObj.position, history.threeObj.width, history.threeObj.height]), expected, type);
    }
  } finally {
    PZ.trapcode.lights.uninstall();
  }
});

test("selection helper maps suite-only ids to stock gizmo ids and restores", () => {
  const { PZ, THREE, Light } = setup();
  const seen = [];
  PZ.ui = {
    helper3d: class {
      objectsChanged() {
        const target = this.objects && this.objects[0];
        seen.push(target ? target.objectType : null);
      }
    },
  };
  PZ.trapcode.lights.install(PZ);
  try {
    const helper = new PZ.ui.helper3d();
    for (const [objectType, expected] of [[5, 4], [6, 1], [7, 3], [8, 3], [2, 2]]) {
      const light = new Light();
      light.load({ objectType, properties: { name: "H" + objectType } });
      helper.objects = [light];
      helper.objectsChanged();
      assert.equal(light.objectType, objectType, "real id restored after gizmo mapping");
    }
    assert.deepEqual(seen, [4, 1, 3, 2, 2], "helper saw stock ids");
    // Stock lights pass through untouched.
    const stock = new Light();
    stock.type = 3;
    stock.objectType = 3;
    helper.objects = [stock];
    helper.objectsChanged();
    assert.deepEqual(seen.slice(-1), [3]);
  } finally {
    PZ.trapcode.lights.uninstall();
  }
  assert.equal(PZ.ui.helper3d.prototype.objectsChanged.alive, undefined, "wrapper removed on disable");
});

test("helpers constructed before install are rebound to the mapping", () => {
  const { PZ, Light } = setup();
  const watched = [];
  const makeList = () => ({
    length: 0,
    0: null,
    onListChanged: {
      watch(fn, fire) { watched.push(fn); if (fire) fn(); },
      unwatch(fn) { const i = watched.indexOf(fn); if (i >= 0) watched.splice(i, 1); },
    },
  });
  // A boot-time helper3d: bound to the original method in its constructor.
  PZ.ui = {
    helper3d: class {
      constructor() {
        this.objects = makeList();
        this.helper = null;
        this.objectsChanged_bound = this.objectsChanged.bind(this);
        this.objects.onListChanged.watch(this.objectsChanged_bound);
      }
      objectsChanged() {
        const target = this.objects && this.objects.length === 1 ? this.objects[0] : null;
        this.helper = target ? target.objectType : null;
      }
    },
  };
  const staleBound = [];
  globalThis.CM = { mainViewport: { helper3d: new PZ.ui.helper3d() } };
  staleBound.push(globalThis.CM.mainViewport.helper3d.objectsChanged_bound);
  try {
    PZ.trapcode.lights.install(PZ);
    const helper = globalThis.CM.mainViewport.helper3d;
    assert.notEqual(helper.objectsChanged_bound, staleBound[0], "live helper rebound");
    const sun = new Light();
    sun.load({ objectType: 7, properties: { name: "Sun" } });
    helper.objects = { length: 1, 0: sun, onListChanged: helper.objects.onListChanged };
    helper.objectsChanged_bound();
    assert.equal(helper.helper, 3, "boot-time helper saw the mapped gizmo id");
    assert.equal(sun.objectType, 7, "real id restored");
    assert.equal(watched.filter((fn) => fn === staleBound[0]).length, 0, "stale binding unsubscribed");
  } finally {
    delete globalThis.CM;
    PZ.trapcode.lights.uninstall();
  }
});

// Picker defaults must light the visible front of CM3's radius-10 Sphere.
// Put positional lights outside it, with a target at its center. Saved data
// takes its own path through load and must retain the author's position.
test("Light+ and Trapcode picker lights start outside the default Sphere", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { PZ } = setup();
  const registrations = new Map();
  PZ.trapcode.lights.install(PZ, { registerClass(entry) {
    registrations.set(entry.type, entry);
    return () => registrations.delete(entry.type);
  } });
  for (const folder of ["light-plus", "trapcode-suite"]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "plugins", folder, "manifest.json")));
    const picker = manifest.objectTypes.find(entry => entry.name === (folder === "light-plus" ? "Light+" : "Trapcode Lights"));
    for (const entry of picker.list.filter(entry => !entry.name.includes("Hemisphere"))) {
      const serialized = entry.data.properties.position;
      assert.equal(serialized.animated, false);
      assert.equal(serialized.keyframes.length, 1);
      assert.equal(serialized.keyframes[0].frame, 0);
      const position = serialized.keyframes[0].value;
      assert.ok(Math.hypot(...position) > 10, entry.name + " must be outside the Sphere");
      assert.ok(position[2] > 10, entry.name + " must illuminate its camera-facing surface");
      if (folder === "light-plus") {
        assert.equal(entry.type, 3, "Light+ still uses stock CM3 lights");
        continue;
      }
      const light = registrations.get(entry.type).factory();
      // The suite stub accepts decoded vector values; CM3 decodes group
      // keyframes into the child properties before the light's update.
      light.load({ ...entry.data, properties: { position } });
      light.update(0);
      if (entry.data.objectType === 7) continue; // Sun position now comes from azimuth and elevation.
      assert.deepEqual([light.threeObj.position.x, light.threeObj.position.y, light.threeObj.position.z], position);
      const savedPosition = [-20, 30, -40];
      const saved = registrations.get(entry.type).factory();
      saved.load({ ...entry.data, properties: { position: savedPosition } });
      for (const frame of [10, 0, 10]) {
        saved.update(frame);
        assert.deepEqual([saved.threeObj.position.x, saved.threeObj.position.y, saved.threeObj.position.z], savedPosition);
      }
    }
  }
  PZ.trapcode.lights.uninstall();
});

const iesFixture = `IESNA:LM-63-2002
[TEST] Local fixture
TILT=NONE
1 1000 1 3 3 1 2 0 0 0
1 1 10
0 45 90
0 90 180
100 50 0
20 10 0
100 50 0
`;

test("LM-63 candela interpolation respects vertical and horizontal symmetry", () => {
  const {PZ} = setup();
  const api = PZ.trapcode.lights;
  const data = api.parseIES(iesFixture);
  assert.equal(api.sampleIES(data, 0, 0), 1);
  assert.equal(api.sampleIES(data, 45, 90), 0.1);
  assert.equal(api.sampleIES(data, 45, 270), 0.1);
  assert.equal(api.sampleIES(data, 22.5, 45), 0.45);
  assert.equal(api.sampleIES(data, 120, 0), 0);
  assert.throws(() => api.parseIES(iesFixture.replace('TILT=NONE', 'TILT=remote.ies')), /TILT=NONE/);
  assert.throws(() => api.parseIES(iesFixture.replace('3 3 1 2', '3 3 2 2')), /Type C/);
  assert.throws(() => api.parseIES(iesFixture.replace('0 45 90', '0 90 45')), /angles/);
  assert.throws(() => api.parseIES(iesFixture.replace('100 50 0\n20', '-100 50 0\n20')), /negative/);
});

function vectorMath(THREE) {
  const p = THREE.Vector3.prototype;
  p.lengthSq = function () { return this.x*this.x + this.y*this.y + this.z*this.z; };
  p.normalize = function () { const n = Math.sqrt(this.lengthSq()) || 1; return this.set(this.x/n,this.y/n,this.z/n); };
  p.crossVectors = function (a,b) { const x=a.y*b.z-a.z*b.y,y=a.z*b.x-a.x*b.z,z=a.x*b.y-a.y*b.x; return this.set(x,y,z); };
}

function factorySetup() {
  const env = setup(); vectorMath(env.THREE);
  const registrations = new Map();
  env.PZ.trapcode.lights.install(env.PZ, {registerClass(entry) { registrations.set(entry.type,entry); return () => registrations.delete(entry.type); }});
  env.make = (name) => { const light = registrations.get('zoidium:trapcode-suite/'+name+'-light').factory(); light.load(null); return light; };
  return env;
}

test("area dimensions move emitter samples and unload disposes the editor rectangle", () => {
  const {PZ,make} = factorySetup();
  try {
    const light=make('area'); light.properties.position.set([0,0,10]); light.update(0);
    const before = light.threeObj.areaSamples.map(s=>[s.position.x,s.position.y,s.position.z]);
    light.properties.width.set(40); light.properties.height.set(20); light.update(9);
    const after = light.threeObj.areaSamples.map(s=>[s.position.x,s.position.y,s.position.z]);
    assert.equal(after[0][0], before[0][0]*4);
    assert.equal(after[0][1], before[0][1]*2);
    assert.equal(light.threeObj.intensity,0);
    assert.equal(light.threeObj.areaSamples.length,9);
    assert.equal(light.threeObj.areaSamples.reduce((n,s)=>n+s.intensity,0),1.0000000000000002);
    const geometry=light.threeObj.areaHelper.geometry; light.unload(); assert.equal(geometry.disposed,true);
  } finally {PZ.trapcode.lights.uninstall();}
});

test("portal reads this frame's sun properties regardless of evaluation order", () => {
  const {PZ,make} = factorySetup();
  try {
    const sun=make('sun'), portal=make('portal');
    sun.properties.sunElevation.set(10); portal.update(12);
    const low=portal.threeObj.areaSamples[0].intensity;
    sun.properties.sunElevation.set(70); portal.update(12);
    assert.ok(portal.threeObj.areaSamples[0].intensity>low);
    const expected=JSON.stringify(portal.threeObj.areaSamples[0].color);
    sun.update(12); portal.update(12);
    assert.equal(JSON.stringify(portal.threeObj.areaSamples[0].color),expected);
  } finally {PZ.trapcode.lights.uninstall();}
});

test("sun azimuth/elevation determine direction, color, power and ambient fill", () => {
  const {PZ,make} = factorySetup();
  try {
    const sun=make('sun'); sun.properties.sunAzimuth.set(90); sun.properties.sunElevation.set(0); sun.update(0);
    assert.ok(Math.abs(sun.threeObj.position.x-1000)<1e-6);
    assert.equal(sun.threeObj.intensity,0);
    const low=sun.threeObj.color.b;
    sun.properties.sunElevation.set(90); sun.update(0);
    assert.ok(Math.abs(sun.threeObj.position.y-1000)<1e-6);
    assert.equal(sun.threeObj.intensity,1);
    assert.ok(sun.threeObj.color.b>low);
    assert.ok(sun.skyFill.intensity>0.2);
  } finally {PZ.trapcode.lights.uninstall();}
});

test("IES source text survives saved-property reload", () => {
  const {PZ,make} = factorySetup();
  try {
    const first=make('ies'); first.properties.iesProfile.set('fixture.ies');first.properties.iesData.set(iesFixture);
    const saved={properties:{iesProfile:first.properties.iesProfile.get(),iesData:first.properties.iesData.get()}};
    const reloaded=make('ies'); reloaded.load(saved);
    assert.equal(reloaded.properties.iesData.get(),iesFixture);
    assert.equal(PZ.trapcode.lights.sampleIES(PZ.trapcode.lights.parseIES(reloaded.properties.iesData.get()),45,90),0.1);
  } finally {PZ.trapcode.lights.uninstall();}
});

test("IES atlas changes with the selected distribution and releases slots and shaders", () => {
  const {PZ,THREE,Light}=setup();
  class Texture { constructor(data,width,height){this.image={data,width,height};} dispose(){this.disposed=true;} }
  THREE.DataTexture=Texture;
  const oldChunk=`float angleCos = dot( directLight.direction, spotLight.direction );\ndirectLight.color *= spotEffect * punctualLightIntensityToIrradianceFactor( lightDistance, spotLight.distance, spotLight.decay );`;
  THREE.ShaderChunk={lights_pars_begin:oldChunk};
  THREE.ShaderLib={standard:{uniforms:{},fragmentShader:'standard'},physical:{uniforms:{},fragmentShader:'physical'}};
  PZ.trapcode.lights.install(PZ);
  const texture=THREE.ShaderLib.standard.uniforms.zoidiumIESAtlas.value;
  const light=new Light();light.load({objectType:6});light.update(0);
  const down=new Uint8Array(texture.image.data);
  light.properties.iesProfile.set('Uniform');light.update(1);
  assert.notDeepEqual(texture.image.data,down);
  assert.equal(texture.image.data[127*4],255);
  assert.equal(light.threeObj.distance,-1, 'nonzero distance preserves r91 decay tag');
  assert.equal(light.threeObj.decay,-1000.1);
  const slot=light.iesSlot;light.unload();assert.equal(light.iesSlot,undefined);
  const reused=new Light();reused.load({objectType:6});reused.update(2);assert.equal(reused.iesSlot,slot);
  assert.equal(texture.clone(),texture,'material clones share a single live atlas');
  PZ.trapcode.lights.uninstall();
  assert.equal(texture.disposed,true);
  assert.equal(THREE.ShaderChunk.lights_pars_begin,oldChunk);
  assert.equal(THREE.ShaderLib.standard.fragmentShader,'standard');
  assert.equal(THREE.ShaderLib.standard.uniforms.zoidiumIESAtlas,undefined);
});

test("rect area path drives width, height and aim when the shader library is present", () => {
  const { PZ, THREE } = setup();
  THREE.ShaderChunk = { lights_pars_begin: "spotLight.decay" };
  THREE.ShaderLib = { standard: { uniforms: {} }, physical: { uniforms: {} } };
  const registrations = new Map();
  PZ.trapcode.lights.install(PZ, { registerClass(entry) {
    registrations.set(entry.type, entry); return () => registrations.delete(entry.type);
  } });
  try {
    assert.ok(THREE.UniformsLib.LTC_1, "bundled LTC tables installed");
    const area = registrations.get("zoidium:trapcode-suite/area-light").factory();
    area.load(null);
    assert.ok(area.threeObj.isRectAreaLight, "real RectAreaLight backend in the editor");
    area.properties.width.set(40);
    area.properties.height.set(20);
    area.properties.intensity.set(3);
    area.update(5);
    assert.equal(area.threeObj.width, 40);
    assert.equal(area.threeObj.height, 20);
    assert.equal(area.threeObj.intensity, 3);
    assert.deepEqual(area.threeObj.lookedAt, [0, 0, 0]);
    assert.deepEqual([area.threeObj.areaHelper.scale.x, area.threeObj.areaHelper.scale.y], [40, 20]);
    const portal = registrations.get("zoidium:trapcode-suite/portal-light").factory();
    portal.load(null);
    assert.ok(portal.threeObj.isRectAreaLight, "portal shares the rectangular backend");
    portal.update(5);
  } finally {
    PZ.trapcode.lights.uninstall();
  }
  assert.equal(THREE.UniformsLib.LTC_1, undefined, "disable removes the bundled tables");
  assert.equal(THREE.ShaderLib.standard.uniforms.ltc_1, undefined, "disable removes the LTC uniforms");
});

test("infinite light applies Kelvin tint and shadow coverage without changing stock lights", () => {
  const {PZ,make}=factorySetup();
  try {
    const light=make('infinite');light.threeObj.shadow.camera={};
    light.properties.temperature.set(2000);light.properties.shadowSoftness.set(3);light.properties.shadowExtent.set(400);light.update(0);
    assert.ok(light.threeObj.color.b<light.threeObj.color.r);
    assert.equal(light.threeObj.shadow.radius,3);
    assert.equal(light.threeObj.shadow.camera.left,-200);
    light.properties.temperature.set(6500);light.update(0);
    assert.ok(light.threeObj.color.b>0.9);
  } finally {PZ.trapcode.lights.uninstall();}
});

test("compile hook preserves custom material callbacks and restores them on dispose and disable", () => {
  const {PZ,THREE}=setup();
  class Material {
    constructor(){this.listeners=new Map();}
    addEventListener(name,fn){this.listeners.set(name,fn);}
    removeEventListener(name,fn){if(this.listeners.get(name)===fn)this.listeners.delete(name);}
    dispose(){this.listeners.get('dispose')?.();}
  }
  const original=function () {};
  Material.prototype.onBeforeCompile=original;
  THREE.Material=Material;
  THREE.DataTexture=class {constructor(data,width,height){this.image={data,width,height};}dispose(){}};
  THREE.ShaderChunk={lights_pars_begin:'spotLight.decay'};
  THREE.ShaderLib={standard:{uniforms:{},fragmentShader:'standard'}};
  PZ.trapcode.lights.install(PZ);
  const m=new Material(), custom=function(shader){shader.uniforms.custom={value:42};};
  m.onBeforeCompile=custom;
  const shader={uniforms:{}};
  m.onBeforeCompile(shader);
  assert.equal(shader.uniforms.custom.value,42);
  assert.ok(shader.uniforms.zoidiumIESAtlas.value);
  assert.notEqual(m.onBeforeCompile.toString(),custom.toString(),'r91 program cache must see the patched compile key');
  m.dispose();assert.equal(m.onBeforeCompile,custom);assert.equal(m.listeners.size,0);
  const alive=new Material();alive.onBeforeCompile=custom;alive.onBeforeCompile({uniforms:{}});
  PZ.trapcode.lights.uninstall();
  assert.equal(Material.prototype.onBeforeCompile,original);
  assert.equal(alive.onBeforeCompile,custom);
  assert.equal(alive.listeners.size,0);
});

test("photometric capacity chooses the same saved addresses under reversed evaluation order", () => {
  const {PZ,THREE,Light}=setup();
  THREE.DataTexture=class {constructor(data,width,height){this.image={data,width,height};}dispose(){}};
  THREE.ShaderChunk={lights_pars_begin:'spotLight.decay'};THREE.ShaderLib={standard:{uniforms:{},fragmentShader:'standard'}};
  PZ.trapcode.lights.install(PZ);
  try {
    const lights=Array.from({length:17},(_,i)=>{const light=new Light();light.load({objectType:6});light.getAddress=()=>[i];return light;});
    // Only evaluate lights that fit the capacity; no warning is needed here.
    lights[0].update(0);
    const expected=lights.map(light=>light.iesSlot);
    for(const light of lights.slice().reverse().filter(light=>light.iesSlot!==undefined))light.update(9);
    assert.deepEqual(lights.map(light=>light.iesSlot),expected);
    assert.equal(lights.filter(light=>light.iesSlot!==undefined).length,16);
    assert.equal(new Set(lights.filter(light=>light.iesSlot!==undefined).map(light=>light.iesSlot)).size,16);
  }finally{PZ.trapcode.lights.uninstall();}
});
