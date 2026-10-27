"use strict";

// ExpressText+ tests: stack. Required by test/expresstext-plus.test.js; not discovered directly.

const assert = require("node:assert/strict");
const test = require("node:test");
const { T, fakePZ, fakeSection, mod, props } = require("./expresstext-plus-helpers.js");

test("property schema carries the container plus eleven effectors", () => {
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    object3d: { eulerOrders: "XYZ;XZY;YXZ;YZX;ZXY;ZYX" },
  };
  // The container owns tracking only: rotation order plus the stock
  // Custom properties row (whose + dialog is scoped to effectors).
  const container = T.createContainerPropertyDefinitions(PZ);
  assert.deepEqual(Object.keys(container), ["rotationOrder"]);
  assert.equal(container.rotationOrder.value, "XYZ", "container owns the rotation order");
  const builders = {
    shake: T.createShakePropertyDefinitions,
    plain: T.createPlainPropertyDefinitions,
    random: T.createRandomPropertyDefinitions,
    formula: T.createFormulaPropertyDefinitions,
    spline: T.createSplinePropertyDefinitions,
    orbit: T.createOrbitPropertyDefinitions,
    repeater: T.createRepeaterPropertyDefinitions,
    twist: T.createTwistPropertyDefinitions,
    wrap: T.createWrapPropertyDefinitions,
    voronoi: T.createVoronoiPropertyDefinitions,
    delay: T.createDelayPropertyDefinitions,
  };
  for (const section of Object.keys(builders)) {
    const defs = builders[section](PZ);
    assert.equal(defs[`${section}Enable`].items, "off;on", `${section} enable`);
    assert.equal(defs[`${section}Letters`].type, 3, `${section} letters text`);
    assert.equal(defs[`${section}Strength`].value, 100, `${section} strength default`);
    // Random, Formula and Spline strengths enter freely (the manual
    // allows below 0% and above 100%); every other effector caps at 100%.
    if (section !== "random" && section !== "formula" && section !== "spline") {
      assert.equal(defs[`${section}Strength`].max, 100);
    }
    assert.equal(defs[`${section}Field`].items, "Infinite;Linear;Box;Sphere", `${section} field`);
  }
  assert.equal(T.EXPRESS_TEXT_TYPE, "zoidium:expresstext-plus/expresstext");
  assert.equal(T.EXPRESS_SHAKE_TYPE, "zoidium:expresstext-plus/shake");
  assert.equal(T.EXPRESS_PLAIN_TYPE, "zoidium:expresstext-plus/plain");
  assert.equal(T.EXPRESS_RANDOM_TYPE, "zoidium:expresstext-plus/random");
  assert.equal(T.EXPRESS_FORMULA_TYPE, "zoidium:expresstext-plus/formula");
  assert.equal(T.EXPRESS_DELAY_TYPE, "zoidium:expresstext-plus/delay");
  for (const section of ["shake", "plain"]) {
    const defs = builders[section](PZ);
    assert.equal(defs[`${section}Position`].type, 5, `${section} XYZ position`);
    assert.equal(defs[`${section}Rotation`].type, 5, `${section} XYZ rotation`);
    assert.equal(defs[`${section}Scale`].type, 5, `${section} XYZ scale`);
  }
  const delayDefs = builders.delay(PZ);
  assert.equal(delayDefs.delayMode.items, "Even;Blend;Spring", "delay modes");
  assert.ok(!("delayAmount" in delayDefs), "no duration row: strength paces the trail");
  assert.ok(!("delayOrder" in delayDefs), "no order row: the trail runs in letter order");
  assert.ok(!("delaySeed" in delayDefs), "no seed row without randomness");
  for (const toggle of ["delayPosition", "delayScale", "delayRotation"]) {
    assert.equal(delayDefs[toggle].items, "off;on", `${toggle} toggle`);
    assert.equal(delayDefs[toggle].value, 1, `${toggle} delayed by default`);
  }
  for (const def of Object.values(delayDefs)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("delay") === 0, "delay rows stamped");
  }
  const plainDefs = builders.plain(PZ);
  assert.equal(plainDefs.plainInvertOdd.items, "off;on", "invert odd toggle");
  assert.equal(plainDefs.plainInvertOdd.value, 0, "invert odd defaults off");
  const rnd = builders.random(PZ);
  assert.equal(rnd.randomPositionMin.type, 5, "random XYZ min position");
  assert.equal(rnd.randomPositionMax.type, 5, "random XYZ max position");
  assert.equal(rnd.randomRotationMin.type, 5, "random XYZ min rotation");
  assert.equal(rnd.randomRotationMax.type, 5, "random XYZ max rotation");
  assert.equal(rnd.randomScaleMin.type, 5, "random XYZ min scale");
  assert.equal(rnd.randomScaleMax.type, 5, "random XYZ max scale");
  assert.equal(rnd.randomMode.items, "Random;Gaussian;Noise;Turbulence;Sorted", "random modes");
  assert.equal(rnd.randomMode.value, 0, "uniform random by default");
  assert.equal(rnd.randomMinimum.value, 0, "range starts at 0%");
  assert.equal(rnd.randomMaximum.value, 100, "range ends at 100%");
  assert.ok(rnd.randomMinimum.max === undefined && rnd.randomStrength.max === undefined, "range and strength enter freely");
  assert.equal(rnd.randomSynchronized.items, "off;on", "synchronized toggle");
  assert.equal(rnd.randomSynchronized.value, 0, "split groups by default");
  assert.equal(rnd.randomIndexed.items, "off;on", "indexed toggle");
  assert.equal(rnd.randomIndexed.value, 1, "split noise axes by default");
  assert.equal(rnd.randomSpace.items, "Global;UV", "noise space");
  assert.equal(rnd.randomAnimationSpeed.value, 0, "still noise by default");
  assert.equal(rnd.randomNoiseScale.value, 100, "full noise scale by default");
  const fml = builders.formula(PZ);
  assert.equal(fml.formulaExpression.type, 3, "formula expression text");
  assert.equal(fml.formulaExpression.value, "sin(u*360*f+t*90)", "live wave by default");
  assert.equal(fml.formulaTime.value, 1, "time flows by default");
  assert.equal(fml.formulaFrequency.value, 1, "unit frequency by default");
  assert.equal(fml.formulaMinimum.value, 0, "range starts at 0%");
  assert.equal(fml.formulaMaximum.value, 100, "range ends at 100%");
  assert.ok(fml.formulaMinimum.max === undefined && fml.formulaStrength.max === undefined, "range and strength enter freely");
  assert.equal(fml.formulaPosition.type, 5, "formula XYZ position");
  assert.equal(fml.formulaRotation.type, 5, "formula XYZ rotation");
  assert.equal(fml.formulaScale.type, 5, "formula XYZ scale");
  for (const def of Object.values(fml)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("formula") === 0, "formula rows stamped");
  }
  const spl = builders.spline(PZ);
  assert.equal(spl.splineMode.items, "Step;Falloff;Relative", "spline modes");
  assert.equal(spl.splinePath.items, "Line;Circle;Helix", "built-in paths");
  assert.equal(spl.splinePlane.items, "XY;XZ;YZ", "ring planes");
  assert.equal(spl.splineTilt.type, 5, "tilt vector");
  assert.equal(spl.splineTransform.items, "Absolute;Relative", "transform modes");
  assert.equal(spl.splineLength.value, 100, "default line length");
  assert.equal(spl.splineRadius.value, 50, "default radius");
  assert.equal(spl.splineRadiusEnd.value, 50, "cylinder by default");
  assert.equal(spl.splineHeight.value, 100, "default helix height");
  assert.equal(spl.splineTurns.value, 1, "single turn by default");
  assert.equal(spl.splineOffset.value, 0, "no wander by default");
  assert.equal(spl.splineStart.value, 0, "path starts at 0%");
  assert.equal(spl.splineEnd.value, 100, "path ends at 100%");
  assert.equal(spl.splineClamp.value, 1, "clamped ends by default");
  assert.equal(spl.splinePosition.value, 1, "position varies by default");
  assert.equal(spl.splineRotation.value, 1, "rotation varies by default");
  assert.ok(spl.splineStrength.max === undefined, "strength enters freely");
  assert.ok(!("splineSeed" in spl), "no seed row: single paths have no segments");
  for (const def of Object.values(spl)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("spline") === 0, "spline rows stamped");
  }
  const orb = builders.orbit(PZ);
  assert.deepEqual(orb.orbitAngle.value, [0, 0, 0], "rest angle by default");
  assert.equal(orb.orbitRadius.value, 100, "full radius by default");
  assert.ok(orb.orbitAngle.max === undefined, "angle enters freely");
  assert.ok(!("orbitSeed" in orb), "no seed row");
  assert.ok(!("orbitPosition" in orb), "no XYZ rows: the orbit is the transform");
  for (const def of Object.values(orb)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("orbit") === 0, "orbit rows stamped");
  }
  const rep = builders.repeater(PZ);
  assert.equal(rep.repeaterMode.items, "Linear;Random;Echo", "repeater modes");
  assert.equal(rep.repeaterMode.value, 0, "linear by default");
  assert.equal(rep.repeaterCopies.value, 3, "three ghosts by default");
  assert.equal(rep.repeaterCopies.min, 0, "copies switch off");
  assert.equal(rep.repeaterCopies.max, 64, "copies stay bounded");
  assert.deepEqual(rep.repeaterOffset.value, [10, 0, 0], "default step");
  assert.equal(rep.repeaterLag.value, 2, "two-frame echo lag by default");
  assert.equal(rep.repeaterFade.value, 50, "half fade by default");
  for (const def of Object.values(rep)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("repeater") === 0, "repeater rows stamped");
  }
  const tws = builders.twist(PZ);
  assert.equal(tws.twistAxis.items, "X;Y;Z", "twist axes");
  assert.equal(tws.twistAxis.value, 2, "twirls in screen plane by default");
  assert.equal(tws.twistAngle.value, 0, "rest angle by default");
  for (const def of Object.values(tws)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("twist") === 0, "twist rows stamped");
  }
  const wrp = builders.wrap(PZ);
  assert.equal(wrp.wrapDirection.items, "X;Y;Z", "wave directions");
  assert.equal(wrp.wrapDirection.value, 1, "flag wave by default");
  assert.equal(wrp.wrapFrequency.value, 1, "single cycle by default");
  for (const def of Object.values(wrp)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("wrap") === 0, "wrap rows stamped");
  }
  const vor = builders.voronoi(PZ);
  assert.equal(vor.voronoiChunks.value, 8, "eight chunks by default");
  assert.equal(vor.voronoiChunks.min, 1, "at least one chunk");
  assert.equal(vor.voronoiChunks.max, 64, "chunks stay bounded");
  assert.equal(vor.voronoiExplode.value, 0, "assembled by default");
  for (const def of Object.values(vor)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("voronoi") === 0, "voronoi rows stamped");
  }
});

test("layered stack composes ancestor effectors in order", () => {
  const list = { order: [0, 1, 2], total: 3 };
  const base = [0, 0, 0];
  const containerProps = props({ rotationOrder: "XYZ" });
  const shakeOnly = T.evaluateStack(
    [
      {
        kind: "shake",
        props: props({
          shakeEnable: 1,
          shakeLetters: "",
          shakeStrength: 100,
          shakePosition: [4, 0, 0],
          shakeRotation: [0, 0, 0],
          shakeScale: [1, 1, 1],
          shakeFrequency: 1,
          shakeOffset: 0.25,
          shakeDelay: 0,
          shakeDelayOrder: 0,
          shakeSeed: 1,
          shakeField: 0,
        }),
      },
    ],
    containerProps,
    0,
    0,
    list,
    base
  );
  assert.ok(Math.abs(shakeOnly.position[0] - 4) < 1e-9, "shake layer applies");
  const both = T.evaluateStack(
    [
      {
        kind: "plain",
        props: props({
          plainEnable: 1,
          plainLetters: "",
          plainStrength: 100,
          plainPosition: [10, 0, 0],
          plainRotation: [0, 0, 0],
          plainScale: [1, 1, 1],
          plainDelay: 0,
          plainDelayOrder: 0,
          plainField: 0,
        }),
      },
      {
        kind: "shake",
        props: props({
          shakeEnable: 1,
          shakeLetters: "",
          shakeStrength: 100,
          shakePosition: [4, 0, 0],
          shakeRotation: [0, 0, 0],
          shakeScale: [1, 1, 1],
          shakeFrequency: 1,
          shakeOffset: 0.25,
          shakeDelay: 0,
          shakeDelayOrder: 0,
          shakeSeed: 1,
          shakeField: 0,
        }),
      },
      { kind: "future-effector", props: props({}) },
    ],
    containerProps,
    0,
    0,
    list,
    base
  );
  assert.ok(Math.abs(both.position[0] - 14) < 1e-9, "layers add, unknown kinds ignored");
  assert.equal(both.eulerOrder, "XYZ", "order comes from the container");
  const empty = T.evaluateStack([], containerProps, 0, 0, list, base);
  assert.deepEqual(empty.position, [0, 0, 0], "no layers is identity");
});

test("layer collection finds the container plus effectors, outermost first", () => {
  const container = { zoidiumExpressTextObject: true, parentObject: null };
  const shake = { zoidiumExpressEffector: "shake", parentObject: container };
  const textObject = { parentObject: shake };
  container.parentObject = null;
  const layers = T.collectExpressObjects(textObject);
  assert.deepEqual(layers, [container, shake], "outermost first");
  assert.equal(T.expressContainerOf(layers), container);
  assert.deepEqual(
    T.expressStackOf(layers).map((l) => l.kind),
    ["shake"]
  );
  const plus = { zoidiumTextPlusObject: true, parentObject: null };
  const owned = { parentObject: plus };
  assert.deepEqual(T.collectExpressObjects(owned), [], "defers to Text+");
});

test("activate registers only the container; effectors come from the factory map", () => {  const registered = [];
  class FakeDynamic {}
  class FakeList {
    constructor(owner, itemClass) {
      this.owner = owner;
      this.itemClass = itemClass;
      this.length = 0;
    }
  }
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
      this.customProperties = { __custom: true, name: "Custom properties" };
      this.children.push(this.customProperties);
    }
  }
  class FakePropertyList {
    constructor(definitions, owner) {
      this.definitions = definitions;
      this.owner = owner;
    }
    load() {}
  }
  const PZ = {
    property: {
      type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 },
      dynamic: FakeDynamic,
    },
    propertyList: FakePropertyList,
    objectList: FakeList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
    ui: { objectTypes: new Map() },
  };
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const context = {
    PZ,
    editor: null,
    window: { THREE: { TextGeometry: function () {} } },
    object3d: {
      registerClass(def) {
        registered.push(def);
        return () => {};
      },
    },
  };
  mod.activate(context);
  try {
    // Only the container is globally registered: effectors live inside the
    // one single group, built from the factory map, never picker-listed.
    const types = registered.map((r) => r.type);
    assert.deepEqual(types, ["zoidium:expresstext-plus/expresstext"]);
    for (const def of registered) {
      assert.equal(typeof def.factory, "function");
      const inst = def.factory();
      assert.equal(inst.type, def.type, `${def.type} stamps its type`);
    }
    for (const kind of ["shake", "plain", "random", "formula", "delay", "spline", "orbit", "repeater", "twist", "wrap", "voronoi"]) {
      const inst = T.newEffectorInstance(T.EFFECTOR_TYPES[kind]);
      assert.ok(inst, `${kind} factory builds`);
      assert.equal(inst.zoidiumExpressEffector, kind, "effector flag");
      assert.equal(inst.objects.name, "Modifiers");
    }
    assert.equal(T.newEffectorInstance("zoidium:expresstext-plus/nope"), null);
    const box = registered.find((r) => r.type === T.EXPRESS_TEXT_TYPE);
    const boxInst = box.factory();
    assert.ok(
      boxInst.customProperties instanceof FakeList,
      "container customs scoped to effectors"
    );
    assert.equal(boxInst.customProperties.name, "Custom properties");
    assert.ok(!boxInst.children.some((c) => c && c.__custom), "generic list replaced");
    // The stock + dialog on those containers offers only effectors.
    const scopedKey = [...PZ.ui.objectTypes.keys()].find((k) => typeof k === "function");
    assert.ok(scopedKey, "scoped registry key installed");
    const scoped = PZ.ui.objectTypes.get(scopedKey);
    assert.deepEqual(
      scoped.map((e) => e.name),
      ["Shake", "Plain", "Random", "Formula", "Delay", "Spline", "Orbit", "Repeater", "Twist", "Wrap", "Voronoi"],
      "effectors only, never the stock five"
    );
    assert.ok(
      scoped.every((e) => e.type && e.type.group && e.type.dynamic && e.type.custom),
      "entries carry group defs"
    );
  } finally {
    mod.deactivate();
  }
});

test("container load revives effector children locally, drops nothing", () => {
  class FakeGroup {
    constructor() {
      this.objects = { name: "", pushed: [], push(c) { this.pushed.push(c); } };
      this.children = [];
    }
    load(data) { this.loadedData = data; }
  }
  class FakePropertyList {
    constructor(definitions) { this.definitions = definitions; }
    load() {}
  }
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, eulerOrders: "XYZ" },
  };
  const defs = T.getExpressDefinitions();
  const containerDef = defs.find((d) => d.type === T.EXPRESS_TEXT_TYPE);
  const Cls = T.createExpressObjectClass(PZ, containerDef);
  // Factory map needs activation: register the container globally first.
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const fullPZ = {
    ...PZ,
    object3d: { ...PZ.object3d, text: TextObject },
  };
  mod.activate({
    PZ: fullPZ,
    editor: null,
    window: { THREE: { TextGeometry: function () {} } },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const inst = new Cls();
    inst.load({
      type: T.EXPRESS_TEXT_TYPE,
      properties: { name: "Box" },
      objects: [
        {
          type: T.EFFECTOR_TYPES.shake,
          properties: { name: "Old Shake" },
          objects: [],
          expressProperties: {},
        },
        { type: 5, properties: { name: "Text" } },
      ],
      expressProperties: {},
    });
    assert.equal(inst.objects.pushed.length, 1, "one effector revived");
    assert.equal(inst.objects.pushed[0].zoidiumExpressEffector, "shake");
    assert.equal(
      inst.objects.pushed[0].loadedData.properties.name,
      "Old Shake",
      "effector name preserved"
    );
    assert.deepEqual(
      inst.loadedData.objects.map((o) => o.type),
      [5],
      "only the plain child takes the generic path"
    );
  } finally {
    mod.deactivate();
  }
});

test("every section row is dynamic (host group rule)", () => {
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    object3d: { eulerOrders: "XYZ" },
  };
  const check = (def, trail) => {
    assert.equal(def.dynamic, true, `${trail} is dynamic`);
    for (const child of def.objects || []) check(child, `${trail}.${child.name}`);
  };
  for (const build of [
    T.createShakePropertyDefinitions,
    T.createPlainPropertyDefinitions,
    T.createRandomPropertyDefinitions,
    T.createFormulaPropertyDefinitions,
    T.createSplinePropertyDefinitions,
    T.createOrbitPropertyDefinitions,
    T.createRepeaterPropertyDefinitions,
    T.createDelayPropertyDefinitions,
  ]) {
    for (const def of Object.values(build(PZ))) check(def, def.name);
  }
});

test("effector entries register scoped to the subclass key", () => {
  const PZ = fakePZ();
  const defs = T.effectorEntryDefs(PZ);
  assert.deepEqual(defs.map((d) => d.name), ["Shake", "Plain", "Random", "Formula", "Delay", "Spline", "Orbit", "Repeater", "Twist", "Wrap", "Voronoi"]);
  for (const entry of defs) {
    assert.ok(entry.desc, `${entry.name} filterable description`);
    assert.equal(entry.type.custom, true);
    assert.equal(entry.type.group, true);
    assert.equal(entry.type.dynamic, true);
    assert.equal(entry.type.name, entry.name, "name lives inside the type (save-safe)");
    // VECTOR3 routes group rows through the stock vector editor, never
    // through generateInput (which reads keyframes fresh groups lack).
    assert.equal(entry.type.type, 5, "vector path for group rows");
    assert.ok(entry.type.objects.length >= 9, `${entry.name} carries its rows`);
  }
  const shake = defs[0].type.objects;
  assert.ok(shake.some((d) => d.effectorKey === "shakeEnable"), "stamped keys survive");
  assert.ok(shake.some((d) => d.effectorKey === "shakePosition"), "XYZ stamped");
  assert.ok(T.registerEffectorEntries(PZ), "registered");
  const scoped = PZ.ui.objectTypes.get(
    [...PZ.ui.objectTypes.keys()].find((k) => typeof k === "function")
  );
  assert.equal(scoped.length, 11, "eleven effectors, never the stock five");
  assert.ok(!scoped.some((e) => e.name === "Number"), "no generic types leak in");
  assert.ok(scoped.some((e) => e.name === "Formula"), "formula offered in the dialog");
});

test("sections are found by display name, rows by stamped key", () => {  const container = {
    customProperties: [
      fakeSection("Plain", { plainEnable: 1, plainPosition: [10, 0, 0] }),
      fakeSection("Shake", { shakeEnable: 0 }),
    ],
  };
  container.customProperties.length = 2;
  assert.equal(T.sectionGroupOf(container, "Plain").definition.name, "Plain");
  assert.equal(T.sectionGroupOf(container, "Delay"), null, "absent section");
  assert.equal(T.sectionGroupOf(null, "Plain"), null);
  assert.equal(T.sectionGroupOf({}, "Plain"), null, "no customs list");
  const reader = T.groupReader(T.sectionGroupOf(container, "Plain"));
  assert.equal(reader.get("plainEnable").get(), 1);
  assert.deepEqual(reader.get("plainPosition").get(), [10, 0, 0]);
  assert.equal(reader.get("plainNope"), undefined, "missing row");
  assert.equal(T.groupReader(null).get("x"), undefined);
});

test("copies are found by stamped keys and stack with own values", () => {
  assert.equal(T.kindOfKey("shakeEnable"), "shake");
  assert.equal(T.kindOfKey("shakeFieldPosition"), "shake");
  assert.equal(T.kindOfKey("plainLetters"), "plain");
  assert.equal(T.kindOfKey("formulaExpression"), "formula");
  assert.equal(T.kindOfKey("formulaFieldScale"), "formula");
  assert.equal(T.kindOfKey("splineEnable"), "spline");
  assert.equal(T.kindOfKey("splineRadiusEnd"), "spline");
  assert.equal(T.kindOfKey("splineFieldPosition"), "spline");
  assert.equal(T.kindOfKey("orbitEnable"), "orbit");
  assert.equal(T.kindOfKey("orbitAngle"), "orbit");
  assert.equal(T.kindOfKey("orbitFieldScale"), "orbit");
  assert.equal(T.kindOfKey("repeaterEnable"), "repeater");
  assert.equal(T.kindOfKey("repeaterCopies"), "repeater");
  assert.equal(T.kindOfKey("repeaterFieldPosition"), "repeater");
  assert.equal(T.kindOfKey("twistAngle"), "twist");
  assert.equal(T.kindOfKey("twistAxis"), "twist");
  assert.equal(T.kindOfKey("wrapAmplitude"), "wrap");
  assert.equal(T.kindOfKey("wrapDirection"), "wrap");
  assert.equal(T.kindOfKey("voronoiChunks"), "voronoi");
  assert.equal(T.kindOfKey("voronoiSpin"), "voronoi");
  assert.equal(T.kindOfKey("nope"), null);
  assert.equal(T.kindOfKey(""), null);
  assert.equal(T.kindOfKey(null), null);
  const renamed = fakeSection("Shake 2", { shakeEnable: 1 });
  assert.equal(T.kindOfGroup(renamed), "shake", "renamed copy still resolves");
  assert.equal(T.kindOfGroup(fakeSection("Noise", {})), null, "unstamped ignored");
  assert.equal(T.kindOfGroup(null), null);
  // Two copies of Plain each contribute: +10 then +20.
  const mk = (pos) =>
    fakeSection("Plain", {
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: pos,
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    });
  const container = { customProperties: [mk([10, 0, 0]), mk([20, 0, 0])] };
  container.customProperties.length = 2;
  const stack = T.stackLayersFor(container, []);
  assert.deepEqual(stack.map((l) => l.kind), ["plain", "plain"], "both copies stack");
  const list = { order: [0], total: 1 };
  const out = T.evaluateStack(stack, T.staticProps({ rotationOrder: "XYZ" }), 0, 0, list, [0, 0, 0]);
  assert.deepEqual(out.position, [30, 0, 0], "copies add up");
});

test("stack reads customs sections first, legacy objects after", () => {
  const container = {
    customProperties: [
      fakeSection("Plain", {
        plainEnable: 1,
        plainLetters: "",
        plainStrength: 100,
        plainPosition: [10, 0, 0],
        plainRotation: [0, 0, 0],
        plainScale: [1, 1, 1],
        plainDelay: 0,
        plainDelayOrder: 0,
        plainField: 0,
      }),
    ],
  };
  container.customProperties.length = 1;
  const legacy = {
    zoidiumExpressEffector: "shake",
    expressProperties: T.staticProps({ shakeEnable: 1 }),
  };
  const stack = T.stackLayersFor(container, [legacy]);
  assert.deepEqual(stack.map((l) => l.kind), ["plain", "shake"], "sections first");
  assert.equal(typeof stack[0].props.get, "function", "section props are readers");
  assert.deepEqual(T.stackLayersFor(null, [legacy]).map((l) => l.kind), ["shake"]);
  assert.deepEqual(T.stackLayersFor(container, []).map((l) => l.kind), ["plain"]);
  // End to end through the customs section: letter 2 moves +10.
  const list = { order: [0, 1, 2, 3, 4], total: 5 };
  const out = T.evaluateStack(stack, T.staticProps({ rotationOrder: "XYZ" }), 0, 1, list, [0, 0, 0]);
  assert.deepEqual(out.position, [10, 0, 0]);
});

test("reattach restores identities stripped by stock revive", () => {  const live = {
    length: 1,
    0: {
      definition: {},
      objects: [{ definition: {}, get: () => 50 }],
    },
  };
  const raw = [
    {
      type: {
        name: "Shake",
        objects: [{ name: "Shake strength", effectorKey: "shakeStrength" }],
      },
      objects: [{ animated: false, keyframes: [{ value: 50, frame: 0 }] }],
    },
  ];
  T.reattachCustomDefinitions(live, raw);
  assert.equal(live[0].definition.name, "Shake");
  assert.equal(live[0].objects[0].definition.effectorKey, "shakeStrength");
  const healthy = { length: 1, 0: { definition: { name: "Plain" }, objects: [] } };
  T.reattachCustomDefinitions(healthy, raw);
  assert.equal(healthy[0].definition.name, "Plain", "healthy trees untouched");
  assert.doesNotThrow(() => T.reattachCustomDefinitions(null, null));
  assert.doesNotThrow(() => T.reattachCustomDefinitions({}, []));
  // Saved lists serialize as objects with numeric keys, not arrays.
  const rawLike = {
    0: {
      type: { name: "Plain", objects: [{ name: "x", effectorKey: "plainEnable" }] },
      objects: [{}],
    },
    length: 1,
  };
  const liveLike = { length: 1, 0: { definition: {}, objects: [{ definition: {} }] } };
  T.reattachCustomDefinitions(liveLike, rawLike);
  assert.equal(liveLike[0].definition.name, "Plain", "array-like raw works");
  assert.equal(liveLike[0].objects[0].definition.effectorKey, "plainEnable");
});

test("saved-list shapes normalize for iteration", () => {
  assert.deepEqual(T.rawArray([1, 2]), [1, 2], "arrays pass through");
  assert.deepEqual(T.rawArray({ 0: "a", 1: "b", length: 2 }), ["a", "b"], "array-likes convert");
  assert.deepEqual(T.rawArray(null), []);
  assert.deepEqual(T.rawArray(undefined), []);
  assert.deepEqual(T.rawArray({}), []);
  assert.deepEqual(T.rawArray("nope"), []);
});

test("constructor-installed load wraps the stock own load", () => {
  const seen = [];
  class FakeGroup {
    constructor() {
      this.objects = { name: "", pushed: [], push(c) { this.pushed.push(c); } };
      this.children = [];
      this.customProperties = { length: 0 };
      this.load = (data) => { seen.push(data); };
    }
  }
  class FakePropertyList {
    constructor(definitions) { this.definitions = definitions; }
    load() {}
  }
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, eulerOrders: "XYZ" },
  };
  const defs = T.getExpressDefinitions();
  const Cls = T.createExpressObjectClass(PZ, defs[0]);
  const inst = new Cls();
  assert.equal(typeof inst.load, "function");
  assert.notEqual(inst.load, FakeGroup.prototype.load, "instance shadows the stock load");
  // Stock-shaped live list, definitions stripped, raw carrying full defs.
  inst.customProperties = { length: 1, 0: { definition: {}, objects: [{ definition: {} }] } };
  const rawLike = {
    0: { type: { name: "Shake", objects: [{ effectorKey: "s" }] }, objects: [{}] },
    length: 1,
  };
  inst.load({ objects: [], expressProperties: {}, customProperties: rawLike });
  assert.equal(seen.length, 1, "stock load still runs");
  assert.equal(inst.customProperties[0].definition.name, "Shake", "reattach ran in the wrapper");
});

test("children effectors join the stack in list order", () => {  const shakeProps = T.staticProps({ shakeEnable: 1 });
  const child = { zoidiumExpressEffector: "shake", expressProperties: shakeProps };
  const container = {
    zoidiumExpressTextObject: true,
    parentObject: null,
    objects: [child],
  };
  const layers = [container];
  assert.equal(T.expressContainerOf(layers), container);
  const stack = T.expressStackOf(layers);
  assert.equal(stack.length, 1);
  assert.equal(stack[0].kind, "shake");
  assert.equal(stack[0].props, shakeProps);
});

test("container customs list carries the scoped item class", () => {
  class FakeDynamic {}
  class FakeList {
    constructor(owner, itemClass) {
      this.owner = owner;
      this.itemClass = itemClass;
      this.length = 0;
    }
  }
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
      this.customProperties = { __custom: true, name: "Custom properties" };
      this.children.push(this.customProperties);
    }
  }
  class FakePropertyList {
    constructor(definitions) { this.definitions = definitions; }
    load() {}
  }
  const PZ = {
    property: {
      type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 },
      dynamic: FakeDynamic,
    },
    objectList: FakeList,
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, eulerOrders: "XYZ" },
    ui: { objectTypes: new Map() },
  };
  const defs = T.getExpressDefinitions();
  const containerDef = defs.find((d) => d.type === T.EXPRESS_TEXT_TYPE);
  const Cls = T.createExpressObjectClass(PZ, containerDef);
  // Deterministic cache: (re)register with this PZ first, like activate does.
  T.unregisterEffectorEntries();
  assert.equal(T.registerEffectorEntries(PZ), true);
  const inst = new Cls();
  assert.ok(inst.customProperties instanceof FakeList, "list swapped, not detached");
  assert.equal(inst.customProperties.name, "Custom properties", "stock row label kept");
  assert.ok(
    inst.customProperties.itemClass !== FakeDynamic,
    "scoped subclass, not the generic dynamic class"
  );
  assert.ok(
    inst.customProperties.itemClass.prototype instanceof FakeDynamic,
    "subclass extends the dynamic prop"
  );
  assert.ok(!inst.children.some((c) => c && c.__custom), "generic list replaced");
});

