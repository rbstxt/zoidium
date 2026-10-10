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
  ["legacy Portal", { objectType: 8, properties: { name: "Saved portal" } }, "DirectionalLight", "zoidium:trapcode-suite/portal-light"],
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
    assert.equal(ies.properties.iesProfile.get(), "default.ies");
    assert.ok(ies.properties.angle && ies.properties.penumbra);

    const portal = registrations.get("zoidium:trapcode-suite/portal-light").factory();
    portal.load(null);
    assert.equal(portal.properties.name.get(), "Portal Light");
    // The test THREE build has no LTC tables, so the rect backend falls back
    // to a DirectionalLight, matching the donor.
    assert.ok(portal.threeObj instanceof THREE.DirectionalLight);
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
    assert.deepEqual(seen, [4, 1, 3, 3, 2], "helper saw stock ids (test THREE has no LTC tables)");
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
