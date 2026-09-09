"use strict";

// Native FX (temporal): declares a deterministic time-shift operator.
// The host applies it in plugins/core/temporal-render.js; this file only
// describes properties and how to read the operator for a frame.
ZoidiumPluginApis.defineTemporal.call(this, {
  kind: "time-offset",
  displayName: "Time Offset",
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    offset: {
      dynamic: true,
      name: "Offset (frames)",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: -100000,
      max: 100000,
      step: 1,
      decimals: 3,
    },
  },
  getOperator(effect, frame) {
    return {
      kind: "time-offset",
      enabled: effect.properties.enabled.get(frame) === 1,
      offsetFrames: Number(effect.properties.offset.get(frame)) || 0,
    };
  },
});
