(function installObject3DEnabled(global) {
  "use strict";
  const PZ = global.PZ;
  const base = PZ?.object3d;
  const list = PZ?.propertyList?.prototype;
  if (!base || !list || list.__zoidiumObject3DEnabled) return;

  const addAll = list.addAll;
  // Wrappers are own properties of each instance. Callers may run a method on
  // a receiver that inherits from a wrapped instance (Camera+ updates groups
  // through Object.create(group)); resolve past every wrapper to the type's
  // own method, or the wrapper would call itself until the stack overflows.
  const wrappers = new WeakSet();
  function inherited(self, name) {
    let owner = Object.getPrototypeOf(self);
    let method = owner && owner[name];
    while (method && wrappers.has(method)) {
      while (owner && !Object.prototype.hasOwnProperty.call(owner, name)) owner = Object.getPrototypeOf(owner);
      owner = owner && Object.getPrototypeOf(owner);
      method = owner && owner[name];
    }
    return method;
  }
  function wrap(object, name, method) {
    wrappers.add(method);
    object[name] = method;
  }

  // Cast shadows: one static "Cast shadows" row per shadow-capable light.
  //
  // A shadow-casting point light renders the six faces of a cube map every
  // frame, so the row lets a user turn shadows off for a light that does not
  // need them. The row is a plain 0/1 value with no keyframes: playback never
  // toggles it, and changing it recompiles lit materials once for the new
  // combination. The default is today's behaviour for the light type, so a
  // project saved before this row existed loads with the same look.
  const CAST_SHADOWS = "zoidiumCastShadows";
  const CAST_SHADOWS_CONTROL = "core/cast-shadows";
  const SUITE_PREFIX = "zoidium:trapcode-suite/";

  // 1 for a light that casts shadows today, 0 for a suite light that renders
  // without them (Area, IES and Portal), and null for a light that cannot cast
  // any (both Hemisphere lights and unknown types).
  function shadowDefault(object) {
    const type = object && object.objectType;
    if (typeof type !== "number") return null;
    const suite = typeof object.type === "string" && object.type.indexOf(SUITE_PREFIX) === 0;
    if (suite) {
      if (type === 1 || type === 2 || type === 3 || type === 7) return 1;
      if (type === 4 || type === 6 || type === 8) return 0;
      return null;
    }
    if (type === 1 || type === 2 || type === 3) return 1;
    return null;
  }

  // The suite's Area fallback is a point root with nine spot samples; only one
  // sample may carry a shadow map. The suite moves a request on the root to
  // the centre sample on its next update, so clearing the samples first turns
  // a previous request off immediately.
  function applyCastShadows(object, on) {
    const light = object && object.threeObj;
    if (!light) return;
    if (light.areaSamples && light.areaSamples.length) {
      for (let i = 0; i < light.areaSamples.length; i++) light.areaSamples[i].castShadow = false;
    }
    // A suite light that did not cast at install (IES) still has three.js's
    // untuned shadow defaults; the suite's own setup gives it the same map
    // size and camera range as every other suite caster.
    const suite = typeof object.type === "string" && object.type.indexOf(SUITE_PREFIX) === 0;
    const lights = PZ && PZ.trapcode && PZ.trapcode.lights;
    if (on && suite && light.shadow && light.shadow.camera && lights && typeof lights.setupShadows === "function") {
      lights.setupShadows(light, true);
      return;
    }
    light.castShadow = !!on;
  }

  function createCastShadowsRow(property, context) {
    const doc = context && context.document;
    if (!doc) return null;
    const row = doc.createElement("div");
    row.classList.add("editbox");
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.className = "pz-inputbox";
    box.setAttribute("aria-label", property.definition.name || "Cast shadows");
    box.checked = property.get() === 1;
    box.onchange = function () {
      const value = box.checked ? 1 : 0;
      if (value === property.get()) return;
      const controls = row.closest && row.closest("ul") ? row.closest("ul").pz_controls : null;
      if (!controls || !PZ.ui || !PZ.ui.controls) {
        property.set(value);
        return;
      }
      PZ.ui.controls.editStart.call(box, property);
      property.set(value);
      PZ.ui.controls.editFinish.call(box, property);
    };
    // CM3 binds this to the row's property and calls it before every refresh.
    row.pz_update = function () {
      const value = property.get() === 1;
      if (doc.activeElement !== box) box.checked = value;
    };
    row.appendChild(box);
    return row;
  }

  // The shared control registry loads after this pre-init script, so the
  // checkbox registers on the first light that needs a row. Until then the
  // definition still renders as a native option row.
  let controlReady = false;
  function ensureCastShadowsControl() {
    if (controlReady) return;
    const apis = global.ZoidiumPluginApis;
    const controls = apis && apis.propertyControls;
    if (!controls || typeof controls.register !== "function") return;
    controlReady = true;
    controls.register(CAST_SHADOWS_CONTROL, {
      type: PZ.property.type.OPTION,
      create: createCastShadowsRow,
    });
  }

  // Rows attach through addAll, before the light loads its saved properties,
  // so CM3's own properties.load() writes the saved value. A light that never
  // had the row keeps the type default.
  function attachCastShadows(properties, object) {
    if (!properties || properties[CAST_SHADOWS]) return;
    const fallback = shadowDefault(object);
    if (fallback === null) return;
    ensureCastShadowsControl();
    addAll.call(properties, {
      [CAST_SHADOWS]: {
        name: "Cast shadows",
        type: PZ.property.type.OPTION,
        value: fallback,
        items: "off;on",
        zoidiumControl: CAST_SHADOWS_CONTROL,
        changed: function () {
          applyCastShadows(this.parentObject, this.get() === 1);
        },
      },
    });
  }

  // Three.js r91 compiles a lit program for every visible light count, so
  // hiding a light recompiles every lit material. A disabled light keeps its
  // place in the scene graph instead: every light in its subtree stays
  // visible with zero intensity, which contributes exactly nothing, and its
  // non-light children (targets, gizmos) hide as they did before.
  // `castShadow` is not touched because it also selects a program variant.
  // Muted lights carry `zoidiumMuted` so models that walk the scene, such as
  // the Trapcode shading model, treat a disabled light as absent rather than
  // as a zero-intensity light.
  function treeState(root) {
    const entries = [];
    const walk = node => {
      entries.push({ node, visible: node.visible !== false, intensity: node.intensity });
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) walk(children[i]);
    };
    walk(root);
    return entries;
  }
  function restoreMute(mute) {
    for (const entry of mute.entries) {
      const node = entry.node;
      node.visible = entry.visible;
      if (node.isLight) {
        if (typeof entry.intensity === "number") node.intensity = entry.intensity;
        delete node.zoidiumMuted;
      }
    }
  }
  function forgetMute(object) {
    const mute = object && object.zoidiumLightMute;
    if (!mute) return null;
    delete object.zoidiumLightMute;
    return mute;
  }
  // True only when the record belonged to the object's current threeObj. A
  // record for a tree an object-type swap replaced is forgotten without
  // restoring it: that tree stays as the disable left it, and the caller
  // restores the current object instead.
  function unmuteLight(object) {
    const mute = forgetMute(object);
    if (!mute || mute.root !== (object && object.threeObj)) return false;
    restoreMute(mute);
    return true;
  }
  // Returns false for anything that is not a light, so the caller keeps the
  // old `visible = false` behaviour for every other object type.
  function muteLight(object) {
    const root = object && object.threeObj;
    if (!root || root.isLight !== true) {
      // A light -> non-light type swap leaves a record for a discarded tree.
      forgetMute(object);
      return false;
    }
    let mute = object.zoidiumLightMute;
    if (mute && mute.root !== root) {
      // A light -> light type swap installs a fresh tree.
      forgetMute(object);
      mute = null;
    }
    if (!mute) mute = object.zoidiumLightMute = { root, entries: treeState(root) };
    for (const entry of mute.entries) {
      const node = entry.node;
      if (node.isLight) {
        node.visible = true;
        if (typeof entry.intensity === "number" && typeof node.intensity === "number") {
          node.intensity = 0;
          node.zoidiumMuted = true;
        }
      } else {
        node.visible = false;
      }
    }
    return true;
  }

  list.addAll = function (definitions) {
    const result = addAll.apply(this, arguments);
    const object = this.parent || this.parentObject;
    if (base.light && object instanceof base.light) attachCastShadows(this, object);
    if (definitions !== base.propertyDefinitions || !(object instanceof base) ||
        object instanceof base.camera ||
        object.constructor.name === "CameraPlus" || object.type === "zoidium:camera-plus/camera") return result;

    this.add("enabled", Object.assign({}, base.group.propertyDefinitions.enabled));
    const ready = object.zoidiumFrameReady;
    // A camera inside a hidden group can still be the scene's active camera.
    function containsCamera(parent) {
      return Array.from(parent.objects || []).some(child =>
        child instanceof base.camera || child.type === "zoidium:camera-plus/camera" || containsCamera(child));
    }
    function mustUpdateGroup(target) {
      return target instanceof base.group && containsCamera(target);
    }
    let hidden = false;
    // Frame readiness walks child lists; a skipped subtree has no pending work.
    object.zoidiumSkipsWork = function (frame) {
      return this.properties.enabled.get(frame) !== 1 && !mustUpdateGroup(this);
    };
    wrap(object, "update", function (frame) {
      const enabled = this.properties.enabled.get(frame) === 1;
      if (!enabled && !mustUpdateGroup(this)) {
        if (!muteLight(this)) {
          if (this.threeObj) this.threeObj.visible = false;
          hidden = true;
        }
        return;
      }
      // A prepare of a disabled frame can mute the light, so the restore does
      // not depend on the flag update used before.
      if (!unmuteLight(this) && hidden && this.threeObj) this.threeObj.visible = true;
      hidden = false;
      return inherited(this, "update").apply(this, arguments);
    });
    wrap(object, "prepare", function (frame) {
      if (this.properties.enabled.get(frame) !== 1 && !mustUpdateGroup(this)) {
        // An object-type swap can install a fresh, visible threeObj.
        if (!muteLight(this) && this.threeObj) this.threeObj.visible = false;
        return Promise.resolve();
      }
      return inherited(this, "prepare").apply(this, arguments);
    });
    if (typeof ready === "function") wrap(object, "zoidiumFrameReady", function (frame) {
      if (this.properties.enabled.get(frame) !== 1 && !mustUpdateGroup(this)) return true;
      return inherited(this, "zoidiumFrameReady").apply(this, arguments);
    });
    return result;
  };
  list.__zoidiumObject3DEnabled = true;
})(window);
