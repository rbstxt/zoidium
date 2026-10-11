"use strict";

// Effector property surface: CM3 property definitions for repeaters and
// fields, plus the per-frame readers every deformer evaluates through.

const { MAX_REPEATS, numberValue, vectorValue } = require("./scene-values.js");

function vectorDefinition(PZ, definition) {
  const axisDefinition = (index, fallbackName) => ({
    dynamic: true,
    name: definition.axisNames?.[index] || fallbackName,
    type: PZ.property.type.NUMBER,
    value: definition.value[index],
    ...(definition.min ? { min: definition.min[index] } : {}),
    ...(definition.max ? { max: definition.max[index] } : {}),
    // CM3's own rotation vectors carry the degree-to-radian scaleFactor on the
    // group (used to render the row in degrees while the stored value is in
    // radians) and on each axis (used by the per-axis keyframe controls).
    // Mirror both so the units match CM3's shape rotation.
    ...(definition.scaleFactor ? { scaleFactor: definition.scaleFactor } : {}),
    step: definition.step || 1,
    decimals: definition.decimals ?? 2,
  });

  return {
    dynamic: true,
    group: true,
    name: definition.name,
    type: PZ.property.type.VECTOR3,
    ...(definition.scaleFactor ? { scaleFactor: definition.scaleFactor } : {}),
    ...(definition.linkRatio ? { linkRatio: true } : {}),
    objects: [
      axisDefinition(0, "X"),
      axisDefinition(1, "Y"),
      axisDefinition(2, "Z"),
    ],
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

function makeProperties(PZ, mode, markDirty) {
  const properties = {
    count: {
      dynamic: true,
      name: "Count",
      type: PZ.property.type.NUMBER,
      value: 5,
      min: 1,
      max: MAX_REPEATS,
      step: 1,
      decimals: 0,
      changed: function () {
        markDirty(this.parentObject);
      },
    },
  };

  const rotation = Math.PI / 180;
  if (mode === "step") {
    properties.positionStep = vectorDefinition(PZ, {
      name: "Position",
      value: [10, 0, 0],
      step: 1,
      decimals: 2,
    });
    properties.rotationStep = vectorDefinition(PZ, {
      name: "Rotation",
      value: [0, 0, 0],
      scaleFactor: rotation,
      step: 1,
      decimals: 1,
    });
    properties.scaleStep = vectorDefinition(PZ, {
      name: "Scale",
      value: [1, 1, 1],
      min: [0.001, 0.001, 0.001],
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    });
  } else if (mode === "linear") {
    properties.positionEnd = vectorDefinition(PZ, {
      name: "Position",
      value: [40, 0, 0],
      step: 1,
      decimals: 2,
    });
    properties.rotationEnd = vectorDefinition(PZ, {
      name: "Rotation",
      // Rotation vectors store radians, like CM3's own shape rotation. 90
      // degrees is the intended default, so store Math.PI / 2.
      value: [0, 0, Math.PI / 2],
      scaleFactor: rotation,
      step: 1,
      decimals: 1,
    });
    properties.scaleEnd = vectorDefinition(PZ, {
      name: "Scale",
      value: [1, 1, 1],
      min: [0.001, 0.001, 0.001],
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    });
  } else if (mode === "random") {
    properties.positionMin = vectorDefinition(PZ, {
      name: "Min position",
      value: [-10, -10, -10],
      step: 1,
      decimals: 2,
    });
    properties.positionMax = vectorDefinition(PZ, {
      name: "Max position",
      value: [10, 10, 10],
      step: 1,
      decimals: 2,
    });
    properties.rotationMin = vectorDefinition(PZ, {
      name: "Min rotation",
      value: [0, 0, 0],
      scaleFactor: rotation,
      step: 1,
      decimals: 1,
    });
    properties.rotationMax = vectorDefinition(PZ, {
      name: "Max rotation",
      value: [0, 0, 0],
      scaleFactor: rotation,
      step: 1,
      decimals: 1,
    });
    properties.scaleMin = vectorDefinition(PZ, {
      name: "Min scale",
      value: [1, 1, 1],
      min: [0.001, 0.001, 0.001],
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    });
    properties.scaleMax = vectorDefinition(PZ, {
      name: "Max scale",
      value: [1, 1, 1],
      min: [0.001, 0.001, 0.001],
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    });
    properties.seed = {
      name: "Seed",
      type: PZ.property.type.NUMBER,
      value: 1,
      step: 1,
      decimals: 0,
    };
  }

  if (mode === "echo") {
    properties.delay = {
      dynamic: true,
      name: "Offset",
      type: PZ.property.type.NUMBER,
      value: 5,
      min: 0,
      max: 100000,
      step: 1,
      decimals: 3,
      changed: function () {
        markDirty(this.parentObject);
      },
    };
  }

  return properties;
}

function propertyValue(property, frame, fallback) {
  if (!property) return fallback;
  try {
    const value = typeof property.get === "function" ? property.get(frame) : property.value;
    return value === undefined ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

function numberPropertyValue(property, frame, fallback) {
  return numberValue(propertyValue(property, frame, fallback), fallback);
}

function optionPropertyValue(property, frame, fallback) {
  return Math.round(numberPropertyValue(property, frame, fallback));
}

function fieldFromProperties(properties, frame, legacy = false) {
  return {
    legacy,
    rotation: vectorValue(propertyValue(properties.fieldRotation, frame, [0, 0, 0]), [0, 0, 0]),
    falloff: numberPropertyValue(properties.fieldFalloff, frame, 100),
    curve: optionPropertyValue(properties.fieldCurve, frame, 0),
    invert: optionPropertyValue(properties.fieldInvert, frame, 0) === 1,
    sweep: numberPropertyValue(properties.fieldSweep, frame, 100),
    noiseScale: numberPropertyValue(properties.fieldNoiseScale, frame, 100),
    evolution: numberPropertyValue(properties.fieldNoiseEvolution, frame, 0),
    seed: numberPropertyValue(properties.seed, frame, 1),
    type: optionPropertyValue(properties.field, frame, 0),
    position: vectorValue(propertyValue(properties.fieldPosition, frame, [0, 0, 0]), [0, 0, 0]),
    scale: vectorValue(propertyValue(properties.fieldScale, frame, [100, 100, 100]), [100, 100, 100]),
  };
}

function fieldProperties(PZ) {
  const number = (name, value, min, max) => ({ dynamic: true, name, type: PZ.property.type.NUMBER, value, min, max, step: 1, decimals: 1 });
  const option = (name, value, items) => ({ dynamic: true, name, type: PZ.property.type.OPTION, value, items });
  const vector = (name, value, min) => vectorDefinition(PZ, { name, value, min: min === undefined ? undefined : [min, min, min], step: 1, decimals: 1 });
  return {
    field: option("Field", 0, "infinite;linear;box;sphere;cylinder;noise"),
    fieldPosition: vector("Field position", [0, 0, 0]),
    fieldRotation: vector("Field rotation", [0, 0, 0]),
    fieldScale: vector("Field scale", [100, 100, 100], 0.01),
    fieldFalloff: number("Falloff", 100, 0, 100),
    fieldCurve: option("Falloff curve", 0, "linear;smooth;ease in;ease out"),
    fieldInvert: option("Invert field", 0, "off;on"),
    fieldSweep: number("Sweep", 100, 0, 100),
    fieldNoiseScale: number("Noise scale", 100, 0.01, 10000),
    fieldNoiseEvolution: number("Noise evolution", 0),
  };
}

module.exports = {
  vectorDefinition, createPropertyCategory, makeProperties, propertyValue,
  numberPropertyValue, optionPropertyValue, fieldFromProperties, fieldProperties
};
