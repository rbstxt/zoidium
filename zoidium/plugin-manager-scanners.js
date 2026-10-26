// Plugin manager: scanners. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = window.ZoidiumPluginManagerInternals;
  const { NATIVE_FX_PLUGIN_ID, LAYER_INPUT_PLUGIN_ID, TEXT_PLUS_PLUGIN_ID, PARTICLES_PLUS_PLUGIN_ID, TRAPCODE_SUITE_PLUGIN_ID, LAYER_INPUT_SHADER_FEATURE_ID, TEXT_PLUS_SPACING_FEATURE_ID, TEXT_PLUS_BEVEL_FEATURE_ID, LAYER_INPUT_EFFECT_IDS, NATIVE_FX_EFFECTS, PLUGIN_MATERIAL_TYPES, NATIVE_EFFECT_PLUGINS, NUMERIC_OBJECT_TYPES, NUMERIC_LAYER_TYPES, PLUGIN_DEPENDENCY_INFO, pluginStates } = manager;

  // BEGIN manager body 1980
  function normalizeProjectPlugins(plugins) {
    if (!Array.isArray(plugins)) return [];
    const normalized = new Map();
    for (const plugin of plugins) {
      const descriptor =
        typeof plugin === "string"
          ? { id: plugin }
          : plugin && typeof plugin === "object"
            ? plugin
            : null;
      if (!descriptor || typeof descriptor.id !== "string" || !descriptor.id) {
        continue;
      }
      let entry = normalized.get(descriptor.id);
      if (!entry) {
        entry = {
          id: descriptor.id,
          name: typeof descriptor.name === "string" ? descriptor.name : descriptor.id,
          version: descriptor.version == null ? "" : String(descriptor.version),
          author: typeof descriptor.author === "string" ? descriptor.author : "",
          effects: [],
          materials: [],
          objects: [],
          sprites: [],
          features: [],
        };
        normalized.set(descriptor.id, entry);
      } else {
        if (entry.name === entry.id && typeof descriptor.name === "string") {
          entry.name = descriptor.name;
        }
        if (!entry.version && descriptor.version != null) {
          entry.version = String(descriptor.version);
        }
        if (!entry.author && typeof descriptor.author === "string") {
          entry.author = descriptor.author;
        }
      }
      for (const field of ["effects", "materials", "objects", "sprites", "features"]) {
        if (!Array.isArray(descriptor[field])) continue;
        entry[field].push(...descriptor[field].filter((item) => typeof item === "string"));
      }
    }
    return Array.from(normalized.values(), (entry) => {
      for (const field of ["effects", "materials", "objects", "sprites", "features"]) {
        entry[field] = Array.from(new Set(entry[field])).sort();
      }
      return entry;
    });
  }

  function getProjectPluginDescriptor(plugins, pluginId) {
    let descriptor = plugins.find((plugin) => plugin.id === pluginId);
    if (descriptor) return descriptor;
    const installed = pluginStates.get(pluginId)?.plugin;
    const fallback = PLUGIN_DEPENDENCY_INFO.get(pluginId) || {};
    descriptor = {
      id: pluginId,
      name: installed?.name || fallback.name || pluginId,
      version: String(installed?.version || ""),
      author: installed?.author || fallback.author || "",
      effects: [],
      materials: [],
      objects: [],
      sprites: [],
      features: [],
    };
    plugins.push(descriptor);
    return descriptor;
  }

  function mergeDetectedPluginItems(plugins, pluginId, field, items) {
    if (!items || items.size === 0) return;
    const descriptor = getProjectPluginDescriptor(plugins, pluginId);
    descriptor[field] = Array.from(
      new Set([...(descriptor[field] || []), ...items])
    ).sort();
  }

  function serializeProjectPlugins(plugins) {
    return plugins.map((plugin) => {
      const descriptor = { ...plugin };
      if (!descriptor.sprites?.length) delete descriptor.sprites;
      if (!descriptor.features?.length) delete descriptor.features;
      return descriptor;
    });
  }

  function findNativeFxTypes(value, found = new Set(), visited = new WeakSet()) {
    if (!value || typeof value !== "object") return found;
    if (visited.has(value)) return found;
    visited.add(value);
    detectNativeFxTypes(value, found);
    if (Array.isArray(value)) {
      for (const item of value) findNativeFxTypes(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findNativeFxTypes(value[key], found, visited);
    }
    return found;
  }

  function detectNativeFxTypes(value, found) {
    if (typeof value.type === "string" && NATIVE_FX_EFFECTS.has(value.type)) {
      found.add(value.type);
    }
  }

  function findLayerInputFeatures(
    value,
    found = { effects: new Set(), features: new Set() },
    visited = new WeakSet()
  ) {
    if (!value || typeof value !== "object") return found;
    if (visited.has(value)) return found;
    visited.add(value);
    detectLayerInputFeatures(value, found);
    if (Array.isArray(value)) {
      for (const item of value) findLayerInputFeatures(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findLayerInputFeatures(value[key], found, visited);
    }
    return found;
  }

  function detectLayerInputFeatures(value, found) {
    if (LAYER_INPUT_EFFECT_IDS.has(value.type)) found.effects.add(value.type);
    // Definitions are present on live properties, while serialized native
    // effects retain only their stable type and property values.
    const nativeLayerSource = value.type === "timedisplacement" ||
      NATIVE_EFFECT_PLUGINS.get(value.type) === NATIVE_FX_PLUGIN_ID ||
      value._zoidiumLayerSource === true || value.definition?._zoidiumLayerSource === true;
    const sourceValues = nativeLayerSource
      ? serializedPropertyValues(value.properties?.source ?? value.value)
      : [];
    if (sourceValues.some((source) => typeof source === "string" && source.startsWith("track:"))) {
      found.features.add("layer-source");
    }
    if (
      value._zoidiumShaderLayerSource === true ||
      value.definition?._zoidiumShaderLayerSource === true ||
      value.type?._zoidiumShaderLayerSource === true
    ) {
      found.features.add(LAYER_INPUT_SHADER_FEATURE_ID);
    }
  }

  // Like findNativeFxTypes, but attributes every registered native effect
  // id (all packs) to its owning plugin instead of only the native-fx set.
  function findPluginNativeEffects(value, found = new Map(), visited = new WeakSet()) {
    if (!value || typeof value !== "object") return found;
    if (visited.has(value)) return found;
    visited.add(value);
    detectPluginNativeEffects(value, found);
    if (Array.isArray(value)) {
      for (const item of value) findPluginNativeEffects(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findPluginNativeEffects(value[key], found, visited);
    }
    return found;
  }

  function detectPluginNativeEffects(value, found) {
    if (typeof value.type === "string" && NATIVE_EFFECT_PLUGINS.has(value.type)) {
      const pluginId = NATIVE_EFFECT_PLUGINS.get(value.type);
      if (!found.has(pluginId)) found.set(pluginId, new Set());
      found.get(pluginId).add(value.type);
    }
  }

  // Only authored 3D object lists claim legacy numeric ids. Flare stack
  // elements and property definitions have their own unrelated numeric ids.
  function findNumericObjectTypes(value, found = new Map(), visited = new WeakSet(), authoredObject = true) {
    if (!value || typeof value !== "object" || visited.has(value)) return found;
    visited.add(value);
    if (authoredObject && typeof value.type === "number" && NUMERIC_OBJECT_TYPES.has(value.type) &&
        !Array.isArray(value.effects) && (value.properties || Array.isArray(value.objects)) && !value.definition &&
        (!value.baseTypeString || value.baseTypeString === "object3d")) {
      const entry = NUMERIC_OBJECT_TYPES.get(value.type);
      if (!found.has(entry.pluginId)) found.set(entry.pluginId, new Set());
      found.get(entry.pluginId).add(entry.objectId);
    }
    if (Array.isArray(value)) {
      for (const item of value) findNumericObjectTypes(item, found, visited, authoredObject);
    } else {
      for (const key of ["sequence", "videoTracks", "audioTracks", "clips", "object", "objects", "media", "data"]) {
        const childIsObject = key === "objects" || (key === "data" && value.baseType === "object3d");
        findNumericObjectTypes(value[key], found, visited, childIsObject);
      }
    }
    return found;
  }

  // Numeric layer types along track clip paths (clips[].object nodes).
  function findNumericLayerTypes(data, found = new Map()) {
    const visited = new WeakSet();
    const visitTracks = (tracks) => {
      if (!Array.isArray(tracks)) return;
      for (const track of tracks) {
        if (!track || typeof track !== "object" || visited.has(track)) continue;
        visited.add(track);
        if (!Array.isArray(track.clips)) continue;
        for (const clip of track.clips) {
          const layer = clip && clip.object;
          if (!layer || typeof layer !== "object" || visited.has(layer)) continue;
          visited.add(layer);
          if (typeof layer.type === "number" && NUMERIC_LAYER_TYPES.has(layer.type)) {
            const entry = NUMERIC_LAYER_TYPES.get(layer.type);
            if (!found.has(entry.pluginId)) found.set(entry.pluginId, new Set());
            found.get(entry.pluginId).add(entry.layerId);
          }
        }
      }
    };
    if (data && typeof data === "object") {
      visitTracks(data.videoTracks);
      visitTracks(data.audioTracks);
      visitTracks(data.sequence?.videoTracks);
      visitTracks(data.sequence?.audioTracks);
      if (Array.isArray(data.media)) {
        for (const media of data.media) {
          if (media && typeof media === "object" && Array.isArray(media.data)) {
            visitTracks(media.data);
          }
        }
      }
    }
    return found;
  }

  // C4D light ids on vanilla light objects (type 3, objectType 5-8).
  // Legacy Hemisphere payloads (objectType 4) are intentionally ignored:
  // they are indistinguishable from vanilla Hemisphere lights in JSON and
  // render identically without the pack.
  function findC4DLights(value, found = new Set(), visited = new WeakSet()) {
    if (!value || typeof value !== "object") return found;
    if (visited.has(value)) return found;
    visited.add(value);
    detectC4DLights(value, found);
    if (Array.isArray(value)) {
      for (const item of value) findC4DLights(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findC4DLights(value[key], found, visited);
    }
    return found;
  }

  function detectC4DLights(value, found) {
    if (value.type === 3 && typeof value.objectType === "number" &&
        value.objectType >= 5 && value.objectType <= 8) {
      found.add("c4d-lights");
    }
  }

  function findPluginMaterialTypes(value, found = new Map(), visited = new WeakSet()) {
    if (!value || typeof value !== "object") return found;
    if (visited.has(value)) return found;
    visited.add(value);
    detectPluginMaterialTypes(value, found);
    if (Array.isArray(value)) {
      for (const item of value) findPluginMaterialTypes(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findPluginMaterialTypes(value[key], found, visited);
    }
    return found;
  }

  function detectPluginMaterialTypes(value, found) {
    const material = PLUGIN_MATERIAL_TYPES.get(value.type);
    if (material) {
      if (!found.has(material.pluginId)) found.set(material.pluginId, new Set());
      found.get(material.pluginId).add(value.type);
    }
  }

  function serializedPropertyValues(value) {
    if (value === undefined) return [];
    if (!value || typeof value !== "object" || Array.isArray(value)) return [value];
    const values = [];
    if (Object.prototype.hasOwnProperty.call(value, "value")) values.push(value.value);
    if (Array.isArray(value.keyframes)) {
      for (const keyframe of value.keyframes) {
        if (keyframe && Object.prototype.hasOwnProperty.call(keyframe, "value")) {
          values.push(keyframe.value);
        }
      }
    }
    return values;
  }

  function serializedPropertyDiffers(value, expected) {
    return serializedPropertyValues(value).some((candidate) => {
      if (typeof expected === "number") {
        return !Number.isFinite(Number(candidate)) || Number(candidate) !== expected;
      }
      return candidate !== expected;
    });
  }

  function isSerializedTextObject(value) {
    const properties = value?.properties;
    return (
      value?.type === 1 &&
      properties &&
      typeof properties === "object" &&
      Object.prototype.hasOwnProperty.call(properties, "text") &&
      Object.prototype.hasOwnProperty.call(properties, "font") &&
      Object.prototype.hasOwnProperty.call(properties, "bevelSize")
    );
  }

  function findTextPlusFeatures(value, found = new Set(), visited = new WeakSet()) {
    if (!value || typeof value !== "object") return found;
    if (visited.has(value)) return found;
    visited.add(value);
    detectTextPlusFeatures(value, found);
    if (Array.isArray(value)) {
      for (const item of value) findTextPlusFeatures(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findTextPlusFeatures(value[key], found, visited);
    }
    return found;
  }

  function detectTextPlusFeatures(value, found) {
    if (isSerializedTextObject(value)) {
      const properties = value.properties;
      if (
        Object.prototype.hasOwnProperty.call(properties, "spacing") &&
        serializedPropertyDiffers(properties.spacing, 0)
      ) {
        found.add(TEXT_PLUS_SPACING_FEATURE_ID);
      }
      for (const [name, expected] of [
        ["bevelSide", 0],
        ["bevelDetail", 3],
        ["bevelProfile", 1],
        ["bevelTension", 0.5],
      ]) {
        if (
          Object.prototype.hasOwnProperty.call(properties, name) &&
          serializedPropertyDiffers(properties[name], expected)
        ) {
          found.add(TEXT_PLUS_BEVEL_FEATURE_ID);
          break;
        }
      }
    }
  }

  function findParticlesPlusSprites(value, found = new Set(), visited = new WeakSet()) {
    if (!value || typeof value !== "object") return found;
    if (visited.has(value)) return found;
    visited.add(value);
    detectParticlesPlusSprites(value, found);
    if (Array.isArray(value)) {
      for (const item of value) findParticlesPlusSprites(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findParticlesPlusSprites(value[key], found, visited);
    }
    return found;
  }

  function detectParticlesPlusSprites(value, found) {
    if (typeof value._zoidiumParticlesPlusSprite === "string") {
      found.add(value._zoidiumParticlesPlusSprite);
    }
  }

  function parsePluginObjectType(type) {
    const parser = PZ.zoidium?.object3d?.parseType;
    if (typeof parser === "function") return parser(type);
    const match = typeof type === "string"
      ? type.match(/^zoidium:([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/)
      : null;
    return match ? { pluginId: match[1], objectId: match[2] } : null;
  }

  function findPluginObjectTypes(value, found = new Map(), visited = new WeakSet()) {
    if (!value || typeof value !== "object") return found;
    if (visited.has(value)) return found;
    visited.add(value);
    detectPluginObjectTypes(value, found);
    if (Array.isArray(value)) {
      for (const item of value) findPluginObjectTypes(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findPluginObjectTypes(value[key], found, visited);
    }
    return found;
  }

  function detectPluginObjectTypes(value, found) {
    if (typeof value.type === "string") {
      const parsed = parsePluginObjectType(value.type);
      if (parsed) {
        if (!found.has(parsed.pluginId)) found.set(parsed.pluginId, new Set());
        found.get(parsed.pluginId).add(parsed.objectId);
      }
    }
  }

  function findCompositionFeatures(data) {
    const found = new Set();
    const visited = new WeakSet();
    function visit(value) {
      if (!value || typeof value !== "object" || visited.has(value)) return;
      visited.add(value);
      detectCompositionFeatures(value, found);
      for (const child of Object.values(value)) visit(child);
    }
    visit(data);
    return found;
  }

  function detectCompositionFeatures(value, found) {
    if ((value.comp && typeof value.comp.id === "string") ||
        (value.type === 2 && typeof value.compId === "string")) found.add("compositions");
  }

  function findConstraintFeatures(value, found = new Set(), visited = new WeakSet()) {
    if (!value || typeof value !== "object" || visited.has(value)) return found;
    visited.add(value);
    detectConstraintFeatures(value, found);
    for (const child of Object.values(value)) findConstraintFeatures(child, found, visited);
    return found;
  }

  function detectConstraintFeatures(value, found) {
    if (value.type !== undefined && typeof value.properties?.zoidiumTrackTo === "string" &&
        value.properties.zoidiumTrackTo.length > 0) found.add("track-to");
  }

  // A single work stack shares record dispatch and cycle tracking. Numeric
  // paths use separate visit bits because their first path, and its order,
  // determines whether an aliased record is an authored object or a layer.
  function scanProjectDependencies(data) {
    const result = {
      detectedEffects: new Set(), detectedPluginNative: new Map(),
      detectedLayerInput: { effects: new Set(), features: new Set() },
      detectedMaterialTypes: new Map(), detectedObjectTypes: new Map(),
      detectedNumericObjects: new Map(), detectedNumericLayers: new Map(),
      detectedC4DLights: new Set(), detectedTextPlusFeatures: new Set(),
      detectedParticlesPlusSprites: new Set(), detectedCompositions: new Set(),
      detectedConstraints: new Set(), detectedExpressions: new Set(), detectedShaderProperties: new Set(),
    };
    const ordinary = 1, values = 2, numericObject = 4, track = 8, layer = 16;
    const seen = new WeakMap();
    const stack = [];
    const push = (value, mode, authored = false) => {
      if (value && typeof value === "object") stack.push({ value, mode, authored });
    };
    // Retain the numeric-layer detector's root-only track selection and order.
    const tracks = [data?.videoTracks, data?.audioTracks, data?.sequence?.videoTracks, data?.sequence?.audioTracks];
    if (Array.isArray(data?.media)) {
      for (const media of data.media) {
        if (media && typeof media === "object" && Array.isArray(media.data)) tracks.push(media.data);
      }
    }
    for (let i = tracks.length - 1; i >= 0; i--) {
      if (Array.isArray(tracks[i])) {
        for (let j = tracks[i].length - 1; j >= 0; j--) push(tracks[i][j], track);
      }
    }
    push(data, numericObject, true);
    push(data, ordinary | values);
    function add(map, pluginId, id) {
      if (!map.has(pluginId)) map.set(pluginId, new Set());
      map.get(pluginId).add(id);
    }
    while (stack.length) {
      const task = stack.pop(), value = task.value;
      if (!value || typeof value !== "object") continue;
      const previous = seen.get(value) || 0;
      // Tracks and layers shared one visited set in the legacy detector.
      let mode = task.mode & ~previous;
      if (previous & (track | layer)) mode &= ~(track | layer);
      if (!mode) continue;
      seen.set(value, previous | mode);
      if (mode & ordinary) {
        detectNativeFxTypes(value, result.detectedEffects);
        detectPluginNativeEffects(value, result.detectedPluginNative);
        detectLayerInputFeatures(value, result.detectedLayerInput);
        detectPluginMaterialTypes(value, result.detectedMaterialTypes);
        detectPluginObjectTypes(value, result.detectedObjectTypes);
        detectC4DLights(value, result.detectedC4DLights);
        detectTextPlusFeatures(value, result.detectedTextPlusFeatures);
        detectParticlesPlusSprites(value, result.detectedParticlesPlusSprites);
      }
      if (mode & values) {
        detectCompositionFeatures(value, result.detectedCompositions);
        detectConstraintFeatures(value, result.detectedConstraints);
        detectExpressionFeatures(value, result.detectedExpressions);
        detectShaderProperties(value, result.detectedShaderProperties);
      }
      if (mode & numericObject) {
        if (task.authored && typeof value.type === "number" && NUMERIC_OBJECT_TYPES.has(value.type) &&
            !Array.isArray(value.effects) && (value.properties || Array.isArray(value.objects)) && !value.definition &&
            (!value.baseTypeString || value.baseTypeString === "object3d")) {
          const entry = NUMERIC_OBJECT_TYPES.get(value.type);
          add(result.detectedNumericObjects, entry.pluginId, entry.objectId);
        }
        if (Array.isArray(value)) {
          for (let i = value.length - 1; i >= 0; i--) push(value[i], numericObject, task.authored);
        } else {
          const keys = ["sequence", "videoTracks", "audioTracks", "clips", "object", "objects", "media", "data"];
          for (let i = keys.length - 1; i >= 0; i--) {
            const key = keys[i];
            push(value[key], numericObject, key === "objects" || key === "data" && value.baseType === "object3d");
          }
        }
      }
      if (mode & track && Array.isArray(value.clips)) {
        for (let i = value.clips.length - 1; i >= 0; i--) push(value.clips[i]?.object, layer);
      }
      if (mode & layer && typeof value.type === "number" && NUMERIC_LAYER_TYPES.has(value.type)) {
        const entry = NUMERIC_LAYER_TYPES.get(value.type);
        add(result.detectedNumericLayers, entry.pluginId, entry.layerId);
      }
      const general = mode & (ordinary | values);
      if (!general) continue;
      if (Array.isArray(value)) {
        // Most serialized arrays have identical iteration and own values.
        // Share those edges, but preserve both rules for sparse/live arrays.
        const items = general & ordinary ? Array.from(value) : [];
        const children = general & values ? Object.values(value) : [];
        if (general === (ordinary | values) && items.length === children.length &&
            items.every((item, i) => item === children[i])) {
          for (let i = items.length - 1; i >= 0; i--) push(items[i], general);
        } else {
          for (let i = children.length - 1; i >= 0; i--) push(children[i], values);
          for (let i = items.length - 1; i >= 0; i--) push(items[i], ordinary);
        }
      } else {
        const keys = Object.keys(value);
        for (let i = keys.length - 1; i >= 0; i--) push(value[keys[i]], general);
      }
    }
    return result;
  }

  function projectPluginRequirements(data) {
    const plugins = normalizeProjectPlugins(data?.plugins);
    const {
      detectedEffects, detectedPluginNative, detectedLayerInput, detectedMaterialTypes,
      detectedObjectTypes, detectedNumericObjects, detectedNumericLayers, detectedC4DLights,
      detectedTextPlusFeatures, detectedParticlesPlusSprites, detectedCompositions,
      detectedConstraints, detectedExpressions, detectedShaderProperties,
    } = scanProjectDependencies(data);
    if (
      detectedEffects.size === 0 &&
      detectedPluginNative.size === 0 &&
      detectedLayerInput.effects.size === 0 &&
      detectedLayerInput.features.size === 0 &&
      detectedMaterialTypes.size === 0 &&
      detectedObjectTypes.size === 0 &&
      detectedNumericObjects.size === 0 &&
      detectedNumericLayers.size === 0 &&
      detectedC4DLights.size === 0 &&
      detectedTextPlusFeatures.size === 0 &&
      detectedParticlesPlusSprites.size === 0 &&
      detectedCompositions.size === 0 &&
      detectedConstraints.size === 0 &&
      detectedExpressions.size === 0 &&
      detectedShaderProperties.size === 0
    ) {
      return plugins;
    }
    mergeDetectedPluginItems(
      plugins,
      NATIVE_FX_PLUGIN_ID,
      "effects",
      new Set(detectedEffects)
    );
    for (const [pluginId, effectIds] of detectedPluginNative) {
      mergeDetectedPluginItems(plugins, pluginId, "effects", effectIds);
    }
    mergeDetectedPluginItems(
      plugins,
      LAYER_INPUT_PLUGIN_ID,
      "effects",
      detectedLayerInput.effects
    );
    mergeDetectedPluginItems(
      plugins,
      LAYER_INPUT_PLUGIN_ID,
      "features",
      detectedLayerInput.features
    );
    for (const [pluginId, materialTypes] of detectedMaterialTypes) {
      mergeDetectedPluginItems(plugins, pluginId, "materials", materialTypes);
    }
    for (const [pluginId, objectTypes] of detectedObjectTypes) {
      mergeDetectedPluginItems(plugins, pluginId, "objects", objectTypes);
    }
    for (const [pluginId, objectIds] of detectedNumericObjects) {
      mergeDetectedPluginItems(plugins, pluginId, "objects", objectIds);
    }
    for (const [pluginId, layerIds] of detectedNumericLayers) {
      mergeDetectedPluginItems(plugins, pluginId, "objects", layerIds);
    }
    mergeDetectedPluginItems(plugins, "constraints", "features", detectedConstraints);
    mergeDetectedPluginItems(plugins, "expressions-plus", "features", detectedExpressions);
    mergeDetectedPluginItems(plugins, "shader-plus", "features", detectedShaderProperties);
    mergeDetectedPluginItems(plugins, "precomp-plus", "features", detectedCompositions);
    mergeDetectedPluginItems(plugins, TRAPCODE_SUITE_PLUGIN_ID, "features", detectedC4DLights);
    mergeDetectedPluginItems(
      plugins,
      TEXT_PLUS_PLUGIN_ID,
      "features",
      detectedTextPlusFeatures
    );
    mergeDetectedPluginItems(
      plugins,
      PARTICLES_PLUS_PLUGIN_ID,
      "sprites",
      detectedParticlesPlusSprites
    );
    return plugins;
  }

  function findShaderProperties(value, found = new Set(), visited = new WeakSet()) {
    if (!value || typeof value !== "object" || visited.has(value)) return found;
    visited.add(value);
    detectShaderProperties(value, found);
    for (const child of Object.values(value)) findShaderProperties(child, found, visited);
    return found;
  }

  function detectShaderProperties(value, found) {
    if (["gradient", "curve", "palette", "text"].includes(value.zoidiumShader?.kind)) found.add("shader-properties");
  }

  function findExpressionFeatures(value, found = new Set(), visited = new WeakSet()) {
    if (!value || typeof value !== "object" || visited.has(value)) return found;
    visited.add(value);
    detectExpressionFeatures(value, found);
    for (const child of Object.values(value)) findExpressionFeatures(child, found, visited);
    return found;
  }

  function detectExpressionFeatures(value, found) {
    const source = typeof value.expression === "string" ? value.expression : value.expression?.source;
    const expressionKind = typeof source === "string" ? window.ZoidiumExpressions?.requires?.(source) : false;
    // Conservative scanning also works before the plugin has activated. The
    // original source remains the serialized expression, including in archives
    // and unknown payloads, so a disabled plugin cannot hide its requirement.
    if (expressionKind === true || expressionKind !== false && typeof source === "string" && /\b(?:let|const|function|return|throw|value|thisProperty|thisObject|thisLayer|thisClip|thisSequence|thisComp|prop|controls|control|seedRandom|wiggle|easeIn|easeOut|degreesToRadians|radiansToDegrees|lookAt|toWorld|fromWorld|worldPosition|worldRotation|toScreen|fromScreen|Array|Number|String|Boolean|JSON|Math|parseInt|parseFloat|isFinite|isNaN|Infinity|NaN|undefined)\b|=>|\?\.|\.\.\.|`|\.\s*[A-Za-z_$]|\bvar\s*[\[{]|\b\d[\d_]*n\b|\d_\d|\?\?|&&=|\|\|=/.test(source)) found.add("expressions");
    if (value.zoidiumControls) found.add("sequence-controls");
    const shader = value.properties?.fragShader;
    if (typeof shader === "string" && /\bz(?:Time|Frame)\b|\bctl_\w+|\/\/\s*#include\s*<zoidium\/(?:hash|noise|color|sdf)>/.test(shader)) found.add("shader-extensions");
  }

  // Numeric-type placeholders: projects may reference 3D object or layer
  // types whose pack is disabled (or was never enabled). The vanilla
  // factories throw for unknown numerics, which would abort the whole
  // project load, so the manager substitutes data-preserving dummies and
  // swaps the real thing back in when the owning pack enables.
  // END manager body
  Object.assign(manager, { normalizeProjectPlugins, getProjectPluginDescriptor, mergeDetectedPluginItems, serializeProjectPlugins, findNativeFxTypes, findLayerInputFeatures, findPluginNativeEffects, findNumericObjectTypes, findNumericLayerTypes, findC4DLights, findPluginMaterialTypes, serializedPropertyValues, serializedPropertyDiffers, isSerializedTextObject, findTextPlusFeatures, findParticlesPlusSprites, parsePluginObjectType, findPluginObjectTypes, findCompositionFeatures, projectPluginRequirements });
})();
