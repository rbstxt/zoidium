"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;


test("Text+ registers seven independent group parent types", () => {
  class PropertyList {
    constructor(definitions, parent) {
      this.parent = parent;
      this.addAll(definitions);
    }

    addAll(definitions) {
      Object.assign(this, definitions || {});
    }

    load(data) {
      this.loadedData = data;
    }
  }

  class Group {
    constructor() {
      this.objects = { name: "" };
      this.customProperties = [];
      this.properties = new PropertyList({}, this);
      this.children = [this.properties, this.customProperties, this.objects];
    }

    load(data) {
      this.loadedData = data;
    }

    toJSON() {
      return { properties: {}, objects: [] };
    }
  }
  class TextObject {
    update() {}
    unload() {}
  }
  const originalTextPropertyDefinitions = {
    bevelSize: {
      value: [0.1, 0.5],
      subtitle1: "size",
      subtitle2: "thickness",
      min: 0.01,
      step: 0.1,
    },
  };
  TextObject.propertyDefinitions = originalTextPropertyDefinitions;
  TextObject.changeFn = function changeText() {};
  const PZ = {
    object3d: {
      group: Group,
      text: TextObject,
      eulerOrders: [{ name: "XYZ", value: "XYZ" }],
    },
    property: {
      type: {
        NUMBER: 0,
        VECTOR2: 1,
        VECTOR3: 2,
        OPTION: 6,
        LIST: 9,
        TEXT: 10,
      },
    },
    propertyList: PropertyList,
  };
  const registrations = [];
  const unregistered = [];
  plugin.activate({
    PZ,
    window: { THREE: { TextGeometry: class TextGeometry {} } },
    object3d: {
      registerClass(definition) {
        registrations.push(definition);
        return () => unregistered.push(definition.type);
      },
    },
  });

  try {
    assert.deepEqual(
      registrations.map(({ type, name }) => ({ type, name })),
      [
        { type: _test.TEXT_PLUS_TYPE, name: "Character Transform" },
        { type: _test.GRADIENT_TRANSFORM_TYPE, name: "Gradient Transform" },
        { type: _test.CHARACTER_SHAKE_TYPE, name: "Character Shake" },
        {
          type: _test.SELECTED_TRANSFORM_TYPE,
          name: "Selected Character Transform",
        },
        {
          type: _test.SELECTED_SHAKE_TYPE,
          name: "Selected Character Shake",
        },
        { type: _test.RANDOM_SCATTER_TYPE, name: "Random Scatter" },
        { type: "zoidium:text-plus/character-material", name: "Character Material" },
      ]
    );
    const transform = registrations[0].factory();
    const gradient = registrations[1].factory();
    const shake = registrations[2].factory();
    const selectedTransform = registrations[3].factory();
    const selectedShake = registrations[4].factory();
    const scatter = registrations[5].factory();
    assert.ok(transform instanceof Group);
    assert.ok(gradient instanceof Group);
    assert.ok(shake instanceof Group);
    assert.ok(selectedTransform instanceof Group);
    assert.ok(selectedShake instanceof Group);
    assert.ok(scatter instanceof Group);
    assert.equal(transform.zoidiumTextPlusMode, "character-transform");
    assert.equal(gradient.zoidiumTextPlusMode, "gradient-transform");
    assert.equal(shake.zoidiumTextPlusMode, "character-shake");
    assert.equal(selectedTransform.zoidiumTextPlusMode, "selected-transform");
    assert.equal(selectedShake.zoidiumTextPlusMode, "selected-shake");
    assert.equal(scatter.zoidiumTextPlusMode, "random-scatter");
    assert.equal(transform.characterProperties._zoidiumCategoryName, "Character");
    assert.equal(
      Object.keys(transform.characterProperties).includes(
        "_zoidiumCategoryName"
      ),
      false
    );
    assert.equal(transform.children[1], transform.characterProperties);
    assert.equal(transform.properties.charPosition, undefined);
    assert.equal(
      selectedTransform.characterProperties.characterNumbers.name,
      "Characters"
    );
    assert.equal(
      selectedShake.characterProperties.characterNumbers.name,
      "Characters"
    );
    assert.equal(transform.characterProperties.shakeAmplitude, undefined);
    assert.equal(shake.characterProperties.charPosition, undefined);
    assert.equal(scatter.characterProperties.amount.name, "Amount");
    assert.equal(transform.characterProperties.pivot.name, "Pivot");
    assert.equal(shake.characterProperties.pivot.name, "Pivot");
    assert.equal(selectedTransform.characterProperties.pivot.name, "Pivot");
    assert.equal(selectedShake.characterProperties.pivot.name, "Pivot");
    assert.equal(scatter.characterProperties.pivot.name, "Pivot");
    assert.equal(gradient.characterProperties.pivot, undefined);
    assert.equal(
      gradient.characterProperties.firstPosition.name,
      "First position"
    );
    assert.equal(TextObject.propertyDefinitions.spacing.name, "Horizontal spacing");
    assert.equal(TextObject.propertyDefinitions.spacing.step, 0.5);
    assert.equal(TextObject.propertyDefinitions.bevelSize.subtitle1, "thickness");
    assert.equal(TextObject.propertyDefinitions.bevelSize.subtitle2, "width");
    assert.equal(TextObject.propertyDefinitions.bevelSize.min, 0);
    assert.equal(TextObject.propertyDefinitions.bevelSide.items, "outside;inside");
    assert.equal(TextObject.propertyDefinitions.bevelDetail.value, 3);
    assert.equal(TextObject.propertyDefinitions.bevelProfile.items, "flat;round");
    assert.equal(TextObject.propertyDefinitions.bevelTension.value, 0.5);
    transform.load({
      properties: {},
      characterProperties: { charPosition: { animated: true } },
      objects: [],
    });
    assert.deepEqual(transform.characterProperties.loadedData, {
      charPosition: { animated: true },
    });
    const serialized = transform.toJSON();
    assert.equal(serialized.schemaVersion, 5);
    assert.equal(serialized.characterProperties, transform.characterProperties);
  } finally {
    plugin.deactivate();
  }

  assert.deepEqual(unregistered, [
    _test.TEXT_PLUS_TYPE,
    _test.GRADIENT_TRANSFORM_TYPE,
    _test.CHARACTER_SHAKE_TYPE,
    _test.SELECTED_TRANSFORM_TYPE,
    _test.SELECTED_SHAKE_TYPE,
    _test.RANDOM_SCATTER_TYPE,
    "zoidium:text-plus/character-material",
  ]);
  assert.equal(TextObject.propertyDefinitions, originalTextPropertyDefinitions);
});

test("nested Text+ objects are collected outermost first through normal groups", () => {
  const outer = { zoidiumTextPlusObject: true, parentObject: null };
  const inner = { zoidiumTextPlusObject: true, parentObject: outer };
  const group = { parentObject: inner };
  const textObject = { parentObject: group };

  assert.deepEqual(_test.collectTextPlusObjects(textObject), [outer, inner]);
});

test("ancestor traversal stops safely at a broken or cyclic parent chain", () => {
  const textPlus = { zoidiumTextPlusObject: true };
  Object.defineProperty(textPlus, "parentObject", {
    get() {
      throw new TypeError("object tree ended");
    },
  });
  const textObject = { parentObject: textPlus };
  assert.deepEqual(_test.collectTextPlusObjects(textObject), [textPlus]);
  assert.equal(_test.getAncestorObject(textPlus), null);

  const cycle = { zoidiumTextPlusObject: true };
  cycle.parentObject = cycle;
  assert.deepEqual(_test.collectTextPlusObjects({ parentObject: cycle }), [cycle]);
});
