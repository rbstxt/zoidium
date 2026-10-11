// Plugin manager: assets. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = window.ZoidiumPluginManagerInternals;
  const { SHADER_PLUGIN_MARKER } = manager;

  // BEGIN manager body 212
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

  // END manager body
  // BEGIN manager body 725
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

  // The project the editor is showing. A native item keeps the project it was
  // loaded into, so a switch lock counts only items owned by this project.
  // Without a known project, every tracked item counts (the conservative case).
  // END manager body
  // BEGIN manager body 1386
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

  // END manager body
  Object.assign(manager, { fetchJson, fetchText, pluginAssetKey, getPluginAsset, createPluginAssetResolver, bundledText, bundledJson, validateManifest, createPluginMarker, readPluginMarker, createLazyEffectData, hydrateGroupShaders, indexGroupShaders, loadGroupData, cloneJson, loadPluginPackage, loadPluginPackageForState });
})();
