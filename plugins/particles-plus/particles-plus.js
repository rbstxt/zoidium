'use strict';

/*
 * Particles+ — extra monochrome particle sprites for CM3.
 *
 * The image bytes live in the plugin bundle. A selected sprite is stored as a
 * data URL in the normal CM3 image asset slot, so the selection survives a
 * project save/reload without introducing a second asset format.
 */

const ParticlesPlus = (() => {
  const state = {
    active: false,
    PZ: null,
    editor: null,
    window: null,
    document: null,
    plugin: null,
    manifest: null,
    dataUrls: new Map(),
    idsByDataUrl: new Map(),
    addedNames: [],
    trackedParticles: new Map(),
    watchedProperties: new Map(),
    pickerPatches: new Set(),
    textureDefinition: null,
    particlePrototype: null,
    originalTextureChanged: null,
    patchedTextureChanged: null,
    originalParticleUnload: null,
    patchedParticleUnload: null,
    originalGenerateTextureInput: null,
    patchedGenerateTextureInput: null,
  };

  function getProject(value) {
    try {
      return value?.parentProject || null;
    } catch (_error) {
      return null;
    }
  }

  function getTextureProperty(particle) {
    return particle?.properties?.texture || null;
  }

  function readPropertyValue(property) {
    try {
      return property?.get?.() ?? property?.value ?? null;
    } catch (_error) {
      return null;
    }
  }

  function readTextureValue(particle) {
    return readPropertyValue(getTextureProperty(particle));
  }

  function spriteIdForValue(value) {
    return typeof value === 'string' ? state.idsByDataUrl.get(value) || null : null;
  }

  function spriteIdForProperty(property) {
    const value = readPropertyValue(property);
    const sprite = spriteIdForValue(value);
    if (sprite) {
      property._zoidiumParticlesPlusSprite = sprite;
      return sprite;
    }
    const markedSprite = property?._zoidiumParticlesPlusSprite;
    if (markedSprite && state.dataUrls.get(markedSprite) === value) return markedSprite;
    if (property) delete property._zoidiumParticlesPlusSprite;
    return null;
  }

  function metadataForSprite(sprite) {
    return {
      id: state.plugin.id,
      name: state.plugin.name,
      version: String(state.plugin.version || state.manifest?.version || ''),
      author: state.plugin.author || '',
      sprite,
      compatibility: 'incompatible',
    };
  }

  function trackParticle(particle, sprite) {
    if (!particle || !sprite || getProject(particle) !== state.editor?.project) return;
    const previous = state.trackedParticles.get(particle);
    if (previous === sprite) return;
    if (previous) state.PZ.zoidium?.untrackPluginResource?.(particle, metadataForSprite(previous));
    state.trackedParticles.set(particle, sprite);
    state.PZ.zoidium?.trackPluginResource?.(particle, metadataForSprite(sprite), false);
  }

  function untrackParticle(particle) {
    const sprite = state.trackedParticles.get(particle);
    if (!sprite) return;
    state.trackedParticles.delete(particle);
    state.PZ.zoidium?.untrackPluginResource?.(particle, metadataForSprite(sprite));
  }

  function syncParticle(particle) {
    if (!particle) return;
    const sprite = spriteIdForProperty(getTextureProperty(particle));
    if (sprite) trackParticle(particle, sprite);
    else untrackParticle(particle);
  }

  function watchParticle(particle) {
    const property = getTextureProperty(particle);
    if (!property?.onChanged?.watch || state.watchedProperties.has(property)) return;
    const callback = () => syncParticle(particle);
    property.onChanged.watch(callback);
    state.watchedProperties.set(property, callback);
  }

  function scanProject(project) {
    const particles = new Set();
    const particleType = state.PZ.object3d?.particles;
    if (project && particleType && typeof project.forEachItemOfType === 'function') {
      project.forEachItemOfType(particleType, (particle) => {
        particles.add(particle);
        watchParticle(particle);
        syncParticle(particle);
      });
    }
    for (const particle of Array.from(state.trackedParticles.keys())) {
      if (!particles.has(particle) || getProject(particle) !== project) untrackParticle(particle);
    }
  }

  function patchTextureDefinition() {
    state.textureDefinition = state.PZ.object3d?.particles?.propertyDefinitions?.texture;
    if (!state.textureDefinition || !Array.isArray(state.textureDefinition.items)) {
      throw new Error('Particles+ could not locate the particle texture preset list');
    }
    state.originalTextureChanged = state.textureDefinition.changed;
    state.patchedTextureChanged = function () {
      const result = typeof state.originalTextureChanged === 'function'
        ? state.originalTextureChanged.apply(this, arguments)
        : undefined;
      syncParticle(this.parentObject);
      return result;
    };
    state.textureDefinition.changed = state.patchedTextureChanged;
  }

  function patchParticleUnload() {
    state.particlePrototype = state.PZ.object3d.particles.prototype;
    state.originalParticleUnload = state.particlePrototype.unload;
    state.patchedParticleUnload = function () {
      untrackParticle(this);
      return typeof state.originalParticleUnload === 'function'
        ? state.originalParticleUnload.apply(this, arguments)
        : undefined;
    };
    state.particlePrototype.unload = state.patchedParticleUnload;
  }

  function patchPicker() {
    const controls = state.PZ.ui?.controls;
    if (typeof controls?.generateTextureInput !== 'function') {
      throw new Error('Particles+ texture picker is unavailable');
    }
    state.originalGenerateTextureInput = controls.generateTextureInput;
    state.patchedGenerateTextureInput = function (property) {
      const result = state.originalGenerateTextureInput.apply(this, arguments);
      if (!property || !Array.isArray(result)) return result;
      const container = result[0];
      const fileInput = result[1];
      const select = container?.querySelector?.('select');
      if (!select || !container) return result;

      const originalOnchange = select.onchange;
      let lastPluginSprite = null;
      const selectPluginSprite = (sprite) => {
        if (!state.dataUrls.has(sprite)) return;
        if (fileInput?.style) fileInput.style.display = 'none';
        const index = property.definition.items.indexOf(sprite);
        if (index >= 0) select.selectedIndex = index;
      };
      const patchedOnchange = function () {
        const sprite = property.definition.items?.[this.selectedIndex];
        if (!state.dataUrls.has(sprite)) {
          lastPluginSprite = null;
          delete property._zoidiumParticlesPlusSprite;
          const selectedIndex = this.selectedIndex;
          const result = typeof originalOnchange === 'function'
            ? originalOnchange.apply(this, arguments)
            : undefined;
          this.selectedIndex = selectedIndex;
          return result;
        }
        const project = property.parentProject;
        if (!project) return undefined;
        state.PZ.ui.controls.editStart.call(this, property);
        const asset = project.assets.createFromPreset(
          state.PZ.asset.type.IMAGE,
          state.dataUrls.get(sprite),
        );
        lastPluginSprite = sprite;
        property._zoidiumParticlesPlusSprite = sprite;
        property.set(asset.key);
        state.PZ.ui.controls.editFinish.call(this, property);
        trackParticle(property.parentObject, sprite);
        if (typeof container.pz_update === 'function') container.pz_update();
        selectPluginSprite(sprite);
        return undefined;
      };
      select.onchange = patchedOnchange;

      const originalPzUpdate = container.pz_update;
      const patchedPzUpdate = function () {
        const sprite = spriteIdForProperty(property) || lastPluginSprite;
        if (!sprite) {
          return typeof originalPzUpdate === 'function'
            ? originalPzUpdate.apply(this, arguments)
            : undefined;
        }
        selectPluginSprite(sprite);
        return undefined;
      };
      container.pz_update = patchedPzUpdate;

      const fileControl = fileInput?.querySelector?.('input[type="file"]');
      const originalFileOnchange = fileControl?.onchange;
      let patchedFileOnchange = null;
      if (fileControl && typeof originalFileOnchange === 'function') {
        patchedFileOnchange = async function () {
          try {
            return await originalFileOnchange.apply(this, arguments);
          } finally {
            lastPluginSprite = null;
            delete property._zoidiumParticlesPlusSprite;
            syncParticle(property.parentObject);
          }
        };
        fileControl.onchange = patchedFileOnchange;
      }

      state.pickerPatches.add({
        container,
        originalPzUpdate,
        patchedPzUpdate,
        select,
        originalOnchange,
        patchedOnchange,
        fileControl,
        originalFileOnchange,
        patchedFileOnchange,
      });
      return result;
    };
    controls.generateTextureInput = state.patchedGenerateTextureInput;
  }

  function restorePatches() {
    const controls = state.PZ?.ui?.controls;
    if (controls?.generateTextureInput === state.patchedGenerateTextureInput) {
      controls.generateTextureInput = state.originalGenerateTextureInput;
    }
    if (state.textureDefinition?.changed === state.patchedTextureChanged) {
      state.textureDefinition.changed = state.originalTextureChanged;
    }
    if (state.particlePrototype?.unload === state.patchedParticleUnload) {
      state.particlePrototype.unload = state.originalParticleUnload;
    }
    for (const patch of state.pickerPatches) {
      if (patch.select?.onchange === patch.patchedOnchange) patch.select.onchange = patch.originalOnchange;
      if (patch.container?.pz_update === patch.patchedPzUpdate) patch.container.pz_update = patch.originalPzUpdate;
      if (patch.fileControl?.onchange === patch.patchedFileOnchange) patch.fileControl.onchange = patch.originalFileOnchange;
    }
    state.pickerPatches.clear();
    for (const [property, callback] of state.watchedProperties) property.onChanged?.unwatch?.(callback);
    state.watchedProperties.clear();
  }

  function teardown() {
    restorePatches();
    for (const particle of Array.from(state.trackedParticles.keys())) untrackParticle(particle);
    state.trackedParticles.clear();
    if (state.textureDefinition?.items) {
      for (const id of state.addedNames) {
        const index = state.textureDefinition.items.indexOf(id);
        if (index >= 0) state.textureDefinition.items.splice(index, 1);
      }
    }
    state.addedNames.length = 0;
    state.dataUrls.clear();
    state.idsByDataUrl.clear();
    state.textureDefinition = null;
    state.particlePrototype = null;
    state.originalTextureChanged = null;
    state.patchedTextureChanged = null;
    state.originalParticleUnload = null;
    state.patchedParticleUnload = null;
    state.originalGenerateTextureInput = null;
    state.patchedGenerateTextureInput = null;
    state.plugin = null;
    state.manifest = null;
    state.editor = null;
    state.PZ = null;
    state.window = null;
    state.document = null;
    state.active = false;
  }

  function activate(context) {
    if (state.active) return;
    const PZ = context.PZ || context.window?.PZ;
    const manifest = context.manifest;
    const plugin = context.plugin;
    if (!PZ?.object3d?.particles || !plugin || !manifest) {
      throw new Error('Particles+ requires the CM3 particle object type');
    }

    state.PZ = PZ;
    state.editor = context.editor;
    state.window = context.window;
    state.document = context.document;
    state.plugin = plugin;
    state.manifest = manifest;
    state.active = true;

    try {
      const version = String(manifest.version || plugin.version || '1');
      const spriteIds = (manifest.resources || [])
        .filter((resource) => resource.type === 'image' && resource.id.startsWith('sprite-'))
        .map((resource) => resource.id.slice('sprite-'.length));
      if (!spriteIds.length) throw new Error('Particles+ bundle declares no sprites');
      const getAsset = context.getAsset;
      for (const id of spriteIds) {
        const dataUrl = getAsset('text', `/plugins/particles-plus/sprites/${id}.png?v=${version}`);
        if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,/i.test(dataUrl)) {
          throw new Error(`Particles+ sprite missing from bundle: ${id}`);
        }
        state.dataUrls.set(id, dataUrl);
        state.idsByDataUrl.set(dataUrl, id);
      }

      const items = state.PZ.object3d.particles.propertyDefinitions.texture.items;
      for (const id of spriteIds) {
        if (!items.includes(id)) {
          items.push(id);
          state.addedNames.push(id);
        }
      }
      patchTextureDefinition();
      patchParticleUnload();
      patchPicker();
      scanProject(state.editor?.project);
    } catch (error) {
      teardown();
      throw error;
    }
  }

  function deactivate() {
    if (!state.active) return;
    teardown();
  }

  function isInUse() {
    if (!state.active) return false;
    scanProject(state.editor?.project);
    return Array.from(state.trackedParticles.keys()).some(
      (particle) => getProject(particle) === state.editor?.project,
    );
  }

  return { activate, deactivate, isInUse };
})();

module.exports = ParticlesPlus;
