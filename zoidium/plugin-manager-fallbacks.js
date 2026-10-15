// Plugin manager: fallbacks. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = window.ZoidiumPluginManagerInternals;
  const { NUMERIC_OBJECT_TYPES, NUMERIC_LAYER_TYPES, missingNumericObjects, missingNumericLayers } = manager;

  // BEGIN manager body 2437
  function trackMissingNumericObject(instance) {
    missingNumericObjects.add(instance);
  }

  function untrackMissingNumericObject(instance) {
    missingNumericObjects.delete(instance);
  }

  function createMissingNumericObject(type, pluginId, objectId) {
    const placeholder = new PZ.object3d();
    placeholder.type = type;
    placeholder._zoidiumMissingNumeric = { kind: "object", pluginId, objectId, type, data: null };
    placeholder.load = async function (data) {
      try {
        this._zoidiumMissingNumeric.data = ZoidiumPluginApis.props.cloneJson(data);
      } catch (_error) {
        manager.reportFailureOnce("decode missing object:" + pluginId + ":" + type, "decode missing object", _error);
        this._zoidiumMissingNumeric.data = { type };
      }
    };
    placeholder.toJSON = function () {
      try {
        const data = this._zoidiumMissingNumeric.data;
        if (data && typeof data === "object") return ZoidiumPluginApis.props.cloneJson(data);
      } catch (_error) {
        manager.reportFailureOnce("serialize missing object:" + pluginId + ":" + type, "serialize missing object", _error); /* fall through */ }
      return { type: this._zoidiumMissingNumeric.type };
    };
    placeholder.update = function () {};
    placeholder.prepare = async function () {};
    placeholder.unload = function () {};
    placeholder._zoidiumMissingNumericPlaceholder = true;
    trackMissingNumericObject(placeholder);
    return placeholder;
  }

  function createMissingNumericLayer(type, pluginId, layerId) {
    const layer = new PZ.layer();
    layer.type = type;
    layer._zoidiumMissingNumeric = { kind: "layer", pluginId, layerId, type, data: null };
    layer.load = async function (data) {
      try {
        this._zoidiumMissingNumeric.data = ZoidiumPluginApis.props.cloneJson(data);
      } catch (_error) {
        manager.reportFailureOnce("decode missing layer:" + pluginId + ":" + type, "decode missing layer", _error);
        this._zoidiumMissingNumeric.data = { type };
      }
    };
    layer.toJSON = function () {
      try {
        const data = this._zoidiumMissingNumeric.data;
        if (data && typeof data === "object") return ZoidiumPluginApis.props.cloneJson(data);
      } catch (_error) {
        manager.reportFailureOnce("serialize missing layer:" + pluginId + ":" + type, "serialize missing layer", _error); /* fall through */ }
      return { type: this._zoidiumMissingNumeric.type };
    };
    layer.update = function () {};
    layer.prepare = async function () {};
    layer.unload = function () {};
    layer._zoidiumMissingNumericPlaceholder = true;
    missingNumericLayers.add(layer);
    return layer;
  }

  function installNumericFallbacks() {
    if (typeof PZ === "undefined") return false;
    let installed = true;
    if (PZ.object3d && typeof PZ.object3d.create === "function" &&
        !PZ.object3d.create.__zoidiumNumericFallback) {
      const originalCreate = PZ.object3d.create;
      const patched = function (type) {
        try {
          return originalCreate.call(this, type);
        } catch (error) {
          if (typeof type === "number" && NUMERIC_OBJECT_TYPES.has(type)) {
            const entry = NUMERIC_OBJECT_TYPES.get(type);
            return createMissingNumericObject(type, entry.pluginId, entry.objectId);
          }
          throw error;
        }
      };
      patched.__zoidiumNumericFallback = true;
      PZ.object3d.create = patched;
    } else if (!PZ.object3d || typeof PZ.object3d.create !== "function") {
      installed = false;
    }
    if (PZ.layer && typeof PZ.layer.create === "function" &&
        !PZ.layer.create.__zoidiumNumericFallback) {
      const originalLayerCreate = PZ.layer.create;
      const patchedLayer = function (type) {
        try {
          return originalLayerCreate.call(this, type);
        } catch (error) {
          if (typeof type === "number" && NUMERIC_LAYER_TYPES.has(type)) {
            const entry = NUMERIC_LAYER_TYPES.get(type);
            return createMissingNumericLayer(type, entry.pluginId, entry.layerId);
          }
          throw error;
        }
      };
      patchedLayer.__zoidiumNumericFallback = true;
      PZ.layer.create = patchedLayer;
    } else if (!PZ.layer || typeof PZ.layer.create !== "function") {
      installed = false;
    }
    return installed;
  }

  async function restoreMissingNumericObjects(pluginId) {
    for (const missing of Array.from(missingNumericObjects)) {
      const meta = missing && missing._zoidiumMissingNumeric;
      if (!meta || (pluginId && meta.pluginId !== pluginId)) continue;
      const parent = missing.parent;
      const index = parent && typeof parent.indexOf === "function" ? parent.indexOf(missing) : -1;
      let data = null;
      try {
        data = missing.toJSON();
      } catch (_error) {
        manager.reportFailureOnce("serialize restored object:" + meta.pluginId + ":" + meta.type, "serialize restored object", _error);
        data = { type: meta.type };
      }
      try {
        if (typeof missing.unload === "function") missing.unload();
      } catch (_error) {
        manager.reportFailureOnce("unload missing object:" + meta.pluginId + ":" + meta.type, "unload missing object", _error); /* best effort */ }
      untrackMissingNumericObject(missing);
      let replacement = null;
      try {
        replacement = PZ.object3d.create(meta.type);
      } catch (error) {
        manager.reportFailureOnce("could not restore numeric 3D object of type " + meta.type, "could not restore numeric 3D object of type " + meta.type, error);
        trackMissingNumericObject(missing);
        continue;
      }
      if (index >= 0 && parent && typeof parent.splice === "function") {
        parent.splice(index, 1, replacement);
      }
      try {
        await replacement.load(data);
      } catch (error) {
        manager.reportFailureOnce("could not load restored numeric 3D object of type " + meta.type, "could not load restored numeric 3D object of type " + meta.type, error);
      }
    }
  }

  function eachKnownProject(rootEditors) {
    const out = [];
    const editors = rootEditors || [];
    for (const editor of editors) {
      if (editor && editor.project && !out.includes(editor.project)) out.push(editor.project);
    }
    return out;
  }

  async function restoreMissingNumericLayers(pluginId) {
    const globals = typeof globalThis !== "undefined" ? globalThis : {};
    const projects = eachKnownProject([globals.CM, globals.ZOIDIUM_EDITOR, globals.VE]);
    for (const project of projects) {
      const sequences = [];
      if (project.sequence) sequences.push(project.sequence);
      for (const sequence of sequences) {
        for (const trackKind of ["videoTracks", "audioTracks"]) {
          const tracks = sequence[trackKind];
          if (!Array.isArray(tracks)) continue;
          for (const track of tracks) {
            const layer = track && track.layer;
            const meta = layer && layer._zoidiumMissingNumeric;
            if (!meta || meta.kind !== "layer" || (pluginId && meta.pluginId !== pluginId)) continue;
            let data = null;
            try {
              data = layer.toJSON();
            } catch (_error) {
        manager.reportFailureOnce("serialize restored layer:" + meta.pluginId + ":" + meta.type, "serialize restored layer", _error);
              data = { type: meta.type };
            }
            try {
              if (typeof layer.unload === "function") layer.unload();
            } catch (_error) {
        manager.reportFailureOnce("unload missing layer:" + meta.pluginId + ":" + meta.type, "unload missing layer", _error); /* best effort */ }
            missingNumericLayers.delete(layer);
            let replacement = null;
            try {
              replacement = PZ.layer.create(meta.type);
            } catch (error) {
              manager.reportFailureOnce("could not restore numeric layer of type " + meta.type, "could not restore numeric layer of type " + meta.type, error);
              missingNumericLayers.add(layer);
              continue;
            }
            track.layer = replacement;
            try {
              await replacement.load(data);
            } catch (error) {
              manager.reportFailureOnce("could not load restored numeric layer of type " + meta.type, "could not load restored numeric layer of type " + meta.type, error);
            }
          }
        }
      }
    }
  }

  // END manager body
  Object.assign(manager, { trackMissingNumericObject, untrackMissingNumericObject, createMissingNumericObject, createMissingNumericLayer, installNumericFallbacks, restoreMissingNumericObjects, eachKnownProject, restoreMissingNumericLayers });
})();
