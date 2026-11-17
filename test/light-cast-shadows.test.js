"use strict";

// Per-light "Cast shadows". Native spot, point and directional lights (and the
// suite lights that cast today) get a static 0/1 row; the suite Area, IES and
// Portal lights keep today's no-shadow look by default. The row writes
// three.js `castShadow`, survives save/load, and never animates.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { nativeHost } = require("./expressions-plus-harness");
const { createPZ, createTHREE, readSource } = require("./trapcode-env");

const projectRoot = path.resolve(__dirname, "..");
const ENABLED_SOURCE = fs.readFileSync(path.join(projectRoot, "plugins/core/object3d-enabled.js"), "utf8");
const KEY = "zoidiumCastShadows";

function native() {
  const host = nativeHost();
  host.context.window = host.context;
  vm.runInContext(ENABLED_SOURCE, host.context);
  return host;
}

function newLight(PZ, data) {
  const light = PZ.object3d.create(3);
  light.load(data);
  return light;
}

function saved(light) {
  return JSON.parse(JSON.stringify(light.properties));
}

test("native spot, point and directional lights default to shadows on", () => {
  const { PZ, THREE } = native();
  for (const [type, name] of [[1, "SpotLight"], [2, "PointLight"], [3, "DirectionalLight"]]) {
    const light = newLight(PZ, { objectType: type });
    assert.ok(light.threeObj instanceof THREE[name], name);
    const row = light.properties[KEY];
    assert.ok(row, `${name} has a Cast shadows row`);
    assert.equal(row.get(), 1, `${name} casts today`);
    assert.equal(light.threeObj.castShadow, true, `${name} keeps casting`);
    assert.equal(row.definition.name, "Cast shadows");
    assert.equal(row.definition.items, "off;on");
    assert.equal(row.definition.zoidiumControl, "core/cast-shadows");
  }
});

test("native hemisphere lights have no Cast shadows row", () => {
  const { PZ } = native();
  const light = newLight(PZ, { objectType: 4 });
  assert.equal(light.properties[KEY], undefined);
});

test("the row is static, so playback cannot toggle it", () => {
  const { PZ } = native();
  const light = newLight(PZ, { objectType: 2 });
  const row = light.properties[KEY];
  assert.equal(row.animated, false);
  assert.equal(row.keyframes, undefined);
  assert.equal(typeof row.get(120), "number", "reading at a frame returns the plain value");
  row.set(0);
  assert.equal(row.get(0), 0, "a static value is frame-independent");
  assert.equal(row.get(500), 0);
  assert.equal(row.toJSON(), 0, "the value serializes as a scalar");
});

test("toggling the row writes three.js castShadow both ways", () => {
  const { PZ } = native();
  const light = newLight(PZ, { objectType: 2 });
  const row = light.properties[KEY];
  row.set(0);
  assert.equal(light.threeObj.castShadow, false);
  row.set(1);
  assert.equal(light.threeObj.castShadow, true);
});

test("a project saved before the row existed loads with shadows on and today's settings", () => {
  const { PZ } = native();
  const light = newLight(PZ, {
    objectType: 1,
    properties: { name: "Saved spot", intensity: { animated: false, keyframes: [{ frame: 0, value: 4, tween: 1 }] } },
  });
  assert.equal(light.properties[KEY].get(), 1, "no saved value keeps the default");
  assert.equal(light.threeObj.castShadow, true);
  assert.equal(light.threeObj.shadow.mapSize.width, 1024);
  assert.equal(light.threeObj.shadow.mapSize.height, 1024);
  assert.equal(light.threeObj.shadow.camera.near, 5);
  assert.equal(light.threeObj.shadow.camera.far, 1500);
  assert.equal(light.threeObj.shadow.camera.fov, 60);
  assert.equal(light.threeObj.shadow.bias, 0);
  assert.equal(light.properties.name.get(), "Saved spot");
});

test("the switch survives a save and load round trip", () => {
  const { PZ } = native();
  const light = newLight(PZ, { objectType: 2 });
  light.properties[KEY].set(0);
  const data = { objectType: 2, properties: saved(light) };
  assert.equal(data.properties[KEY], 0, "the off value is serialized");

  const copy = newLight(PZ, data);
  assert.equal(copy.properties[KEY].get(), 0);
  assert.equal(copy.threeObj.castShadow, false, "a saved off light reloads off");

  data.properties[KEY] = 1;
  const on = newLight(PZ, data);
  assert.equal(on.properties[KEY].get(), 1);
  assert.equal(on.threeObj.castShadow, true);
});

test("an older build ignores the saved key instead of failing to load", () => {
  const { PZ } = native();
  const light = newLight(PZ, { objectType: 3 });
  light.properties[KEY].set(0);
  const data = saved(light);

  // A build without the row has no property under that key. CM3 loads only
  // the properties it knows, so the extra key is ignored.
  const older = PZ.object3d.create(3);
  older.load({ objectType: 2 });
  delete older.properties[KEY];
  assert.doesNotThrow(() => older.properties.load(data));
  assert.equal(older.properties[KEY], undefined);
  assert.deepEqual(Array.from(older.properties.color.get(0)), [1, 1, 1]);
});

test("an unknown saved value still loads and reads as off", () => {
  const { PZ } = native();
  const light = newLight(PZ, { objectType: 2, properties: { [KEY]: "unexpected" } });
  assert.equal(light.threeObj.castShadow, false, "only the on value casts shadows");
  assert.equal(light.properties[KEY].get(), "unexpected", "the saved value is preserved");
});

test("a disabled light keeps its castShadow setting", () => {
  const { PZ } = native();
  const light = newLight(PZ, { objectType: 2, properties: { intensity: { animated: false, keyframes: [{ frame: 0, value: 3, tween: 1 }] } } });
  light.properties[KEY].set(0);
  light.properties.enabled.set(0, 0);
  light.update(1);
  assert.equal(light.threeObj.visible, true, "a disabled light keeps its place in the light count");
  assert.equal(light.threeObj.intensity, 0);
  assert.equal(light.threeObj.castShadow, false, "the switch is not re-applied by the mute");

  light.properties[KEY].set(1);
  light.update(1);
  assert.equal(light.threeObj.castShadow, true, "editing the switch while muted still applies");
  assert.equal(light.threeObj.intensity, 0);

  light.properties.enabled.set(1, 1);
  light.update(1);
  assert.equal(light.threeObj.intensity, 3);
  assert.equal(light.threeObj.castShadow, true);
});

// ---- Trapcode suite lights -------------------------------------------------

function suiteHost() {
  const PZ = createPZ();
  const THREE = createTHREE();
  const enabledRow = { dynamic: true, name: "Enabled", type: PZ.property.type.OPTION, value: 1, items: "off;on" };
  const defs = {
    position: { dynamic: true, group: true, name: "Position", type: PZ.property.type.VECTOR3, objects: [
      { dynamic: true, name: "Position.X", type: 0, value: 0 },
      { dynamic: true, name: "Position.Y", type: 0, value: 10 },
      { dynamic: true, name: "Position.Z", type: 0, value: 0 }] },
    target: { dynamic: true, group: true, name: "Target", type: PZ.property.type.VECTOR3, objects: [
      { dynamic: true, name: "Target.X", type: 0, value: 0 },
      { dynamic: true, name: "Target.Y", type: 0, value: 0 },
      { dynamic: true, name: "Target.Z", type: 0, value: 0 }] },
    color: { dynamic: true, group: true, name: "Color", type: PZ.property.type.COLOR, objects: [
      { dynamic: true, name: "Color.R", type: 0, value: 1 },
      { dynamic: true, name: "Color.G", type: 0, value: 1 },
      { dynamic: true, name: "Color.B", type: 0, value: 1 }] },
    skyColor: { dynamic: true, group: true, name: "Sky", type: PZ.property.type.COLOR, objects: [
      { dynamic: true, name: "Sky.R", type: 0, value: 1 },
      { dynamic: true, name: "Sky.G", type: 0, value: 1 },
      { dynamic: true, name: "Sky.B", type: 0, value: 1 }] },
    groundColor: { dynamic: true, group: true, name: "Ground", type: PZ.property.type.COLOR, objects: [
      { dynamic: true, name: "Ground.R", type: 0, value: 0 },
      { dynamic: true, name: "Ground.G", type: 0, value: 0 },
      { dynamic: true, name: "Ground.B", type: 0, value: 0 }] },
    intensity: { dynamic: true, name: "Intensity", type: 0, value: 1 },
    angle: { dynamic: true, name: "Angle", type: 0, value: 60 },
  };
  class Group extends PZ.object3d {}
  Group.propertyDefinitions = { enabled: enabledRow };
  class Camera extends PZ.object3d {}
  class Light extends PZ.object3d {
    constructor() {
      super();
      this.threeObj = null;
      this.objectType = 1;
    }
    load(data) {
      if (typeof data === "object") this.objectType = data.objectType;
      this.changeObjectType(this.objectType);
      this.properties.load(data && data.properties);
    }
    changeObjectType(type) {
      this.objectType = type;
      this.threeObj = type === 4
        ? new THREE.HemisphereLight(1, 1, 1)
        : new THREE.SpotLight(1, 1, 0, 1, 0.5, 1);
      this.properties.addAll({
        color: PZ.property.create(defs.color),
        position: PZ.property.create(defs.position),
        target: PZ.property.create(defs.target),
        intensity: PZ.property.create(defs.intensity),
        angle: PZ.property.create(defs.angle),
      });
      this.parentChanged();
    }
    update() {}
  }
  Light.propertyDefinitions = Object.assign({
    name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Light" },
  }, defs);
  PZ.object3d.light = Light;
  PZ.object3d.group = Group;
  PZ.object3d.camera = Camera;
  PZ.object3d.propertyDefinitions = { name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Object" } };

  vm.runInNewContext(ENABLED_SOURCE, { window: { PZ } });
  new Function("PZ", "THREE", readSource("trapcode-common.js"))(PZ, THREE);
  new Function("PZ", "THREE", readSource("lights-c4d.js"))(PZ, THREE);
  PZ.trapcode.lights.install(PZ);
  return { PZ, THREE, Light };
}

const LEGACY_EXTRA = {
  1: { distance: 0 },
  2: { distance: 0 },
  3: { decay: 1 },
  4: { width: 10, height: 10 },
};

function suiteLight(host, type) {
  const light = new host.Light();
  light.type = 3;
  light.load({ objectType: type, properties: Object.assign({ name: "Suite " + type }, LEGACY_EXTRA[type]) });
  return light;
}

function casters(root) {
  const out = [];
  const walk = (node) => {
    if (node.castShadow) out.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return out;
}

test("suite lights that cast today default on; Area, IES and Portal default off", () => {
  const host = suiteHost();
  try {
    for (const type of [1, 2, 3, 7]) {
      const light = suiteLight(host, type);
      const row = light.properties[KEY];
      assert.ok(row, `type ${type} has the row`);
      assert.equal(row.get(), 1, `type ${type} casts today`);
      assert.equal(light.threeObj.castShadow, true);
    }
    for (const type of [4, 6, 8]) {
      const light = suiteLight(host, type);
      const row = light.properties[KEY];
      assert.ok(row, `type ${type} has the row`);
      assert.equal(row.get(), 0, `type ${type} renders without shadows today`);
      assert.equal(Boolean(light.threeObj.castShadow), false);
    }
  } finally {
    host.PZ.trapcode.lights.uninstall();
  }
});

test("a suite hemisphere light has no Cast shadows row", () => {
  const host = suiteHost();
  try {
    const light = suiteLight(host, 5);
    assert.equal(light.properties[KEY], undefined);
  } finally {
    host.PZ.trapcode.lights.uninstall();
  }
});

test("toggling a suite light writes its backend castShadow", () => {
  const host = suiteHost();
  try {
    for (const type of [1, 2, 3, 6, 7]) {
      const light = suiteLight(host, type);
      light.properties[KEY].set(1);
      assert.equal(light.threeObj.castShadow, true, `type ${type} on`);
      light.properties[KEY].set(0);
      assert.equal(light.threeObj.castShadow, false, `type ${type} off`);
    }
  } finally {
    host.PZ.trapcode.lights.uninstall();
  }
});

test("the suite Area fallback keeps one centre shadow sample and clears it again", () => {
  const host = suiteHost();
  try {
    for (const type of [4, 8]) {
      const light = suiteLight(host, type);
      const root = light.threeObj;
      assert.equal(root.areaSamples.length, 9, `type ${type} uses the nine-sample fallback`);
      light.update(0);
      assert.equal(casters(root).length, 0, `type ${type} starts without a shadow pass`);

      light.properties[KEY].set(1);
      light.update(0);
      const on = casters(root);
      assert.equal(on.length, 1, `type ${type} uses one shadow map`);
      assert.equal(on[0], root.areaSamples[4], `type ${type} shadows through the centre sample`);
      assert.equal(root.castShadow, false, "the zero-intensity point root never casts a cube map");

      light.properties[KEY].set(0);
      light.update(0);
      assert.equal(casters(root).length, 0, `type ${type} turns the shadow pass off again`);
    }
  } finally {
    host.PZ.trapcode.lights.uninstall();
  }
});
