"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;

test("new Character Transform objects keep the published serialized type", () => {
  const data = _test.defaultObjectData(null);
  assert.equal(data.type, _test.TEXT_PLUS_TYPE);
  assert.equal(data.schemaVersion, 5);
  assert.deepEqual(data.objects, []);
  assert.deepEqual(data.customProperties, []);
  assert.deepEqual(data.properties, { name: "Character Transform" });
  assert.deepEqual(data.characterProperties, {});
});

test("split shake and selection parents carry independent serialized types", () => {
  const definitions = [
    [
      _test.defaultCharacterShakeData,
      _test.CHARACTER_SHAKE_TYPE,
      "Character Shake",
      4,
    ],
    [
      _test.defaultSelectedTransformData,
      _test.SELECTED_TRANSFORM_TYPE,
      "Selected Character Transform",
      3,
    ],
    [
      _test.defaultSelectedShakeData,
      _test.SELECTED_SHAKE_TYPE,
      "Selected Character Shake",
      4,
    ],
  ];

  for (const [createData, type, name, schemaVersion] of definitions) {
    const data = createData(null);
    assert.equal(data.type, type);
    assert.equal(data.schemaVersion, schemaVersion);
    assert.deepEqual(data.objects, []);
    assert.deepEqual(data.customProperties, []);
    assert.deepEqual(data.properties, { name });
    assert.deepEqual(data.characterProperties, {});
  }
});

test("new Random Scatter objects carry their own serialized type", () => {
  const data = _test.defaultRandomScatterData(null);
  assert.equal(data.type, _test.RANDOM_SCATTER_TYPE);
  assert.equal(data.schemaVersion, 3);
  assert.deepEqual(data.objects, []);
  assert.deepEqual(data.customProperties, []);
  assert.deepEqual(data.properties, { name: "Random Scatter" });
  assert.deepEqual(data.characterProperties, {});
});

test("new Gradient Transform objects carry their own serialized type", () => {
  const data = _test.defaultGradientTransformData(null);
  assert.equal(data.type, _test.GRADIENT_TRANSFORM_TYPE);
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.objects, []);
  assert.deepEqual(data.customProperties, []);
  assert.deepEqual(data.properties, { name: "Gradient Transform" });
  assert.deepEqual(data.characterProperties, {});
});

test("loaded Text+ objects keep their children and group data", () => {
  const data = _test.defaultObjectData({
    type: "zoidium:text-plus/text-plus",
    properties: { name: "Title animator", position: [1, 2, 3] },
    characterProperties: { charPosition: [4, 5, 6] },
    customProperties: [{ type: 0 }],
    objects: [{ type: 1 }],
  });
  assert.deepEqual(data.objects, [{ type: 1 }]);
  assert.deepEqual(data.customProperties, [{ type: 0 }]);
  assert.deepEqual(data.properties, {
    name: "Title animator",
    position: [1, 2, 3],
  });
  assert.deepEqual(data.characterProperties, {
    charPosition: [4, 5, 6],
  });
});

test("delay order decides which character starts first", () => {
  const count = 5;
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => _test.getDelayRank("start", index, count, 1)),
    [0, 1, 2, 3, 4]
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => _test.getDelayRank("end", index, count, 1)),
    [4, 3, 2, 1, 0]
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => _test.getDelayRank("middle", index, count, 1)),
    [4, 2, 0, 1, 3]
  );
  assert.equal(_test.getDelayRank("middle", 0, 1, 1), 0);
});

test("random delay order is a stable permutation", () => {
  const first = Array.from({ length: 8 }, (_value, index) =>
    _test.getDelayRank("random", index, 8, 1234)
  );
  const second = Array.from({ length: 8 }, (_value, index) =>
    _test.getDelayRank("random", index, 8, 1234)
  );
  const other = Array.from({ length: 8 }, (_value, index) =>
    _test.getDelayRank("random", index, 8, 4321)
  );

  assert.deepEqual(first, second);
  assert.deepEqual(first.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.notDeepEqual(first, other);
  assert.deepEqual(_test.getRandomOrder(8, 1234), _test.getRandomOrder(8, 1234));
});

test("delay offsets the animation frame by the configured step", () => {
  assert.equal(_test.getCharacterDelay("start", 0, 4, 3, 1), 0);
  assert.equal(_test.getCharacterDelay("start", 1, 4, 3, 1), 3);
  assert.equal(_test.getCharacterDelay("start", 2, 4, 3, 1), 6);
  assert.equal(_test.getCharacterDelay("end", 3, 4, 3, 1), 0);
  assert.equal(_test.getCharacterDelay("start", 3, 4, -5, 1), 0);
});

test("transform delays properties while shake offsets its user-controlled phase", () => {
  const transformReadFrames = [];
  const shakeReadFrames = [];
  const animated = (readFrames, value) => ({
    get(frame) {
      readFrames.push(frame);
      return typeof value === "function" ? value(frame) : value;
    },
  });
  const transform = {
    properties: {
      delayOrder: animated(transformReadFrames, 0),
      randomSeed: animated(transformReadFrames, 1),
      delayPerCharacter: animated(transformReadFrames, 3),
      charPosition: animated(transformReadFrames, (frame) => [frame, 0, 0]),
      charScale: animated(transformReadFrames, [1, 1, 1]),
      charRotation: animated(transformReadFrames, [0, 0, 0]),
      charEulerOrder: animated(transformReadFrames, "XYZ"),
      pivot: animated(transformReadFrames, 1),
    },
  };
  const shake = {
    properties: {
      shakeDelayOrder: animated(shakeReadFrames, 0),
      shakeRandomSeed: animated(shakeReadFrames, 1),
      shakeDelayPerCharacter: animated(shakeReadFrames, 1),
      shakeAxis: animated(shakeReadFrames, [0, 1, 0]),
      shakeAmplitude: animated(shakeReadFrames, Math.PI / 2),
      shakePeriod: animated(shakeReadFrames, 4),
      shakePhase: animated(shakeReadFrames, 3),
      pivot: animated(shakeReadFrames, 1),
    },
  };
  const transformControls = _test.getCharacterTransformControls(
    transform,
    10,
    2,
    4
  );
  const shakeControls = _test.getCharacterShakeControls(shake, 10, 2, 4);

  assert.equal(transformControls.transformFrame, 4);
  assert.deepEqual(transformControls.position, [4, 0, 0]);
  assert.equal(transformControls.shake, 0);
  assert.equal(transformControls.pivot, "text");
  assert.equal(shakeControls.shakeFrame, 10);
  assert.equal(shakeControls.shakePhaseOffset, 2);
  assert.equal(shakeControls.shakePhase, 1);
  assert.deepEqual(shakeControls.position, [0, 0, 0]);
  assert.deepEqual(shakeControls.scale, [1, 1, 1]);
  assert.deepEqual(shakeControls.shakeAxis, [0, 1, 0]);
  assert.ok(Math.abs(shakeControls.shake - Math.PI / 2) < 1e-9);
  assert.equal(shakeControls.pivot, "text");
  assert.ok(transformReadFrames.includes(10));
  assert.ok(transformReadFrames.includes(4));
  assert.ok(shakeReadFrames.every((readFrame) => readFrame === 10));
});

test("shake follows amplitude, period, and phase in radians", () => {
  const quarterTurn = Math.PI / 2;
  assert.ok(Math.abs(_test.getShakeAngle(quarterTurn, 4, 1) - quarterTurn) < 1e-9);
  assert.ok(Math.abs(_test.getShakeAngle(quarterTurn, 4, 3) + quarterTurn) < 1e-9);
  assert.ok(Math.abs(_test.getShakeAngle(quarterTurn, 4, -1) + quarterTurn) < 1e-9);
  assert.equal(_test.getShakeAngle(quarterTurn, 0, 1), 0);
  assert.equal(_test.getShakeAngle(0, 24, 1), 0);
});

test("shake stays still unless the user changes Phase", () => {
  const property = (value) => ({ get: () => value });
  const shake = {
    properties: {
      shakeDelayOrder: property(0),
      shakeRandomSeed: property(1),
      shakeDelayPerCharacter: property(0),
      shakeAxis: property([0, 0, 1]),
      shakeAmplitude: property(1),
      shakePeriod: property(4),
      shakePhase: property(1),
    },
  };

  const start = _test.getCharacterShakeControls(shake, 0, 0, 3);
  const later = _test.getCharacterShakeControls(shake, 20, 0, 3);
  assert.ok(Math.abs(start.shake - 1) < 1e-9);
  assert.equal(later.shake, start.shake);
});

test("shake phase offsets work immediately without an initial hold", () => {
  const property = (value) => ({ get: () => value });
  const shake = {
    properties: {
      shakeDelayOrder: property(0),
      shakeRandomSeed: property(1),
      shakeDelayPerCharacter: property(1),
      shakeAxis: property([0, 0, 1]),
      shakeAmplitude: property(1),
      shakePeriod: property(4),
      shakePhase: property(0),
    },
  };

  const second = _test.getCharacterShakeControls(shake, 0, 1, 3);
  assert.equal(second.shakeFrame, 0);
  assert.equal(second.shakePhaseOffset, 1);
  assert.equal(second.shakePhase, -1);
  assert.ok(Math.abs(second.shake + 1) < 1e-9);
});

test("character number input is one-based, ordered, and ignores invalid entries", () => {
  assert.deepEqual(_test.parseCharacterSelection("1,4,5", 5), [0, 3, 4]);
  assert.deepEqual(_test.parseCharacterSelection("1.2.3.", 5), [0, 1, 2]);
  assert.deepEqual(_test.parseCharacterSelection("5．4。2", 5), [1, 3, 4]);
  assert.deepEqual(_test.parseCharacterSelection("5, 1, 1，3 2", 5), [
    0,
    1,
    2,
    4,
  ]);
  assert.deepEqual(
    _test.parseCharacterSelection("0,-1,2x5,text,6,3", 5),
    [2]
  );
  assert.deepEqual(_test.parseCharacterSelection("", 5), []);
});

test("selected transform delays only the entered character numbers", () => {
  const property = (value) => ({
    get(frame) {
      return typeof value === "function" ? value(frame) : value;
    },
  });
  const selectedTransform = {
    zoidiumTextPlusMode: "selected-transform",
    properties: {
      characterNumbers: property("1,4,5"),
      delayOrder: property(0),
      randomSeed: property(1),
      delayPerCharacter: property(3),
      charPosition: property((frame) => [frame, 0, 0]),
      charScale: property([1, 1, 1]),
      charRotation: property([0, 0, 0]),
      charEulerOrder: property("XYZ"),
    },
  };

  const first = _test.getTextPlusControls(selectedTransform, 10, 0, 5);
  const fourth = _test.getTextPlusControls(selectedTransform, 10, 3, 5);
  const fifth = _test.getTextPlusControls(selectedTransform, 10, 4, 5);
  const second = _test.getTextPlusControls(selectedTransform, 10, 1, 5);

  assert.deepEqual(first.position, [10, 0, 0]);
  assert.deepEqual(fourth.position, [7, 0, 0]);
  assert.deepEqual(fifth.position, [4, 0, 0]);
  assert.deepEqual(second.position, [0, 0, 0]);
  assert.equal(second.shake, 0);
});

test("selected shake leaves characters outside its number list unchanged", () => {
  const property = (value) => ({ get: () => value });
  const selectedShake = {
    zoidiumTextPlusMode: "selected-shake",
    properties: {
      characterNumbers: property("2"),
      shakeDelayOrder: property(0),
      shakeRandomSeed: property(1),
      shakeDelayPerCharacter: property(0),
      shakeAxis: property([1, 0, 0]),
      shakeAmplitude: property(Math.PI / 2),
      shakePeriod: property(4),
      shakePhase: property(1),
    },
  };

  const first = _test.getTextPlusControls(selectedShake, 1, 0, 3);
  const second = _test.getTextPlusControls(selectedShake, 1, 1, 3);

  assert.equal(first.shake, 0);
  assert.deepEqual(second.shakeAxis, [1, 0, 0]);
  assert.ok(Math.abs(second.shake - Math.PI / 2) < 1e-9);
});

test("Gradient Transform blends first and last transforms by character index", () => {
  const property = (value) => ({ get: () => value });
  const gradient = {
    zoidiumTextPlusMode: "gradient-transform",
    characterProperties: {
      firstPosition: property([0, 2, -4]),
      firstScale: property([1, 2, 3]),
      firstRotation: property([0, 0.2, -0.4]),
      lastPosition: property([12, 6, 4]),
      lastScale: property([2, 4, 6]),
      lastRotation: property([0.8, 1, 1.2]),
      gradientEulerOrder: property("ZXY"),
    },
  };

  const first = _test.getTextPlusControls(gradient, 7, 0, 4);
  const middle = _test.getTextPlusControls(gradient, 7, 2, 4);
  const last = _test.getTextPlusControls(gradient, 7, 3, 4);

  assert.deepEqual(first.position, [0, 2, -4]);
  assert.deepEqual(first.scale, [1, 2, 3]);
  assert.deepEqual(first.rotation, [0, 0.2, -0.4]);
  for (const [actual, expected] of [
    [middle.position, [8, 14 / 3, 4 / 3]],
    [middle.scale, [5 / 3, 10 / 3, 5]],
    [middle.rotation, [8 / 15, 11 / 15, 2 / 3]],
  ]) {
    assert.ok(
      actual.every((value, index) => Math.abs(value - expected[index]) < 1e-12)
    );
  }
  assert.deepEqual(last.position, [12, 6, 4]);
  assert.deepEqual(last.scale, [2, 4, 6]);
  assert.deepEqual(last.rotation, [0.8, 1, 1.2]);
  assert.equal(middle.eulerOrder, "ZXY");
});

test("Gradient Transform uses the first transform for a one-character text", () => {
  const property = (value) => ({ get: () => value });
  const gradient = {
    characterProperties: {
      firstPosition: property([1, 2, 3]),
      firstScale: property([2, 2, 2]),
      firstRotation: property([0.1, 0.2, 0.3]),
      lastPosition: property([9, 9, 9]),
      lastScale: property([4, 4, 4]),
      lastRotation: property([1, 1, 1]),
      gradientEulerOrder: property("XYZ"),
    },
  };

  const controls = _test.getGradientTransformControls(gradient, 3, 0, 1);
  assert.deepEqual(controls.position, [1, 2, 3]);
  assert.deepEqual(controls.scale, [2, 2, 2]);
  assert.deepEqual(controls.rotation, [0.1, 0.2, 0.3]);
});

test("random scatter Amount scales one fixed transform away from neutral", () => {
  const ranges = {
    positionMin: [2, -3, 4],
    positionMax: [2, -3, 4],
    rotationMin: [0.1, 0.2, -0.3],
    rotationMax: [0.1, 0.2, -0.3],
    scaleMin: [2, 3, 4],
    scaleMax: [2, 3, 4],
  };

  assert.deepEqual(_test.getRandomScatterTransform(0, ranges, 7, 2), {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  assert.deepEqual(_test.getRandomScatterTransform(1, ranges, 7, 2), {
    position: [2, -3, 4],
    rotation: [0.1, 0.2, -0.3],
    scale: [2, 3, 4],
  });
  assert.deepEqual(_test.getRandomScatterTransform(2, ranges, 7, 2), {
    position: [4, -6, 8],
    rotation: [0.2, 0.4, -0.6],
    scale: [3, 5, 7],
  });
});

test("random scatter is deterministic and keeps values inside ordered ranges", () => {
  const ranges = {
    positionMin: [5, -4, 3],
    positionMax: [-5, 4, -3],
    rotationMin: [-1, -2, -3],
    rotationMax: [1, 2, 3],
    scaleMin: [0.5, 0.75, 1],
    scaleMax: [1.5, 1.25, 2],
  };
  const first = _test.getRandomScatterTransform(1, ranges, 99, 4);
  const second = _test.getRandomScatterTransform(1, ranges, 99, 4);
  const otherSeed = _test.getRandomScatterTransform(1, ranges, 100, 4);

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, otherSeed);
  assert.ok(first.position[0] >= -5 && first.position[0] <= 5);
  assert.ok(first.position[1] >= -4 && first.position[1] <= 4);
  assert.ok(first.position[2] >= -3 && first.position[2] <= 3);
  assert.ok(first.scale[0] >= 0.5 && first.scale[0] <= 1.5);
  assert.ok(first.scale[1] >= 0.75 && first.scale[1] <= 1.25);
  assert.ok(first.scale[2] >= 1 && first.scale[2] <= 2);
});

test("Random Scatter reads the shared pivot choice", () => {
  const property = (value) => ({ get: () => value });
  const scatter = {
    characterProperties: {
      amount: property(0),
      pivot: property(1),
      seed: property(1),
    },
  };
  assert.equal(_test.getRandomScatterControls(scatter, 0, 0).pivot, "text");
});

test("Random Scatter applies one parent-space movement around matching character centers", () => {
  class Matrix4 {
    constructor() {
      this.scale = 1;
      this.offset = 0;
    }

    copy(matrix) {
      this.scale = matrix.scale;
      this.offset = matrix.offset;
      return this;
    }

    premultiply(matrix) {
      this.offset = matrix.scale * this.offset + matrix.offset;
      this.scale = matrix.scale * this.scale;
      return this;
    }

    multiply(matrix) {
      this.offset += this.scale * matrix.offset;
      this.scale *= matrix.scale;
      return this;
    }

    makeTranslation(x) {
      this.scale = 1;
      this.offset = x;
      return this;
    }

    compose(position, _quaternion, scale) {
      this.scale = scale.x;
      this.offset = position.x;
      return this;
    }

    getInverse(matrix) {
      this.scale = 1 / matrix.scale;
      this.offset = -matrix.offset / matrix.scale;
      return this;
    }

    determinant() {
      return this.scale;
    }
  }

  class Vector3 {
    constructor(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    }

    applyMatrix4(matrix) {
      this.x = matrix.scale * this.x + matrix.offset;
      return this;
    }
  }

  class Euler {
    constructor(x, y, z, order) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.order = order;
    }
  }

  class Quaternion {
    setFromEuler() {
      return this;
    }

    setFromAxisAngle() {
      return this;
    }

    multiply() {
      return this;
    }
  }

  const THREE = { Matrix4, Vector3, Euler, Quaternion };
  const reference = { parent: null };
  const makeLayer = (sourceScale, anchorOffset) => {
    const source = {
      parent: reference,
      matrixAutoUpdate: false,
      matrix: Object.assign(new Matrix4(), {
        scale: sourceScale,
        offset: 100,
      }),
    };
    const anchor = {
      parent: source,
      matrixAutoUpdate: false,
      matrix: Object.assign(new Matrix4(), {
        scale: 1,
        offset: anchorOffset,
      }),
    };
    const textPivot = {
      parent: source,
      matrixAutoUpdate: false,
      matrix: Object.assign(new Matrix4(), {
        scale: 1,
        offset: sourceScale === 2 ? 30 : 15,
      }),
    };
    return {
      parentToReference: _test.getMatrixToAncestor(THREE, anchor, reference),
      textPivot,
      node: {
        parent: anchor,
        matrix: new Matrix4(),
        matrixAutoUpdate: true,
        matrixWorldNeedsUpdate: false,
      },
    };
  };
  const front = makeLayer(2, 10);
  const back = makeLayer(4, 5);
  const controls = {
    position: [6, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    eulerOrder: "XYZ",
  };

  assert.equal(
    _test.applyReferenceSpaceCharacterTransform(
      THREE,
      front.node,
      controls,
      reference
    ),
    true
  );
  assert.equal(
    _test.applyReferenceSpaceCharacterTransform(
      THREE,
      back.node,
      controls,
      reference
    ),
    true
  );

  const frontCenter = new Vector3(0, 0, 0)
    .applyMatrix4(front.node.matrix)
    .applyMatrix4(front.parentToReference).x;
  const backCenter = new Vector3(0, 0, 0)
    .applyMatrix4(back.node.matrix)
    .applyMatrix4(back.parentToReference).x;
  assert.equal(frontCenter, 126);
  assert.equal(backCenter, 126);
  assert.equal(front.node.matrix.offset, 3);
  assert.equal(back.node.matrix.offset, 1.5);
  assert.equal(front.node.matrixAutoUpdate, false);
  assert.equal(front.node.matrixWorldNeedsUpdate, true);

  const textPivotControls = {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [2, 1, 1],
    eulerOrder: "XYZ",
    shakeAxis: [0, 0, 1],
    shake: 0,
  };
  assert.equal(
    _test.applyReferenceSpaceCharacterTransform(
      THREE,
      front.node,
      textPivotControls,
      reference,
      front.textPivot
    ),
    true
  );
  assert.equal(
    _test.applyReferenceSpaceCharacterTransform(
      THREE,
      back.node,
      textPivotControls,
      reference,
      back.textPivot
    ),
    true
  );
  const frontScaledCenter = new Vector3(0, 0, 0)
    .applyMatrix4(front.node.matrix)
    .applyMatrix4(front.parentToReference).x;
  const backScaledCenter = new Vector3(0, 0, 0)
    .applyMatrix4(back.node.matrix)
    .applyMatrix4(back.parentToReference).x;
  assert.equal(frontScaledCenter, 80);
  assert.equal(backScaledCenter, 80);
  assert.equal(front.node.matrix.offset, -20);
  assert.equal(back.node.matrix.offset, -10);

  const singularSource = {
    parent: reference,
    matrixAutoUpdate: false,
    matrix: Object.assign(new Matrix4(), { scale: 0, offset: 100 }),
  };
  const renderRoot = {
    parent: singularSource,
    matrixAutoUpdate: false,
    matrix: new Matrix4(),
  };
  const localAnchor = {
    parent: renderRoot,
    matrixAutoUpdate: false,
    matrix: Object.assign(new Matrix4(), { scale: 1, offset: 10 }),
  };
  const localTextPivot = {
    parent: renderRoot,
    matrixAutoUpdate: false,
    matrix: new Matrix4(),
  };
  const localNode = {
    parent: localAnchor,
    matrix: new Matrix4(),
    matrixAutoUpdate: true,
    matrixWorldNeedsUpdate: false,
  };
  assert.equal(
    _test.applyReferenceSpaceCharacterTransform(
      THREE,
      localNode,
      textPivotControls,
      renderRoot,
      localTextPivot
    ),
    true
  );
  assert.equal(localNode.matrix.offset, 10);
});

test("Text pivot uses the render root instead of a singular Text transform", () => {
  const renderRoot = {};
  const textPivot = { parent: renderRoot };
  const textPlus = { threeObj: {} };
  assert.deepEqual(
    _test.getCharacterTransformReference(
      textPlus,
      { pivot: "text" },
      textPivot
    ),
    { pivotObject: textPivot, referenceObject: renderRoot }
  );
  assert.deepEqual(
    _test.getCharacterTransformReference(
      textPlus,
      { pivot: "character" },
      textPivot
    ),
    { pivotObject: null, referenceObject: textPlus.threeObj }
  );
});

test("3D text layout follows the font advance and line-height rules", () => {
  const font = {
    resolution: 1000,
    boundingBox: { yMin: -200, yMax: 800 },
    underlineThickness: 50,
    glyphs: {
      A: { ha: 600 },
      " ": { ha: 250 },
      "?": { ha: 500 },
    },
  };
  const layout = _test.getTextLayout("A A\n?", font, 100);

  assert.equal(layout.lineHeight, 105);
  assert.equal(layout.count, 4);
  assert.deepEqual(
    layout.units.map(({ character, index, x, y, advance }) => ({
      character,
      index,
      x,
      y,
      advance,
    })),
    [
      { character: "A", index: 0, x: 0, y: 0, advance: 60 },
      { character: " ", index: 1, x: 60, y: 0, advance: 25 },
      { character: "A", index: 2, x: 85, y: 0, advance: 60 },
      { character: "?", index: 3, x: 0, y: -105, advance: 50 },
    ]
  );
});

test("3D text layout applies horizontal spacing between characters", () => {
  const font = {
    resolution: 1000,
    boundingBox: { yMin: -200, yMax: 800 },
    underlineThickness: 50,
    glyphs: { A: { ha: 600 } },
  };
  const layout = _test.getTextLayout("AA", font, 100, 5);

  assert.deepEqual(
    layout.units.map(({ character, x, advance }) => ({ character, x, advance })),
    [
      { character: "A", x: 0, advance: 60 },
      { character: "A", x: 65, advance: 60 },
    ]
  );
});

test("Text geometry options map advanced bevel controls to ExtrudeGeometry", () => {
  const property = (value) => ({ get: () => value });
  const options = _test.textGeometryOptions(
    {
      properties: {
        size: property([30, 4]),
        detail: property(7),
        bevel: property(1),
        bevelSize: property([1.25, 2.5]),
        bevelSide: property(1),
        bevelDetail: property(8),
        bevelProfile: property(0),
        bevelTension: property(0.2),
      },
    },
    { data: {} }
  );

  assert.equal(options.size, 30);
  assert.equal(options.height, 4);
  assert.equal(options.amount, 4);
  assert.equal(options.curveSegments, 7);
  assert.equal(options.bevelEnabled, true);
  assert.equal(options.bevelThickness, 1.25);
  assert.equal(options.bevelSize, 2.5);
  assert.equal(options.bevelSizeInner, 2.5);
  assert.equal(options.bevelShift, 2.5);
  assert.equal(options.bevelSegments, 8);
  assert.equal(options.bevelRound, false);
  assert.equal(options.bevelProfile, 0.2);
});

test("center point modes match the native 3D Text anchor rules", () => {
  const bounds = { min: [-10, -20, -2], max: [30, 40, 8] };
  assert.deepEqual(_test.getCenterOffset(bounds, 0), [-10, -10, -3]);
  assert.deepEqual(_test.getCenterOffset(bounds, 1), [0, -10, -3]);
  assert.deepEqual(_test.getCenterOffset(bounds, 2), [-20, -10, -3]);
  assert.deepEqual(_test.getCenterOffset(bounds, 3), [-10, -20, -3]);
  assert.deepEqual(_test.getCenterOffset(bounds, 4), [-10, 0, -3]);
  assert.deepEqual(_test.getCenterOffset(bounds, 5), [-10, -10, -6]);
  assert.deepEqual(_test.getCenterOffset(bounds, 6), [-10, -10, 0]);
  assert.deepEqual(_test.getCenterOffset(null, 0), [0, 0, 0]);
  assert.deepEqual(_test.getTextCenter(bounds, [-10, -10, -3]), [0, 0, 0]);
  assert.deepEqual(_test.getTextCenter(bounds, [0, -10, -3]), [10, 0, 0]);
  assert.deepEqual(_test.getTextCenter(null, [4, 5, 6]), [0, 0, 0]);
});

test("transform and shake parents expose separate 3D controls", () => {
  const PZ = {
    property: {
      type: {
        NUMBER: 0,
        VECTOR3: 2,
        OPTION: 6,
        LIST: 9,
        TEXT: 10,
      },
    },
    object3d: { eulerOrders: [{ name: "XYZ", value: "XYZ" }] },
  };
  const transform = _test.createTransformPropertyDefinitions(PZ, false);
  const shake = _test.createShakePropertyDefinitions(PZ, false);
  const selectedTransform = _test.createTransformPropertyDefinitions(PZ, true);
  const selectedShake = _test.createShakePropertyDefinitions(PZ, true);
  const gradient = _test.createGradientTransformPropertyDefinitions(PZ);

  assert.equal(transform.charPosition.type, PZ.property.type.VECTOR3);
  assert.equal(transform.charScale.type, PZ.property.type.VECTOR3);
  assert.equal(transform.charScale.linkRatio, true);
  assert.equal(transform.charRotation.type, PZ.property.type.VECTOR3);
  assert.equal(transform.charPosition.interpolated, true);
  assert.ok(
    transform.charPosition.objects.every(
      (component) => component.interpolated === true
    )
  );
  assert.equal(transform.delayPerCharacter.interpolated, true);
  assert.equal(transform.pivot.name, "Pivot");
  assert.equal(transform.pivot.items, "Character;Text");
  assert.equal(transform.pivot.value, 0);
  assert.equal(transform.randomSeed.dynamic, undefined);
  assert.equal(transform.shakeAmplitude, undefined);

  assert.equal(shake.shakeAxis.type, PZ.property.type.VECTOR3);
  assert.equal(shake.shakeAxis.objects.length, 3);
  assert.equal(shake.shakeAmplitude.interpolated, true);
  assert.equal(shake.shakePeriod.interpolated, true);
  assert.equal(shake.shakePhase.interpolated, true);
  assert.equal(shake.shakeDelayPerCharacter.interpolated, true);
  assert.equal(shake.shakeRandomSeed.dynamic, undefined);
  assert.equal(shake.pivot.name, "Pivot");
  assert.equal(shake.charPosition, undefined);

  assert.equal(
    transform.delayOrder.items,
    "Forward;Reverse;Center out;Random"
  );
  assert.equal(
    shake.shakeDelayOrder.items,
    "Forward;Reverse;Center out;Random"
  );
  assert.equal(transform.delayPerCharacter.name, "Delay");
  assert.equal(transform.charPosition.name, "Position");
  assert.equal(transform.charScale.name, "Scale");
  assert.equal(transform.charRotation.name, "Rotation");
  assert.equal(transform.charEulerOrder.name, "Rotation order");
  assert.equal(transform.delayOrder.name, "Delay order");
  assert.equal(transform.randomSeed.name, "Seed");
  assert.equal(shake.shakeAmplitude.name, "Amplitude");
  assert.equal(shake.shakePeriod.name, "Period");
  assert.equal(shake.shakePhase.name, "Phase");
  assert.equal(shake.shakeAxis.name, "Axis");
  assert.equal(shake.shakeDelayPerCharacter.name, "Phase offset");
  assert.equal(shake.shakeDelayOrder.name, "Offset order");
  assert.equal(shake.shakeRandomSeed.name, "Seed");
  assert.equal(selectedTransform.characterNumbers.type, PZ.property.type.TEXT);
  assert.equal(selectedTransform.characterNumbers.value, "1");
  assert.equal(selectedShake.characterNumbers.type, PZ.property.type.TEXT);

  assert.equal(gradient.firstPosition.name, "First position");
  assert.equal(gradient.firstScale.name, "First scale");
  assert.equal(gradient.firstRotation.name, "First rotation");
  assert.equal(gradient.lastPosition.name, "Last position");
  assert.equal(gradient.lastScale.name, "Last scale");
  assert.equal(gradient.lastRotation.name, "Last rotation");
  assert.equal(gradient.gradientEulerOrder.name, "Rotation order");
  assert.equal(gradient.firstScale.linkRatio, true);
  assert.equal(gradient.lastScale.linkRatio, true);
  assert.equal(gradient.pivot, undefined);
  for (const name of [
    "firstPosition",
    "firstScale",
    "firstRotation",
    "lastPosition",
    "lastScale",
    "lastRotation",
  ]) {
    assert.equal(gradient[name].interpolated, true);
    assert.ok(
      gradient[name].objects.every(
        (component) => component.interpolated === true
      )
    );
  }
});

test("Random Scatter controls match the requested transform ranges", () => {
  const PZ = {
    property: {
      type: {
        NUMBER: 0,
        VECTOR3: 2,
        OPTION: 6,
      },
    },
  };
  const definitions = _test.createRandomScatterPropertyDefinitions(PZ);

  assert.equal(definitions.amount.name, "Amount");
  assert.equal(definitions.amount.dynamic, true);
  assert.equal(definitions.amount.interpolated, true);
  assert.equal(definitions.amount.value, 0);
  assert.equal(definitions.pivot.name, "Pivot");
  assert.equal(definitions.pivot.items, "Character;Text");
  assert.equal(definitions.positionMin.name, "Min position");
  assert.equal(definitions.positionMax.name, "Max position");
  assert.equal(definitions.rotationMin.name, "Min rotation");
  assert.equal(definitions.rotationMax.name, "Max rotation");
  assert.equal(definitions.scaleMin.name, "Min scale");
  assert.equal(definitions.scaleMax.name, "Max scale");
  assert.deepEqual(definitions.positionMin.value, [-10, -10, -10]);
  assert.deepEqual(definitions.positionMax.value, [10, 10, 10]);
  assert.deepEqual(definitions.rotationMin.value, [0, 0, 0]);
  assert.deepEqual(definitions.rotationMax.value, [0, 0, 0]);
  assert.deepEqual(definitions.scaleMin.value, [1, 1, 1]);
  assert.deepEqual(definitions.scaleMax.value, [1, 1, 1]);
  assert.equal(definitions.scaleMin.linkRatio, true);
  assert.equal(definitions.scaleMax.linkRatio, true);
  for (const name of [
    "positionMin",
    "positionMax",
    "rotationMin",
    "rotationMax",
    "scaleMin",
    "scaleMax",
  ]) {
    assert.equal(definitions[name].interpolated, true);
    assert.ok(
      definitions[name].objects.every(
        (component) => component.interpolated === true
      )
    );
  }
  assert.equal(definitions.seed.name, "Seed");
  assert.equal(definitions.seed.dynamic, undefined);
});

test("Text+ registers six independent group parent types", () => {
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
