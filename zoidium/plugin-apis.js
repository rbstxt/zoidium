// Zoidium Plugin APIs — shared helpers behind the five plugin kinds.
//
// Kinds (see plugins/manifest.schema.json and docs/plugin-api.md):
//   shader-pack   — declarative GLSL effects + groups (no JavaScript)
//   native-fx     — multipass effects incl. time operations (filter / temporal)
//   object        — 3D shapes and containers (primitive / container)
//   material-pack — 3D materials
//   extension     — anything else, including panels (module activate/deactivate)
//   core          — hidden built-in extensions (see plugins/core/)
//
// This file is loaded before plugins/plugin-manager.js (see
// zoidium/runtime-config.js) so native-effect sources and modules can use
// it as a plain browser global. Modules also receive it as context.apis.
(function (global) {
  "use strict";

  var KINDS = Object.freeze({
    SHADER_PACK: "shader-pack",
    NATIVE_FX: "native-fx",
    OBJECT: "object",
    MATERIAL_PACK: "material-pack",
    EXTENSION: "extension",
    CORE: "core",
  });

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  var propertyControlRegistrations = Object.create(null);
  var propertyControlPatches = Object.create(null);

  function propertyControlGenerator(PZ, type) {
    if (!PZ || !PZ.property || !PZ.property.type) return null;
    var types = PZ.property.type;
    if (type === types.NUMBER) return "generateInput";
    if (type === types.VECTOR2) return "generateInput2";
    if (type === types.VECTOR3) return "generateInput3";
    if (type === types.VECTOR4) return "generateInput4";
    if (type === types.COLOR) return "generateColorInput";
    if (type === types.GRADIENT) return "generateGradientInput";
    if (type === types.CURVE) return "generateCurveInput";
    if (type === types.OPTION) return "generateOptionInput";
    if (type === types.TEXT) return "generateTextInput";
    if (type === types.ASSET) return "generateFileInput";
    if (type === types.LIST) return "generateListInput";
    if (type === types.SHADER) return "generateShaderInput";
    return null;
  }

  // CM3's property list looks up the row's first ".editbox" and binds its
  // pz_update to the property's onChanged, so every control must provide one.
  // Custom controls that only render buttons or canvases get a no-op update.
  function ensureEditbox(element) {
    if (!element || typeof element !== "object") return element;
    var editbox = element.classList && element.classList.contains("editbox")
      ? element
      : (typeof element.querySelector === "function" ? element.querySelector(".editbox") : null);
    if (!editbox && element.classList) {
      element.classList.add("editbox");
      editbox = element;
    }
    if (editbox && typeof editbox.pz_update !== "function") {
      editbox.pz_update = typeof element.pz_refresh === "function"
        ? function () { element.pz_refresh(); }
        : function () {};
    }
    return element;
  }

  // Custom property controls keep plugin-specific editors inside CM3's normal
  // property list, history, and update flow. A property opts in with a stable
  // `zoidiumControl` id while retaining a standard CM3 storage type.
  // spec: { type: PZ.property.type.*, create(property, context) }
  function registerPropertyControl(id, spec) {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("ZoidiumPluginApis.propertyControls.register requires an id");
    }
    if (!isObject(spec) || typeof spec.create !== "function") {
      throw new Error("ZoidiumPluginApis.propertyControls.register requires create(property, context)");
    }
    var PZ = global.PZ;
    var controls = PZ && PZ.ui && PZ.ui.controls;
    var generator = propertyControlGenerator(PZ, spec.type);
    if (!controls || !generator || typeof controls[generator] !== "function") {
      throw new Error("ZoidiumPluginApis.propertyControls.register needs a supported CM3 property type");
    }

    var registration = { id: id, type: spec.type, create: spec.create };
    propertyControlRegistrations[id] = registration;

    if (!propertyControlPatches[generator]) {
      var original = controls[generator];
      var patched = function generateZoidiumPropertyControl(property) {
        var controlId = property && property.definition
          ? property.definition.zoidiumControl
          : null;
        var custom = controlId ? propertyControlRegistrations[controlId] : null;
        if (custom && property.definition.type === custom.type) {
          var result = custom.create.call(this, property, {
            PZ: global.PZ,
            THREE: global.THREE,
            controls: controls,
            document: global.document,
            window: global,
          });
          if (result) return ensureEditbox(result);
        }
        return original.apply(this, arguments);
      };
      patched.__zoidiumPropertyControl = true;
      patched.__zoidiumOriginal = original;
      controls[generator] = patched;
      propertyControlPatches[generator] = { original: original, patched: patched };
    }

    return function unregisterPropertyControl() {
      if (propertyControlRegistrations[id] === registration) {
        delete propertyControlRegistrations[id];
      }
    };
  }

  // Install the no-op lifecycle methods every native effect needs so filter
  // and temporal authors only describe what is unique to their effect.
  // Defaults always win over inherited host methods: CM3 hands each factory
  // a real PZ.effect instance whose prototype already defines load and friends,
  // so missing is never true. Keeping the host load recurses forever and hangs.
  function installLifecycleDefaults(effect, overrides) {
    var methods = overrides || {};
    if (typeof methods.load === "function") effect.load = methods.load;
    else {
      effect.load = function load(data) {
        if (effect.properties && typeof effect.properties.load === "function") {
          effect.properties.load(data && data.properties);
        }
      };
    }
    if (typeof methods.update === "function") effect.update = methods.update;
    else effect.update = function update() {};
    if (typeof methods.prepare === "function") effect.prepare = methods.prepare;
    else {
      effect.prepare = async function prepare() {};
    }
    if (typeof methods.resize === "function") effect.resize = methods.resize;
    else effect.resize = function resize() {};
    if (typeof methods.unload === "function") effect.unload = methods.unload;
    else effect.unload = function unload() {};
    if (typeof methods.toJSON === "function") effect.toJSON = methods.toJSON;
    else {
      effect.toJSON = function toJSON() {
        return { type: effect.type, properties: effect.properties };
      };
    }
  }

  // Temporal effect: a deterministic time operator (offset / posterize).
  // The host (plugins/core/temporal-render.js) reads effect._zoidiumTemporal
  // and rewrites which frame is evaluated. Authors never touch frames.
  // spec: { kind, displayName, properties, getOperator(effect, frame) }
  function defineTemporal(spec) {
    var effect = this;
    if (!isObject(spec) || (spec.kind !== "time-offset" && spec.kind !== "posterize-time")) {
      throw new Error("ZoidiumPluginApis.defineTemporal requires kind time-offset or posterize-time");
    }
    if (!isObject(spec.properties)) {
      throw new Error("ZoidiumPluginApis.defineTemporal requires a properties object");
    }
    if (typeof spec.getOperator !== "function") {
      throw new Error("ZoidiumPluginApis.defineTemporal requires getOperator(effect, frame)");
    }
    if (typeof spec.displayName === "string" && spec.displayName) {
      effect.defaultName = spec.displayName;
    }
    effect._zoidiumTemporal = { kind: spec.kind, getOperator: spec.getOperator };
    var PZ = global.PZ;
    if (!PZ || !effect.properties || typeof effect.properties.addAll !== "function") {
      throw new Error("ZoidiumPluginApis.defineTemporal needs a CM3 effect instance (this)");
    }
    effect.properties.addAll(spec.properties);
    installLifecycleDefaults(effect, spec.lifecycle);
    return effect;
  }

  // Frame sampler: an effect that needs explicitly evaluated frames in
  // addition to the current input. The compositor owns frame evaluation and
  // render-target reuse; the effect owns only its properties and pixel
  // composition. This keeps frame sampling deterministic and avoids a
  // playback-history cache in individual effects.
  // spec: { displayName, properties, getRequest(effect, frame), lifecycle }
  function defineFrameSampler(spec) {
    var effect = this;
    if (!isObject(spec) || !isObject(spec.properties)) {
      throw new Error("ZoidiumPluginApis.defineFrameSampler requires a properties object");
    }
    if (typeof spec.getRequest !== "function") {
      throw new Error("ZoidiumPluginApis.defineFrameSampler requires getRequest(effect, frame)");
    }
    if (typeof spec.displayName === "string" && spec.displayName) {
      effect.defaultName = spec.displayName;
    }
    effect._zoidiumFrameSampler = { getRequest: spec.getRequest };
    var PZ = global.PZ;
    if (!PZ || !effect.properties || typeof effect.properties.addAll !== "function") {
      throw new Error("ZoidiumPluginApis.defineFrameSampler needs a CM3 effect instance (this)");
    }
    effect.properties.addAll(spec.properties, effect);
    installLifecycleDefaults(effect, spec.lifecycle);
    var update = effect.update;
    effect.update = function updateFrameSampler(frame) {
      var value = Number(frame);
      effect._zoidiumFrameSamplerFrame = Number.isFinite(value) ? value : 0;
      return update.apply(effect, arguments);
    };
    var prepare = effect.prepare;
    effect.prepare = async function prepareFrameSampler(frame, context) {
      var temporal = global.PZ && global.PZ.zoidium && global.PZ.zoidium.temporal;
      if (temporal && typeof temporal.prepareFrameSamples === "function") {
        await temporal.prepareFrameSamples(effect, frame, context);
      }
      return prepare.apply(effect, arguments);
    };
    return effect;
  }

  // Single-pass shader filter: the common native-fx shape (one fragment
  // shader, one THREE ShaderPass, per-frame uniform updates).
  // spec: { displayName, properties, fragShaderUrl, fragShader,
  //         uniforms, defines, update(frame), resize(), onLoad(effect),
  //         onUnload(effect) }
  function defineFilter(spec) {
    var effect = this;
    if (!isObject(spec) || !isObject(spec.properties)) {
      throw new Error("ZoidiumPluginApis.defineFilter requires a properties object");
    }
    if (typeof spec.fragShaderUrl !== "string" && typeof spec.fragShader !== "string") {
      throw new Error("ZoidiumPluginApis.defineFilter requires fragShaderUrl or fragShader");
    }
    var PZ = global.PZ;
    var THREE = global.THREE;
    if (!PZ || !THREE) {
      throw new Error("ZoidiumPluginApis.defineFilter needs PZ and THREE globals");
    }
    if (typeof spec.displayName === "string" && spec.displayName) {
      effect.defaultName = spec.displayName;
    }
    effect.shaderUrl = spec.fragShaderUrl || effect.shaderUrl;
    effect.propertyDefinitions = spec.properties;
    effect.properties.addAll(spec.properties, effect);

    effect.load = async function load(data) {
      effect.vertShader = effect.parentProject.assets.createFromPreset(
        PZ.asset.type.SHADER,
        "/assets/shaders/vertex/common.glsl"
      );
      effect.vertShader = new PZ.asset.shader(
        effect.parentProject.assets.load(effect.vertShader)
      );
      var bundled =
        typeof effect.shaderUrl === "string" && effect._zoidiumGetAsset
          ? effect._zoidiumGetAsset("text", effect.shaderUrl)
          : undefined;
      if (typeof bundled === "string") {
        effect._zoidiumBundledFragShader = true;
        effect.fragShader = { getShader: async function () { return bundled; } };
      } else if (typeof spec.fragShader === "string") {
        effect._zoidiumBundledFragShader = true;
        effect.fragShader = { getShader: async function () { return spec.fragShader; } };
      } else {
        effect._zoidiumBundledFragShader = false;
        var preset = effect.parentProject.assets.createFromPreset(
          PZ.asset.type.SHADER,
          effect.shaderUrl
        );
        effect.fragShader = new PZ.asset.shader(
          effect.parentProject.assets.load(preset)
        );
      }
      var uniforms = { tDiffuse: { type: "t", value: null } };
      Object.keys(spec.uniforms || {}).forEach(function (name) {
        var definition = spec.uniforms[name] || {};
        uniforms[name] = {
          type: definition.type || "f",
          value: cloneUniformValue(definition.value),
        };
      });
      var material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: await effect.vertShader.getShader(),
        fragmentShader: await effect.fragShader.getShader(),
      });
      material.premultipliedAlpha = true;
      Object.keys(spec.defines || {}).forEach(function (name) {
        material.defines[name] = spec.defines[name];
      });
      effect.pass = new THREE.ShaderPass(material);
      if (typeof spec.onLoad === "function") await spec.onLoad(effect);
      effect.properties.load(data && data.properties);
    };

    effect.toJSON = function toJSON() {
      return { type: effect.type, properties: effect.properties };
    };

    effect.unload = function unload() {
      if (typeof spec.onUnload === "function") spec.onUnload(effect);
      if (effect.vertShader) effect.parentProject.assets.unload(effect.vertShader);
      if (!effect._zoidiumBundledFragShader && effect.fragShader) {
        effect.parentProject.assets.unload(effect.fragShader);
      }
    };

    effect.update = function update(frame) {
      if (!effect.pass) return;
      if (typeof spec.update === "function") {
        spec.update.call(effect, frame, effect.pass.uniforms);
        return;
      }
      var enabled = effect.properties.enabled && effect.properties.enabled.get(frame);
      if (typeof enabled !== "undefined") effect.pass.enabled = enabled;
    };

    effect.resize = function resize() {
      if (typeof spec.resize === "function") {
        spec.resize.call(effect);
        return;
      }
      try {
        var resolution = effect.parentLayer.properties.resolution.get();
        if (effect.pass && effect.pass.uniforms.resolution) {
          effect.pass.uniforms.resolution.value.set(resolution[0], resolution[1]);
        }
      } catch (_error) {
        // Resolution is unavailable while the layer is detached.
      }
    };

    return effect;
  }

  function cloneUniformValue(value) {
    if (Array.isArray(value)) return value.slice();
    // Only plain option bags are copied. Class instances such as
    // THREE.Vector2 are passed through so their methods survive.
    if (isObject(value)) {
      var proto = Object.getPrototypeOf(value);
      if (proto === Object.prototype || proto === null) return Object.assign({}, value);
    }
    return value;
  }

  // Object helpers: numeric/option properties that flag procedural geometry
  // dirty, plus the flat/smooth shading switch used by primitive shapes.
  function numberValue(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function integerValue(value, fallback, minimum) {
    return Math.max(minimum, Math.round(numberValue(value, fallback)));
  }

  function vectorValue(value, fallback) {
    if (!Array.isArray(value)) return fallback.slice();
    return [
      numberValue(value[0], fallback[0]),
      numberValue(value[1], fallback[1]),
      numberValue(value[2], fallback[2]),
    ];
  }

  function markGeometryDirty() {
    if (this && this.parentObject) {
      this.parentObject.geometryNeedsUpdate = true;
      this.parentObject._geometrySignature = undefined;
    }
  }

  function objectProperty(PZ, definition) {
    return PZ.property.create(
      Object.assign({}, definition, { dynamic: true, changed: markGeometryDirty })
    );
  }

  function applyShading(geometry, shading) {
    if (!geometry) return geometry;
    if (integerValue(shading, 0, 0) === 0) {
      if (typeof geometry.computeFlatVertexNormals === "function") {
        geometry.computeFlatVertexNormals();
      } else if (typeof geometry.computeFaceNormals === "function") {
        geometry.computeFaceNormals();
      }
    } else if (typeof geometry.computeVertexNormals === "function") {
      geometry.computeVertexNormals();
    }
    return geometry;
  }

  // Material helpers: safe texture disposal shared by material authors.
  function disposeMaterialTexture(material, assetKey, uniformKey) {
    var asset = material ? material[assetKey] : null;
    var uniform = material && material.threeObj && material.threeObj.uniforms
      ? material.threeObj.uniforms[uniformKey]
      : null;
    if (material) material[assetKey] = null;
    if (uniform) uniform.value = null;
    var texture = uniform ? uniform.value : null;
    if (asset && material.parentProject && material.parentProject.assets) {
      try {
        material.parentProject.assets.unload(asset);
      } catch (error) {
        if (global.console && global.console.error) {
          global.console.error("ZoidiumPluginApis could not unload a material asset", error);
        }
      }
    }
    if (texture && typeof texture.dispose === "function") texture.dispose();
  }

  // CM3 add picker fixes ----------------------------------------------
  //
  // The Effects and Objects add picker (ui-1.0.72.js, generateAdd) builds a
  // Map from the live registry array when it opens, then searches with
  // `new Fuse(array)`. Fuse reads that array lazily, so an entry a plugin
  // registers while the picker is open is found by search but has no Map row,
  // and appendChild(undefined) throws. Searching a snapshot keeps the results
  // aligned with the rows the picker built.
  //
  // The picker's `name` key also carries a 0.4 weight on the description, so
  // Fuse can rank "Time Offset" (its description mentions bevel) above "Bevel
  // Alpha" for the query "Bevel". Instances keyed on `name` are therefore
  // re-ordered by name match tier: exact, then prefix, then substring, then
  // the rest. Fuse's order is kept inside each tier.
  function fuseKeysIncludeName(keys) {
    return Array.isArray(keys) && keys.some(function (key) {
      return key === "name" || (!!key && typeof key === "object" && key.name === "name");
    });
  }

  function nameMatchTier(name, query) {
    if (name === query) return 0;
    if (name.indexOf(query) === 0) return 1;
    if (name.indexOf(query) !== -1) return 2;
    return 3;
  }

  function rankByNameMatch(results, pattern, wrapped) {
    if (!Array.isArray(results) || results.length < 2 || typeof pattern !== "string") return results;
    var query = pattern.trim().toLowerCase();
    if (!query) return results;
    var tiers = [[], [], [], []];
    results.forEach(function (result) {
      var item = wrapped ? result && result.item : result;
      var name = item && typeof item.name === "string" ? item.name.toLowerCase() : "";
      tiers[nameMatchTier(name, query)].push(result);
    });
    return tiers[0].concat(tiers[1], tiers[2], tiers[3]);
  }

  function installFuseSnapshots() {
    var OriginalFuse = global.Fuse;
    if (typeof OriginalFuse !== "function" || OriginalFuse.__zoidiumSnapshot) return;
    function SnapshotFuse(list, options) {
      var source = Array.isArray(list) ? list.slice() : list;
      var fuse = Reflect.construct(OriginalFuse, [source, options], SnapshotFuse);
      if (options && fuseKeysIncludeName(options.keys)) {
        var wrapped = !!(Array.isArray(options.include) && options.include.length);
        // Looked up at call time, so the Native FX prototype patch still applies.
        Object.defineProperty(fuse, "search", {
          configurable: true,
          writable: true,
          value: function search(pattern) {
            var results = OriginalFuse.prototype.search.apply(this, arguments);
            try {
              return rankByNameMatch(results, pattern, wrapped);
            } catch (_error) {
              return results;
            }
          },
        });
      }
      return fuse;
    }
    // Instances share CM3's prototype, so prototype patches (such as the
    // Native FX search priority) keep applying.
    SnapshotFuse.prototype = OriginalFuse.prototype;
    Object.keys(OriginalFuse).forEach(function (key) { SnapshotFuse[key] = OriginalFuse[key]; });
    Object.defineProperty(SnapshotFuse, "__zoidiumSnapshot", { value: true });
    global.Fuse = SnapshotFuse;
  }

  // CM3's picker key handler moves the highlight through lastElementChild and
  // nextElementSibling, then reads classList on the result. With no matching
  // rows that result is null and the handler throws. Arrow keys in that state
  // have nothing to move, so they stop before reaching CM3.
  function installEmptyPickerArrowGuard() {
    if (typeof global.addEventListener !== "function") return;
    global.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      var input = event.target;
      if (!input || !input.classList || !input.classList.contains("pz-filterbox")) return;
      var panel = input.parentElement;
      var children = panel && panel.children ? Array.prototype.slice.call(panel.children) : [];
      var list = children.find(function (child) { return child.classList && child.classList.contains("pz-options"); });
      var hasRows = !!list && Array.prototype.some.call(list.children, function (child) {
        return child.tagName === "LI";
      });
      if (hasRows) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  installFuseSnapshots();
  installEmptyPickerArrowGuard();

  // Registrations are lazy because this file also runs before CM3 initializes.
  function ownedPatch(holder, key, factory) {
    var original = holder[key];
    var replacement = factory(original);
    holder[key] = replacement;
    return function () { if (holder[key] === replacement) holder[key] = original; };
  }

  var trackFields = new Map();
  var trackFieldHooks = false;
  var retainedTrackFields = new WeakMap();
  function installTrackFieldHooks() {
    if (trackFieldHooks || !global.PZ?.track?.prototype) return;
    var proto = global.PZ.track.prototype;
    ownedPatch(proto, "load", function (original) { return function (data) {
      var retained = {};
      Object.keys(data || {}).forEach(function (key) {
        if (!["type", "clips", "__proto__", "constructor", "prototype"].includes(key)) retained[key] = JSON.parse(JSON.stringify(data[key]));
      });
      retainedTrackFields.set(this, retained);
      var track = this;
      trackFields.forEach(function (field, key) {
        track[key] = data && Object.prototype.hasOwnProperty.call(data, key) ? data[key] : field.default;
      });
      return original.apply(this, arguments);
    }; });
    ownedPatch(proto, "toJSON", function (original) { return function () {
      var data = Object.assign({}, retainedTrackFields.get(this), original.apply(this, arguments));
      var track = this;
      Object.keys(retainedTrackFields.get(this) || {}).forEach(function (key) { if (Object.prototype.hasOwnProperty.call(track, key)) data[key] = track[key]; });
      trackFields.forEach(function (field, key) { data[key] = track[key] === undefined ? (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : field.default) : track[key]; });
      return data;
    }; });
    trackFieldHooks = true;
  }
  function registerTrackField(name, spec) {
    if (!name || ["__proto__", "constructor", "prototype", "type", "clips"].includes(name)) throw new Error("Invalid track field");
    if (trackFields.has(name) && trackFields.get(name).active !== false) throw new Error("Track field already registered: " + name);
    var registration = { default: spec.default, active: true };
    trackFields.set(name, registration);
    installTrackFieldHooks();
    var project = global.CM && global.CM.project;
    if (project && typeof project.forEachItemOfType === "function") project.forEachItemOfType(global.PZ.track, function (track) {
      if (track[name] !== undefined) return;
      var retained = retainedTrackFields.get(track);
      track[name] = retained && Object.prototype.hasOwnProperty.call(retained, name) ? retained[name] : spec.default;
    });
    // Keep serialization support after disposal so disabled plugins do not erase data.
    return function () { registration.active = false; };
  }
  installTrackFieldHooks();

  var trackButtons = new Map();
  var trackLabels = new Set();
  var restoreTrackLabels = null;
  function decorateTrackLabel(label, track, kind, editor) {
    if (!Array.from(trackLabels).some(function (entry) { return entry.label === label; })) trackLabels.add({ label: label, track: track, kind: kind, editor: editor, grid: label.style.gridTemplateColumns });
    trackButtons.forEach(function (spec) {
      if (!spec.kinds.includes(kind) || Array.from(label.children).some(function (child) { return child.dataset?.zoidiumTrackButton === spec.id; })) return;
      var button = global.document.createElement("button");
      button.dataset.zoidiumTrackButton = spec.id;
      button.className = "actionbutton";
      button.textContent = spec.label;
      button.style.cssText = "min-width:22px;height:16px;font-size:10px;border:1px solid var(--zui-border,#555);border-radius:3px;padding:0 2px;cursor:pointer";
      function refresh() {
        var active = !!spec.isActive(track);
        button.title = typeof spec.title === "function" ? spec.title(track) : spec.title || spec.label;
        button.setAttribute("aria-pressed", String(active));
        button.style.background = active ? "var(--zui-accent,#384668)" : "transparent";
        button.style.color = active ? "var(--zui-text-bright,#fff)" : "var(--zui-text-muted,#888)";
      }
      button.onclick = function (event) { event.stopPropagation(); spec.onToggle(track, editor); refresh(); };
      button.pz_refresh = refresh;
      refresh();
      label.insertBefore(button, label.children[1] || null);
    });
    label.style.gridTemplateColumns = "1fr " + "auto ".repeat(label.children.length - 1).trim();
  }
  function refreshTrackButtons() {
    trackLabels.forEach(function (entry) {
      if (!entry.label.isConnected) { trackLabels.delete(entry); return; }
      entry.label.querySelectorAll("[data-zoidium-track-button]").forEach(function (button) { button.pz_refresh(); });
    });
  }
  function registerTrackButton(spec) {
    if (!spec.id || trackButtons.has(spec.id)) throw new Error("Track button already registered or missing id");
    trackButtons.set(spec.id, spec);
    var proto = global.PZ.ui.timeline.tracks.prototype;
    if (!restoreTrackLabels) restoreTrackLabels = ownedPatch(proto, "createTrackLabel", function (original) { return function (track, kind) {
      var label = original.apply(this, arguments);
      decorateTrackLabel(label, track, kind === 0 ? "video" : "audio", this.timeline.editor);
      return label;
    }; });
    trackLabels.forEach(function (entry) { if (entry.label.isConnected) decorateTrackLabel(entry.label, entry.track, entry.kind, entry.editor); });
    // Existing CM3 labels have no track reference; their order matches the sequence.
    var editor = global.CM;
    if (editor && editor.project) {
      var tracks = editor.project.sequence.videoTracks;
      global.document.querySelectorAll('button[title="disable track"],button[title="enable track"]').forEach(function (eye, index) {
        var label = eye.parentElement;
        if (tracks[index] && !label.querySelector("[data-zoidium-track-button]")) decorateTrackLabel(label, tracks[index], "video", editor);
      });
    }
    return function () {
      trackButtons.delete(spec.id);
      trackLabels.forEach(function (entry) {
        entry.label.querySelectorAll("[data-zoidium-track-button]").forEach(function (button) { if (button.dataset.zoidiumTrackButton === spec.id) button.remove(); });
        entry.label.style.gridTemplateColumns = entry.label.querySelector("[data-zoidium-track-button]") ? "1fr " + "auto ".repeat(entry.label.children.length - 1).trim() : entry.grid;
      });
      if (!trackButtons.size && restoreTrackLabels) { restoreTrackLabels(); restoreTrackLabels = null; trackLabels.clear(); }
    };
  }

  var mediaPresets = new Map();
  var restorePresetLoad = null;
  function addMediaPreset(project, spec) {
    if (project.media.some(function (media) { return media.__zoidiumPreset === spec.id; })) return;
    var media = new global.PZ.media();
    project.media.push(media);
    media.__zoidiumPreset = spec.id;
    var data = JSON.parse(JSON.stringify(spec.json));
    data.preset = true;
    data.properties = Object.assign({}, data.properties, { name: spec.name, icon: spec.icon });
    media.loading = media.load(data);
  }
  function registerMediaPreset(spec) {
    if (!spec.id || mediaPresets.has(spec.id)) throw new Error("Media preset already registered or missing id");
    mediaPresets.set(spec.id, spec);
    if (!restorePresetLoad) restorePresetLoad = ownedPatch(global.PZ.project.prototype, "load", function (original) { return function () {
      var result = original.apply(this, arguments);
      var project = this;
      mediaPresets.forEach(function (preset) { addMediaPreset(project, preset); });
      return result;
    }; });
    if (global.CM && global.CM.project) addMediaPreset(global.CM.project, spec);
    return function () {
      mediaPresets.delete(spec.id);
      var project = global.CM && global.CM.project;
      if (project) for (var i = project.media.length - 1; i >= 0; i--) if (project.media[i].__zoidiumPreset === spec.id) { project.media[i].unload(); project.media.splice(i, 1); }
      if (!mediaPresets.size && restorePresetLoad) { restorePresetLoad(); restorePresetLoad = null; }
    };
  }

  function registerLayerType(spec) {
    var PZ = global.PZ;
    PZ.zoidium = PZ.zoidium || {};
    var claims = PZ.zoidium.legacyLayerTypes || (PZ.zoidium.legacyLayerTypes = new Map());
    if (!Number.isInteger(spec.legacyType) || spec.legacyType < 9 || claims.has(spec.legacyType)) throw new Error("Legacy layer type collision: " + spec.legacyType);
    claims.set(spec.legacyType, spec.id);
    var undo = ownedPatch(PZ.layer, "create", function (original) { return function (type) {
      if (type === spec.legacyType || type === spec.type) { var layer = spec.factory(); layer.type = spec.type; return layer; }
      return original.apply(this, arguments);
    }; });
    return function () { undo(); if (claims.get(spec.legacyType) === spec.id) claims.delete(spec.legacyType); };
  }

  var apis = {
    KINDS: KINDS,
    timeline: { registerTrackButton: registerTrackButton, registerTrackField: registerTrackField, refreshTrackButtons: refreshTrackButtons },
    media: { registerPreset: registerMediaPreset },
    layers: { registerType: registerLayerType },
    defineTemporal: defineTemporal,
    defineFrameSampler: defineFrameSampler,
    defineFilter: defineFilter,
    installLifecycleDefaults: installLifecycleDefaults,
    propertyControls: {
      register: registerPropertyControl,
    },
    objects: {
      numberValue: numberValue,
      integerValue: integerValue,
      vectorValue: vectorValue,
      markGeometryDirty: markGeometryDirty,
      property: objectProperty,
      applyShading: applyShading,
    },
    materials: {
      disposeTexture: disposeMaterialTexture,
    },
  };

  global.ZoidiumPluginApis = apis;
  try {
    if (global.PZ && global.PZ.zoidium && typeof global.PZ.zoidium.define === "function") {
      global.PZ.zoidium.define("pluginApis", apis, "zoidium/plugin-apis");
    }
  } catch (_error) {
    // Diagnostics must never prevent the API layer from loading.
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
