// Suspend native render allocations without unloading authored objects. Native
// unload also changes properties and asset references used by history commands.
function suspend(state, sequence) {
  for (const schedule of [...(sequence.videoSchedules || []), ...(sequence.audioSchedules || [])]) {
    schedule.reset();
    if (schedule.el) {
      schedule.el.pause();
      schedule.el.removeAttribute("src");
      schedule.el.load();
      schedule.playing = false;
    }
  }
  const resources = new Set(), textures = new Set();
  function texture(value) {
    // Render-target textures have no CPU pixels to upload again. Their native
    // owners below regenerate the target contents on each render instead.
    if (!value?.isTexture || !value.image) return;
    resources.add(value);
    textures.add(value);
  }
  function material(value) {
    if (Array.isArray(value)) { value.forEach(material); return; }
    if (!value?.isMaterial) return;
    resources.add(value);
    for (const item of Object.values(value)) texture(item);
  }
  function mesh(value) {
    if (!value) return;
    if (value.geometry) resources.add(value.geometry);
    material(value.material);
  }
  function native(node) {
    if (!node || !Number.isInteger(node.type)) return;
    const layer = PZ.layer && node instanceof PZ.layer && node.type >= 0 && node.type <= 8;
    const object = PZ.object3d && node instanceof PZ.object3d && node.type >= 0 && node.type <= 6;
    if (!layer && !object) return;
    mesh(node.threeObj);
    mesh(node.composite?.quad);
    texture(node.texture);
    // Custom material unload resets reflection. Dispose only its Three object.
    if (["singlecolor", "texture", "video", "custom"].includes(node.material?.type)) {
      material(node.material.threeObj);
    }
    const targets = [node.threeObj?.shadow?.map, node.envMap?.mirrorCubeCamera?.renderTarget,
      node.motionBlur?.velocityBuffer];
    for (const target of targets) if (target?.isWebGLRenderTarget) resources.add(target);
    for (const child of node.objects || []) native(child);
  }
  for (const track of [...state.videoTracks, ...state.audioTracks]) {
    for (const clip of track.clips) native(clip.object);
  }
  for (const resource of resources) resource.dispose();
  state.suspendedTextures = textures;
}

function resume(state) {
  for (const texture of state.suspendedTextures || []) texture.needsUpdate = true;
  state.suspendedTextures = null;
}

module.exports = { suspend, resume };
