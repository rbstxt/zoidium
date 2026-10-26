"use strict";

(function (root) {
  const commonJS = typeof module === "object" && module.exports;
  const S = commonJS ? require("./community-safe-json") : root.ZoidiumCommunityJSON;
  const U = commonJS ? require("./community-ui") : root.ZoidiumCommunityUI;
  const T = commonJS ? require("./community-temporal-pass") : root.ZoidiumCommunityTemporalPass;
  const instances = new Set();
  const projectsWithCommunityData = new WeakSet();
  const EXPORT_ERROR = "Community effect export is unavailable in the developer preview. Remove community effects before exporting video or images.";
  const isCommunity = type => typeof type === "string" && type.startsWith("community-");
  const clone = value => JSON.parse(JSON.stringify(value));
  function status(effect, message) {
    effect._communityError = message || null;
    if (!effect.properties["community-status"]) effect.properties.add("community-status", {
      name: "Community status", readOnly: true, type: root.PZ.property.type.TEXT, value: message || "Ready",
    });
    const property = effect.properties["community-status"];
    // Status is transient host UI state. Native property setters publish
    // project edits, which would invalidate the preparation reporting it.
    property.value = message || "Ready";
  }
  function unavailable(effect, data, message = "Community package is disabled or unavailable. Its data is preserved and this effect renders as identity.") {
    effect._communityOpaque = clone(data || { type: effect.type });
    effect._communityError = message; effect.pass = null;
    if (!effect.properties["community-status"]) effect.properties.add("community-status", {
      name: "Community effect", readOnly: true, type: root.PZ.property.type.TEXT, value: message,
    });
    effect.properties["community-status"].value = `${data?.community?.packageId || typePackage(effect.type)}: ${message}`;
  }
  function typePackage(type) { return type?.match(/^(community-[a-f0-9]{32})/)?.[1] || type; }
  function placeholder(type) {
    return function () {
      const effect = this;
      effect.defaultName = "Unavailable community effect";
      effect.load = data => { unavailable(effect, data); instances.add(effect); };
      effect.toJSON = () => clone(effect._communityOpaque || { type });
      effect.prepare = async () => {};
      effect.update = effect.resize = () => {};
      effect.unload = () => { instances.delete(effect); };
    };
  }
  function contains(value, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    if (isCommunity(value.type)) return true;
    return Object.values(value).some(child => contains(child, seen));
  }
  function assertExport(project, exporter) {
    // Inspection grants no execution authority. Do not impose package byte
    // limits on the rest of a first-party project's serialized data.
    if (project && contains(JSON.parse(JSON.stringify(project)))) {
      if (root.ZoidiumCommunityExport) return root.ZoidiumCommunityExport.check(project, exporter);
      throw new Error(EXPORT_ERROR);
    }
    // An export must also fail if its community records were removed mid-run.
    if (exporter?.__zoidiumCommunityBypass) root.ZoidiumCommunityExport?.check(project, exporter);
  }
  function installGuards(PZ = root.PZ) {
    if (!PZ?.effect?.create) return;
    root.ZoidiumCommunityExport?.install(PZ);
    const projectLoad = PZ.project?.prototype?.load;
    if (projectLoad && !projectLoad.__zoidiumCommunity) {
      const load = function (data) {
        if (contains(data)) projectsWithCommunityData.add(this);
        else projectsWithCommunityData.delete(this);
        return projectLoad.apply(this, arguments);
      };
      load.__zoidiumCommunity = true; PZ.project.prototype.load = load;
    }
    if (!PZ.effect.create.__zoidiumCommunity) {
      const create = PZ.effect.create;
      PZ.effect.create = function (type) {
        if (isCommunity(type) && !PZ.effect.fnList[type]?._zoidiumCommunity) {
          const promise = Promise.resolve(placeholder(type)); promise._zoidiumCommunity = true;
          PZ.effect.fnList[type] = promise;
        }
        const effect = create.apply(this, arguments);
        if (isCommunity(type)) instances.add(effect);
        return effect;
      };
      PZ.effect.create.__zoidiumCommunity = true;
    }
    for (const name of ["renderVideoFrame", "getVideoFrame"]) {
      const original = PZ.export?.prototype?.[name];
      if (!original || original.__zoidiumCommunity) continue;
      const wrapped = function () {
        const project = this.sequence?.parentProject || this.sequence;
        // Opaque missing layers can retain effects without creating instances.
        if (instances.size || projectsWithCommunityData.has(project) || this.__zoidiumCommunityBypass) {
          try { assertExport(project, this); }
          catch (error) { this.failExportFrame?.(error); throw error; }
        }
        return original.apply(this, arguments);
      };
      wrapped.__zoidiumCommunity = true; PZ.export.prototype[name] = wrapped;
    }
  }
  function restoreRenderer(renderer, draw, THREE = root.THREE) {
    const target = renderer.getRenderTarget();
    const gl = renderer.getContext();
    const viewport = new THREE.Vector4().fromArray(gl.getParameter(gl.VIEWPORT));
    const scissor = new THREE.Vector4().fromArray(gl.getParameter(gl.SCISSOR_BOX));
    const scissorTest = gl.isEnabled(gl.SCISSOR_TEST), autoClear = renderer.autoClear;
    const color = renderer.getClearColor().clone(), alpha = renderer.getClearAlpha();
    try { return draw(); }
    finally {
      renderer.setRenderTarget(target);
      // CM3's r91 setViewport/setScissor use top-left logical coordinates.
      // Restore device coordinates through the renderer's GL state cache.
      renderer.getCurrentViewport()?.copy(viewport);
      renderer.state.viewport(viewport); renderer.state.scissor(scissor); renderer.state.setScissorTest(scissorTest);
      renderer.autoClear = autoClear; renderer.setClearColor(color, alpha);
    }
  }
  function makePass(template, gain, THREE = root.THREE, temporal = () => null) {
    if (!["identity-v1", "gain-v1"].includes(template)) S.fail("unsupported host template");
    const material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uvScale: { value: new THREE.Vector2(1, 1) }, gain: { value: 1 } },
      vertexShader: "uniform vec2 uvScale; varying vec2 vUvScaled; void main(){vUvScaled=uv*uvScale;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "uniform sampler2D tDiffuse; uniform float gain; varying vec2 vUvScaled; void main(){vec4 c=texture2D(tDiffuse,vUvScaled);gl_FragColor=" +
        (template === "gain-v1" ? "vec4(c.rgb*gain,c.a)" : "c") + ";}",
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const pass = new THREE.ShaderPass(material);
    const render = pass.render;
    let temporalPass;
    pass.render = function (renderer) {
      // Recheck the exact receipt immediately before drawing. Identity is the
      // only permitted output when the frame or revision no longer matches.
      return restoreRenderer(renderer, () => {
        const plan = temporal();
        if (plan?.samples.length) {
          temporalPass ||= T.create(THREE, template);
          temporalPass.render(renderer, arguments[1], arguments[2], plan, gain());
          return;
        }
        this.uniforms.gain.value = plan ? 1 : gain();
        return render.apply(this, arguments);
      }, THREE);
    };
    let disposed = false;
    pass.release = () => {
      if (disposed) return; disposed = true;
      temporalPass?.release();
      material.dispose(); pass.quad?.geometry?.dispose();
    };
    return pass;
  }
  function loadValues(effect, declaration, data, binding) {
    const values = {};
    S.data(data); S.keys(data, ["type"], ["properties", "community"]);
    if (data.type !== declaration.id) S.fail("community effect type changed");
    if (data.community !== undefined) {
      S.keys(data.community, ["schemaVersion", "packageId", "packageHash", "dataSchema"]);
      if (data.community.schemaVersion !== 1 || data.community.packageId !== binding.packageId ||
          data.community.packageHash !== binding.packageHash || data.community.dataSchema !== declaration.dataSchema) S.fail("community effect requirement changed");
    } else if (data.properties !== undefined) S.fail("community effect requirement missing");
    const properties = data.properties || {};
    S.keys(properties, [], ["name", ...declaration.properties.map(p => U.keyFor(p.key))]);
    if (properties.name !== undefined && (typeof properties.name !== "string" || properties.name.length > 4096)) S.fail("invalid effect name");
    for (const p of declaration.properties) values[p.key] = Object.hasOwn(properties, U.keyFor(p.key)) ? properties[U.keyFor(p.key)] : p.default;
    // No property loader sees a definition, expression, asset, or unknown key.
    for (const p of declaration.properties) {
      const single = { [p.key]: values[p.key] };
      (commonJS ? require("./community-package") : root.ZoidiumCommunityPackage).state(single, declaration.properties);
    }
    for (const p of declaration.properties) effect.properties[U.keyFor(p.key)].set(values[p.key]);
    effect._communitySavedName = properties.name ?? "Community effect";
    effect.properties.name.set("Community effect");
  }
  function serialize(effect, declaration, binding) {
    if (effect._communityOpaque) return clone(effect._communityOpaque);
    const properties = { name: effect._communitySavedName ?? "Community effect" };
    for (const [key, value] of Object.entries(U.read(effect, declaration))) properties[U.keyFor(key)] = value;
    return { type: effect.type, properties, community: { schemaVersion: 1, packageId: binding.packageId,
      packageHash: binding.packageHash, dataSchema: declaration.dataSchema } };
  }
  const api = { instances, EXPORT_ERROR, clone, isCommunity, unavailable, placeholder, contains, assertExport,
    status, installGuards, restoreRenderer, makePass, loadValues, serialize };
  if (commonJS) module.exports = api; else root.ZoidiumCommunityEffectHost = api;
})(globalThis);
