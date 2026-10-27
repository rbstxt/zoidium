"use strict";

// ExpressText+ Property schema: container plus eleven effector sections.

const { DEGREES_TO_RADIANS, DELAY_MODE_LABELS, DELAY_ORDER_LABELS, FIELD_LABELS, PIVOT_LABELS, RANDOM_MODE_LABELS, RANDOM_SPACE_LABELS, REPEATER_MAX_COPIES, REPEATER_MODE_LABELS, SPLINE_MODE_LABELS, SPLINE_PATH_LABELS, SPLINE_PLANE_LABELS, SPLINE_TRANSFORM_LABELS, TWIST_AXIS_LABELS, WRAP_DIRECTION_LABELS, state } = require("./expresstext-constants.js");

/* ------------------------------------------------------- property schema */

function vectorDefinition(PZ, definition) {
  const axisNames = ["X", "Y", "Z"];
  return {
    dynamic: true,
    interpolated: true,
    group: true,
    name: definition.name,
    type: PZ.property.type.VECTOR3,
    value: definition.value.slice(),
    ...(definition.scaleFactor ? { scaleFactor: definition.scaleFactor } : {}),
    ...(definition.linkRatio ? { linkRatio: true } : {}),
    objects: definition.value.map((value, index) => ({
      dynamic: true,
      interpolated: true,
      name: `${definition.name}.${axisNames[index]}`,
      type: PZ.property.type.NUMBER,
      value,
      ...(definition.min == null ? {} : { min: definition.min }),
      ...(definition.scaleFactor ? { scaleFactor: definition.scaleFactor } : {}),
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

function enableDefinition(PZ, name) {
  return {
    dynamic: true,
    name,
    type: PZ.property.type.OPTION,
    items: "off;on",
    value: 1,
  };
}

function lettersDefinition(PZ) {
  return {
    dynamic: true,
    name: "Letters",
    type: PZ.property.type.TEXT,
    value: "",
  };
}

function strengthDefinition(PZ) {
  return dynamicNumberDefinition(PZ, "Strength", 100, {
    min: 0,
    max: 100,
    step: 1,
    decimals: 1,
  });
}

function fieldDefinitions(PZ) {
  return {
    field: {
      dynamic: true,
      name: "Field",
      type: PZ.property.type.OPTION,
      items: FIELD_LABELS.join(";"),
      value: 0,
    },
    fieldPosition: vectorDefinition(PZ, {
      name: "Field position",
      value: [0, 0, 0],
      step: 1,
      decimals: 2,
    }),
    fieldScale: vectorDefinition(PZ, {
      name: "Field scale",
      value: [100, 100, 100],
      min: 0.01,
      step: 1,
      decimals: 2,
    }),
  };
}

function delayDefinitions(PZ) {
  return {
    delay: dynamicNumberDefinition(PZ, "Delay", 0, {
      min: 0,
      step: 1,
      decimals: 2,
    }),
    delayOrder: {
      dynamic: true,
      name: "Delay order",
      type: PZ.property.type.OPTION,
      items: DELAY_ORDER_LABELS.join(";"),
      value: 0,
    },
  };
}

function seedDefinition(PZ) {
  return dynamicNumberDefinition(PZ, "Seed", 1, {
    step: 0.01,
    decimals: 2,
  });
}

function pivotDefinition(PZ) {
  return {
    dynamic: true,
    name: "Pivot",
    type: PZ.property.type.OPTION,
    items: PIVOT_LABELS.join(";"),
    value: 0,
  };
}

function xyzDefinitions(PZ, prefix, positionValue, rotationValue, scaleValue) {
  return {
    [`${prefix}Position`]: vectorDefinition(PZ, {
      name: "Position",
      value: positionValue,
      step: 1,
      decimals: 2,
    }),
    [`${prefix}Rotation`]: vectorDefinition(PZ, {
      name: "Rotation",
      value: rotationValue,
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    [`${prefix}Scale`]: vectorDefinition(PZ, {
      name: "Scale",
      value: scaleValue,
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
  };
}

function withPrefix(defs, prefix, label) {
  const out = {};
  for (const key of Object.keys(defs)) {
    const name = `${prefix}${key[0].toUpperCase()}${key.slice(1)}`;
    const def = defs[key];
    // effectorKey survives property creation (verified live) and links a
    // rendered row back to its stable key no matter the display label.
    out[name] =
      key === "enable"
        ? { ...def, effectorKey: name }
        : { ...def, name: `${label} ${def.name}`, effectorKey: name };
  }
  return out;
}

const EFFECTOR_ORDER = ["shake", "plain", "random", "formula", "delay", "spline", "orbit", "repeater", "twist", "wrap", "voronoi"];
const EFFECTOR_NAMES = {
  shake: "Shake",
  plain: "Plain",
  random: "Random",
  formula: "Formula",
  delay: "Delay",
  spline: "Spline",
  orbit: "Orbit",
  repeater: "Repeater",
  twist: "Twist",
  wrap: "Wrap",
  voronoi: "Voronoi",
};
const EFFECTOR_TYPES = {
  shake: "zoidium:expresstext-plus/shake",
  plain: "zoidium:expresstext-plus/plain",
  random: "zoidium:expresstext-plus/random",
  formula: "zoidium:expresstext-plus/formula",
  delay: "zoidium:expresstext-plus/delay",
  spline: "zoidium:expresstext-plus/spline",
  orbit: "zoidium:expresstext-plus/orbit",
  repeater: "zoidium:expresstext-plus/repeater",
  twist: "zoidium:expresstext-plus/twist",
  wrap: "zoidium:expresstext-plus/wrap",
  voronoi: "zoidium:expresstext-plus/voronoi",
};
const EFFECTOR_KINDS = {};
for (const kind of Object.keys(EFFECTOR_TYPES)) {
  EFFECTOR_KINDS[EFFECTOR_TYPES[kind]] = kind;
}

const EFFECTOR_BUILDERS = {
  shake: createShakePropertyDefinitions,
  plain: createPlainPropertyDefinitions,
  random: createRandomPropertyDefinitions,
  formula: createFormulaPropertyDefinitions,
  delay: createDelayPropertyDefinitions,
  spline: createSplinePropertyDefinitions,
  orbit: createOrbitPropertyDefinitions,
  repeater: createRepeaterPropertyDefinitions,
  twist: createTwistPropertyDefinitions,
  wrap: createWrapPropertyDefinitions,
  voronoi: createVoronoiPropertyDefinitions,
};

// Effector classes live ONLY inside the one single ExpressText+ group:
// they are constructed from this factory map (never globally registered,
// never offered by the picker). The container revives them on load and the
// + menu instantiates them here.
function newEffectorInstance(type) {
  try {
    const factory = state.effectorClasses && state.effectorClasses[type];
    if (typeof factory === "function") return new factory();
  } catch (_error) {}
  return null;
}

function createContainerPropertyDefinitions(PZ) {
  return {
    rotationOrder: {
      name: "Rotation order",
      type: PZ.property.type.LIST,
      value: "XYZ",
      items: PZ.object3d.eulerOrders,
    },
  };
}

// Scoped custom-property class: the stock + dialog reads its entries from
// PZ.ui.objectTypes keyed by the customs list item class, so registering
// the eleven effectors under our own subclass scopes them to ExpressText+
// containers only. Everywhere else keeps the stock five.
function customPropertyClass(PZ) {
  if (state.customPropertyClass) return state.customPropertyClass;
  if (!PZ || !PZ.property || typeof PZ.property.dynamic !== "function") {
    return null;
  }
  class ExpressCustomProperty extends PZ.property.dynamic {}
  state.customPropertyClass = ExpressCustomProperty;
  return ExpressCustomProperty;
}

function effectorEntryDefs(PZ) {
  const builders = {
    Shake: createShakePropertyDefinitions,
    Plain: createPlainPropertyDefinitions,
    Random: createRandomPropertyDefinitions,
    Formula: createFormulaPropertyDefinitions,
    Delay: createDelayPropertyDefinitions,
    Spline: createSplinePropertyDefinitions,
    Orbit: createOrbitPropertyDefinitions,
    Repeater: createRepeaterPropertyDefinitions,
    Twist: createTwistPropertyDefinitions,
    Wrap: createWrapPropertyDefinitions,
    Voronoi: createVoronoiPropertyDefinitions,
  };
  const out = [];
  for (const name of Object.keys(builders)) {
    let objects = null;
    try {
      objects = Object.values(builders[name](PZ));
    } catch (_build) {
      continue;
    }
    if (!objects || !objects.length) continue;
    out.push({
      name,
      desc: `${name} letters with selection, strength and fields`,
      type: {
        custom: true,
        group: true,
        dynamic: true,
        // The display name must live INSIDE the type object: registry
        // entry names never reach the project file, so groups built from
        // this def would come back nameless after save/load.
        name,
        objects,
        // VECTOR3 routes the group row through the same editor stock
        // vector groups use. NUMBER would route through generateInput,
        // which reads keyframes the fresh group does not have yet.
        type: PZ.property.type.VECTOR3,
      },
    });
  }
  return out;
}

function registerEffectorEntries(PZ) {
  try {
    const itemClass = customPropertyClass(PZ);
    if (!itemClass) return false;
    const ui = PZ.ui;
    if (!ui || !ui.objectTypes || typeof ui.objectTypes.set !== "function") {
      return false;
    }
    ui.objectTypes.set(itemClass, effectorEntryDefs(PZ));
    return true;
  } catch (_error) {
    return false;
  }
}

function unregisterEffectorEntries() {
  try {
    const PZ = state.PZ;
    const itemClass = state.customPropertyClass;
    if (PZ && PZ.ui && PZ.ui.objectTypes && typeof PZ.ui.objectTypes.delete === "function" && itemClass) {
      PZ.ui.objectTypes.delete(itemClass);
    }
  } catch (_error) {}
  state.customPropertyClass = null;
}

function createShakePropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Shake"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      ...xyzDefinitions(PZ, "", [0, 0, 0], [0, 0, 0], [1, 1, 1]),
      frequency: dynamicNumberDefinition(PZ, "Frequency", 1, {
        min: 0,
        step: 0.1,
        decimals: 2,
      }),
      offset: dynamicNumberDefinition(PZ, "Offset", 0, {
        step: 0.05,
        decimals: 2,
      }),
      ...delayDefinitions(PZ),
      seed: seedDefinition(PZ),
      pivot: pivotDefinition(PZ),
      ...fieldDefinitions(PZ),
    },
    "shake",
    "Shake"
  );
}

function createPlainPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Plain"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      ...xyzDefinitions(PZ, "", [0, 0, 0], [0, 0, 0], [1, 1, 1]),
      invertOdd: {
        dynamic: true,
        name: "Invert odd",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 0,
      },
      ...delayDefinitions(PZ),
      pivot: pivotDefinition(PZ),
      ...fieldDefinitions(PZ),
    },
    "plain",
    "Plain"
  );
}

function createFormulaPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Formula"),
      letters: lettersDefinition(PZ),
      // Free entry (the manual allows below 0% and above 100%):
      // negative strengths mirror the result.
      strength: dynamicNumberDefinition(PZ, "Strength", 100, {
        step: 1,
        decimals: 1,
      }),
      minimum: dynamicNumberDefinition(PZ, "Minimum", 0, {
        step: 1,
        decimals: 1,
      }),
      maximum: dynamicNumberDefinition(PZ, "Maximum", 100, {
        step: 1,
        decimals: 1,
      }),
      expression: {
        dynamic: true,
        name: "Expression",
        type: PZ.property.type.TEXT,
        value: "sin(u*360*f+t*90)",
      },
      time: dynamicNumberDefinition(PZ, "Time", 1, {
        step: 0.1,
        decimals: 2,
      }),
      frequency: dynamicNumberDefinition(PZ, "Frequency", 1, {
        step: 0.1,
        decimals: 2,
      }),
      ...xyzDefinitions(PZ, "", [0, 10, 0], [0, 0, 0], [1, 1, 1]),
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "formula",
    "Formula"
  );
}

function createOrbitPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Orbit"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      angle: vectorDefinition(PZ, {
        name: "Angle",
        value: [0, 0, 0],
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      radius: dynamicNumberDefinition(PZ, "Radius", 100, {
        step: 1,
        decimals: 1,
      }),
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "orbit",
    "Orbit"
  );
}

function createSplinePropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Spline"),
      letters: lettersDefinition(PZ),
      // Free entry (Strength blends the distance to the path and may
      // exceed 100% or mirror below 0%, like the manual).
      strength: dynamicNumberDefinition(PZ, "Strength", 100, {
        step: 1,
        decimals: 1,
      }),
      mode: {
        dynamic: true,
        name: "Mode",
        type: PZ.property.type.OPTION,
        items: SPLINE_MODE_LABELS.join(";"),
        value: 0,
      },
      transform: {
        dynamic: true,
        name: "Transform",
        type: PZ.property.type.OPTION,
        items: SPLINE_TRANSFORM_LABELS.join(";"),
        value: 0,
      },
      path: {
        dynamic: true,
        name: "Path",
        type: PZ.property.type.OPTION,
        items: SPLINE_PATH_LABELS.join(";"),
        value: 0,
      },
      length: dynamicNumberDefinition(PZ, "Length", 100, {
        min: 0,
        step: 1,
        decimals: 2,
      }),
      radius: dynamicNumberDefinition(PZ, "Radius", 50, {
        min: 0,
        step: 1,
        decimals: 2,
      }),
      radiusEnd: dynamicNumberDefinition(PZ, "End radius", 50, {
        min: 0,
        step: 1,
        decimals: 2,
      }),
      height: dynamicNumberDefinition(PZ, "Height", 100, {
        min: 0,
        step: 1,
        decimals: 2,
      }),
      turns: dynamicNumberDefinition(PZ, "Turns", 1, {
        step: 0.1,
        decimals: 2,
      }),
      plane: {
        dynamic: true,
        name: "Plane",
        type: PZ.property.type.OPTION,
        items: SPLINE_PLANE_LABELS.join(";"),
        value: 0,
      },
      tilt: vectorDefinition(PZ, {
        name: "Tilt",
        value: [0, 0, 0],
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      reverse: {
        dynamic: true,
        name: "Reverse",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 0,
      },
      offset: dynamicNumberDefinition(PZ, "Offset", 0, {
        step: 1,
        decimals: 1,
      }),
      start: dynamicNumberDefinition(PZ, "Start", 0, {
        step: 1,
        decimals: 1,
      }),
      end: dynamicNumberDefinition(PZ, "End", 100, {
        step: 1,
        decimals: 1,
      }),
      clamp: {
        dynamic: true,
        name: "Clamp",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 1,
      },
      position: {
        dynamic: true,
        name: "Position",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 1,
      },
      rotation: {
        dynamic: true,
        name: "Rotation",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 1,
      },
      heading: dynamicNumberDefinition(PZ, "Heading", 0, {
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      pitch: dynamicNumberDefinition(PZ, "Pitch", 0, {
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      bank: dynamicNumberDefinition(PZ, "Bank", 0, {
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "spline",
    "Spline"
  );
}

function createRepeaterPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Repeater"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      mode: {
        dynamic: true,
        name: "Mode",
        type: PZ.property.type.OPTION,
        items: REPEATER_MODE_LABELS.join(";"),
        value: 0,
      },
      copies: dynamicNumberDefinition(PZ, "Copies", 3, {
        min: 0,
        max: REPEATER_MAX_COPIES,
        step: 1,
        decimals: 0,
      }),
      offset: vectorDefinition(PZ, {
        name: "Offset",
        value: [10, 0, 0],
        step: 1,
        decimals: 2,
      }),
      rangeMin: vectorDefinition(PZ, {
        name: "Min range",
        value: [-10, -10, -10],
        step: 1,
        decimals: 2,
      }),
      rangeMax: vectorDefinition(PZ, {
        name: "Max range",
        value: [10, 10, 10],
        step: 1,
        decimals: 2,
      }),
      seed: seedDefinition(PZ),
      lag: dynamicNumberDefinition(PZ, "Lag", 2, {
        min: 0,
        step: 0.5,
        decimals: 1,
      }),
      fade: dynamicNumberDefinition(PZ, "Fade", 50, {
        min: 0,
        max: 100,
        step: 1,
        decimals: 1,
      }),
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "repeater",
    "Repeater"
  );
}

function createTwistPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Twist"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      angle: dynamicNumberDefinition(PZ, "Angle", 0, {
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      axis: {
        dynamic: true,
        name: "Axis",
        type: PZ.property.type.OPTION,
        items: TWIST_AXIS_LABELS.join(";"),
        value: 2,
      },
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "twist",
    "Twist"
  );
}

function createWrapPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Wrap"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      amplitude: dynamicNumberDefinition(PZ, "Amplitude", 0, {
        step: 1,
        decimals: 2,
      }),
      frequency: dynamicNumberDefinition(PZ, "Frequency", 1, {
        min: 0,
        step: 0.1,
        decimals: 2,
      }),
      phase: dynamicNumberDefinition(PZ, "Phase", 0, {
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      direction: {
        dynamic: true,
        name: "Direction",
        type: PZ.property.type.OPTION,
        items: WRAP_DIRECTION_LABELS.join(";"),
        value: 1,
      },
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "wrap",
    "Wrap"
  );
}

function createVoronoiPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Voronoi"),
      letters: lettersDefinition(PZ),
      strength: strengthDefinition(PZ),
      chunks: dynamicNumberDefinition(PZ, "Chunks", 8, {
        min: 1,
        max: 64,
        step: 1,
        decimals: 0,
      }),
      explode: dynamicNumberDefinition(PZ, "Explode", 0, {
        step: 1,
        decimals: 2,
      }),
      spin: vectorDefinition(PZ, {
        name: "Spin",
        value: [0, 0, 0],
        scaleFactor: DEGREES_TO_RADIANS,
        step: 1,
        decimals: 1,
      }),
      seed: seedDefinition(PZ),
      ...delayDefinitions(PZ),
      ...fieldDefinitions(PZ),
    },
    "voronoi",
    "Voronoi"
  );
}

function createDelayPropertyDefinitions(PZ) {
  // Hand-built keys (no withPrefix): the kind prefix doubles as the key
  // prefix, so withPrefix would stutter ("delayDelayOrder"). Display names
  // follow the "<Effector> <thing>" convention; every def carries its
  // effectorKey stamp for the group reader.
  return {
    delayEnable: {
      ...enableDefinition(PZ, "Delay"),
      effectorKey: "delayEnable",
    },
    delayLetters: {
      ...lettersDefinition(PZ),
      name: "Delay Letters",
      effectorKey: "delayLetters",
    },
    delayStrength: {
      ...strengthDefinition(PZ),
      name: "Delay Strength",
      effectorKey: "delayStrength",
    },
    delayMode: {
      dynamic: true,
      name: "Delay Mode",
      type: PZ.property.type.OPTION,
      items: DELAY_MODE_LABELS.join(";"),
      value: 0,
      effectorKey: "delayMode",
    },
    delayPosition: {
      ...enableDefinition(PZ, "Delay Position"),
      effectorKey: "delayPosition",
    },
    delayScale: {
      ...enableDefinition(PZ, "Delay Scale"),
      effectorKey: "delayScale",
    },
    delayRotation: {
      ...enableDefinition(PZ, "Delay Rotation"),
      effectorKey: "delayRotation",
    },
    delayField: {
      dynamic: true,
      name: "Delay Field",
      type: PZ.property.type.OPTION,
      items: FIELD_LABELS.join(";"),
      value: 0,
      effectorKey: "delayField",
    },
    delayFieldPosition: {
      ...vectorDefinition(PZ, {
        name: "Delay Field position",
        value: [0, 0, 0],
        step: 1,
        decimals: 2,
      }),
      effectorKey: "delayFieldPosition",
    },
    delayFieldScale: {
      ...vectorDefinition(PZ, {
        name: "Delay Field scale",
        value: [100, 100, 100],
        min: 0.01,
        step: 1,
        decimals: 2,
      }),
      effectorKey: "delayFieldScale",
    },
  };
}

function createRandomPropertyDefinitions(PZ) {
  return withPrefix(
    {
      enable: enableDefinition(PZ, "Random"),
      letters: lettersDefinition(PZ),
      // Free entry (the manual allows below 0% and above 100%):
      // negative strengths mirror the scatter.
      strength: dynamicNumberDefinition(PZ, "Strength", 100, {
        step: 1,
        decimals: 1,
      }),
      mode: {
        dynamic: true,
        name: "Mode",
        type: PZ.property.type.OPTION,
        items: RANDOM_MODE_LABELS.join(";"),
        value: 0,
      },
      minimum: dynamicNumberDefinition(PZ, "Minimum", 0, {
        step: 1,
        decimals: 1,
      }),
      maximum: dynamicNumberDefinition(PZ, "Maximum", 100, {
        step: 1,
        decimals: 1,
      }),
      synchronized: {
        dynamic: true,
        name: "Synchronized",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 0,
      },
      indexed: {
        dynamic: true,
        name: "Indexed",
        type: PZ.property.type.OPTION,
        items: "off;on",
        value: 1,
      },
      seed: seedDefinition(PZ),
      space: {
        dynamic: true,
        name: "Space",
        type: PZ.property.type.OPTION,
        items: RANDOM_SPACE_LABELS.join(";"),
        value: 0,
      },
      animationSpeed: dynamicNumberDefinition(PZ, "Animation speed", 0, {
        min: 0,
        step: 1,
        decimals: 1,
      }),
      noiseScale: dynamicNumberDefinition(PZ, "Noise scale", 100, {
        min: 0,
        step: 1,
        decimals: 1,
      }),
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
      ...delayDefinitions(PZ),
      pivot: pivotDefinition(PZ),
      ...fieldDefinitions(PZ),
    },
    "random",
    "Random"
  );
}

module.exports = { EFFECTOR_BUILDERS, EFFECTOR_KINDS, EFFECTOR_NAMES, EFFECTOR_ORDER, EFFECTOR_TYPES, createContainerPropertyDefinitions, createDelayPropertyDefinitions, createFormulaPropertyDefinitions, createOrbitPropertyDefinitions, createPlainPropertyDefinitions, createRandomPropertyDefinitions, createRepeaterPropertyDefinitions, createShakePropertyDefinitions, createSplinePropertyDefinitions, createTwistPropertyDefinitions, createVoronoiPropertyDefinitions, createWrapPropertyDefinitions, customPropertyClass, delayDefinitions, dynamicNumberDefinition, effectorEntryDefs, enableDefinition, fieldDefinitions, lettersDefinition, newEffectorInstance, pivotDefinition, registerEffectorEntries, seedDefinition, strengthDefinition, unregisterEffectorEntries, vectorDefinition, withPrefix, xyzDefinitions };
