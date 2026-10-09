// OpenZoid Legacy — Jpeg Damage.
// Ported from the OpenZoid effect/jpegdamage.js implementation. The output is a
// pure function of the input pixels, the properties and the explicit Time
// property: the error pattern is hashed from block coordinates, Rand Seed and
// the Jitter Frames bucket of Time. Nothing is carried between renders.
// The fragment shader comes from this plugin's bundle. The vertex shader is the
// host's shared vertex asset, resolved through the asset pipeline.
this.defaultName = "Jpeg Damage";
const JPEG_FRAGMENT = "fx_jpegdamage";
const JPEG_VERTEX_PRESET = "/assets/shaders/vertex/common.glsl";

function jpegNum(name, value, min, max, step, decimals) {
    return {
        dynamic: true,
        name: name,
        type: PZ.property.type.NUMBER,
        value: value,
        min: min,
        max: max,
        step: step,
        decimals: decimals,
    };
}

this.propertyDefinitions = {
    enabled: {
        dynamic: true,
        name: "Enabled",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
    },
    time: {
        dynamic: true,
        name: "Time",
        type: PZ.property.type.NUMBER,
        value: (e) => {
            e.animated = true;
            e.expression = new PZ.expression("time");
        },
        step: 0.01,
    },
    amount: jpegNum("Amount", 1, 0, 1, 0.01, 2),
    quality: jpegNum("Quality", 0.1, 0.01, 1, 0.01, 2),
    resFactor: {
        dynamic: true,
        name: "Res Factor",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 1,
        max: 8,
        step: 1,
        decimals: 0,
    },
    resRelX: jpegNum("Res Rel X", 1, 0.01, 8, 0.05, 2),
    allFreq: jpegNum("All Freq Scale", 1, 0, 8, 0.05, 2),
    xFreq: jpegNum("X Freq Scale", 1, 0, 8, 0.05, 2),
    yFreq: jpegNum("Y Freq Scale", 1, 0, 8, 0.05, 2),
    lowFreq: jpegNum("Low Freq Scale", 1, 0, 8, 0.05, 2),
    midFreq: jpegNum("Mid Freq Scale", 1, 0, 8, 0.05, 2),
    highFreq: jpegNum("High Freq Scale", 1, 0, 8, 0.05, 2),
    affectLuma: jpegNum("Affect Luma", 1, 0, 4, 0.05, 2),
    affectChroma: jpegNum("Affect Chroma", 0.5, 0, 4, 0.05, 2),
    errRate: jpegNum("Error Rate", 0, 0, 10, 0.05, 2),
    errDensity: jpegNum("Err Block Density", 0.75, 0, 1, 0.01, 2),
    errAmp: jpegNum("Error Amp", 1, 0, 8, 0.1, 2),
    errCoherence: jpegNum("Error Coherence", 1, 0, 8, 0.1, 2),
    jitterFrames: {
        dynamic: true,
        name: "Jitter Frames",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 240,
        step: 1,
        decimals: 0,
    },
    randSeed: jpegNum("Rand Seed", 0.123, 0, 100, 0.001, 3),
    scaleLights: jpegNum("Scale Lights", 1, 0, 4, 0.05, 2),
    offsetDarks: jpegNum("Offset Darks", 0, -1, 1, 0.01, 2),
    saturation: jpegNum("Saturation", 1, 0, 4, 0.05, 2),
};

this.properties.addAll(this.propertyDefinitions, this);

// Shader assets are loaded once; prepare() waits for them so a frame is never
// rendered before the pass exists.
async function jpegBuildPass(effect, data, generation) {
    var getAsset = effect._zoidiumGetAsset;
    var fragSource = typeof getAsset === "function"
        ? getAsset("text", "./plugins/openzoid-legacy/shaders/" + JPEG_FRAGMENT + ".glsl")
        : undefined;
    if (typeof fragSource !== "string") {
        throw new Error("Jpeg Damage shader is missing from the plugin bundle.");
    }
    var vertPreset = effect.parentProject.assets.createFromPreset(PZ.asset.type.SHADER, JPEG_VERTEX_PRESET);
    var vertShader = new PZ.asset.shader(effect.parentProject.assets.load(vertPreset));
    effect._vertShader = vertShader;
    var vertSource = await vertShader.getShader();
    if (effect._jpegGeneration !== generation) return;
    var material = new THREE.ShaderMaterial({
        defines: { JPEG_STAGE: 3 },
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
        uniforms: {
            tDiffuse: { type: "t", value: null },
            tStage: { value: null },
            quantTable: { value: null },
            outputResolution: { value: new THREE.Vector2(1, 1) },
            lowResolution: { value: new THREE.Vector2(1, 1) },
            blockGrid: { value: new THREE.Vector2(1, 1) },
            atlasGrid: { value: new THREE.Vector2(1, 1) },
            sparseAxes: { value: new THREE.Vector2(0, 0) },
            blockOffset: { value: 0 },
            blockCount: { value: 1 },
            uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
            resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
            time: { type: "f", value: 0 },
            amount: { type: "f", value: 1 },
            quality: { type: "f", value: 0.1 },
            resFactor: { type: "f", value: 1 },
            resRelX: { type: "f", value: 1 },
            allFreq: { type: "f", value: 1 },
            xFreq: { type: "f", value: 1 },
            yFreq: { type: "f", value: 1 },
            lowFreq: { type: "f", value: 1 },
            midFreq: { type: "f", value: 1 },
            highFreq: { type: "f", value: 1 },
            affectLuma: { type: "f", value: 1 },
            affectChroma: { type: "f", value: 0.5 },
            errRate: { type: "f", value: 0 },
            errDensity: { type: "f", value: 0.75 },
            errAmp: { type: "f", value: 1 },
            errCoherence: { type: "f", value: 1 },
            jitterFrames: { type: "f", value: 1 },
            randSeed: { type: "f", value: 0.123 },
            scaleLights: { type: "f", value: 1 },
            offsetDarks: { type: "f", value: 0 },
            saturation: { type: "f", value: 1 },
        },
        vertexShader: vertSource,
        fragmentShader: fragSource,
    });
    effect.pass = jpegPipeline(material);
    effect.resize();
    effect.properties.load(data && data.properties);
}


// The quantization tables are uploaded once, avoiding dynamic GLSL array
// indexing on the WebGL 1 host. Values are the original JPEG quality-50 tables.
function jpegQuantTexture() {
    var luma = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,
        14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,
        18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,
        49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
    var chroma = [17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,
        24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99];
    var bytes = new Uint8Array(64 * 4);
    for (var i = 0; i < 64; i++) {
        bytes[i * 4] = luma[i];
        bytes[i * 4 + 1] = i < chroma.length ? chroma[i] : 99;
        bytes[i * 4 + 3] = 255;
    }
    var texture = new THREE.DataTexture(bytes, 8, 8, THREE.RGBAFormat);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

function jpegPipeline(material) {
    var pass = new THREE.ShaderPass(material);
    var originalRender = pass.render;
    var u = pass.uniforms;
    var materials = [];
    for (var stage = 0; stage < 3; stage++) {
        materials.push(new THREE.ShaderMaterial({
            uniforms: u, vertexShader: material.vertexShader,
            fragmentShader: material.fragmentShader, defines: { JPEG_STAGE: stage },
            depthTest: false, depthWrite: false, blending: THREE.NoBlending,
        }));
    }
    materials.push(material);
    var table = jpegQuantTexture();
    u.quantTable.value = table;
    var targets = [0, 1].map(function () {
        var target = new THREE.WebGLRenderTarget(1, 1, {
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
            depthBuffer: false, stencilBuffer: false,
        });
        target.texture.generateMipmaps = false;
        return target;
    });
    pass.targets = targets;
    pass.materials = materials;
    pass.storage = null;
    pass.needsSwap = true;
    // Storage is selected against the actual renderer, including framebuffer
    // completeness. Half floats lose coefficient precision near quantization
    // thresholds, so RGBA8 packing is the precision-preserving fallback.
    function selectStorage(renderer) {
        var gl = renderer.getContext();
        var previous = renderer.getRenderTarget();
        var floatOK = false;
        if (renderer.extensions.get("OES_texture_float")) {
            targets[0].texture.type = THREE.FloatType;
            try {
                renderer.setRenderTarget(targets[0]);
                floatOK = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
            } finally {
                renderer.setRenderTarget(previous);
            }
            targets[0].dispose();
        }
        pass.storage = floatOK ? "float" : "packed";
        for (var i = 0; i < targets.length; i++) {
            targets[i].texture.type = floatOK ? THREE.FloatType : THREE.UnsignedByteType;
        }
        for (var j = 0; j < materials.length; j++) {
            if (!floatOK) materials[j].defines.JPEG_PACKED = 1;
            materials[j].needsUpdate = true;
        }
    }
    pass.render = function (renderer, writeBuffer, readBuffer, delta, maskActive) {
        if (!pass.storage) selectStorage(renderer);
        var packed = pass.storage === "packed";
        var width = Math.max(1, Math.round(u.resolution.value.x));
        var height = Math.max(1, Math.round(u.resolution.value.y));
        var lowX = Math.max(width / (u.resFactor.value * u.resRelX.value), 1);
        var lowY = Math.max(height / u.resFactor.value, 1);
        var outputWidth = writeBuffer ? writeBuffer.width : readBuffer.width;
        var outputHeight = writeBuffer ? writeBuffer.height : readBuffer.height;
        var blocksX = Math.min(Math.ceil(lowX / 8), outputWidth);
        var blocksY = Math.min(Math.ceil(lowY / 8), outputHeight);
        var limit = renderer.capabilities.maxTextureSize;
        var texelWidth = packed ? 24 : 8;
        // Limit intermediate memory even for very narrow blocks or large exports.
        // Bands are independent and overwrite their output pixels exactly once.
        var capacity = Math.min(32768, Math.floor(limit / texelWidth) * Math.floor(limit / 9));
        var totalBlocks = blocksX * blocksY;
        var bandSize = Math.min(totalBlocks, capacity);
        var columns = Math.min(Math.floor(limit / texelWidth), Math.max(1,
            Math.ceil(Math.sqrt(bandSize * 9 / texelWidth))));
        var rows = Math.ceil(bandSize / columns);
        u.outputResolution.value.set(outputWidth, outputHeight);
        u.lowResolution.value.set(lowX, lowY);
        u.blockGrid.value.set(blocksX, blocksY);
        u.atlasGrid.value.set(columns, rows);
        u.sparseAxes.value.set(Math.ceil(lowX / 8) > outputWidth ? 1 : 0,
            Math.ceil(lowY / 8) > outputHeight ? 1 : 0);
        for (var i = 0; i < targets.length; i++) targets[i].setSize(columns * texelWidth, rows * 9);
        var previous = renderer.getRenderTarget();
        var autoClear = renderer.autoClear;
        try {
            u.tDiffuse.value = readBuffer.texture;
            var banded = bandSize < totalBlocks;
            if (banded) {
                renderer.autoClear = false;
                renderer.clearTarget(writeBuffer, true, true, true);
            }
            for (var offset = 0; offset < totalBlocks; offset += bandSize) {
                u.blockOffset.value = offset;
                u.blockCount.value = Math.min(bandSize, totalBlocks - offset);
                u.tStage.value = null;
                pass.quad.material = materials[0];
                renderer.render(pass.scene, pass.camera, targets[0], true);
                u.tStage.value = targets[0].texture;
                pass.quad.material = materials[1];
                renderer.render(pass.scene, pass.camera, targets[1], true);
                u.tStage.value = targets[1].texture;
                pass.quad.material = materials[2];
                renderer.render(pass.scene, pass.camera, targets[0], true);
                u.tStage.value = targets[0].texture;
                pass.quad.material = material;
                originalRender.call(pass, renderer, writeBuffer, readBuffer, banded ? false : delta, maskActive);
            }
        } finally {
            pass.quad.material = material;
            renderer.autoClear = autoClear;
            renderer.setRenderTarget(previous);
        }
    };
    pass.dispose = function () {
        targets.forEach(function (target) { target.dispose(); });
        materials.forEach(function (entry) { entry.dispose(); });
        table.dispose();
        if (pass.quad && pass.quad.geometry) pass.quad.geometry.dispose();
    };
    return pass;
}

this.load = function (e) {
    this.unload();
    var generation = this._jpegGeneration;
    this._loading = jpegBuildPass(this, e, generation);
    return this._loading;
};

this.prepare = async function () {
    if (!this._loading) return;
    try {
        await this._loading;
    } catch (error) {
        console.error("[Zoidium] Jpeg Damage could not load its shaders:", error);
    }
};

this.toJSON = function () {
    return { type: this.type, properties: this.properties };
};

this.unload = function () {
    this._jpegGeneration = (this._jpegGeneration || 0) + 1;
    var pass = this.pass;
    this.pass = null;
    this._loading = null;
    if (pass) pass.dispose();
    if (this._vertShader) {
        this.parentProject.assets.unload(this._vertShader);
        this._vertShader = null;
    }
};

function jpegClamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
}

function jpegNumOr(v, fallback) {
    v = Number(v);
    return isFinite(v) ? v : fallback;
}

this.update = function (e) {
    if (!this.pass) {
        return;
    }
    let rawT = this.properties.time.get(e);
    let t = Number(rawT);
    if (!isFinite(t)) t = 0;
    let u = this.pass.uniforms;
    u.time.value = t;
    u.amount.value = jpegClamp01(this.properties.amount.get(e));
    u.quality.value = Math.min(1, Math.max(0.01, jpegNumOr(this.properties.quality.get(e), 0.1)));
    u.resFactor.value = Math.min(8, Math.max(1, Math.round(jpegNumOr(this.properties.resFactor.get(e), 1))));
    u.resRelX.value = Math.min(8, Math.max(0.01, jpegNumOr(this.properties.resRelX.get(e), 1)));
    u.allFreq.value = Math.max(0, jpegNumOr(this.properties.allFreq.get(e), 1));
    u.xFreq.value = Math.max(0, jpegNumOr(this.properties.xFreq.get(e), 1));
    u.yFreq.value = Math.max(0, jpegNumOr(this.properties.yFreq.get(e), 1));
    u.lowFreq.value = Math.max(0, jpegNumOr(this.properties.lowFreq.get(e), 1));
    u.midFreq.value = Math.max(0, jpegNumOr(this.properties.midFreq.get(e), 1));
    u.highFreq.value = Math.max(0, jpegNumOr(this.properties.highFreq.get(e), 1));
    u.affectLuma.value = Math.max(0, jpegNumOr(this.properties.affectLuma.get(e), 1));
    u.affectChroma.value = Math.max(0, jpegNumOr(this.properties.affectChroma.get(e), 0.5));
    u.errRate.value = Math.max(0, jpegNumOr(this.properties.errRate.get(e), 0));
    u.errDensity.value = jpegClamp01(this.properties.errDensity.get(e));
    u.errAmp.value = Math.max(0, jpegNumOr(this.properties.errAmp.get(e), 1));
    u.errCoherence.value = Math.max(0, jpegNumOr(this.properties.errCoherence.get(e), 1));
    u.jitterFrames.value = Math.min(240, Math.max(0, Math.round(jpegNumOr(this.properties.jitterFrames.get(e), 1))));
    u.randSeed.value = Math.max(0, jpegNumOr(this.properties.randSeed.get(e), 0.123));
    u.scaleLights.value = Math.max(0, jpegNumOr(this.properties.scaleLights.get(e), 1));
    u.offsetDarks.value = jpegNumOr(this.properties.offsetDarks.get(e), 0);
    u.saturation.value = Math.max(0, jpegNumOr(this.properties.saturation.get(e), 1));
    this.pass.enabled =
        this.properties.enabled.get(e) === 1 && u.amount.value !== 0;
};

this.resize = function () {
    if (!this.pass || !this.parentLayer) {
        return;
    }
    let resolution = this.parentLayer.properties.resolution.get();
    this.pass.uniforms.resolution.value.set(resolution[0], resolution[1]);
};
