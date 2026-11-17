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
  // Restores and forgets a record, including one whose tree an object-type
  // swap has already discarded.
  function dropMute(object) {
    const mute = object && object.zoidiumLightMute;
    if (!mute) return null;
    delete object.zoidiumLightMute;
    restoreMute(mute);
    return mute;
  }
  // True only when the record belonged to the object's current threeObj. The
  // caller then restores the current tree itself after a swap.
  function unmuteLight(object) {
    const mute = dropMute(object);
    return !!mute && mute.root === (object && object.threeObj);
  }
  // Returns false for anything that is not a light, so the caller keeps the
  // old `visible = false` behaviour for every other object type.
  function muteLight(object) {
    const root = object && object.threeObj;
    if (!root || root.isLight !== true) {
      // A light -> non-light type swap leaves a record for a discarded tree.
      dropMute(object);
      return false;
    }
    let mute = object.zoidiumLightMute;
    if (mute && mute.root !== root) {
      // A light -> light type swap installs a fresh tree; restore the old one
      // before recording the new one.
      dropMute(object);
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
    const object = this.parent;
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
