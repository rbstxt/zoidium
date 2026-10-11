// Plugin manager: picker. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = window.ZoidiumPluginManagerInternals;
  const { EFFECT_UUID_PROPERTY, NATIVE_FX_PLUGIN_ID, DEFAULT_PLUGIN_COLORS, pluginStates, effectUuidByEntry } = manager;

  // BEGIN manager body 387
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
        // Identity generation can fall back to random bytes without cryptographic guarantees.
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
    if (manager.effectBadgeUpdateScheduled) return;
    manager.effectBadgeUpdateScheduled = true;
    requestAnimationFrame(() => {
      manager.effectBadgeUpdateScheduled = false;
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
    if (manager.nativeFxSearchPatched) return;
    const scope = typeof globalThis !== "undefined" ? globalThis : window;
    const FuseApi = scope ? scope.Fuse : null;
    const originalSearch =
      FuseApi && FuseApi.prototype && FuseApi.prototype.search;
    if (typeof originalSearch !== "function") return;
    manager.nativeFxSearchPatched = true;
    FuseApi.prototype.search = function () {
      const results = originalSearch.apply(
        this,
        Array.prototype.slice.call(arguments)
      );
      try {
        return prioritizeNativeFxResults(results);
      } catch (_error) {
        manager.reportFailureOnce("picker search", "prioritize picker search results", _error);
        return results;
      }
    };
  }

  // The body-wide observer sees every DOM change in the editor. Only mutations
  // that touch an open picker list (.pz-options) can add rows, so everything
  // else is ignored instead of rebuilding the whole effect lookup.
  function isPickerMutation(record) {
    const target = record.target;
    if (target && target.nodeType === Node.ELEMENT_NODE && target.closest(".pz-options")) {
      return true;
    }
    if (target && target.nodeType === Node.TEXT_NODE && target.parentElement?.closest(".pz-options")) {
      return true;
    }
    for (const node of record.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches(".pz-options") || node.querySelector(".pz-options")) return true;
    }
    return false;
  }

  function onBodyMutations(records) {
    for (const record of records) {
      if (isPickerMutation(record)) {
        scheduleEffectPickerBadges();
        return;
      }
    }
  }

  function installEffectPickerBadges() {
    if (manager.effectBadgeObserver) return;
    installNativeFxSearchPriority();
    decorateEffectPicker();
    manager.effectBadgeObserver = new MutationObserver(onBodyMutations);
    manager.effectBadgeObserver.observe(document.body, { childList: true, subtree: true });
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

  // END manager body
  Object.assign(manager, { getEffectTypes, getMaterialTypes, normalizePickerLabel, createEffectUuid, ensureEffectEntryUuid, ensureEffectEntryIds, syncPluginPanelScrollState, pickerCategoryForItem, pluginBadgeRgba, addEffectLookupEntry, buildEffectPickerLookup, findEffectPickerEntry, decorateEffectPicker, scheduleEffectPickerBadges, isNativeFxSearchEntry, prioritizeNativeFxResults, installNativeFxSearchPriority, isPickerMutation, onBodyMutations, installEffectPickerBadges, getObjectTypes, configureBundledLightDefault, insertionIndex });
})();
