(function installObject3DEnabled(global) {
  "use strict";
  const PZ = global.PZ;
  const base = PZ?.object3d;
  const list = PZ?.propertyList?.prototype;
  if (!base || !list || list.__zoidiumObject3DEnabled) return;

  const addAll = list.addAll;
  list.addAll = function (definitions) {
    const result = addAll.apply(this, arguments);
    const object = this.parent;
    if (definitions !== base.propertyDefinitions || !(object instanceof base) ||
        object instanceof base.camera ||
        object.constructor.name === "CameraPlus") return result;

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
    object.update = function (frame) {
      const enabled = this.properties.enabled.get(frame) === 1;
      if (!enabled && !mustUpdateGroup(this)) {
        if (this.threeObj) this.threeObj.visible = false;
        hidden = true;
        return;
      }
      if (hidden && this.threeObj) this.threeObj.visible = true;
      hidden = false;
      return Object.getPrototypeOf(this).update.apply(this, arguments);
    };
    object.prepare = function (frame) {
      if (this.properties.enabled.get(frame) !== 1 && !mustUpdateGroup(this)) return Promise.resolve();
      return Object.getPrototypeOf(this).prepare.apply(this, arguments);
    };
    if (typeof ready === "function") object.zoidiumFrameReady = function (frame) {
      if (this.properties.enabled.get(frame) !== 1 && !mustUpdateGroup(this)) return true;
      return Object.getPrototypeOf(this).zoidiumFrameReady.apply(this, arguments);
    };
    return result;
  };
  list.__zoidiumObject3DEnabled = true;
})(window);
