"use strict";
let cleanup = null;
function activate(context) {
  if (cleanup) return;
  const PZ = context.PZ || context.window.PZ;
  const THREE = context.window.THREE;
  const previous = PZ.material.fnList.imageplus;
  const factory = Promise.resolve(function () {
    const material = this;
    let asset = null;
    let image = null;
    let generation = 0;
    function clear() {
      generation++;
      if (asset) material.parentProject.assets.unload(asset);
      asset = image = null;
      material.threeObj?.map?.dispose();
      if (material.threeObj) material.threeObj.map = null;
    }
    function loadImage() {
      clear();
      const key = material.properties.texture.get();
      if (!key || !material.threeObj) return;
      asset = material.parentProject.assets.load(key);
      image = new PZ.asset.image(asset);
      material.threeObj.map = image.getTexture(true);
      material.threeObj.needsUpdate = true;
    }
    const type = PZ.property.type;
    const vector = (name, value) => ({ name, type: type.VECTOR2, group: true, dynamic: true, objects: ["U", "V"].map(axis => ({ name: name + "." + axis, type: type.NUMBER, dynamic: true, value, step: 0.1, decimals: 3 })) });
    material.defaultName = "Image+ Material";
    material.properties.addAll({
      texture: { name: "Image", type: type.ASSET, assetType: PZ.asset.type.IMAGE, accept: "image/*", value: null, changed() { if (!material._loading) loadImage(); } },
      transparent: { name: "Transparency", type: type.OPTION, items: "off;on", value: 0, changed() { if (material.threeObj) { material.threeObj.transparent = this.value === 1; material.threeObj.needsUpdate = true; } } },
      opacity: { name: "Opacity", type: type.NUMBER, dynamic: true, value: 1, min: 0, max: 1, step: 0.01 },
      wrap: { name: "Wrap", type: type.OPTION, items: "none;tile;reflect", value: 1 },
      repeat: vector("Repeat", 1), offset: vector("Offset", 0), center: vector("Center", 0),
      rotation: { name: "Rotation", type: type.NUMBER, dynamic: true, value: 0, scaleFactor: Math.PI / 180, step: 0.5 },
      side: { name: "Render side", type: type.OPTION, items: "front;back;both", value: 0 },
    });
    material.load = function (data) {
      this.threeObj = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this._loading = true;
      try { this.properties.load(data?.properties); } finally { this._loading = false; }
      loadImage();
      this.update(0);
      PZ.zoidium?.trackPluginMaterial?.(this, { ...context.plugin, material: "imageplus", materialName: "Image+ Material", compatibility: "incompatible" }, false);
    };
    material.update = function (frame) {
      const p = this.properties, t = this.threeObj;
      if (!t) return;
      t.opacity = Math.max(0, Math.min(1, p.opacity.get(frame)));
      const transparent = p.transparent.get() === 1;
      const side = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide][p.side.get()];
      if (t.transparent !== transparent || t.side !== side) t.needsUpdate = true;
      t.transparent = transparent; t.side = side;
      if (t.map) {
        const wrap = [THREE.ClampToEdgeWrapping, THREE.RepeatWrapping, THREE.MirroredRepeatWrapping][p.wrap.get()];
        if (t.map.wrapS !== wrap) t.map.needsUpdate = true;
        t.map.wrapS = t.map.wrapT = wrap;
        for (const key of ["repeat", "offset", "center"]) t.map[key].set(...p[key].get(frame));
        t.map.rotation = p.rotation.get(frame);
      }
    };
    material.prepare = async function () { const version = generation; await image?.loading; if (version === generation && this.threeObj?.map) this.threeObj.map.needsUpdate = true; };
    material.toJSON = function () { return { type: this.type, properties: this.properties }; };
    material.unload = function () { clear(); this.threeObj?.dispose(); PZ.zoidium?.untrackPluginMaterial?.(this); };
  });
  factory._zoidiumMaterialMode = "native";
  cleanup = () => { if (PZ.material.fnList.imageplus === factory) { if (previous) PZ.material.fnList.imageplus = previous; else delete PZ.material.fnList.imageplus; } cleanup = null; };
  context.lifecycle.onDispose(cleanup);
  PZ.material.fnList.imageplus = factory;
}
module.exports = { activate };
