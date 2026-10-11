// OpenZoid Trapcode Suite — Form property schema, presets, and designer registration.
/*
 * form-defs.js
 *
 * Property definitions for the Form instance groups, the box and
 * sphere presets, and the designer registration. Loaded after
 * form-fields.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var ROTATION_ORDERS = T.formShared.rotationOrders;

    var number = T.number;
    var vector3 = T.vector3;
    var option = T.option;
    var imageAsset = T.imageAsset;
    var curveProperty = T.curveProperty;
    var gradientProperty = T.gradientProperty;

    PZ.object3d.form.instance.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Form" },
    };

    PZ.object3d.form.instance.baseDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Base Form", visible: false },
        baseFormType: option("Base Form", 0, "box-grid;sphere;sphere-grid;cylinder;circle;plane;3D model;text/mask", true),
        baseFormSize: vector3("Base Form Size", [500, 500, 500], { min: 0, step: 1 }),
        particlesX: number("Particles in X", 70, { min: 1, step: 1, decimals: 0 }),
        particlesY: number("Particles in Y", 70, { min: 1, step: 1, decimals: 0 }),
        particlesZ: number("Particles in Z", 3, { min: 1, step: 1, decimals: 0 }),
        position: vector3("Position", [0, 0, 0], { step: 1 }),
        rotation: vector3("Rotation", [0, 0, 0], { step: 1 }),
        stringEnabled: option("Strings", 0, "off;on"),
        stringSize: number("String size", 0, { min: 0, step: 0.01, decimals: 2 }),
        stringDensity: number("String density", 15, { min: 0, step: 1 }),
        stringSizeRandom: number("String size random", 0, { min: 0, step: 0.01, decimals: 2 }),
        stringPosition: number("String position distribution", 0, { min: 0, step: 0.01, decimals: 2 }),
        modelAsset: {
            name: "3D model",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.GEOMETRY,
            accept: ".json,application/json",
            value: null,
        },
        modelScale: number("Model scale", 100, { min: 0, step: 1 }),
        maskAsset: {
            name: "Text/mask image",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: null,
        },
    };

    PZ.object3d.form.instance.particleDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Particle", visible: false },
        texture: {
            name: "Texture",
            type: PZ.property.type.ASSET,
            items: PZ.object3d.form.presetTexturesList,
            baseUrl: "/assets/textures/particles/",
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: "/assets/textures/particles/circle_soft.png",
            changed: function () {
                this.parentObject.redrawTexture();
            },
        },
        size: number("Size", 2, { min: 0, step: 0.1, decimals: 2 }),
        sizeRandom: number("Size Random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeOverEnabled: option("Size Over", 0, "off;on"),
        sizeCurve: curveProperty("Size Curve"),
        opacity: number("Opacity", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacityOverEnabled: option("Opacity Over", 0, "off;on"),
        opacityCurve: curveProperty("Opacity Curve"),
        color: {
            dynamic: true,
            group: true,
            objects: [
                { dynamic: true, name: "Color.R", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
                { dynamic: true, name: "Color.G", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
                { dynamic: true, name: "Color.B", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
            ],
            name: "Color",
            type: PZ.property.type.COLOR,
        },
        colorOver: gradientProperty("Color Over"),
        blending: option("Blend Mode", 0, "normal;add", true),
    };

    PZ.object3d.form.instance.shadingDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Shading", visible: false },
        shading: option("Shading", 0, "off;on", true),
        lightFalloff: option("Light Falloff", 0, "natural (lux);inverse square;inverse cube;none", false),
        nominalDistance: number("Nominal Distance", 250, { step: 1 }),
        ambient: number("Ambient", 20, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        diffuse: number("Diffuse", 80, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specularAmount: number("Specular Amount", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specularSharpness: number("Specular Sharpness", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        reflectionStrength: number("Reflection Strength", 100, { min: 0, step: 0.1, decimals: 1 }),
        shadowlet: option("Shadowlet", 0, "off;on", false),
    };

    PZ.object3d.form.instance.disperseDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Disperse", visible: false },
        disperse: number("Disperse", 0, { step: 1 }),
        twist: number("Twist", 0, { step: 1 }),
    };

    PZ.object3d.form.instance.fluidDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Fluid", visible: false },
        fluidMotion: option("Fluid Motion", 0, "off;on", true),
        buoyancy: number("Buoyancy", 5, { step: 0.01, decimals: 2 }),
        randomSwirl: option("Random Swirl", 0, "off;on", false),
        swirlScale: number("Swirl Scale", 10, { step: 0.01, decimals: 2 }),
        randomSeed: number("Random Seed", 0, { step: 1, decimals: 0 }),
        vortexStrength: number("Vortex Strength", 100, { step: 1 }),
        vortexCoreSize: number("Vortex Core Size", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        vortexTilt: number("Vortex Tilt", 0, { step: 1 }),
        vortexRotate: number("Vortex Rotate", 0, { step: 1 }),
    };

    PZ.object3d.form.instance.fractalDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Fractal Field", visible: false },
        affectSize: number("Affect Size", 0, { min: 0, step: 1 }),
        affectOpacity: number("Affect Opacity", 0, { min: 0, step: 1 }),
        displacementMode: option("Displacement Mode", 0, "XYZ linked;independent XYZ;spherical;scale", false),
        displace: number("Displace", 0, { step: 1 }),
        yDisplace: number("Y Displace", 0, { step: 1 }),
        zDisplace: number("Z Displace", 0, { step: 1 }),
        flowX: number("Flow X", 0, { step: 0.01, decimals: 2 }),
        flowY: number("Flow Y", 0, { step: 0.01, decimals: 2 }),
        flowZ: number("Flow Z", 0, { step: 0.01, decimals: 2 }),
        flowEvolution: number("Flow Evolution", 50, { step: 0.1, decimals: 1 }),
        fractalSum: option("Fractal Sum", 0, "noise;abs;sin;cos", false),
        gamma: number("Gamma", 1, { step: 0.01, decimals: 2 }),
        addSubtract: number("Add/Subtract", 0, { step: 0.01, decimals: 2 }),
        min: number("Min", -1, { step: 0.01, decimals: 2 }),
        max: number("Max", 1, { step: 0.01, decimals: 2 }),
        fScale: number("F Scale", 10, { step: 0.1, decimals: 1 }),
        complexity: number("Complexity", 3, { min: 1, max: 8, step: 1, decimals: 0 }),
        octaveMultiplier: number("Octave Multiplier", 0.5, { step: 0.01, decimals: 2 }),
        octaveScale: number("Octave Scale", 1.5, { step: 0.01, decimals: 2 }),
        randomSeed: number("Random Seed", 0, { step: 1, decimals: 0 }),
    };

    PZ.object3d.form.instance.sphericalDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Spherical Field", visible: false },
        strength: number("Strength[%]", 0, { step: 1 }),
        position: vector3("Sphere Position", [720, 540, 0], { step: 1 }),
        radius: number("Radius", 100, { min: 0, step: 1 }),
        scaleX: number("Scale X", 100, { step: 1 }),
        scaleY: number("Scale Y", 100, { step: 1 }),
        scaleZ: number("Scale Z", 100, { step: 1 }),
        rotationX: number("X Rotation", 0, { step: 1 }),
        rotationY: number("Y Rotation", 0, { step: 1 }),
        rotationZ: number("Z Rotation", 0, { step: 1 }),
        feather: number("Feather", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sphereEnabled: option("Sphere 2", 0, "off;on", false),
        sphere2Strength: number("Sphere 2 Strength[%]", 0, { step: 1 }),
        sphere2Position: vector3("Sphere 2 Position", [720, 540, 0], { step: 1 }),
        sphere2Radius: number("Sphere 2 Radius", 100, { min: 0, step: 1 }),
    };

    PZ.object3d.form.instance.kaleidoDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Kaleidospace", visible: false },
        mirrorX: option("Mirror On X", 0, "off;on", true),
        mirrorY: option("Mirror On Y", 0, "off;on", true),
        mirrorZ: option("Mirror On Z", 0, "off;on", true),
        behaviour: option("Behaviour", 0, "mirror and remove;mirror and keep", false),
        center: vector3("Center Position", [720, 540, 0], { step: 1 }),
    };

    PZ.object3d.form.instance.layerMapDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Layer Maps", visible: false },
        colorAlphaEnabled: option("Color and Alpha", 0, "off;on", true),
        colorAlphaLayer: imageAsset("Color and Alpha Layer"),
        displacementEnabled: option("Displacement", 0, "off;on", true),
        displacementLayer: imageAsset("Displacement Layer"),
        sizeEnabled: option("Size", 0, "off;on", true),
        sizeLayer: imageAsset("Size Layer"),
        fractalStrengthEnabled: option("Fractal Strength", 0, "off;on", true),
        fractalStrengthLayer: imageAsset("Fractal Strength Layer"),
        disperseEnabled: option("Disperse", 0, "off;on", true),
        disperseLayer: imageAsset("Disperse Layer"),
        rotateEnabled: option("Rotate", 0, "off;on", true),
        rotateLayer: imageAsset("Rotate Layer"),
    };

    PZ.object3d.form.instance.audioDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Audio React", visible: false },
        audioLayer: {
            name: "Audio Layer",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.AV,
            accept: "audio/*,video/*",
            value: null,
        },
        reactor1: option("Reactor 1 (size)", 0, "off;on", true),
        reactor2: option("Reactor 2 (opacity)", 0, "off;on", true),
        reactor3: option("Reactor 3 (disperse)", 0, "off;on", true),
        reactor4: option("Reactor 4 (fractal)", 0, "off;on", true),
        reactor5: option("Reactor 5 (twist)", 0, "off;on", true),
    };

    PZ.object3d.form.instance.transformDefinitions = {
        name: { name: "Name", type: PZ.property.type.TEXT, value: "Transform", visible: false },
        scale: number("Scale", 100, { min: 0, step: 1 }),
        offsetX: number("X Offset", 0, { step: 1 }),
        offsetY: number("Y Offset", 0, { step: 1 }),
        offsetZ: number("Z Offset", 0, { step: 1 }),
        rotationOrder: {
            name: "Rotation Order",
            type: PZ.property.type.LIST,
            value: "XYZ",
            items: ROTATION_ORDERS.map(function (order) { return { name: order, value: order }; }),
        },
        rotationX: number("X Rotation", 0, { step: 1 }),
        rotationY: number("Y Rotation", 0, { step: 1 }),
        rotationZ: number("Z Rotation", 0, { step: 1 }),
    };

    T.registerObjectTypes(PZ.object3d.form.instance, [
        { name: "Form", desc: "A static particle lattice.", type: 0 },
    ]);

    if (T.designer) {
        T.designer.registerConfig(PZ.object3d.form, {
            title: "Trapcode Form Designer",
            targets: function (root) {
                return root.forms;
            },
            targetName: function (form, index) {
                if (index === 0) return "Primary Form";
                return "Form " + (index + 1);
            },
            addKinds: [
                {
                    name: "Add a Form",
                    create: function (root) {
                        var form = new PZ.object3d.form.instance();
                        root.forms.push(form);
                        form.loading = form.load(null, root);
                        form.update(0);
                        return form;
                    },
                },
            ],
            blocks: function () {
                return [
                    { key: "base", name: "Type" },
                    { key: "particle", name: "Particle" },
                    { key: "shading", name: "Shading" },
                    { key: "disperse", name: "Disperse" },
                    { key: "fluid", name: "Fluid" },
                    { key: "fractal", name: "Fractal" },
                    { key: "spherical", name: "Spherical" },
                    { key: "kaleidospace", name: "Kaleido" },
                    { key: "layerMaps", name: "Layer Maps" },
                    { key: "audio", name: "Audio" },
                    { key: "transform", name: "Transform" },
                ];
            },
            groupFor: function (target, key) {
                return target.properties ? target.properties[key] : null;
            },
            presets: [
                { name: "Default grid" },
                { name: "Sphere shell" },
                { name: "Scattered field" },
            ],
            applyPreset: function (root, target, preset) {
                if (!target) return;
                var base = target.properties.base;
                var particle = target.properties.particle;
                var fractal = target.properties.fractal;
                var disperse = target.properties.disperse;
                if (preset.name === "Default grid") {
                    base.baseFormType.set(0);
                    base.particlesX.set(70);
                    base.particlesY.set(70);
                    base.particlesZ.set(3);
                    base.baseFormSize.set([500, 500, 500]);
                    fractal.displace.set(0);
                    disperse.disperse.set(0);
                    disperse.twist.set(0);
                } else if (preset.name === "Sphere shell") {
                    base.baseFormType.set(1);
                    base.particlesX.set(60);
                    base.particlesY.set(60);
                    base.particlesZ.set(1);
                    base.baseFormSize.set([500, 500, 500]);
                    particle.size.set(3);
                    fractal.displace.set(0);
                } else if (preset.name === "Scattered field") {
                    base.baseFormType.set(0);
                    base.particlesX.set(50);
                    base.particlesY.set(50);
                    base.particlesZ.set(50);
                    fractal.displace.set(60);
                    disperse.disperse.set(20);
                    disperse.twist.set(30);
                }
                target._baseSig = null;
                target.update(0);
            },
        });
    }
})();
