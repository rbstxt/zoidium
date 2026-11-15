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
        if (this.threeObj) this.threeObj.visible = false;
        hidden = true;
        return;
      }
      if (hidden && this.threeObj) this.threeObj.visible = true;
      hidden = false;
      return inherited(this, "update").apply(this, arguments);
    });
    wrap(object, "prepare", function (frame) {
      if (this.properties.enabled.get(frame) !== 1 && !mustUpdateGroup(this)) {
        // An object-type swap can install a fresh, visible threeObj.
        if (this.threeObj) this.threeObj.visible = false;
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
