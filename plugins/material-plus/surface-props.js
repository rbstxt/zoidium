"use strict";

// Surface property definitions: the PBR property table with its change
// handlers. Installed onto the material donor; bare names resolve
// through the destructured env.

module.exports = function installSurfaceProps(target, env) {
    const { PZ, THREE, nodes, document, PZ_RAMP_SOURCE, PZ_RAMP_INTERPOLATION } = env;
target.props = {
    nodeEditor: {
        name: "Node Editor",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            var e = this.parentObject;
            if (e.pzLoading || !nodes || !nodes.editor) return;
            if (this.value === 1) {
                nodes.editor.open(e);
            } else {
                nodes.editor.closeMaterial(e);
            }
        },
        items: "closed;open",
    },
    graph: {
        visible: false,
        name: "Graph",
        type: PZ.property.type.TEXT,
        value: "{\"nodes\":[{\"id\":\"output\",\"type\":\"output\",\"x\":640,\"y\":80,\"params\":{}}],\"links\":[]}",
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.bakeGraph();
        },
    },
    bakeResolution: {
        name: "Bake Resolution",
        type: PZ.property.type.OPTION,
        value: 1,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.bakeGraph();
        },
        items: "128;256;512;1024;2048",
    },
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
    emissive: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Emissive.R", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
            { dynamic: true, name: "Emissive.G", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
            { dynamic: true, name: "Emissive.B", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
        ],
        name: "Luminance Color",
        type: PZ.property.type.COLOR,
    },
    rampEnabled: {
        name: "Color Ramp",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: "off;on",
    },
    ramp: {
        name: "Color Ramp Curve",
        type: PZ.property.type.GRADIENT,
        value: [
            { position: 0, color: "rgba(0,0,0,1)" },
            { position: 1, color: "rgba(255,255,255,1)" },
        ],
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.syncRamp();
        },
    },
    rampSource: {
        name: "Color Ramp Source",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: PZ_RAMP_SOURCE,
    },
    rampInterpolation: {
        name: "Color Ramp Interpolation",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.syncRamp();
        },
        items: PZ_RAMP_INTERPOLATION,
    },
    rampFactor: {
        dynamic: true,
        name: "Color Ramp Factor",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    roughness: {
        name: "Roughness",
        type: PZ.property.type.NUMBER,
        value: 0.5,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.roughness = this.value;
        },
        max: 1,
        min: 0,
        step: 0.01,
    },
    metalness: {
        name: "Metalness",
        type: PZ.property.type.NUMBER,
        value: 0.5,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.metalness = this.value;
        },
        max: 1,
        min: 0,
        step: 0.01,
    },
    texture: {
        name: "Texture",
        type: PZ.property.type.ASSET,
        assetType: PZ.asset.type.IMAGE,
        accept: "image/*",
        value: null,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            var e = this.parentObject;
            if (e.pzAssignMap("map", e.setImage("texture", this.value))) {
                e.threeObj.needsUpdate = true;
            }
        },
    },
    bumpStrength: {
        dynamic: true,
        name: "Bump Strength",
        type: PZ.property.type.NUMBER,
        value: 0,
        min: 0,
        max: 2,
        step: 0.01,
        decimals: 3,
    },
    bumpNoise: {
        name: "Bump Noise",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateBumpMap();
        },
        items: "off;on",
    },
    bumpNoiseScale: {
        name: "Bump Noise Scale",
        type: PZ.property.type.NUMBER,
        value: 4,
        min: 1,
        max: 64,
        step: 1,
        decimals: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            if (this.parentObject.properties.bumpNoise.get() === 1) {
                this.parentObject.updateBumpMap();
            }
        },
    },
    bumpMipFalloff: {
        name: "Bump MIP Falloff",
        type: PZ.property.type.OPTION,
        value: 1,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateMipFalloff();
        },
        items: "off;on",
    },
    normalMap: {
        name: "Normal map",
        type: PZ.property.type.ASSET,
        assetType: PZ.asset.type.IMAGE,
        accept: "image/*",
        value: null,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            var e = this.parentObject;
            if (e.pzAssignMap("normalMap", e.setImage("normalMap", this.value))) {
                e.threeObj.needsUpdate = true;
            }
        },
    },
    normalScale: {
        name: "Normal scale",
        type: PZ.property.type.NUMBER,
        value: 1,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.normalScale.set(this.value, this.value);
        },
        decimals: 3,
        min: 0,
        step: 0.01,
    },
    fresnel: {
        name: "Fresnel",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: "off;on",
    },
    fresnelColor: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Fresnel.R", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
            { dynamic: true, name: "Fresnel.G", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
            { dynamic: true, name: "Fresnel.B", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
        ],
        name: "Fresnel Color",
        type: PZ.property.type.COLOR,
    },
    fresnelPower: {
        dynamic: true,
        name: "Fresnel Power",
        type: PZ.property.type.NUMBER,
        value: 4,
        min: 0.1,
        max: 8,
        step: 0.05,
        decimals: 2,
    },
    fresnelMixStrength: {
        dynamic: true,
        name: "Fresnel Mix Strength",
        type: PZ.property.type.NUMBER,
        value: 0.7,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    aoEnabled: {
        name: "Ambient Occlusion",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: "off;on",
    },
    aoTexture: {
        name: "Ambient Occlusion Texture",
        type: PZ.property.type.ASSET,
        assetType: PZ.asset.type.IMAGE,
        accept: "image/*",
        value: null,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            var e = this.parentObject;
            e.setImage("ao", this.value);
            e.refreshAO();
        },
    },
    aoIntensity: {
        dynamic: true,
        name: "Ambient Occlusion Intensity",
        type: PZ.property.type.NUMBER,
        value: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    aoDistance: {
        dynamic: true,
        name: "Ambient occlusion exponent",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0.01,
        max: 8,
        step: 0.01,
        decimals: 2,
    },
    aoColor: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "AO.R", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
            { dynamic: true, name: "AO.G", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
            { dynamic: true, name: "AO.B", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
        ],
        name: "Ambient Occlusion Color",
        type: PZ.property.type.COLOR,
    },
    celEnabled: {
        name: "Cel Renderer",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: "off;on",
    },
    celSteps: {
        dynamic: true,
        name: "Cel Steps",
        type: PZ.property.type.NUMBER,
        value: 4,
        min: 1,
        max: 16,
        step: 1,
        decimals: 0,
    },
    celSmoothness: {
        dynamic: true,
        name: "Cel Smoothness",
        type: PZ.property.type.NUMBER,
        value: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    celSpecularSteps: {
        dynamic: true,
        name: "Cel Specular Steps",
        type: PZ.property.type.NUMBER,
        value: 6,
        min: 1,
        max: 32,
        step: 1,
        decimals: 0,
    },
    transparent: {
        name: "Transparency",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.transparent = this.value === 1;
        },
        items: "off;on",
    },
    opacity: {
        dynamic: true,
        name: "Opacity",
        type: PZ.property.type.NUMBER,
        value: 1,
        max: 1,
        min: 0,
        step: 0.01,
    },
    blending: {
        name: "Blending",
        type: PZ.property.type.OPTION,
        value: 1,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.blending = this.value;
        },
        items: "none;normal;additive;subtractive;multiply",
    },
    side: {
        name: "Render side",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function (e) {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.side = this.value;
        },
        items: "front;back;both",
    },
    wrap: {
        name: "Wrap",
        type: PZ.property.type.OPTION,
        value: 1,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            var e = this.parentObject;
            e.applyWrap(e.threeObj.map);
            e.applyWrap(e.threeObj.normalMap);
            e.applyWrap(e.threeObj.bumpMap);
            e.applyWrap(e.pzTextures.ao);
            e.applyWrap(e.pzNoiseTexture);
        },
        items: "none;tile;reflect",
    },
    repeat: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Repeat.U", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 1 },
            { dynamic: true, name: "Repeat.V", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 1 },
        ],
        name: "Repeat",
        type: PZ.property.type.VECTOR2,
        step: 0.1,
        decimals: 3,
        linkRatio: true,
    },
    offset: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Offset.U", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
            { dynamic: true, name: "Offset.V", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
        ],
        name: "Offset",
        step: 0.1,
        decimals: 3,
        type: PZ.property.type.VECTOR2,
    },
    center: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Center.U", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
            { dynamic: true, name: "Center.V", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
        ],
        name: "Center",
        step: 0.1,
        decimals: 3,
        type: PZ.property.type.VECTOR2,
    },
    rotation: {
        dynamic: true,
        name: "Rotation",
        type: PZ.property.type.NUMBER,
        value: 0,
        step: 0.5,
        scaleFactor: Math.PI / 180,
    },
    projRotation: {
        dynamic: true,
        group: true,
        objects: [
            {
                dynamic: true,
                name: "R.X",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 1,
                decimals: 1,
                scaleFactor: Math.PI / 180,
            },
            {
                dynamic: true,
                name: "R.Y",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 1,
                decimals: 1,
                scaleFactor: Math.PI / 180,
            },
            {
                dynamic: true,
                name: "R.Z",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 1,
                decimals: 1,
                scaleFactor: Math.PI / 180,
            },
        ],
        name: "Projection Rotation",
        type: PZ.property.type.VECTOR3,
        scaleFactor: Math.PI / 180,
    },
    projScale: {
        dynamic: true,
        group: true,
        objects: [
            {
                dynamic: true,
                name: "S.X",
                type: PZ.property.type.NUMBER,
                value: 1,
                step: 0.1,
                decimals: 3,
            },
            {
                dynamic: true,
                name: "S.Y",
                type: PZ.property.type.NUMBER,
                value: 1,
                step: 0.1,
                decimals: 3,
            },
            {
                dynamic: true,
                name: "S.Z",
                type: PZ.property.type.NUMBER,
                value: 1,
                step: 0.1,
                decimals: 3,
            },
        ],
        name: "Projection Scale",
        type: PZ.property.type.VECTOR3,
    },
    projTranslate: {
        dynamic: true,
        group: true,
        objects: [
            {
                dynamic: true,
                name: "T.X",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 0.1,
                decimals: 3,
            },
            {
                dynamic: true,
                name: "T.Y",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 0.1,
                decimals: 3,
            },
            {
                dynamic: true,
                name: "T.Z",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 0.1,
                decimals: 3,
            },
        ],
        name: "Projection Translation",
        type: PZ.property.type.VECTOR3,
    },
    projLockAspect: {
        name: "Projection Lock Aspect Ratio",
        type: PZ.property.type.OPTION,
        value: 0,
        items: "off;on",
    },
    projection: {
        name: "Projection",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: "uv;spherical;cylindrical;cubic",
    },
    reflection: {
        name: "Reflection",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.initReflection();
        },
        items: "off;on",
    },
    reflReflection: {
        name: "Reflection Layer",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.initReflection();
        },
        items: "off;on",
    },
    reflReflectionStrength: {
        dynamic: true,
        name: "Reflection Layer Strength",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    reflReflectionOpacity: {
        dynamic: true,
        name: "Reflection Layer Opacity",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    reflReflectionRoughness: {
        dynamic: true,
        name: "Reflection Layer Roughness",
        type: PZ.property.type.NUMBER,
        value: 0,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    reflSpecular: {
        name: "Specular Layer",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
    },
    reflSpecularStrength: {
        dynamic: true,
        name: "Specular Strength",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 2,
        step: 0.01,
        decimals: 2,
    },
    reflSpecularOpacity: {
        dynamic: true,
        name: "Specular Opacity",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    reflGlobalReflectionBrightness: {
        dynamic: true,
        name: "Global Reflection Brightness",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 2,
        step: 0.01,
        decimals: 2,
    },
};
};
