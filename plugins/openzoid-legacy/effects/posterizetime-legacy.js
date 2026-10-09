// OpenZoid Legacy — Posterize Time (Legacy).
// The OpenZoid effect held a rendered frame in a buffer and refreshed it when
// the frame-rate bucket changed, so the displayed frame depended on which
// frames had been rendered before. This port uses the core temporal operator
// instead: the frame is quantized to the bucket's timestamp (the same
// floor(time * fps) / fps rule the legacy bucket used), which holds the same
// frames for any visiting order. Property names are unchanged so saved
// projects keep their Frame Rate values.
ZoidiumPluginApis.defineTemporal.call(this, {
  kind: "posterize-time",
  displayName: "Posterize Time (Legacy)",
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    frameRate: {
      dynamic: true,
      name: "Frame Rate",
      type: PZ.property.type.NUMBER,
      value: 8,
      min: 1,
      max: 120,
      step: 1,
      decimals: 2,
    },
  },
  getOperator(effect, frame) {
    const fps = Number(effect.properties.frameRate.get(frame));
    return {
      kind: "posterize-time",
      enabled: effect.properties.enabled.get(frame) === 1,
      fps: Number.isFinite(fps) && fps >= 1 ? fps : 1,
    };
  },
});
