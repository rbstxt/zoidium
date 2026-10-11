"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;


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
