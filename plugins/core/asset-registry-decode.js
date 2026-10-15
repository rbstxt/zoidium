(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts;
  // Wrapper data is shared by live consumers and private frame-cache clones.
  // Keep that object, and refresh textures already handed to consumers.
  parts.createDecoder = function (PZ, changed) {
    const patches = [], textures = new WeakMap(), operations = new Set(), controllers = new WeakMap();
    const io = parts.fetch;
    let alive = true;
    function patch(target, key, value) {
      if (!target || typeof target[key] !== "function") return;
      const original = target[key];
      target[key] = function () { return alive ? value.apply(this, arguments) : original.apply(this, arguments); };
      const installed = target[key];
      patches.push(() => { if (target[key] === installed) target[key] = original; });
      return original;
    }
    function notify(asset) { if (alive) { io.changed(asset); changed(); } }
    function fail(data, error) { data.zoidiumDecodeError = error?.message || "Asset decoding failed."; return null; }
    function preset(asset) { return asset.source === (PZ.asset.source.PRESET ?? 3); }
    async function read(wrapper, binary = false, signal) {
      const asset = wrapper.asset;
      if (asset.file) return binary ? asset.file.arrayBuffer() : asset.file.text();
      if (!preset(asset) && !asset.external) throw new Error("The file is missing from the project.");
      const bytes = await io.retry(() => io.response(asset, { signal }), { enabled: preset(asset), signal });
      return binary ? bytes : new global.TextDecoder().decode(bytes);
    }
    for (const Type of [PZ.asset.font, PZ.asset.geometry, PZ.asset.shader, PZ.asset.cubelut || PZ.asset.lut]) {
      patch(Type?.prototype, "readFileRemote", function () { return io.response(this.asset).then(bytes => Type === PZ.asset.font ? bytes : new global.TextDecoder().decode(bytes)); });
    }
    patch(PZ.asset.font?.prototype, "getFont", function () {
      const data = this.data, wrapper = this;
      if (data.font2d) return Promise.resolve(data.font2d);
      if (!data.font2dLoading) {
        const operation = read(this, true).then(bytes => {
          if (!alive || data.font2dLoading !== operation) return null;
          const font = global.opentype.parse(bytes);
          if (!font.supported) throw new Error("The font format is not supported.");
          font.familyName = font.getEnglishName("fontFamily").toLowerCase();
          data.font2d = font;
          return font;
        }).catch(error => alive && data.font2dLoading === operation ? fail(data, error) : null).finally(() => notify(wrapper.asset));
        data.font2dLoading = operation;
      }
      return data.font2dLoading;
    });
    const ImageAsset = PZ.asset.image;
    patch(ImageAsset?.prototype, "decodeBrowser", function () {
      const wrapper = this, data = this.data, image = new global.Image();
      const controller = new global.AbortController();
      controllers.get(data)?.abort(); controllers.set(data, controller);
      operations.add(controller);
      data.image = image; data.zoidiumDecodeError = null;
      data.loading = (async () => {
        let url = io.urlOf(wrapper.asset), owned = false;
        try {
          if (wrapper.asset.file instanceof global.Blob) {
            url = global.URL.createObjectURL(wrapper.asset.file); owned = true;
          } else if (preset(wrapper.asset)) {
            const bytes = await io.retry(() => io.response(wrapper.asset, { signal: controller.signal }), { signal: controller.signal });
            url = global.URL.createObjectURL(new global.Blob([bytes])); owned = true;
          }
          if (!url) throw new Error("The image file is missing from the project.");
          await new Promise((resolve, reject) => {
            const finish = fn => { image.onload = image.onerror = null; controller.signal.removeEventListener("abort", abort); fn(); };
            const abort = () => finish(() => reject(new Error("Image loading was canceled.")));
            image.onload = () => finish(resolve);
            image.onerror = () => finish(() => reject(new Error("The image could not be decoded.")));
            controller.signal.addEventListener("abort", abort, { once: true });
            if (controller.signal.aborted) return abort();
            image.src = url;
          });
        } catch (error) { if (alive && data.image === image) fail(data, error); }
        finally { if (owned) global.URL.revokeObjectURL(url); operations.delete(controller); notify(wrapper.asset); }
      })();
    });
    const nativeTexture = patch(ImageAsset?.prototype, "getTexture", function () {
      const texture = nativeTexture.apply(this, arguments);
      let refs = textures.get(this.data);
      if (!refs) textures.set(this.data, refs = new Set());
      const ref = new WeakRef(texture); refs.add(ref);
      texture.addEventListener?.("dispose", () => refs.delete(ref));
      return texture;
    });
    const decoders = [[PZ.asset.geometry, "getGeometry", "geometry", text => new global.THREE.BufferGeometryLoader().parse(JSON.parse(text))],
      [PZ.asset.shader, "getShader", "shader", text => text],
      [PZ.asset.cubelut || PZ.asset.lut, "getLUT", "lut", function (text) { return this.parseCubeLUT(text); }]];
    for (const [Type, method, field, parse] of decoders) patch(Type?.prototype, method, function () {
      const wrapper = this, data = this.data;
      if (data[field]) return Promise.resolve(data[field]);
      if (!data.loading) {
        data.zoidiumDecodeError = null;
        const controller = new global.AbortController();
        controllers.get(data)?.abort(); controllers.set(data, controller); operations.add(controller);
        const operation = read(this, false, controller.signal).then(text => {
          if (!alive || data.loading !== operation) return null;
          const result = parse.call(wrapper, text);
          if (!result) throw new Error("The asset has an invalid format.");
          data[field] = result; return result;
        }).catch(error => alive && data.loading === operation ? fail(data, error) : null).finally(() => { operations.delete(controller); notify(wrapper.asset); });
        data.loading = operation;
      }
      return data.loading;
    });
    async function reload(asset, kind) {
      const jobs = [];
      const Type = { font: PZ.asset.font, image: ImageAsset, geometry: PZ.asset.geometry,
        lut: PZ.asset.cubelut || PZ.asset.lut, shader: PZ.asset.shader }[kind];
      if (Type && !asset.data.has(Type) && !(kind === "geometry" && /\.(obj|stl|ply|gltf|glb)$/i.test(asset.filename || ""))) new Type(asset);
      for (const [Type, data] of asset.data || []) {
        if (!data || typeof data !== "object") continue;
        data.zoidiumDecodeError = null;
        if (Type === PZ.asset.font) {
          const wrapper = new Type(asset);
          const used2d = !!(data.font2d || data.font2dLoading);
          if (typeof wrapper.reset === "function") jobs.push(wrapper.reset());
          else { data.font3d = data.font3dLoading = data.font2d = data.font2dLoading = null; jobs.push(wrapper.get3DFont()); }
          if (used2d) jobs.push(wrapper.getFont());
        } else if (Type === ImageAsset) {
          const wrapper = new Type(asset);
          data.image = null; data.gif = null; data.loading = null;
          wrapper.getImage();
          jobs.push(Promise.resolve(data.loading).then(() => {
            const refs = textures.get(data);
            for (const ref of refs || []) {
              const texture = ref.deref();
              if (!texture) refs.delete(ref);
              else { texture.image = data.image; texture.needsUpdate = true; }
            }
          }));
        } else {
          const decoder = decoders.find(entry => entry[0] === Type);
          if (!decoder) continue;
          data[decoder[2]] = null; data.loading = null;
          jobs.push(new Type(asset)[decoder[1]]());
        }
      }
      notify(asset);
      await Promise.all(jobs);
      notify(asset);
    }
    return { reload, dispose() {
      alive = false; for (const controller of operations) controller.abort(); operations.clear();
      patches.reverse().forEach(fn => fn());
    } };
  };
})(globalThis);
