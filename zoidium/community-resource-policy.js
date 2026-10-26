"use strict";

(function (root) {
  const ERROR = "LOCAL_DEPENDENCY_UNAVAILABLE";
  function unavailable(reason) { throw new Error(ERROR + ": " + reason); }
  // These paths update numeric transforms or an already-created shader pass.
  // Everything else needs a separate audit before isolated capture can use it.
  const effects = new Set([1, "timeoffset", "posterizetime"]);
  const objects = new Set([3, 5, 6, 99]); // Light, Group, Camera, Dummy.
  function create({ PZ = root.PZ, check = () => {} } = {}) {
    function assertMedia(media) {
      check();
      if (typeof ISNODE !== "undefined" && ISNODE) unavailable("native media decoding is unsupported");
      if (!media || !(media.file instanceof root.Blob) || media.source !== PZ.asset?.source?.FILE ||
          typeof media.url !== "string" || !media.url.startsWith("blob:")) unavailable("attach the media as a local file");
    }
    function serialized(object) {
      const data = object.toJSON?.();
      if (!data) unavailable("content has no audited saved representation");
      const json = JSON.stringify(data);
      if (/"(?:expression|_zoidiumLayerInput|_zoidiumSourceTrack)":|"track:/.test(json)) unavailable("expressions and layer inputs are unsupported");
      return data;
    }
    function resident(wrapper, field, label) {
      // Reading the shared data does not call the wrapper's lazy getter.
      if (wrapper && !wrapper.data?.[field]) unavailable(label + " is not resident");
    }
    function assertEffect(effect) {
      check();
      if (effect?._community && !effect._communityOpaque) return;
      const data = serialized(effect);
      if (!effects.has(data.type)) unavailable("the effect input path is unsupported");
      if (data.type === 1) {
        if (effect.customProperties?.length || data.customProperties?.length) unavailable("shader resource inputs are unsupported");
        if (!effect.pass) unavailable("the shader pass is not resident");
      }
    }
    function assertObject(object) {
      const data = serialized(object);
      if (!objects.has(data.type) || object.font || object.material) unavailable("the object or font input path is unsupported");
      for (const child of object.objects || []) assertObject(child);
    }
    function assertLayer(layer, seen = new Set()) {
      check();
      if (!layer || seen.has(layer)) unavailable("cyclic or missing layer input");
      seen.add(layer);
      if (layer.nestedTracks && !Array.isArray(layer.nested)) unavailable("the composition is not resident");
      const data = serialized(layer);
      if (![0, 1, 2, 3, 4].includes(data.type)) unavailable("the layer input path is unsupported");
      resident(layer.vertShader, "shader", "the layer vertex shader");
      resident(layer.fragShader, "shader", "the layer blend shader");
      if (layer.image) {
        const image = layer.image.data?.image;
        if (!image || !layer.texture || image.complete === false || !(image.width > 0)) unavailable("the image is not resident");
      }
      for (const effect of layer.effects || []) assertEffect(effect);
      const children = layer.nestedTracks
        ? layer.nested.flatMap(track => Array.from(track.clips || [], clip => clip.object)) : layer.objects || [];
      for (const child of children) {
        if (data.type === 2) assertLayer(child, seen);
        else assertObject(child);
      }
      seen.delete(layer);
    }
    function assertStage(sequence, stage, frame, allTracks = false) {
      check();
      const tracks = sequence?.videoTracks || [];
      const adjustment = stage.layer instanceof (PZ.layer.adjustment || class {});
      const start = allTracks || adjustment ? 0 : stage.trackIndex;
      const end = allTracks ? tracks.length : stage.trackIndex + 1;
      for (let i = start; i < end; i++) {
        if (tracks[i]?.enabled === false) continue;
        const clip = i === stage.trackIndex && !allTracks ? stage.clip : tracks[i]?.getCurrentClip?.(frame);
        if (clip?.object) assertLayer(clip.object);
      }
      // Schedule padding can select an earlier item. Check every potential
      // media binding before a native schedule can assign an element's src.
      for (const schedule of sequence?.videoSchedules || []) {
        for (const item of schedule.items || []) {
          if (item.media) assertMedia(item.media);
        }
      }
    }
    async function prepareEffect(effect, frame, context) {
      assertEffect(effect);
      // Audited native effects already own resident passes. Their ordinary
      // prepare hooks are unnecessary and can contain lazy asset acquisition.
      if (effect._community) await effect.prepare(frame, context);
    }
    return Object.freeze({ check, assertStage, assertLayer, assertEffect, assertMedia, prepareEffect });
  }
  const api = { create, ERROR, unavailable };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZoidiumCommunityResourcePolicy = api;
})(globalThis);
