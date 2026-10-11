// Plugin manager: factories. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = window.ZoidiumPluginManagerInternals;
  const { DEFAULT_IN_USE_REASON, NATIVE_FX_PLUGIN_ID, NATIVE_FX_EFFECTS, pluginStates, trackedNativeEffects, missingNativeEffects, trackedPluginMaterials, missingPluginMaterials, trackedPluginObjects, missingPluginObjects, trackedPluginResources, missingPluginResources } = manager;
  const updateDebugUsage = (...args) => manager.updateDebugUsage(...args);
  const cloneJson = (...args) => manager.cloneJson(...args);
  const pluginIsEnabled = (...args) => manager.pluginIsEnabled(...args);
  const debugItemBelongsToProject = (...args) => manager.debugItemBelongsToProject(...args);
  const pluginUsageReason = (...args) => manager.pluginUsageReason(...args);
  const refreshPluginUsageLocks = (...args) => manager.refreshPluginUsageLocks(...args);

  // BEGIN manager body 885
  function activeEditorProject() {
    return window.CM?.project || null;
  }

  function ownedByActiveProject(item) {
    return debugItemBelongsToProject(item, activeEditorProject());
  }

  function setPluginUsageUi(state, inUse, reason) {
    // Hidden plugins (Zoidium Core) have no panel card.
    if (!state.card || !state.toggle) return;
    state.toggle.disabled = inUse;
    state.usageReason = inUse ? reason || DEFAULT_IN_USE_REASON : "";
    syncUsageTooltip(state);
  }

  // The switch label carries the explanation while the toggle is locked.
  function syncUsageTooltip(state) {
    const label = state.card && state.card.querySelector(".zoidium-plugin-switch");
    if (!label) return;
    if (!label.dataset.baseTitle) label.dataset.baseTitle = label.title;
    label.title = state.toggle.disabled && state.usageReason ? state.usageReason : label.dataset.baseTitle;
  }

  // A locked toggle explains itself on click. The lock is re-checked first,
  // so it clears once the project no longer uses the plugin.
  function onLockedSwitchPointerDown(state) {
    if (!state.toggle.disabled || state.card.dataset.phase === "loading") return;
    const reason = pluginUsageReason(state);
    if (!reason) {
      setPluginUsageUi(state, false);
      return;
    }
    setPluginUsageUi(state, true, reason);
    ZoidiumUI.notify({ title: state.plugin.name, message: reason });
  }

  // Native effects belong to Native FX and to effect packs such as OpenZoid
  // Legacy, so a change re-derives every switch lock.
  function updateNativeFxUsageUi() {
    refreshPluginUsageLocks();
  }

  function trackNativeEffect(effect, metadata, missing) {
    const newlyTracked = !trackedNativeEffects.has(effect);
    effect._zoidiumPluginMetadata = metadata;
    trackedNativeEffects.add(effect);
    if (missing) missingNativeEffects.add(effect);
    else missingNativeEffects.delete(effect);
    if (newlyTracked) {
      updateDebugUsage(metadata, "effect", metadata.effect, metadata.effectName, 1);
    }
    updateNativeFxUsageUi();
  }

  function untrackNativeEffect(effect) {
    const metadata = effect?._zoidiumPluginMetadata;
    const wasTracked = trackedNativeEffects.has(effect);
    trackedNativeEffects.delete(effect);
    missingNativeEffects.delete(effect);
    if (wasTracked) {
      updateDebugUsage(metadata, "effect", metadata?.effect, metadata?.effectName, -1);
    }
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
    const newlyTracked = !trackedPluginMaterials.has(material);
    material._zoidiumPluginMetadata = metadata;
    trackedPluginMaterials.add(material);
    if (missing) missingPluginMaterials.add(material);
    else missingPluginMaterials.delete(material);
    if (newlyTracked) {
      updateDebugUsage(metadata, "material", metadata.material, metadata.materialName, 1);
    }
  }

  function untrackPluginMaterial(material) {
    const metadata = material?._zoidiumPluginMetadata;
    const wasTracked = trackedPluginMaterials.has(material);
    trackedPluginMaterials.delete(material);
    missingPluginMaterials.delete(material);
    if (wasTracked) {
      updateDebugUsage(metadata, "material", metadata?.material, metadata?.materialName, -1);
    }
  }

  function updatePluginObjectUsageUi(pluginId) {
    const state = pluginStates.get(pluginId);
    if (!state || !pluginIsEnabled(state)) return;
    const inUse = Array.from(trackedPluginObjects).some(
      (object) => ownedByActiveProject(object) &&
        object._zoidiumPluginMetadata?.id === pluginId && !missingPluginObjects.has(object)
    );
    setPluginUsageUi(state, inUse);
  }

  function trackPluginObject(object, metadata, missing) {
    if (!metadata?.id) return;
    const newlyTracked = !trackedPluginObjects.has(object);
    object._zoidiumPluginMetadata = metadata;
    trackedPluginObjects.add(object);
    if (missing) missingPluginObjects.add(object);
    else missingPluginObjects.delete(object);
    if (newlyTracked) {
      updateDebugUsage(metadata, "object", metadata.object, metadata.objectName, 1);
    }
    updatePluginObjectUsageUi(metadata.id);
  }

  function untrackPluginObject(object, metadata) {
    const currentMetadata = metadata || object?._zoidiumPluginMetadata;
    const wasTracked = trackedPluginObjects.has(object);
    trackedPluginObjects.delete(object);
    missingPluginObjects.delete(object);
    if (wasTracked) {
      updateDebugUsage(
        currentMetadata,
        "object",
        currentMetadata?.object,
        currentMetadata?.objectName,
        -1
      );
    }
    updatePluginObjectUsageUi(metadata?.id || object._zoidiumPluginMetadata?.id);
  }

  function updatePluginResourceUsageUi(pluginId) {
    const state = pluginStates.get(pluginId);
    if (!state || !pluginIsEnabled(state)) return;
    const inUse = Array.from(trackedPluginResources).some(
      (resource) =>
        ownedByActiveProject(resource) &&
        resource._zoidiumPluginResourceMetadata?.id === pluginId &&
        !missingPluginResources.has(resource)
    );
    setPluginUsageUi(state, inUse);
  }

  function trackPluginResource(resource, metadata, missing) {
    if (!resource || !metadata?.id) return;
    const newlyTracked = !trackedPluginResources.has(resource);
    resource._zoidiumPluginResourceMetadata = metadata;
    trackedPluginResources.add(resource);
    if (missing) missingPluginResources.add(resource);
    else missingPluginResources.delete(resource);
    if (newlyTracked) {
      updateDebugUsage(
        metadata,
        metadata.feature ? "feature" : "sprite",
        metadata.feature || metadata.sprite,
        metadata.featureName || metadata.spriteName,
        1
      );
    }
    updatePluginResourceUsageUi(metadata.id);
  }

  function untrackPluginResource(resource, metadata) {
    if (!resource) return;
    const currentMetadata = metadata || resource._zoidiumPluginResourceMetadata;
    const wasTracked = trackedPluginResources.has(resource);
    trackedPluginResources.delete(resource);
    missingPluginResources.delete(resource);
    if (wasTracked) {
      updateDebugUsage(
        currentMetadata,
        currentMetadata?.feature ? "feature" : "sprite",
        currentMetadata?.feature || currentMetadata?.sprite,
        currentMetadata?.featureName || currentMetadata?.spriteName,
        -1
      );
    }
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

  // END manager body
  Object.assign(manager, { activeEditorProject, ownedByActiveProject, setPluginUsageUi, syncUsageTooltip, onLockedSwitchPointerDown, updateNativeFxUsageUi, trackNativeEffect, untrackNativeEffect, setNativeFactory, getNativeEffectMetadata, installMissingNativeFactory, installMissingNativeFactories, nativeEffectMissingApis, describeNativeEffectSkew, applyIncompatibleNativeEffect, installIncompatibleNativeFactory, registerNativeFactory, restoreMissingNativeEffects, trackPluginMaterial, untrackPluginMaterial, updatePluginObjectUsageUi, trackPluginObject, untrackPluginObject, updatePluginResourceUsageUi, trackPluginResource, untrackPluginResource, installObject3DUsageTracker, setMaterialFactory, getPluginMaterialMetadata, installMissingMaterialFactory, restoreMissingPluginMaterials });
})();
