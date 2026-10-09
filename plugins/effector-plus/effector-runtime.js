"use strict";

// Effector+ compatibility layer. The Effector plugin (repeater) owns the
// Twist, Warp, and Voronoi Fracture implementations. This module only maps the
// numeric types that Davidium Effector+ projects store (7, 8, 9) onto those
// namespaced classes, so old projects load. It adds no menu entries.
//
// Numeric types are not claimed by CM3 core, but another plugin may use them.
// The mapping is therefore registered in a shared claim table, and activation
// fails with a clear message instead of overriding an existing claim.

const LEGACY_TYPES = Object.freeze({
  7: "zoidium:repeater/twist",
  8: "zoidium:repeater/warp",
  9: "zoidium:repeater/voronoi-fracture",
});
const OWNER = "effector-plus";

let active = null;

function claimLegacyTypes(PZ) {
  PZ.zoidium = PZ.zoidium || {};
  const claims = PZ.zoidium.legacyObject3dTypes || (PZ.zoidium.legacyObject3dTypes = new Map());
  const conflicts = Object.keys(LEGACY_TYPES)
    .map(Number)
    .filter((type) => claims.has(type) && claims.get(type) !== OWNER);
  if (conflicts.length > 0) {
    const owners = conflicts.map((type) => type + " (" + claims.get(type) + ")").join(", ");
    throw new Error("Numeric 3D object types are already claimed by another plugin: " + owners);
  }
  for (const type of Object.keys(LEGACY_TYPES)) claims.set(Number(type), OWNER);
  return claims;
}

module.exports = {
  activate(context) {
    if (active) return;
    const PZ = context && context.PZ;
    const object3d = PZ && PZ.object3d;
    if (!object3d || typeof object3d.create !== "function") {
      throw new Error("Effector+ needs PZ.object3d.create from the CM3 runtime.");
    }
    const claims = claimLegacyTypes(PZ);
    const original = object3d.create;
    const patched = function create(type) {
      if (patched.alive && typeof type === "number" && Object.prototype.hasOwnProperty.call(LEGACY_TYPES, type)) {
        return original.call(this, LEGACY_TYPES[type]);
      }
      return original.apply(this, arguments);
    };
    patched.alive = true;
    object3d.create = patched;
    active = { PZ, original, patched, claims };
  },
  deactivate() {
    if (!active) return;
    const { PZ, original, patched, claims } = active;
    patched.alive = false;
    if (PZ.object3d.create === patched) PZ.object3d.create = original;
    for (const type of Object.keys(LEGACY_TYPES)) {
      if (claims.get(Number(type)) === OWNER) claims.delete(Number(type));
    }
    active = null;
  },
};
