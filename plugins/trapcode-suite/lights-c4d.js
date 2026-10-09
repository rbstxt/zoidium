// OpenZoid Trapcode Suite — C4D-style lights (adapted from lights-c4d.js).
// Zoidium adaptation: the 3D picker list is owned by this plugin's manifest
// Light replacement entry, so the imperative picker rewrite from the OpenZoid
// checkout is disabled at the bottom of this file. The light catalogue,
// property definitions, prototype patches, and legacy Hemisphere migration
// are unchanged. Safe to evaluate more than once (guarded below).
/*
 * lights-c4d.js
 *
 * Cinema 4D-style light types for OpenZoid / Panzoid Clipmaker.
 *
 * What this does:
 * 1. Clicking "Light" in the 3D-objects add-menu now drills into a
 *    sub-menu with 8 choices (hidelist removed) instead of instantly
 *    creating a default Spot light.
 * 2. Adds 8 C4D light types, each mapped to the closest THREE.js
 *    (r91) light available in this project:
 *
 *    id  UI name (objectType)              THREE backend
 *    --  --------------------------------  -----------------------------
 *    1   Spot Light                      -> THREE.SpotLight
 *    2   Point Light (Omni)              -> THREE.PointLight
 *    3   Infinite Light (Directional)    -> THREE.DirectionalLight
 *    4   Area Light                      -> THREE.RectAreaLight (fallback PointLight)
 *    5   Dome Light (Sky/HDRI)           -> THREE.HemisphereLight (+ ambient feel)
 *    6   Photometric IES Light           -> THREE.SpotLight + IES profile label
 *    7   Physical Sun                    -> THREE.DirectionalLight + sun-elevation tint
 *    8   Portal Light                    -> THREE.RectAreaLight (fallback DirectionalLight)
 *
 * Backward compatibility:
 * - Old projects used objectType 1=Spot, 2=Point, 3=Directional,
 *   4=Hemisphere. Types 1-3 are unchanged.
 * - Old type 4 (Hemisphere) auto-migrates to new type 5 (Dome),
 *   which uses the same HemisphereLight backend so old scenes look identical.
 *
 * Loaded AFTER core-1.0.102.js and ui-1.0.72.js (see clipmaker.html).
 */

(function () {
    if (typeof PZ === "undefined" || !PZ.object3d || !PZ.object3d.light) return;

    var Light = PZ.object3d.light;

    // The Trapcode Suite module may evaluate this file again on re-enable.
    // The prototype wraps below capture their predecessors, so run once.
    if (
        Light.prototype.changeObjectType &&
        Light.prototype.changeObjectType.__trapcodeSuiteLights
    ) {
        return;
    }

    // ------------------------------------------------------------------
    // 1. Catalogue (single source of truth for menu + backend)
    // ------------------------------------------------------------------

    Light.C4D_TYPES = [
        {
            id: 2,
            name: "Point Light (Omni)",
            desc: "Emits light uniformly in all directions from a single, infinitesimally small point in space, like a bare lightbulb.",
        },
        {
            id: 1,
            name: "Spot Light",
            desc: "Emits directional light restricted within a cone shape, useful for focused beams or theatrical spotlights.",
        },
        {
            id: 3,
            name: "Infinite Light (Directional)",
            desc: "Simulates a light source infinitely far away (like the sun). Rays are parallel and do not decay over distance.",
        },
        {
            id: 4,
            name: "Area Light",
            desc: "Features a physical size and rectangular shape, perfect for realistic soft shadows and studio reflections.",
        },
        {
            id: 5,
            name: "Dome Light (Sky/HDRI)",
            desc: "Enrounds the entire scene with a large sphere to illuminate objects using an HDRI image environment.",
        },
        {
            id: 6,
            name: "Photometric IES Light",
            desc: "Uses real-world manufacturer .ies profile data to accurately simulate specific architectural light fixtures.",
        },
        {
            id: 7,
            name: "Physical Sun",
            desc: "Mimics precise natural sunlight and changes color temperature based on its angle of incidence.",
        },
        {
            id: 8,
            name: "Portal Light",
            desc: "Optimizes global illumination by guiding indirect ambient light through tight openings like window frames.",
        },
    ];

    Light.C4D_NAMES = {
        1: "Spot Light",
        2: "Point Light",
        3: "Infinite Light",
        4: "Area Light",
        5: "Dome Light",
        6: "IES Light",
        7: "Physical Sun",
        8: "Portal Light",
    };

    // ------------------------------------------------------------------
    // 2. Extra property definitions (only new keys; old ones are kept)
    // ------------------------------------------------------------------

    var D = Light.propertyDefinitions;

    if (!D.distance) {
        D.distance = {
            dynamic: true,
            name: "Distance",
            type: PZ.property.type.NUMBER,
            value: 0,
            min: 0,
            max: 5000,
            step: 1,
            decimals: 0,
        };
    }
    if (!D.decay) {
        D.decay = {
            dynamic: true,
            name: "Decay",
            type: PZ.property.type.NUMBER,
            value: 1,
            min: 0,
            max: 4,
            step: 0.1,
            decimals: 2,
        };
    }
    if (!D.penumbra) {
        D.penumbra = {
            dynamic: true,
            name: "Penumbra",
            type: PZ.property.type.NUMBER,
            value: 0.5,
            min: 0,
            max: 1,
            step: 0.05,
            decimals: 2,
        };
    }
    if (!D.width) {
        D.width = {
            dynamic: true,
            name: "Width",
            type: PZ.property.type.NUMBER,
            value: 10,
            min: 0.1,
            max: 200,
            step: 0.5,
            decimals: 1,
        };
    }
    if (!D.height) {
        D.height = {
            dynamic: true,
            name: "Height",
            type: PZ.property.type.NUMBER,
            value: 10,
            min: 0.1,
            max: 200,
            step: 0.5,
            decimals: 1,
        };
    }
    if (!D.sunElevation) {
        D.sunElevation = {
            dynamic: true,
            name: "Sun Elevation",
            type: PZ.property.type.NUMBER,
            value: 45,
            min: 0,
            max: 90,
            step: 1,
            decimals: 0,
        };
    }
    if (!D.iesProfile) {
        D.iesProfile = {
            dynamic: false,
            name: "IES Profile",
            type: PZ.property.type.TEXT,
            value: "default.ies",
        };
    }

    var LIGHT_PROP_KEYS = [
        "position",
        "target",
        "color",
        "skyColor",
        "groundColor",
        "intensity",
        "angle",
        "distance",
        "decay",
        "penumbra",
        "width",
        "height",
        "sunElevation",
        "iesProfile",
    ];

    function clearLightProps(light) {
        for (var i = 0; i < LIGHT_PROP_KEYS.length; i++) {
            var k = LIGHT_PROP_KEYS[i];
            if (k === "name") continue;
            if (light.properties[k]) {
                try {
                    light.properties.remove(k);
                } catch (e) {
                    delete light.properties[k];
                }
            }
        }
    }

    function addProps(light, keys) {
        var defs = {};
        for (var i = 0; i < keys.length; i++) {
            defs[keys[i]] = PZ.property.create(Light.propertyDefinitions[keys[i]]);
        }
        light.properties.addAll(defs);
    }

    function setupShadows(threeObj, opts) {
        opts = opts || {};
        if (opts.cast) {
            threeObj.castShadow = true;
            threeObj.shadow = threeObj.shadow || {};
            threeObj.shadow.mapSize = threeObj.shadow.mapSize || {};
            threeObj.shadow.mapSize.height = 1024;
            threeObj.shadow.mapSize.width = 1024;
            if (threeObj.shadow.camera) {
                threeObj.shadow.camera.near = 5;
                threeObj.shadow.camera.far = 1500;
                if (threeObj.shadow.camera.fov !== undefined) {
                    threeObj.shadow.camera.fov = 60;
                }
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

    // ------------------------------------------------------------------
    // 3. Backend: create the right THREE object per type
    //    (keeps 1/2/3 identical to the original implementation)
    // ------------------------------------------------------------------

    var origChange = Light.prototype.changeObjectType;
    var origUpdate = Light.prototype.update;
    var origLoad = Light.prototype.load;

    Light.prototype.changeObjectType = function (e) {
        e = parseInt(e, 10) || 1;
        // Legacy Hemisphere (old id 4) -> new Dome (id 5). Same look.
        if (e === 4 && this._migratingLegacyHemi) {
            e = 5;
            this._migratingLegacyHemi = false;
        } else if (e < 1 || e > 8) {
            // Unknown id (e.g. very old data): fall back to Spot.
            // Old id 4 Hemisphere no longer exists here; anything
            // hitting this branch that carries groundColor is Dome-like.
            if (e === 4) e = 5;
            else e = 1;
        }
        this.objectType = e;
        clearLightProps(this);

        var label = Light.C4D_NAMES[e] || "Light";
        var t = label;

        switch (e) {
            case 1: // Spot (original behaviour preserved)
                t = "Spot Light";
                this.threeObj = new THREE.SpotLight(16777215, 1, 0, Math.PI / 3, 0.5, 1);
                addProps(this, ["color", "position", "target", "intensity", "angle", "penumbra", "distance", "decay"]);
                setupShadows(this.threeObj, { cast: true });
                break;

            case 2: // Point / Omni (original behaviour preserved)
                t = "Point Light";
                this.threeObj = new THREE.PointLight(16777215, 1, 0);
                addProps(this, ["color", "position", "intensity", "distance", "decay"]);
                setupShadows(this.threeObj, { cast: true });
                break;

            case 3: // Infinite / Directional (original behaviour preserved)
                t = "Infinite Light";
                this.threeObj = new THREE.DirectionalLight(16777215, 1);
                addProps(this, ["color", "position", "target", "intensity"]);
                setupShadows(this.threeObj, { cast: true });
                break;

            case 4: // Area (rectangular, soft studio light)
                t = "Area Light";
                if (typeof THREE.RectAreaLight !== "undefined") {
                    this.threeObj = new THREE.RectAreaLight(16777215, 1, 10, 10);
                } else {
                    this.threeObj = new THREE.PointLight(16777215, 1, 0);
                }
                addProps(this, ["color", "position", "target", "intensity", "width", "height"]);
                setupShadows(this.threeObj, { cast: false });
                break;

            case 5: // Dome / Sky (hemisphere backend = same as old type 4)
                t = "Dome Light";
                this.threeObj = new THREE.HemisphereLight(16777215, 16777215, 1);
                addProps(this, ["skyColor", "groundColor", "intensity"]);
                // Expose a plain "color" alias? No - Dome uses sky/ground pair.
                setupShadows(this.threeObj, { cast: false });
                break;

            case 6: // IES photometric (spot backend + profile tag)
                t = "IES Light";
                this.threeObj = new THREE.SpotLight(16777215, 1, 0, Math.PI / 4, 0.4, 1);
                addProps(this, ["color", "position", "target", "intensity", "angle", "penumbra", "distance", "decay", "iesProfile"]);
                setupShadows(this.threeObj, { cast: true });
                break;

            case 7: // Physical Sun (directional backend + elevation tint)
                t = "Physical Sun";
                this.threeObj = new THREE.DirectionalLight(16777215, 2);
                addProps(this, ["color", "position", "target", "intensity", "sunElevation"]);
                setupShadows(this.threeObj, { cast: true });
                break;

            case 8: // Portal (rect-area backend guiding light through openings)
                t = "Portal Light";
                if (typeof THREE.RectAreaLight !== "undefined") {
                    this.threeObj = new THREE.RectAreaLight(16777215, 1, 6, 8);
                } else {
                    this.threeObj = new THREE.DirectionalLight(16777215, 1);
                }
                addProps(this, ["color", "position", "target", "intensity", "width", "height"]);
                setupShadows(this.threeObj, { cast: false });
                break;
        }

        if (this.properties.name && this.properties.name.set) {
            try {
                this.properties.name.set(t);
            } catch (err) { /* name is display-only */ }
        }
        if (typeof this.parentChanged === "function") this.parentChanged();
    };
    Light.prototype.changeObjectType.__trapcodeSuiteLights = true;

    // Legacy migration hook: old Hemisphere JSON -> Dome.
    Light.prototype.load = function (e) {
        if (e && typeof e === "object" && e.objectType === 4) {
            var props = e.properties || {};
            // Old Hemisphere payloads carry groundColor and no width/height.
            // New id 4 is Area Light (width/height), so this must be legacy.
            if (props.groundColor !== undefined && props.width === undefined && props.height === undefined) {
                this._migratingLegacyHemi = true;
            }
        }
        return origLoad.call(this, e);
    };

    // ------------------------------------------------------------------
    // 4. Per-frame sync of PZ properties -> THREE object
    // ------------------------------------------------------------------

    Light.prototype.update = function (time) {
        var t;
        var o = this.threeObj;
        if (!o) return;
        try {
            if (this.properties.position) {
                t = this.properties.position.get(time);
                if (o.position) o.position.set(t[0], t[1], t[2]);
            }
            if (this.properties.target && o.target) {
                t = this.properties.target.get(time);
                o.target.position.set(t[0], t[1], t[2]);
                if (o.target.updateMatrixWorld) o.target.updateMatrixWorld();
            }
            // RectAreaLight (Area / Portal) aims via lookAt.
            // r91 may not set isRectAreaLight, so detect by width/height too.
            var isRect = o.isRectAreaLight || o.type === "RectAreaLight" ||
                (o.width !== undefined && o.height !== undefined &&
                    (this.objectType === 4 || this.objectType === 8));
            if (isRect && o.lookAt) {
                if (this.properties.target) {
                    t = this.properties.target.get(time);
                    // lookAt needs a world-space point; target position works here.
                    try { o.lookAt(t[0], t[1], t[2]); } catch (err) {}
                }
            }
            if (this.properties.color && o.color) {
                t = this.properties.color.get(time);
                // Physical Sun tints base color by elevation.
                if (this.objectType === 7 && this.properties.sunElevation) {
                    var elev = this.properties.sunElevation.get(time);
                    var tint = sunTint(elev);
                    o.color.setRGB(
                        Math.min(1, t[0] * tint[0]),
                        Math.min(1, t[1] * tint[1]),
                        Math.min(1, t[2] * tint[2])
                    );
                } else {
                    o.color.setRGB(t[0], t[1], t[2]);
                }
            } else if (this.properties.skyColor && o.color) {
                // Dome Light uses skyColor as the main color.
                t = this.properties.skyColor.get(time);
                o.color.setRGB(t[0], t[1], t[2]);
            }
            if (this.properties.groundColor && o.groundColor) {
                t = this.properties.groundColor.get(time);
                o.groundColor.setRGB(t[0], t[1], t[2]);
            }
            if (this.properties.intensity && o.intensity !== undefined) {
                o.intensity = this.properties.intensity.get(time);
            }
            if (this.properties.angle && o.angle !== undefined) {
                o.angle = (this.properties.angle.get(time) * Math.PI) / 180;
            }
            if (this.properties.penumbra !== undefined && o.penumbra !== undefined && this.properties.penumbra) {
                o.penumbra = this.properties.penumbra.get(time);
            }
            if (this.properties.distance !== undefined && o.distance !== undefined && this.properties.distance) {
                o.distance = this.properties.distance.get(time);
            }
            if (this.properties.decay !== undefined && o.decay !== undefined && this.properties.decay) {
                o.decay = this.properties.decay.get(time);
            }
            if (this.properties.width && o.width !== undefined) {
                o.width = Math.max(0.1, this.properties.width.get(time));
            }
            if (this.properties.height && o.height !== undefined) {
                o.height = Math.max(0.1, this.properties.height.get(time));
            }
        } catch (err) {
            // Fall back to original updater if anything unexpected happens.
            try { origUpdate.call(this, time); } catch (e2) {}
        }
    };

    // ------------------------------------------------------------------
    // 5. Picker list ownership (Zoidium adaptation).
    //
    // The OpenZoid checkout rewrote the Light picker entry imperatively here.
    // In Zoidium that list is owned by this plugin's manifest Light
    // replacement entry, which the plugin manager installs on enable and
    // restores on disable. Rewriting it here as well would fight the manager
    // (and other Light providers such as Light+), so this section is
    // intentionally a no-op. The C4D_TYPES catalogue above stays as the
    // single source of truth mirrored by the manifest.
    // ------------------------------------------------------------------
})();
