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
async function jpegBuildPass(effect, data) {
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
    var material = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { type: "t", value: null },
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
    material.premultipliedAlpha = true;
    effect.pass = new THREE.ShaderPass(material);
    effect.properties.load(data && data.properties);
}

this.load = function (e) {
    this._loading = jpegBuildPass(this, e);
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
    var pass = this.pass;
    this.pass = null;
    this._loading = null;
    if (pass) {
        if (pass.material && typeof pass.material.dispose === "function") pass.material.dispose();
        if (pass.quad && pass.quad.geometry && typeof pass.quad.geometry.dispose === "function") {
            pass.quad.geometry.dispose();
        }
    }
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
