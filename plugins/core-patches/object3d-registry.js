(function installObject3DRegistry() {
  "use strict";

  if (
    typeof PZ === "undefined" ||
    !PZ.object3d ||
    typeof PZ.object3d.create !== "function"
  ) {
    return;
  }

  PZ.zoidium = PZ.zoidium || {};
  if (PZ.zoidium.object3d && PZ.zoidium.object3d.__zoidiumRegistryPatch) {
    return;
  }

  var THREE_API = typeof THREE !== "undefined" ? THREE : null;
  var originalCreate = PZ.object3d.create;
  var classRegistry = new Map();
  var trackedObjects = new Set();
  var missingObjects = new Set();
  var usageTracker = null;
  var typePattern = /^zoidium:([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/;

  function cloneJson(value) {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function parseType(type) {
    var match = typeof type === "string" ? type.match(typePattern) : null;
    return match
      ? {
          pluginId: match[1],
          objectId: match[2],
        }
      : null;
  }

  function isPluginType(type) {
    return typeof type === "string" && type.indexOf("zoidium:") === 0;
  }

  function getObjectMetadata(type, definition, missing) {
    var parsed = parseType(type) || {};
    return {
      id: definition && definition.pluginId || parsed.pluginId || "unknown",
      name: definition && definition.pluginName || parsed.pluginId || "Unknown plugin",
      version: definition && definition.pluginVersion || "",
      author: definition && definition.pluginAuthor || "",
      object: definition && definition.objectId || parsed.objectId || type,
      objectType: type,
      objectName: definition && definition.name || parsed.objectId || type,
      missing: Boolean(missing),
    };
  }

  function notifyTrack(object, missing) {
    if (!usageTracker || typeof usageTracker.track !== "function") {
      return;
    }
    try {
      usageTracker.track(object, object._zoidiumObjectMetadata, Boolean(missing));
    } catch (error) {
      console.error("Zoidium object3d usage tracker failed", error);
    }
  }

  function trackObject(object, metadata, missing) {
    trackedObjects.add(object);
    if (missing) {
      missingObjects.add(object);
    } else {
      missingObjects.delete(object);
    }
    object._zoidiumObjectMetadata = metadata;
    object._zoidiumMissingObject = Boolean(missing);
    notifyTrack(object, missing);
  }

  function untrackObject(object) {
    var wasTracked = trackedObjects.delete(object);
    missingObjects.delete(object);
    if (!wasTracked || !usageTracker || typeof usageTracker.untrack !== "function") {
      return;
    }
    try {
      usageTracker.untrack(object, object._zoidiumObjectMetadata, Boolean(object._zoidiumMissingObject));
    } catch (error) {
      console.error("Zoidium object3d usage tracker cleanup failed", error);
    }
  }

  function createMissing(type, data) {
    var metadata = getObjectMetadata(type, null, true);
    var missing = new MissingObject3D(type, metadata);
    missing.type = type;
    trackObject(missing, metadata, true);
    if (data !== undefined) {
      missing.load(data);
    }
    return missing;
  }

  function instantiate(definition) {
    var instance;
    try {
      if (
        definition.factory.prototype &&
        definition.factory.prototype instanceof PZ.object3d
      ) {
        instance = new definition.factory();
      } else {
        instance = definition.factory({
          PZ: PZ,
          THREE: THREE_API,
          type: definition.type,
          definition: definition,
          getAsset: definition.getAsset,
        });
      }

      if (
        typeof instance === "function" &&
        instance.prototype instanceof PZ.object3d
      ) {
        instance = new instance();
      }
    } catch (error) {
      console.error("Zoidium 3D object factory failed for " + definition.type, error);
      return createMissing(definition.type);
    }

    if (!(instance instanceof PZ.object3d)) {
      console.error("Zoidium 3D object factory did not return a PZ.object3d: " + definition.type);
      return createMissing(definition.type);
    }

    if (typeof instance.load !== "function" || instance.load === PZ.object3d.prototype.load) {
      console.error("Zoidium 3D object class has no custom load method: " + definition.type);
      return createMissing(definition.type);
    }

    instance.type = definition.type;
    if (definition.name) {
      // The object picker name is the persisted default name for a new object.
      // Keep it aligned with the manifest entry instead of CM3's generic
      // "3D Object" fallback.
      instance.defaultName = definition.name;
    }
    trackObject(instance, getObjectMetadata(definition.type, definition, false), false);

    var originalLoad = instance.load;
    instance.load = function (data) {
      var serializableData = data;
      if (data && typeof data.toJSON === "function") {
        serializableData = data.toJSON();
      }
      var migratedData = serializableData;
      if (typeof definition.migrate === "function") {
        migratedData = definition.migrate(
          cloneJson(serializableData),
          serializableData && serializableData.schemaVersion || 0
        );
        if (migratedData === undefined) {
          migratedData = serializableData;
        }
      }
      return originalLoad.call(this, migratedData);
    };

    var originalUnload = instance.unload;
    instance.unload = function () {
      untrackObject(this);
      if (typeof originalUnload === "function") {
        return originalUnload.apply(this, arguments);
      }
      return undefined;
    };

    return instance;
  }

  function registerClass(definition) {
    definition = definition || {};
    var type = String(definition.type || "");
    if (!parseType(type)) {
      throw new Error(
        "A custom 3D object type must use zoidium:<plugin-id>/<object-id>: " + type
      );
    }
    var factory = definition.factory || definition.create;
    if (typeof factory !== "function") {
      throw new Error("A custom 3D object class requires a factory: " + type);
    }
    if (classRegistry.has(type)) {
      throw new Error("A custom 3D object class is already registered: " + type);
    }

    var parsed = parseType(type);
    var entry = {
      type: type,
      schemaVersion: Number(definition.schemaVersion) || 1,
      factory: factory,
      migrate: definition.migrate,
      getAsset: definition.getAsset,
      pluginId: definition.pluginId || parsed.pluginId,
      pluginName: definition.pluginName || parsed.pluginId,
      pluginVersion: definition.pluginVersion || "",
      pluginAuthor: definition.pluginAuthor || "",
      objectId: definition.objectId || parsed.objectId,
      name: definition.name || parsed.objectId,
    };
    classRegistry.set(type, entry);

    return function unregister() {
      unregisterClass(type);
    };
  }

  function unregisterClass(type) {
    var entry = classRegistry.get(type);
    if (!entry) {
      return;
    }
    var active = Array.from(trackedObjects).some(function (object) {
      return (
        !missingObjects.has(object) &&
        object._zoidiumObjectMetadata &&
        object._zoidiumObjectMetadata.objectType === type
      );
    });
    if (active) {
      throw new Error("Cannot unregister a 3D object class while it is in use: " + type);
    }
    classRegistry.delete(type);
  }

  function forPlugin(plugin, manifest, getAsset) {
    plugin = plugin || {};
    if (typeof manifest === "function" && getAsset === undefined) {
      getAsset = manifest;
      manifest = null;
    }
    var declaredTypes = new Set();
    var declaredNames = new Map();
    if (manifest && Array.isArray(manifest.objectClasses)) {
      manifest.objectClasses.forEach(function (definition) {
        if (!definition) return;
        declaredTypes.add(definition.type);
        if (definition.name) declaredNames.set(definition.type, definition.name);
      });
    }
    return {
      registerClass: function (definition) {
        definition = definition || {};
        var rawType = String(definition.type || "");
        var type = rawType.indexOf("zoidium:") === 0
          ? rawType
          : "zoidium:" + plugin.id + "/" + rawType;
        var parsed = parseType(type);
        if (!parsed || parsed.pluginId !== plugin.id) {
          throw new Error("A plugin may only register its own 3D object namespace: " + type);
        }
        if (manifest && !declaredTypes.has(type)) {
          throw new Error("The 3D object class is not declared by the plugin manifest: " + type);
        }
        return registerClass({
          type: type,
          schemaVersion: definition.schemaVersion,
          factory: definition.factory || definition.create,
          migrate: definition.migrate,
          getAsset: getAsset,
          pluginId: plugin.id,
          pluginName: plugin.name || plugin.id,
          pluginVersion: plugin.version || "",
          pluginAuthor: plugin.author || "",
          objectId: definition.objectId || parsed.objectId,
          name: declaredNames.get(type) || definition.name || parsed.objectId,
        });
      },
      parseType: parseType,
    };
  }

  function restoreMissing(pluginId) {
    var candidates = Array.from(missingObjects).filter(function (object) {
      return !pluginId || object._zoidiumObjectMetadata && object._zoidiumObjectMetadata.id === pluginId;
    });

    return candidates.reduce(function (promise, missing) {
      return promise.then(function () {
        var parent = missing.parent;
        if (!parent || typeof parent.indexOf !== "function") {
          untrackObject(missing);
          return;
        }
        var index = parent.indexOf(missing);
        if (index < 0) {
          untrackObject(missing);
          return;
        }

        var data = missing.toJSON();
        var replacement = PZ.object3d.create(data && data.type || missing.missingType);
        missing.unload();
        parent.splice(index, 1, replacement);

        try {
          var loading = replacement.load(data);
          replacement.loading = loading;
          return Promise.resolve(loading).then(function () {
            if (replacement._zoidiumMissingObject) {
              throw new Error("The object class is still unavailable: " + missing.missingType);
            }
          }).catch(function (error) {
            replacement.unload();
            var fallback = createMissing(missing.missingType, data);
            parent.splice(index, 1, fallback);
            console.error("Zoidium could not restore 3D object " + missing.missingType, error);
          });
        } catch (error) {
          replacement.unload();
          var fallback = createMissing(missing.missingType, data);
          parent.splice(index, 1, fallback);
          console.error("Zoidium could not restore 3D object " + missing.missingType, error);
        }
      });
    }, Promise.resolve());
  }

  function unregisterPlugin(pluginId) {
    Array.from(classRegistry.keys()).forEach(function (type) {
      var entry = classRegistry.get(type);
      if (entry && entry.pluginId === pluginId) {
        unregisterClass(type);
      }
    });
  }

  function setUsageTracker(tracker) {
    usageTracker = tracker || null;
    if (!usageTracker || typeof usageTracker.track !== "function") {
      return;
    }
    trackedObjects.forEach(function (object) {
      notifyTrack(object, missingObjects.has(object));
    });
  }

  function isInUse(pluginId) {
    return Array.from(trackedObjects).some(function (object) {
      return (
        !missingObjects.has(object) &&
        object._zoidiumObjectMetadata &&
        object._zoidiumObjectMetadata.id === pluginId
      );
    });
  }

  class MissingObject3D extends PZ.object3d {
    constructor(type, metadata) {
      super();
      this.missingType = type;
      this._zoidiumObjectMetadata = metadata;
      this._zoidiumMissingObject = true;
      this._zoidiumMissingData = {
        type: type,
        schemaVersion: 1,
      };
      this.threeObj =
        THREE_API && THREE_API.Object3D ? new THREE_API.Object3D() : null;
      this.properties.add("missingDependency", {
        dynamic: !0,
        name: "Missing 3D Object",
        type: PZ.property.type.TEXT,
        value: "Requires plugin: " + metadata.id,
        readOnly: !0,
      });
      this.properties.name.set("Missing " + metadata.objectName);
    }

    load(data) {
      this._zoidiumMissingData = cloneJson(data || this._zoidiumMissingData);
      if (!this._zoidiumMissingData.type) {
        this._zoidiumMissingData.type = this.missingType;
      }
      this.properties.name.set("Missing " + this._zoidiumObjectMetadata.objectName);
      this.properties.missingDependency.load();
    }

    toJSON() {
      return cloneJson(this._zoidiumMissingData);
    }

    update() {}

    prepare() {
      return Promise.resolve();
    }

    unload() {
      untrackObject(this);
    }
  }

  var api = {
    __zoidiumRegistryPatch: true,
    registerClass: registerClass,
    unregisterClass: unregisterClass,
    unregisterPlugin: unregisterPlugin,
    forPlugin: forPlugin,
    restoreMissing: restoreMissing,
    setUsageTracker: setUsageTracker,
    isInUse: isInUse,
    getTrackedObjects: function () {
      return Array.from(trackedObjects);
    },
    isRegistered: function (type) {
      return classRegistry.has(type);
    },
    parseType: parseType,
  };

  PZ.zoidium.object3d = api;
  PZ.object3d.create = function (type) {
    if (isPluginType(type)) {
      var definition = classRegistry.get(type);
      return definition ? instantiate(definition) : createMissing(type);
    }
    return originalCreate.apply(this, arguments);
  };
})();
