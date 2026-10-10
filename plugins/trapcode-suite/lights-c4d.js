// OpenZoid Trapcode Suite — C4D-style lights.
//
// Separate namespaced CM3 Light subclasses. Only legacy load dispatch is
// installed on stock Light plus a selection-helper mapping (ids 5-8 report
// the stock id their backend matches while CM3 draws its gizmo); creating
// and updating vanilla lights stays stock.
// install() and uninstall() are owned by the suite runtime lifecycle.
//
// Each type names the THREE backend it really renders with. Saved ids keep
// loading as the backend they were saved with, so existing projects still
// open. Stock CM3 Light types 1-3 keep their stock behaviour.
//
//   id  picker name                           THREE backend
//   --  ------------------------------------  ------------------------------------
//   1   Spot Light                            SpotLight
//   2   Point Light (Omni)                    PointLight
//   3   Infinite Light (Directional)          DirectionalLight
//   4   Area Light                            RectAreaLight when the LTC tables
//                                             are present, else a PointLight
//   5   Hemisphere Light (Sky/Ground)         HemisphereLight
//   6   Photometric IES Light                 SpotLight + IES profile label
//   7   Sun (Directional)                     DirectionalLight, tinted by elevation
//   8   Portal Light                          RectAreaLight (6x8), else a
//                                             DirectionalLight fallback
//
// Stock type 4 (Hemisphere)
// keeps its stock id and properties when it is loaded.

(function () {
    "use strict";

    var CATALOGUE = [
        { id: 2, name: "Point Light (Omni)", listed: true },
        { id: 1, name: "Spot Light", listed: true },
        { id: 3, name: "Infinite Light (Directional)", listed: true },
        { id: 4, name: "Area Light", listed: true },
        { id: 5, name: "Hemisphere Light (Sky/Ground)", listed: true },
        { id: 6, name: "Photometric IES Light", listed: true },
        { id: 7, name: "Sun (Directional)", listed: true },
        { id: 8, name: "Portal Light", listed: true },
    ];

    var EXTRA_DEFINITIONS = {
        distance: { dynamic: true, name: "Distance", type: 0, value: 0, min: 0, max: 5000, step: 1, decimals: 0 },
        decay: { dynamic: true, name: "Decay", type: 0, value: 1, min: 0, max: 4, step: 0.1, decimals: 2 },
        penumbra: { dynamic: true, name: "Penumbra", type: 0, value: 0.5, min: 0, max: 1, step: 0.05, decimals: 2 },
        width: { dynamic: true, name: "Width", type: 0, value: 10, min: 0.1, max: 200, step: 0.5, decimals: 1 },
        height: { dynamic: true, name: "Height", type: 0, value: 10, min: 0.1, max: 200, step: 0.5, decimals: 1 },
        sunElevation: { dynamic: true, name: "Sun Elevation", type: 0, value: 45, min: 0, max: 90, step: 1, decimals: 0 },
        iesProfile: { dynamic: false, name: "IES Profile", type: 7, value: "default.ies" },
    };

    var LIGHT_PROP_KEYS = [
        "position", "target", "color", "skyColor", "groundColor", "intensity", "angle",
        "distance", "decay", "penumbra", "width", "height", "sunElevation", "iesProfile",
    ];

    var installed = null;

    // CM3's selection helper (PZ.ui.helper3d) only knows the stock light ids
    // 1-4; ids 5-8 leave its helper null and log "THREE.Object3D.add: object
    // not an instance of THREE.Object3D. null" on every selection. While the
    // helper runs, suite lights temporarily report the stock id whose helper
    // matches their THREE backend (Hemisphere->4, Spot->1, Directional->3;
    // Portal uses 3 on its directional fallback and 2 on the rect backend,
    // whose PointLightHelper only needs position and color). Editor gizmos
    // only; rendering and serialization keep the real ids.
    function suiteHelperId(light) {
        var id = light && light.objectType;
        if (light && typeof light.type === "string" &&
            light.type.indexOf("zoidium:trapcode-suite/") === 0) {
            if (id === 5) return 4;
            if (id === 6) return 1;
            if (id === 7) return 3;
            if (id === 8) {
                var o = light.threeObj;
                var isRect = o && (o.isRectAreaLight || o.type === "RectAreaLight");
                return isRect ? 2 : 3;
            }
        }
        return null;
    }

    function wrapHelper(Helper) {
        var original = Helper.prototype.objectsChanged;
        function patched() {
            var objects = this.objects;
            var target = objects && objects.length === 1 ? objects[0] : null;
            var mapped = suiteHelperId(target);
            if (mapped === null) return original.apply(this, arguments);
            var real = target.objectType;
            target.objectType = mapped;
            try {
                return original.apply(this, arguments);
            } finally {
                target.objectType = real;
            }
        }
        patched.alive = true;
        Helper.prototype.objectsChanged = patched;
        return original;
    }

    // Helper instances bind objectsChanged in their constructor, so a
    // prototype patch alone never reaches viewports built before install.
    // Rebind the live main-viewport helper (if any) to the current prototype
    // method and move its list subscription onto the new binding.
    function rebindHelperInstance(Helper) {
        var CMRef = typeof CM !== "undefined" ? CM : null;
        var viewport = CMRef && CMRef.mainViewport;
        var helper = viewport && viewport.helper3d;
        if (!helper || typeof helper.objectsChanged !== "function" ||
            !helper.objectsChanged_bound || (Helper && !(helper instanceof Helper))) return;
        var rebound = helper.objectsChanged.bind(helper);
        var objects = helper.objects;
        if (objects && objects.onListChanged &&
            typeof objects.onListChanged.unwatch === "function" &&
            typeof objects.onListChanged.watch === "function") {
            try { objects.onListChanged.unwatch(helper.objectsChanged_bound); } catch (_error) {}
            helper.objectsChanged_bound = rebound;
            try { objects.onListChanged.watch(helper.objectsChanged_bound, true); } catch (_error) {}
        } else {
            helper.objectsChanged_bound = rebound;
        }
    }

    function hasLtcTables() {
        var uniforms = typeof THREE !== "undefined" ? THREE.UniformsLib : null;
        return !!(uniforms && uniforms.LTC_1 && uniforms.LTC_2);
    }

    function propertyDefinitions(PZ) {
        var numberType = PZ.property.type.NUMBER;
        var textType = PZ.property.type.TEXT;
        var out = {};
        Object.keys(EXTRA_DEFINITIONS).forEach(function (key) {
            var def = EXTRA_DEFINITIONS[key];
            out[key] = {};
            Object.keys(def).forEach(function (field) {
                out[key][field] = field === "type" ? (def.type === 7 ? textType : numberType) : def[field];
            });
        });
        return out;
    }

    function clearLightProps(light) {
        LIGHT_PROP_KEYS.forEach(function (key) {
            if (!light.properties[key]) return;
            try {
                light.properties.remove(key);
            } catch (_error) {
                delete light.properties[key];
            }
        });
    }

    function setupShadows(threeObj, cast) {
        if (cast) {
            threeObj.castShadow = true;
            threeObj.shadow = threeObj.shadow || {};
            threeObj.shadow.mapSize = threeObj.shadow.mapSize || {};
            threeObj.shadow.mapSize.height = 1024;
            threeObj.shadow.mapSize.width = 1024;
            if (threeObj.shadow.camera) {
                threeObj.shadow.camera.near = 5;
                threeObj.shadow.camera.far = 1500;
                if (threeObj.shadow.camera.fov !== undefined) threeObj.shadow.camera.fov = 60;
            }
            if (threeObj.shadow.bias === undefined) threeObj.shadow.bias = 0;
        } else if (threeObj.castShadow !== undefined) {
            threeObj.castShadow = false;
        }
    }

    // Warm (low sun) -> white (high sun). Elevation in degrees 0..90.
    function sunTint(elevDeg) {
        var t = Math.max(0, Math.min(1, elevDeg / 60));
        return [1, 0.55 + 0.45 * t, 0.3 + 0.7 * t];
    }

    // Area backend: RectAreaLight when the LTC tables exist, else a fallback
    // light whose name says so. label is the picker name for the rect case.
    // The Portal type falls back to a DirectionalLight, matching the donor;
    // the Area type falls back to a PointLight.
    function areaBackend(width, height, label, fallback) {
        if (hasLtcTables()) {
            return { object: new THREE.RectAreaLight(16777215, 1, width, height), name: label };
        }
        if (fallback === "directional") {
            return { object: new THREE.DirectionalLight(16777215, 1), name: label + " (directional approximation)" };
        }
        return { object: new THREE.PointLight(16777215, 1, 0), name: label + " (point approximation)" };
    }

    var BACKENDS = {
        1: function () {
            return { object: new THREE.SpotLight(16777215, 1, 0, Math.PI / 3, 0.5, 1), name: "Spot Light", cast: true,
                props: ["color", "position", "target", "intensity", "angle", "penumbra", "distance", "decay"] };
        },
        2: function () {
            return { object: new THREE.PointLight(16777215, 1, 0), name: "Point Light", cast: true,
                props: ["color", "position", "intensity", "distance", "decay"] };
        },
        3: function () {
            return { object: new THREE.DirectionalLight(16777215, 1), name: "Infinite Light", cast: true,
                props: ["color", "position", "target", "intensity"] };
        },
        4: function () {
            var backend = areaBackend(10, 10, "Area Light");
            backend.props = ["color", "position", "target", "intensity", "width", "height"];
            return backend;
        },
        5: function () {
            return { object: new THREE.HemisphereLight(16777215, 16777215, 1), name: "Hemisphere Light (Sky/Ground)",
                cast: false, props: ["skyColor", "groundColor", "intensity"] };
        },
        6: function () {
            return { object: new THREE.SpotLight(16777215, 1, 0, Math.PI / 4, 0.4, 1), name: "Photometric IES Light", cast: true,
                props: ["color", "position", "target", "intensity", "angle", "penumbra", "distance", "decay", "iesProfile"] };
        },
        7: function () {
            return { object: new THREE.DirectionalLight(16777215, 2), name: "Sun (Directional)", cast: true,
                props: ["color", "position", "target", "intensity", "sunElevation"] };
        },
        8: function () {
            var backend = areaBackend(6, 8, "Portal Light", "directional");
            backend.props = ["color", "position", "target", "intensity", "width", "height"];
            return backend;
        },
    };

    var lightClasses = null;
    var LIGHT_TYPES = { 1: "spot-light", 2: "point-light", 3: "infinite-light", 4: "area-light",
        5: "hemisphere-light", 6: "ies-light", 7: "sun-light", 8: "portal-light" };

    function legacyType(data) {
        var props = data.properties || {};
        var id = Number(data.objectType);
        if (id === 4) {
            if (props.width !== undefined || props.height !== undefined) return 4;
            if (props.groundColor !== undefined || props.color === undefined) return null;
            return 4;
        }
        if (id >= 4 && id <= 8) return id;
        if (id >= 1 && id <= 3 && (props.distance !== undefined || props.penumbra !== undefined || props.decay !== undefined)) return id;
        return null;
    }

    function install(PZ, registry) {
        if (installed) return;
        var Light = PZ.object3d.light;
        if (!Light) throw new Error("Trapcode lights need the CM3 Light class.");
        if (!lightClasses) {
            lightClasses = {};
            Object.keys(LIGHT_TYPES).forEach(function (key) {
                var id = Number(key);
                class TrapcodeLight extends Light {
                    constructor() { super(); this.objectType = id; this.type = "zoidium:trapcode-suite/" + LIGHT_TYPES[id]; }
                    changeObjectType() {
                        this.objectType = id;
                        clearLightProps(this);
                        var backend = BACKENDS[id]();
                        this.threeObj = backend.object;
                        var defs = Object.assign({}, Light.propertyDefinitions, propertyDefinitions(PZ));
                        var props = {};
                        backend.props.forEach(function (key) { props[key] = PZ.property.create(defs[key]); });
                        this.properties.addAll(props);
                        setupShadows(this.threeObj, !!backend.cast);
                        if (this.parentChanged) this.parentChanged();
                    }
                    load(data) {
                        this.changeObjectType();
                        this.properties.load(data && data.properties);
                        // Names belong to the project once saved.
                        if (!data || !data.properties || data.properties.name === undefined) {
                            this.properties.name.set(CATALOGUE.find(function (entry) { return entry.id === id; }).name);
                        }
                    }
                    toJSON() { return { type: this.type, objectType: id, properties: this.properties }; }
                    update(time) { syncLight.call(this, time); }
                }
                TrapcodeLight.prototype.defaultName = CATALOGUE.find(function (entry) { return entry.id === id; }).name;
                lightClasses[id] = TrapcodeLight;
            });
        }
        var original = Light.prototype.load;
        var patched = function (data) {
            var id = patched.alive && data && legacyType(data);
            if (id) {
                Object.setPrototypeOf(this, lightClasses[id].prototype);
                this.type = "zoidium:trapcode-suite/" + LIGHT_TYPES[id];
                return this.load(data);
            }
            return original.apply(this, arguments);
        };
        patched.alive = true;
        var unregister = [];
        installed = { Light: Light, original: original, patched: patched, unregister: unregister };
        Light.prototype.load = patched;
        var Helper = PZ.ui && PZ.ui.helper3d;
        if (Helper && Helper.prototype && typeof Helper.prototype.objectsChanged === "function" &&
            !Helper.prototype.objectsChanged.alive) {
            installed.helperOriginal = wrapHelper(Helper);
            installed.helperHost = Helper;
            rebindHelperInstance(Helper);
        }
        if (registry && registry.registerClass) {
            Object.keys(LIGHT_TYPES).forEach(function (key) {
                var id = Number(key);
                unregister.push(registry.registerClass({ type: "zoidium:trapcode-suite/" + LIGHT_TYPES[id],
                    name: lightClasses[id].prototype.defaultName, schemaVersion: 1,
                    factory: function () { return new lightClasses[id](); } }));
            });
        }
        function syncLight(time) {
            var o = this.threeObj;
            if (!o) return;
            var p = this.properties;
            var t;
            if (p.position && o.position) {
                t = p.position.get(time);
                o.position.set(t[0], t[1], t[2]);
            }
            if (p.target && o.target) {
                t = p.target.get(time);
                o.target.position.set(t[0], t[1], t[2]);
                o.target.updateMatrixWorld();
            }
            // Rect lights aim with lookAt(), which reads the object's local
            // position, so the position above must be set first. The matrix is
            // refreshed afterwards so later readers see this frame's transform.
            if (o.isRectAreaLight && p.target && o.lookAt) {
                t = p.target.get(time);
                o.lookAt(t[0], t[1], t[2]);
            }
            o.updateMatrixWorld();
            if (p.color && o.color) {
                t = p.color.get(time);
                if (this.objectType === 7 && p.sunElevation) {
                    var tint = sunTint(p.sunElevation.get(time));
                    o.color.setRGB(Math.min(1, t[0] * tint[0]), Math.min(1, t[1] * tint[1]), Math.min(1, t[2] * tint[2]));
                } else {
                    o.color.setRGB(t[0], t[1], t[2]);
                }
            } else if (p.skyColor && o.color) {
                t = p.skyColor.get(time);
                o.color.setRGB(t[0], t[1], t[2]);
            }
            if (p.groundColor && o.groundColor) {
                t = p.groundColor.get(time);
                o.groundColor.setRGB(t[0], t[1], t[2]);
            }
            if (p.intensity && o.intensity !== undefined) o.intensity = p.intensity.get(time);
            if (p.angle && o.angle !== undefined) o.angle = (p.angle.get(time) * Math.PI) / 180;
            if (p.penumbra && o.penumbra !== undefined) o.penumbra = p.penumbra.get(time);
            if (p.distance && o.distance !== undefined) o.distance = p.distance.get(time);
            if (p.decay && o.decay !== undefined) o.decay = p.decay.get(time);
            if (p.width && o.width !== undefined) o.width = Math.max(0.1, p.width.get(time));
            if (p.height && o.height !== undefined) o.height = Math.max(0.1, p.height.get(time));
        }

    }

    function uninstall() {
        var state = installed;
        installed = null;
        if (!state) return;
        state.patched.alive = false;
        if (state.Light.prototype.load === state.patched) state.Light.prototype.load = state.original;
        if (state.helperHost && state.helperHost.prototype.objectsChanged &&
            state.helperHost.prototype.objectsChanged.alive === true && state.helperOriginal) {
            state.helperHost.prototype.objectsChanged = state.helperOriginal;
            rebindHelperInstance(state.helperHost);
        }
        state.unregister.reverse().forEach(function (fn) { fn(); });
    }

    var T = (typeof PZ !== "undefined" && PZ.trapcode) || null;
    if (T) {
        T.lights = { install: install, uninstall: uninstall, catalogue: CATALOGUE, legacyType: legacyType };
    }
})();
