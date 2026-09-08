"use strict";

  this.defaultName = "Posterize Time";
  this._zoidiumTemporal = {
    kind: "posterize-time",
    getOperator(effect, frame) {
      return {
        kind: "posterize-time",
        enabled: effect.properties.enabled.get(frame) === 1,
        fps: Number(effect.properties.fps.get(frame)) || 1,
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
