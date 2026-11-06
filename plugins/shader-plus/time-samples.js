"use strict";
const { kindOf, MAX_TIME_SAMPLES } = require("./kinds.js");
const GUARD = "#ifndef ZOIDIUM_TIME_SAMPLES\n#error Shader+ Time sample requires Shader+ v24 or newer\n#endif\n";
const propertiesOf = effect => Array.from(effect.customProperties || []).filter(p => kindOf(p) === "timeSample");
function readSamples(effect, frame) {
  const properties = propertiesOf(effect);
  if (properties.length > MAX_TIME_SAMPLES) throw new Error("Shader+ supports at most four Time sample properties per effect");
  const rate = Number(effect.parentProject?.sequence?.properties?.rate?.get?.() || 30);
  return properties.map(property => {
    const value = Number(property.get(frame));
    const offset = property.definition.zoidiumShader.units === "seconds" ? value * rate : value;
    if (!Number.isFinite(offset) || !Number.isFinite(Number(frame || 0) + offset)) throw new Error("Shader+ Time sample offsets must be finite numbers");
    return { property, name: effect.fixPropertyName(property.properties.name.get()), offset };
  });
}
function installTimeSamples({ PZ, patch, pipeline, onDispose, editor = () => null }) {
  const proto = PZ.effect.shader.prototype, live = new Map(), unloaded = new WeakSet();
  const temporal = () => PZ.zoidium?.temporal;
  function fail(effect, error) {
    effect.onShaderError?.update(error.message);
    if (effect.pass) effect.pass.enabled = false;
  }
  function release(effect) {
    const entry = live.get(effect);
    if (!entry) return;
    // A property can be removed before its owner is detached. Keep the saved
    // owner for effect deletion, where the host's parent getters can throw.
    temporal()?.releaseFrameSamplerTargets?.(entry.layer, entry.sequence);
  }
  function restoreUnload(effect, entry) {
    if (effect.unload !== entry.unload) return;
    if (entry.ownUnload) Object.defineProperty(effect, "unload", entry.ownUnload);
    else delete effect.unload;
  }
  function detach(effect) {
    const entry = live.get(effect);
    if (!entry) return;
    release(effect);
    if (entry.pass?.render === entry.render) entry.pass.render = entry.original;
    restoreUnload(effect, entry);
    delete effect._zoidiumFrameSampler;
    live.delete(effect);
  }
  function sync(effect) {
    const properties = propertiesOf(effect);
    if (!properties.length) {
      detach(effect);
      return;
    }
    if (!live.has(effect)) {
      let layer, sequence;
      try { layer = effect.parentLayer; sequence = effect.parentProject?.sequence; } catch (_error) { /* Detached authoring facade. */ }
      const entry = { layer, sequence, ownUnload: Object.getOwnPropertyDescriptor(effect, "unload") };
      const originalUnload = effect.unload;
      entry.unload = function unloadTimeSampleOwner() {
        unloaded.add(this); detach(this);
        return originalUnload.apply(this, arguments);
      };
      live.set(effect, entry);
      effect.fragmentShaderNeedsUpdate = true;
      // Core keeps an instance unload wrapper after its first layer update.
      // A new activation must own cleanup even when that wrapper predates it.
      effect.unload = entry.unload;
      effect._zoidiumFrameSampler = {
        getRequest(owner, frame) {
          let samples;
          try { samples = readSamples(owner, frame); }
          catch (error) { fail(owner, error); return { enabled: false, frames: [] }; }
          let layer;
          try { layer = owner.parentLayer; } catch (_error) { /* Detached shader. */ }
          const procedural = Boolean((PZ.layer?.scene && layer instanceof PZ.layer.scene) ||
            (PZ.layer?.adjustment && layer instanceof PZ.layer.adjustment));
          const frames = samples.filter(sample => sample.offset !== 0).map(sample => sample.offset);
          return { enabled: !!owner.properties.enabled.get(frame) && frames.length > 0,
            frames, preserveInputRGB: true, extrapolate: procedural, outputClips: true };
        },
      };
    }
    const entry = live.get(effect), pass = effect.pass;
    try {
      const layer = effect.parentLayer, sequence = effect.parentProject?.sequence;
      if (entry.layer && entry.layer !== layer) release(effect);
      entry.layer = layer; entry.sequence = sequence;
    } catch (_error) { /* A detached effect has no sampler resources. */ }
    if (!pass?.render || entry.pass === pass) return;
    entry.pass = pass; entry.original = pass.render;
    entry.render = function renderTimeSamples(renderer, output, input) {
      const bindings = readSamples(effect, effect._zoidiumFrameSamplerFrame || 0);
      const nonzero = bindings.filter(binding => binding.offset !== 0);
      const samples = nonzero.length ? temporal()?.resolveFrameSamples?.(effect) || [] : [];
      if (samples.length !== nonzero.length) {
        const error = new Error("Shader+ Time sample input is unavailable. Render the frame after temporal preparation completes.");
        fail(effect, error);
        // Never display or export a substituted current or history frame.
        throw error;
      }
      let index = 0;
      for (const binding of bindings) {
        const texture = binding.offset === 0 ? input.texture : samples[index++].texture;
        const uniform = pass.uniforms[binding.name];
        if (uniform) uniform.value = texture;
      }
      return entry.original.apply(this, arguments);
    };
    pass.render = entry.render;
  }
  for (const method of ["propertyAdded", "propertyRemoved"]) patch(proto, method, original => function timeSampleChanged(property) {
    // propertyRemoved runs after native list removal, including settings edits.
    if (method === "propertyRemoved" && kindOf(property) === "timeSample") release(this);
    const result = original.apply(this, arguments);
    sync(this);
    return result;
  });
  patch(proto, "load", original => async function loadTimeSamples(data) {
    unloaded.delete(this);
    const source = data?.properties?.fragShader;
    if (typeof source === "string" && source.startsWith(GUARD)) {
      data = { ...data, properties: { ...data.properties, fragShader: source.slice(GUARD.length) } };
    }
    const result = await original.call(this, data);
    sync(this);
    return result;
  });
  patch(proto, "toJSON", original => function serializeTimeSamples() {
    const data = original.apply(this, arguments);
    if (!propertiesOf(this).length) return data;
    // Native properties serialize to values. Copy before adding the guard so
    // saving never changes the live source, history, or render uniforms.
    const properties = JSON.parse(JSON.stringify(data.properties));
    const source = properties.fragShader;
    properties.fragShader = source.startsWith(GUARD) ? source : GUARD + source;
    return { ...data, properties };
  });
  patch(proto, "prepare", original => async function prepareTimeSamples(frame, context) {
    if (unloaded.has(this)) return;
    sync(this);
    if (this._zoidiumFrameSampler) {
      readSamples(this, frame);
      if (!temporal()?.prepareFrameSamples) throw new Error("Shader+ Time sample requires the temporal sampler");
      await temporal().prepareFrameSamples(this, frame, context);
    }
    return original.apply(this, arguments);
  });
  onDispose(pipeline.register({
    id: "shader-plus-time-samples",
    beforeUpdate(frame) {
      if (unloaded.has(this)) { if (this.pass) this.pass.enabled = false; return false; }
      sync(this);
      if (!this._zoidiumFrameSampler) return;
      this._zoidiumFrameSamplerFrame = frame;
      try { readSamples(this, frame); }
      catch (error) { fail(this, error); return false; }
    },
    declare() {
      const properties = propertiesOf(this);
      if (!properties.length) return;
      this.pass.material.defines.ZOIDIUM_TIME_SAMPLES = 1;
      for (const property of properties) {
        const name = this.fixPropertyName(property.properties.name.get());
        this.pass.uniforms[name] = { type: "t", value: null };
      }
    },
    previewDeclare() {
      if (propertiesOf(this).length) this.pass.material.defines.ZOIDIUM_TIME_SAMPLES = 1;
    },
  }));
  onDispose(() => {
    for (const [effect, entry] of live) {
      release(effect);
      if (entry.pass?.render === entry.render) entry.pass.render = entry.original;
      restoreUnload(effect, entry);
      delete effect._zoidiumFrameSampler;
      effect.fragmentShaderNeedsUpdate = true;
    }
    live.clear();
  });
  editor()?.project?.forEachItemOfType?.(PZ.effect.shader, effect => sync(effect));
}
module.exports = { installTimeSamples, readSamples, propertiesOf, GUARD };
