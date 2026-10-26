"use strict";

// Surface material methods: load/unload, gradient textures, image slots,
// UV transforms, map assignment, shader defines, graph channel binding,
// graph baking, ambient occlusion, and reflection. Installed onto the
// material donor; bare names resolve through the destructured env.

module.exports = function installSurfaceMaterial(target, env) {
    const {
  PZ, THREE, nodes, document, WRAP_VALUES, PZ_VERTEX_HEADER,
  PZ_UV_PROJECTION_CODE, PZ_FRAGMENT_HEADER, PZ_MAP_CODE,
  PZ_PHYSICAL_CODE, PZ_FRESNEL_CODE, PZ_LIGHTING_CODE, pzNoiseCanvas,
  pzDrawGradient,
 } = env;
 function projectAssetsOf(material) {
     // Detached materials (clip deleted) throw when reading parentProject.
     // The immediate parentLayer link stays readable, so only this lookup
     // needs the guard.
     try {
         return material?.parentProject?.assets || null;
     } catch (_error) {
         return null;
     }
 }
target.load = function (e) {
    var material = this;
    this.pzUnloaded = false;
    this.threeObj = this.threeObj || new THREE.MeshPhysicalMaterial();
    this.threeObj.color.setRGB(1, 1, 1);
    this.pzImages = { texture: null, ao: null };
    this.pzTextures = { texture: null, ao: null };
    this.pzGraphTextures = { color: null, luminance: null, emission: null, normal: null, roughness: null, metalness: null, bump: null, opacity: null };
    this.pzNoiseTexture = null;
    this.pzFresnel = null;
    this.pzAnimated = false;
    this.pzGraph = null;
    this.pzUniforms = {
        uPzGraphEmission: { value: null },
        uPzGraphNormal: { value: null },
        uPzEmissionStrength: { value: 1 },
        uPzEnvironmentRotation: { value: 0 },
        uPzRepeat: { value: new THREE.Vector2(1, 1) },
        uPzOffset: { value: new THREE.Vector2(0, 0) },
        uPzCenter: { value: new THREE.Vector2(0, 0) },
        uPzRotation: { value: 0 },
        uPzProjRotation: { value: new THREE.Vector3(0, 0, 0) },
        uPzProjScale: { value: new THREE.Vector3(1, 1, 1) },
        uPzProjTranslate: { value: new THREE.Vector3(0, 0, 0) },
        uPzColor: { value: new THREE.Vector3(1, 1, 1) },
        uPzRamp: { value: null },
        uPzRampFactor: { value: 1 },
        uPzFresnelColor: { value: new THREE.Vector3(1, 1, 1) },
        uPzFresnelPower: { value: 4 },
        uPzFresnelMix: { value: 0.7 },
        uPzGraphColor: { value: null },
        uPzAOMap: { value: null },
        uPzAOColor: { value: new THREE.Vector3(0, 0, 0) },
        uPzAOIntensity: { value: 0.5 },
        uPzAODistance: { value: 1 },
        uPzCelSteps: { value: 4 },
        uPzCelSmoothness: { value: 0.1 },
        uPzCelSpecularSteps: { value: 6 },
        uPzSpecularStrength: { value: 1 },
        uPzSpecularEnabled: { value: 1 },
        uPzSpecularOpacity: { value: 1 },
    };
    this.pzRampTexture = this.createGradientTexture([
        { position: 0, color: "rgba(0,0,0,1)" },
        { position: 1, color: "rgba(255,255,255,1)" },
    ]);
    this.pzUniforms.uPzRamp.value = this.pzRampTexture;
    this.threeObj.onBeforeCompile = function (shader) {
        for (var key in material.pzUniforms) {
            shader.uniforms[key] = material.pzUniforms[key];
        }
        shader.vertexShader = shader.vertexShader
            .replace("#include <uv_pars_vertex>", "#include <uv_pars_vertex>\nvarying vec2 vPzUv;")
            .replace("#include <begin_vertex>", PZ_UV_PROJECTION_CODE)
            .replace("void main() {", PZ_VERTEX_HEADER + "\nvoid main() {");
        const normalChunk = THREE.ShaderChunk?.normalmap_pars_fragment;
        const environmentChunk = THREE.ShaderChunk?.lights_pars_maps;
        if (normalChunk) shader.fragmentShader = shader.fragmentShader.replace("#include <normalmap_pars_fragment>",
            normalChunk.replace("vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;", [
                "vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;",
                "#if PZ_GRAPH_NORMAL && !PZ_NORMAL_IMAGE",
                "mapN = vec3( 0.0, 0.0, 1.0 );",
                "#endif",
            ].join("\n")).replace("mat3 tsn = mat3( S, T, N );", [
                "#if PZ_GRAPH_NORMAL",
                "vec3 detailN = texture2D( uPzGraphNormal, vPzUv ).xyz * 2.0 - 1.0;",
                "mapN = pzReorientBump( vec3( 0.0, 0.0, 1.0 ), normalize( mapN ), normalize( detailN ) );",
                "#endif",
                "mat3 tsn = mat3( S, T, N );",
            ].join("\n")));
        if (environmentChunk) shader.fragmentShader = shader.fragmentShader.replace("#include <lights_pars_maps>",
            "#ifndef PZ_ENVIRONMENT\n#define PZ_ENVIRONMENT 0\n#endif\nuniform float uPzEnvironmentRotation;\n" + environmentChunk.replace(
                "reflectVec = inverseTransformDirection( reflectVec, viewMatrix );",
                "reflectVec = inverseTransformDirection( reflectVec, viewMatrix );\n#if PZ_ENVIRONMENT\n" +
                "float pzCos = cos( uPzEnvironmentRotation ), pzSin = sin( uPzEnvironmentRotation );\n" +
                "reflectVec.xz = mat2( pzCos, -pzSin, pzSin, pzCos ) * reflectVec.xz;\n#endif"));
        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <lights_physical_pars_fragment>",
                PZ_FRAGMENT_HEADER + "\n#include <lights_physical_pars_fragment>"
            )
            .replace("#include <map_fragment>", PZ_MAP_CODE)
            .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#if PZ_GRAPH_EMISSION\ntotalEmissiveRadiance += texture2D( uPzGraphEmission, vPzUv ).rgb * uPzEmissionStrength;\n#endif")
            .replace("#include <normal_fragment_maps>", PZ_FRESNEL_CODE)
            .replace("#include <lights_physical_fragment>", PZ_PHYSICAL_CODE)
            .replace("#include <lights_fragment_end>", PZ_LIGHTING_CODE);
    };
    if (e && e.surfaceOnly) return;
    this.pzLoading = true;
    if (e) this.properties.load(e.properties);
    this.pzLoading = false;
    this.syncRamp();
    this.updateDefines();
    this.updateBumpMap();
    this.refreshBindings();
    this.refreshAO();
    this.bakeGraph();
    this.initReflection();
    this.threeObj.roughness = this.properties.roughness.get();
    this.threeObj.metalness = this.properties.metalness.get();
    this.threeObj.normalScale.set(this.properties.normalScale.get(), this.properties.normalScale.get());
};

target.createGradientTexture = function (stops) {
    var data = new Uint8Array(32 * 4);
    pzDrawGradient(data, stops, 0);
    var texture = new THREE.DataTexture(data, 32, 1, THREE.RGBAFormat);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
};

target.updateGradientTexture = function (stops) {
    if (!this.pzRampTexture) return;
    var interpolation = this.properties.rampInterpolation.get() || 0;
    pzDrawGradient(this.pzRampTexture.image.data, stops, interpolation);
    this.pzRampTexture.needsUpdate = true;
};

target.syncRamp = function () {
    this.updateGradientTexture(this.properties.ramp.get());
};

target.unload = function () {
    this.pzUnloaded = true;
    if (nodes && nodes.editor) {
        nodes.editor.closeMaterial(this);
    }
    if (this.threeObj.envMap) {
        this.parentLayer?.envMap?.releaseTexture?.();
        this.threeObj.envMap = null;
    }
    var slots = Object.keys(this.pzImages);
    var assets = projectAssetsOf(this);
    for (var i = 0; i < slots.length; i++) {
        var asset = this.pzImages[slots[i]];
        if (asset) {
            if (assets) assets.unload(asset);
        }
        var texture = this.pzTextures[slots[i]];
        if (texture) {
            texture.dispose();
        }
        this.pzImages[slots[i]] = null;
        this.pzTextures[slots[i]] = null;
    }
    var graphSlots = Object.keys(this.pzGraphTextures);
    for (var g = 0; g < graphSlots.length; g++) {
        var graphTexture = this.pzGraphTextures[graphSlots[g]];
        if (graphTexture) {
            graphTexture.dispose();
            this.pzGraphTextures[graphSlots[g]] = null;
        }
    }
    if (this.pzNoiseTexture) {
        this.pzNoiseTexture.dispose();
        this.pzNoiseTexture = null;
    }
    if (this.pzRampTexture) {
        this.pzRampTexture.dispose();
        this.pzRampTexture = null;
    }
    this.threeObj.dispose();
};

target.toJSON = function () {
    return { type: this.type, properties: this.properties };
};

target.setImage = function (slot, path) {
    var assets = projectAssetsOf(this);
    var asset = this.pzImages[slot];
    if (asset) {
        if (assets) assets.unload(asset);
        this.pzImages[slot] = null;
    }
    var texture = this.pzTextures[slot];
    if (texture) {
        texture.dispose();
        this.pzTextures[slot] = null;
    }
    if (!path || !assets) return null;
    var loaded = new PZ.asset.image(assets.load(path));
    var threeTexture = loaded.getTexture(true);
    this.pzImages[slot] = loaded;
    this.pzTextures[slot] = threeTexture;
    this.applyWrap(threeTexture);
    return threeTexture;
};

target.applyWrap = function (texture) {
    if (!texture) return;
    var wrap = this.properties.wrap.get() ?? 1;
    texture.wrapS = WRAP_VALUES[wrap];
    texture.wrapT = WRAP_VALUES[wrap];
    texture.needsUpdate = true;
};

target.applyUvTransform = function (texture, repeat, offset, center, rotation) {
    if (!texture) return;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.offset.set(offset[0], offset[1]);
    texture.center.set(center[0], center[1]);
    texture.rotation = rotation;
};

// Assign a built-in map slot. Only null<->texture flips change the compiled
// program and need needsUpdate; texture<->texture swaps are uniform-only.
target.pzAssignMap = function (slot, texture) {
    var t = this.threeObj;
    var next = texture || null;
    var current = t[slot] || null;
    if (current === next) return false;
    t[slot] = next;
    return current === null || next === null;
};

target.updateDefines = function () {
    var graph = this.pzGraphTextures || {};
    var defines = {
        PZ_GRAPH_EMISSION: graph.emission ? 1 : 0,
        PZ_GRAPH_NORMAL: graph.normal ? 1 : 0,
        PZ_NORMAL_IMAGE: (this.pzTextures.normalMap || this._zoidiumTextureSlots?.normalMap?.texture) ? 1 : 0,
        PZ_ENVIRONMENT: this.pzEnvironment?.texture ? 1 : 0,
        PZ_PROJECTION: this.properties.projection.get() || 0,
        PZ_RAMP: this.properties.rampEnabled.get() === 1 ? 1 : 0,
        PZ_RAMP_SRC: this.properties.rampSource.get() || 0,
        PZ_FRESNEL: this.pzFresnel || this.properties.fresnel.get() === 1 ? 1 : 0,
        PZ_AO: this.properties.aoEnabled.get() === 1 ? 1 : 0,
        PZ_AO_MAP: this.pzTextures.ao ? 1 : 0,
        PZ_CEL: this.properties.celEnabled.get() === 1 ? 1 : 0,
        PZ_GRAPH_COLOR: this._nodeBaseMap ? 0 : graph.color ? 1 : 0,
    };
    var current = this.threeObj.defines || {};
    var changed = false;
    for (var key in defines) {
        if (current[key] !== defines[key]) {
            changed = true;
            break;
        }
    }
    if (!changed) return;
    this.threeObj.defines = Object.assign({}, current, defines);
    this.threeObj.needsUpdate = true;
};

target.refreshBindings = function () {
    var graph = this.pzGraphTextures || {};
    var needsUpdate = false;
    needsUpdate = this.pzAssignMap("roughnessMap", graph.roughness) || needsUpdate;
    needsUpdate = this.pzAssignMap("metalnessMap", graph.metalness) || needsUpdate;
    needsUpdate = this.pzAssignMap("emissiveMap", graph.luminance) || needsUpdate;
    needsUpdate = this.pzAssignMap("alphaMap", graph.opacity) || needsUpdate;
    if (graph.opacity) {
        this.threeObj.transparent = true;
    }
    needsUpdate = this.pzAssignMap("normalMap", this.pzTextures.normalMap) || needsUpdate;
    this.pzUniforms.uPzGraphColor.value = graph.color || null;
    this.pzUniforms.uPzAOMap.value = this.pzTextures.ao || null;
    if (this.properties.bumpNoise.get() === 1) {
        needsUpdate = this.pzAssignMap("bumpMap", this.pzNoiseTexture) || needsUpdate;
    } else {
        needsUpdate = this.pzAssignMap("bumpMap", graph.bump) || needsUpdate;
    }
    if (needsUpdate) {
        this.threeObj.needsUpdate = true;
    }
    this.updateDefines();
};

target.updateMipFalloff = function () {
    var mip = this.properties.bumpMipFalloff.get() === 1;
    var wanted = mip ? (THREE.LinearMipmapLinearFilter ?? THREE.LinearMipMapLinearFilter) : THREE.LinearFilter;
    var list = [this.pzNoiseTexture, this.pzGraphTextures.bump];
    for (var i = 0; i < list.length; i++) {
        var texture = list[i];
        if (!texture) continue;
        if (texture.minFilter === wanted && texture.generateMipmaps === mip) continue;
        texture.generateMipmaps = mip;
        texture.minFilter = wanted;
        texture.needsUpdate = true;
    }
};

target.updateBumpMap = function () {
    if (this.pzNoiseTexture) {
        this.pzNoiseTexture.dispose();
        this.pzNoiseTexture = null;
    }
    if (this.properties.bumpNoise.get() === 1) {
        var canvas = pzNoiseCanvas(256, this.properties.bumpNoiseScale.get(), 7);
        if (canvas) {
            this.pzNoiseTexture = new THREE.CanvasTexture(canvas);
            this.applyWrap(this.pzNoiseTexture);
        }
    }
    this.refreshBindings();
    this.updateMipFalloff();
};

target.bindGraphChannel = function (slot) {
    // Returns true when a built-in map slot changed presence (program rebuild).
    var graph = this.pzGraphTextures || {};
    if (slot === "color") {
        this.pzUniforms.uPzGraphColor.value = graph.color || null;
        return false;
    } else if (slot === "emission") {
        this.pzUniforms.uPzGraphEmission.value = graph.emission;
        return false;
    } else if (slot === "normal") {
        this.pzUniforms.uPzGraphNormal.value = graph.normal;
        return this.pzAssignMap("normalMap", this.pzTextures.normalMap || graph.normal);
    } else if (slot === "luminance") {
        return this.pzAssignMap("emissiveMap", graph.luminance);
    } else if (slot === "roughness") {
        return this.pzAssignMap("roughnessMap", graph.roughness);
    } else if (slot === "metalness") {
        return this.pzAssignMap("metalnessMap", graph.metalness);
    } else if (slot === "bump") {
        if (this.properties.bumpNoise.get() !== 1) {
            var changed = this.pzAssignMap("bumpMap", graph.bump);
            this.updateMipFalloff();
            return changed;
        }
        return false;
    } else if (slot === "opacity") {
        var alphaChanged = this.pzAssignMap("alphaMap", graph.opacity);
        if (graph.opacity) {
            this.threeObj.transparent = true;
        }
        return alphaChanged;
    }
    return false;
};

target.setGraphChannel = function (slot, canvas, batch) {
    var existing = this.pzGraphTextures[slot];
    var had = !!existing;
    var has = !!canvas;
    if (has) {
        if (existing) {
            // Reuse the GPU texture object: swap canvas pixels in place instead
            // of disposing + recreating a CanvasTexture every bake.
            existing.image = canvas;
            existing.needsUpdate = true;
        } else {
            this.pzGraphTextures[slot] = new THREE.CanvasTexture(canvas);
        }
    } else if (existing) {
        existing.dispose();
        this.pzGraphTextures[slot] = null;
    }
    if (has) {
        const texture = this.pzGraphTextures[slot];
        texture.magFilter = THREE.LinearFilter;
        const mip = slot !== "bump" || this.properties.bumpMipFalloff.get() === 1;
        texture.minFilter = mip ? (THREE.LinearMipmapLinearFilter ?? THREE.LinearMipMapLinearFilter) : THREE.LinearFilter;
        texture.generateMipmaps = mip;
    }
    var mapChanged = this.bindGraphChannel(slot);
    if (mapChanged) {
        this.threeObj.needsUpdate = true;
    }
    if (!batch && had !== has) {
        this.updateDefines();
    }
    return had !== has || mapChanged;
};

target.graphBakeKey = function (time) {
    var graph = nodes.parse(this.properties.graph.get());
    return JSON.stringify([graph, this.properties.bakeResolution.get(),
        time,
        nodes.dependencySignature(graph, this)]);
};

target.bakeGraph = function (time) {
    if (time === undefined) time = this.pzTime || 0;
    if (!nodes || !this.pzTextures || this.pzUnloaded) return;
    if (this.pzBaking) {
        this.pzBakeQueued = time || 0;
        return;
    }
    this.pzBaking = true;
    try {
        var material = this;
        var graph = nodes.parse(this.properties.graph.get());
        this.pzGraph = graph;
        var resolution = [128, 256, 512, 1024, 2048][this.properties.bakeResolution.get()] || 256;
        var outputs = nodes.evaluate(graph, resolution, time || 0, {
            material: material, images: nodes.imageBuffers(graph, resolution, material),
        });
        this.pzFresnel = nodes.fresnelSettings(graph);
        if (this.pzFresnel) {
            var color = this.pzFresnel.color || [1, 1, 1];
            this.pzUniforms.uPzFresnelColor.value.set(color[0], color[1], color[2]);
            this.pzUniforms.uPzFresnelPower.value = this.pzFresnel.power;
            this.pzUniforms.uPzFresnelMix.value = this.pzFresnel.mix;
        }
        this.pzAnimated = nodes.isAnimated(graph, material);
        var definesDirty = false;
        definesDirty = this.setGraphChannel("color", outputs.color, true) || definesDirty;
        definesDirty = this.setGraphChannel("luminance", outputs.luminance, true) || definesDirty;
        definesDirty = this.setGraphChannel("emission", outputs.emission, true) || definesDirty;
        definesDirty = this.setGraphChannel("normal", outputs.normal, true) || definesDirty;
        definesDirty = this.setGraphChannel("roughness", outputs.roughness, true) || definesDirty;
        definesDirty = this.setGraphChannel("metalness", outputs.metalness, true) || definesDirty;
        definesDirty = this.setGraphChannel("bump", outputs.bump, true) || definesDirty;
        definesDirty = this.setGraphChannel("opacity", outputs.opacity, true) || definesDirty;
        this.pzBakeKey = this.graphBakeKey(time === undefined ? (this.pzTime || 0) : time);
        if (definesDirty) {
            this.updateDefines();
        }
    } finally {
        this.pzBaking = false;
        if (this.pzBakeQueued !== undefined && this.pzBakeQueued !== null) {
            var queued = this.pzBakeQueued;
            this.pzBakeQueued = null;
            if (queued !== (time || 0)) {
                this.bakeGraph(queued);
            }
        }
    }
};

target.refreshAO = function () {
    this.pzUniforms.uPzAOMap.value = this.pzTextures.ao || null;
    this.updateDefines();
};

target.initReflection = function () {
    var enabled = this.properties.reflection.get() === 1 || this.properties.reflReflection.get() === 1;
    if (enabled && !this.threeObj.envMap) {
        this.threeObj.envMap = this.parentLayer?.envMap?.getTexture?.() || null;
        this.threeObj.needsUpdate = true;
    } else if (!enabled && this.threeObj.envMap) {
        this.parentLayer?.envMap?.releaseTexture?.();
        this.threeObj.envMap = null;
        this.threeObj.needsUpdate = true;
    }
};
};
