"use strict";

function ancestor(object, Type) {
  if (typeof Type !== "function") return null;
  try { return object?.tryGetParentOfType?.(Type) || null; }
  catch (_error) { return null; }
}

function sequenceScenes(scene, PZ) {
  const sequence = ancestor(scene, PZ.sequence);
  const scenes = [];
  function visit(layer, clip, track, path) {
    if (!layer) return;
    if (layer instanceof PZ.layer.scene) scenes.push({ scene: layer, clip, track, path });
    else if (!(layer instanceof PZ.object3d)) {
      for (const child of layer.objects || []) visit(child, clip, track, path);
    }
  }
  for (const [index, track] of Array.from(sequence?.videoTracks || []).entries()) {
    for (const clip of track.clips || []) visit(clip.object, clip, track, `V${index + 1}`);
  }
  return scenes.some(entry => entry.scene === scene) ? scenes : [{ scene, clip: ancestor(scene, PZ.clip), path: "Scene" }];
}

function outputFrame(scene, frame, PZ, sampleOffset = 0) {
  const temporal = PZ.zoidium?.temporal;
  const context = temporal?.contexts?.[temporal.contexts.length - 1];
  const sequence = ancestor(scene, PZ.sequence);
  if (context?.renderingSequence && context.compositor?._sequence === sequence && Number.isFinite(context.outputFrame)) {
    return context.outputFrame + sampleOffset;
  }
  return (ancestor(scene, PZ.clip)?.start || 0) + frame;
}

function sceneFrame(entry, absolute, PZ) {
  if (!entry.clip) return absolute;
  let local = absolute - entry.clip.start;
  // An inactive driver holds its nearest endpoint, independent of seek history.
  if (local < 0) local = 0;
  else if (local >= entry.clip.length) local = Math.max(0, entry.clip.length - 1);
  return PZ.zoidium?.temporal?.mapLayerFrame?.(entry.scene, local)?.sourceFrame ?? local;
}

module.exports = { ancestor, sequenceScenes, outputFrame, sceneFrame };
