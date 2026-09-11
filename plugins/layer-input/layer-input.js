"use strict";

const LayerInput = (() => {
  const MAX_SOURCE_DEPTH = 32;
  const SOURCE_PREFIX = "track:";
  const SOURCE_ID_PREFIX = "track:id:";
  const state = {
    active: false,
    editor: null,
    PZ: null,
    document: null,
    window: null,
    compositorPrototype: null,
    originalRenderSequence: null,
    patchedRenderSequence: null,
    originalUnload: null,
    patchedUnload: null,
    originalListInput: null,
    patchedListInput: null,
    trackPrototype: null,
    originalTrackLoad: null,
    patchedTrackLoad: null,
    originalTrackToJSON: null,
    patchedTrackToJSON: null,
    viewportPrototype: null,
    originalViewportRender: null,
    patchedViewportRender: null,
    shaderPrototype: null,
    originalShaderLoad: null,
    patchedShaderLoad: null,
    originalShaderUpdate: null,
    patchedShaderUpdate: null,
    originalShaderUpdateFragmentShader: null,
    patchedShaderUpdateFragmentShader: null,
    originalShaderUnload: null,
    patchedShaderUnload: null,
    shaderWatchers: new Map(),
    shaderEmptyTexture: null,
    propertyTypeList: null,
    propertyTypeEntry: null,
    propertyTypeEntryAdded: false,
    style: null,
    contextStack: [],
    consumers: new Set(),
    runtimes: new Set(),
    sequence: null,
    editorWatches: [],
    sequenceWatches: [],
    validationTimers: new Map(),
    trackIds: new WeakMap(),
    nextTrackId: 1,
    materialFactory: null,
    api: null,
  };

  function isVideoTrack(value) {
    return Boolean(state.PZ?.track?.video && value instanceof state.PZ.track.video);
  }

  function getParentObject(value) {
    if (!value) return null;
    try {
      return value.parentObject || null;
    } catch (_error) {
      return null;
    }
  }

  function getOwnerTrack(value) {
    let current = value;
    for (let depth = 0; current && depth < 64; depth += 1) {
      if (isVideoTrack(current)) return current;
      const parent = getParentObject(current);
      if (parent === current) return null;
      current = parent;
    }
    return null;
  }

  function getProject(value) {
    try {
      return value?.parentProject || null;
    } catch (_error) {
      return null;
    }
  }

  function readNumericProperty(property, frame, fallback) {
    try {
      const value = property?.get?.(frame);
      return Number.isFinite(Number(value)) ? Number(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function isAttachedTrack(track, project) {
    return isVideoTrack(track) && (!project || getProject(track) === project);
  }

  function hasTrackId(track, id) {
    const project = getProject(track) || state.editor?.project;
    return getProjectTracks(project).some(
      (candidate) => candidate !== track && candidate?._zoidiumLayerInputId === id
    );
  }

  function generateTrackId(track) {
    let id = "";
    do {
      id = `track-${state.nextTrackId}`;
      state.nextTrackId += 1;
    } while (hasTrackId(track, id));
    return id;
  }

  function ensureTrackId(track, requestedId) {
    if (!track || typeof track !== "object") return "";
    let id = track._zoidiumLayerInputId;
    if (typeof requestedId === "string" && requestedId.trim()) id = requestedId.trim();
    if (typeof id !== "string" || !id || hasTrackId(track, id)) id = generateTrackId(track);
    try {
      Object.defineProperty(track, "_zoidiumLayerInputId", {
        configurable: true,
        enumerable: false,
        value: id,
        writable: true,
      });
    } catch (_error) {
      track._zoidiumLayerInputId = id;
    }
    return id;
  }

  function trackToken(track) {
    if (!track || typeof track !== "object") return "";
    let id = state.trackIds.get(track);
    if (!id) {
      id = ensureTrackId(track);
      state.trackIds.set(track, id);
    }
    return `${SOURCE_ID_PREFIX}${id}`;
  }

  function parseTrackToken(value) {
    if (typeof value !== "string" || !value.startsWith(SOURCE_PREFIX)) return null;
    if (value.startsWith(SOURCE_ID_PREFIX)) {
      const id = value.slice(SOURCE_ID_PREFIX.length).trim();
      return id ? { id } : null;
    }
    try {
      const address = JSON.parse(value.slice(SOURCE_PREFIX.length));
      return Array.isArray(address) ? { address } : null;
    } catch (_error) {
      return null;
    }
  }

  function resolveTrackToken(consumer, value) {
    const parsed = parseTrackToken(value);
    if (!parsed) return null;
    const project = getProject(consumer) || state.editor?.project;
    if (!project) return null;
    if (parsed.id) {
      return (
        getProjectTracks(project).find((track) => ensureTrackId(track) === parsed.id) || null
      );
    }
    if (!project.addressLookup) return null;
    try {
      const track = project.addressLookup(parsed.address);
      return isAttachedTrack(track, project) ? track : null;
    } catch (_error) {
      return null;
    }
  }

  function getSourceProperties(consumer) {
    if (!consumer) return [];
    const customProperties = consumer.customProperties;
    if (customProperties && consumer.type === 1) {
      const properties = Array.from(customProperties).filter(
        (property) => property?.definition?._zoidiumLayerSource
      );
      if (properties.length > 0) return properties;
    }
    const property = consumer.properties?.source;
    return property ? [property] : [];
  }

  function getSourceProperty(consumer, sourceProperty) {
    return sourceProperty || getSourceProperties(consumer)[0] || null;
  }

  function getSourceState(consumer, sourceProperty) {
    const property = getSourceProperty(consumer, sourceProperty);
    return property && property !== consumer?.properties?.source ? property : consumer;
  }

  function getConsumerTrack(consumer, sourceProperty) {
    if (!consumer) return null;
    const property = getSourceProperty(consumer, sourceProperty);
    const sourceState = getSourceState(consumer, property);
    const project = getProject(consumer) || state.editor?.project;
    if (isAttachedTrack(sourceState?._zoidiumSourceTrack, project)) {
      return sourceState._zoidiumSourceTrack;
    }
    const track = resolveTrackToken(consumer, property?.get?.());
    if (sourceState) sourceState._zoidiumSourceTrack = track || null;
    if (property?.get?.()) {
      if (sourceState) sourceState._zoidiumSourceError = track ? "" : "missing";
    } else if (sourceState?._zoidiumSourceError !== "cycle" && sourceState) {
      sourceState._zoidiumSourceError = "";
    }
    return track;
  }

  function getSourceError(consumer, sourceProperty) {
    return getSourceState(consumer, sourceProperty)?._zoidiumSourceError || "";
  }

  function getProjectTracks(project) {
    const tracks = project?.sequence?.videoTracks;
    return tracks && typeof tracks.length === "number" ? Array.from(tracks) : [];
  }

  function getConsumerEdges(project, overrideConsumer, overrideTrack, overrideProperty) {
    const edges = new Map();
    for (const consumer of state.consumers) {
      if (getProject(consumer) !== project) continue;
      const owner = getOwnerTrack(consumer);
      if (!owner) continue;
      for (const property of getSourceProperties(consumer)) {
        const target =
          consumer === overrideConsumer && property === overrideProperty
            ? overrideTrack
            : getConsumerTrack(consumer, property);
        if (!target) continue;
        const targets = edges.get(owner) || new Set();
        targets.add(target);
        edges.set(owner, targets);
      }
    }
    if (overrideConsumer && overrideTrack && !getSourceProperties(overrideConsumer).includes(overrideProperty)) {
      const owner = getOwnerTrack(overrideConsumer);
      if (owner) {
        const targets = edges.get(owner) || new Set();
        targets.add(overrideTrack);
        edges.set(owner, targets);
      }
    }
    return edges;
  }

  function canReach(edges, start, target) {
    if (start === target) return true;
    const visited = new Set();
    const pending = [start];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of edges.get(current) || []) {
        if (!visited.has(next)) pending.push(next);
      }
    }
    return false;
  }

  function wouldCreateCycle(consumer, target, sourceProperty) {
    const project = getProject(consumer) || state.editor?.project;
    const owner = getOwnerTrack(consumer);
    if (!project || !owner || !target) return false;
    const property = getSourceProperty(consumer, sourceProperty);
    const edges = getConsumerEdges(project, consumer, target, property);
    return canReach(edges, target, owner);
  }

  function clearSourceProperty(consumer, sourceProperty) {
    const property = getSourceProperty(consumer, sourceProperty);
    const sourceState = getSourceState(consumer, property);
    if (!property || !property.get?.() || sourceState?._zoidiumSourceUpdating) return;
    sourceState._zoidiumSourceUpdating = true;
    try {
      property.set("");
    } finally {
      sourceState._zoidiumSourceUpdating = false;
    }
  }

  function setConsumerSource(consumer, value, options = {}) {
    if (!consumer) return false;
    const property = getSourceProperty(consumer, options.sourceProperty);
    const sourceState = getSourceState(consumer, property);
    const sourceValue = typeof value === "string" ? value : "";
    if (!sourceValue) {
      sourceState._zoidiumSourceTrack = null;
      sourceState._zoidiumSourceError = "";
      return true;
    }

    const target = resolveTrackToken(consumer, sourceValue);
    if (!target) {
      sourceState._zoidiumSourceTrack = null;
      sourceState._zoidiumSourceError = "missing";
      if (options.fromUser && !sourceState._zoidiumSourceUpdating) {
        clearSourceProperty(consumer, property);
        sourceState._zoidiumSourceError = "missing";
      }
      return false;
    }
    if (wouldCreateCycle(consumer, target, property)) {
      sourceState._zoidiumSourceTrack = null;
      sourceState._zoidiumSourceError = "cycle";
      clearSourceProperty(consumer, property);
      sourceState._zoidiumSourceError = "cycle";
      return false;
    }

    sourceState._zoidiumSourceTrack = target;
    sourceState._zoidiumSourceError = "";
    if (property && property.get?.() !== sourceValue && !sourceState._zoidiumSourceUpdating) {
      sourceState._zoidiumSourceUpdating = true;
      try {
        property.set(sourceValue);
      } finally {
        sourceState._zoidiumSourceUpdating = false;
      }
    }
    scheduleValidation(getProject(consumer) || state.editor?.project);
    return true;
  }

  function getCurrentSourceToken(consumer, sourceProperty) {
    const property = getSourceProperty(consumer, sourceProperty);
    const target = getConsumerTrack(consumer, property);
    return target ? trackToken(target) : property?.get?.() || "";
  }

  function getClipLabel(track) {
    const clip = track?.clips?.[0];
    try {
      const value = clip?.properties?.name?.get?.();
      return value ? String(value) : "";
    } catch (_error) {
      return "";
    }
  }

  function getSourceOptions(consumer, sourceProperty) {
    const project = getProject(consumer) || state.editor?.project;
    const owner = getOwnerTrack(consumer);
    const options = [{ value: "", label: "(No source)", disabled: false }];
    for (const [index, track] of getProjectTracks(project).entries()) {
      const clipLabel = getClipLabel(track);
      const suffix = clipLabel ? ` — ${clipLabel}` : "";
      options.push({
        value: trackToken(track),
        label: `Track ${index + 1}${suffix}`,
        disabled: track === owner || wouldCreateCycle(consumer, track, sourceProperty),
      });
    }
    const current = getCurrentSourceToken(consumer, sourceProperty);
    if (current && !options.some((option) => option.value === current)) {
      options.push({ value: current, label: "(Missing source)", disabled: true });
    }
    return options;
  }

  function getSourceStatus(consumer, sourceProperty) {
    switch (getSourceError(consumer, sourceProperty)) {
      case "cycle":
        return "Circular source reference";
      case "missing":
        return "Source track is missing";
      default:
        return "";
    }
  }

  function getConsumerFrame(consumer, context) {
    const localFrame = consumer?._zoidiumLocalFrame;
    const clip = consumer?.tryGetParentOfType?.(state.PZ?.clip);
    if (Number.isFinite(localFrame) && clip && Number.isFinite(clip.start)) {
      return clip.start + localFrame;
    }
    return context?.frame || 0;
  }

  function frameKey(frame) {
    return Number.isFinite(frame) ? Math.round(frame * 1000000) / 1000000 : 0;
  }

  function getRuntime(root) {
    if (!root || typeof root !== "object") return null;
    let runtime = root.__zoidiumLayerInputRuntime;
    if (!runtime) {
      runtime = {
        root,
        cache: new Map(),
        inProgress: new Set(),
        targetPool: new Map(),
        captures: [],
        copyPass: null,
      };
      Object.defineProperty(root, "__zoidiumLayerInputRuntime", {
        configurable: true,
        value: runtime,
        writable: true,
      });
      state.runtimes.add(root);
    }
    return runtime;
  }

  function createCopyPass() {
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(THREE.CopyShader.uniforms),
      vertexShader: THREE.CopyShader.vertexShader,
      fragmentShader: THREE.CopyShader.fragmentShader,
      transparent: true,
    });
    material.premultipliedAlpha = true;
    return new THREE.ShaderPass(material);
  }

  function getCopyPass(runtime) {
    if (!runtime.copyPass) runtime.copyPass = createCopyPass();
    return runtime.copyPass;
  }

  function getSourceTarget(runtime, track, width, height) {
    let target = runtime.targetPool.get(track);
    if (!target) {
      target = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
      });
      target.texture.generateMipmaps = false;
      runtime.targetPool.set(track, target);
    } else if (target.width !== width || target.height !== height) {
      target.setSize(width, height);
    }
    return target;
  }

  function getCaptureCompositor(runtime, depth, width, height, sequence) {
    if (depth > MAX_SOURCE_DEPTH) return null;
    const index = depth - 1;
    let compositor = runtime.captures[index];
    if (!compositor) {
      compositor = new state.PZ.compositor(runtime.root.renderer, width, height);
      runtime.captures[index] = compositor;
    } else if (compositor.readBuffer.width !== width || compositor.readBuffer.height !== height) {
      compositor.setSize(width, height);
    }
    if (compositor._sequence !== sequence) compositor.sequence = sequence;
    compositor.ratio = runtime.root.ratio || width / (sequence.properties.resolution.get()[0] || width);
    return compositor;
  }

  function pushContext(context) {
    state.contextStack.push(context);
  }

  function popContext() {
    state.contextStack.pop();
  }

  function currentContext() {
    return state.contextStack[state.contextStack.length - 1] || null;
  }

  function renderTrackSource(root, track, projectFrame, parentContext) {
    const runtime = getRuntime(root);
    if (!runtime || !root.renderer || !root.readBuffer || !root._sequence) return null;
    if (parentContext.depth >= MAX_SOURCE_DEPTH) return null;

    const width = root.readBuffer.width;
    const height = root.readBuffer.height;
    const key = `${trackToken(track)}|${frameKey(projectFrame)}|${width}x${height}`;
    if (runtime.cache.has(key)) return runtime.cache.get(key);
    if (runtime.inProgress.has(key)) {
      console.warn("[Layer Input] runtime cycle guard blocked", key);
      runtime.cache.set(key, null);
      return null;
    }

    const clip = track.getCurrentClip?.(projectFrame);
    if (!clip?.object) {
      runtime.cache.set(key, null);
      return null;
    }

    const target = getSourceTarget(runtime, track, width, height);
    const capture = getCaptureCompositor(runtime, parentContext.depth + 1, width, height, root._sequence);
    if (!capture) {
      runtime.cache.set(key, null);
      return null;
    }

    const previousClearColor = root.renderer.getClearColor
      ? root.renderer.getClearColor(new THREE.Color())
      : null;
    const previousClearAlpha = root.renderer.getClearAlpha
      ? root.renderer.getClearAlpha()
      : null;
    runtime.inProgress.add(key);
    try {
      root.renderer.setClearColor(0, 0);
      capture.clear(0);
      const context = {
        root,
        compositor: capture,
        frame: projectFrame,
        depth: parentContext.depth + 1,
      };
      pushContext(context);
      try {
        clip.object.update(projectFrame - clip.start);
        capture.renderLayer(clip.object, 0, false);
      } finally {
        popContext();
      }

      const rendered = capture.screenBuffers[0];
      if (!rendered) throw new Error("Source capture produced no render target");
      const copyPass = getCopyPass(runtime);
      copyPass.uniforms.uvScale.value.set(1, 1);
      if (copyPass.uniforms.uvOffset) copyPass.uniforms.uvOffset.value.set(0, 0);
      copyPass.uniforms.opacity.value = 1;
      copyPass.render(root.renderer, target, rendered, true);
      const result = { texture: target.texture, target, track, clip, layer: clip.object };
      runtime.cache.set(key, result);
      return result;
    } catch (error) {
      console.error("[Layer Input] failed to render source track:", error);
      runtime.cache.set(key, null);
      return null;
    } finally {
      if (previousClearColor) {
        root.renderer.setClearColor(
          previousClearColor,
          previousClearAlpha == null ? 1 : previousClearAlpha
        );
      }
      runtime.inProgress.delete(key);
    }
  }

  function resolveConsumer(consumer) {
    const context = currentContext();
    if (!context) return null;
    const track = getConsumerTrack(consumer);
    if (!track) return null;
    const frame = getConsumerFrame(consumer, context);
    return renderTrackSource(context.root, track, frame, context);
  }

  function resolveMaterial(material, localFrame) {
    const context = currentContext();
    if (!context) return null;
    const track = getConsumerTrack(material);
    if (!track) return null;
    const clip = material?.tryGetParentOfType?.(state.PZ?.clip);
    const frame = clip && Number.isFinite(localFrame) ? clip.start + localFrame : context.frame;
    return renderTrackSource(context.root, track, frame, context);
  }

  function resolveShaderSource(shader, sourceProperty, frame) {
    const context = currentContext();
    if (!context) return null;
    const track = getConsumerTrack(shader, sourceProperty);
    if (!track) return null;
    const clip = shader?.tryGetParentOfType?.(state.PZ?.clip);
    const projectFrame = clip && Number.isFinite(frame) ? clip.start + frame : context.frame;
    return renderTrackSource(context.root, track, projectFrame, context);
  }

  function serializeConsumer(consumer) {
    const properties = JSON.parse(JSON.stringify(consumer.properties));
    const track = getConsumerTrack(consumer);
    if (track) properties.source = trackToken(track);
    return { type: consumer.type, properties };
  }

  function registerConsumer(consumer) {
    if (!consumer) return;
    state.consumers.add(consumer);
    for (const property of getSourceProperties(consumer)) {
      if (property?.get?.()) setConsumerSource(consumer, property.get(), { sourceProperty: property });
    }
  }

  function unregisterConsumer(consumer) {
    state.consumers.delete(consumer);
  }

  function validateProject(project) {
    if (!project) return;
    for (const consumer of state.consumers) {
      if (getProject(consumer) !== project) continue;
      for (const property of getSourceProperties(consumer)) {
        const target = getConsumerTrack(consumer, property);
        if (!target) continue;
        if (wouldCreateCycle(consumer, target, property)) {
          const sourceState = getSourceState(consumer, property);
          sourceState._zoidiumSourceTrack = null;
          sourceState._zoidiumSourceError = "cycle";
          clearSourceProperty(consumer, property);
          sourceState._zoidiumSourceError = "cycle";
        }
      }
    }
  }

  function scheduleValidation(project) {
    if (!project || state.validationTimers.has(project)) return;
    const timer = state.window.setTimeout(() => {
      state.validationTimers.delete(project);
      validateProject(project);
    }, 0);
    state.validationTimers.set(project, timer);
  }

  function trackChanged() {
    scheduleValidation(state.editor?.project);
  }

  function clearWatches(watches) {
    for (const [observable, callback] of watches.splice(0)) {
      try {
        observable.unwatch(callback);
      } catch (_error) {
        // Detached observables are harmless during project replacement.
      }
    }
  }

  function attachSequence(sequence) {
    if (state.sequence === sequence) return;
    clearWatches(state.sequenceWatches);
    state.sequence = sequence || null;
    if (!sequence?.ui) return;
    for (const name of [
      "onClipCreated",
      "onClipDeleted",
      "onClipMoved",
      "onTrackCreated",
      "onTrackDeleted",
      "onTrackMoved",
    ]) {
      const observable = sequence.ui[name];
      if (!observable?.watch) continue;
      observable.watch(trackChanged);
      state.sequenceWatches.push([observable, trackChanged]);
    }
    scheduleValidation(getProject(sequence));
  }

  function installEditorWatches() {
    const editor = state.editor;
    if (!editor) return;
    const projectChanged = () => {
      attachSequence(editor.sequence || editor.project?.sequence);
      scheduleValidation(editor.project);
    };
    const sequenceChanged = () => {
      attachSequence(editor.sequence || editor.project?.sequence);
      scheduleValidation(editor.project);
    };
    for (const [observable, callback] of [
      [editor.onProjectChanged, projectChanged],
      [editor.onSequenceChanged, sequenceChanged],
    ]) {
      if (!observable?.watch) continue;
      observable.watch(callback);
      state.editorWatches.push([observable, callback]);
    }
    attachSequence(editor.sequence || editor.project?.sequence);
  }

  function installStyle() {
    const existing = state.document.getElementById("zoidium-layer-input-style");
    if (existing) {
      state.style = existing;
      return;
    }
    const style = state.document.createElement("style");
    style.id = "zoidium-layer-input-style";
    style.textContent = `
      .zoidium-layer-input-source {
        max-width: 240px;
        width: 200px;
      }
      .zoidium-layer-input-source[data-error="cycle"],
      .zoidium-layer-input-source[data-error="missing"] {
        border-color: #a04e4e;
      }
    `;
    state.document.head.appendChild(style);
    state.style = style;
  }

  function installTrackIdentityPatch() {
    const prototype = state.PZ.track?.video?.prototype;
    if (!prototype || prototype.load === state.patchedTrackLoad) return;
    state.trackPrototype = prototype;
    state.originalTrackLoad = prototype.load;
    state.originalTrackToJSON = prototype.toJSON;
    state.patchedTrackLoad = function () {
      const data = arguments[0];
      const result = state.originalTrackLoad.apply(this, arguments);
      ensureTrackId(this, data?._zoidiumLayerInputId);
      scheduleValidation(this.parentProject);
      return result;
    };
    state.patchedTrackToJSON = function () {
      const result = state.originalTrackToJSON.apply(this, arguments);
      result._zoidiumLayerInputId = ensureTrackId(this);
      return result;
    };
    prototype.load = state.patchedTrackLoad;
    prototype.toJSON = state.patchedTrackToJSON;
  }

  function createSourceInput(property) {
    const container = state.document.createElement("div");
    container.classList.add("editbox");
    const select = state.document.createElement("select");
    select.classList.add("pz-inputbox", "zoidium-layer-input-source");
    select.setAttribute("aria-label", property.definition.name || "Source Layer");
    container.appendChild(select);

    let signature = "";
    function refresh(frame) {
      const consumer = property.parentObject;
      const options = getSourceOptions(consumer, property);
      const nextSignature = options
        .map((option) => `${option.value}\u0000${option.label}\u0000${option.disabled}`)
        .join("\u0001");
      if (nextSignature !== signature && state.document.activeElement !== select) {
        signature = nextSignature;
        select.replaceChildren();
        for (const option of options) {
          const element = state.document.createElement("option");
          element.value = option.value;
          element.textContent = option.label;
          element.disabled = Boolean(option.disabled);
          select.appendChild(element);
        }
      }
      const current = getCurrentSourceToken(consumer, property) || property.get(frame) || "";
      if (state.document.activeElement !== select) select.value = current;
      const error = getSourceError(consumer, property);
      select.dataset.error = error;
      select.title = getSourceStatus(consumer, property) || "Select a source track";
    }

    select.onchange = function () {
      const consumer = property.parentObject;
      PZ.ui.controls.editStart.call(this, property);
      const frame = container.pz_frame;
      const value = select.value;
      property.set(value, frame);
      setConsumerSource(consumer, value, { fromUser: true, sourceProperty: property });
      PZ.ui.controls.editFinish.call(this, property);
      refresh(frame);
    };
    container.pz_update = refresh;
    refresh(0);
    return container;
  }

  function installSourceInputPatch() {
    const controls = state.PZ.ui?.controls;
    if (!controls?.generateListInput || controls.generateListInput.__zoidiumLayerInput) return;
    state.originalListInput = controls.generateListInput;
    state.patchedListInput = function (property) {
      if (property?.definition?._zoidiumLayerSource) return createSourceInput(property);
      return state.originalListInput.apply(this, arguments);
    };
    state.patchedListInput.__zoidiumLayerInput = true;
    controls.generateListInput = state.patchedListInput;
  }

  function getShaderSourceProperties(shader) {
    return getSourceProperties(shader).filter(
      (property) => property?.definition?._zoidiumShaderLayerSource
    );
  }

  function getShaderPropertyName(shader, property) {
    const name = property?.properties?.name?.get?.() || property?.definition?.name || "";
    return typeof shader?.fixPropertyName === "function"
      ? shader.fixPropertyName(String(name))
      : String(name).replace(/\s/g, "_");
  }

  function getShaderEmptyTexture() {
    if (!state.shaderEmptyTexture) {
      const texture = new THREE.DataTexture(
        new Uint8Array([0, 0, 0, 0]),
        1,
        1,
        THREE.RGBAFormat
      );
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      state.shaderEmptyTexture = texture;
    }
    return state.shaderEmptyTexture;
  }

  function patchShaderInputUniforms(shader) {
    if (!shader?.pass?.uniforms) return;
    for (const property of getShaderSourceProperties(shader)) {
      const name = getShaderPropertyName(shader, property);
      const uniform = shader.pass.uniforms[name] || { type: "t", value: null };
      uniform.type = "t";
      uniform.value = getShaderEmptyTexture();
      shader.pass.uniforms[name] = uniform;
    }
  }

  // The shader effect turns every static custom property into a
  // material.defines entry, which THREE emits as "#define <name> <value>". A
  // layer source property holds a track token (or an empty string), so the
  // injected define is never valid GLSL. Drop the define before the renderer
  // compiles the material; the uniform created above carries the texture.
  function clearShaderInputDefines(shader) {
    const defines = shader?.pass?.material?.defines;
    if (!defines) return;
    for (const property of getShaderSourceProperties(shader)) {
      const name = getShaderPropertyName(shader, property);
      if (Object.prototype.hasOwnProperty.call(defines, name)) delete defines[name];
    }
  }

  function updateShaderInputUniforms(shader, frame) {
    if (!shader?.pass?.uniforms) return;
    for (const property of getShaderSourceProperties(shader)) {
      const uniform = shader.pass.uniforms[getShaderPropertyName(shader, property)];
      if (!uniform) continue;
      const source = resolveShaderSource(shader, property, frame);
      uniform.value = source?.texture || getShaderEmptyTexture();
    }
  }

  function removeShaderWatcher(shader) {
    const watcher = state.shaderWatchers.get(shader);
    if (!watcher) return;
    try {
      watcher.observable.unwatch(watcher.callback);
    } catch (_error) {
      // Detached shader properties are harmless during project replacement.
    }
    state.shaderWatchers.delete(shader);
  }

  function registerShaderInstance(shader) {
    if (!shader || state.shaderWatchers.has(shader)) {
      if (shader) registerConsumer(shader);
      return;
    }
    const observable = shader.customProperties?.onObjectAdded;
    const callback = (property) => {
      if (!property?.definition?._zoidiumShaderLayerSource) return;
      registerConsumer(shader);
      scheduleValidation(getProject(shader) || state.editor?.project);
    };
    if (observable?.watch) {
      observable.watch(callback);
      state.shaderWatchers.set(shader, { observable, callback });
    }
    registerConsumer(shader);
  }

  function installShaderPropertyType() {
    const propertyTypes = state.PZ.ui.objectTypes.get(state.PZ.property);
    if (!Array.isArray(propertyTypes)) return;
    state.propertyTypeList = propertyTypes;
    const existing = propertyTypes.find(
      (entry) => entry?.type?._zoidiumShaderLayerSource
    );
    if (existing) {
      state.propertyTypeEntry = existing;
      return;
    }
    const type = {
      custom: true,
      type: state.PZ.property.type.LIST,
      value: "",
      items: [{ name: "(No source)", value: "" }],
      _zoidiumLayerSource: true,
      _zoidiumShaderLayerSource: true,
      changed: function () {
        const shader = this.parentObject;
        if (shader?._zoidiumLoading) return;
        state.api?.setSource(shader, this.value || "", { sourceProperty: this });
      },
    };
    const entry = { name: "Layer Input", type };
    const dynamicIndex = propertyTypes.findIndex(
      (item) => item?.category && item.name === "DYNAMIC"
    );
    if (dynamicIndex >= 0) propertyTypes.splice(dynamicIndex, 0, entry);
    else propertyTypes.push(entry);
    state.propertyTypeEntry = entry;
    state.propertyTypeEntryAdded = true;
  }

  function installShaderPatches() {
    const prototype = state.PZ.effect?.shader?.prototype;
    if (!prototype || prototype.update === state.patchedShaderUpdate) return;
    state.shaderPrototype = prototype;
    state.originalShaderLoad = prototype.load;
    state.originalShaderUpdate = prototype.update;
    state.originalShaderUpdateFragmentShader = prototype.updateFragmentShader;
    state.originalShaderUnload = prototype.unload;
    state.patchedShaderLoad = async function () {
      const result = await state.originalShaderLoad.apply(this, arguments);
      registerShaderInstance(this);
      return result;
    };
    state.patchedShaderUpdateFragmentShader = function () {
      const result = state.originalShaderUpdateFragmentShader.apply(this, arguments);
      clearShaderInputDefines(this);
      patchShaderInputUniforms(this);
      return result;
    };
    state.patchedShaderUpdate = function (frame) {
      const result = state.originalShaderUpdate.apply(this, arguments);
      updateShaderInputUniforms(this, frame);
      return result;
    };
    state.patchedShaderUnload = function () {
      removeShaderWatcher(this);
      unregisterConsumer(this);
      return state.originalShaderUnload.apply(this, arguments);
    };
    prototype.load = state.patchedShaderLoad;
    prototype.updateFragmentShader = state.patchedShaderUpdateFragmentShader;
    prototype.update = state.patchedShaderUpdate;
    prototype.unload = state.patchedShaderUnload;

    const project = state.editor?.project;
    project?.traverse?.((object) => {
      if (object instanceof state.PZ.effect.shader) registerShaderInstance(object);
    });
  }

  function createLayerSourceMaterialFactory() {
    const propertyDefinitions = {
      source: {
        name: "Source Layer",
        type: state.PZ.property.type.LIST,
        value: "",
        items: [{ name: "(No source)", value: "" }],
        _zoidiumLayerSource: true,
        changed: function () {
          const material = this.parentObject;
          if (material?._zoidiumLoading) return;
          state.api?.setSource(material, this.value || "");
        },
      },
      opacity: {
        dynamic: !0,
        name: "Opacity",
        type: state.PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.1,
      },
    };

    return function () {
      const material = this;
      material.defaultName = "Layer Source";
      material.__zoidiumLayerInputMaterial = true;
      material._zoidiumLoading = true;
      material.properties.addAll(propertyDefinitions);
      material._zoidiumLoading = false;

      material.load = function (data) {
        material._zoidiumLoading = true;
        material.threeObj = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
        });
        material.properties.load(data && data.properties);
        material._zoidiumLoading = false;
        state.api?.registerConsumer(material);
        state.PZ.zoidium?.trackPluginMaterial?.(
          material,
          {
            id: "layer-input",
            name: "Layer Input",
            version: "1",
            author: "Zoidium",
            material: "layersource",
            materialName: "Layer Source",
            compatibility: "incompatible",
          },
          false
        );
      };
      material.update = function (frame) {
        if (!material.threeObj) return;
        const opacity = readNumericProperty(material.properties.opacity, frame, 1);
        const source = state.api?.resolveMaterial(material, frame) || null;
        const texture = source?.texture || null;
        if (material.threeObj.map !== texture) {
          material.threeObj.map = texture;
          material.threeObj.needsUpdate = true;
        }
        material.threeObj.opacity = source ? opacity : 0;
      };
      material.prepare = async function () {};
      material.toJSON = function () {
        return state.api
          ? state.api.serializeConsumer(material)
          : { type: material.type, properties: material.properties };
      };
      material.unload = function () {
        state.api?.unregisterConsumer(material);
        state.PZ.zoidium?.untrackPluginMaterial?.(material);
        material.threeObj?.dispose?.();
        material.threeObj = null;
      };
    };
  }

  function installLayerSourceMaterial() {
    if (!state.PZ.material?.fnList) return;
    state.materialFactory = Promise.resolve(createLayerSourceMaterialFactory());
    state.materialFactory._zoidiumMaterialMode = "native";
    state.PZ.material.fnList.layersource = state.materialFactory;
  }

  function installCompositorPatch() {
    const prototype = state.PZ.compositor?.prototype;
    if (!prototype || prototype.renderSequence === state.patchedRenderSequence) return;
    state.compositorPrototype = prototype;
    state.originalRenderSequence = prototype.renderSequence;
    state.patchedRenderSequence = function (frame) {
      const runtime = getRuntime(this);
      runtime.cache.clear();
      runtime.inProgress.clear();
      const context = { root: this, compositor: this, frame, depth: 0 };
      pushContext(context);
      try {
        return state.originalRenderSequence.apply(this, arguments);
      } finally {
        popContext();
        runtime.cache.clear();
        runtime.inProgress.clear();
      }
    };
    prototype.renderSequence = state.patchedRenderSequence;

    state.originalUnload = prototype.unload;
    state.patchedUnload = function () {
      disposeRuntime(this);
      const result = state.originalUnload.apply(this, arguments);
      disposeCompositorExtras(this);
      return result;
    };
    prototype.unload = state.patchedUnload;
  }

  function installViewportPatch() {
    const prototype = state.PZ.ui?.viewport?.prototype;
    if (!prototype || prototype._render === state.patchedViewportRender) return;
    state.viewportPrototype = prototype;
    state.originalViewportRender = prototype._render;
    state.patchedViewportRender = function () {
      if (!this.renderMode || !this.compositor) {
        return state.originalViewportRender.apply(this, arguments);
      }
      const runtime = getRuntime(this.compositor);
      runtime.cache.clear();
      runtime.inProgress.clear();
      const frame = this.editor?.playback?.currentFrame || 0;
      const context = { root: this.compositor, compositor: this.compositor, frame, depth: 0 };
      pushContext(context);
      try {
        return state.originalViewportRender.apply(this, arguments);
      } finally {
        popContext();
      }
    };
    prototype._render = state.patchedViewportRender;
  }

  function disposeCompositorExtras(compositor) {
    if (compositor?.accumBuffers) {
      for (const target of compositor.accumBuffers) target?.dispose?.();
    }
    if (compositor?.canvasTexture) {
      compositor.canvasTexture.dispose?.();
      compositor.canvasTexture = null;
    }
  }

  function disposeRuntime(root) {
    const runtime = root?.__zoidiumLayerInputRuntime;
    if (!runtime) return;
    for (const target of runtime.targetPool.values()) target?.dispose?.();
    for (const capture of runtime.captures) {
      if (!capture) continue;
      state.originalUnload?.call(capture);
      disposeCompositorExtras(capture);
    }
    runtime.copyPass?.material?.dispose?.();
    runtime.cache.clear();
    runtime.inProgress.clear();
    runtime.targetPool.clear();
    runtime.captures.length = 0;
    runtime.copyPass = null;
    state.runtimes.delete(root);
    try {
      delete root.__zoidiumLayerInputRuntime;
    } catch (_error) {
      root.__zoidiumLayerInputRuntime = null;
    }
  }

  function restorePatches() {
    if (state.compositorPrototype?.renderSequence === state.patchedRenderSequence) {
      state.compositorPrototype.renderSequence = state.originalRenderSequence;
    }
    if (state.compositorPrototype?.unload === state.patchedUnload) {
      state.compositorPrototype.unload = state.originalUnload;
    }
    if (state.viewportPrototype?._render === state.patchedViewportRender) {
      state.viewportPrototype._render = state.originalViewportRender;
    }
    if (state.PZ.ui?.controls?.generateListInput === state.patchedListInput) {
      state.PZ.ui.controls.generateListInput = state.originalListInput;
    }
    if (state.trackPrototype?.load === state.patchedTrackLoad) {
      state.trackPrototype.load = state.originalTrackLoad;
    }
    if (state.trackPrototype?.toJSON === state.patchedTrackToJSON) {
      state.trackPrototype.toJSON = state.originalTrackToJSON;
    }
    for (const shader of Array.from(state.shaderWatchers.keys())) removeShaderWatcher(shader);
    if (state.shaderPrototype?.load === state.patchedShaderLoad) {
      state.shaderPrototype.load = state.originalShaderLoad;
    }
    if (state.shaderPrototype?.update === state.patchedShaderUpdate) {
      state.shaderPrototype.update = state.originalShaderUpdate;
    }
    if (state.shaderPrototype?.updateFragmentShader === state.patchedShaderUpdateFragmentShader) {
      state.shaderPrototype.updateFragmentShader = state.originalShaderUpdateFragmentShader;
    }
    if (state.shaderPrototype?.unload === state.patchedShaderUnload) {
      state.shaderPrototype.unload = state.originalShaderUnload;
    }
    if (state.propertyTypeEntryAdded && state.propertyTypeList && state.propertyTypeEntry) {
      const index = state.propertyTypeList.indexOf(state.propertyTypeEntry);
      if (index >= 0) state.propertyTypeList.splice(index, 1);
    }
    state.compositorPrototype = null;
    state.originalRenderSequence = null;
    state.patchedRenderSequence = null;
    state.originalUnload = null;
    state.patchedUnload = null;
    state.viewportPrototype = null;
    state.originalViewportRender = null;
    state.patchedViewportRender = null;
    state.originalListInput = null;
    state.patchedListInput = null;
    state.trackPrototype = null;
    state.originalTrackLoad = null;
    state.patchedTrackLoad = null;
    state.originalTrackToJSON = null;
    state.patchedTrackToJSON = null;
    state.shaderPrototype = null;
    state.originalShaderLoad = null;
    state.patchedShaderLoad = null;
    state.originalShaderUpdate = null;
    state.patchedShaderUpdate = null;
    state.originalShaderUpdateFragmentShader = null;
    state.patchedShaderUpdateFragmentShader = null;
    state.originalShaderUnload = null;
    state.patchedShaderUnload = null;
    state.propertyTypeList = null;
    state.propertyTypeEntry = null;
    state.propertyTypeEntryAdded = false;
  }

  function disposeAllRuntimes() {
    for (const root of Array.from(state.runtimes)) disposeRuntime(root);
  }

  function activate(context) {
    if (state.active) return state.api;
    state.active = true;
    state.editor = context.editor;
    state.PZ = context.PZ || context.window?.PZ || window.PZ;
    state.document = context.document || document;
    state.window = context.window || window;
    state.api = {
      registerConsumer,
      unregisterConsumer,
      setSource: setConsumerSource,
      getSourceOptions,
      getSourceStatus,
      getSourceToken: getCurrentSourceToken,
      resolveEffect: resolveConsumer,
      resolveMaterial,
      serializeConsumer,
      validateProject,
      isInUse: () =>
        Array.from(state.consumers).some(
          (consumer) => getProject(consumer) === state.editor?.project
        ),
    };
    state.PZ.layerInput = state.api;
    installStyle();
    installTrackIdentityPatch();
    installSourceInputPatch();
    installShaderPropertyType();
    installShaderPatches();
    installLayerSourceMaterial();
    installCompositorPatch();
    installViewportPatch();
    installEditorWatches();
    return state.api;
  }

  function deactivate() {
    if (!state.active) return;
    state.active = false;
    clearWatches(state.editorWatches);
    clearWatches(state.sequenceWatches);
    for (const timer of state.validationTimers.values()) state.window.clearTimeout(timer);
    state.validationTimers.clear();
    disposeAllRuntimes();
    restorePatches();
    state.shaderEmptyTexture?.dispose?.();
    state.shaderEmptyTexture = null;
    state.style?.remove();
    for (const consumer of state.consumers) {
      if (consumer?.__zoidiumLayerInputMaterial) {
        state.PZ.zoidium?.untrackPluginMaterial?.(consumer);
      }
    }
    if (state.PZ?.layerInput === state.api) delete state.PZ.layerInput;
    state.consumers.clear();
    state.contextStack.length = 0;
    state.sequence = null;
    state.api = null;
    state.materialFactory = null;
    state.editor = null;
    state.PZ = null;
    state.document = null;
    state.window = null;
    state.style = null;
  }

  return { activate, deactivate };
})();

module.exports = LayerInput;
