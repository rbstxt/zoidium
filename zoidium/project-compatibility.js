// Decide compatibility once, at the project boundary, before plugin factories
// load the saved objects.
(function (global) {
  "use strict";

  const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const samplers = new Set(["echo", "timedisplacement", "ccwidetime", "timedifference"]);

  // Saved objects without an explicit mode were authored before these modes
  // existed and keep the legacy behavior. Only objects added from now on are
  // created with, and serialize, the current behavior.
  function migrateProject(data) {
    if (!data || typeof data !== "object") return data;
    const seen = new WeakMap();
    function visit(value, kind) {
      if (!value || typeof value !== "object") return value;
      if (seen.has(value)) return seen.get(value);
      let copy = value;
      seen.set(value, value);
      const set = (key, next) => {
        if (copy === value) copy = Array.isArray(value) ? value.slice() : { ...value };
        Object.defineProperty(copy, key, { value: next, enumerable: true, writable: true, configurable: true });
      };
      for (const key of Object.keys(value)) {
        let childKind = kind;
        if (!Array.isArray(value)) {
          const base = value.baseType || value.baseTypeString;
          childKind = key === "objects" ? (kind === "effect" ? "effect" :
            kind === "layer" && value.type === 2 ? "layer" : "object3d") :
            key === "effects" ? "effect" : key === "clips" ? "clip" :
            key === "object" && kind === "clip" ? "layer" : key === "material" ? "material" :
            key === "data" && ["object3d", "layer", "effect"].includes(base) ? base : "container";
        }
        const child = visit(value[key], childKind);
        if (child !== value[key]) set(key, child);
      }
      if (kind === "layer" && value.type === 4 && !owns(value, "zoidiumShadowMode")) {
        set("zoidiumShadowMode", "legacy");
      }
      if (kind === "effect" && samplers.has(value.type) && !owns(value, "zoidiumTemporalMode")) {
        set("zoidiumTemporalMode", "legacy");
      }
      if (kind === "material" && value.type === "pbrplus" && !owns(value, "zoidiumUvMode")) {
        set("zoidiumUvMode", "legacy");
      }
      if (kind === "object3d" && value.type === 1 && !owns(value, "zoidiumTextScaleMode")) {
        set("zoidiumTextScaleMode", "legacy");
      }
      if (kind === "object3d" && [7, 8, "zoidium:repeater/twist", "zoidium:repeater/warp"].includes(value.type) &&
          !owns(value, "zoidiumSubdivisionMode")) {
        set("zoidiumSubdivisionMode", "legacy");
      }
      seen.set(value, copy);
      return copy;
    }
    return visit(data, "container");
  }

  function installTextMode(PZ) {
    const proto = PZ.object3d?.text?.prototype;
    if (!proto || proto.__zoidiumTextScaleSerialization || !proto.load || !proto.toJSON) return;
    const load = proto.load, toJSON = proto.toJSON;
    proto.load = function (data) {
      this.zoidiumTextScaleMode = data?.zoidiumTextScaleMode === "legacy" ? "legacy" : "current";
      return load.apply(this, arguments);
    };
    proto.toJSON = function () {
      return { ...toJSON.apply(this, arguments), zoidiumTextScaleMode: this.zoidiumTextScaleMode || "current" };
    };
    proto.__zoidiumTextScaleSerialization = true;
  }

  const api = { migrateProject, installTextMode };
  if (typeof module === "object" && module.exports) module.exports = api;
  else global.ZoidiumProjectCompatibility = api;
})(typeof window !== "undefined" ? window : null);
