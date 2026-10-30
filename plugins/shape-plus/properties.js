"use strict";
const titles = {
  group: "Group",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  polystar: "Polystar",
  path: "Path",
  text: "Text",
  fill: "Fill",
  stroke: "Stroke",
  gradientFill: "Gradient Fill",
  gradientStroke: "Gradient Stroke",
  trim: "Trim Paths",
  repeater: "Repeater",
  roundCorners: "Round Corners",
  twist: "Twist",
  zigZag: "Zig Zag",
  puckerBloat: "Pucker & Bloat",
  wigglePaths: "Wiggle Paths",
  wiggleTransform: "Wiggle Transform",
  offsetPaths: "Offset Paths",
  mergePaths: "Merge Paths",
};
function definitions(PZ, kind, vertexIds) {
  const T = PZ.property.type;
  const number = (name, value, extra) => ({
    name,
    value,
    dynamic: true,
    type: T.NUMBER,
    step: 1,
    decimals: 2,
    ...extra,
  });
  const vector = (name, value, type = T.VECTOR2) => ({
    name,
    type,
    dynamic: true,
    group: true,
    objects: value.map((v, i) =>
      number(name + "." + (type === T.COLOR ? "RGB" : "XY")[i], v),
    ),
  });
  const list = (name, value, values) => ({
    name,
    value,
    type: T.LIST,
    items: values.map((v) => ({ name: v, value: v })),
  });
  const result = {
    name: { name: "Name", type: T.TEXT, value: titles[kind], visible: false },
    enabled: { name: "Enabled", type: T.OPTION, value: 1, items: "off;on" },
  };
  if (kind === "text") Object.assign(result, require("./text-properties.js").definitions(PZ, number, vector, list));
  if (kind === "group")
    Object.assign(result, {
      anchor: vector("Anchor", [0, 0]),
      position: vector("Position", [0, 0]),
      scale: vector("Scale", [1, 1]),
      rotation: number("Rotation", 0, { scaleFactor: Math.PI / 180 }),
      opacity: number("Opacity", 1, { min: 0, max: 1, step: 0.01 }),
    });
  if (["rectangle", "ellipse"].includes(kind))
    Object.assign(result, {
      size: vector("Size", [200, 200]),
      position: vector("Position", [0, 0]),
    });
  if (kind === "rectangle")
    result.roundness = number("Roundness", 0, { min: 0 });
  if (kind === "polystar")
    Object.assign(result, {
      mode: list("Type", "star", ["star", "polygon"]),
      points: number("Points", 5, { min: 3, max: 128, decimals: 0 }),
      position: vector("Position", [0, 0]),
      innerRadius: number("Inner radius", 50, { min: 0 }),
      outerRadius: number("Outer radius", 100, { min: 0 }),
      innerRoundness: number("Inner roundness", 0, { min: 0, max: 100 }),
      outerRoundness: number("Outer roundness", 0, { min: 0, max: 100 }),
      rotation: number("Rotation", 0, { scaleFactor: Math.PI / 180 }),
    });
  if (kind === "path") {
    result.closed = {
      name: "Closed",
      type: T.OPTION,
      value: 1,
      items: "off;on",
    };
    const initial = [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ];
    result.path = {
      name: "Path",
      type: T.NUMBER,
      dynamic: true,
      group: true,
      zoidiumControl: "shape-plus/path",
      objects: vertexIds.flatMap((id, i) => {
        const point = initial[i % 4];
        return ["X", "Y", "In X", "In Y", "Out X", "Out Y"].map((channel, j) =>
          number(id + " " + channel, j < 2 ? point[j] : 0),
        );
      }),
    };
  }
  if (["fill", "stroke", "gradientFill", "gradientStroke"].includes(kind))
    Object.assign(result, {
      color: vector("Color", [1, 1, 1], T.COLOR),
      opacity: number("Opacity", 1, { min: 0, max: 1, step: 0.01 }),
    });
  if (["fill", "gradientFill"].includes(kind))
    result.fillRule = list("Fill rule", "nonzero", ["nonzero", "even-odd"]);
  if (["stroke", "gradientStroke"].includes(kind))
    Object.assign(result, {
      width: number("Width", 10, { min: 0 }),
      cap: list("Cap", "butt", ["butt", "round", "square"]),
      join: list("Join", "miter", ["miter", "round", "bevel"]),
      miterLimit: number("Miter limit", 4, { min: 1 }),
    });
  if (["fill", "stroke", "gradientFill", "gradientStroke"].includes(kind))
    result.composite = list("Composite", "below", ["below", "above"]);
  if (["stroke", "gradientStroke"].includes(kind)) {
    result.dashPairs = list("Dash / gap pairs", 0, [0, 1, 2, 3]);
    for (let i = 1; i <= 3; i++) {
      result["dash" + i] = number("Dash " + i, 20, { min: 0 });
      result["gap" + i] = number("Gap " + i, 10, { min: 0 });
    }
    Object.assign(result, {
      dashOffset: number("Dash offset", 0),
      startLength: number("Start length (%)", 0, { min: 0, max: 100 }),
      endLength: number("End length (%)", 0, { min: 0, max: 100 }),
      startWidth: number("Start width (%)", 0, { min: 0 }),
      endWidth: number("End width (%)", 0, { min: 0 }),
      startEase: number("Start ease", 0, { min: -100, max: 100 }),
      endEase: number("End ease", 0, { min: -100, max: 100 }),
      waveAmount: number("Wave amount (%)", 0, { min: 0, max: 100 }),
      waveUnits: list("Wave units", "cycles", ["cycles", "length"]),
      wavelength: number("Wavelength", 100, { min: 0.01 }),
      waveCycles: number("Cycles", 3, { min: 0 }),
      wavePhase: number("Wave phase (degrees)", 0),
    });
  }
  if (["gradientFill", "gradientStroke"].includes(kind)) {
    delete result.color;
    Object.assign(result, {
      gradientType: list("Type", "linear", ["linear", "radial"]),
      startPoint: vector("Start point", [-100, 0]),
      endPoint: vector("End point", [100, 0]),
      highlightLength: number("Highlight length (%)", 0, { min: -99, max: 99 }),
      highlightAngle: number("Highlight angle", 0, {
        scaleFactor: Math.PI / 180,
      }),
      stops: {
        name: "Colors",
        type: T.GRADIENT,
        dynamic: true,
        zoidiumControl: "shape-plus/gradient",
        value: [
          { position: 0, color: "rgba(255,77,26,1)" },
          { position: 1, color: "rgba(26,102,255,1)" },
        ],
      },
    });
  }
  if (kind === "trim")
    Object.assign(result, {
      start: number("Start (%)", 0, { min: 0, max: 100 }),
      end: number("End (%)", 100, { min: 0, max: 100 }),
      offset: number("Offset (degrees)", 0),
      mode: list("Trim multiple shapes", "simultaneous", [
        "simultaneous",
        "individual",
      ]),
    });
  if (kind === "roundCorners") result.radius = number("Radius", 10, { min: 0 });
  if (kind === "repeater")
    Object.assign(result, {
      copies: number("Copies", 3, { min: 0, max: 128 }),
      offset: number("Offset", 0),
      composite: list("Composite", "below", ["below", "above"]),
      anchor: vector("Anchor", [0, 0]),
      position: vector("Position", [100, 0]),
      scale: vector("Scale", [1, 1]),
      rotation: number("Rotation", 0, { scaleFactor: Math.PI / 180 }),
      startOpacity: number("Start opacity", 1, { min: 0, max: 1, step: 0.01 }),
      endOpacity: number("End opacity", 1, { min: 0, max: 1, step: 0.01 }),
    });
  if (kind === "twist") Object.assign(result, {
    angle: number("Angle", 0, {scaleFactor: Math.PI/180}), center: vector("Center", [0,0]),
  });
  if (kind === "puckerBloat") result.amount = number("Amount (%)", 0, {min:-100,max:100});
  if (["zigZag", "wigglePaths"].includes(kind)) Object.assign(result, {
    size: number("Size", 10, {min:0}), points: list("Points", "corner", ["corner","smooth"]),
  });
  if (kind === "zigZag") result.ridges = number("Ridges per segment",3,{min:1,max:64,decimals:0});
  if (kind === "wigglePaths") result.detail = number("Detail",5,{min:1,max:100,decimals:0});
  if (["wigglePaths","wiggleTransform"].includes(kind)) Object.assign(result, {
    frequency: number("Wiggles / second",1,{min:0,max:100}),
    correlation: number("Correlation (%)",50,{min:0,max:100}),
    temporalPhase: number("Temporal phase (degrees)",0), spatialPhase: number("Spatial phase (degrees)",0),
    seed: number("Random seed",1,{decimals:0}),
  });
  if (kind === "wiggleTransform") Object.assign(result, {
    anchor: vector("Anchor offset",[0,0]), position: vector("Position offset",[20,20]),
    scale: vector("Scale offset (%)",[0,0]), rotation: number("Rotation offset",0,{scaleFactor:Math.PI/180}),
  });
  if (kind === "offsetPaths") Object.assign(result, {
    amount: number("Amount",10), join:list("Join","miter",["miter","round","bevel"]),
    miterLimit:number("Miter limit",4,{min:1,max:100}),
  });
  if (kind === "mergePaths") result.mode=list("Mode","add",["merge","add","subtract","intersect","exclude"]);
  if (result.composite)
    result.composite.items = [
      { name: "Below previous in same group", value: "below" },
      { name: "Above previous in same group", value: "above" },
    ];
  if (kind === "trim")
    result.mode.items = [
      { name: "Simultaneously", value: "simultaneous" },
      { name: "Individually", value: "individual" },
    ];
  return result;
}
module.exports = { definitions, titles };
