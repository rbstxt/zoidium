"use strict";

// Keep imported files in CM3's content-addressed project asset list. Retain
// previous assets while the effect lives so native property undo can restore
// their keys after Clear, replacement or a preset selection.
var Looks = Looks || {};
(function (Looks) {
  function create(effect, PZ, THREE) {
    var entries = new Map(), activeKey = null, textures = [], disposed = false;
    function key() {
      var property = effect.properties.lutData;
      return property && property.get() || null;
    }
    function entryFor(value, importedAtlas, retainedAsset) {
      if (!value) return null;
      if (entries.has(value)) {
        var cached = entries.get(value);
        if (importedAtlas) {
          cached.atlas = importedAtlas;
          cached.error = null;
          cached.loading = Promise.resolve();
        }
        return cached;
      }
      var asset = retainedAsset || effect.parentProject.assets.load(value);
      var entry = { asset: asset, atlas: importedAtlas || null, error: null };
      entries.set(value, entry);
      entry.loading = Promise.resolve().then(async function () {
        if (importedAtlas || disposed) return;
        if (!asset || !asset.file) throw new Error("The LUT file is missing from the project. Import it again.");
        if (asset.file.size > Looks.cube.MAX_TEXT_LENGTH) throw new Error("The LUT file is larger than 80 MB.");
        var parsed = Looks.cube.parseCubeLut(await asset.file.text());
        if (!disposed) entry.atlas = Looks.cube.buildAtlas(parsed);
      }).catch(function (error) { entry.error = error.message || "The LUT file could not be read."; });
      return entry;
    }
    function releaseTextures() {
      textures.forEach(function (texture) { texture.dispose(); });
      textures = [];
    }
    function update(frame) {
      if (disposed || !effect.pass) return;
      var value = effect.properties.lutName.get(frame) === Looks.cube.CUSTOM_NAME ? key() : null;
      var entry = value && entries.get(value);
      // An unprepared key starts loading, but prepare() always awaits it before
      // the compositor completes a frame.
      if (value && !entry) entry = entryFor(value);
      var atlas = entry && entry.atlas || null;
      if (activeKey === value && effect._looksCubeAtlas === atlas && effect._looksCubeError === (entry && entry.error)) return;
      activeKey = value;
      releaseTextures();
      effect._looksCubeAtlas = atlas || null;
      effect._looksCubeError = entry && entry.error;
      var u = effect.pass.uniforms;
      if (atlas) {
        textures = atlas.channels.map(function (bytes) {
          var texture = new THREE.DataTexture(bytes, atlas.width, atlas.height, THREE.RGBAFormat);
          texture.magFilter = texture.minFilter = THREE.NearestFilter;
          texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.flipY = false;
          texture.generateMipmaps = false;
          texture.needsUpdate = true;
          return texture;
        });
        u.u_lutConfig.value.set(atlas.size, atlas.cols, atlas.rows);
        u.u_lutDomMin.value.set.apply(u.u_lutDomMin.value, atlas.dmin);
        u.u_lutDomMax.value.set.apply(u.u_lutDomMax.value, atlas.dmax);
      } else u.u_lutConfig.value.set(0, 0, 0);
      ["R", "G", "B"].forEach(function (c, i) { u["u_lutAtlas" + c].value = textures[i] || null; });
    }
    return {
      reload: async function (value, asset) {
        var entry = entries.get(value);
        if (!entry || entry.asset !== asset || disposed) return;
        entries.delete(value);
        // Keep the hold already owned by this effect, including undo entries.
        var next = entryFor(value, null, asset);
        await next.loading;
        activeKey = null;
        update(0);
        if (next.error) throw new Error(next.error);
      },
      prepare: async function (frame) {
        var entry = entryFor(key());
        if (entry) await entry.loading;
        update(frame);
      },
      update: update,
      dispose: function () {
        disposed = true;
        releaseTextures();
        entries.forEach(function (entry) {
          if (entry.asset) effect.parentProject.assets.unload(entry.asset);
        });
        entries.clear();
        effect._looksCubeAtlas = null;
      },
      importFile: async function (file) {
        if (disposed) throw new Error("The effect has been unloaded.");
        if (file.size > Looks.cube.MAX_TEXT_LENGTH) throw new Error("The file is larger than 80 MB and cannot be imported.");
        var atlas = Looks.cube.buildAtlas(Looks.cube.parseCubeLut(await file.text()));
        if (disposed) throw new Error("The effect has been unloaded.");
        var asset = await effect.parentProject.assets.createFromFile(PZ.asset.type.MISC, file);
        if (disposed) {
          effect.parentProject.assets.removeIfUnused(asset);
          throw new Error("The effect has been unloaded.");
        }
        var entry = entryFor(asset.key, atlas);
        // No second parse is needed after import.
        await entry.loading;
        return asset.key;
      },
    };
  }
  Looks.lutAssets = { create: create };
})(Looks);
