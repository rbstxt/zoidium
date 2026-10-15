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

// Optical Flares 3D object (numeric PZ.object3d type 13). Installer factory:
// the runtime calls installOptflares(PZ, THREE) after loading the shared
// definitions through the bundle require.

function loadDeps() {
    if (typeof require === "function") {
        return {
            shaders: require("./optflares-shaders.js")(),
            createDefs: require("./optflares-defs.js"),
        };
    }
    throw new Error("Optical Flares needs its bundled sources.");
}

module.exports = function installOptflares(PZ, THREE) {
    if (!PZ) throw new Error("Optical Flares needs the CM3 runtime.");
    if (!THREE) throw new Error("Optical Flares needs the THREE global from the CM3 runtime.");
    if (!PZ.opticalflares || !PZ.opticalflares.math) {
        throw new Error("Optical Flares needs optflares-math.js loaded first.");
    }
    var deps = loadDeps();
    var shaders = deps.shaders;
    var defs = deps.createDefs(PZ);
    var number = defs.number;
    var option = defs.option;
    var vector2 = defs.vector2;
    var color = defs.color;
    var asset = defs.asset;
    var ELEMENT_TYPES = defs.ELEMENT_TYPES;
    var BLEND_ITEMS = defs.BLEND_ITEMS;
    var VERTEX_SHADER = shaders.VERTEX_SHADER;
    var FRAGMENT_SHADER = shaders.FRAGMENT_SHADER;
    var MAX_ELEMENTS = shaders.MAX_ELEMENTS;
    var whiteTexture = function () { return shaders.whiteTexture(THREE); };
    var spec = defs.spec;
    var loadProperties = defs.loadProperties;
    var optflaresElement = defs.optflaresElement;
    var PRESETS = defs.PRESETS;
    var presetData = defs.presetData;
    var presetKeyFor = defs.presetKeyFor;
    var math = PZ.opticalflares.math;

    var DEG = Math.PI / 180;
    var DEFAULT_RESOLUTION = [1920, 1080];

    // Live flare objects in the open project. The plugin manager asks this
    // through isInUse() so the pack cannot be disabled under a project that
    // still uses it.
    var liveFlares = new Set();

    var flareSetupDefinitions = {
        positionXY: vector2("2D Position", [0, 0]),
        centerPosition: vector2("Center Position", [0, 0]),
        brightness: number("Flare Brightness", 70, { min: 0, max: 1000, step: 0.5, decimals: 1 }),
        scale: number("Flare Scale", 75, { min: 0, max: 1000, step: 0.5, decimals: 1 }),
        // Restored from the donor editor: folds into the same distance factor
        // as the Global switch below, so either switch enables the effect.
        // Off by default, so existing projects render unchanged.
        scaleOffset: option("Scale Offset", 0, "off;on", true),
        rotationOffset: number("Rotation Offset", 0, { step: 1, decimals: 1, vstep: 15 }),
        color: color("Flare Color", [1, 1, 1]),
        colorMode: option("Color Mode", 0, "Tint;RGB;Alpha", true),
        animationEvolution: number("Animation Evolution", 0, { step: 1, decimals: 1, vstep: 15 }),
        gpu: option("High Quality", 1, "off;on", true),
    };

    var positioningDefinitions = {
        sourceType: option("Source", 1, "Screen (2D);Object 3D;Light", true),
        lightIndex: number("Light Index", 0, { min: 0, max: 32, step: 1, decimals: 0 }),
        occlude: option("Occlude", 0, "off;on", true),
        // Restored from the donor editor so its projects keep the value.
        // Occlusion here is per pixel through the depth buffer, so Fade has
        // no render effect; 100 matches the current full-occlusion look.
        fade: number("Fade Amount", 100, { min: 0, max: 100, step: 1, decimals: 0 }),
        margin: number("Edge Margin", 0.25, { min: 0, max: 2, step: 0.01, decimals: 2 }),
        distanceFalloff: number("Distance Falloff", 0, { min: 0, max: 2, step: 0.01, decimals: 2 }),
        referenceDistance: number("Reference Distance", 10, { min: 0.01, max: 1000, step: 0.1, decimals: 1 }),
    };

    var flickerDefinitions = {
        amount: number("Amount", 0, { min: 0, max: 100, step: 0.5, decimals: 1 }),
        speed: number("Speed", 2, { min: 0, max: 20, step: 0.1, decimals: 1 }),
    };

    var customLayerDefinitions = {
        layer1: asset("Custom Layer 1"),
        layer2: asset("Custom Layer 2"),
        layer3: asset("Custom Layer 3"),
    };

    var motionBlurDefinitions = {
        renderMode: option("Render Mode", 0, "On Black;Transparent", true),
    };

    // Applies to every element of the stack. Element-level names are kept
    // distinct from these so each label is unique in the property panel.
    var globalDefinitions = {
        scale: number("Element Scale", 100, { min: 0, max: 1000, step: 0.1, decimals: 1 }),
        scaleOffset: option("Element Scale With Distance", 0, "off;on", true),
        aspectRatio: number("Element Aspect Ratio", 1, { min: 0.01, max: 20, step: 0.01, decimals: 2 }),
        blendMode: option("Element Blend Mode", 0, BLEND_ITEMS, true),
        color: color("Element Color", [1, 1, 1]),
        globalSeed: number("Seed", 5000, { min: 0, max: 10000, step: 1, decimals: 0, vstep: 50 }),
    };

    // Default position of a new flare. The default CM3 camera sits at Z 80 with
    // a 60 degree vertical fov on a 16:9 frame, so the half height at the
    // origin's depth is tan(30) * 80 = 46.19 and the half width is 82.13. This
    // point projects 62% of the way from the centre to the upper-left corner
    // (NDC -0.62, 0.62), so the element chain runs across the frame. Saved
    // positions are unaffected.
    var NEW_FLARE_POSITION = [-50.9, 28.6, 0];

    var transformDefinitions = {
        position: {
            dynamic: true,
            group: true,
            name: "Position",
            type: PZ.property.type.VECTOR3,
            objects: [
                { dynamic: true, name: "Position.X", type: PZ.property.type.NUMBER, value: NEW_FLARE_POSITION[0] },
                { dynamic: true, name: "Position.Y", type: PZ.property.type.NUMBER, value: NEW_FLARE_POSITION[1] },
                { dynamic: true, name: "Position.Z", type: PZ.property.type.NUMBER, value: NEW_FLARE_POSITION[2] },
            ],
        },
        rotation: {
            dynamic: true,
            group: true,
            name: "Rotation",
            type: PZ.property.type.VECTOR3,
            scaleFactor: DEG,
            objects: [
                { dynamic: true, name: "Rotation.X", type: PZ.property.type.NUMBER, value: 0, scaleFactor: DEG },
                { dynamic: true, name: "Rotation.Y", type: PZ.property.type.NUMBER, value: 0, scaleFactor: DEG },
                { dynamic: true, name: "Rotation.Z", type: PZ.property.type.NUMBER, value: 0, scaleFactor: DEG },
            ],
        },
        scale: {
            dynamic: true,
            group: true,
            name: "Scale",
            type: PZ.property.type.VECTOR3,
            linkRatio: true,
            objects: [
                { dynamic: true, name: "Scale.X", type: PZ.property.type.NUMBER, value: 1, min: 0.001, step: 0.1, decimals: 3 },
                { dynamic: true, name: "Scale.Y", type: PZ.property.type.NUMBER, value: 1, min: 0.001, step: 0.1, decimals: 3 },
                { dynamic: true, name: "Scale.Z", type: PZ.property.type.NUMBER, value: 1, min: 0.001, step: 0.1, decimals: 3 },
            ],
        },
    };

    // Shared by the source lookup and the render hook. Renders the quad's
    // source uniforms without reading any state from a previous frame.
    function worldPosition(object3d) {
        if (!object3d || !object3d.threeObj) return null;
        var node = object3d.threeObj;
        if (typeof node.updateWorldMatrix === "function") {
            node.updateWorldMatrix(true, false);
        } else {
            // CM3 ships THREE r91, before updateWorldMatrix was introduced.
            // Refresh the ancestor chain as well as the source's local matrix.
            while (node.parent) node = node.parent;
            node.updateMatrixWorld(true);
        }
        var e = object3d.threeObj.matrixWorld.elements;
        return [e[12], e[13], e[14]];
    }

    // Rewrite uniforms from the camera drawing the color pass. The runtime
    // preserves this callback around CM3's velocity traversal.
    function hookRender(quad, onRender) {
        var previous = quad.onBeforeRender;
        quad.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
            onRender(camera);
            if (typeof previous === "function") {
                previous.call(this, renderer, scene, camera, geometry, material, group);
            }
        };
    }

    function markLoaded(texture) { texture.zoidiumLoaded = true; }

    PZ.object3d.optflares = class extends PZ.object3d {
        constructor() {
            super();
            this.objectType = 0;
            this.threeObj = new THREE.Object3D();
            this.threeObj.frustumCulled = false;
            this.stack = new PZ.objectList(this, PZ.object3d.optflares.element);
            this.stack.name = "Stack";
            this.children.push(this.stack);

            var positioning = new PZ.propertyList({
                sourceType: positioningDefinitions.sourceType,
                lightIndex: positioningDefinitions.lightIndex,
                distanceFalloff: positioningDefinitions.distanceFalloff,
                referenceDistance: positioningDefinitions.referenceDistance,
                margin: positioningDefinitions.margin,
                foreground: new PZ.propertyList({
                    occlude: positioningDefinitions.occlude,
                    fade: positioningDefinitions.fade,
                }),
                flicker: new PZ.propertyList(flickerDefinitions),
                customLayers: new PZ.propertyList(customLayerDefinitions),
            });

            this.properties.addAll({
                flareSetup: new PZ.propertyList(flareSetupDefinitions),
                positioning: positioning,
                motionBlur: new PZ.propertyList(motionBlurDefinitions),
                global: new PZ.propertyList(globalDefinitions),
                position: PZ.property.create(transformDefinitions.position),
                rotation: PZ.property.create(transformDefinitions.rotation),
                scale: PZ.property.create(transformDefinitions.scale),
            });
            var groups = {
                flareSetup: "Flare Setup",
                positioning: "Source",
                motionBlur: "Motion Blur",
                global: "Global Parameters",
            };
            for (var g in groups) {
                Object.defineProperty(this.properties[g], "displayName", { value: groups[g], writable: true });
            }
            var subgroupNames = {
                foreground: "Occlusion",
                flicker: "Flicker",
                customLayers: "Custom Layers",
            };
            for (var sub in subgroupNames) {
                Object.defineProperty(positioning[sub], "displayName", { value: subgroupNames[sub], writable: true });
            }

            this.material = null;
            this.quad = null;
            this._whiteTexture = null;
            this._customTextures = { uCustom1: null, uCustom2: null, uCustom3: null };
            this._customValues = {};
            this._dataA = new Float32Array(MAX_ELEMENTS * 4);
            this._dataB = new Float32Array(MAX_ELEMENTS * 4);
            this._dataC = new Float32Array(MAX_ELEMENTS * 4);
            this._dataD = new Float32Array(MAX_ELEMENTS * 4);
            this._dataColor = new Float32Array(MAX_ELEMENTS * 3);
            // Per-frame values from update(); read by the render hook.
            this._frame = {
                sourceType: 1,
                screenSource: [0, 0],
                center: [0, 0],
                light: null,
                brightness: 1,
                scale: 1,
                margin: 0.25,
                reference: 10,
                falloff: 0,
                occlude: false,
                resolution: DEFAULT_RESOLUTION,
            };
        }
        load(e) {
            this.unloadStack();
            if (e && typeof e === "object" && typeof e.objectType === "number") {
                this.objectType = e.objectType;
            }
            loadProperties(this.properties, e && e.properties);
            // A saved stack is authoritative, even when empty. Presets only seed
            // a brand-new object, which has no stack field yet.
            if (e && typeof e === "object" && Array.isArray(e.stack)) {
                for (var k = 0; k < e.stack.length; k++) {
                    var element = new PZ.object3d.optflares.element();
                    this.stack.push(element);
                    element.loading = element.load(e.stack[k]);
                }
            } else {
                this.stack.push.apply(this.stack, this.elementsFor(presetKeyFor(this.objectType)));
            }
            liveFlares.add(this);
            this.ensureMaterial();
            this.parentChanged();
        }
        toJSON() {
            return { type: this.type, objectType: this.objectType, properties: this.properties, stack: this.stack };
        }
        isLive() {
            return liveFlares.has(this);
        }
        unload() {
            liveFlares.delete(this);
            this.unloadStack();
            this.releaseCustomTextures();
            if (this.quad && this.quad.parent) this.quad.parent.remove(this.quad);
            if (this.underQuad && this.underQuad.parent) this.underQuad.parent.remove(this.underQuad);
            if (this.quad && this.quad.geometry) this.quad.geometry.dispose();
            if (this.material) this.material.dispose();
            if (this.underMaterial) this.underMaterial.dispose();
            this.underMaterial = null;
            this.underQuad = null;
            if (this._whiteTexture) this._whiteTexture.dispose();
            this.material = null;
            this.quad = null;
            this._whiteTexture = null;
        }
        unloadStack() {
            for (var i = 0; i < this.stack.length; i++) this.stack[i].unload();
            this.stack.splice(0, this.stack.length);
        }
        elementsFor(key) {
            return presetData(key).map(function (data) {
                var element = new PZ.object3d.optflares.element();
                element.load(data);
                return element;
            });
        }
        applyPreset(key) {
            this.unloadStack();
            this.stack.push.apply(this.stack, this.elementsFor(key));
        }
        ensureMaterial() {
            if (this.material) return;
            if (!this._whiteTexture) this._whiteTexture = whiteTexture();
            var vector4 = function (array) {
                return { type: "v4", value: array };
            };
            this.material = new THREE.ShaderMaterial({
                uniforms: {
                    uSource: { type: "v2", value: new THREE.Vector2(0, 0) },
                    uCenter: { type: "v2", value: new THREE.Vector2(0, 0) },
                    uViewAspect: { type: "f", value: 16 / 9 },
                    uDepth: { type: "f", value: 0 },
                    uBrightness: { type: "f", value: 0 },
                    uGain: { type: "f", value: 1 },
                    uScale: { type: "f", value: 1 },
                    uAspect: { type: "f", value: 1 },
                    uRotation: { type: "f", value: 0 },
                    uEvolution: { type: "f", value: 0 },
                    uTime: { type: "f", value: 0 },
                    uFlickerAmount: { type: "f", value: 0 },
                    uFlickerSpeed: { type: "f", value: 2 },
                    uGpu: { type: "f", value: 1 },
                    uColorMode: { type: "f", value: 0 },
                    uRenderMode: { type: "f", value: 0 },
                    uBlendGlobal: { type: "f", value: 0 },
                    uTint: { type: "v3", value: new THREE.Vector3(1, 1, 1) },
                    uElementCount: { type: "f", value: 0 },
                    eDataA: vector4(this._dataA),
                    eDataB: vector4(this._dataB),
                    eDataC: vector4(this._dataC),
                    eDataD: vector4(this._dataD),
                    eColor: { type: "v3", value: this._dataColor },
                    uCustom1: { type: "t", value: this._whiteTexture },
                    uCustom2: { type: "t", value: this._whiteTexture },
                    uCustom3: { type: "t", value: this._whiteTexture },
                },
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                transparent: true,
                depthTest: false,
                depthWrite: false,
                blending: THREE.CustomBlending,
                blendSrc: THREE.OneFactor,
                blendDst: THREE.OneFactor,
                blendEquation: THREE.AddEquation,
            });
            this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), this.material);
            this.quad.__zoidiumOpticalFlareQuad = true;
            this.quad.frustumCulled = false;
            this.quad.matrixAutoUpdate = false;
            this.quad.renderOrder = 9999;
            var self = this;
            hookRender(this.quad, function (camera) {
                self.prepareFrame(camera);
            });
            this.threeObj.add(this.quad);
            // Foreground fade: the depth-tested quad draws the flare at "fade"
            // strength and this untested quad draws the rest underneath it, so
            // occluded pixels keep (1 - fade) of the flare and visible pixels
            // add up to full strength. It shares every uniform except uGain.
            var underUniforms = Object.assign({}, this.material.uniforms, { uGain: { type: "f", value: 0 } });
            this.underMaterial = new THREE.ShaderMaterial({
                uniforms: underUniforms,
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                transparent: true,
                depthTest: false,
                depthWrite: false,
            });
            this.underQuad = new THREE.Mesh(this.quad.geometry, this.underMaterial);
            this.underQuad.frustumCulled = false;
            this.underQuad.matrixAutoUpdate = false;
            this.underQuad.renderOrder = 9998;
            this.underQuad.visible = false;
            hookRender(this.underQuad, function (camera) {
                self.prepareFrame(camera);
            });
            this.threeObj.add(this.underQuad);
            this.applyGlobalBlending(0);
        }
        applyGlobalBlending(mode) {
            if (!this.material) return;
            this.material.uniforms.uBlendGlobal.value = mode;
            if (this._appliedBlend === mode) return;
            this._appliedBlend = mode;
            // Blending is GL draw state, not program state, so no shader
            // recompile (needsUpdate) is required when the mode changes; the
            // renderer reads these fields on every draw.
            this.material.blending = THREE.CustomBlending;
            this.material.blendSrc = THREE.OneFactor;
            this.material.blendDst = THREE.OneFactor;
            this.material.blendEquation = THREE.AddEquation;
            if (mode === 1) {
                this.material.blendDst = THREE.OneMinusSrcColorFactor;
            } else if (mode === 2) {
                this.material.blending = THREE.NormalBlending;
            }
            if (this.underMaterial) {
                this.underMaterial.blending = this.material.blending;
                this.underMaterial.blendSrc = this.material.blendSrc;
                this.underMaterial.blendDst = this.material.blendDst;
                this.underMaterial.blendEquation = this.material.blendEquation;
            }
        }
        releaseCustomTextures() {
            var project = this.tryGetParentOfType(PZ.project);
            for (var key in this._customTextures) {
                var texture = this._customTextures[key];
                if (texture) {
                    this.disposeCustomTexture(key);
                    if (project) project.assets.unload(texture);
                    this._customTextures[key] = null;
                }
                this._customValues[key] = undefined;
            }
            if (this.material && this._whiteTexture) {
                this.material.uniforms.uCustom1.value = this._whiteTexture;
                this.material.uniforms.uCustom2.value = this._whiteTexture;
                this.material.uniforms.uCustom3.value = this._whiteTexture;
            }
        }
        disposeCustomTexture(key) {
            var uniform = this.material && this.material.uniforms[key];
            if (uniform && uniform.value && uniform.value !== this._whiteTexture) {
                uniform.value.dispose();
                uniform.value = this._whiteTexture;
            }
        }
        updateCustomTexture(property, uniformName, time) {
            var project = this.tryGetParentOfType(PZ.project);
            var value = property ? property.get(time) : null;
            if (this._customValues[uniformName] === value) return;
            var old = this._customTextures[uniformName];
            if (old) {
                this.disposeCustomTexture(uniformName);
                if (project) project.assets.unload(old);
                this._customTextures[uniformName] = null;
            }
            this._customValues[uniformName] = value;
            if (value && project) {
                this._customTextures[uniformName] = new PZ.asset.image(project.assets.load(value));
            }
            var texture = this._customTextures[uniformName];
            this.material.uniforms[uniformName].value = texture ? texture.getTexture(true) : this._whiteTexture;
        }
        async reloadCustomTexture(key, asset) {
            for (var uniformName of Object.keys(this._customTextures)) {
                var wrapper = this._customTextures[uniformName];
                if (wrapper?.asset !== asset || this._customValues[uniformName] !== key) continue;
                await wrapper.loading;
                // Refresh the same wrapper without releasing its native hold.
                this.disposeCustomTexture(uniformName);
                this.material.uniforms[uniformName].value = wrapper.getTexture(true);
                this._customValues[uniformName] = key;
            }
        }
        findLight(index) {
            var layer = this.tryGetParentOfType(PZ.layer);
            if (!layer || !layer.objects) return null;
            var lights = [];
            layer.objects.forEachItemOfType(PZ.object3d.light, function (light) {
                lights.push(light);
            });
            if (!lights.length) return null;
            return lights[Math.max(0, Math.min(lights.length - 1, Math.round(index || 0)))] || null;
        }
        // Phase 1: property values at `time`. Nothing here depends on the
        // camera or on other objects' transforms.
        update(time) {
            this.ensureMaterial();
            var props = this.properties;
            var setup = props.flareSetup;
            var positioning = props.positioning;
            var frame = this._frame;

            if (props.position) {
                var position = props.position.get(time);
                this.threeObj.position.set(position[0], position[1], position[2]);
            }
            if (props.rotation) {
                var rotation = props.rotation.get(time);
                this.threeObj.rotation.set(rotation[0], rotation[1], rotation[2]);
            }
            if (props.scale) {
                var scale = props.scale.get(time);
                this.threeObj.scale.set(scale[0], scale[1], scale[2]);
            }

            var layer = this.tryGetParentOfType(PZ.layer);
            var resolution = DEFAULT_RESOLUTION;
            if (layer && layer.properties && layer.properties.resolution) {
                var res = layer.properties.resolution.get(time);
                if (res && res.length === 2 && res[0] > 0 && res[1] > 0) resolution = res;
            }
            var sequence = this.tryGetParentOfType(PZ.sequence);
            var rate = sequence && sequence.properties.rate ? Math.max(1, sequence.properties.rate.get(time)) : 30;

            var sourceType = Math.round(positioning.sourceType.get(time));
            frame.sourceType = sourceType;
            frame.resolution = resolution;
            frame.center = math.offsetToLayout(setup.centerPosition.get(time), resolution[1]);
            frame.screenSource = math.offsetToLayout(setup.positionXY.get(time), resolution[1]);
            frame.light = sourceType === 2 ? this.findLight(positioning.lightIndex.get(time)) : null;
            frame.occlude = sourceType !== 0 && positioning.foreground.occlude.get(time) === 1;
            frame.fade = Math.max(0, Math.min(100, Number(positioning.foreground.fade.get(time)) || 0)) / 100;
            frame.margin = Math.max(0, positioning.margin.get(time));
            frame.reference = positioning.referenceDistance.get(time);
            frame.falloff = Math.max(0, positioning.distanceFalloff.get(time));
            frame.brightness = setup.brightness.get(time) / 100;
            frame.scale = (setup.scale.get(time) / 100) * (props.global.scale.get(time) / 100);

            var u = this.material.uniforms;
            u.uCenter.value.set(frame.center[0], frame.center[1]);
            u.uScale.value = frame.scale;
            u.uAspect.value = Math.max(0.01, props.global.aspectRatio.get(time));
            u.uRotation.value = setup.rotationOffset.get(time) * DEG;
            u.uEvolution.value = setup.animationEvolution.get(time) * DEG;
            u.uTime.value = time / rate;
            u.uFlickerAmount.value = positioning.flicker.amount.get(time) / 100;
            u.uFlickerSpeed.value = positioning.flicker.speed.get(time);
            u.uGpu.value = setup.gpu.get(time) === 1 ? 1 : 0;
            u.uColorMode.value = Math.round(setup.colorMode.get(time));
            u.uRenderMode.value = Math.round(props.motionBlur.renderMode.get(time));
            var tint = setup.color.get(time);
            u.uTint.value.set(tint[0], tint[1], tint[2]);
            this.applyGlobalBlending(Math.round(props.global.blendMode.get(time)));

            this.updateCustomTexture(positioning.customLayers.layer1, "uCustom1", time);
            this.updateCustomTexture(positioning.customLayers.layer2, "uCustom2", time);
            this.updateCustomTexture(positioning.customLayers.layer3, "uCustom3", time);

            var count = Math.min(this.stack.length, MAX_ELEMENTS);
            var dataA = this._dataA;
            var dataB = this._dataB;
            var dataC = this._dataC;
            var dataD = this._dataD;
            var dataColor = this._dataColor;
            var rootOffset = props.global.scaleOffset.get(time) === 1 || setup.scaleOffset.get(time) === 1;
            var seedBase = props.global.globalSeed.get(time) * 0.001;
            var globalColor = props.global.color.get(time);
            var anySolo = false;
            for (var s = 0; s < count; s++) {
                if (this.stack[s].properties.element.solo.get(time) === 1) {
                    anySolo = true;
                    break;
                }
            }
            var anyEnabled = false;
            // Set when a rendered element could evaluate a NaN-producing path
            // (the ring element's pow() with a negative base, or the Ring lens
            // texture): skipping them would turn NaN pixels into clean ones.
            var nanRisk = false;
            var lastVisible = -1;
            for (var i = 0; i < count; i++) {
                var element = this.stack[i];
                var p = element.properties;
                var distance = p.element.distance.get(time);
                var elementScale = p.globalParams.scaleOffset.get(time) === 1 ? 1 / (1 + Math.max(0, distance) / 100) : 1;
                var offsetFactor = rootOffset ? 1 / (1 + Math.max(0, distance) / 100) : 1;
                var o = i * 4;
                var opacity = p.element.opacity.get(time) / 100;
                var sizeFactor = (p.globalParams.scale.get(time) / 100) * elementScale * offsetFactor;
                dataA[o] = sizeFactor;
                dataA[o + 1] = Math.max(0.01, p.globalParams.aspectRatio.get(time));
                dataA[o + 2] = (p.globalParams.globalSeed.get(time) + seedBase) * 0.001;
                dataA[o + 3] = opacity;
                dataB[o] = p.element.rotation.get(time) * DEG;
                dataB[o + 1] = distance / 100;
                dataB[o + 2] = p.element.animate.get(time) === 1 ? 1 : 0;
                var texMode = Math.round(p.lensTexture.textureImage.get(time));
                dataB[o + 3] = texMode;
                dataC[o] = p.lensTexture.illuminationRadius.get(time);
                dataC[o + 1] = p.lensTexture.falloff.get(time);
                dataC[o + 2] = p.matteBox.startRange.get(time);
                dataC[o + 3] = p.matteBox.fadeAmount.get(time);
                dataD[o] = Math.round(p.matteBox.shape.get(time));
                dataD[o + 1] = Math.round(p.globalParams.blendMode.get(time));
                var etype = Math.round(p.element.elementType.get(time));
                dataD[o + 2] = etype;
                var enabled = p.element.enabled.get(time) === 1;
                var solod = p.element.solo.get(time) === 1;
                // An element with zero opacity or a zero size factor adds
                // exactly 0.0 to the pixel in every blend mode (add, screen and
                // normal are all exact no-ops for a finite zero), so it is
                // folded into the visibility flag the shader already skips on.
                // Elements that could evaluate a NaN path keep executing so any
                // NaN pixels they produce today are preserved bit for bit.
                var nanCapable = etype === 8 || texMode === 3;
                var zeroContribution = (opacity === 0 || sizeFactor === 0) && !nanCapable;
                var visible = enabled && (!anySolo || solod) && !zeroContribution;
                dataD[o + 3] = visible ? 1 : 0;
                anyEnabled = anyEnabled || visible;
                if (visible && nanCapable) nanRisk = true;
                if (visible) lastVisible = i;
                var elementColor = p.globalParams.color.get(time);
                dataColor[i * 3] = elementColor[0] * globalColor[0];
                dataColor[i * 3 + 1] = elementColor[1] * globalColor[1];
                dataColor[i * 3 + 2] = elementColor[2] * globalColor[2];
            }
            // Trailing invisible elements would only hit the shader's continue
            // path, which has no side effects, so the loop bound ends at the
            // last visible element. Order and values of the executed iterations
            // are unchanged.
            u.uElementCount.value = lastVisible + 1;
            // Zero brightness or zero flare scale makes every element
            // contribute exactly 0.0 (all shader paths are finite once the
            // NaN-capable elements above are excluded), so the screen-covering quad
            // and its occlusion under-quad are skipped for this frame.
            var zeroFlare = (frame.brightness === 0 || frame.scale === 0) && !nanRisk;
            this.quad.visible = anyEnabled && !zeroFlare;
            // Decided here (not in the render hook) so it applies to this frame.
            if (this.underQuad) this.underQuad.visible = anyEnabled && !zeroFlare && frame.occlude && frame.fade < 1;
        }
        // Phase 2, from the render hook of the quad: the camera drawing the
        // pass and the world transforms of this frame. Everything is recomputed
        // on every call.
        prepareFrame(camera) {
            var frame = this._frame;
            var u = this.material.uniforms;
            var resolution = frame.resolution;
            var aspect = resolution[0] / resolution[1];
            var state = null;
            if (frame.sourceType === 0) {
                state = { source: frame.screenSource, depth: null, fade: 1, scale: 1 };
            } else if (camera && camera.matrixWorldInverse && camera.projectionMatrix) {
                var world = frame.sourceType === 2
                    ? worldPosition(frame.light)
                    : worldPosition(this);
                if (world) {
                    state = math.screenState({
                        world: world,
                        view: camera.matrixWorldInverse.elements,
                        proj: camera.projectionMatrix.elements,
                        aspect: aspect,
                        margin: frame.margin,
                        reference: frame.reference,
                        falloff: frame.falloff,
                    });
                }
            }
            u.uViewAspect.value = aspect;
            if (state) {
                u.uSource.value.set(state.source[0], state.source[1]);
                u.uDepth.value = state.depth != null ? Math.max(-1, Math.min(1, state.depth)) : 0;
                u.uBrightness.value = frame.brightness * state.fade;
                u.uScale.value = frame.scale * state.scale;
            } else {
                u.uBrightness.value = 0;
                u.uScale.value = frame.scale;
            }
            // Depth test only for 3D sources; the quad is at the source depth.
            var occluding = frame.occlude && state !== null && state.depth != null;
            this.material.depthTest = occluding;
            var fade = occluding ? (frame.fade != null ? frame.fade : 1) : 1;
            u.uGain.value = fade;
            if (this.underMaterial) {
                this.underMaterial.uniforms.uGain.value = occluding ? 1 - fade : 0;
            }
        }
        // Preview frame cache probe: every custom texture has loaded.
        zoidiumFrameReady() {
            var ready = true;
            for (var key in this._customTextures) {
                var texture = this._customTextures[key];
                if (texture && !texture.zoidiumLoaded) {
                    ready = false;
                    Promise.resolve(texture.loading).then(markLoaded.bind(null, texture), function () {});
                }
            }
            return ready;
        }
        async prepare() {
            var keys = ["uCustom1", "uCustom2", "uCustom3"];
            for (var i = 0; i < keys.length; i++) {
                var texture = this._customTextures[keys[i]];
                if (texture) await texture.loading;
            }
        }
    };

    PZ.object3d.optflares.element = optflaresElement;
    PZ.object3d.optflares.prototype.defaultName = "Optical Flares";
    PZ.object3d.optflares.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Optical Flares" },
    };

    if (PZ.ui && PZ.ui.objectTypes) {
        PZ.ui.objectTypes.set(
            optflaresElement,
            ELEMENT_TYPES.map(function (t, index) {
                return { name: t.name, desc: t.name + " lens object.", type: index };
            })
        );
    }

    PZ.opticalflares.ELEMENT_TYPES = ELEMENT_TYPES;
    PZ.opticalflares.PRESETS = PRESETS;
    PZ.opticalflares.presetData = presetData;
    PZ.opticalflares.spec = spec;
    PZ.opticalflares.isInUse = function () {
        return liveFlares.size > 0;
    };
    PZ.opticalflares.liveCount = function () {
        return liveFlares.size;
    };
};
