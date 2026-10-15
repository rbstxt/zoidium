(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts;
  parts.patchReplacementConsumers = function (PZ) {
    const patches = [], loading = new WeakSet();
    function patch(target, key, wrap) {
      if (!target) return;
      const original = target[key], replacement = wrap(original);
      target[key] = replacement;
      patches.push(() => { if (target[key] === replacement) { if (original === undefined) delete target[key]; else target[key] = original; } });
    }
    // Native clip.media.changed loads again on every edit, including undo,
    // without releasing its previous wrapper. Preserve the clip's timing.
    patch(PZ.clip?.propertyDefinitions?.media, "changed", original => function () {
      const clip = this.parentObject, previous = clip.media;
      const value = original?.apply(this, arguments);
      if (!this.value) clip.media = null;
      if (previous) clip.parentProject.assets.unload(previous);
      return value;
    });
    // Image layers only bind their image in load(). Add the same binding to
    // property changes, while leaving the initial native load alone.
    patch(PZ.layer?.image?.prototype, "load", original => function () {
      loading.add(this);
      try { return original.apply(this, arguments); } finally { loading.delete(this); }
    });
    patch(PZ.layer?.image?.propertyDefinitions?.image, "changed", original => function () {
      const value = original?.apply(this, arguments), layer = this.parentObject;
      if (!layer || loading.has(layer) || !layer.imageProperties) return value;
      const assets = layer.parentProject.assets;
      if (layer.image) assets.unload(layer.image);
      layer.texture?.dispose();
      layer.image = this.value ? new PZ.asset.image(assets.load(this.value)) : null;
      layer.texture = layer.image?.getTexture() || null;
      if (layer.texture) layer.texture.premultiplyAlpha = true;
      return value;
    });
    return () => patches.reverse().forEach(restore => restore());
  };
})(globalThis);
