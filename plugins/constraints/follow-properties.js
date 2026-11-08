"use strict";

const FOLLOW_KEYS = Object.freeze({
  follow: "zoidiumFollow",
  followSpace: "zoidiumFollowSpace",
  followPosition: "zoidiumFollowPosition",
  followRotation: "zoidiumFollowRotation",
  followScale: "zoidiumFollowScale",
  positionOffset: "zoidiumFollowPositionOffset",
  rotationOffset: "zoidiumFollowRotationOffset",
  scaleOffset: "zoidiumFollowScaleOffset",
  fallback: "zoidiumFollowFallback",
});
const FOLLOW_CONTROL = "constraints/follow";

function followDefinitions(T, changed) {
  const option = (name, value, items) => ({ name, type: T.OPTION, value, items, changed });
  const offset = (name, value, rotation = false) => ({ name, type: T.VECTOR3, dynamic: true, group: true, value,
    ...(rotation ? { scaleFactor: Math.PI / 180 } : {}),
    objects: value.map((component, index) => ({ name: ["X", "Y", "Z"][index], type: T.NUMBER,
      dynamic: true, value: component, ...(rotation ? { scaleFactor: Math.PI / 180 } : {}) })),
  });
  return {
    [FOLLOW_KEYS.follow]: { name: "Follow", type: T.TEXT, value: "", zoidiumControl: FOLLOW_CONTROL, changed },
    [FOLLOW_KEYS.followSpace]: option("Follow space", 0, "World;Local"),
    [FOLLOW_KEYS.followPosition]: option("Copy position", 1, "Off;On"),
    [FOLLOW_KEYS.followRotation]: option("Copy rotation", 1, "Off;On"),
    [FOLLOW_KEYS.followScale]: option("Copy scale", 1, "Off;On"),
    [FOLLOW_KEYS.positionOffset]: offset("Position offset", [0, 0, 0]),
    [FOLLOW_KEYS.rotationOffset]: offset("Rotation offset", [0, 0, 0], true),
    [FOLLOW_KEYS.scaleOffset]: offset("Scale multiplier", [1, 1, 1]),
    [FOLLOW_KEYS.fallback]: { visible: false, name: "Follow missing-target pose", type: T.TEXT, value: "" },
  };
}

module.exports = { FOLLOW_KEYS, FOLLOW_CONTROL, followDefinitions };
