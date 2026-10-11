// OpenZoid Trapcode Suite — Particular property schema, presets, and designer registration.
/*
 * particular-defs.js
 *
 * Property definitions for the System groups, the designer block
 * list, the burst/fountain/snow presets, and the designer
 * registration. Loaded after particular-system.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;

    var systemPropertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "System" },
    };


    var number = T.number;
    var vector3 = T.vector3;
    var option = T.option;
    var imageAsset = T.imageAsset;
    var curveProperty = T.curveProperty;

    PZ.object3d.particular.system.propertyDefinitions = systemPropertyDefinitions;

    PZ.object3d.particular.system.emitterDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Emitter" },
        emitterType: option("Emitter type", 0, "point;box;sphere;light;layer;model;text"),
        emitterBehavior: option("Emitter behavior", 0, "continuous;explode;burst"),
        emitFromParent: option("Emit from parent", 0, "off;on"),
        parentSystemIndex: number("Parent system index", 0, { min: 0, step: 1, decimals: 0 }),
        inheritVelocity: number("Inherit parent velocity[%]", 0, { min: 0, max: 100, step: 1 }),
        ratePercent: option("Particles/sec are % of primary", 0, "off;on"),
        burstInterval: number("Burst interval", 1, { min: 0.05, step: 0.05, decimals: 2 }),
        particlesPerSec: number("Particles/sec", 100, { min: 0, step: 1, decimals: 0 }),
        burstCount: number("Burst count", 0, { min: 0, step: 1, decimals: 0 }),
        position: vector3("Position", [0, 0, 0], { step: 1 }),
        emitterSize: number("Emitter size", 100, { min: 0, step: 1 }),
        direction: vector3("Direction", [0, 0, 0], { step: 0.01, decimals: 3 }),
        directionSpread: number("Direction spread", 20, { min: 0, step: 0.1, decimals: 1 }),
        velocity: number("Velocity", 100, { step: 1 }),
        velocityRandom: number("Velocity random", 20, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        velocityDistribution: number("Velocity distribution", 0.5, { min: 0, max: 1, step: 0.01, decimals: 2 }),
        velocityFromEmitterMotion: number("Velocity from emitter motion", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        rotation: number("Rotation", 0, { step: 1 }),
        rotationRandom: number("Rotation random", 0, { min: 0, step: 0.1, decimals: 1 }),
        rotationSpeed: number("Rotation speed", 0, { step: 1 }),
        rotationSpeedRandom: number("Rotation speed random", 0, { min: 0, step: 0.1, decimals: 1 }),
        randomSeed: number("Random seed", 100000, { step: 1, decimals: 0 }),
    };

    PZ.object3d.particular.system.particleDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Particle" },
        life: number("Life (seconds)", 3, { min: 0.01, step: 0.1, decimals: 2 }),
        lifeRandom: number("Life random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        particleType: option("Particle type", 1, "sprite;sphere;box;text"),
        texture: {
            name: "Texture",
            type: PZ.property.type.ASSET,
            items: PZ.object3d.particular.presetTexturesList,
            baseUrl: "/assets/textures/particles/",
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: "/assets/textures/particles/circle_soft.png",
            changed: function () {
                this.parentObject.redrawTexture();
            },
        },
        size: number("Size", 5, { min: 0, step: 0.1, decimals: 2 }),
        sizeRandom: number("Size random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeOverLifeEnabled: option("Size over life", 0, "off;on"),
        sizeOverLife: curveProperty("Size curve"),
        aspect: number("Aspect ratio", 1, { min: 0.01, step: 0.01, decimals: 2 }),
        orientToMotion: number("Orient to motion", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        orientFadeIn: number("Orient to motion fade-in", 20, { min: 0, step: 1, decimals: 0 }),
        rotateX: number("Rotate X", 0, { step: 1, decimals: 1 }),
        rotateY: number("Rotate Y", 0, { step: 1, decimals: 1 }),
        rotateZ: number("Rotate Z", 0, { step: 1, decimals: 1 }),
        randomRotation: number("Random rotation", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        degreesPerSecX: number("Degrees/sec X", 0, { step: 1, decimals: 1 }),
        degreesPerSecY: number("Degrees/sec Y", 0, { step: 1, decimals: 1 }),
        degreesPerSecZ: number("Degrees/sec Z", 0, { step: 1, decimals: 1 }),
        randomSpeedRotate: number("Random speed rotate", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        randomSpeedDistribution: number("Random speed distribution", 0.5, { min: 0, max: 1, step: 0.01, decimals: 2 }),
        stretch: number("Stretch along motion", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacity: number("Opacity", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacityRandom: number("Opacity random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacityOverLifeEnabled: option("Opacity over life", 0, "off;on"),
        opacityOverLife: curveProperty("Opacity curve"),
        setColor: option("Set color", 0, "at start;over life"),
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
        colorGradient: {
            name: "Color over life",
            type: PZ.property.type.GRADIENT,
            value: [{ position: 0, color: "rgba(255,255,255,1)" }],
        },
        colorRandom: number("Color random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        blending: option("Blend mode", 0, "normal;add;screen;multiply"),
        glow: number("Glow", 0, { min: 0, step: 0.01, decimals: 2 }),
        randomSeed: number("Random seed", 0, { step: 1, decimals: 0 }),
    };

    PZ.object3d.particular.system.physicsDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Physics" },
        enabled: option("Enabled", 0, "off;on"),
        gravity: number("Gravity", 0, { step: 1 }),
        drag: number("Air resistance", 0, { min: 0, step: 0.01, decimals: 3 }),
        mass: number("Mass", 10, { min: 0.01, step: 0.1, decimals: 2 }),
        massRandom: number("Mass random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeAffectsMass: number("Size affects mass", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        airResistanceRandom: number("Air resistance random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeAffectsAirResistance: number("Size affects air resistance", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        rotationalAirResistance: number("Rotational air resistance", 0, { min: 0, step: 0.01, decimals: 3 }),
        bounceEnabled: option("Enable bounce", 0, "off;on"),
        bounceHeight: number("Bounce height", 500, { step: 1 }),
        bounceStrength: number("Bounce strength", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        meanderEnabled: option("Enable meander", 0, "off;on"),
        meanderAffectDirection: number("Affect direction", 20, { step: 0.1, decimals: 1 }),
        meanderAffectSpeed: number("Affect speed", 20, { step: 0.1, decimals: 1 }),
        flockingEnabled: option("Enable flocking", 0, "off;on"),
        flockAttract: number("Attract", 10, { step: 0.1, decimals: 1 }),
        flockSeparate: number("Separate", 10, { step: 0.1, decimals: 1 }),
        flockAlign: number("Align", 10, { step: 0.1, decimals: 1 }),
        flockRangeValue: number("Range of view", 500, { step: 1 }),
        flockFieldOfView: number("Field of view", 270, { step: 1 }),
        fluidEnabled: option("Enable fluid dynamics", 0, "off;on"),
        fluidForceType: option("Fluid force", 0, "vortex;buoyancy and swirl"),
        buoyancy: number("Buoyancy", 5, { step: 0.01, decimals: 2 }),
        fluidSwirlEnabled: option("Random swirl", 0, "off;on"),
        fluidSwirlScale: number("Swirl scale", 100, { min: 0.01, step: 1, decimals: 2 }),
        fluidSwirlStrength: number("Swirl strength", 100, { step: 1 }),
        fluidSeed: number("Fluid seed", 0, { step: 1, decimals: 0 }),
        vortexStrength: number("Vortex strength", 100, { step: 1 }),
        vortexCoreSize: number("Vortex core size", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        fluidVortexTilt: number("Vortex tilt", 0, { step: 1, decimals: 1 }),
        fluidVortexRotate: number("Vortex rotate", 0, { step: 1, decimals: 1 }),
        fluidOffset: vector3("Fluid center offset", [0, 0, 0], { step: 1 }),
        fluidViscosity: number("Fluid viscosity", 0, { min: 0, step: 0.01, decimals: 3 }),
        fluidTimeScale: number("Fluid time scale [%]", 100, { min: 0, step: 1, decimals: 0 }),
        gravityDirection: vector3("Gravity direction", [0, 1, 0], { step: 0.01, decimals: 3 }),
    };

    PZ.object3d.particular.system.environmentDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Environment" },
        windX: number("Wind X", 0, { step: 1 }),
        windY: number("Wind Y", 0, { step: 1 }),
        windZ: number("Wind Z", 0, { step: 1 }),
        airDensity: number("Air density", 1, { min: 0, step: 0.01, decimals: 3 }),
        turbulenceEnabled: option("Air turbulence", 0, "off;on"),
        turbulenceAffectPosition: number("Affect position", 0, { min: 0, step: 0.1, decimals: 1 }),
        turbulenceAffectOrientation: number("Affect orientation/spin", 0, { min: 0, step: 0.1, decimals: 1 }),
        turbulenceScale: number("Scale", 10, { step: 0.1, decimals: 1 }),
        turbulenceComplexity: number("Complexity", 3, { min: 1, max: 8, step: 1, decimals: 0 }),
        turbulenceEvolutionSpeed: number("Evolution speed", 50, { step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.displaceDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Displace" },
        driftX: number("Drift X", 0, { step: 1 }),
        driftY: number("Drift Y", 0, { step: 1 }),
        driftZ: number("Drift Z", 0, { step: 1 }),
        spinAmplitude: number("Spin amplitude", 0, { step: 1 }),
        spinFrequency: number("Spin frequency", 1, { step: 0.01, decimals: 2 }),
        disperse: number("Disperse", 0, { step: 1 }),
        disperseStrengthOver: option("Disperse strength over", 0, "off;life;velocity;position"),
        disperseStrengthCurve: curveProperty("Disperse curve"),
        twist: number("Twist", 0, { step: 1 }),
        turbulenceAffectSize: number("Turbulence field affect size", 0, { step: 1 }),
        turbulenceAffectOpacity: number("Turbulence field affect opacity", 0, { step: 1 }),
    };

    PZ.object3d.particular.system.sphericalDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Spherical field" },
        strength: number("Strength[%]", 0, { step: 1 }),
        radius: number("Radius", 100, { min: 0, step: 1 }),
        position: vector3("Sphere position", [720, 540, 0], { step: 1 }),
        scaleX: number("Scale X", 100, { step: 1 }),
        scaleY: number("Scale Y", 100, { step: 1 }),
        scaleZ: number("Scale Z", 100, { step: 1 }),
        feather: number("Feather", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.kaleidoDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Kaleidospace" },
        mirrorX: option("Mirror on X", 0, "off;on"),
        mirrorY: option("Mirror on Y", 0, "off;on"),
        mirrorZ: option("Mirror on Z", 0, "off;on"),
        center: vector3("Center position", [720, 540, 0], { step: 1 }),
    };

    PZ.object3d.particular.system.transformDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Transform" },
        rotationX: number("X rotation", 0, { step: 1 }),
        rotationY: number("Y rotation", 0, { step: 1 }),
        rotationZ: number("Z rotation", 0, { step: 1 }),
        scale: number("Scale", 100, { step: 1 }),
        offsetX: number("X offset", 0, { step: 1 }),
        offsetY: number("Y offset", 0, { step: 1 }),
        offsetZ: number("Z offset", 0, { step: 1 }),
    };

    PZ.object3d.particular.system.layerMapDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Layer maps" },
        colorAlphaEnabled: option("Color and alpha", 0, "off;on"),
        colorAlphaLayer: imageAsset("Color layer"),
        colorAlphaMix: number("Color mix", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeEnabled: option("Size", 0, "off;on"),
        sizeLayer: imageAsset("Size layer"),
        sizeStrength: number("Size strength", 100, { step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.audioDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Audio react" },
        audioLayer: {
            name: "Audio layer",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.AV,
            accept: "audio/*,video/*",
            value: null,
        },
        audioOffset: number("Audio offset (seconds)", 0, { min: 0, step: 0.01, decimals: 3 }),
        audioTrimIn: number("Audio trim in (seconds)", 0, { min: 0, step: 0.01, decimals: 3 }),
        audioTrimOut: number("Audio trim out (seconds, 0 = end)", 0, { min: 0, step: 0.01, decimals: 3 }),
        reactor1Enabled: option("Reactor 1", 0, "off;on"),
        reactor1Target: option("Reactor 1 target", 0, "size;opacity;velocity;color"),
        reactor1Strength: number("Reactor 1 strength", 100, { step: 0.1, decimals: 1 }),
        reactor2Enabled: option("Reactor 2", 0, "off;on"),
        reactor2Target: option("Reactor 2 target", 0, "size;opacity;velocity;color"),
        reactor2Strength: number("Reactor 2 strength", 100, { step: 0.1, decimals: 1 }),
        reactor3Enabled: option("Reactor 3", 0, "off;on"),
        reactor3Target: option("Reactor 3 target", 0, "size;opacity;velocity;color"),
        reactor3Strength: number("Reactor 3 strength", 100, { step: 0.1, decimals: 1 }),
        reactor4Enabled: option("Reactor 4", 0, "off;on"),
        reactor4Target: option("Reactor 4 target", 0, "size;opacity;velocity;color"),
        reactor4Strength: number("Reactor 4 strength", 100, { step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.lightingDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Lighting" },
        enabled: option("Shading", 0, "off;on"),
        lightFalloff: option("Light falloff", 0, "natural (lux);inverse square;inverse cube;none"),
        nominalDistance: number("Nominal distance", 250, { step: 1 }),
        ambient: number("Ambient", 20, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        diffuse: number("Diffuse", 80, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specularAmount: number("Specular amount", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specularSharpness: number("Specular sharpness", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        reflectionStrength: number("Reflection strength", 100, { min: 0, step: 0.1, decimals: 1 }),
        shadowlet: option("Shadowlet", 0, "off;on", false),
    };

    if (PZ.ui && PZ.ui.objectTypes) {
        PZ.ui.objectTypes.set(PZ.object3d.particular.system, [
            { name: "System", desc: "A particle emitting system.", type: 0 },
        ]);
    }

    var BLOCKS = [
        { key: "emitter", name: "Emitter" },
        { key: "particle", name: "Particle" },
        { key: "physics", name: "Physics" },
        { key: "environment", name: "Environment" },
        { key: "displace", name: "Displace" },
        { key: "spherical", name: "Spherical" },
        { key: "kaleidospace", name: "Kaleido" },
        { key: "transform", name: "Transform" },
        { key: "layerMaps", name: "Layer Maps" },
        { key: "audio", name: "Audio" },
        { key: "lighting", name: "Lighting" },
    ];

    var PRESETS = [
        { name: "Default burst", preset: "burst" },
        { name: "Fountain", preset: "fountain" },
        { name: "Snow", preset: "snow" },
    ];

    if (PZ.trapcode && PZ.trapcode.designer) {
        PZ.trapcode.designer.registerConfig(PZ.object3d.particular, {
            title: "Trapcode Particular Designer",
            targets: function (root) {
                return root.systems;
            },
            targetName: function (system, index) {
                if (index === 0) return "Primary System";
                return "System " + (index + 1);
            },
            addKinds: [
                {
                    name: "Add a System",
                    create: function (root) {
                        var system = new PZ.object3d.particular.system();
                        root.systems.push(system);
                        system.loading = system.load(null, root);
                        system.update(0);
                        return system;
                    },
                },
            ],
            blocks: function () {
                return BLOCKS;
            },
            groupFor: function (target, key) {
                return target.properties ? target.properties[key] : null;
            },
            presets: PRESETS,
            applyPreset: function (root, target, preset) {
                if (target && target.applyPreset) target.applyPreset(preset.preset);
            },
        });
    }
})();
