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
        schedulePickerGroups();
        return;
      }
    }
  }

  function installEffectPickerBadges() {
    if (manager.effectBadgeObserver) return;
    installNativeFxSearchPriority();
    decorateEffectPicker();
    decoratePickerGroups();
    manager.effectBadgeObserver = new MutationObserver(onBodyMutations);
    manager.effectBadgeObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Collapsible picker groups ---------------------------------------------
  //
  // The object/effect add picker (ui-1.0.72.js, generateAdd) renders one
  // bare SPAN per category entry (LAYER, COLOR, ...) followed by its LI rows,
  // and rebuilds the list on open, drill-in and every search keystroke. This
  // pass decorates each heading once (focusable, clickable, chevron and row
  // count through CSS) and lays the list out again from its complete order
  // after every rebuild. A category entry marked `subcategory` (a plugin's
  // own effect categories) renders as a nested heading inside its parent.
  // Collapsed groups are detached (headings stay, nested headings go with
  // their parent), so the picker's stock arrow and Enter handlers skip them
  // with no handler of our own. Top-level groups start expanded and nested
  // ones start collapsed; both remember their state per picker. While the
  // filter box holds a query the picker lists matches only, so collapse is
  // ignored and every match stays visible. Effect pickers also list the
  // recently added effects first, as copies of their rows.
  const PICKER_COLLAPSE_PREFIX = "zoidium.picker.collapsed.";
  const PICKER_EXPANDED_PREFIX = "zoidium.picker.expanded.";
  const PICKER_RECENT_KEY = "zoidium.picker.recent.effects";
  const PICKER_RECENT_LIMIT = 8;
  const PICKER_RECENT_NAME = "RECENT";
  const PICKER_GROUP_CLASS = "zoidium-picker-group";
  const PICKER_SUBGROUP_CLASS = "zoidium-picker-subgroup";
  const pickerLayouts = new WeakMap();

  function pickerStorage() {
    try {
      const scope = typeof globalThis !== "undefined" ? globalThis : window;
      const storage = scope && scope.localStorage;
      if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") {
        return storage;
      }
    } catch (_error) {
      // Storage is unavailable: collapsing still works for this open picker.
    }
    return null;
  }

  function readStoredList(key) {
    const storage = pickerStorage();
    if (!storage) return [];
    try {
      const raw = storage.getItem(key);
      const value = raw ? JSON.parse(raw) : [];
      return Array.isArray(value) ? value.filter((name) => typeof name === "string" && name) : [];
    } catch (_error) {
      // A foreign value never collapses, expands or lists anything.
      return [];
    }
  }

  function writeStoredList(key, values) {
    const storage = pickerStorage();
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(Array.from(values)));
    } catch (_error) {
      // The state still applies to this open picker.
    }
  }

  // "effects" or "objects" from the rows' registry entries, or null when the
  // list shows neither top-level registry (a drilled-in sub-list, which has
  // no category headings anyway).
  function pickerIdentity(list) {
    if (!list || typeof PZ === "undefined") return null;
    let effects = null;
    let objects = null;
    const rows = list.children || [];
    for (const row of rows) {
      if (!row || row.tagName !== "LI" || !row.pz_item) continue;
      if (effects === null) {
        try {
          effects = getEffectTypes();
        } catch (_error) {
          effects = [];
        }
      }
      if (Array.isArray(effects) && effects.indexOf(row.pz_item) !== -1) return "effects";
      if (objects === null) {
        try {
          objects = getObjectTypes("object3d");
        } catch (_error) {
          objects = [];
        }
      }
      if (Array.isArray(objects) && objects.indexOf(row.pz_item) !== -1) return "objects";
    }
    return null;
  }

  function readPickerCollapsed(identity) {
    return new Set(identity ? readStoredList(PICKER_COLLAPSE_PREFIX + identity) : []);
  }

  function writePickerCollapsed(identity, collapsed) {
    if (identity) writeStoredList(PICKER_COLLAPSE_PREFIX + identity, collapsed);
  }

  function readPickerExpanded(identity) {
    return new Set(identity ? readStoredList(PICKER_EXPANDED_PREFIX + identity) : []);
  }

  function writePickerExpanded(identity, expanded) {
    if (identity) writeStoredList(PICKER_EXPANDED_PREFIX + identity, expanded);
  }

  function pickerFilterInput(list) {
    const panel = list && list.parentElement;
    const kids = (panel && panel.children) || [];
    for (const child of kids) {
      if (child && child.classList && child.classList.contains("pz-filterbox")) return child;
    }
    return null;
  }

  function registryFor(identity) {
    try {
      if (identity === "effects") return getEffectTypes() || [];
      if (identity === "objects") return getObjectTypes("object3d") || [];
    } catch (_error) {
      // An unavailable registry only loses nested headings.
    }
    return [];
  }

  // Stable key of an effect entry for the recent list: plugin effects by
  // plugin and effect id, CM3's own by type.
  function pickerEntryKey(entry) {
    if (!entry || typeof entry !== "object" || entry.category === true || entry.list) return null;
    if (entry._zoidiumPluginId) {
      const id = entry._zoidiumPluginEffectId ?? entry.type;
      return id === undefined || id === null ? null : `${entry._zoidiumPluginId}:${id}`;
    }
    return entry.type === undefined || entry.type === null ? null : `native:${entry.type}:${entry.name}`;
  }

  function recordPickerUse(entry) {
    const key = pickerEntryKey(entry);
    if (!key) return;
    const recent = readStoredList(PICKER_RECENT_KEY).filter((value) => value !== key);
    recent.unshift(key);
    writeStoredList(PICKER_RECENT_KEY, recent.slice(0, PICKER_RECENT_LIMIT));
  }

  function headingKey(heading, layout) {
    const info = layout.headings.get(heading);
    if (!info) return normalizePickerLabel(heading.textContent);
    return info.parent ? `${info.parent}/${info.name}` : info.name;
  }

  function isHeadingCollapsed(heading, layout) {
    const info = layout.headings.get(heading);
    if (layout.overrides.has(heading)) return layout.overrides.get(heading);
    if (info && info.parent) return !readPickerExpanded(layout.identity).has(headingKey(heading, layout));
    return readPickerCollapsed(layout.identity).has(headingKey(heading, layout));
  }

  // The complete order of a freshly rendered list. CM3 renders every entry on
  // open and re-appends all of them when the query clears; a later layout
  // pass only removes and reorders those same nodes, so a node we have not
  // seen means CM3 rebuilt the list.
  function capturePickerLayout(list, identity) {
    const kids = Array.from(list.children || []).filter((node) => !node.dataset?.zoidiumRecent);
    let layout = pickerLayouts.get(list);
    if (layout && layout.identity === identity && kids.every((node) => layout.order.includes(node))) return layout;
    const registry = registryFor(identity);
    const categories = registry.filter((entry) => entry && entry.category === true);
    const spans = kids.filter((node) => node.tagName === "SPAN");
    const headings = new Map();
    let parent = "";
    spans.forEach((span, index) => {
      const entry = categories.length === spans.length ? categories[index] : null;
      const name = normalizePickerLabel(span.textContent);
      const sub = !!(entry && entry.subcategory === true && parent);
      if (!sub) parent = name;
      headings.set(span, { name, parent: sub ? parent : "", sub });
    });
    layout = { identity, order: kids, headings, overrides: new Map(), recent: layout?.recent || null };
    pickerLayouts.set(list, layout);
    return layout;
  }

  function pickerGroupItems(heading) {
    const list = heading && heading.parentElement;
    const layout = list && pickerLayouts.get(list);
    const order = layout ? layout.order : Array.from((list && list.children) || []);
    const info = layout && layout.headings.get(heading);
    const items = [];
    for (let index = order.indexOf(heading) + 1; index < order.length; index += 1) {
      const node = order[index];
      if (node.tagName === "SPAN") {
        const next = layout && layout.headings.get(node);
        // A top-level group spans its nested groups; a nested group ends at
        // the next heading of any level.
        if (!info || info.sub || !next || !next.sub) break;
        continue;
      }
      if (node.tagName === "LI") items.push(node);
    }
    return items;
  }

  function recentRows(list, layout) {
    if (layout.identity !== "effects" || typeof document === "undefined" || !document.createElement) return [];
    const byKey = new Map();
    for (const node of layout.order) {
      if (node.tagName !== "LI" || !node.pz_item) continue;
      const key = pickerEntryKey(node.pz_item);
      if (key && !byKey.has(key)) byKey.set(key, node);
    }
    const keys = readStoredList(PICKER_RECENT_KEY).filter((key) => byKey.has(key));
    if (!keys.length) return [];
    let recent = layout.recent;
    if (!recent || recent.keys.join("\u0000") !== keys.join("\u0000")) {
      const heading = recent?.heading || document.createElement("span");
      heading.textContent = PICKER_RECENT_NAME;
      heading.dataset.zoidiumRecent = "1";
      const rows = keys.map((key) => {
        const source = byKey.get(key);
        const copy = source.cloneNode(true);
        copy.pz_item = source.pz_item;
        copy.onclick = source.onclick;
        copy.onmousedown = source.onmousedown;
        copy.dataset.zoidiumRecent = "1";
        return copy;
      });
      recent = layout.recent = { keys, heading, rows };
      layout.headings.set(heading, { name: normalizePickerLabel(PICKER_RECENT_NAME), parent: "", sub: false });
    }
    return [recent.heading, ...recent.rows];
  }

  // Lay the list out from its complete order: collapsed groups detach their
  // rows, a collapsed top-level group also detaches its nested headings.
  function applyPickerGroups(list) {
    const layout = pickerLayouts.get(list) || capturePickerLayout(list, pickerIdentity(list));
    const recent = recentRows(list, layout);
    const desired = [];
    let topCollapsed = false;
    let subCollapsed = false;
    const visit = (node) => {
      if (node.tagName === "SPAN") {
        const info = layout.headings.get(node);
        const collapsed = isHeadingCollapsed(node, layout);
        if (info && info.sub) {
          if (topCollapsed) return;
          subCollapsed = collapsed;
        } else {
          topCollapsed = collapsed;
          subCollapsed = false;
        }
        node.classList.toggle(`${PICKER_GROUP_CLASS}--collapsed`, collapsed);
        node.classList.toggle(PICKER_SUBGROUP_CLASS, !!(info && info.sub));
        node.setAttribute("aria-expanded", collapsed ? "false" : "true");
        node.setAttribute("data-zoidium-count", String(pickerGroupItems(node).length || ""));
        desired.push(node);
        return;
      }
      if (!topCollapsed && !subCollapsed) desired.push(node);
    };
    for (const node of recent) visit(node);
    if (recent.length) {
      // The recent copies are counted by their own rows.
      recent[0].setAttribute("data-zoidium-count", String(recent.length - 1));
    }
    for (const node of layout.order) visit(node);
    const current = Array.from(list.children || []);
    if (current.length === desired.length && current.every((node, index) => node === desired[index])) return;
    for (const node of current) list.removeChild(node);
    for (const node of desired) list.appendChild(node);
  }

  // Direct control for one heading in the open picker (stored state is left
  // untouched; togglePickerGroup persists).
  function setPickerGroupCollapsed(list, heading, collapse) {
    const layout = pickerLayouts.get(list) || capturePickerLayout(list, pickerIdentity(list));
    layout.overrides.set(heading, !!collapse);
    applyPickerGroups(list);
  }

  function decoratePickerHeading(list, heading) {
    if (heading.dataset.zoidiumPickerGroup) return;
    heading.dataset.zoidiumPickerGroup = "1";
    heading.classList.add(PICKER_GROUP_CLASS);
    heading.setAttribute("tabindex", "0");
    heading.setAttribute("role", "button");
    heading.addEventListener("click", () => togglePickerGroup(heading.parentElement || list, heading));
    heading.addEventListener("keydown", (event) => {
      if (!event || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      event.stopPropagation();
      togglePickerGroup(heading.parentElement || list, heading);
    });
  }

  function togglePickerGroup(list, heading) {
    const layout = pickerLayouts.get(list) || capturePickerLayout(list, pickerIdentity(list));
    const collapse = !isHeadingCollapsed(heading, layout);
    layout.overrides.delete(heading);
    const info = layout.headings.get(heading);
    const key = headingKey(heading, layout);
    if (info && info.sub) {
      const expanded = readPickerExpanded(layout.identity);
      if (collapse) expanded.delete(key);
      else expanded.add(key);
      writePickerExpanded(layout.identity, expanded);
    } else {
      const collapsed = readPickerCollapsed(layout.identity);
      if (collapse) collapsed.add(key);
      else collapsed.delete(key);
      writePickerCollapsed(layout.identity, collapsed);
    }
    applyPickerGroups(list);
  }

  function watchPickerUse(list) {
    if (list.dataset.zoidiumPickerUse || typeof list.addEventListener !== "function") return;
    list.dataset.zoidiumPickerUse = "1";
    // Capture: the row's own handler replaces the picker with the editor.
    list.addEventListener("click", (event) => {
      const row = event?.target?.closest?.("li");
      if (row && row.pz_item && pickerIdentity(list) === "effects") recordPickerUse(row.pz_item);
    }, true);
  }

  // One decoration pass over a single picker list. Search output holds only
  // matches: they are attached by the picker itself, so every match shows
  // regardless of collapse. The full list decorates its headings and lays
  // the groups out again.
  function decoratePickerList(list) {
    if (!list) return;
    const filter = pickerFilterInput(list);
    if (filter && String(filter.value || "").trim() !== "") return;
    const identity = pickerIdentity(list);
    if (!identity) return;
    const layout = capturePickerLayout(list, identity);
    watchPickerUse(list);
    applyPickerGroups(list);
    // Nested headings inside a collapsed group are detached; decorate them too.
    const headings = layout.recent ? [layout.recent.heading, ...layout.order] : layout.order;
    for (const child of headings) {
      if (child && child.tagName === "SPAN") decoratePickerHeading(list, child);
    }
  }

  function decoratePickerGroups() {
    if (typeof document === "undefined") return;
    document.querySelectorAll(".pz-options").forEach(decoratePickerList);
  }

  function schedulePickerGroups() {
    if (manager.pickerGroupUpdateScheduled) return;
    manager.pickerGroupUpdateScheduled = true;
    requestAnimationFrame(() => {
      manager.pickerGroupUpdateScheduled = false;
      try {
        decoratePickerGroups();
      } catch (error) {
        manager.reportFailureOnce("picker groups", "decorate picker groups", error);
      }
    });
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

  // A plugin's effects under its category heading. Effects that name their
  // own `category` (a shader pack's internal groups) follow nested headings,
  // sorted by name; uncategorized effects come first.
  function categorizedEffectEntries(header, items, categoryOf) {
    const loose = [];
    const groups = new Map();
    for (const item of items) {
      const category = String(categoryOf(item) || "").trim();
      if (!category) loose.push(item);
      else {
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(item);
      }
    }
    const names = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, "en"));
    const entries = [header, ...loose];
    // "AFTERCLIP · SHADERS · WARP" under AFTERCLIP reads as "SHADERS · WARP".
    const parent = normalizePickerLabel(header?.name);
    const shown = (name) => {
      const parts = name.split(/\s*·\s*/);
      return parts.length > 1 && parent.startsWith(normalizePickerLabel(parts[0])) ? parts.slice(1).join(" · ") : name;
    };
    for (const name of names) {
      entries.push({ name: shown(name), category: true, subcategory: true, _zoidiumPluginId: header._zoidiumPluginId }, ...groups.get(name));
    }
    return entries;
  }

  // Insert a heading and its entries. A heading that already exists (CM3's
  // own COLOR, or another plugin's NATIVE FX) takes the entries at the end of
  // its group instead of appearing twice in the picker.
  function insertEffectEntries(effects, entries) {
    const [header, ...items] = entries;
    const name = normalizePickerLabel(header?.name);
    const existing = effects.findIndex(
      (entry) => entry && entry.category === true && entry.subcategory !== true && normalizePickerLabel(entry.name) === name
    );
    if (!header || header.category !== true || existing < 0) {
      effects.splice(insertionIndex(effects), 0, ...entries);
      return;
    }
    let end = existing + 1;
    while (end < effects.length && !(effects[end]?.category === true && effects[end].subcategory !== true)) end += 1;
    effects.splice(end, 0, ...items);
  }

  // Removing a plugin keeps a heading that other entries still sit under,
  // handing it to the next owner; nested headings left empty go with it.
  function keepsSharedHeading(entries, index, pluginId) {
    const heading = entries[index];
    if (heading?.category !== true || heading.subcategory === true) return false;
    for (let next = index + 1; next < entries.length; next += 1) {
      const entry = entries[next];
      if (entry?.category === true && entry.subcategory !== true) break;
      if (entry && entry.category !== true && entry._zoidiumPluginId !== pluginId) {
        heading._zoidiumPluginId = entry._zoidiumPluginId;
        if (!entry._zoidiumPluginId) delete heading._zoidiumPluginId;
        return true;
      }
    }
    return false;
  }

  // END manager body
  Object.assign(manager, { getEffectTypes, getMaterialTypes, normalizePickerLabel, createEffectUuid, ensureEffectEntryUuid, ensureEffectEntryIds, syncPluginPanelScrollState, pickerCategoryForItem, pluginBadgeRgba, addEffectLookupEntry, buildEffectPickerLookup, findEffectPickerEntry, decorateEffectPicker, scheduleEffectPickerBadges, isNativeFxSearchEntry, prioritizeNativeFxResults, installNativeFxSearchPriority, isPickerMutation, onBodyMutations, installEffectPickerBadges, pickerIdentity, readPickerCollapsed, writePickerCollapsed, pickerGroupItems, setPickerGroupCollapsed, decoratePickerHeading, togglePickerGroup, applyPickerGroups, watchPickerUse, decoratePickerList, decoratePickerGroups, schedulePickerGroups, getObjectTypes, configureBundledLightDefault, insertionIndex, categorizedEffectEntries, insertEffectEntries, keepsSharedHeading, readPickerExpanded, writePickerExpanded, recordPickerUse, pickerEntryKey, capturePickerLayout });
})();
