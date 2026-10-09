"use strict";

// OpenZoid Rowbyte & Red Giant Suite — designer gear button.
//
// Restores the OpenZoid object-panel gear that opens the Trapcode designer
// (Particular, Form, Plexus) and the Optical Flares Options window. Upstream
// CM3 renders duplicate/delete buttons for 3D list items but has no designer
// branch, so this module wraps every owner of generateItemCommands and
// prepends the settings gear for items whose constructor carries a designer
// config, mirroring the OpenZoid block exactly (gear first, then the native
// buttons). Resolution happens at render/click time, so module enable order
// never matters.

const state = {
  active: false,
  installed: null,
};

function findCommandsOwners(PZ) {
  const ui = PZ && PZ.ui;
  if (!ui) return [];
  const owners = [];
  const seen = new Set();
  const queue = [{ obj: ui, depth: 0 }];
  let budget = 800;
  while (queue.length && budget-- > 0) {
    const { obj, depth } = queue.shift();
    if (!obj || seen.has(obj)) continue;
    seen.add(obj);
    let owns = false;
    try {
      owns = Object.prototype.hasOwnProperty.call(obj, "generateItemCommands") &&
        typeof obj.generateItemCommands === "function";
    } catch (_error) { /* unreadable node */ }
    if (owns) {
      owners.push(obj);
      continue;
    }
    if (depth >= 4) continue;
    let proto = null;
    try { proto = Object.getPrototypeOf(obj); } catch (_error) { /* none */ }
    if (proto && proto !== Object.prototype && proto !== Function.prototype) {
      queue.push({ obj: proto, depth: depth + 1 });
    }
    // Class methods live on .prototype, which neither Object.keys nor the
    // prototype chain above reaches for constructor functions.
    if (typeof obj === "function") {
      let ownProto = null;
      try { ownProto = obj.prototype; } catch (_error) { /* none */ }
      if (ownProto && typeof ownProto === "object") {
        queue.push({ obj: ownProto, depth: depth + 1 });
      }
    }
    if (depth >= 3) continue;
    let keys = [];
    try { keys = Object.keys(obj); } catch (_error) { /* none */ }
    for (const key of keys.slice(0, 60)) {
      let value = null;
      try { value = obj[key]; } catch (_error) { continue; }
      if (value && (typeof value === "object" || typeof value === "function") && !value.nodeType) {
        queue.push({ obj: value, depth: depth + 1 });
      }
    }
  }
  return owners;
}

function reconcileFlareConfig(PZ) {
  // Optical Flares registers its Options window with the Trapcode designer
  // when the designer is already present. When this pack activates first,
  // do it here so enable order never matters. Idempotent: registerConfig
  // assigns the config onto the class.
  if (
    PZ.trapcode && PZ.trapcode.designer &&
    PZ.object3d && PZ.object3d.optflares &&
    !PZ.object3d.optflares.designer &&
    PZ.opticalflares && typeof PZ.opticalflares.open === "function"
  ) {
    PZ.trapcode.designer.registerConfig(PZ.object3d.optflares, {
      title: "Optical Flares Options",
      customOpen: function (root, designer) {
        if (PZ.opticalflares && PZ.opticalflares.open) {
          PZ.opticalflares.open(root, designer);
        }
      },
    });
  }
}

function installGear(PZ) {
  const installed = [];
  for (const owner of findCommandsOwners(PZ)) {
    if (owner.generateItemCommands.__openzoidDesignerGear) continue;
    const original = owner.generateItemCommands;
    const patched = function (e, t) {
      const out = original.call(this, e, t);
      try {
        if (patched.__openzoidDead) return out;
        const live = (typeof globalThis !== "undefined" ? globalThis.PZ : null) || PZ;
        const designer = live.trapcode && live.trapcode.designer;
        if (!designer || !t || !t.constructor || !t.constructor.designer) return out;
        if (!t.parent || !(t.parent instanceof live.objectList)) return out;
        if (!this.options || !this.options.showListItemButtons) return out;
        if (typeof this.generateButton !== "function") return out;
        const host = e && e.children && e.children[1];
        if (!host || typeof host.insertBefore !== "function") return out;
        if (host.querySelector && host.querySelector("button[data-designer-gear]")) return out;
        const gear = this.generateButton("settings");
        gear.title = "designer";
        if (gear.setAttribute) gear.setAttribute("data-designer-gear", "1");
        const item = t;
        gear.onclick = (ev) => {
          ev.stopPropagation();
          const atClick = (typeof globalThis !== "undefined" ? globalThis.PZ : null) || PZ;
          const now = atClick.trapcode && atClick.trapcode.designer;
          if (now) now.open(item);
        };
        host.insertBefore(gear, host.firstElementChild);
      } catch (_err) { /* never break list rendering */ }
      return out;
    };
    patched.__openzoidDesignerGear = true;
    owner.generateItemCommands = patched;
    installed.push({ owner, original, patched });
  }
  return installed;
}

function uninstallGear() {
  for (const { owner, original, patched } of state.installed || []) {
    patched.__openzoidDead = true;
    try {
      if (owner.generateItemCommands === patched) {
        owner.generateItemCommands = original;
      }
    } catch (_error) { /* best effort */ }
  }
  state.installed = null;
}

module.exports = {
  activate(context) {
    if (state.active) return;
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    if (!PZ || !PZ.ui) {
      throw new Error("Designer gear needs the CM3 runtime.");
    }
    reconcileFlareConfig(PZ);
    state.installed = installGear(PZ);
    if (!state.installed.length) {
      throw new Error("Designer gear could not find the object list renderer.");
    }
    state.active = true;
  },
  deactivate() {
    try {
      uninstallGear();
    } finally {
      state.active = false;
    }
  },
};
