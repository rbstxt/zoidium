(function () {
  "use strict";

  const REGISTRY_URL = "./plugins/registry.json?v=10";
  const STORAGE_PREFIX = "zoidium.plugin.enabled.";
  const SHADER_PLUGIN_MARKER = "// @zoidium-plugin ";
  const EFFECT_UUID_PROPERTY = "_zoidiumEffectUuid";
  const NATIVE_FX_PLUGIN_ID = "native-fx";
  const LAYER_INPUT_PLUGIN_ID = "layer-input";
  const LAYER_INPUT_EFFECT_ID = "layerinput";
  const LAYER_INPUT_DISPLACEMENT_EFFECT_ID = "layerinputdisplacement";
  const LAYER_INPUT_MATERIAL_ID = "layersource";
  const LAYER_INPUT_EFFECT_IDS = new Set([
    LAYER_INPUT_EFFECT_ID,
    LAYER_INPUT_DISPLACEMENT_EFFECT_ID,
  ]);
  const NATIVE_FX_EFFECTS = new Map([
    ["radialblurspin", "Radial Blur (Spin)"],
    ["dropshadow", "Drop Shadow"],
  ]);
  const DEFAULT_PLUGIN_COLORS = Object.freeze({
    "easing-plus": "#384668",
    "native-fx": "#c56b3d",
    "light-plus": "#2f9b86",
    "alipfx-shader-pack-4": "#a04ed1",
    afterclip: "#d35a76",
    "player-plus": "#4f7dbf",
    "layer-input": "#4f9db6",
  });
  const pluginStates = new Map();
  const trackedNativeEffects = new Set();
  const missingNativeEffects = new Set();
  const trackedPluginMaterials = new Set();
  const missingPluginMaterials = new Set();
  const effectUuidByEntry = new WeakMap();
  let projectHooksInstalled = false;
  let editorHooksInstalled = false;
  let effectBadgeObserver = null;
  let effectBadgeUpdateScheduled = false;
  let registryReadySettled = false;
  let resolveRegistryReady;
  const registryReady = new Promise((resolve) => {
    resolveRegistryReady = resolve;
  });

  function settleRegistryReady() {
    if (registryReadySettled) return;
    registryReadySettled = true;
    resolveRegistryReady();
  }

  function storageKey(pluginId) {
    return `${STORAGE_PREFIX}${pluginId}`;
  }

  function isPersistedEnabled(pluginId) {
    try {
      return localStorage.getItem(storageKey(pluginId)) === "true";
    } catch (_error) {
      return false;
    }
  }

  function persistEnabled(pluginId, enabled) {
    try {
      localStorage.setItem(storageKey(pluginId), String(enabled));
    } catch (_error) {
      // Plugin state still applies for the current session.
    }
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.json();
  }

  async function fetchText(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.text();
  }

  function validateManifest(plugin, manifest) {
    if (manifest.schemaVersion !== 1 || manifest.id !== plugin.id) {
      throw new Error(`Invalid plugin manifest: ${plugin.id}`);
    }
    const japaneseLocale = manifest.locales?.ja;
    const japaneseLocaleSource =
      typeof japaneseLocale === "string" ? japaneseLocale : japaneseLocale?.source;
    if (typeof japaneseLocaleSource !== "string" || !japaneseLocaleSource.trim()) {
      throw new Error(`Plugin has no valid Japanese locale: ${plugin.id}`);
    }
    const effects = manifest.effects || [];
    const groups = manifest.groups || [];
    const objectTypes = manifest.objectTypes || [];
    const nativeEffects = manifest.nativeEffects || [];
    const materialTypes = manifest.materialTypes || [];
    const modules = manifest.modules || [];
    if (
      !Array.isArray(effects) ||
      !Array.isArray(groups) ||
      !Array.isArray(objectTypes) ||
      !Array.isArray(nativeEffects) ||
      !Array.isArray(materialTypes) ||
      !Array.isArray(modules)
    ) {
      throw new Error(`Invalid plugin features: ${plugin.id}`);
    }
    if (
      effects.length === 0 &&
      groups.length === 0 &&
      objectTypes.length === 0 &&
      nativeEffects.length === 0 &&
      materialTypes.length === 0 &&
      modules.length === 0
    ) {
      throw new Error(`Plugin has no features: ${plugin.id}`);
    }
    for (const effect of effects) {
      if (!effect.id || !effect.name || !effect.shader || !effect.preset) {
        throw new Error(`Invalid effect entry in ${plugin.id}`);
      }
    }
    for (const group of groups) {
      if (
        !group.id ||
        !group.name ||
        !group.preset ||
        (group.shaders != null && !Array.isArray(group.shaders))
      ) {
        throw new Error(`Invalid group entry in ${plugin.id}`);
      }
    }
    for (const effect of nativeEffects) {
      if (!effect.id || !effect.name || !effect.source) {
        throw new Error(`Invalid native effect entry in ${plugin.id}`);
      }
    }
    for (const material of materialTypes) {
      if (!material.id || !material.name) {
        throw new Error(`Invalid material entry in ${plugin.id}`);
      }
    }
    for (const module of modules) {
      if (!module.id || !module.source) {
        throw new Error(`Invalid module entry in ${plugin.id}`);
      }
    }
    for (const entry of objectTypes) {
      if (
        entry.target !== "object3d" ||
        !entry.name ||
        typeof entry.type !== "number" ||
        !Array.isArray(entry.list) ||
        entry.list.length === 0
      ) {
        throw new Error(`Invalid 3D object entry in ${plugin.id}`);
      }
      for (const item of entry.list) {
        if (!item.name || typeof item.type !== "number" || !item.data) {
          throw new Error(`Invalid 3D object variant in ${plugin.id}`);
        }
      }
      if (
        entry.replace &&
        (typeof entry.replace.name !== "string" || typeof entry.replace.type !== "number")
      ) {
        throw new Error(`Invalid 3D object replacement in ${plugin.id}`);
      }
    }
  }

  function getEffectTypes() {
    const effectTypes = PZ.ui.objectTypes.get(PZ.effect);
    ensureEffectEntryIds(effectTypes);
    return effectTypes;
  }

  function getMaterialTypes() {
    return PZ.ui.objectTypes.get(PZ.material) || [];
  }

  function normalizePickerLabel(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function createEffectUuid() {
    const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (typeof cryptoApi?.randomUUID === "function") {
      try {
        return cryptoApi.randomUUID();
      } catch (_error) {
        // Fall back to getRandomValues below when randomUUID is unavailable.
      }
    }

    const bytes = new Uint8Array(16);
    if (typeof cryptoApi?.getRandomValues === "function") {
      try {
        cryptoApi.getRandomValues(bytes);
      } catch (_error) {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = Math.floor(Math.random() * 256);
        }
      }
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
      16,
      20
    )}-${hex.slice(20)}`;
  }

  function ensureEffectEntryUuid(entry) {
    if (!entry || typeof entry !== "object" || entry.category === true) return null;
    let uuid = effectUuidByEntry.get(entry);
    if (!uuid) {
      const existing = entry[EFFECT_UUID_PROPERTY];
      uuid = typeof existing === "string" && existing ? existing : createEffectUuid();
      effectUuidByEntry.set(entry, uuid);
      // Keep this marker out of project JSON and other enumerable metadata.
      try {
        Object.defineProperty(entry, EFFECT_UUID_PROPERTY, {
          configurable: true,
          enumerable: false,
          value: uuid,
          writable: false,
        });
      } catch (_error) {
        // The WeakMap above still provides the internal identity for frozen entries.
      }
    }
    return uuid;
  }

  function ensureEffectEntryIds(effectTypes) {
    if (!Array.isArray(effectTypes)) return;
    for (const entry of effectTypes) ensureEffectEntryUuid(entry);
  }

  function syncPluginPanelScrollState(panel) {
    if (!panel || panel.clientHeight === 0) return;
    panel.classList.toggle(
      "zoidium-plugin-panel--scrolling",
      panel.scrollHeight > panel.clientHeight
    );
  }

  function pickerCategoryForItem(item) {
    let sibling = item.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === "SPAN") return normalizePickerLabel(sibling.textContent);
      sibling = sibling.previousElementSibling;
    }
    return "";
  }

  function pluginBadgeRgba(color, alpha) {
    const match = String(color || "").trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return `rgba(113, 130, 170, ${alpha})`;
    const hex = match[1].length === 3
      ? match[1].split("").map((channel) => channel + channel).join("")
      : match[1];
    const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    return `rgba(${channels.join(", ")}, ${alpha})`;
  }

  function addEffectLookupEntry(map, key, entry) {
    const matches = map.get(key) || [];
    matches.push(entry);
    map.set(key, matches);
  }

  function buildEffectPickerLookup(effectTypes) {
    const lookup = {
      entries: new Set(),
      entriesByUuid: new Map(),
      entriesByCategoryName: new Map(),
      entriesByName: new Map(),
      entriesBySignature: new Map(),
    };
    let category = "";
    for (const entry of effectTypes) {
      if (entry?.category === true) {
        category = normalizePickerLabel(entry.name);
        continue;
      }
      if (!entry?.name) continue;
      const uuid = ensureEffectEntryUuid(entry);
      const normalizedName = normalizePickerLabel(entry.name);
      const normalizedDescription = normalizePickerLabel(entry.desc);
      const signature = `${normalizedName}\u0000${normalizedDescription}`;
      lookup.entries.add(entry);
      lookup.entriesByUuid.set(uuid, entry);
      addEffectLookupEntry(lookup.entriesByName, normalizedName, entry);
      addEffectLookupEntry(lookup.entriesBySignature, signature, entry);
      if (!entry._zoidiumPluginId) continue;
      addEffectLookupEntry(
        lookup.entriesByCategoryName,
        `${category}\u0000${normalizedName}`,
        entry
      );
    }
    return lookup;
  }

  function findEffectPickerEntry(item, lookup) {
    // Panzoid keeps the source definition on every picker row. This is the
    // authoritative link and remains correct through search and localization.
    const directEntry = item.pz_item;
    if (directEntry) {
      if (lookup.entries.has(directEntry)) return directEntry;
      const directUuid = effectUuidByEntry.get(directEntry);
      return directUuid ? lookup.entriesByUuid.get(directUuid) || null : null;
    }

    // The UUID is also written to the row so a future picker implementation
    // that clones rows can still resolve them without comparing translated text.
    const uuidEntry = lookup.entriesByUuid.get(item.dataset.zoidiumEffectUuid);
    if (uuidEntry) return uuidEntry;

    // Compatibility fallback for picker rows from older/custom UI code that
    // does not expose pz_item yet. Only unambiguous matches are accepted.
    const titleNode = Array.from(item.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
    const normalizedTitle = normalizePickerLabel(titleNode?.textContent);
    if (!normalizedTitle) return null;
    const description = item.querySelector(":scope > span:not(.zoidium-effect-plugin-badge)");
    const normalizedDescription = normalizePickerLabel(description?.textContent);
    const category = pickerCategoryForItem(item);
    const categoryMatches = lookup.entriesByCategoryName.get(
      `${category}\u0000${normalizedTitle}`
    ) || [];
    if (categoryMatches.length === 1) return categoryMatches[0];

    const signatureMatches = (lookup.entriesBySignature.get(
      `${normalizedTitle}\u0000${normalizedDescription}`
    ) || []).filter((entry) => entry._zoidiumPluginId);
    if (signatureMatches.length === 1) return signatureMatches[0];

    const nameMatches = (lookup.entriesByName.get(normalizedTitle) || []).filter(
      (entry) => entry._zoidiumPluginId
    );
    return nameMatches.length === 1 ? nameMatches[0] : null;
  }

  function decorateEffectPicker() {
    const effectTypes = getEffectTypes();
    if (!Array.isArray(effectTypes)) return;
    const lookup = buildEffectPickerLookup(effectTypes);

    document.querySelectorAll(".pz-options").forEach((options) => {
      options.querySelectorAll(":scope > li").forEach((item) => {
        const existingBadge = item.querySelector(":scope > .zoidium-effect-plugin-badge");
        const description = item.querySelector(":scope > span:not(.zoidium-effect-plugin-badge)");
        const entry = findEffectPickerEntry(item, lookup);
        if (!entry) {
          existingBadge?.remove();
          delete item.dataset.zoidiumPluginBadge;
          delete item.dataset.zoidiumEffectUuid;
          return;
        }
        item.dataset.zoidiumEffectUuid = ensureEffectEntryUuid(entry);
        if (!entry._zoidiumPluginId) {
          existingBadge?.remove();
          delete item.dataset.zoidiumPluginBadge;
          return;
        }
        const plugin = pluginStates.get(entry._zoidiumPluginId)?.plugin;
        const pluginName = plugin?.badgeName || plugin?.name || entry._zoidiumPluginId;
        const color = plugin?.color || DEFAULT_PLUGIN_COLORS[entry._zoidiumPluginId] || "#7182aa";
        const badge = existingBadge || document.createElement("span");
        if (badge.textContent !== pluginName) badge.textContent = pluginName;
        badge.style.setProperty("--zoidium-plugin-color", color);
        badge.style.setProperty("--zoidium-plugin-background", pluginBadgeRgba(color, 0.2));
        badge.style.setProperty("--zoidium-plugin-border", pluginBadgeRgba(color, 0.6));
        badge.title = plugin?.name || entry._zoidiumPluginId;
        if (!existingBadge) {
          badge.className = "zoidium-effect-plugin-badge";
          if (description) item.insertBefore(badge, description);
          else item.appendChild(badge);
        }
        item.dataset.zoidiumPluginBadge = entry._zoidiumPluginId;
      });
    });
  }

  function scheduleEffectPickerBadges() {
    if (effectBadgeUpdateScheduled) return;
    effectBadgeUpdateScheduled = true;
    requestAnimationFrame(() => {
      effectBadgeUpdateScheduled = false;
      decorateEffectPicker();
    });
  }

  function installEffectPickerBadges() {
    if (effectBadgeObserver) return;
    decorateEffectPicker();
    effectBadgeObserver = new MutationObserver(scheduleEffectPickerBadges);
    effectBadgeObserver.observe(document.body, { childList: true, subtree: true });
  }

  function getObjectTypes(target) {
    if (target === "object3d") return PZ.ui.objectTypes.get(PZ.object3d);
    throw new Error(`Unsupported plugin object target: ${target}`);
  }

  function configureBundledLightDefault() {
    const objects = PZ.ui.objectTypes.get(PZ.object3d);
    if (!objects) return;
    const light = objects.find(
      (entry) => entry?.type === 3 && entry?.name === "Light" && !entry?._zoidiumPluginId
    );
    if (!light) return;
    delete light.list;
    delete light.hidelist;
    light.data = { objectType: 1 };
    light.desc = "Creates a Spot Light with shadows in a scene.";
  }

  function insertionIndex(effects) {
    const miscIndex = effects.findIndex(
      (entry) => entry && entry.category === true && entry.name === "MISC"
    );
    return miscIndex < 0 ? effects.length : miscIndex;
  }

  function createPluginMarker(plugin, effect) {
    return `${SHADER_PLUGIN_MARKER}${JSON.stringify({
      id: plugin.id,
      name: plugin.name,
      author: plugin.author,
      version: String(plugin.version),
      effect: effect.id,
    })}`;
  }

  function readPluginMarker(shader) {
    if (shader && typeof shader === "object") shader = shader.value;
    if (typeof shader !== "string") return null;
    const markerIndex = shader.lastIndexOf(SHADER_PLUGIN_MARKER);
    if (markerIndex < 0) return null;
    const marker = shader
      .slice(markerIndex + SHADER_PLUGIN_MARKER.length)
      .split(/\r?\n/, 1)[0];
    try {
      const metadata = JSON.parse(marker);
      if (!metadata || typeof metadata.id !== "string") return null;
      return {
        id: metadata.id,
        name: typeof metadata.name === "string" ? metadata.name : metadata.id,
        author: typeof metadata.author === "string" ? metadata.author : "",
        version: String(metadata.version || ""),
        effect: typeof metadata.effect === "string" ? metadata.effect : "",
      };
    } catch (_error) {
      return null;
    }
  }

  function createLazyEffectData(plugin, effect, cache) {
    return async function () {
      if (!cache.has(effect.id)) {
        cache.set(
          effect.id,
          Promise.all([fetchJson(effect.preset), fetchText(effect.shader)]).then(
            ([preset, shader]) => {
              if (preset.type !== 1 || !preset.properties) {
                throw new Error(`Invalid shader preset: ${effect.id}`);
              }
              preset.properties.fragShader = `${shader.replace(/\s+$/, "")}\n${createPluginMarker(
                plugin,
                effect
              )}\n`;
              return preset;
            }
          )
        );
      }
      const data = await cache.get(effect.id);
      return JSON.parse(JSON.stringify(data));
    };
  }

  function hydrateGroupShaders(value, shaderByPath, plugin, group) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return value.map((item) => hydrateGroupShaders(item, shaderByPath, plugin, group));
    }
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "_zoidiumShader") continue;
      result[key] = hydrateGroupShaders(child, shaderByPath, plugin, group);
    }
    if (result.type === 1 && value._zoidiumShader) {
      const shader = shaderByPath.get(value._zoidiumShader);
      if (typeof shader !== "string") {
        throw new Error(`Missing group shader: ${group.id} (${value._zoidiumShader})`);
      }
      if (!result.properties) result.properties = {};
      result.properties.fragShader = `${shader.replace(/\s+$/, "")}\n${createPluginMarker(
        plugin,
        group
      )}\n`;
    }
    return result;
  }

  async function loadGroupData(plugin, group, cache) {
    if (!cache.has(group.id)) {
      cache.set(
        group.id,
        Promise.all([
          fetchJson(group.preset),
          ...(group.shaders || []).map(async (source) => [source, await fetchText(source)]),
        ]).then(([preset, ...shaderEntries]) => {
          if (preset.type !== 0 || !preset.properties || !Array.isArray(preset.objects)) {
            throw new Error(`Invalid group preset: ${group.id}`);
          }
          const shaders = new Map(shaderEntries);
          return hydrateGroupShaders(preset, shaders, plugin, group);
        })
      );
    }
    return cloneJson(await cache.get(group.id));
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function updateNativeFxUsageUi() {
    const state = pluginStates.get(NATIVE_FX_PLUGIN_ID);
    if (!state || !pluginIsEnabled(state)) return;
    const inUse = trackedNativeEffects.size > 0;
    state.toggle.disabled = inUse;
    state.status.textContent = inUse
      ? "In use by this project"
      : `${manifestFeatureCount(state.manifest)} active`;
  }

  function trackNativeEffect(effect, metadata, missing) {
    effect._zoidiumPluginMetadata = metadata;
    trackedNativeEffects.add(effect);
    if (missing) missingNativeEffects.add(effect);
    else missingNativeEffects.delete(effect);
    updateNativeFxUsageUi();
  }

  function untrackNativeEffect(effect) {
    trackedNativeEffects.delete(effect);
    missingNativeEffects.delete(effect);
    updateNativeFxUsageUi();
  }

  function setNativeFactory(type, factory, mode) {
    const promise = Promise.resolve(factory);
    promise._zoidiumNativeFxMode = mode;
    PZ.effect.fnList[type] = promise;
  }

  function getNativeEffectMetadata(plugin, effect, type, name) {
    return {
      id: plugin?.id || NATIVE_FX_PLUGIN_ID,
      name: plugin?.name || "Native FX",
      version: String(plugin?.version || ""),
      author: plugin?.author || "",
      effect: effect?.id || type,
      compatibility: "incompatible",
      effectName: effect?.name || name || type,
    };
  }

  function installMissingNativeFactory(type, name, metadata) {
    const missingMetadata = getNativeEffectMetadata(
      metadata,
      { id: type, name },
      type,
      name
    );
    setNativeFactory(
      type,
      function () {
        const effect = this;
        effect._zoidiumMissingNativeFx = true;
        effect.properties.add("missingDependency", {
          name: "Missing Native FX",
          readOnly: true,
          type: PZ.property.type.TEXT,
          value: `${missingMetadata.effectName} requires the ${missingMetadata.name} plugin.`,
        });
        effect.load = function (data) {
          effect._zoidiumMissingData = cloneJson(data || { type });
          effect.properties.name.set(`Missing ${missingMetadata.name}: ${missingMetadata.effectName}`);
          effect.properties.missingDependency.load();
          trackNativeEffect(effect, missingMetadata, true);
        };
        effect.toJSON = function () {
          return cloneJson(effect._zoidiumMissingData || { type });
        };
        effect.update = function () {};
        effect.resize = function () {};
        effect.prepare = async function () {};
        effect.unload = function () {
          untrackNativeEffect(effect);
        };
      },
      "missing"
    );
  }

  function installMissingNativeFactories() {
    for (const [type, name] of NATIVE_FX_EFFECTS) installMissingNativeFactory(type, name);
  }

  function registerNativeFactory(plugin, effect, source) {
    setNativeFactory(
      effect.id,
      function () {
        const instance = this;
        new Function(source).call(instance);
        const originalLoad = instance.load;
        const originalUnload = instance.unload;
        instance.load = async function () {
          trackNativeEffect(
            instance,
            {
              id: plugin.id,
              name: plugin.name,
              version: String(plugin.version),
              author: plugin.author || "",
              effect: effect.id,
              effectName: effect.name,
              compatibility: "incompatible",
            },
            false
          );
          return originalLoad.apply(instance, arguments);
        };
        instance.unload = function () {
          untrackNativeEffect(instance);
          return originalUnload.apply(instance, arguments);
        };
      },
      "native"
    );
  }

  async function restoreMissingNativeEffects(pluginId) {
    for (const missing of Array.from(missingNativeEffects)) {
      if (pluginId && missing._zoidiumPluginMetadata?.id !== pluginId) continue;
      const parent = missing.parent;
      const index = parent?.indexOf(missing) ?? -1;
      if (index < 0) {
        untrackNativeEffect(missing);
        continue;
      }
      const data = missing.toJSON();
      missing.unload();
      const replacement = PZ.effect.create(data.type);
      parent.splice(index, 1, replacement);
      try {
        replacement.loading = replacement.load(data);
        await replacement.loading;
      } catch (error) {
        console.error(`[Zoidium] failed to restore plugin effect ${data.type}:`, error);
        const metadata = missing._zoidiumPluginMetadata || {};
        installMissingNativeFactory(
          data.type,
          metadata.effectName || NATIVE_FX_EFFECTS.get(data.type) || data.type,
          metadata
        );
        const fallback = PZ.effect.create(data.type);
        parent.splice(index, 1, fallback);
        fallback.loading = fallback.load(data);
        await fallback.loading;
        throw error;
      }
    }
  }

  function trackPluginMaterial(material, metadata, missing) {
    material._zoidiumPluginMetadata = metadata;
    trackedPluginMaterials.add(material);
    if (missing) missingPluginMaterials.add(material);
    else missingPluginMaterials.delete(material);
  }

  function untrackPluginMaterial(material) {
    trackedPluginMaterials.delete(material);
    missingPluginMaterials.delete(material);
  }

  function setMaterialFactory(type, factory, mode) {
    const promise = Promise.resolve(factory);
    promise._zoidiumMaterialMode = mode;
    PZ.material.fnList[type] = promise;
  }

  function getPluginMaterialMetadata(plugin, material, type, name) {
    return {
      id: plugin?.id || "layer-input",
      name: plugin?.name || plugin?.id || "Plugin",
      version: String(plugin?.version || ""),
      author: plugin?.author || "",
      material: material?.id || type,
      materialName: material?.name || name || type,
      compatibility: "incompatible",
    };
  }

  function installMissingMaterialFactory(type, name, metadata) {
    const missingMetadata = getPluginMaterialMetadata(
      metadata,
      { id: type, name },
      type,
      name
    );
    setMaterialFactory(
      type,
      function () {
        const material = this;
        material._zoidiumMissingMaterial = true;
        material.properties.add("missingDependency", {
          name: "Missing Material Plugin",
          readOnly: true,
          type: PZ.property.type.TEXT,
          value: `${missingMetadata.materialName} requires the ${missingMetadata.name} plugin.`,
        });
        material.load = function (data) {
          material._zoidiumMissingData = cloneJson(data || { type });
          material.properties.name.set(
            `Missing ${missingMetadata.name}: ${missingMetadata.materialName}`
          );
          material.properties.missingDependency.load();
          material.threeObj = new THREE.MeshBasicMaterial({
            color: 0x9b3b6b,
            transparent: true,
            opacity: 0.35,
          });
          trackPluginMaterial(material, missingMetadata, true);
        };
        material.toJSON = function () {
          return cloneJson(material._zoidiumMissingData || { type });
        };
        material.update = function () {};
        material.prepare = async function () {};
        material.unload = function () {
          untrackPluginMaterial(material);
          material.threeObj?.dispose?.();
          material.threeObj = null;
        };
      },
      "missing"
    );
  }

  async function restoreMissingPluginMaterials(pluginId) {
    for (const missing of Array.from(missingPluginMaterials)) {
      if (pluginId && missing._zoidiumPluginMetadata?.id !== pluginId) continue;
      const parent = missing.parent;
      const index = parent?.indexOf(missing) ?? -1;
      if (index < 0) {
        untrackPluginMaterial(missing);
        continue;
      }
      const data = missing.toJSON();
      const metadata = missing._zoidiumPluginMetadata || {};
      missing.unload();
      const replacement = PZ.material.create(data.type);
      parent.splice(index, 1, replacement);
      try {
        replacement.loading = replacement.load(data);
        await replacement.loading;
      } catch (error) {
        console.error(`[Zoidium] failed to restore plugin material ${data.type}:`, error);
        installMissingMaterialFactory(
          data.type,
          metadata.materialName || data.type,
          metadata
        );
        const fallback = PZ.material.create(data.type);
        parent.splice(index, 1, fallback);
        fallback.loading = fallback.load(data);
        await fallback.loading;
        throw error;
      }
    }
  }

  async function registerManifest(plugin, manifest, state) {
    if (state.runtimeModules.length === 0) {
      const sources = await Promise.all(
        (manifest.modules || []).map(async (definition) => [
          definition,
          await fetchText(definition.source),
        ])
      );
      for (const [definition, source] of sources) {
        const module = { exports: {} };
        new Function("module", "exports", "plugin", source)(module, module.exports, plugin);
        const runtime = module.exports;
        if (!runtime || typeof runtime.activate !== "function") {
          throw new Error(`Plugin module has no activate() export: ${definition.id}`);
        }
        await runtime.activate({ plugin, manifest, editor: window.CM, PZ, document, window });
        state.runtimeModules.push(runtime);
      }
    }

    const effects = getEffectTypes();
    if (!effects.some((entry) => entry?._zoidiumPluginId === plugin.id)) {
      const pluginEffects = manifest.effects || [];
      const pluginGroups = manifest.groups || [];
      if (pluginEffects.length > 0 || pluginGroups.length > 0) {
        const groupData = await Promise.all(
          pluginGroups.map((group) => loadGroupData(plugin, group, state.groupCache))
        );
        const entries = [
          {
            name: manifest.category || manifest.name.toUpperCase(),
            category: true,
            _zoidiumPluginId: plugin.id,
          },
          ...pluginEffects.map((effect) => ({
            name: effect.name,
            desc: effect.description || `${effect.name} — ${manifest.name}`,
            type: 1,
            data: createLazyEffectData(plugin, effect, state.effectCache),
            _zoidiumPluginId: plugin.id,
            _zoidiumPluginEffectId: effect.id,
          })),
          ...pluginGroups.map((group, index) => ({
            name: group.name,
            desc: group.description || `${group.name} — ${manifest.name}`,
            type: 0,
            data: groupData[index],
            _zoidiumPluginId: plugin.id,
            _zoidiumPluginEffectId: group.id,
          })),
        ];
        ensureEffectEntryIds(entries);
        effects.splice(insertionIndex(effects), 0, ...entries);
      }
    }

    const nativeEffects = manifest.nativeEffects || [];
    if (
      nativeEffects.length > 0 &&
      !effects.some(
        (entry) =>
          entry?._zoidiumPluginId === plugin.id &&
          nativeEffects.some((effect) => effect.id === entry._zoidiumPluginEffectId)
      )
    ) {
      const sources = await Promise.all(
        nativeEffects.map(async (effect) => [effect, await fetchText(effect.source)])
      );
      for (const [effect, source] of sources) registerNativeFactory(plugin, effect, source);
      const entries = [
        {
          name: manifest.category || "NATIVE FX",
          category: true,
          _zoidiumPluginId: plugin.id,
        },
        ...nativeEffects.map((effect) => ({
          name: effect.name,
          desc: effect.description || `${effect.name} — ${manifest.name}`,
          type: effect.id,
          _zoidiumPluginId: plugin.id,
          _zoidiumPluginEffectId: effect.id,
        })),
      ];
      ensureEffectEntryIds(entries);
      effects.splice(insertionIndex(effects), 0, ...entries);
    }

    const materialTypes = manifest.materialTypes || [];
    const materials = getMaterialTypes();
    if (
      materialTypes.length > 0 &&
      !materials.some((entry) => entry?._zoidiumPluginId === plugin.id)
    ) {
      materials.push(
        ...materialTypes.map((material) => ({
          name: material.name,
          desc: material.description || `${material.name} — ${manifest.name}`,
          type: material.id,
          _zoidiumPluginId: plugin.id,
          _zoidiumPluginMaterialId: material.id,
        }))
      );
    }

    for (const definition of manifest.objectTypes || []) {
      const objectTypes = getObjectTypes(definition.target);
      if (objectTypes.some((entry) => entry?._zoidiumPluginId === plugin.id)) continue;
      const entry = JSON.parse(JSON.stringify(definition));
      delete entry.target;
      delete entry.replace;
      // Object plugins with variants must always open their variant chooser.
      // This also neutralizes older cached manifests that used hidelist=true.
      delete entry.hidelist;
      entry._zoidiumPluginId = plugin.id;
      entry.list = entry.list.map((item) => ({ ...item, data: { ...item.data } }));
      const replaceIndex = definition.replace
        ? objectTypes.findIndex(
            (candidate) =>
              !candidate?._zoidiumPluginId &&
              candidate?.name === definition.replace.name &&
              candidate?.type === definition.replace.type
          )
        : -1;
      if (replaceIndex >= 0) {
        state.replacedObjectTypes.push({
          entries: objectTypes,
          index: replaceIndex,
          entry: objectTypes[replaceIndex],
        });
        objectTypes.splice(replaceIndex, 1, entry);
      } else {
        objectTypes.push(entry);
      }
    }
    if (effectBadgeObserver) scheduleEffectPickerBadges();
  }

  function unregisterPlugin(pluginId) {
    const registries = [getEffectTypes(), getMaterialTypes(), PZ.ui.objectTypes.get(PZ.object3d)];
    for (const entries of registries) {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index]?._zoidiumPluginId === pluginId) entries.splice(index, 1);
      }
    }
    const state = pluginStates.get(pluginId);
    for (let index = (state?.runtimeModules?.length || 0) - 1; index >= 0; index -= 1) {
      try {
        state.runtimeModules[index].deactivate?.();
      } catch (error) {
        console.error(`[Zoidium] failed to deactivate ${pluginId}:`, error);
      }
    }
    if (state) state.runtimeModules = [];
    for (const replacement of state?.replacedObjectTypes || []) {
      const index = Math.min(replacement.index, replacement.entries.length);
      replacement.entries.splice(index, 0, replacement.entry);
    }
    if (state) state.replacedObjectTypes = [];
    for (const effect of state?.manifest?.nativeEffects || []) {
      installMissingNativeFactory(effect.id, effect.name, state.plugin);
    }
    for (const material of state?.manifest?.materialTypes || []) {
      installMissingMaterialFactory(material.id, material.name, state.plugin);
    }
    if (effectBadgeObserver) scheduleEffectPickerBadges();
  }

  function manifestFeatureCount(manifest) {
    const effectCount = (manifest.effects || []).length;
    const groupCount = (manifest.groups || []).length;
    const nativeEffectCount = (manifest.nativeEffects || []).length;
    const objectCount = (manifest.objectTypes || []).reduce(
      (count, entry) => count + (entry.list || []).length,
      0
    );
    const materialCount = (manifest.materialTypes || []).length;
    return (
      effectCount +
      groupCount +
      nativeEffectCount +
      objectCount +
      materialCount +
      (manifest.modules || []).length
    );
  }

  function updateCard(state, phase, message) {
    const enabled = phase === "enabled";
    state.card.dataset.enabled = String(enabled);
    state.card.dataset.phase = phase;
    state.toggle.checked = enabled;
    state.toggle.disabled = phase === "loading";
    state.status.dataset.state = phase;
    state.status.textContent = message || phase;
  }

  function emitState(pluginId, enabled, effectCount) {
    document.dispatchEvent(
      new CustomEvent("zoidium:plugin-state-change", {
        detail: { pluginId, enabled, effectCount },
      })
    );
  }

  function pluginIsEnabled(state) {
    return state?.card?.dataset.phase === "enabled";
  }

  function normalizeProjectPlugins(plugins) {
    if (!Array.isArray(plugins)) return [];
    const seen = new Set();
    return plugins.flatMap((plugin) => {
      const descriptor =
        typeof plugin === "string"
          ? { id: plugin }
          : plugin && typeof plugin === "object"
            ? plugin
            : null;
      if (!descriptor || typeof descriptor.id !== "string" || !descriptor.id || seen.has(descriptor.id)) {
        return [];
      }
      seen.add(descriptor.id);
      return [
        {
          id: descriptor.id,
          name: typeof descriptor.name === "string" ? descriptor.name : descriptor.id,
          version: descriptor.version == null ? "" : String(descriptor.version),
          author: typeof descriptor.author === "string" ? descriptor.author : "",
          effects: Array.isArray(descriptor.effects)
            ? descriptor.effects.filter((effect) => typeof effect === "string")
            : [],
          materials: Array.isArray(descriptor.materials)
            ? descriptor.materials.filter((material) => typeof material === "string")
            : [],
        },
      ];
    });
  }

  function findNativeFxTypes(value, found = new Set(), visited = new WeakSet()) {
    if (!value || typeof value !== "object") return found;
    if (visited.has(value)) return found;
    visited.add(value);
    if (typeof value.type === "string" && NATIVE_FX_EFFECTS.has(value.type)) {
      found.add(value.type);
    }
    if (Array.isArray(value)) {
      for (const item of value) findNativeFxTypes(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findNativeFxTypes(value[key], found, visited);
    }
    return found;
  }

  function findLayerInputFeatures(value, found = { effects: new Set(), materials: new Set() }, visited = new WeakSet()) {
    if (!value || typeof value !== "object") return found;
    if (visited.has(value)) return found;
    visited.add(value);
    if (LAYER_INPUT_EFFECT_IDS.has(value.type)) found.effects.add(value.type);
    if (value.type === LAYER_INPUT_MATERIAL_ID) found.materials.add(LAYER_INPUT_MATERIAL_ID);
    if (Array.isArray(value)) {
      for (const item of value) findLayerInputFeatures(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findLayerInputFeatures(value[key], found, visited);
    }
    return found;
  }

  function projectPluginRequirements(data) {
    const plugins = normalizeProjectPlugins(data?.plugins);
    const detectedEffects = Array.from(findNativeFxTypes(data)).sort();
    const detectedLayerInput = findLayerInputFeatures(data);
    if (detectedEffects.length === 0 && detectedLayerInput.effects.size === 0 && detectedLayerInput.materials.size === 0) {
      return plugins;
    }
    const existing = plugins.find((plugin) => plugin.id === NATIVE_FX_PLUGIN_ID);
    if (detectedEffects.length > 0 && existing) {
      existing.effects = Array.from(new Set([...existing.effects, ...detectedEffects])).sort();
    } else if (detectedEffects.length > 0) {
      plugins.push({
        id: NATIVE_FX_PLUGIN_ID,
        name: "Native FX",
        version: "",
        author: "",
        effects: detectedEffects,
        materials: [],
      });
    }
    if (detectedLayerInput.effects.size > 0 || detectedLayerInput.materials.size > 0) {
      const layerInput = plugins.find((plugin) => plugin.id === LAYER_INPUT_PLUGIN_ID);
      const effects = Array.from(detectedLayerInput.effects).sort();
      const materials = Array.from(detectedLayerInput.materials).sort();
      if (layerInput) {
        layerInput.effects = Array.from(new Set([...layerInput.effects, ...effects])).sort();
        layerInput.materials = Array.from(new Set([...layerInput.materials, ...materials])).sort();
      } else {
        plugins.push({
          id: LAYER_INPUT_PLUGIN_ID,
          name: "Layer Input",
          version: "",
          author: "Zoidium",
          effects,
          materials,
        });
      }
    }
    return plugins;
  }

  function installMissingFactoriesForRequirements(plugins) {
    for (const requested of plugins || []) {
      for (const effectId of requested.effects || []) {
        if (!effectId || PZ.effect.fnList[effectId]) continue;
        const state = pluginStates.get(requested.id);
        const manifestEffect = state?.manifest?.nativeEffects?.find(
          (effect) => effect.id === effectId
        );
        installMissingNativeFactory(
          effectId,
          manifestEffect?.name || effectId,
          {
            id: requested.id,
            name: requested.name || state?.plugin?.name || requested.id,
            version: requested.version || state?.plugin?.version || "",
            author: requested.author || state?.plugin?.author || "",
          }
        );
      }
      for (const materialId of requested.materials || []) {
        if (!materialId || PZ.material.fnList[materialId]) continue;
        const state = pluginStates.get(requested.id);
        const manifestMaterial = state?.manifest?.materialTypes?.find(
          (material) => material.id === materialId
        );
        installMissingMaterialFactory(
          materialId,
          manifestMaterial?.name || materialId,
          {
            id: requested.id,
            name: requested.name || state?.plugin?.name || requested.id,
            version: requested.version || state?.plugin?.version || "",
            author: requested.author || state?.plugin?.author || "",
          }
        );
      }
    }
  }

  async function activateProjectPlugins(project, plugins) {
    await registryReady;
    for (const requested of plugins) {
      const state = pluginStates.get(requested.id);
      if (!state) {
        window.alert(
          `このプロジェクトに必要なプラグイン「${requested.name}」${
            requested.version ? ` v${requested.version}` : ""
          }は、このZoidiumにはインストールされていません。`
        );
        continue;
      }
      if (state.card.dataset.phase === "loading" && state.enablePromise) {
        await state.enablePromise;
      }
      if (pluginIsEnabled(state)) continue;

      const installedVersion = String(state.plugin.version || "");
      const versionNote =
        requested.version && requested.version !== installedVersion
          ? `\nプロジェクトのバージョン: ${requested.version}\nインストール済み: ${installedVersion}`
          : installedVersion
            ? ` v${installedVersion}`
            : "";
      const approved = window.confirm(
        `このプロジェクトは純正Panzoid Clipmaker 3と互換性のないプラグイン「${state.plugin.name}」${versionNote}を使用しています。\n\nこのプラグインを有効にしますか？\n拒否した場合、対象エフェクトはMissing ${state.plugin.name}として保持されます。`
      );
      if (approved) await enablePlugin(state, true);
    }
    project._zoidiumPluginActivationPending = null;
  }

  function collectProjectPlugins(project) {
    const used = new Map();
    function getEntry(metadata) {
      let entry = used.get(metadata.id);
      if (!entry) {
        const installed = pluginStates.get(metadata.id)?.plugin;
        entry = {
          id: metadata.id,
          name: installed?.name || metadata.name || metadata.id,
          version: String(installed?.version || metadata.version || ""),
          author: installed?.author || metadata.author || "",
          effects: new Set(),
          materials: new Set(),
        };
        used.set(metadata.id, entry);
      }
      return entry;
    }

    for (const effect of trackedNativeEffects) {
      let belongsToProject = false;
      try {
        belongsToProject = effect.parentProject === project;
      } catch (_error) {
        // Detached effects are removed by their unload hook.
      }
      if (!belongsToProject || !effect._zoidiumPluginMetadata) continue;
      const metadata = effect._zoidiumPluginMetadata;
      const entry = getEntry(metadata);
      if (metadata.effect) entry.effects.add(metadata.effect);
    }

    for (const material of trackedPluginMaterials) {
      let belongsToProject = false;
      try {
        belongsToProject = material.parentProject === project;
      } catch (_error) {
        // Detached materials are removed by their unload hook.
      }
      if (!belongsToProject || !material._zoidiumPluginMetadata) continue;
      const metadata = material._zoidiumPluginMetadata;
      const entry = getEntry(metadata);
      if (metadata.material) entry.materials.add(metadata.material);
    }

    return Array.from(used.values(), (entry) => ({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      author: entry.author,
      effects: Array.from(entry.effects).sort(),
      materials: Array.from(entry.materials).sort(),
    })).sort((a, b) => a.id.localeCompare(b.id));
  }

  function installProjectPluginHooks() {
    if (projectHooksInstalled || !PZ.project?.prototype) return;
    projectHooksInstalled = true;

    const projectPrototype = PZ.project.prototype;
    const originalProjectToJSON = projectPrototype.toJSON;
    projectPrototype.toJSON = function () {
      const json = originalProjectToJSON.apply(this, arguments);
      const plugins = collectProjectPlugins(this);
      if (plugins.length > 0) json.plugins = plugins;
      else delete json.plugins;
      return json;
    };

    const originalProjectLoad = projectPrototype.load;
    projectPrototype.load = function (data) {
      const plugins = projectPluginRequirements(data);
      installMissingFactoriesForRequirements(plugins);
      const result = originalProjectLoad.apply(this, arguments);
      Object.defineProperty(this, "_zoidiumProjectPlugins", {
        configurable: true,
        writable: true,
        value: plugins,
      });
      if (plugins.length > 0) {
        this._zoidiumPluginActivationPending = activateProjectPlugins(this, plugins).catch((error) => {
          this._zoidiumPluginActivationPending = null;
          console.error("[Zoidium] failed to activate project plugins:", error);
        });
      }
      return result;
    };
  }

  function installEditorPluginHooks() {
    if (editorHooksInstalled || !PZ.ui?.editor?.prototype?.save) return;
    editorHooksInstalled = true;
    const originalSave = PZ.ui.editor.prototype.save;
    PZ.ui.editor.prototype.save = async function () {
      const plugins = collectProjectPlugins(this.project);
      if (
        plugins.length > 0 &&
        !window.confirm(
          `このプロジェクトは互換性のないプラグイン（${plugins
            .map((plugin) => plugin.name)
            .join(", ")}）を使用しています。\nZoidiumが必要です。\n\nこのまま保存しますか？`
        )
      ) {
        return;
      }
      return originalSave.apply(this, arguments);
    };
  }

  async function enablePlugin(state, persist) {
    if (state.enablePromise) return state.enablePromise;
    state.enablePromise = (async () => {
      updateCard(state, "loading", "Loading…");
      try {
        if (!state.manifest) {
          state.manifest = await fetchJson(state.plugin.manifest);
          validateManifest(state.plugin, state.manifest);
        }
        await registerManifest(state.plugin, state.manifest, state);
        await restoreMissingNativeEffects(state.plugin.id);
        await restoreMissingPluginMaterials(state.plugin.id);
        const featureCount = manifestFeatureCount(state.manifest);
        if (persist) persistEnabled(state.plugin.id, true);
        updateCard(state, "enabled", featureCount + " active");
        updateNativeFxUsageUi();
        emitState(state.plugin.id, true, featureCount);
      } catch (error) {
        unregisterPlugin(state.plugin.id);
        persistEnabled(state.plugin.id, false);
        updateCard(state, "error", "Load failed");
        console.error(`[Zoidium] failed to enable ${state.plugin.name}:`, error);
      } finally {
        state.enablePromise = null;
      }
    })();
    return state.enablePromise;
  }

  function disablePlugin(state, persist) {
    const inUse =
      Array.from(trackedNativeEffects).some(
        (effect) => effect._zoidiumPluginMetadata?.id === state.plugin.id
      ) ||
      Array.from(trackedPluginMaterials).some(
        (material) => material._zoidiumPluginMetadata?.id === state.plugin.id
      ) ||
      (state.runtimeModules || []).some((runtime) => runtime.isInUse?.());
    if (inUse) {
      state.toggle.checked = true;
      state.toggle.disabled = true;
      state.status.textContent = "In use by this project";
      return;
    }
    unregisterPlugin(state.plugin.id);
    if (persist) persistEnabled(state.plugin.id, false);
    updateCard(state, "disabled", "Disabled");
    emitState(state.plugin.id, false, 0);
  }

  function createPluginCard(plugin) {
    const card = document.createElement("div");
    card.className = "zoidium-plugin-entry";
    card.dataset.pluginId = plugin.id;
    card.dataset.searchText = normalizePickerLabel(
      [plugin.id, plugin.name, plugin.author, plugin.format, plugin.tagline, plugin.description, plugin.warning]
        .filter(Boolean)
        .join(" ")
    );
    card.dataset.enabled = "false";
    card.innerHTML = `
      <div class="proprow noselect zoidium-plugin-row">
        <span class="zoidium-plugin-copy">
          <span class="zoidium-plugin-name">${plugin.name}</span>
          <span class="zoidium-plugin-meta">${plugin.tagline || ""}<span class="zoidium-plugin-state" data-state="disabled" aria-hidden="true">Disabled</span></span>
        </span>
        <label class="zoidium-plugin-switch" title="Toggle ${plugin.name}">
          <input type="checkbox" role="switch" aria-label="Enable ${plugin.name}">
          <span class="zoidium-plugin-track" aria-hidden="true"></span>
        </label>
      </div>
      <div class="proprow noselect">
        <span class="zoidium-plugin-description">${plugin.description}</span>
      </div>
      ${
        plugin.warning
          ? `<div class="proprow noselect zoidium-plugin-warning-row">
        <span class="zoidium-plugin-warning">${plugin.warning}</span>
      </div>`
          : ""
      }`;

    const state = {
      plugin,
      card,
      toggle: card.querySelector("input"),
      status: card.querySelector(".zoidium-plugin-state"),
      manifest: null,
      effectCache: new Map(),
      groupCache: new Map(),
      replacedObjectTypes: [],
      runtimeModules: [],
      enablePromise: null,
    };
    pluginStates.set(plugin.id, state);

    state.toggle.addEventListener("change", () => {
      if (state.toggle.checked) enablePlugin(state, true);
      else disablePlugin(state, true);
    });
    return card;
  }

  function createPluginCategory(category) {
    const section = document.createElement("details");
    section.className = "zoidium-plugin-category";
    section.dataset.categoryId = category.id;

    const summary = document.createElement("summary");
    summary.className = "zoidium-plugin-category-title";
    summary.textContent = category.name || category.id;
    section.appendChild(summary);

    if (category.description) {
      const description = document.createElement("div");
      description.className = "zoidium-plugin-category-description";
      description.textContent = category.description;
      section.appendChild(description);
    }

    const categoryList = document.createElement("div");
    categoryList.className = "zoidium-plugin-category-list";
    section.appendChild(categoryList);
    return { section, list: categoryList };
  }

  function createPanel(registry) {
    const panel = document.createElement("section");
    panel.className = "editorpanel zoidium-plugin-panel";
    panel.setAttribute("aria-label", "Plugin Manager");
    panel.tabIndex = 0;
    panel.style.display = "none";
    panel.innerHTML = `
      <div class="proprow proptitle noselect" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; padding-right: 5px;">
        <span class="proplabel" title="Plugins" style="font-size: 18px; font-weight: bold;">Plugins</span>
      </div>
      <div class="zoidium-plugin-search">
        <input class="pz-filterbox" type="text" placeholder="type to filter" aria-label="Filter plugins">
      </div>
      <div class="zoidium-plugin-list"></div>`;

    const search = panel.querySelector(".zoidium-plugin-search .pz-filterbox");
    const list = panel.querySelector(".zoidium-plugin-list");
    const categories = new Map(
      (Array.isArray(registry.categories) ? registry.categories : [])
        .filter((category) => category && typeof category.id === "string" && category.id)
        .map((category) => [category.id, category])
    );
    const categorySections = new Map();
    for (const plugin of registry.plugins) {
      const categoryId = typeof plugin.category === "string" ? plugin.category : "";
      if (!categoryId) {
        list.appendChild(createPluginCard(plugin));
        continue;
      }
      let category = categorySections.get(categoryId);
      if (!category) {
        category = createPluginCategory(
          categories.get(categoryId) || { id: categoryId, name: categoryId }
        );
        categorySections.set(categoryId, category);
        list.appendChild(category.section);
      }
      category.list.appendChild(createPluginCard(plugin));
    }

    let categoryOpenState = null;
    const updateFilter = () => {
      const query = normalizePickerLabel(search.value);
      if (query && !categoryOpenState) {
        categoryOpenState = new Map(
          Array.from(categorySections, ([categoryId, category]) => [categoryId, category.section.open])
        );
      }

      for (const card of list.querySelectorAll(".zoidium-plugin-entry")) {
        card.hidden = Boolean(query) && !card.dataset.searchText.includes(query);
      }

      for (const [categoryId, category] of categorySections) {
        const hasVisiblePlugin = Boolean(category.list.querySelector(".zoidium-plugin-entry:not([hidden])"));
        category.section.hidden = Boolean(query) && !hasVisiblePlugin;
        if (query) category.section.open = hasVisiblePlugin;
        else if (categoryOpenState) category.section.open = categoryOpenState.get(categoryId);
      }

      if (!query) categoryOpenState = null;
    };
    search.addEventListener("input", updateFilter);
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      search.value = "";
      updateFilter();
    });

    const scheduleScrollStateSync = () => {
      requestAnimationFrame(() => syncPluginPanelScrollState(panel));
    };
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(scheduleScrollStateSync).observe(panel);
    }
    new MutationObserver(scheduleScrollStateSync).observe(panel, {
      attributes: true,
      attributeFilter: ["hidden", "open", "style"],
      childList: true,
      subtree: true,
    });
    scheduleScrollStateSync();

    return panel;
  }

  function createTab(panel) {
    const tabs = document.querySelector(".elevatortabs");
    const controls = document.querySelector(".elevatorcontrols");
    if (!tabs || !controls) throw new Error("Zoidium sidebar is unavailable");
    const elevator = tabs.parentElement?.parentElement?.pz_panel;
    if (!elevator || typeof elevator.changeTab !== "function") {
      throw new Error("Zoidium elevator controller is unavailable");
    }

    const pluginPanel = {
      title: "Plugins",
      icon: "fragment",
      el: panel,
      editor: elevator.editor,
      enabled: false,
      needsResize: false,
      resize() {},
    };

    const tab = document.createElement("a");
    tab.className = "zoidium-plugin-tab";
    tab.title = "Plugins";
    tab.pz_tab = pluginPanel;
    tab.pz_container = panel;
    tab.appendChild(PZ.ui.generateIcon("fragment"));
    const tabLabel = document.createElement("span");
    tabLabel.textContent = "Plugins";
    tab.appendChild(tabLabel);

    const aboutTab = Array.from(tabs.children).find((item) => item.title === "About");
    tabs.insertBefore(tab, aboutTab || null);
    controls.appendChild(panel);
    elevator.panels.push(pluginPanel);
    tab.onclick = elevator.buttonClick.bind(elevator);
    tab.onkeydown = elevator.buttonKeyDown;
  }

  async function initialize() {
    if (typeof PZ === "undefined" || !PZ.effect || !PZ.ui?.objectTypes) {
      setTimeout(initialize, 50);
      return;
    }
    if (document.querySelector(".zoidium-plugin-tab")) {
      settleRegistryReady();
      return;
    }

    installProjectPluginHooks();
    installEditorPluginHooks();
    PZ.zoidium = PZ.zoidium || {};
    PZ.zoidium.trackPluginMaterial = trackPluginMaterial;
    PZ.zoidium.untrackPluginMaterial = untrackPluginMaterial;
    installMissingNativeFactories();
    configureBundledLightDefault();

    try {
      const registry = await fetchJson(REGISTRY_URL);
      if (registry.schemaVersion !== 1 || !Array.isArray(registry.plugins)) {
        throw new Error("Invalid plugin registry");
      }
      const panel = createPanel(registry);
      createTab(panel);
      installEffectPickerBadges();

      for (const state of pluginStates.values()) {
        if (isPersistedEnabled(state.plugin.id)) await enablePlugin(state, false);
      }
    } catch (error) {
      console.error("[Zoidium] plugin manager failed to initialize:", error);
    } finally {
      settleRegistryReady();
    }
  }

  initialize();
})();
