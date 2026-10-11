// Plugin manager: lifecycle. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = window.ZoidiumPluginManagerInternals;
  const evaluatePluginSource = (...args) => manager.evaluatePluginSource(...args);
  const { pluginStates, pluginGroups, trackedNativeEffects, missingNativeEffects, trackedPluginMaterials, missingPluginMaterials, trackedPluginObjects, missingPluginObjects, trackedPluginResources, missingPluginResources } = manager;
  const isPersistedEnabled = (...args) => manager.isPersistedEnabled(...args);
  const fetchText = (...args) => manager.fetchText(...args);
  const createPluginAssetResolver = (...args) => manager.createPluginAssetResolver(...args);
  const bundledText = (...args) => manager.bundledText(...args);
  const getEffectTypes = (...args) => manager.getEffectTypes(...args);
  const getMaterialTypes = (...args) => manager.getMaterialTypes(...args);
  const ensureEffectEntryIds = (...args) => manager.ensureEffectEntryIds(...args);
  const scheduleEffectPickerBadges = (...args) => manager.scheduleEffectPickerBadges(...args);
  const getObjectTypes = (...args) => manager.getObjectTypes(...args);
  const insertionIndex = (...args) => manager.insertionIndex(...args);
  const createLazyEffectData = (...args) => manager.createLazyEffectData(...args);
  const loadGroupData = (...args) => manager.loadGroupData(...args);
  const syncUsageTooltip = (...args) => manager.syncUsageTooltip(...args);
  const installMissingNativeFactory = (...args) => manager.installMissingNativeFactory(...args);
  const registerNativeFactory = (...args) => manager.registerNativeFactory(...args);
  const installMissingMaterialFactory = (...args) => manager.installMissingMaterialFactory(...args);
  const syncGroupForPlugin = (...args) => manager.syncGroupForPlugin(...args);

  // BEGIN manager body 1424
  function createModuleLifecycle(pluginId) {
    const cleanups = [];
    let disposed = false;
    return {
      onDispose(cleanup) {
        if (typeof cleanup !== "function") throw new TypeError("Plugin cleanup must be a function.");
        if (disposed) throw new Error("Plugin lifecycle has already ended.");
        cleanups.push(cleanup);
        return cleanup;
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        for (const cleanup of cleanups.splice(0).reverse()) {
          try {
            await cleanup();
          } catch (error) {
            console.error(`[Zoidium] failed to clean up ${pluginId}:`, error);
          }
        }
      },
    };
  }

  // Plugin-scoped access to the shared floating windows. Windows opened
  // through context.ui close automatically when the plugin is disabled.
  function createModuleUi(plugin, lifecycle) {
    const owned = new Set();
    lifecycle.onDispose(() => {
      for (const win of Array.from(owned)) win.close();
      owned.clear();
    });
    // Registrations are released on disable, in reverse order.
    const owns = (release) => {
      if (typeof release === "function") lifecycle.onDispose(release);
      return release;
    };
    const skinId = (name) => `${plugin.id}:${name || "default"}`;
    function openWindow(options) {
      const config = Object.assign({}, options || {});
      config.id = `${plugin.id}:${config.id || "window"}`;
      if (config.persistKey) config.persistKey = `${plugin.id}:${config.persistKey}`;
      if (config.skin) config.skin = skinId(config.skin);
      const win = ZoidiumUI.openWindow(config);
      if (win && !owned.has(win)) {
        owned.add(win);
        win.onClose(() => owned.delete(win));
      }
      return win;
    }
    return Object.freeze({
      get controls() {
        return ZoidiumUI.controls;
      },
      notify: (detail) => ZoidiumUI.notify(detail),
      confirm: (options) => ZoidiumUI.confirm(options),
      getWindow: (id) => ZoidiumUI.getWindow(`${plugin.id}:${id}`),
      openWindow,
      // Scoped stylesheet for this plugin's windows: openWindow({ skin: name }).
      registerSkin: (name, css) => owns(ZoidiumUI.registerSkin(skinId(name), css)),
      // Sidebar panel with the standard page chrome; removed on disable.
      sidePanel(options) {
        const panel = ZoidiumUI.createSidePanel(Object.assign({}, options, {
          tabClass: (options && options.tabClass) || `zoidium-side-panel-${plugin.id}`,
        }));
        if (panel) owns(() => panel.remove());
        return panel;
      },
      // Native CM3 property rows for a list or a subset of an object's
      // properties. Dispose it in the window's mount cleanup.
      properties: (options) => ZoidiumUI.properties(options),
      registerEditor: (spec) => owns(ZoidiumUI.registerEditor(spec)),
      // Re-evaluates editor match() after a property that it reads changes.
      refreshEditors: () => ZoidiumUI.refreshEditors?.(),
      openAttributePanel: (target, spec) => ZoidiumUI.openAttributePanel(target, spec, openWindow),
      registerAttributePanel: (spec) => owns(ZoidiumUI.registerAttributePanel(spec, openWindow)),
    });
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
        evaluatePluginSource(source, ["module", "exports", "plugin"], [module, module.exports, plugin]);
        const runtime = module.exports;
        if (!runtime || typeof runtime.activate !== "function") {
          throw new Error(`Plugin module has no activate() export: ${definition.id}`);
        }
        const lifecycle = createModuleLifecycle(plugin.id);
        let deactivated = false;
        // Own the module before it can mutate the host or throw midway.
        state.runtimeModules.push({
          isInUse: () => runtime.isInUse?.(),
          inUseReason: () => runtime.inUseReason?.(),
          async deactivate() {
            if (deactivated) return;
            deactivated = true;
            try {
              await runtime.deactivate?.();
            } finally {
              await lifecycle.dispose();
            }
          },
        });
        await runtime.activate({
          plugin,
          manifest,
          apis: window.ZoidiumPluginApis || null,
          ui: createModuleUi(plugin, lifecycle),
          editor: window.CM,
          PZ,
          document,
          window,
          getAsset,
          lifecycle,
          object3d: PZ.zoidium?.object3d?.forPlugin?.(plugin, manifest, getAsset) || null,
        });
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
      if (objectTypes.some((entry) => entry?._zoidiumPluginId === plugin.id &&
          entry?.name === definition.name && entry?.type === definition.type)) continue;
      const entry = ZoidiumPluginApis.props.cloneJson(definition);
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
        const data = ZoidiumPluginApis.props.cloneJson(objectClass.defaultData || {});
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
    if (manager.effectBadgeObserver) scheduleEffectPickerBadges();
  }

  async function unregisterPlugin(pluginId) {
    // Native effect setup windows use the same plugin prefix as module
    // windows. Close them before their factories and resources are removed,
    // including activation rollback.
    ZoidiumUI.closeWindows(`${pluginId}:`);
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
        await state.runtimeModules[index].deactivate?.();
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
    if (manager.effectBadgeObserver) scheduleEffectPickerBadges();
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
    syncUsageTooltip(state);
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

  function debugItemBelongsToProject(item, project) {
    if (!project) return true;
    try {
      return item?.parentProject === project;
    } catch (_error) {
      return false;
    }
  }

  function summarizeDebugUsage(items, missingItems, kind, idKey, nameKey, project) {
    const counts = new Map();
    for (const item of items) {
      if (!debugItemBelongsToProject(item, project)) continue;
      const metadata = kind === "resource"
        ? item?._zoidiumPluginResourceMetadata
        : item?._zoidiumPluginMetadata;
      if (!metadata?.id) continue;
      let itemKind = kind;
      let itemId = metadata[idKey] || "unknown";
      let itemName = metadata[nameKey] || itemId;
      if (kind === "resource") {
        if (metadata.feature) {
          itemKind = "feature";
          itemId = metadata.feature;
          itemName = metadata.featureName || itemId;
        } else if (metadata.sprite) {
          itemKind = "sprite";
          itemId = metadata.sprite;
          itemName = metadata.spriteName || itemId;
        }
      }
      const key = `${metadata.id}\u0000${itemKind}\u0000${itemId}`;
      let entry = counts.get(key);
      if (!entry) {
        entry = {
          pluginId: metadata.id,
          pluginName: metadata.name || metadata.id,
          kind: itemKind,
          itemId,
          itemName,
          count: 0,
          missingCount: 0,
        };
        counts.set(key, entry);
      }
      entry.count += 1;
      if (missingItems.has(item)) entry.missingCount += 1;
    }
    return Array.from(counts.values()).sort((left, right) =>
      right.count - left.count ||
      left.pluginId.localeCompare(right.pluginId) ||
      left.itemId.localeCompare(right.itemId)
    );
  }

  function getDebugProjectUsage() {
    const project = window.CM?.project || null;
    const items = [
      ...summarizeDebugUsage(
        trackedNativeEffects,
        missingNativeEffects,
        "effect",
        "effect",
        "effectName",
        project
      ),
      ...summarizeDebugUsage(
        trackedPluginMaterials,
        missingPluginMaterials,
        "material",
        "material",
        "materialName",
        project
      ),
      ...summarizeDebugUsage(
        trackedPluginObjects,
        missingPluginObjects,
        "object",
        "object",
        "objectName",
        project
      ),
      ...summarizeDebugUsage(
        trackedPluginResources,
        missingPluginResources,
        "resource",
        "resource",
        "resourceName",
        project
      ),
    ].sort((left, right) =>
      right.count - left.count ||
      left.pluginId.localeCompare(right.pluginId) ||
      left.itemId.localeCompare(right.itemId)
    );
    return {
      totalInstances: items.reduce((total, item) => total + item.count, 0),
      missingInstances: items.reduce((total, item) => total + item.missingCount, 0),
      items,
    };
  }

  // END manager body
  Object.assign(manager, { createModuleLifecycle, createModuleUi, registerManifest, unregisterPlugin, manifestFeatureCount, updateCard, emitState, pluginIsEnabled, debugErrorSummary, rememberPluginError, getDebugPlugins, debugItemBelongsToProject, summarizeDebugUsage, getDebugProjectUsage });
})();
