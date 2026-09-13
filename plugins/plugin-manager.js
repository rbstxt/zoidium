(function () {
  "use strict";

  const REGISTRY_URL = "./plugins/registry.json?v=30";
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
    ["colorcurves", "Color Curves"],
    ["echo", "Echo"],
    ["dropshadow", "Drop Shadow"],
    ["timeoffset", "Time Offset"],
    ["posterizetime", "Posterize Time"],
  ]);
  const DEFAULT_PLUGIN_COLORS = Object.freeze({
    "easing-plus": "#384668",
    "native-fx": "#c56b3d",
    "light-plus": "#2f9b86",
    "alipfx-shader-pack-4": "#a04ed1",
    afterclip: "#d35a76",
    "player-plus": "#4f7dbf",
    "layer-input": "#4f9db6",
    "geometry-plus": "#6b86c5",
    "particles-plus": "#6b5b8f",
  });
  const pluginStates = new Map();
  const pluginGroups = [];
  const pluginGroupByPluginId = new Map();
  const trackedNativeEffects = new Set();
  const missingNativeEffects = new Set();
  const trackedPluginMaterials = new Set();
  const missingPluginMaterials = new Set();
  const trackedPluginObjects = new Set();
  const missingPluginObjects = new Set();
  const trackedPluginResources = new Set();
  const missingPluginResources = new Set();
  const effectUuidByEntry = new WeakMap();
  let projectHooksInstalled = false;
  let editorHooksInstalled = false;
  let effectBadgeObserver = null;
  let effectBadgeUpdateScheduled = false;
  let nativeFxSearchPatched = false;
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

  function isExplicitlyDisabled(pluginId) {
    try {
      return localStorage.getItem(storageKey(pluginId)) === "false";
    } catch (_error) {
      return false;
    }
  }

  // Plugins flagged "defaultEnabled" in the registry start enabled on first
  // run; an explicit persisted choice always wins over the default.
  function shouldStartEnabled(plugin) {
    // Hidden core plugins always run: they are not shown in the panel, never
    // persisted, and cannot be disabled.
    if (plugin.alwaysEnabled === true || plugin.visibility === "hidden") return true;
    if (isExplicitlyDisabled(plugin.id)) return false;
    if (isPersistedEnabled(plugin.id)) return true;
    return plugin.defaultEnabled === true;
  }

  function isSaveApprovalRemembered(pluginId) {
    try {
      return (
        localStorage.getItem(`zoidium.plugin.saveApproved.${pluginId}`) === "true"
      );
    } catch (_error) {
      return false;
    }
  }

  function rememberSaveApproval(pluginId) {
    try {
      localStorage.setItem(
        `zoidium.plugin.saveApproved.${pluginId}`,
        "true"
      );
    } catch (_error) {
      // Ask again on the next save if persistence is unavailable.
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
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.json();
  }

  async function fetchText(url) {
    const response = await fetch(url, { cache: "default" });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.text();
  }

  function pluginAssetKey(url) {
    const source = String(url || "").split(/[?#]/, 1)[0].replace(/\\/g, "/");
    return `/${source.replace(/^\.\//, "").replace(/^\/+/, "")}`;
  }

  function getPluginAsset(assets, kind, url) {
    if (!assets || !assets[kind] || typeof assets[kind] !== "object") return undefined;
    const map = assets[kind];
    const key = pluginAssetKey(url);
    if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
    if (Object.prototype.hasOwnProperty.call(map, url)) return map[url];
    return undefined;
  }

  function createPluginAssetResolver(assets) {
    return (kind, url) => getPluginAsset(assets, kind, url);
  }

  function bundledText(assets, url, description) {
    const value = getPluginAsset(assets, "text", url);
    if (typeof value !== "string") {
      throw new Error(`Missing bundled text asset: ${description || url}`);
    }
    return value;
  }

  function bundledJson(assets, url, description) {
    const value = getPluginAsset(assets, "json", url);
    if (!value || typeof value !== "object") {
      throw new Error(`Missing bundled JSON asset: ${description || url}`);
    }
    return value;
  }

  function validateManifest(plugin, manifest) {
    if (manifest.schemaVersion !== 1 || manifest.id !== plugin.id) {
      throw new Error(`Invalid plugin manifest: ${plugin.id}`);
    }
    const effects = manifest.effects || [];
    const groups = manifest.groups || [];
    const objectTypes = manifest.objectTypes || [];
    const objectClasses = manifest.objectClasses || [];
    const nativeEffects = manifest.nativeEffects || [];
    const materialTypes = manifest.materialTypes || [];
    const modules = manifest.modules || [];
    const resources = manifest.resources || [];
    const objectClassParent = manifest.objectClassParent;
    if (
      !Array.isArray(effects) ||
      !Array.isArray(groups) ||
      !Array.isArray(objectTypes) ||
      !Array.isArray(objectClasses) ||
      !Array.isArray(nativeEffects) ||
      !Array.isArray(materialTypes) ||
      !Array.isArray(modules) ||
      !Array.isArray(resources)
    ) {
      throw new Error(`Invalid plugin features: ${plugin.id}`);
    }
    if (
      objectClassParent != null &&
      (typeof objectClassParent !== "object" ||
        Array.isArray(objectClassParent) ||
        typeof objectClassParent.name !== "string" ||
        !objectClassParent.name.trim() ||
        typeof objectClassParent.type !== "number")
    ) {
      throw new Error(`Invalid 3D object class parent in ${plugin.id}`);
    }
    if (
      effects.length === 0 &&
      groups.length === 0 &&
      objectTypes.length === 0 &&
      objectClasses.length === 0 &&
      nativeEffects.length === 0 &&
      materialTypes.length === 0 &&
      modules.length === 0 &&
      resources.length === 0 &&
      manifest.kind !== "core"
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
    for (const resource of resources) {
      if (
        !resource.id ||
        !resource.source ||
        !["text", "json", "image"].includes(resource.type)
      ) {
        throw new Error(`Invalid resource entry in ${plugin.id}`);
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
        const validVariantType =
          typeof item.type === "number" ||
          (typeof item.type === "string" &&
            item.type.startsWith(`zoidium:${plugin.id}/`) &&
            /^zoidium:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(item.type));
        if (!item.name || !validVariantType || !item.data) {
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
    for (const objectClass of objectClasses) {
      if (
        !objectClass ||
        typeof objectClass.type !== "string" ||
        !/^zoidium:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(objectClass.type) ||
        !objectClass.type.startsWith(`zoidium:${plugin.id}/`) ||
        !objectClass.name ||
        (objectClass.schemaVersion != null &&
          (!Number.isInteger(objectClass.schemaVersion) || objectClass.schemaVersion < 1))
      ) {
        throw new Error(`Invalid 3D object class entry in ${plugin.id}`);
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
    installNativeFxSearchPriority();
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

  function isNativeFxSearchEntry(value) {
    const entry =
      value && typeof value === "object" && "item" in value ? value.item : value;
    return !!entry && entry._zoidiumPluginId === NATIVE_FX_PLUGIN_ID;
  }

  function prioritizeNativeFxResults(results) {
    if (!Array.isArray(results) || results.length < 2) return results;
    let nativeCount = 0;
    for (const item of results) {
      if (isNativeFxSearchEntry(item)) nativeCount += 1;
    }
    if (nativeCount === 0 || nativeCount === results.length) return results;
    const native = [];
    const rest = [];
    for (const item of results) {
      if (isNativeFxSearchEntry(item)) native.push(item);
      else rest.push(item);
    }
    return [...native, ...rest];
  }

  function installNativeFxSearchPriority() {
    if (nativeFxSearchPatched) return;
    const scope = typeof globalThis !== "undefined" ? globalThis : window;
    const FuseApi = scope ? scope.Fuse : null;
    const originalSearch =
      FuseApi && FuseApi.prototype && FuseApi.prototype.search;
    if (typeof originalSearch !== "function") return;
    nativeFxSearchPatched = true;
    FuseApi.prototype.search = function () {
      const results = originalSearch.apply(
        this,
        Array.prototype.slice.call(arguments)
      );
      try {
        return prioritizeNativeFxResults(results);
      } catch (_error) {
        return results;
      }
    };
  }

  function installEffectPickerBadges() {
    if (effectBadgeObserver) return;
    installNativeFxSearchPriority();
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

  function createLazyEffectData(plugin, effect, cache, assets) {
    return async function () {
      if (!cache.has(effect.id)) {
        if (assets) {
          cache.set(
            effect.id,
            Promise.resolve().then(() => {
              const preset = cloneJson(bundledJson(assets, effect.preset, `effect preset ${effect.id}`));
              const shader = bundledText(assets, effect.shader, `effect shader ${effect.id}`);
              if (preset.type !== 1 || !preset.properties) {
                throw new Error(`Invalid shader preset: ${effect.id}`);
              }
              preset.properties.fragShader = `${shader.replace(/\s+$/, "")}\n${createPluginMarker(
                plugin,
                effect
              )}\n`;
              return preset;
            })
          );
        } else {
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
      // Group presets reference shaders without the ?v asset version that
      // manifest URLs carry, so match on the normalized key as well.
      const reference = value._zoidiumShader;
      const shader =
        shaderByPath.get(reference) !== undefined
          ? shaderByPath.get(reference)
          : shaderByPath.get(pluginAssetKey(reference));
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

  // Index group shaders by both the raw manifest URL and the normalized
  // asset key so versioned (?v=) manifest entries match the unversioned
  // _zoidiumShader references stored inside group presets.
  function indexGroupShaders(shaderEntries) {
    const byPath = new Map();
    for (const [source, text] of shaderEntries) {
      byPath.set(source, text);
      byPath.set(pluginAssetKey(source), text);
    }
    return byPath;
  }

  async function loadGroupData(plugin, group, cache, assets) {
    if (!cache.has(group.id)) {
      if (assets) {
        cache.set(
          group.id,
          Promise.resolve().then(() => {
            const preset = cloneJson(bundledJson(assets, group.preset, `group preset ${group.id}`));
            const shaderEntries = (group.shaders || []).map((source) => [
              source,
              bundledText(assets, source, `group shader ${group.id}`),
            ]);
            if (preset.type !== 0 || !preset.properties || !Array.isArray(preset.objects)) {
              throw new Error(`Invalid group preset: ${group.id}`);
            }
            return hydrateGroupShaders(preset, indexGroupShaders(shaderEntries), plugin, group);
          })
        );
      } else {
        cache.set(
          group.id,
          Promise.all([
            fetchJson(group.preset),
            ...(group.shaders || []).map(async (source) => [source, await fetchText(source)]),
          ]).then(([preset, ...shaderEntries]) => {
            if (preset.type !== 0 || !preset.properties || !Array.isArray(preset.objects)) {
              throw new Error(`Invalid group preset: ${group.id}`);
            }
            const shaders = indexGroupShaders(shaderEntries);
            return hydrateGroupShaders(preset, shaders, plugin, group);
          })
        );
      }
    }
    return cloneJson(await cache.get(group.id));
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function setPluginUsageUi(state, inUse) {
    // Hidden plugins (Zoidium Core) have no panel card.
    if (!state.card || !state.toggle) return;
    state.toggle.disabled = inUse;
  }

  function updateNativeFxUsageUi() {
    const state = pluginStates.get(NATIVE_FX_PLUGIN_ID);
    if (!state || !pluginIsEnabled(state)) return;
    setPluginUsageUi(state, trackedNativeEffects.size > 0);
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

  // Native effect sources ship inside plugin bundles while the API surface
  // they run against ships in the extension shell (zoidium/plugin-apis.js).
  // The two are versioned independently, so a stale shell can evaluate a
  // newer bundle. That used to surface as an uncaught
  // "Cannot read properties of undefined (reading 'call')" from inside the
  // evaluated source. Detect the skew up front when the manifest declares
  // it, and contain any other evaluation failure, so the effect degrades to
  // an explicit placeholder instead of breaking effect loading.
  function nativeEffectMissingApis(requiresApis, apis) {
    if (!Array.isArray(requiresApis) || requiresApis.length === 0) return [];
    const missing = [];
    for (const name of requiresApis) {
      if (typeof name !== "string" || !name) continue;
      if (!apis || apis[name] === undefined) missing.push(name);
    }
    return missing;
  }

  function describeNativeEffectSkew(plugin, manifestEffect, missingApis, error) {
    const pluginName = plugin?.name || plugin?.id || "Unknown plugin";
    const pluginVersion = plugin?.version ? ` v${plugin.version}` : "";
    const cause =
      missingApis && missingApis.length > 0
        ? `missing extension APIs: ${missingApis.join(", ")}`
        : `failed to start: ${error?.message || error}`;
    return `"${manifestEffect?.name || manifestEffect?.id}" from ${pluginName}${pluginVersion} could not start (${cause}). Refresh to update the Zoidium extension layer, then try again.`;
  }

  function applyIncompatibleNativeEffect(effect, plugin, manifestEffect, missingApis, error) {
    const metadata = getNativeEffectMetadata(
      plugin,
      manifestEffect,
      manifestEffect?.id,
      manifestEffect?.name
    );
    const message = describeNativeEffectSkew(plugin, manifestEffect, missingApis, error);
    effect._zoidiumIncompatibleNativeFx = true;
    effect._zoidiumIncompatibleDetail = message;
    effect.properties.add("incompatibleRuntime", {
      name: "Incompatible Runtime",
      readOnly: true,
      type: PZ.property.type.TEXT,
      value: message,
    });
    effect.load = function (data) {
      effect._zoidiumMissingData = cloneJson(data || { type: manifestEffect?.id });
      effect.properties.name.set(`Incompatible ${metadata.name}: ${metadata.effectName}`);
      effect.properties.incompatibleRuntime.load();
      trackNativeEffect(effect, metadata, true);
      console.error(`[Zoidium] ${message}`, error || "");
    };
    effect.toJSON = function () {
      return cloneJson(effect._zoidiumMissingData || { type: manifestEffect?.id });
    };
    effect.update = function () {};
    effect.resize = function () {};
    effect.prepare = async function () {};
    effect.unload = function () {
      untrackNativeEffect(effect);
    };
  }

  function installIncompatibleNativeFactory(plugin, manifestEffect, missingApis, error) {
    const type = manifestEffect?.id;
    if (!type) return;
    const message = describeNativeEffectSkew(plugin, manifestEffect, missingApis, error);
    console.error(`[Zoidium] ${message}`, error || "");
    setNativeFactory(
      type,
      function () {
        applyIncompatibleNativeEffect(this, plugin, manifestEffect, missingApis, error);
      },
      "incompatible"
    );
  }

  function registerNativeFactory(plugin, effect, source, getAsset) {
    const apisScope = typeof globalThis !== "undefined" ? globalThis : window;
    const missingApis = nativeEffectMissingApis(
      effect.requiresApis,
      apisScope?.ZoidiumPluginApis
    );
    if (missingApis.length > 0) {
      installIncompatibleNativeFactory(plugin, effect, missingApis, null);
      return;
    }
    setNativeFactory(
      effect.id,
      function () {
        const instance = this;
        instance._zoidiumGetAsset = getAsset;
        try {
          new Function(source).call(instance);
        } catch (error) {
          applyIncompatibleNativeEffect(instance, plugin, effect, [], error);
          return;
        }
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

  function updatePluginObjectUsageUi(pluginId) {
    const state = pluginStates.get(pluginId);
    if (!state || !pluginIsEnabled(state)) return;
    const inUse = Array.from(trackedPluginObjects).some(
      (object) => object._zoidiumPluginMetadata?.id === pluginId && !missingPluginObjects.has(object)
    );
    setPluginUsageUi(state, inUse);
  }

  function trackPluginObject(object, metadata, missing) {
    if (!metadata?.id) return;
    object._zoidiumPluginMetadata = metadata;
    trackedPluginObjects.add(object);
    if (missing) missingPluginObjects.add(object);
    else missingPluginObjects.delete(object);
    updatePluginObjectUsageUi(metadata.id);
  }

  function untrackPluginObject(object, metadata) {
    trackedPluginObjects.delete(object);
    missingPluginObjects.delete(object);
    updatePluginObjectUsageUi(metadata?.id || object._zoidiumPluginMetadata?.id);
  }

  function updatePluginResourceUsageUi(pluginId) {
    const state = pluginStates.get(pluginId);
    if (!state || !pluginIsEnabled(state)) return;
    const inUse = Array.from(trackedPluginResources).some(
      (resource) =>
        resource._zoidiumPluginResourceMetadata?.id === pluginId &&
        !missingPluginResources.has(resource)
    );
    setPluginUsageUi(state, inUse);
  }

  function trackPluginResource(resource, metadata, missing) {
    if (!resource || !metadata?.id) return;
    resource._zoidiumPluginResourceMetadata = metadata;
    trackedPluginResources.add(resource);
    if (missing) missingPluginResources.add(resource);
    else missingPluginResources.delete(resource);
    updatePluginResourceUsageUi(metadata.id);
  }

  function untrackPluginResource(resource, metadata) {
    if (!resource) return;
    trackedPluginResources.delete(resource);
    missingPluginResources.delete(resource);
    updatePluginResourceUsageUi(
      metadata?.id || resource._zoidiumPluginResourceMetadata?.id
    );
  }

  function installObject3DUsageTracker() {
    const registry = PZ.zoidium?.object3d;
    if (!registry?.setUsageTracker) return;
    registry.setUsageTracker({
      track: trackPluginObject,
      untrack: untrackPluginObject,
    });
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

  async function loadPluginPackage(plugin) {
    if (typeof plugin.bundle === "string" && plugin.bundle.trim()) {
      const bundle = await fetchJson(plugin.bundle);
      if (
        !bundle ||
        bundle.schemaVersion !== 1 ||
        !bundle.manifest ||
        !bundle.assets ||
        typeof bundle.assets !== "object" ||
        Array.isArray(bundle.assets)
      ) {
        throw new Error(`Invalid plugin bundle: ${plugin.id}`);
      }
      if (bundle.manifest.id !== plugin.id) {
        throw new Error(`Plugin bundle id mismatch: ${plugin.id}`);
      }
      validateManifest(plugin, bundle.manifest);
      return { manifest: bundle.manifest, assets: bundle.assets };
    }

    if (typeof plugin.manifest !== "string" || !plugin.manifest.trim()) {
      throw new Error(`Plugin has no bundle or manifest: ${plugin.id}`);
    }
    const manifest = await fetchJson(plugin.manifest);
    validateManifest(plugin, manifest);
    return { manifest, assets: null };
  }

  function loadPluginPackageForState(state) {
    if (!state.packagePromise) {
      state.packagePromise = loadPluginPackage(state.plugin).catch((error) => {
        state.packagePromise = null;
        throw error;
      });
    }
    return state.packagePromise;
  }

  async function registerManifest(plugin, manifest, state) {
    const getAsset = createPluginAssetResolver(state.bundleAssets);
    if (state.runtimeModules.length === 0) {
      const sources = await Promise.all(
        (manifest.modules || []).map(async (definition) => [
          definition,
          state.bundleAssets
            ? bundledText(state.bundleAssets, definition.source, `module ${definition.id}`)
            : await fetchText(definition.source),
        ])
      );
      for (const [definition, source] of sources) {
        const module = { exports: {} };
        new Function("module", "exports", "plugin", source)(module, module.exports, plugin);
        const runtime = module.exports;
        if (!runtime || typeof runtime.activate !== "function") {
          throw new Error(`Plugin module has no activate() export: ${definition.id}`);
        }
        await runtime.activate({
          plugin,
          manifest,
          apis: window.ZoidiumPluginApis || null,
          editor: window.CM,
          PZ,
          document,
          window,
          getAsset,
          object3d: PZ.zoidium?.object3d?.forPlugin?.(plugin, manifest, getAsset) || null,
        });
        state.runtimeModules.push(runtime);
      }
    }

    const effects = getEffectTypes();
    if (!effects.some((entry) => entry?._zoidiumPluginId === plugin.id)) {
      const pluginEffects = manifest.effects || [];
      const pluginGroups = manifest.groups || [];
      if (pluginEffects.length > 0 || pluginGroups.length > 0) {
        const groupData = await Promise.all(
          pluginGroups.map((group) =>
            loadGroupData(plugin, group, state.groupCache, state.bundleAssets)
          )
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
            data: createLazyEffectData(plugin, effect, state.effectCache, state.bundleAssets),
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
        nativeEffects.map(async (effect) => [
          effect,
          state.bundleAssets
            ? bundledText(state.bundleAssets, effect.source, `native effect ${effect.id}`)
            : await fetchText(effect.source),
        ])
      );
      for (const [effect, source] of sources) {
        registerNativeFactory(plugin, effect, source, getAsset);
      }
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

    const objectClasses = manifest.objectClasses || [];
    const objectClassParent = manifest.objectClassParent;
    const objectClassEntries = getObjectTypes("object3d");
    const objectClassMenuEntryAlreadyRegistered = objectClassEntries.some(
      (entry) =>
        entry?._zoidiumPluginId === plugin.id && entry?._zoidiumPluginObjectClass
    ) || objectClassEntries.some(
      (entry) =>
        Array.isArray(entry?.list) &&
        entry.list.some(
          (item) =>
            item?._zoidiumPluginId === plugin.id && item?._zoidiumPluginObjectClass
        )
    );
    if (
      objectClasses.length > 0 &&
      !objectClassMenuEntryAlreadyRegistered
    ) {
      const objectClassMenuItems = objectClasses.map((objectClass) => {
        const data = cloneJson(objectClass.defaultData || {});
        if (!data.type) data.type = objectClass.type;
        if (!data.schemaVersion) data.schemaVersion = objectClass.schemaVersion || 1;
        return {
          name: objectClass.name,
          desc: objectClass.description || `${objectClass.name} — ${manifest.name}`,
          type: objectClass.type,
          data,
          _zoidiumPluginId: plugin.id,
          _zoidiumPluginObjectClass: true,
          _zoidiumPluginObjectId: objectClass.id || objectClass.type.split("/").pop(),
        };
      });
      if (objectClassParent) {
        const parent = objectClassEntries.find(
          (entry) =>
            (!entry?._zoidiumPluginId || entry?._zoidiumPluginId === plugin.id) &&
            entry?.name === objectClassParent.name &&
            entry?.type === objectClassParent.type
        );
        if (!parent || !Array.isArray(parent.list)) {
          throw new Error(
            `3D object class parent was not found for ${plugin.id}: ${objectClassParent.name}`
          );
        }
        const existingTypes = new Set(
          parent.list.map((item) => item?.type).filter((type) => typeof type === "string")
        );
        parent.list.push(
          ...objectClassMenuItems.filter((item) => !existingTypes.has(item.type))
        );
      } else {
        objectClassEntries.push(
          {
            name: manifest.objectCategory || manifest.name,
            category: true,
            _zoidiumPluginId: plugin.id,
            _zoidiumPluginObjectClass: true,
          },
          ...objectClassMenuItems
        );
      }
    }
    if (effectBadgeObserver) scheduleEffectPickerBadges();
  }

  function unregisterPlugin(pluginId) {
    const registries = [getEffectTypes(), getMaterialTypes(), PZ.ui.objectTypes.get(PZ.object3d)];
    for (const entries of registries) {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (Array.isArray(entry?.list)) {
          for (let itemIndex = entry.list.length - 1; itemIndex >= 0; itemIndex -= 1) {
            if (entry.list[itemIndex]?._zoidiumPluginId === pluginId) {
              entry.list.splice(itemIndex, 1);
            }
          }
        }
        if (entry?._zoidiumPluginId === pluginId) entries.splice(index, 1);
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
    try {
      PZ.zoidium?.object3d?.unregisterPlugin?.(pluginId);
    } catch (error) {
      console.error(`[Zoidium] failed to unregister 3D object classes for ${pluginId}:`, error);
    }
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
    const objectClassCount = (manifest.objectClasses || []).length;
    const materialCount = (manifest.materialTypes || []).length;
    return (
      effectCount +
      groupCount +
      nativeEffectCount +
      objectCount +
      objectClassCount +
      materialCount +
      (manifest.modules || []).length
    );
  }

  function updateCard(state, phase) {
    // Hidden plugins (Zoidium Core) have no panel card; track the phase on
    // the state so the debug log still reports them.
    if (!state.card) {
      state.phase = phase;
      return;
    }
    const enabled = phase === "enabled";
    state.card.dataset.enabled = String(enabled);
    state.card.dataset.phase = phase;
    state.toggle.checked = enabled;
    state.toggle.disabled = phase === "loading";
    // Keep the pack master switch in step with single-plugin toggles.
    syncGroupForPlugin(state.plugin.id);
  }

  function emitState(pluginId, enabled, effectCount) {
    document.dispatchEvent(
      new CustomEvent("zoidium:plugin-state-change", {
        detail: { pluginId, enabled, effectCount },
      })
    );
  }

  function pluginIsEnabled(state) {
    if (!state) return false;
    if (!state.card) return state.phase === "enabled";
    return state.card.dataset.phase === "enabled";
  }

  function debugErrorSummary(error) {
    const summary = {
      name: String(error?.name || "Error"),
      message: String(error?.message || error || "Unknown error"),
    };
    if (error?.stack) summary.stack = String(error.stack);
    if (error?.code != null) summary.code = String(error.code);
    return summary;
  }

  function rememberPluginError(state, operation, error) {
    if (!state) return;
    state.lastError = {
      operation,
      at: new Date().toISOString(),
      ...debugErrorSummary(error),
    };
  }

  function getDebugPlugins() {
    return Array.from(pluginStates.values(), (state) => ({
      id: state.plugin.id,
      name: state.plugin.name,
      version: String(state.plugin.version || ""),
      author: state.plugin.author || "",
      kind: state.manifest?.kind || state.plugin.kind || null,
      visibility: state.plugin.visibility || state.manifest?.visibility || "visible",
      hidden: (state.plugin.visibility || state.manifest?.visibility) === "hidden" || !state.card,
      enabled: pluginIsEnabled(state),
      phase: state.card ? state.card.dataset.phase || "disabled" : state.phase || "disabled",
      persistedEnabled: isPersistedEnabled(state.plugin.id),
      featureCount: state.manifest ? manifestFeatureCount(state.manifest) : null,
      lastError: state.lastError || null,
    })).sort((a, b) => a.id.localeCompare(b.id));
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
          objects: Array.isArray(descriptor.objects)
            ? descriptor.objects.filter((object) => typeof object === "string")
            : [],
          sprites: Array.isArray(descriptor.sprites)
            ? descriptor.sprites.filter((sprite) => typeof sprite === "string")
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
    if (typeof value.type === "string") {
      const parsed = parsePluginObjectType(value.type);
      if (parsed) {
        if (!found.has(parsed.pluginId)) found.set(parsed.pluginId, new Set());
        found.get(parsed.pluginId).add(parsed.objectId);
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) findPluginObjectTypes(item, found, visited);
    } else {
      for (const key of Object.keys(value)) findPluginObjectTypes(value[key], found, visited);
    }
    return found;
  }

  function projectPluginRequirements(data) {
    const plugins = normalizeProjectPlugins(data?.plugins);
    const detectedEffects = Array.from(findNativeFxTypes(data)).sort();
    const detectedLayerInput = findLayerInputFeatures(data);
    const detectedObjectTypes = findPluginObjectTypes(data);
    if (
      detectedEffects.length === 0 &&
      detectedLayerInput.effects.size === 0 &&
      detectedLayerInput.materials.size === 0 &&
      detectedObjectTypes.size === 0
    ) {
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
    for (const [pluginId, objectTypes] of detectedObjectTypes) {
      const objects = Array.from(objectTypes).sort();
      const objectPlugin = plugins.find((plugin) => plugin.id === pluginId);
      if (objectPlugin) {
        objectPlugin.objects = Array.from(new Set([...objectPlugin.objects, ...objects])).sort();
      } else {
        plugins.push({
          id: pluginId,
          name: pluginId,
          version: "",
          author: "",
          effects: [],
          materials: [],
          objects,
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
        const versionSuffix = requested.version ? ` v${requested.version}` : "";
        window.alert(
          `This project requires the plugin "${requested.name}"${versionSuffix}, which is not installed in this Zoidium.`
        );
        continue;
      }
      if (state.card && state.card.dataset.phase === "loading" && state.enablePromise) {
        await state.enablePromise;
      }
      if (pluginIsEnabled(state)) continue;

      const installedVersion = String(state.plugin.version || "");
      const versionNote =
        requested.version && requested.version !== installedVersion
          ? `\nProject version: ${requested.version}\nInstalled: ${installedVersion}`
          : installedVersion
            ? ` v${installedVersion}`
            : "";
      const approved = window.confirm(
        `This project uses the plugin "${state.plugin.name}"${versionNote}, which is not compatible with vanilla Panzoid Clipmaker 3.\n\nEnable this plugin?\nIf you decline, the affected effects are kept as Missing ${state.plugin.name}.`
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
          objects: new Set(),
          sprites: new Set(),
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

    for (const object of trackedPluginObjects) {
      let belongsToProject = false;
      try {
        belongsToProject = object.parentProject === project;
      } catch (_error) {
        // Detached objects are removed by their unload hook.
      }
      if (!belongsToProject || !object._zoidiumPluginMetadata) continue;
      const metadata = object._zoidiumPluginMetadata;
      const entry = getEntry(metadata);
      if (metadata.object) entry.objects.add(metadata.object);
    }

    for (const resource of trackedPluginResources) {
      let belongsToProject = false;
      try {
        belongsToProject = resource.parentProject === project;
      } catch (_error) {
        // Detached resources are removed by their unload hook.
      }
      if (!belongsToProject || !resource._zoidiumPluginResourceMetadata) continue;
      const metadata = resource._zoidiumPluginResourceMetadata;
      const entry = getEntry(metadata);
      if (metadata.sprite) entry.sprites.add(metadata.sprite);
    }

    return Array.from(used.values(), (entry) => {
      const descriptor = {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        author: entry.author,
        effects: Array.from(entry.effects).sort(),
        materials: Array.from(entry.materials).sort(),
        objects: Array.from(entry.objects).sort(),
      };
      if (entry.sprites.size > 0) descriptor.sprites = Array.from(entry.sprites).sort();
      return descriptor;
    }).sort((a, b) => a.id.localeCompare(b.id));
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
      const unacknowledged = plugins.filter(
        (plugin) => !isSaveApprovalRemembered(plugin.id)
      );
      if (unacknowledged.length > 0) {
        const names = unacknowledged
          .map((plugin) => plugin.name)
          .join(", ");
        const approved = window.confirm(
          `This project uses plugin(s) incompatible with vanilla Panzoid Clipmaker 3 (${names}).\nZoidium is required.\n\nSave anyway?`
        );
        if (!approved) return;
        for (const plugin of unacknowledged) rememberSaveApproval(plugin.id);
      }
      return originalSave.apply(this, arguments);
    };
  }

  async function enablePlugin(state, persist) {
    if (state.enablePromise) return state.enablePromise;
    state.enablePromise = (async () => {
      updateCard(state, "loading");
      try {
        if (!state.manifest) {
          const pluginPackage = await loadPluginPackageForState(state);
          state.manifest = pluginPackage.manifest;
          state.bundleAssets = pluginPackage.assets;
        }
        await registerManifest(state.plugin, state.manifest, state);
        await PZ.zoidium?.object3d?.restoreMissing?.(state.plugin.id);
        await restoreMissingNativeEffects(state.plugin.id);
        await restoreMissingPluginMaterials(state.plugin.id);
        const featureCount = manifestFeatureCount(state.manifest);
        state.lastError = null;
        if (persist) persistEnabled(state.plugin.id, true);
        updateCard(state, "enabled");
        updateNativeFxUsageUi();
        updatePluginObjectUsageUi(state.plugin.id);
        updatePluginResourceUsageUi(state.plugin.id);
        emitState(state.plugin.id, true, featureCount);
      } catch (error) {
        unregisterPlugin(state.plugin.id);
        // Hidden core plugins are never persisted; avoid writing a
        // disabled flag that shouldStartEnabled must ignore anyway.
        if (state.plugin.visibility !== "hidden" && state.plugin.alwaysEnabled !== true) {
          persistEnabled(state.plugin.id, false);
        }
        rememberPluginError(state, "enable", error);
        updateCard(state, "error");
        console.error(`[Zoidium] failed to enable ${state.plugin.name}:`, error);
      } finally {
        state.enablePromise = null;
      }
    })();
    return state.enablePromise;
  }

  function disablePlugin(state, persist) {
    // Hidden core plugins cannot be disabled; there is no toggle for them.
    if (!state) return;
    if (state.plugin.alwaysEnabled === true || state.plugin.visibility === "hidden" || !state.card) return;
    const inUse =
      Array.from(trackedNativeEffects).some(
        (effect) => effect._zoidiumPluginMetadata?.id === state.plugin.id
      ) ||
      Array.from(trackedPluginMaterials).some(
        (material) => material._zoidiumPluginMetadata?.id === state.plugin.id
      ) ||
      Array.from(trackedPluginObjects).some(
        (object) =>
          object._zoidiumPluginMetadata?.id === state.plugin.id &&
          !missingPluginObjects.has(object)
      ) ||
      Array.from(trackedPluginResources).some(
        (resource) =>
          resource._zoidiumPluginResourceMetadata?.id === state.plugin.id &&
          !missingPluginResources.has(resource)
      ) ||
      (state.runtimeModules || []).some((runtime) => runtime.isInUse?.());
    if (inUse) {
      state.toggle.checked = true;
      state.toggle.disabled = true;
      return;
    }
    unregisterPlugin(state.plugin.id);
    if (persist) persistEnabled(state.plugin.id, false);
    updateCard(state, "disabled");
    emitState(state.plugin.id, false, 0);
  }

  function compatBadgeHtml(plugin) {
    // Only an explicit zoidiumOnly flag marks a plugin as Zoidium-only.
    // warning text is advisory (migration notices, experimental caveats) and
    // must not change the compatibility badge on its own.
    if (plugin.zoidiumOnly === true) {
      return `<span class="zoidium-plugin-compat" data-compat="zoidium" title="${
        plugin.warning ||
        "Requires Zoidium; not compatible with vanilla Panzoid Clipmaker 3."
      }">Zoidium only</span>`;
    }
    return `<span class="zoidium-plugin-compat" data-compat="cm3" title="Usable in vanilla Panzoid Clipmaker 3">CM3 compatible</span>`;
  }

  function experimentalBadgeHtml(plugin) {
    return plugin.category === "experimental"
      ? `<span class="zoidium-plugin-experimental-badge" title="Contains experimental features">Experimental</span>`
      : "";
  }

  // Shared switch markup for plugin rows and group master switches. Group
  // switches drop role="switch" so a native checkbox can expose the mixed
  // (indeterminate) state of a partially enabled group.
  function pluginSwitchHtml(options) {
    const config = options || {};
    const role = config.role === false ? "" : ` role="${config.role || "switch"}"`;
    return `<label class="zoidium-plugin-switch" title="${config.title || ""}">
          <input type="checkbox"${role} aria-label="${config.ariaLabel || config.title || ""}">
          <span class="zoidium-plugin-track" aria-hidden="true"></span>
        </label>`;
  }

  function createPluginCard(plugin) {
    const card = document.createElement("div");
    card.className = "zoidium-plugin-entry";
    card.dataset.pluginId = plugin.id;
    card.dataset.searchText = normalizePickerLabel(
      [
        plugin.id,
        plugin.name,
        plugin.author,
        plugin.format,
        plugin.tagline,
        plugin.description,
        plugin.credits,
        plugin.warning,
      ]
        .filter(Boolean)
        .join(" ")
    );
    card.dataset.enabled = String(shouldStartEnabled(plugin));
    card.innerHTML = `
      <details class="zp-detail-body">
        <summary class="proprow noselect zoidium-plugin-row">
          <span class="zoidium-plugin-copy">
            <span class="zoidium-plugin-name">${plugin.name}${compatBadgeHtml(plugin)}${experimentalBadgeHtml(plugin)}</span>
            <span class="zoidium-plugin-meta">${plugin.tagline || ""}</span>
          </span>
          <span class="zp-detail-switch">${pluginSwitchHtml({
            title: `Toggle ${plugin.name}`,
            ariaLabel: `Enable ${plugin.name}`,
          })}</span>
        </summary>
        <div class="zp-detail-content">
          <span class="zoidium-plugin-description">${plugin.description}</span>
          ${
            plugin.credits
              ? `<span class="zoidium-plugin-credits">${plugin.credits}</span>`
              : ""
          }
        </div>
        ${
          plugin.warning
            ? `<div class="zoidium-plugin-warning-row">
          <span class="zoidium-plugin-warning">${plugin.warning}</span>
        </div>`
            : ""
        }
      </details>`;

    const state = {
      plugin,
      card,
      toggle: card.querySelector("input"),
      manifest: null,
      bundleAssets: null,
      packagePromise: null,
      effectCache: new Map(),
      groupCache: new Map(),
      replacedObjectTypes: [],
      runtimeModules: [],
      enablePromise: null,
      lastError: null,
    };
    pluginStates.set(plugin.id, state);
    state.toggle.checked = shouldStartEnabled(plugin);

    card.querySelector(".zp-detail-switch").addEventListener("click", (event) => {
      // The switch sits inside <summary>; keep clicks from folding the entry.
      event.stopPropagation();
    });
    state.toggle.addEventListener("change", () => {
      if (state.toggle.checked) enablePlugin(state, true);
      else disablePlugin(state, true);
    });
    return card;
  }

  // Hidden plugins (Zoidium Core) never appear in the panel. They still get
  // a state entry so the debug log reports them and startup enables them.
  function createHiddenPluginState(plugin) {
    const state = {
      plugin,
      card: null,
      toggle: null,
      phase: "disabled",
      manifest: null,
      bundleAssets: null,
      packagePromise: null,
      effectCache: new Map(),
      groupCache: new Map(),
      replacedObjectTypes: [],
      runtimeModules: [],
      enablePromise: null,
      lastError: null,
    };
    pluginStates.set(plugin.id, state);
    return state;
  }

  // ---- plugin groups -------------------------------------------------
  //
  // The panel renders one collapsible section per registry category, and
  // each section carries a master switch that enables or disables every
  // plugin inside it. Group membership and order come from registry.json
  // (categories[] order, then registry order inside a category), so adding a
  // plugin to a pack stays a registry-only change.

  // Group tallies follow the card's own phase, falling back to the initial
  // data-enabled flag before the first enable/disable pass writes a phase.
  function pluginEnabledForGroup(state) {
    if (!state) return false;
    if (!state.card) return state.phase === "enabled";
    if (state.card.dataset.phase) return state.card.dataset.phase === "enabled";
    return state.card.dataset.enabled === "true";
  }

  function createGroupSection(category) {
    const section = document.createElement("details");
    section.className = "zoidium-plugin-category";
    section.dataset.categoryId = category.id;
    // Packs open by default; a category may opt into starting folded.
    section.open = category.collapsed !== true;
    section.innerHTML = `
      <summary class="noselect">
        <span class="zoidium-plugin-category-heading">
          <span class="zoidium-plugin-category-name">${category.name}</span>
          <span class="zoidium-plugin-category-count"></span>
        </span>
        <span class="zoidium-plugin-category-switch">${pluginSwitchHtml({
          role: false,
          title: `Toggle every plugin in ${category.name}`,
          ariaLabel: `Enable every plugin in ${category.name}`,
        })}</span>
      </summary>
      ${
        category.description
          ? `<div class="zoidium-plugin-category-description"${
              category.warning === true ? ' data-tone="warning"' : ""
            }>${category.description}</div>`
          : ""
      }
      <div class="zoidium-plugin-category-list"></div>`;
    return section;
  }

  function createPluginGroup(category) {
    const section = createGroupSection(category);
    const group = {
      id: category.id,
      name: category.name,
      section,
      list: section.querySelector(".zoidium-plugin-category-list"),
      toggle: section.querySelector(".zoidium-plugin-category-switch input"),
      count: section.querySelector(".zoidium-plugin-category-count"),
      members: [],
      busy: false,
      openBeforeSearch: null,
    };
    group.toggle.addEventListener("change", () => {
      setGroupEnabled(group, group.toggle.checked);
    });
    // The master switch sits inside <summary>; keep clicks from folding the
    // section, exactly like the per-plugin switches.
    section
      .querySelector(".zoidium-plugin-category-switch")
      .addEventListener("click", (event) => {
        event.stopPropagation();
      });
    pluginGroups.push(group);
    return group;
  }

  function syncGroupSwitch(group) {
    const total = group.members.length;
    const on = group.members.filter(pluginEnabledForGroup).length;
    group.toggle.disabled = group.busy;
    group.toggle.checked = total > 0 && on === total;
    group.toggle.indeterminate = on > 0 && on < total;
    group.count.textContent = total === 0 ? "" : `${on} of ${total} on`;
  }

  function syncGroupForPlugin(pluginId) {
    const group = pluginGroupByPluginId.get(pluginId);
    if (group) syncGroupSwitch(group);
  }

  // Enables or disables a whole pack. Plugins in use by the current project
  // refuse to unload (see disablePlugin) and leave the master switch mixed.
  async function setGroupEnabled(group, enabled) {
    if (group.busy || group.members.length === 0) return;
    group.busy = true;
    syncGroupSwitch(group);
    try {
      for (const state of group.members) {
        if (enabled) {
          if (!pluginEnabledForGroup(state)) await enablePlugin(state, true);
        } else if (pluginEnabledForGroup(state)) {
          disablePlugin(state, true);
        }
      }
    } finally {
      group.busy = false;
      syncGroupSwitch(group);
    }
  }

  function createPanel(registry) {
    const panel = document.createElement("section");
    panel.className = "editorpanel zoidium-plugin-panel";
    panel.setAttribute("aria-label", "Plugin Manager");
    panel.tabIndex = 0;
    panel.style.display = "none";
    // Page headers share one builder so Plugins and Restore render the
    // same CM3 proprow/proptitle chrome. ZoidiumUI always loads before the
    // plugin manager (see postInitScripts in zoidium/runtime-config.js).
    panel.appendChild(ZoidiumUI.createPageHeader("Plugins"));
    panel.insertAdjacentHTML("beforeend", `<div class="zoidium-plugin-list"></div>`);

    // The filter search row shares one builder so every panel list
    // filters the same way.
    const list = panel.querySelector(".zoidium-plugin-list");
    const box = ZoidiumUI.createSearchBox({ placeholder: "type to filter", ariaLabel: "Filter plugins" });
    panel.insertBefore(box.wrap, list);
    const search = box.input;

    pluginGroups.length = 0;
    pluginGroupByPluginId.clear();
    const groupsById = new Map();
    for (const category of Array.isArray(registry.categories) ? registry.categories : []) {
      if (!category || typeof category.id !== "string" || !category.id) continue;
      if (groupsById.has(category.id)) continue;
      const group = createPluginGroup(category);
      groupsById.set(category.id, group);
      list.appendChild(group.section);
    }
    // A plugin whose category is missing or unknown still renders, in a
    // trailing section named after the raw value, instead of disappearing.
    const groupForPlugin = (plugin) => {
      const categoryId =
        typeof plugin.category === "string" && plugin.category ? plugin.category : "other";
      let group = groupsById.get(categoryId);
      if (!group) {
        group = createPluginGroup({
          id: categoryId,
          name: categoryId === "other" ? "Other" : categoryId,
        });
        groupsById.set(categoryId, group);
        list.appendChild(group.section);
      }
      return group;
    };

    for (const plugin of registry.plugins) {
      if (plugin.visibility === "hidden" || plugin.alwaysEnabled === true) {
        createHiddenPluginState(plugin);
        continue;
      }
      const group = groupForPlugin(plugin);
      group.list.appendChild(createPluginCard(plugin));
      group.members.push(pluginStates.get(plugin.id));
      pluginGroupByPluginId.set(plugin.id, group);
    }

    for (const group of pluginGroups) {
      if (group.members.length === 0) group.section.remove();
      else syncGroupSwitch(group);
    }

    // Groups with no matching entry disappear while filtering, and a match
    // inside a folded section is revealed instead of staying hidden.
    const syncGroupSearchState = () => {
      const query = String(search.value || "").trim();
      for (const group of pluginGroups) {
        if (!group.section.isConnected) continue;
        const visible = Array.from(group.list.children).filter((entry) => !entry.hidden).length;
        group.section.hidden = visible === 0;
        if (query) {
          if (group.openBeforeSearch === null) group.openBeforeSearch = group.section.open;
          if (visible > 0) group.section.open = true;
        } else if (group.openBeforeSearch !== null) {
          group.section.open = group.openBeforeSearch;
          group.openBeforeSearch = null;
        }
      }
    };
    ZoidiumUI.attachSearchFilter(search, list, { onUpdate: syncGroupSearchState });

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
    // Elevator tab chrome lives in the shared UI kit, which always loads
    // before the plugin manager (see postInitScripts in
    // zoidium/runtime-config.js).
    const tab = ZoidiumUI.createMenubarTab({
      title: "Plugins",
      icon: "fragment",
      panel,
      tabClass: "zoidium-plugin-tab",
    });
    if (!tab) throw new Error("Zoidium sidebar is unavailable");
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
    PZ.zoidium.define("getDebugPlugins", getDebugPlugins, "plugin-manager");
    installObject3DUsageTracker();
    PZ.zoidium.define("trackPluginMaterial", trackPluginMaterial, "plugin-manager");
    PZ.zoidium.define("untrackPluginMaterial", untrackPluginMaterial, "plugin-manager");
    PZ.zoidium.define("trackPluginResource", trackPluginResource, "plugin-manager");
    PZ.zoidium.define("untrackPluginResource", untrackPluginResource, "plugin-manager");
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

      const startupStates = Array.from(pluginStates.values()).filter((state) =>
        shouldStartEnabled(state.plugin)
      );
      await Promise.all(
        startupStates.map(async (state) => {
          try {
            await loadPluginPackageForState(state);
          } catch (error) {
            rememberPluginError(state, "preload", error);
            console.error(`[Zoidium] failed to preload ${state.plugin.name}:`, error);
          }
        })
      );
      for (const state of startupStates) {
        if (shouldStartEnabled(state.plugin)) await enablePlugin(state, false);
      }
    } catch (error) {
      console.error("[Zoidium] plugin manager failed to initialize:", error);
    } finally {
      settleRegistryReady();
    }
  }

  initialize();
})();
