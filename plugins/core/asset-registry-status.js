(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts = global.ZoidiumAssetRegistryParts || {};
  function createStatus(PZ, changed) {
    const promises = new WeakMap(), cleanups = new Map();
    let alive = true;
    function promiseState(promise) {
      if (!promise || typeof promise.then !== "function") return null;
      let record = promises.get(promise);
      if (!record) {
        record = { pending: true, error: null };
        promises.set(promise, record);
        Promise.resolve(promise).then(() => {
          record.pending = false;
          if (alive) changed();
        }, error => {
          record.pending = false;
          record.error = error?.message || "Asset decoding failed.";
          if (alive) changed();
        });
      }
      return record;
    }
    function watchImage(image) {
      if (!image?.addEventListener || cleanups.has(image)) return;
      image.addEventListener("load", changed);
      image.addEventListener("error", changed);
      cleanups.set(image, () => {
        image.removeEventListener("load", changed);
        image.removeEventListener("error", changed);
      });
    }
    function kindOf(asset, hint) {
      const data = asset?.data;
      const types = PZ.asset || {};
      for (const [name, kind] of [["font", "font"], ["image", "image"], ["geometry", "geometry"], ["shader", "shader"], ["lut", "lut"]]) {
        if (types[name] && data?.has?.(types[name])) return kind;
      }
      const file = asset?.filename || asset?.url || "";
      const mime = asset?.file?.type || "";
      if (/^audio\//.test(mime) || /\.(mp3|wav|ogg|flac|aac)(?:$|[?#])/i.test(file)) return "audio";
      if (/^video\//.test(mime) || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(file)) return "video";
      if (/^image\//.test(mime) || /\.(png|jpe?g|gif|webp|svg|bmp)(?:$|[?#])/i.test(file)) return "image";
      if (/\.(ttf|otf|woff2?)(?:$|[?#])/i.test(file) || /\/fonts\//i.test(file)) return "font";
      if (/\.(cube|lut)(?:$|[?#])/i.test(file)) return "lut";
      if (/\.(glsl|vert|frag)(?:$|[?#])/i.test(file)) return "shader";
      // CM3's customGeometry assetType is undefined on some definitions.
      if (/geometry/i.test(hint?.propertyName || "")) return "geometry";
      const t = PZ.asset?.type || {};
      for (const [name, kind] of [["FONT", "font"], ["IMAGE", "image"], ["GEOMETRY", "geometry"], ["SHADER", "shader"]]) {
        if (t[name] !== undefined && hint?.assetType === t[name]) return kind;
      }
      return "file";
    }
    function inspect(asset, hint) {
      const source = asset?.source === (PZ.asset?.source?.PRESET ?? 3)
        ? (/^data:/.test(asset.url || "") ? "plugin" : "preset") : "file";
      const local = asset && (asset.source === (PZ.asset?.source?.FILE ?? 1) || asset.source === (PZ.asset?.source?.ARCHIVE ?? 2));
      const missing = !asset || (local && !asset.external && !asset.file);
      let status = missing ? "missing" : "unknown", error = missing ? "The file is missing from the project." : null;
      const info = {};
      let pending = false, ready = false, failure = null;
      for (const data of asset?.data?.values?.() || []) {
        if (!data || typeof data !== "object") continue;
        for (const key of ["loading", "font2dLoading", "font3dLoading"]) {
          const state = promiseState(data[key]);
          pending ||= !!state?.pending;
          if (state?.error) failure = state.error;
          if (key === "loading" && state && !state.pending && !state.error && "image" in data && !data.image) failure = "The image could not be decoded.";
        }
        if (data.zoidiumFont3dState === "failed") failure = data.zoidiumFont3dError?.message || "The font could not be decoded.";
        const image = data.image;
        watchImage(image);
        if (image) {
          const width = image.naturalWidth ?? image.width, height = image.naturalHeight ?? image.height;
          if (width > 0 && height > 0) { info.width = width; info.height = height; ready = true; }
          if (image.complete === true && !width) failure = "The image could not be decoded.";
        }
        if (data.gif) {
          const state = promiseState(data.loading);
          if (state && !state.pending && !data.gif.frames?.length) failure = "The GIF could not be decoded.";
          if (data.gif.frames?.length) { info.frames = data.gif.frames.length; ready = true; }
        }
        if (data.fontFamilyName || data.font3d?.data?.familyName) info.fontFamily = data.fontFamilyName || data.font3d.data.familyName;
        ready ||= !!(data.font2d || data.font3d || data.geometry || data.lut || data.shader);
      }
      if (Number.isFinite(asset?.length) && asset.length > 0) { info.duration = asset.length; ready = true; }
      const decode = global.ZoidiumVideoDecodeStatus?.get?.(asset);
      if (decode === "failed") failure = "This browser cannot decode the video.";
      if (decode === "loading") pending = true;
      if (decode === "ready") ready = true;
      if (!missing) {
        if (failure) { status = "failed"; error = failure; }
        else status = pending ? "loading" : ready ? "ready" : "unknown";
      }
      return { kind: kindOf(asset, hint), source, status, error, info };
    }
    return { inspect, dispose() {
      alive = false; cleanups.forEach(fn => fn()); cleanups.clear();
      // Promise handlers cannot be detached. Drop their callback's project
      // closure so a native decoder that never settles cannot retain it.
      changed = null;
    },
      prune(images) { for (const [image, cleanup] of cleanups) if (!images.has(image)) { cleanup(); cleanups.delete(image); } } };
  }
  parts.createStatus = createStatus;
})(globalThis);
