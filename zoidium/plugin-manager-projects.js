// Plugin manager: projects. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = window.ZoidiumPluginManagerInternals;
  const { PLUGIN_MATERIAL_TYPES, pluginStates, trackedNativeEffects, trackedPluginMaterials, trackedPluginObjects, trackedPluginResources, registryReady } = manager;
  const isSaveApprovalRemembered = (...args) => manager.isSaveApprovalRemembered(...args);
  const rememberSaveApproval = (...args) => manager.rememberSaveApproval(...args);
  const installMissingNativeFactory = (...args) => manager.installMissingNativeFactory(...args);
  const installMissingMaterialFactory = (...args) => manager.installMissingMaterialFactory(...args);
  const pluginIsEnabled = (...args) => manager.pluginIsEnabled(...args);
  const normalizeProjectPlugins = (...args) => manager.normalizeProjectPlugins(...args);
  const serializeProjectPlugins = (...args) => manager.serializeProjectPlugins(...args);
  const projectPluginRequirements = (...args) => manager.projectPluginRequirements(...args);
  const enablePlugin = (...args) => manager.enablePlugin(...args);
  const refreshPluginUsageLocks = (...args) => manager.refreshPluginUsageLocks(...args);

  // BEGIN manager body 2629
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
        const knownMaterial = PLUGIN_MATERIAL_TYPES.get(materialId);
        installMissingMaterialFactory(
          materialId,
          manifestMaterial?.name || knownMaterial?.name || materialId,
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
        ZoidiumUI.notify({
          title: "Plugin missing.",
          message: `This project requires the plugin "${requested.name}"${versionSuffix}, which is not installed in this Zoidium.`,
        });
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
      const approved = await ZoidiumUI.confirm({
        title: `Enable "${state.plugin.name}"?`,
        message: `This project uses the plugin "${state.plugin.name}"${versionNote}, which is not compatible with vanilla Panzoid Clipmaker 3.\n\nEnable this plugin?\nIf you decline, plugin features will be unavailable and the project may render differently. Enable the plugin before editing those features.`,
        confirmLabel: "Enable",
        cancelLabel: "Cancel",
      });
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
          features: new Set(),
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
      if (metadata.feature) entry.features.add(metadata.feature);
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
      if (entry.features.size > 0) descriptor.features = Array.from(entry.features).sort();
      return descriptor;
    }).sort((a, b) => a.id.localeCompare(b.id));
  }

  function installSerializedFieldPreservation() {
    // Keep authored extensions out of live host properties. Weak keys release
    // the snapshot with its media/layer/clip, including detached projects.
    const prototypes = new Set([PZ.media?.prototype, PZ.clip?.prototype, PZ.layer?.prototype]);
    for (const key of Object.keys(PZ.layer || {})) {
      const descriptor = Object.getOwnPropertyDescriptor(PZ.layer, key);
      if (typeof descriptor?.value === "function") prototypes.add(descriptor.value.prototype);
    }
    const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    // Runtime-only fields are never part of the saved document. A media item
    // loaded from an import carries a Blob thumbnail; cloning it yields {},
    // and re-emitting that {} makes the next reopen fail, because CM3 passes
    // any truthy non-string thumbnail to URL.createObjectURL. Keep plain JSON
    // values only, and never retain a thumbnail.
    const RUNTIME_ONLY_FIELDS = new Set(["thumbnail"]);
    const isJsonValue = (value, depth) => {
      if (value === null || typeof value === "string" || typeof value === "boolean") return true;
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value !== "object" || depth > 32) return false;
      if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
      // A plain object's prototype is a root Object.prototype (its own
      // prototype is null). Class instances, Blobs, and Files all sit deeper.
      const proto = Object.getPrototypeOf(value);
      if (proto !== null && Object.getPrototypeOf(proto) !== null) return false;
      return Object.keys(value).every((key) => isJsonValue(value[key], depth + 1));
    };
    const retainableSnapshot = (source) => {
      const snapshot = {};
      for (const key of Object.keys(source)) {
        if (RUNTIME_ONLY_FIELDS.has(key)) continue;
        const value = source[key];
        if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
          // Keep the properties that are plain JSON; a stray Blob must not
          // discard the rest of the authored properties.
          const properties = {};
          for (const name of Object.keys(value)) {
            if (isJsonValue(value[name], 0)) properties[name] = value[name];
          }
          snapshot[key] = properties;
        } else if (isJsonValue(value, 0)) {
          snapshot[key] = value;
        }
      }
      return ZoidiumPluginApis.props.cloneJson(snapshot);
    };
    for (const prototype of prototypes) {
      if (!prototype || !owns(prototype, "load") || typeof prototype.toJSON !== "function") continue;
      const preserved = new WeakMap();
      const originalLoad = prototype.load;
      const originalToJSON = prototype.toJSON;
      prototype.load = function (data) {
        // Capture before the host or a plugin can mutate the caller's input.
        let snapshot = data && typeof data === "object" && typeof data.then !== "function"
          ? retainableSnapshot(data) : null;
        preserved.delete(this);
        const retain = (source) => {
          if (!source || typeof source !== "object") return;
          const json = originalToJSON.call(this);
          if (!json || typeof json !== "object") return;
          const fields = Object.create(null);
          for (const key of Object.keys(source)) {
            if (!owns(json, key)) fields[key] = source[key];
          }
          const properties = Object.create(null);
          const hostProperties = json.properties?.toJSON?.() || json.properties || {};
          for (const key of Object.keys(source.properties || {})) {
            if (!owns(hostProperties, key)) properties[key] = source.properties[key];
          }
          preserved.set(this, { fields, properties });
        };
        const args = Array.from(arguments);
        if (data && typeof data.then === "function") {
          args[0] = Promise.resolve(data).then((source) => {
            snapshot = source && typeof source === "object" ? retainableSnapshot(source) : null;
            return source;
          });
        }
        const result = originalLoad.apply(this, args);
        if (result && typeof result.then === "function") {
          return result.then((value) => {
            retain(snapshot);
            return value;
          });
        }
        retain(snapshot);
        return result;
      };
      prototype.toJSON = function () {
        const json = originalToJSON.apply(this, arguments);
        const extra = preserved.get(this);
        if (!extra || !json || typeof json !== "object") return json;
        for (const key of Object.keys(extra.fields)) {
          if (owns(json, key)) continue;
          // An enabled extension may have edited a field since load.
          const live = Object.getOwnPropertyDescriptor(this, key);
          const value = live && owns(live, "value") ? live.value : extra.fields[key];
          if (value !== undefined) Object.defineProperty(json, key, {
            value: ZoidiumPluginApis.props.cloneJson(value), enumerable: true, configurable: true, writable: true,
          });
        }
        if (Object.keys(extra.properties).length && json.properties) {
          json.properties = { ...ZoidiumPluginApis.props.cloneJson(extra.properties), ...ZoidiumPluginApis.props.cloneJson(json.properties) };
        }
        return json;
      };
    }
  }

  function installProjectPluginHooks() {
    if (manager.projectHooksInstalled || !PZ.project?.prototype) return;
    manager.projectHooksInstalled = true;
    // project-files.js and project-restore.js announce every editor.project swap.
    window.addEventListener("zoidium:project-changed", refreshPluginUsageLocks);
    installSerializedFieldPreservation();
    window.ZoidiumProjectCompatibility.installTextMode(PZ);

    const projectPrototype = PZ.project.prototype;
    const originalProjectToJSON = projectPrototype.toJSON;
    projectPrototype.toJSON = function () {
      const json = originalProjectToJSON.apply(this, arguments);
      // Only an object can carry the plugin descriptor. Anything else is the
      // host's own result and passes through untouched.
      if (!json || typeof json !== "object") return json;
      const trackedPlugins = collectProjectPlugins(this);
      const plugins = projectPluginRequirements({ ...ZoidiumPluginApis.props.cloneJson(json), plugins: trackedPlugins });
      if (plugins.length > 0) json.plugins = serializeProjectPlugins(plugins);
      else delete json.plugins;
      return json;
    };

    const originalProjectLoad = projectPrototype.load;
    projectPrototype.load = function (data) {
      data = window.ZoidiumProjectCompatibility.migrateProject(data);
      const plugins = projectPluginRequirements(data);
      installMissingFactoriesForRequirements(plugins);
      const pluginIds = plugins.map((plugin) => plugin.id);
      const pluginVersions = plugins.map((plugin) => plugin.version || "");
      document.dispatchEvent(new CustomEvent("zoidium:project-load-start", {
        detail: {
          pluginCount: plugins.length,
          pluginIds,
          pluginVersions,
        },
      }));
      let result;
      try {
        result = originalProjectLoad.call(this, data, ...Array.from(arguments).slice(1));
      } catch (error) {
        console.warn("[Zoidium] plugin manager: host project load failed", error);
        document.dispatchEvent(new CustomEvent("zoidium:project-load-error", {
          detail: {
            error,
            pluginCount: plugins.length,
            pluginIds,
            pluginVersions,
          },
        }));
        throw error;
      }
      Object.defineProperty(this, "_zoidiumProjectPlugins", {
        configurable: true,
        writable: true,
        value: plugins,
      });
      if (plugins.length > 0) {
        this._zoidiumPluginActivationPending = activateProjectPlugins(this, plugins).catch((error) => {
          this._zoidiumPluginActivationPending = null;
          document.dispatchEvent(new CustomEvent("zoidium:project-plugin-activation-error", {
            detail: { error, pluginIds, pluginVersions },
          }));
          console.error("[Zoidium] failed to activate project plugins:", error);
        });
      }
      document.dispatchEvent(new CustomEvent("zoidium:project-load-complete", {
        detail: { pluginCount: plugins.length, pluginIds, pluginVersions },
      }));
      return result;
    };
  }

  function installEditorPluginHooks() {
    if (manager.editorHooksInstalled || !PZ.ui?.editor?.prototype?.save) return;
    manager.editorHooksInstalled = true;
    const originalSave = PZ.ui.editor.prototype.save;
    PZ.ui.editor.prototype.save = async function () {
      const plugins = normalizeProjectPlugins(this.project?.toJSON?.().plugins);
      const unacknowledged = plugins.filter(
        (plugin) => !isSaveApprovalRemembered(plugin.id)
      );
      if (unacknowledged.length > 0) {
        const names = unacknowledged
          .map((plugin) => plugin.name)
          .join(", ");
        const approved = await ZoidiumUI.confirm({
          title: "Save anyway?",
          message: `This project uses plugin(s) incompatible with vanilla Panzoid Clipmaker 3 (${names}).\nZoidium is required.\n\nSave anyway?`,
          confirmLabel: "Save anyway",
          cancelLabel: "Cancel",
        });
        if (!approved) return;
        for (const plugin of unacknowledged) rememberSaveApproval(plugin.id);
      }
      return originalSave.apply(this, arguments);
    };
  }

  // END manager body
  Object.assign(manager, { installMissingFactoriesForRequirements, activateProjectPlugins, collectProjectPlugins, installSerializedFieldPreservation, installProjectPluginHooks, installEditorPluginHooks });
})();
