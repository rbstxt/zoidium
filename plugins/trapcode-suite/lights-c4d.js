// OpenZoid Trapcode Suite — C4D-style lights.
//
// Installs the Trapcode light types onto the CM3 Light class. install() and
// uninstall() are called by the suite runtime, so disabling the pack restores
// the stock Light prototype methods and removes the property definitions this
// file added. The picker entries live in the plugin manifest.
//
// Each type names the THREE backend it really renders with. Legacy ids that are
// no longer offered in the picker keep loading as the backend they were saved
// with, so existing projects still open.
//
//   id  picker name                           THREE backend
//   --  ------------------------------------  ------------------------------------
//   1   Spot Light                            SpotLight
//   2   Point Light (Omni)                    PointLight
//   3   Infinite Light (Directional)          DirectionalLight
//   4   Area Light                            RectAreaLight when the LTC tables
//                                             are present, else a PointLight
//   5   Hemisphere Light (Sky/Ground)         HemisphereLight
//   7   Sun (Directional)                     DirectionalLight, tinted by elevation
//   6   legacy: IES (no photometric data)     SpotLight (not offered in the picker)
//   8   legacy: Portal (same as Area)         as id 4 (not offered in the picker)
//
// Stock CM3 Light types 1-3 keep their stock behaviour. Stock type 4 (Hemisphere)
// keeps its stock id and properties when it is loaded.

(function () {
    "use strict";

    var CATALOGUE = [
        { id: 2, name: "Point Light (Omni)", listed: true },
        { id: 1, name: "Spot Light", listed: true },
        { id: 3, name: "Infinite Light (Directional)", listed: true },
        { id: 4, name: "Area Light", listed: true },
        { id: 5, name: "Hemisphere Light (Sky/Ground)", listed: true },
        { id: 7, name: "Sun (Directional)", listed: true },
        { id: 6, name: "Spot Light (legacy IES)", listed: false },
        { id: 8, name: "Area Light (legacy Portal)", listed: false },
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

    function addProps(PZ, light, keys) {
        var defs = {};
        keys.forEach(function (key) {
            defs[key] = PZ.property.create(PZ.object3d.light.propertyDefinitions[key]);
        });
        light.properties.addAll(defs);
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

    // Area backend: RectAreaLight when the LTC tables exist, else a PointLight
    // whose name says so. label is the picker name for the rect case.
    function areaBackend(width, height, label) {
        if (hasLtcTables()) {
            return { object: new THREE.RectAreaLight(16777215, 1, width, height), name: label };
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
            return { object: new THREE.SpotLight(16777215, 1, 0, Math.PI / 4, 0.4, 1), name: "Spot Light (legacy IES)", cast: true,
                props: ["color", "position", "target", "intensity", "angle", "penumbra", "distance", "decay", "iesProfile"] };
        },
        7: function () {
            return { object: new THREE.DirectionalLight(16777215, 2), name: "Sun (Directional)", cast: true,
                props: ["color", "position", "target", "intensity", "sunElevation"] };
        },
        8: function () {
            var backend = areaBackend(6, 8, "Area Light (legacy Portal)");
            backend.props = ["color", "position", "target", "intensity", "width", "height"];
            return backend;
        },
    };

    function normalizeType(value, migratingHemi) {
        var e = parseInt(value, 10) || 1;
        if (e === 4 && migratingHemi) return 5;
        if (e < 1 || e > 8) return e === 4 ? 5 : 1;
        return e;
    }

    function install(PZ) {
        if (installed) return;
        var Light = PZ.object3d && PZ.object3d.light;
        if (!Light || !Light.prototype || typeof Light.prototype.changeObjectType !== "function") {
            throw new Error("Trapcode lights need PZ.object3d.light from the CM3 runtime.");
        }
        if (typeof THREE === "undefined") throw new Error("Trapcode lights need the THREE global.");

        var proto = Light.prototype;
        var original = {
            changeObjectType: proto.changeObjectType,
            update: proto.update,
            load: proto.load,
        };
        var wrappers = {};
        var addedDefinitions = [];
        var definitions = Light.propertyDefinitions;
        var extra = propertyDefinitions(PZ);
        Object.keys(extra).forEach(function (key) {
            if (definitions[key] === undefined) {
                definitions[key] = extra[key];
                addedDefinitions.push(key);
            }
        });

        // Each wrapper checks its own alive flag, so a disabled pack falls
        // through to the stock method even if another pack wrapped above it.
        function wrap(name, handler) {
            var wrapper = function () {
                if (!wrapper.__trapcodeSuiteAlive) return original[name].apply(this, arguments);
                return handler.apply(this, arguments);
            };
            wrapper.__trapcodeSuiteLights = true;
            wrapper.__trapcodeSuiteAlive = true;
            wrappers[name] = wrapper;
            proto[name] = wrapper;
        }

        wrap("changeObjectType", changeType);

        function changeType(value) {
            if (this._migratingLegacyHemi) {
                this._migratingLegacyHemi = false;
                // Keep vanilla Hemisphere projects editable and serializable
                // with the pack disabled. Its sky property is named color.
                clearLightProps(this);
                return original.changeObjectType.call(this, 4);
            }
            var e = normalizeType(value, this._migratingLegacyHemi);
            this._migratingLegacyHemi = false;
            this.objectType = e;
            clearLightProps(this);
            var backend = BACKENDS[e]();
            this.threeObj = backend.object;
            addProps(PZ, this, backend.props);
            setupShadows(this.threeObj, !!backend.cast);
            if (this.properties.name && this.properties.name.set) {
                try { this.properties.name.set(backend.name); } catch (_error) { /* display only */ }
            }
            if (typeof this.parentChanged === "function") this.parentChanged();
        }

        // Legacy Hemisphere (stock id 4, with groundColor and no width/height)
        // keeps its stock backend and properties. Stock id 4 with a Trapcode Area
        // payload (width/height present) keeps meaning Area.
        wrap("load", function (data) {
            if (data && typeof data === "object" && data.objectType === 4) {
                var props = data.properties || {};
                if (props.groundColor !== undefined && props.width === undefined && props.height === undefined) {
                    this._migratingLegacyHemi = true;
                }
            }
            return original.load.call(this, data);
        });

        wrap("update", function (time) {
            try {
                syncLight.call(this, time);
            } catch (_error) {
                original.update.call(this, time);
            }
        });

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

        installed = { PZ: PZ, Light: Light, original: original, wrappers: wrappers, addedDefinitions: addedDefinitions };
    }

    function uninstall() {
        var state = installed;
        installed = null;
        if (!state) return;
        var proto = state.Light.prototype;
        Object.keys(state.wrappers).forEach(function (name) {
            var wrapper = state.wrappers[name];
            wrapper.__trapcodeSuiteAlive = false;
            if (proto[name] === wrapper) proto[name] = state.original[name];
        });
        state.addedDefinitions.forEach(function (key) {
            delete state.Light.propertyDefinitions[key];
        });
    }

    var T = (typeof PZ !== "undefined" && PZ.trapcode) || null;
    if (T) {
        T.lights = { install: install, uninstall: uninstall, catalogue: CATALOGUE };
    }
})();
