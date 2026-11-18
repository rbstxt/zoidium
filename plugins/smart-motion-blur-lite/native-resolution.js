"use strict";

// Keep affected preview compositors at native resolution for their lifetime.
// Preparation and drawing therefore see the same buffers, including across
// asynchronous video decoding. Nothing is temporarily swapped across await.
// Final display scaling remains the compositor's normal copy to the canvas.
module.exports.install = function (effect, PZ) {
  const proto = PZ.compositor?.prototype;
  if (!proto) return { ensure() {}, release() {} };
  const key = "__zoidiumSmbLiteNative";
  let state = proto[key];
  if (!state) {
    state = { effects: new WeakSet(), references: new Set(), roots: new Map(), resizing: new WeakSet(),
      setSize: proto.setSize, renderSequence: proto.renderSequence, unload: proto.unload };
    const contains = layer => {
      const effects = items => Array.from(items || []).some(item =>
        state.effects.has(item) && item.pass?.enabled !== false ||
        item instanceof PZ.effect.group && effects(item.objects));
      return effects(layer?.effects) || Array.from(layer?.objects || []).some(contains);
    };
    state.size = root => {
      if (!root?._sequence || root.__zoidiumRenderSettings) return null;
      const tracks = root._sequence.videoTracks || [];
      const used = tracks.some(track => track.enabled !== false &&
        (contains(track.layer) || Array.from(track.clips || []).some(clip => contains(clip.object))));
      if (!used) return null;
      const size = root._sequence.properties?.resolution?.get();
      if (!Array.isArray(size) || !(size[0] > 0 && size[1] > 0)) return null;
      if (Math.max(...size) > root.renderer.capabilities.maxTextureSize) {
        throw new Error("Smart Motion Blur Lite: project resolution exceeds the GPU texture limit.");
      }
      return size.map(Math.round);
    };
    state.ensure = root => {
      const size = state.size(root);
      if (!size || root.readBuffer?.width === size[0] && root.readBuffer?.height === size[1]) return;
      if (!state.roots.has(root)) state.roots.set(root, [root.readBuffer.width, root.readBuffer.height]);
      state.resizing.add(root);
      try { state.setSize.call(root, ...size); } finally { state.resizing.delete(root); }
    };
    state.sizeHook = function (width, height) {
      const size = state.size(this);
      if (size) {
        state.roots.set(this, [width, height]);
        if (this.readBuffer?.width === size[0] && this.readBuffer?.height === size[1]) return;
      }
      state.resizing.add(this);
      try { return state.setSize.call(this, ...(size || [width, height])); }
      finally { state.resizing.delete(this); }
    };
    state.renderHook = function () {
      state.ensure(this);
      return state.renderSequence.apply(this, arguments);
    };
    state.unloadHook = function () {
      if (!state.resizing.has(this)) state.roots.delete(this);
      return state.unload.apply(this, arguments);
    };
    proto.setSize = state.sizeHook;
    proto.renderSequence = state.renderHook;
    proto.unload = state.unloadHook;
    proto[key] = state;
  }
  state.effects.add(effect);
  const reference = new WeakRef(effect);
  state.references.add(reference);
  return {
    ensure() {
      let sequence;
      try { sequence = effect.parentProject?.sequence; } catch (_error) { return; }
      const roots = PZ.zoidium?.temporal?.compositorsBySequence?.get(sequence);
      for (const root of roots || []) state.ensure(root);
    },
    release() {
      state.effects.delete(effect);
      state.references.delete(reference);
      for (const item of state.references) if (!item.deref()) state.references.delete(item);
      for (const [root, requested] of state.roots) {
        if (state.size(root)) continue;
        state.resizing.add(root);
        try { state.setSize.call(root, ...requested); } finally { state.resizing.delete(root); }
        state.roots.delete(root);
      }
      if (state.references.size) return;
      if (proto.setSize === state.sizeHook) proto.setSize = state.setSize;
      if (proto.renderSequence === state.renderHook) proto.renderSequence = state.renderSequence;
      if (proto.unload === state.unloadHook) proto.unload = state.unload;
      delete proto[key];
    },
  };
};
