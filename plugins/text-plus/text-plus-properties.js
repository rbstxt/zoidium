"use strict";

// Text+ per-character property definitions for every parent mode. Pure
// factories: each takes the host PZ and returns CM3 property definitions.

const {
  DEGREES_TO_RADIANS,
  DELAY_ORDER_LABELS,
  PIVOT_LABELS,
} = require("./text-plus-utils.js");

/* -------------------------------------------------------------- properties */

function vectorDefinition(PZ, definition) {
  const axisNames = ["X", "Y", "Z"];
  return {
    dynamic: true,
    interpolated: true,
    group: true,
    name: definition.name,
    type: PZ.property.type.VECTOR3,
    value: definition.value.slice(),
    ...(definition.scaleFactor
      ? { scaleFactor: definition.scaleFactor }
      : {}),
    ...(definition.linkRatio ? { linkRatio: true } : {}),
    objects: definition.value.map((value, index) => ({
      dynamic: true,
      interpolated: true,
      name: `${definition.name}.${axisNames[index]}`,
      type: PZ.property.type.NUMBER,
      value,
      ...(definition.min == null ? {} : { min: definition.min }),
      ...(definition.scaleFactor
        ? { scaleFactor: definition.scaleFactor }
        : {}),
      step: definition.step == null ? 1 : definition.step,
      decimals: definition.decimals == null ? 2 : definition.decimals,
    })),
  };
}

function dynamicNumberDefinition(PZ, name, value, options) {
  return {
    dynamic: true,
    interpolated: true,
    name,
    type: PZ.property.type.NUMBER,
    value,
    ...(options || {}),
  };
}

function createPropertyCategory(PZ, owner, name, definitions) {
  const properties = new PZ.propertyList(definitions, owner);
  Object.defineProperty(properties, "_zoidiumCategoryName", {
    value: name,
    configurable: true,
  });
  const propertyIndex = owner.children.indexOf(owner.properties);
  owner.children.splice(propertyIndex + 1, 0, properties);
  return properties;
}

function getTextPlusProperties(textPlus) {
  return textPlus.characterProperties || textPlus.properties || {};
}

function characterSelectionDefinition(PZ) {
  return {
    name: "Characters",
    type: PZ.property.type.TEXT,
    value: "1",
  };
}

function seedDefinition(PZ) {
  return dynamicNumberDefinition(PZ, "Seed", 1, {
    step: 0.01,
    decimals: 2,
  });
}

function createTransformPropertyDefinitions(PZ, selectedOnly) {
  const type = PZ.property.type;

  return {
    ...(selectedOnly
      ? { characterNumbers: characterSelectionDefinition(PZ) }
      : {}),
    charPosition: vectorDefinition(PZ, {
      name: "Position",
      value: [0, 0, 0],
      step: 1,
      decimals: 2,
    }),
    charScale: vectorDefinition(PZ, {
      name: "Scale",
      value: [1, 1, 1],
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
    charRotation: vectorDefinition(PZ, {
      name: "Rotation",
      value: [0, 0, 0],
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    charEulerOrder: {
      name: "Rotation order",
      type: type.LIST,
      value: "XYZ",
      items: PZ.object3d.eulerOrders,
    },
    pivot: pivotDefinition(PZ),
    delayPerCharacter: dynamicNumberDefinition(
      PZ,
      "Delay",
      0,
      {
        min: 0,
        step: 1,
        decimals: 2,
      }
    ),
    delayOrder: {
      name: "Delay order",
      type: type.OPTION,
      items: DELAY_ORDER_LABELS.join(";"),
      value: 0,
    },
    randomSeed: seedDefinition(PZ),
  };
}

function pivotDefinition(PZ) {
  return {
    name: "Pivot",
    type: PZ.property.type.OPTION,
    items: PIVOT_LABELS.join(";"),
    value: 0,
  };
}

function createGradientTransformPropertyDefinitions(PZ) {
  const type = PZ.property.type;
  return {
    firstPosition: vectorDefinition(PZ, {
      name: "First position",
      value: [0, 0, 0],
      step: 1,
      decimals: 2,
    }),
    firstScale: vectorDefinition(PZ, {
      name: "First scale",
      value: [1, 1, 1],
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
    firstRotation: vectorDefinition(PZ, {
      name: "First rotation",
      value: [0, 0, 0],
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    lastPosition: vectorDefinition(PZ, {
      name: "Last position",
      value: [0, 0, 0],
      step: 1,
      decimals: 2,
    }),
    lastScale: vectorDefinition(PZ, {
      name: "Last scale",
      value: [1, 1, 1],
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
    lastRotation: vectorDefinition(PZ, {
      name: "Last rotation",
      value: [0, 0, 0],
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    gradientEulerOrder: {
      name: "Rotation order",
      type: type.LIST,
      value: "XYZ",
      items: PZ.object3d.eulerOrders,
    },
  };
}

function createShakePropertyDefinitions(PZ, selectedOnly) {
  const type = PZ.property.type;
  return {
    ...(selectedOnly
      ? { characterNumbers: characterSelectionDefinition(PZ) }
      : {}),
    shakeAmplitude: dynamicNumberDefinition(PZ, "Amplitude", 0, {
      scaleFactor: DEGREES_TO_RADIANS,
      min: 0,
      max: 360,
      step: 1,
      decimals: 1,
    }),
    shakePeriod: dynamicNumberDefinition(PZ, "Period", 24, {
      min: 0,
      step: 1,
      decimals: 2,
    }),
    shakePhase: dynamicNumberDefinition(
      PZ,
      "Phase",
      0,
      {
        step: 1,
        decimals: 2,
      }
    ),
    shakeAxis: vectorDefinition(PZ, {
      name: "Axis",
      value: [0, 0, 1],
      step: 0.1,
      decimals: 3,
    }),
    pivot: pivotDefinition(PZ),
    shakeDelayPerCharacter: dynamicNumberDefinition(
      PZ,
      "Phase offset",
      0,
      {
        min: 0,
        step: 1,
        decimals: 2,
      }
    ),
    shakeDelayOrder: {
      name: "Offset order",
      type: type.OPTION,
      items: DELAY_ORDER_LABELS.join(";"),
      value: 0,
    },
    shakeRandomSeed: seedDefinition(PZ),
  };
}

function createRandomScatterPropertyDefinitions(PZ) {
  const type = PZ.property.type;
  return {
    amount: {
      dynamic: true,
      interpolated: true,
      name: "Amount",
      type: type.NUMBER,
      value: 0,
      min: 0,
      step: 0.05,
      decimals: 2,
    },
    pivot: pivotDefinition(PZ),
    positionMin: vectorDefinition(PZ, {
      name: "Min position",
      value: [-10, -10, -10],
      step: 1,
      decimals: 2,
    }),
    positionMax: vectorDefinition(PZ, {
      name: "Max position",
      value: [10, 10, 10],
      step: 1,
      decimals: 2,
    }),
    rotationMin: vectorDefinition(PZ, {
      name: "Min rotation",
      value: [0, 0, 0],
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    rotationMax: vectorDefinition(PZ, {
      name: "Max rotation",
      value: [0, 0, 0],
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    scaleMin: vectorDefinition(PZ, {
      name: "Min scale",
      value: [1, 1, 1],
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
    scaleMax: vectorDefinition(PZ, {
      name: "Max scale",
      value: [1, 1, 1],
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
    seed: seedDefinition(PZ),
  };
}

module.exports = {
  vectorDefinition,
  dynamicNumberDefinition,
  createPropertyCategory,
  getTextPlusProperties,
  characterSelectionDefinition,
  seedDefinition,
  createTransformPropertyDefinitions,
  pivotDefinition,
  createGradientTransformPropertyDefinitions,
  createShakePropertyDefinitions,
  createRandomScatterPropertyDefinitions,
};
