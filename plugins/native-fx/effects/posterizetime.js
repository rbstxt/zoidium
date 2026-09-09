"use strict";

// Native FX (temporal): declares a deterministic frame-rate quantizer.
// The host applies it in plugins/core/temporal-render.js; this file only
// describes properties and how to read the operator for a frame.
ZoidiumPluginApis.defineTemporal.call(this, {
  kind: "posterize-time",
  displayName: "Posterize Time",
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    fps: {
      dynamic: true,
      name: "Frame rate",
      type: PZ.property.type.NUMBER,
      value: 12,
      min: 1,
      max: 120,
      step: 1,
      decimals: 0,
    },
  },
  getOperator(effect, frame) {
    return {
      kind: "posterize-time",
      enabled: effect.properties.enabled.get(frame) === 1,
      fps: Number(effect.properties.fps.get(frame)) || 1,
    };
  },
});
