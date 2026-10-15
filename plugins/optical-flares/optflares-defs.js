"use strict";

// OpenZoid Optical Flares - 3D flare object (numeric PZ.object3d type 13).
//
// The flare lives in a 3D scene layer. Its source is a 3D point: the flare's
// own world position (Object 3D), a light in the same layer (Light), or a
// screen offset kept for projects saved before the object was 3D (Screen 2D).
//
// Each frame has two phases:
//   update(time)   evaluates properties at `time` and fills the element uniforms.
//                  It reads property values only.
//   render hook    runs when the layer's pass draws the flare quad, after every
//                  object of the layer has been updated. It projects the source
//                  through the camera drawing the pass (position, rotation, FOV,
//                  aspect and any camera override all apply), then sets the
//                  source, centre, depth and brightness uniforms.
//
// The flare is one screen-space quad drawn by the layer's own render pass. The
// quad's depth is the source depth, so with Occlude on, scene geometry in front
// of the source hides the flare through the depth buffer. No raycasts or mesh
// caches are involved, and nothing is carried from one render to the next.

// Optical Flares shared definitions: property helpers, the lens object
// catalogue, the flare stack element class and the preset stacks. Created
// with the CM3 runtime (PZ); the object file and the options window consume
// the returned names.

module.exports = function createDefs(PZ) {
    if (!PZ) throw new Error("Optical Flares definitions need the CM3 runtime.");

    function number(name, value, extra) {
        var def = { dynamic: true, name: name, type: PZ.property.type.NUMBER, value: value };
        if (extra) for (var k in extra) def[k] = extra[k];
        return def;
    }

    function option(name, value, items, dynamic) {
        return {
            dynamic: dynamic !== false,
            name: name,
            type: PZ.property.type.OPTION,
            value: value,
            items: items,
        };
    }

    function vector2(name, value) {
        return {
            dynamic: true,
            name: name,
            type: PZ.property.type.VECTOR2,
            value: value,
            spaceChar: "x",
            step: 1,
            decimals: 1,
        };
    }

    function color(name, rgb) {
        return {
            dynamic: true,
            group: true,
            name: name,
            type: PZ.property.type.COLOR,
            objects: [
                { dynamic: true, name: name + ".R", type: PZ.property.type.NUMBER, value: rgb[0], min: 0, max: 1 },
                { dynamic: true, name: name + ".G", type: PZ.property.type.NUMBER, value: rgb[1], min: 0, max: 1 },
                { dynamic: true, name: name + ".B", type: PZ.property.type.NUMBER, value: rgb[2], min: 0, max: 1 },
            ],
        };
    }

    function asset(name) {
        return {
            name: name,
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: null,
        };
    }

    function clampIndex(value, max) {
        return Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
    }

    /* ------------------------------------------------------------------ */
    /* Lens object catalogue                                              */
    /* ------------------------------------------------------------------ */

    // Type indexes are stored in projects and read by the shader: keep order.
    var ELEMENT_TYPES = [
        { key: "glow", name: "Glow", scale: 100, distance: 5, aspect: 1, color: [1, 1, 1], seed: 5000 },
        { key: "multiiris", name: "Multi Iris", scale: 60, distance: 38.5, aspect: 1, color: [0.62, 0.72, 0.95], seed: 5100 },
        { key: "iris", name: "Iris", scale: 85, distance: 75, aspect: 1, color: [0.56, 0.62, 0.72], seed: 5200 },
        { key: "streak", name: "Streak", scale: 90, distance: 0, aspect: 6, color: [0.55, 0.72, 1], seed: 5300 },
        { key: "shimmer", name: "Shimmer", scale: 60, distance: 0, aspect: 1, color: [1, 1, 1], seed: 5400 },
        { key: "glint", name: "Glint", scale: 55, distance: 0, aspect: 1, color: [1, 1, 1], seed: 5500 },
        { key: "spikeball", name: "Spike Ball", scale: 55, distance: 0, aspect: 1, color: [0.92, 0.94, 1], seed: 5600 },
        { key: "sparkle", name: "Sparkle", scale: 70, distance: 0, aspect: 1, color: [0.85, 0.9, 1], seed: 5700 },
        { key: "ring", name: "Ring", scale: 85, distance: 120, aspect: 1, color: [0.9, 1, 0.95], seed: 5800 },
        { key: "hoop", name: "Hoop", scale: 150, distance: 95, aspect: 1.8, color: [1, 1, 1], seed: 5900 },
        { key: "caustic", name: "Caustic", scale: 90, distance: 110, aspect: 1, color: [0.85, 0.88, 0.92], seed: 6000 },
        { key: "lensorbs", name: "Lens Orbs", scale: 100, distance: 150, aspect: 1, color: [0.82, 0.84, 0.9], seed: 6100 },
    ];

    var ELEMENT_TYPE_ITEMS = ELEMENT_TYPES.map(function (t) {
        return t.name;
    }).join(";");

    var TEXTURE_ITEMS = "None;Soft;Hex;Ring;Streak;Spikes;Orbs;Custom 1;Custom 2;Custom 3";
    var MATTE_ITEMS = "None;Circle;Square;Hexagon;Triangle;Star";
    var BLEND_ITEMS = "Add;Screen;Normal";


    /* ------------------------------------------------------------------ */
    /* Flare stack element                                                */
    /* ------------------------------------------------------------------ */

    var elementDefinitions = {
        elementType: option("Type", 0, ELEMENT_TYPE_ITEMS),
        enabled: option("Enabled", 1, "off;on", true),
        distance: number("Distance", 0, { min: -300, max: 500, step: 1, decimals: 1, vstep: 10 }),
        rotation: number("Rotation", 0, { step: 1, decimals: 1, vstep: 15 }),
        opacity: number("Opacity", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        animate: option("Animate", 1, "off;on", true),
        // Solo previews one element alone: when any element has Solo on, only
        // the soloed elements render. Stored like Enabled, so it is undoable,
        // saved with the project and a pure function of data and time.
        solo: option("Solo", 0, "off;on", true),
    };

    var commonDefinitions = {
        scale: number("Scale", 100, { min: 0, max: 1000, step: 0.1, decimals: 1 }),
        scaleOffset: option("Scale With Distance", 0, "off;on", true),
        aspectRatio: number("Aspect Ratio", 1, { min: 0.01, max: 20, step: 0.01, decimals: 2 }),
        blendMode: option("Blend Mode", 0, BLEND_ITEMS, true),
        color: color("Color", [1, 1, 1]),
        globalSeed: number("Element Seed", 1000, { min: 0, max: 10000, step: 1, decimals: 0, vstep: 50 }),
    };

    var matteDefinitions = {
        shape: option("Shape", 0, MATTE_ITEMS, true),
        startRange: number("Start Range", 25, { min: 0, max: 500, step: 0.5, decimals: 1 }),
        fadeAmount: number("Fade Amount", 25, { min: 0, max: 500, step: 0.5, decimals: 1 }),
    };

    var lensDefinitions = {
        textureImage: option("Texture Image", 1, TEXTURE_ITEMS, true),
        illuminationRadius: number("Illumination Radius", 100, { min: 1, max: 500, step: 0.5, decimals: 1 }),
        falloff: number("Falloff", 0.5, { min: 0, max: 1, step: 0.01, decimals: 2 }),
    };

    // Full description of one element type, used for new elements and presets.
    function spec(type, overrides) {
        var def = ELEMENT_TYPES[type];
        var out = {
            type: type,
            scale: def.scale,
            distance: def.distance,
            aspect: def.aspect,
            texture: 0,
            color: def.color,
            seed: def.seed,
            rotation: 0,
            opacity: 100,
            blend: 0,
            enabled: 1,
        };
        if (overrides) for (var k in overrides) out[k] = overrides[k];
        return out;
    }

    // CM3's dynamic load appends keyframes. Elements initialize defaults so
    // they can be used by the picker immediately; replace those defaults when
    // loading saved data or a preset rather than leaving duplicate frame zero.
    function loadProperties(list, data) {
        function reset(node) {
            if (node instanceof PZ.propertyList) {
                for (var key of Object.keys(node)) reset(node[key]);
            } else if (node) {
                if (node.keyframes) node.keyframes.splice(0, node.keyframes.length);
                if (node.objects) for (var child of node.objects) reset(child);
            }
        }
        reset(list);
        list.load(data);
    }

    function applySpec(element, s) {
        var p = element.properties;
        p.element.elementType.set(s.type, 0);
        p.name.set(ELEMENT_TYPES[s.type].name, 0);
        p.element.distance.set(s.distance, 0);
        p.element.rotation.set(s.rotation || 0, 0);
        p.element.opacity.set(s.opacity, 0);
        p.element.enabled.set(s.enabled, 0);
        p.element.animate.set(1, 0);
        p.element.solo.set(0, 0);
        p.globalParams.scale.set(s.scale, 0);
        p.globalParams.scaleOffset.set(0, 0);
        p.globalParams.aspectRatio.set(s.aspect, 0);
        p.globalParams.blendMode.set(s.blend || 0, 0);
        p.globalParams.color.set(s.color.slice(), 0);
        p.globalParams.globalSeed.set(s.seed, 0);
        p.matteBox.shape.set(0, 0);
        p.matteBox.startRange.set(25, 0);
        p.matteBox.fadeAmount.set(25, 0);
        p.lensTexture.textureImage.set(s.texture, 0);
        p.lensTexture.illuminationRadius.set(100, 0);
        p.lensTexture.falloff.set(0.5, 0);
    }

    var optflaresElement = class extends PZ.object {
        static create(subType) {
            var element = new optflaresElement();
            applySpec(element, spec(clampIndex(subType, ELEMENT_TYPES.length - 1)));
            return element;
        }
        constructor() {
            super();
            this.properties = new PZ.propertyList(
                {
                    name: PZ.property.create({ visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Glow" }),
                    element: new PZ.propertyList(elementDefinitions),
                    globalParams: new PZ.propertyList(commonDefinitions),
                    matteBox: new PZ.propertyList(matteDefinitions),
                    lensTexture: new PZ.propertyList(lensDefinitions),
                },
                this
            );
            this.properties.load(null);
            Object.defineProperty(this.properties.element, "displayName", { value: "Element Settings", writable: true });
            Object.defineProperty(this.properties.globalParams, "displayName", { value: "Common Settings", writable: true });
            Object.defineProperty(this.properties.matteBox, "displayName", { value: "Matte Box Controls", writable: true });
            Object.defineProperty(this.properties.lensTexture, "displayName", { value: "Lens Texture", writable: true });
            // Serialize every child list, not only those parented to this list.
            Object.defineProperty(this.properties, "toJSON", {
                value: function () {
                    var result = {};
                    var keys = Object.keys(this);
                    for (var k = 0; k < keys.length; k++) result[keys[k]] = this[keys[k]];
                    return result;
                },
                writable: true,
            });
            this.children = [this.properties];
        }
        // The element type is stored in the Type property, so undo and redo of
        // that property keep the type in step.
        get type() {
            return this.properties ? clampIndex(this.properties.element.elementType.get(0), ELEMENT_TYPES.length - 1) : 0;
        }
        set type(value) {
            if (this.properties) this.properties.element.elementType.set(clampIndex(value, ELEMENT_TYPES.length - 1), 0);
        }
        load(e) {
            loadProperties(this.properties, e && e.properties);
            if (!this.properties.name.get().length) {
                this.properties.name.set(ELEMENT_TYPES[this.type].name);
            }
        }
        toJSON() {
            return { type: this.type, properties: this.properties };
        }
        unload() {}
    };

    optflaresElement.prototype.defaultName = "Element";

    /* ------------------------------------------------------------------ */
    /* Presets                                                            */
    /* ------------------------------------------------------------------ */

    var PRESETS = [
        { key: "default", name: "Default Lens Flare" },
        { key: "anamorphic", name: "Anamorphic Blue" },
        { key: "sparkle", name: "Sparkle Burst" },
        { key: "cinematic", name: "Cinematic Warm" },
        { key: "scifi", name: "Sci-Fi Plasma" },
    ];

    var PRESET_STACKS = {
        default: [
            spec(0, { scale: 100, distance: 5 }),
            spec(0, { scale: 139.5, distance: 15, opacity: 80 }),
            spec(1, { scale: 50, distance: 38.5, color: [0.62, 0.72, 0.95] }),
            spec(1, { scale: 203.5, distance: 11.5, color: [0.7, 0.8, 1], opacity: 80 }),
            spec(1, { scale: 224.5, distance: 9.5, color: [1, 1, 1], opacity: 65 }),
            spec(1, { scale: 50, distance: 107, color: [0.55, 0.7, 1] }),
            spec(1, { scale: 90, distance: 60, color: [0.6, 0.75, 1], opacity: 70 }),
            spec(2, { scale: 85, distance: 75, color: [0.56, 0.62, 0.72] }),
            spec(3, { scale: 90, distance: 0, aspect: 6, color: [0.55, 0.72, 1], opacity: 90 }),
            spec(3, { scale: 50, distance: 0, aspect: 3.2, color: [0.85, 0.9, 1], opacity: 80 }),
            spec(4, { scale: 60, distance: 0 }),
            spec(5, { scale: 55, distance: 0 }),
            spec(6, { scale: 45, distance: 0, opacity: 80 }),
            spec(8, { scale: 85, distance: 130, color: [0.9, 1, 0.95], opacity: 70 }),
            spec(11, { scale: 100, distance: 150, color: [0.82, 0.84, 0.9], opacity: 90 }),
        ],
        anamorphic: [
            spec(0, { scale: 60, color: [0.8, 0.88, 1] }),
            spec(3, { scale: 110, aspect: 9, color: [0.3, 0.55, 1], opacity: 95 }),
            spec(3, { scale: 70, aspect: 5, color: [0.7, 0.85, 1], opacity: 75, rotation: 0.5 }),
            spec(3, { scale: 40, aspect: 3, color: [1, 1, 1], opacity: 60 }),
            spec(1, { scale: 45, distance: 115, color: [0.4, 0.6, 1] }),
            spec(9, { scale: 80, distance: 40, aspect: 3, color: [0.5, 0.7, 1], opacity: 45 }),
        ],
        sparkle: [
            spec(7, { scale: 60 }),
            spec(4, { scale: 55, color: [1, 0.95, 0.85] }),
            spec(6, { scale: 60, color: [0.85, 0.9, 1] }),
            spec(5, { scale: 40, color: [1, 0.9, 0.75] }),
            spec(8, { scale: 40, distance: 120, color: [0.6, 1, 0.8] }),
            spec(11, { scale: 60, distance: 150 }),
        ],
        cinematic: [
            spec(0, { scale: 90, color: [1, 0.9, 0.72] }),
            spec(2, { scale: 70, distance: 75, color: [1, 0.75, 0.45] }),
            spec(1, { scale: 45, distance: 105, color: [1, 0.72, 0.4] }),
            spec(3, { scale: 70, aspect: 5, color: [1, 0.6, 0.3], opacity: 60 }),
            spec(9, { scale: 55, distance: 75, aspect: 1.8, opacity: 50, color: [1, 0.85, 0.6] }),
            spec(11, { scale: 55, distance: 170, color: [1, 0.8, 0.6] }),
        ],
        scifi: [
            spec(9, { scale: 70, distance: 60, aspect: 1.4 }),
            spec(8, { scale: 45, distance: 105, color: [0.4, 0.9, 1] }),
            spec(10, { scale: 35, distance: 130, color: [0.5, 0.85, 1] }),
            spec(5, { scale: 45, color: [0.7, 0.95, 1] }),
            spec(0, { scale: 50, color: [0.6, 0.9, 1] }),
            spec(1, { scale: 40, distance: 85, color: [0.5, 0.9, 1] }),
        ],
    };

    // Serialized element records for a preset. Used by load() and by the
    // options window, so both paths build identical elements.
    function presetData(key) {
        var list = PRESET_STACKS[key] || PRESET_STACKS.default;
        return list.map(function (s) {
            var element = optflaresElement.create(s.type);
            applySpec(element, s);
            return JSON.parse(JSON.stringify(element));
        });
    }

    function presetKeyFor(objectType) {
        var preset = typeof objectType === "number" ? PRESETS[objectType] : null;
        return preset ? preset.key : "default";
    }


    return {
        number: number,
        option: option,
        vector2: vector2,
        color: color,
        asset: asset,
        clampIndex: clampIndex,
        ELEMENT_TYPES: ELEMENT_TYPES,
        ELEMENT_TYPE_ITEMS: ELEMENT_TYPE_ITEMS,
        TEXTURE_ITEMS: TEXTURE_ITEMS,
        MATTE_ITEMS: MATTE_ITEMS,
        BLEND_ITEMS: BLEND_ITEMS,
        elementDefinitions: elementDefinitions,
        commonDefinitions: commonDefinitions,
        matteDefinitions: matteDefinitions,
        lensDefinitions: lensDefinitions,
        spec: spec,
        loadProperties: loadProperties,
        applySpec: applySpec,
        optflaresElement: optflaresElement,
        PRESETS: PRESETS,
        PRESET_STACKS: PRESET_STACKS,
        presetData: presetData,
        presetKeyFor: presetKeyFor,
    };
};
