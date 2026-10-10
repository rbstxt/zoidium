// Camera layers and deterministic shared-camera tracking. Based on Davidium's
// camera-layer.js and sequence-tracking.js; no render-history buffers are used.
parts.sharedShutterOffset = function (sample, count, shutter, direction) {
  if (count <= 1) return 0;
  const start = direction === 1 ? -shutter : direction === 2 ? 0 : -.5 * shutter;
  return start + sample / count * shutter;
};
parts.shared = function (options) {
  const { PZ, THREE, apis, teardown, patchMethod, migrateCameraData, syncScene, findActiveCamera, nativeCameraObjectOf } = options;
  const TYPE = parts.camera.OBJECT_TYPE;
  class CameraLayer extends PZ.layer.scene {
    load(data) {
      const objects = (data?.objects?.length ? data.objects : [{ type: TYPE }]).map(migrateCameraData);
      super.load(Object.assign({}, data, { effects: data?.effects || [], objects }));
      for (const key of ["position", "scale", "rotation", "rotationX", "rotationY", "depth"]) {
        if (this.properties[key]) this.properties[key].visible = false;
      }
    }
    getCamera(time) {
      function walk(objects) {
        for (const object of objects || []) {
          if (object.properties?.enabled && object.properties.enabled.get(time) !== 1) continue;
          if (object.threeObj && (object.type === 6 || object.type === TYPE && object.isActive())) return object;
          const child = object.objects && walk(object.objects);
          if (child) return child;
        }
        return null;
      }
      return walk(this.objects);
    }
  }
  CameraLayer.prototype.defaultName = "Camera";
  teardown.push(apis.layers.registerType({ id: "camera-plus/camera", type: 9, legacyType: 9, factory: () => new CameraLayer() }));
  teardown.push(apis.timeline.registerTrackField("track3d", { default: false }));
  teardown.push(apis.media.registerPreset({ id: "camera-plus/camera", name: "Camera", icon: "camera", json: {
    assets: [], baseType: "track", data: [{ type: 0, clips: [{ start: 0, length: 180, offset: 0, type: 0, link: null,
      properties: { name: "Camera" }, object: { type: 9, effects: [], objects: [{ type: TYPE, properties: { name: "Camera+" } }] } }] }],
  } }));

  const usageTracks = new Set();
  function trackUsage(track) {
    if (track.track3d && typeof PZ.zoidium?.trackPluginResource === "function") {
      PZ.zoidium.trackPluginResource(track, Object.assign({ id: "camera-plus", name: "Camera+" }, options.plugin, { feature: "track3d", featureName: "3D camera tracking" }));
      usageTracks.add(track);
    } else if (usageTracks.delete(track)) PZ.zoidium.untrackPluginResource(track);
  }
  function releaseTrackUsage() {
    for (const track of usageTracks) PZ.zoidium.untrackPluginResource(track);
    usageTracks.clear();
  }
  teardown.push(releaseTrackUsage);
  function refresh(editor) {
    editor.project.ui.dirty = true;
    apis.timeline.refreshTrackButtons();
  }
  function swapToggle(info) {
    const current = info.track.track3d;
    info.track.track3d = info.value;
    for (const item of info.effects) {
      if (info.value) {
        if (!item.layer.effects.includes(item.effect)) {
          item.effect = PZ.effect.create("transform");
          item.layer.effects.push(item.effect);
          item.effect.loading = item.effect.load(item.data || { type: "transform" });
        }
      } else {
        const index = item.layer.effects.indexOf(item.effect);
        if (index >= 0) {
          item.data = typeof item.effect.toJSON === "function" ? JSON.parse(JSON.stringify(item.effect)) : { type: "transform" };
          trackedMaterials.delete(item.effect.pass?.quad?.material);
          item.effect.unload();
          item.layer.effects.splice(index, 1);
        }
      }
    }
    trackUsage(info.track);
    info.editor.history.pushCommand(swapToggle, Object.assign({}, info, { value: current }));
    refresh(info.editor);
  }
  teardown.push(apis.timeline.registerTrackButton({ id: "camera-plus/3d", label: "3D", kinds: ["video"],
    title: track => track.track3d ? "3D tracking on: follow the shared camera" : "3D tracking off: enable to follow the shared camera",
    isActive: track => track.track3d,
    onToggle(track, editor) {
      const effects = [];
      editor.history.startOperation();
      try {
        if (!track.track3d) for (const clip of track.clips) {
          const layer = clip.object;
          if (!layer || layer instanceof PZ.layer.scene || layer instanceof PZ.layer.adjustment) continue;
          if (!layer.effects.some(effect => effect.type === "transform")) effects.push({ layer, effect: null, data: { type: "transform" } });
        }
        swapToggle({ track, editor, value: !track.track3d, effects });
      } finally { editor.history.finishOperation(); }
    },
  }));

  const depthDefinitions = {
    motionBlurAmount: { dynamic: true, name: "Motion Blur", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1, step: .01, decimals: 2 },
    depth: { dynamic: true, name: "Depth", type: PZ.property.type.NUMBER, value: 0, min: -1000, max: 1000, step: 1 },
    rotationX: { dynamic: true, name: "Rotation X (3D)", type: PZ.property.type.NUMBER, value: 0, scaleFactor: Math.PI / 180, step: 3, decimals: 1 },
    rotationY: { dynamic: true, name: "Rotation Y (3D)", type: PZ.property.type.NUMBER, value: 0, scaleFactor: Math.PI / 180, step: 3, decimals: 1 },
  };
  const touched = new Set();
  const trackedMaterials = new Map();
  function ensureDepth(layer, data, loading) {
    let saved = data?.properties;
    if (!saved && !loading && Object.keys(depthDefinitions).some(key => !layer.properties[key]) && typeof layer.toJSON === "function") {
      // Read only the property payload. A Text/Shape layer may not yet have
      // the geometry needed to serialize its full object during load.
      try {
        const properties = layer.toJSON().properties;
        saved = typeof properties?.toJSON === "function" ? properties.toJSON() : properties;
      } catch (_error) { /* native loading will provide the authored values */ }
    }
    for (const [key, definition] of Object.entries(depthDefinitions)) {
      if (!layer.properties[key]) {
        layer.properties.add(key, PZ.property.create(Object.assign({}, definition)));
        if (!loading) layer.properties[key].load(saved?.[key]);
      }
      if (!loading && layer.properties[key].keyframes?.length === 0) layer.properties[key].load(saved?.[key]?.keyframes?.length === 0 ? undefined : saved?.[key]);
      layer.properties[key].visible = !(layer instanceof CameraLayer);
    }
    touched.add(layer);
  }
  const layerProto = PZ.layer.prototype;
  const originalLoad = layerProto.load;
  patchMethod(layerProto, "load", function (data) {
    ensureDepth(this, data, true);
    return originalLoad.apply(this, arguments);
  }, teardown);
  function restoreMaterialSides(layer) {
    for (const effect of layer.effects) {
      const material = effect.pass?.quad?.material;
      if (!trackedMaterials.has(material)) continue;
      if (material.side === THREE.DoubleSide) {
        material.side = trackedMaterials.get(material);
        material.needsUpdate = true;
      }
      trackedMaterials.delete(material);
    }
  }
  const originalUpdate = layerProto.update;
  patchMethod(layerProto, "update", function (time) {
    ensureDepth(this);
    this.__cameraPlusTime = time;
    // Native CM3 resets only Z rotation; reset X/Y left by a previous 3D draw.
    if (this.composite?.group) {
      this.composite.group.rotation.x = 0;
      this.composite.group.rotation.y = 0;
    }
    const result = originalUpdate.apply(this, arguments);
    if (!ownerTrack(this)?.track3d) restoreMaterialSides(this);
    return result;
  }, teardown);
  const originalUnload = layerProto.unload;
  patchMethod(layerProto, "unload", function () {
    touched.delete(this);
    for (const effect of this.effects) trackedMaterials.delete(effect.pass?.quad?.material);
    return originalUnload.apply(this, arguments);
  }, teardown);
  teardown.push(() => { for (const [material, side] of trackedMaterials) { if (material.side === THREE.DoubleSide) { material.side = side; material.needsUpdate = true; } } trackedMaterials.clear(); });
  teardown.push(() => { for (const layer of touched) for (const key of Object.keys(depthDefinitions)) layer.properties[key].visible = false; });
  const project = options.getProject();
  if (project?.forEachItemOfType) {
    project.forEachItemOfType(PZ.layer, layer => ensureDepth(layer));
    project.forEachItemOfType(PZ.track, trackUsage);
  }

  function entries(sequence, time) {
    const out = [];
    function walk(layer, track, index, depth, insideCard) {
      if (!layer) return;
      if (layer instanceof PZ.layer.scene) {
        const local = time - (track.getCurrentClip(time)?.start || 0);
        // Explicitly evaluate every candidate at t before scoring. Track/render
        // order and previous pass.camera values never decide the master.
        for (const object of layer.objects) object.update(local);
        layer.threeObj.updateMatrixWorld(true);
        const camera = layer instanceof CameraLayer ? layer.getCamera(local) : findActiveCamera(layer, local) || nativeCameraObjectOf(layer);
        if (camera?.threeObj && !insideCard) out.push({ layer, track, index, depth, camera, local,
          score: [layer instanceof CameraLayer ? 0 : 1, /camera/i.test((layer.properties.name.get() || "") + " " + (track.getCurrentClip(time)?.properties?.name?.get() || "")) ? 0 : 1, depth, index] });
      } else if (layer.objects) {
        const card = insideCard || layer.effects?.some(effect => effect.type === "transform");
        for (const child of layer.objects) walk(child, track, index, depth + 1, card);
      }
    }
    sequence.videoTracks.forEach((track, index) => {
      if (track.enabled !== false) walk(track.getCurrentClip(time)?.object, track, index, 0, false);
    });
    return out;
  }
  function masterAt(sequence, time) {
    const candidates = entries(sequence, time);
    candidates.sort((a, b) => {
      for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
      return 0;
    });
    return candidates[0] || null;
  }
  function ownerTrack(layer) {
    for (let parent = layer.parent, guard = 0; parent && guard < 32; parent = parent.parent, guard++) {
      if (parent instanceof PZ.track.video) return parent;
      if (parent instanceof PZ.layer.composite && parent.effects.some(effect => effect.type === "transform")) return null;
    }
    return null;
  }
  const sequenceDefinitions = {
    motionBlurTrackFrame: { dynamic: true, name: "Track Frame", type: PZ.property.type.OPTION, value: 0, items: "auto;previous;next" },
    motionBlurSensitivity: { dynamic: true, name: "Motion Sensitivity", type: PZ.property.type.NUMBER, value: 100, min: 0, max: 200, step: 1 },
  };
  const sequences = new Set();
  function ensureSequence(sequence, data, loading) {
    for (const [key, definition] of Object.entries(sequenceDefinitions)) {
      if (!sequence.properties[key]) { sequence.properties.add(key, PZ.property.create(Object.assign({}, definition))); if (!loading) sequence.properties[key].load(data?.properties?.[key]); }
      if (!loading && sequence.properties[key].keyframes?.length === 0) sequence.properties[key].load(data?.properties?.[key]?.keyframes?.length === 0 ? undefined : data?.properties?.[key]);
      sequence.properties[key].visible = true;
    }
    sequences.add(sequence);
  }
  if (PZ.sequence.prototype.load) {
    const load = PZ.sequence.prototype.load;
    patchMethod(PZ.sequence.prototype, "load", function (data) { ensureSequence(this, data, true); return load.apply(this, arguments); }, teardown);
  }
  if (project?.sequence) ensureSequence(project.sequence);
  teardown.push(() => { for (const sequence of sequences) for (const key of Object.keys(sequenceDefinitions)) sequence.properties[key].visible = false; });
  const depthPass = parts.sharedDepth({ PZ, THREE, teardown, patchMethod, masterAt, CameraLayer });
  const originalRenderLayer = PZ.compositor.prototype.renderLayer;
  patchMethod(PZ.compositor.prototype, "renderLayer", function (layer) {
    if (layer instanceof CameraLayer) return;
    const track = ownerTrack(layer);
    const time = layer.__cameraPlusTime ?? 0;
    let root = layer;
    while (root.parent && !(root.parent instanceof PZ.track.video) && root.parent.start === undefined) root = root.parent;
    const frame = time + (root.parent?.start || 0);
    const sequence = this._sequence || layer.parentProject?.sequence;
    if (!sequence || !track?.track3d) {
      restoreMaterialSides(layer);
      return originalRenderLayer.apply(this, arguments);
    }
    const master = masterAt(sequence, frame);
    if (!master) {
      restoreMaterialSides(layer);
      return originalRenderLayer.apply(this, arguments);
    }
    if (layer instanceof PZ.layer.scene) {
      syncScene(layer, time, master.camera, master);
    } else if (!(layer instanceof PZ.layer.adjustment)) {
      ensureDepth(layer);
      const world = new THREE.Vector3();
      const rotation = new THREE.Euler();
      master.camera.threeObj.getWorldPosition(world);
      const quaternion = new THREE.Quaternion();
      master.camera.threeObj.getWorldQuaternion(quaternion);
      rotation.setFromQuaternion(quaternion, master.camera.threeObj.rotation.order);
      const position = layer.properties.position.get(time);
      const scale = layer.properties.scale.get(time);
      const depth = layer.properties.depth.get(time);
      const transform = layer.effects.find(effect => effect.type === "transform" && effect.pass?.camera && effect.pass?.quad);
      if (transform) {
        const resolution = layer.properties.resolution.get();
        const unit = Math.max(...resolution) / 80;
        const pass = transform.pass;
        pass.camera.position.set(world.x * unit, world.y * unit, (world.z - 80) * unit);
        pass.camera.rotation.set(rotation.x, rotation.y, rotation.z);
        if (master.camera.threeObj.isPerspectiveCamera && pass.camera.isPerspectiveCamera) {
          pass.camera.fov = master.camera.threeObj.fov;
          pass.camera.updateProjectionMatrix();
        }
        pass.quad.position.set(position[0], position[1], depth * unit + (transform.offsetZ ?? -Math.max(...resolution)));
        pass.quad.rotation.set(layer.properties.rotationX.get(time), layer.properties.rotationY.get(time), layer.properties.rotation.get(time));
        pass.quad.scale.set(scale[0], scale[1], 1);
        if (!trackedMaterials.has(pass.quad.material)) trackedMaterials.set(pass.quad.material, pass.quad.material.side);
        if (pass.quad.material.side !== THREE.DoubleSide) { pass.quad.material.side = THREE.DoubleSide; pass.quad.material.needsUpdate = true; }
        layer.composite.group.position.set(0, 0, 0);
        layer.composite.group.rotation.set(0, 0, 0);
        layer.composite.group.scale.set(1, 1, 1);
      } else {
        const perspective = 80 / Math.max(world.z - depth, 1);
        layer.composite.group.position.set((position[0] - world.x) * perspective, (position[1] - world.y) * perspective, 0);
        layer.composite.group.rotation.set(layer.properties.rotationX.get(time) - rotation.x, layer.properties.rotationY.get(time) - rotation.y, layer.properties.rotation.get(time) - rotation.z);
        layer.composite.group.scale.set(scale[0] * perspective, scale[1] * perspective, 1);
      }
    }
    return originalRenderLayer.apply(this, arguments);
  }, teardown);
  const renderSequence = PZ.compositor.prototype.renderSequence;
  patchMethod(PZ.compositor.prototype, "renderSequence", function (frame) {
    const sequence = this._sequence;
    if (!sequence?.videoTracks?.some(track => track.track3d || track.layer instanceof CameraLayer)) return renderSequence.apply(this, arguments);
    ensureSequence(sequence);
    const properties = sequence.properties;
    const count = properties.motionBlur.get() === 0 ? 1 : Math.max(1, Math.min(128, Math.floor(properties.motionBlurSamples.get(frame))));
    const shutter = properties.motionBlurShutter.get(frame) * properties.motionBlurSensitivity.get(frame) * .01;
    const direction = properties.motionBlurTrackFrame.get(frame);
    this.ratio = this.readBuffer.width / properties.resolution.get()[0];
    this.renderer.clearTarget(this.accumBuffers[0], true, true, true);
    try {
      depthPass.begin(this, frame);
      for (let sample = 0; sample < count; sample++) {
        this.renderer.setClearColor(0, 1); this.clear(0); this.renderer.setClearColor(0, 0);
        for (const track of sequence.videoTracks) {
          const layer = track.layer;
          if (!layer || track.enabled === false || layer instanceof CameraLayer || layer instanceof PZ.layer.composite && !layer.objects.length) continue;
          const local = frame - layer.parent.start;
          const amount = layer.properties.motionBlurAmount?.get(local) ?? 1;
          const offset = parts.sharedShutterOffset(sample, count, shutter, direction) * amount;
          layer.update(local + offset);
          this.renderLayer(layer, 0, false);
        }
        this.mixPass.render(this.renderer, this.accumBuffers[1], this.accumBuffers[0], this.screenBuffers[0], true);
        this.swapAccumBuffers();
      }
      if (!depthPass.finish(this, count)) {
        this.copyPass.uniforms.tDiffuse.value = this.accumBuffers[0].texture;
        this.copyPass.uniforms.opacity.value = 1 / count;
        this.copyPass.render(this.renderer, null, null, true);
      }
    } finally {
      depthPass.end(this);
      this.copyPass.uniforms.opacity.value = 1;
      for (const track of sequence.videoTracks) if (track.layer) track.layer.update(frame - track.layer.parent.start);
    }
  }, teardown);
  return { CameraLayer, masterAt, projectChanged() {
    for (const layer of touched) for (const key of Object.keys(depthDefinitions)) layer.properties[key].visible = false;
    touched.clear();
    releaseTrackUsage();
    for (const [material, side] of trackedMaterials) { if (material.side === THREE.DoubleSide) { material.side = side; material.needsUpdate = true; } }
    trackedMaterials.clear();
    for (const sequence of sequences) for (const key of Object.keys(sequenceDefinitions)) sequence.properties[key].visible = false;
    sequences.clear();
    const next = options.getProject();
    next?.forEachItemOfType?.(PZ.layer, layer => ensureDepth(layer));
    next?.forEachItemOfType?.(PZ.track, trackUsage);
    if (next?.sequence) ensureSequence(next.sequence);
  }, cameraFor(scene, time) {
    const track = ownerTrack(scene);
    if (!track?.track3d) return null;
    let node = scene;
    while (node.parent && node.parent.start === undefined) node = node.parent;
    return masterAt(scene.parentProject.sequence, time + (node.parent?.start || 0))?.camera || null;
  } };
};
