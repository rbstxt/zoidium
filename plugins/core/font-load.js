"use strict";

// Native Text preparation awaits loading3d without a rejection handler. A
// failed font therefore resolves to null, with its error kept on shared data.
// Reads have no timeout: an available file may legitimately take time to load.
module.exports = {
  activate(context) {
    const { PZ, window: host } = context;
    const Font = PZ?.asset?.font;
    const Text = PZ?.object3d?.text;
    const THREE = host?.THREE;
    if (!Font?.prototype || !Text?.prototype || !THREE?.TTFLoader || !THREE.Font) return;
    const patches = [];
    const originalGet3DFont = Font.prototype.get3DFont;
    const originalFontGetter = Object.getOwnPropertyDescriptor(Font.prototype, "font3d").get;
    const originalLoadingGetter = Object.getOwnPropertyDescriptor(Font.prototype, "loading3d").get;
    const records = new WeakMap();
    const textRevisions = new WeakMap();
    const pending = new Set();
    const ownedData = new Set();
    const hidden = new Map();
    let disposed = false;

    function patch(target, key, descriptor) {
      const original = Object.getOwnPropertyDescriptor(target, key);
      Object.defineProperty(target, key, { configurable: true, ...descriptor });
      patches.push(() => {
        const current = Object.getOwnPropertyDescriptor(target, key);
        if (current?.value !== descriptor.value || current?.get !== descriptor.get) return;
        if (original) Object.defineProperty(target, key, original);
        else delete target[key];
      });
    }

    function input(asset) {
      // Local blob URLs can be recreated on undo without changing the bytes.
      return [asset.source, asset.file, asset.source === PZ.asset.source.FILE ? asset.sha256 : asset.url];
    }

    function matches(record, asset) {
      const next = input(asset);
      return record.input.every((value, index) => value === next[index]);
    }

    function reset(record) {
      record.cancel?.();
      const data = record.data;
      data.font3d = null;
      data.font3dLoading = null;
      data.zoidiumFont3dError = null;
      data.zoidiumFont3dState = "unloaded";
      // A changed font must not keep its previous family or 2D parse cache.
      data.font2d = null;
      data.font2dLoading = null;
      data.fontFamilyName = "";
    }

    function shared(wrapper) {
      const asset = wrapper.asset;
      let record = records.get(asset);
      if (!record) {
        record = { input: input(asset), data: wrapper.data, cancel: null, warned: false, inherited: wrapper.data.font3dLoading };
        records.set(asset, record);
      } else if (!matches(record, asset)) {
        reset(record);
        record = { input: input(asset), data: record.data, cancel: null, warned: false };
        records.set(asset, record);
      }
      // Multiple Texts and wrappers share the asset's native data object.
      return record;
    }

    function report(wrapper, record, stage, error) {
      const detail = { stage, message: error?.message || String(error) };
      record.data.zoidiumFont3dError = detail;
      record.data.zoidiumFont3dState = "failed";
      if (record.warned) return;
      record.warned = true;
      const name = wrapper.asset.filename || wrapper.asset.key || "Unnamed font";
      try { host.ZoidiumUI?.notify?.({
        title: "Could not load 3D font",
        message: `Font "${name}" (${wrapper.asset.key || "unassigned"}) failed during ${stage}: ${detail.message}. ` +
          "Text using this font will be empty. Choose a valid font file to restore it.",
      }); } catch (_error) { /* Reporting must not interrupt font settlement. */ }
    }

    function read(wrapper) {
      const asset = wrapper.asset;
      if (asset.source !== PZ.asset.source.FILE) return wrapper.readFile();
      if (!asset.file) return Promise.reject(new Error("The project has no attached font file"));
      return new Promise((resolve, reject) => {
        const reader = new host.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("The font file could not be read"));
        reader.onabort = () => reject(new Error("The font file read was canceled"));
        reader.readAsArrayBuffer(asset.file);
      });
    }

    function parse(bytes) {
      let data;
      try {
        data = new THREE.TTFLoader().parse(bytes);
      } catch (_error) {
        data = JSON.parse(new host.TextDecoder().decode(bytes));
      }
      if (!data || typeof data.familyName !== "string" || !data.glyphs ||
          typeof data.glyphs !== "object" || Array.isArray(data.glyphs) ||
          !Number.isFinite(data.resolution) || data.resolution <= 0) {
        throw new Error("The font has no usable glyph table or metrics");
      }
      // Glyphs only need the table and resolution. Line spacing reads the
      // bounds and underline thickness, which older typeface JSON files may
      // omit; CM3 rendered those fonts, so default the metrics instead.
      const bounds = data.boundingBox || {};
      if (!Number.isFinite(bounds.yMin) || !Number.isFinite(bounds.yMax) || !Number.isFinite(data.underlineThickness)) {
        data = Object.assign({}, data, {
          boundingBox: Object.assign({}, bounds, {
            yMin: Number.isFinite(bounds.yMin) ? bounds.yMin : 0,
            yMax: Number.isFinite(bounds.yMax) ? bounds.yMax : data.resolution,
          }),
          underlineThickness: Number.isFinite(data.underlineThickness) ? data.underlineThickness : 0,
        });
      }
      return { font: new THREE.Font(data), family: data.familyName.toLowerCase() };
    }

    function load(wrapper, record) {
      const data = record.data;
      let finish;
      const operation = new Promise((resolve) => { finish = resolve; });
      const current = () => !disposed && records.get(wrapper.asset) === record && matches(record, wrapper.asset);
      const settle = (value) => {
        pending.delete(record);
        record.cancel = null;
        finish(value);
      };
      record.cancel = () => settle(null);
      ownedData.add(new WeakRef(data));
      pending.add(record);
      data.font3dLoading = operation;
      data.zoidiumFont3dState = "loading";
      Promise.resolve().then(() => read(wrapper)).then((bytes) => {
        if (!current()) return settle(null);
        try {
          const result = parse(bytes);
          data.font3d = result.font;
          data.fontFamilyName = result.family;
          data.zoidiumFont3dError = null;
          data.zoidiumFont3dState = "ready";
          settle(result.font);
        } catch (error) {
          report(wrapper, record, "font parse", error);
          settle(null);
        }
      }, (error) => {
        if (current()) report(wrapper, record, "font read", error);
        settle(null);
      });
      return operation;
    }

    function observeInherited(wrapper, record) {
      // A project may have started loading before Core activates. Validate
      // those bytes without canceling or replacing a legitimate native load.
      // Future consumers get a bridge which settles on an actual failure.
      const native = record.inherited;
      record.inherited = null;
      let finish;
      const operation = new Promise((resolve) => { finish = resolve; });
      const current = () => !disposed && records.get(wrapper.asset) === record && matches(record, wrapper.asset);
      const settle = (value) => { pending.delete(record); record.cancel = null; finish(value); };
      record.cancel = () => settle(null);
      pending.add(record);
      ownedData.add(new WeakRef(record.data));
      record.data.font3dLoading = operation;
      record.data.zoidiumFont3dState = "loading";
      const check = Promise.resolve().then(() => read(wrapper)).then((bytes) => {
        try { return parse(bytes); }
        catch (error) { throw { stage: "font parse", error }; }
      }, (error) => { throw { stage: "font read", error }; });
      Promise.all([Promise.resolve(native).catch((error) => { throw { stage: "font read", error }; }), check]).then(([font]) => {
        if (!current()) return settle(null);
        record.data.zoidiumFont3dState = "ready";
        record.data.zoidiumFont3dError = null;
        settle(font);
      }, (failure) => {
        if (current()) {
          record.data.font3d = null;
          report(wrapper, record, failure.stage, failure.error);
        }
        settle(null);
      });
      return operation;
    }

    function get3DFont() {
      if (disposed) return originalGet3DFont.apply(this, arguments);
      const record = shared(this);
      if (record.data.font3d) return Promise.resolve(record.data.font3d);
      if (record.inherited) return observeInherited(this, record);
      if (record.data.font3dLoading) return record.data.font3dLoading;
      return load(this, record);
    }

    function restoreVisibility(text) {
      if (!hidden.has(text)) return;
      if (text.threeObj) text.threeObj.visible = hidden.get(text);
      hidden.delete(text);
    }

    function syncText(text) {
      const wrapper = text.font;
      const record = wrapper && shared(wrapper);
      const font = record?.data.font3d;
      const previous = textRevisions.get(text);
      if (!previous || previous.record !== record || previous.font !== font) {
        text.geometryNeedsUpdate = true;
        if (wrapper && (!previous || previous.record !== record)) text.fontNeedsUpdate = true;
        textRevisions.set(text, { record, font });
      }
      if (font) restoreVisibility(text);
      else if (text.threeObj && !hidden.has(text)) {
        hidden.set(text, text.threeObj.visible);
        text.threeObj.visible = false;
      }
    }

    context.lifecycle.onDispose(() => {
      disposed = true;
      for (const record of Array.from(pending)) {
        record.cancel?.();
        record.data.font3dLoading = null;
        delete record.data.zoidiumFont3dState;
        delete record.data.zoidiumFont3dError;
      }
      for (const reference of ownedData) {
        const data = reference.deref();
        if (!data) continue;
        if (data.zoidiumFont3dState === "failed") data.font3dLoading = null;
        delete data.zoidiumFont3dState;
        delete data.zoidiumFont3dError;
      }
      ownedData.clear();
      for (const text of Array.from(hidden.keys())) restoreVisibility(text);
      for (const restore of patches.reverse()) restore();
    });
    // Native asset property history stores keys, not the font blobs. Retain
    // unloaded font assets with their list, so same-key attachment and native
    // undo/redo can restore bytes after removeIfUnused removes a font.
    const retiredFonts = new WeakMap();
    const assetList = PZ.assetList?.prototype;
    if (assetList?.removeIfUnused && assetList.load) {
      const originalRemove = assetList.removeIfUnused;
      patch(assetList, "removeIfUnused", { writable: true, value: function (asset) {
        if (!disposed && asset?.data?.has(Font) && asset.references <= 0 && asset.mediaReferences <= 0) {
          let retired = retiredFonts.get(this);
          if (!retired) { retired = new Map(); retiredFonts.set(this, retired); }
          retired.set(asset.key, asset);
        }
        return originalRemove.apply(this, arguments);
      } });
      const originalLoad = assetList.load;
      patch(assetList, "load", { writable: true, value: function (key) {
        if (!disposed && typeof key === "string" && !this.list[key]) {
          const asset = retiredFonts.get(this)?.get(key);
          if (asset) {
            if (asset.source === PZ.asset.source.FILE && asset.file) asset.url = host.URL.createObjectURL(asset.file);
            this.list[key] = asset;
            this.onAssetCreated?.update(asset);
          }
        }
        return originalLoad.apply(this, arguments);
      } });
    }
    patch(Font.prototype, "get3DFont", { writable: true, value: get3DFont });
    patch(Font.prototype, "font3d", { get() { return disposed ? originalFontGetter.call(this) : shared(this).data.font3d; } });
    patch(Font.prototype, "loading3d", { get() {
      if (disposed) return originalLoadingGetter.call(this);
      const record = shared(this);
      return record.inherited ? observeInherited(this, record) : record.data.font3dLoading;
    } });
    const originalUpdate = Text.prototype.update;
    patch(Text.prototype, "update", { writable: true, value: function () {
      if (!disposed) syncText(this);
      return originalUpdate.apply(this, arguments);
    } });
    const originalPrepare = Text.prototype.prepare;
    patch(Text.prototype, "prepare", { writable: true, value: function () {
      if (disposed) return originalPrepare.apply(this, arguments);
      syncText(this);
      if (this.font && this.fontNeedsUpdate) {
        this.updateFont();
        this.fontNeedsUpdate = false;
      }
      return originalPrepare.apply(this, arguments);
    } });
    const originalGeometry = Text.prototype.updateGeometry;
    patch(Text.prototype, "updateGeometry", { writable: true, value: function () {
      if (!disposed && !this.font?.font3d && this.threeObj?.geometry) {
        if (this.threeObj.geometry.vertices?.length || this.threeObj.geometry.attributes?.position?.count) {
          this.threeObj.geometry.dispose?.();
          this.threeObj.geometry = new THREE.Geometry();
        }
        return;
      }
      return originalGeometry.apply(this, arguments);
    } });
    const originalUnload = Text.prototype.unload;
    patch(Text.prototype, "unload", { writable: true, value: function () {
      restoreVisibility(this);
      textRevisions.delete(this);
      return originalUnload.apply(this, arguments);
    } });
  },
};
