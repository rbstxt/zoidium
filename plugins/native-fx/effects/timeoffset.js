"use strict";

  this.defaultName = "Time Offset";
  this._zoidiumTemporal = {
    kind: "time-offset",
    getOperator(effect, frame) {
      return {
        kind: "time-offset",
        enabled: effect.properties.enabled.get(frame) === 1,
        offsetFrames: Number(effect.properties.offset.get(frame)) || 0,
      };
    },
  };
  this.properties.addAll({
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
  });

  this.load = function load(data) {
    this.properties.load(data && data.properties);
  };

  this.update = function update() {};
  this.prepare = async function prepare() {};
  this.resize = function resize() {};
  this.unload = function unload() {};
  this.toJSON = function toJSON() {
    return { type: this.type, properties: this.properties };
  };
