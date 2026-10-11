// Plugin manager: panel. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = window.ZoidiumPluginManagerInternals;
  const { DEFAULT_IN_USE_REASON, NATIVE_FX_PLUGIN_ID, pluginStates, pluginGroups, pluginGroupByPluginId, trackedNativeEffects, trackedPluginMaterials, trackedPluginObjects, missingPluginObjects, trackedPluginResources, missingPluginResources } = manager;
  const shouldStartEnabled = (...args) => manager.shouldStartEnabled(...args);
  const persistEnabled = (...args) => manager.persistEnabled(...args);
  const normalizePickerLabel = (...args) => manager.normalizePickerLabel(...args);
  const syncPluginPanelScrollState = (...args) => manager.syncPluginPanelScrollState(...args);
  const ownedByActiveProject = (...args) => manager.ownedByActiveProject(...args);
  const setPluginUsageUi = (...args) => manager.setPluginUsageUi(...args);
  const onLockedSwitchPointerDown = (...args) => manager.onLockedSwitchPointerDown(...args);
  const updateNativeFxUsageUi = (...args) => manager.updateNativeFxUsageUi(...args);
  const restoreMissingNativeEffects = (...args) => manager.restoreMissingNativeEffects(...args);
  const updatePluginObjectUsageUi = (...args) => manager.updatePluginObjectUsageUi(...args);
  const updatePluginResourceUsageUi = (...args) => manager.updatePluginResourceUsageUi(...args);
  const restoreMissingPluginMaterials = (...args) => manager.restoreMissingPluginMaterials(...args);
  const loadPluginPackageForState = (...args) => manager.loadPluginPackageForState(...args);
  const registerManifest = (...args) => manager.registerManifest(...args);
  const unregisterPlugin = (...args) => manager.unregisterPlugin(...args);
  const manifestFeatureCount = (...args) => manager.manifestFeatureCount(...args);
  const updateCard = (...args) => manager.updateCard(...args);
  const emitState = (...args) => manager.emitState(...args);
  const pluginIsEnabled = (...args) => manager.pluginIsEnabled(...args);
  const rememberPluginError = (...args) => manager.rememberPluginError(...args);
  const restoreMissingNumericObjects = (...args) => manager.restoreMissingNumericObjects(...args);
  const restoreMissingNumericLayers = (...args) => manager.restoreMissingNumericLayers(...args);

  // BEGIN manager body 2998
  async function enablePlugin(state, persist) {
    if (state.disablePromise) await state.disablePromise;
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
        closeOpenAddPickers();
        await PZ.zoidium?.object3d?.restoreMissing?.(state.plugin.id);
        await restoreMissingNativeEffects(state.plugin.id);
        await restoreMissingPluginMaterials(state.plugin.id);
        await restoreMissingNumericObjects(state.plugin.id);
        await restoreMissingNumericLayers(state.plugin.id);
        const featureCount = manifestFeatureCount(state.manifest);
        state.lastError = null;
        if (persist) persistEnabled(state.plugin.id, true);
        updateCard(state, "enabled");
        updateNativeFxUsageUi();
        updatePluginObjectUsageUi(state.plugin.id);
        updatePluginResourceUsageUi(state.plugin.id);
        emitState(state.plugin.id, true, featureCount);
      } catch (error) {
        await unregisterPlugin(state.plugin.id);
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

  async function disablePlugin(state, persist) {
    // Hidden core plugins cannot be disabled; there is no toggle for them.
    if (!state) return;
    if (state.disablePromise) return state.disablePromise;
    if (state.plugin.alwaysEnabled === true || state.plugin.visibility === "hidden" || !state.card) return;
    // Reserve the transition before awaiting activation. Concurrent requests
    // must join this cleanup rather than starting a second unregister pass.
    state.disablePromise = (async () => {
      if (state.enablePromise) await state.enablePromise;
      const reason = pluginUsageReason(state);
      if (reason) {
        // Refused: keep the plugin on, lock the switch, and say why.
        setPluginUsageUi(state, true, reason);
        state.toggle.checked = true;
        ZoidiumUI.notify({ title: state.plugin.name, message: reason });
        return;
      }
      updateCard(state, "loading");
      await unregisterPlugin(state.plugin.id);
      if (persist) persistEnabled(state.plugin.id, false);
      updateCard(state, "disabled");
      emitState(state.plugin.id, false, 0);
    })();
    try {
      await state.disablePromise;
    } finally {
      state.disablePromise = null;
    }
  }

  // Shown when a plugin's own module does not say why it is in use.

  // Why the plugin cannot be disabled right now, or "" when it can.
  function pluginUsageReason(state) {
    for (const runtime of state.runtimeModules || []) {
      if (runtime.isInUse?.()) return runtime.inUseReason?.() || DEFAULT_IN_USE_REASON;
    }
    const pluginId = state.plugin.id;
    // Native FX hosts every native effect, whichever plugin declared it.
    const hostsAllNativeEffects = pluginId === NATIVE_FX_PLUGIN_ID;
    const inUse =
      Array.from(trackedNativeEffects).some((effect) =>
        ownedByActiveProject(effect) &&
        (hostsAllNativeEffects || effect._zoidiumPluginMetadata?.id === pluginId)) ||
      Array.from(trackedPluginMaterials).some((material) =>
        ownedByActiveProject(material) && material._zoidiumPluginMetadata?.id === pluginId) ||
      Array.from(trackedPluginObjects).some(
        (object) => ownedByActiveProject(object) &&
          object._zoidiumPluginMetadata?.id === pluginId && !missingPluginObjects.has(object)
      ) ||
      Array.from(trackedPluginResources).some(
        (resource) => ownedByActiveProject(resource) &&
          resource._zoidiumPluginResourceMetadata?.id === pluginId && !missingPluginResources.has(resource)
      );
    return inUse ? DEFAULT_IN_USE_REASON : "";
  }

  // Re-derives every enabled plugin's switch lock. Runs when the editor swaps
  // projects (New, Open, Restore): the previous project's items stop counting,
  // so their switches unlock without waiting for another item event.
  function refreshPluginUsageLocks() {
    for (const state of pluginStates.values()) {
      if (!state.card || !state.toggle || !pluginIsEnabled(state)) continue;
      if (state.card.dataset.phase === "loading") continue;
      const reason = pluginUsageReason(state);
      setPluginUsageUi(state, Boolean(reason), reason);
    }
  }

  // CM3's add picker builds its rows from the registry when it opens, so the
  // entries this plugin just registered are missing from an open picker. The
  // picker is closed instead; its Cancel button restores the editor's list and
  // the next open shows the current registry.
  function closeOpenAddPickers() {
    if (typeof document === "undefined") return;
    document.querySelectorAll("input.pz-filterbox").forEach((input) => {
      const panel = input.parentElement;
      if (!panel || !Array.from(panel.children).some((child) => child.classList.contains("pz-options"))) return;
      const cancel = Array.from(panel.querySelectorAll("button")).find(
        (button) => button.textContent.trim() === "Cancel"
      );
      if (cancel) cancel.click();
    });
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
    card.querySelector(".zp-detail-switch").addEventListener("pointerdown", () => {
      onLockedSwitchPointerDown(state);
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
          await disablePlugin(state, true);
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

  // END manager body
  Object.assign(manager, { enablePlugin, disablePlugin, pluginUsageReason, refreshPluginUsageLocks, closeOpenAddPickers, compatBadgeHtml, experimentalBadgeHtml, pluginSwitchHtml, createPluginCard, createHiddenPluginState, pluginEnabledForGroup, createGroupSection, createPluginGroup, syncGroupSwitch, syncGroupForPlugin, setGroupEnabled, createPanel, createTab });
})();
