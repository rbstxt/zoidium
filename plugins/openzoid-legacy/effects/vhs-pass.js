// OpenZoid Legacy — VHS pass (split from vhs.js).
// The compositor calls render() once per output frame. Trails come from
// frame-sampler results only.

const shaders = require("./vhs-shaders.js");
const VHS_VERTEX_SHADER = shaders.VHS_VERTEX_SHADER;
const VHS_SIGNAL_SHADER = shaders.VHS_SIGNAL_SHADER;
const VHS_TUBE_SHADER = shaders.VHS_TUBE_SHADER;
const VHS_ACCUMULATE_SHADER = shaders.VHS_ACCUMULATE_SHADER;

// Pass object assigned to effect.pass. The compositor calls render() once per
// output frame. Trails come from frame-sampler results only.
function VhsPass(effect) {
    THREE.Pass.call(this);
    this.effect = effect;
    this.resolution = new THREE.Vector2(2, 2);
    this.uniforms = {
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    };
    this.signalUniforms = {
        tDiffuse: { type: "t", value: null },
        tPrev: { type: "t", value: null },
        resolution: { type: "v2", value: this.resolution },
        uvScale: this.uniforms.uvScale,
        time: { type: "f", value: 0 },
        amount: { type: "f", value: 1 },
        hasHistory: { type: "f", value: 0 },
        persistence: { type: "f", value: 0.25 },
        signalStrength: { type: "f", value: 0.25 },
        colorStripes: { type: "f", value: 0.25 },
        chromaCrawl: { type: "f", value: 0.2 },
        chromaLoss: { type: "f", value: 0.05 },
        flicker: { type: "f", value: 0.08 },
        vhsSharpen: { type: "f", value: 0.35 },
        interlace: { type: "f", value: 0.4 },
        staticWarp: { type: "f", value: 0.2 },
        fastForward: { type: "f", value: 0 },
        tracking: { type: "f", value: 0.25 },
        anisotropyWarp: { type: "f", value: 0 },
        rgbSplit: { type: "f", value: 0.12 },
        tear: { type: "f", value: 0.12 },
        humBar: { type: "f", value: 0.1 },
        blueScreen: { type: "f", value: 0 },
        skew: { type: "f", value: 0.25 },
        crease: { type: "f", value: 0 },
        ghost: { type: "f", value: 0.08 },
        osd: { type: "f", value: 0 },
        noiseEvo: { type: "f", value: 0.5 },
        noiseOpacity: { type: "f", value: 0.4 },
        blinds: { type: "f", value: 0 },
        snowDots: { type: "f", value: 0 },
        speedDots: { type: "f", value: 0 },
        anisoSnow: { type: "f", value: 0 },
        jitterX: { type: "f", value: 0.3 },
        jitterY: { type: "f", value: 0.3 },
        roll: { type: "f", value: 0 },
        rollSpeed: { type: "f", value: 1.5 },
    };
    this.tubeUniforms = {
        tDiffuse: { type: "t", value: null },
        uvScale: this.uniforms.uvScale,
        time: { type: "f", value: 0 },
        amount: { type: "f", value: 1 },
    };
    this.accumulateUniforms = {
        tBase: { type: "t", value: null },
        tSample: { type: "t", value: null },
        uvScale: this.uniforms.uvScale,
        factor: { type: "f", value: 1 },
    };
    const options = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
    };
    this.target = new THREE.WebGLRenderTarget(2, 2, options);
    this.target.texture.generateMipmaps = false;
    this.trailTargets = [
        new THREE.WebGLRenderTarget(2, 2, options),
        new THREE.WebGLRenderTarget(2, 2, options),
    ];
    this.trailTargets.forEach(function (target) {
        target.texture.generateMipmaps = false;
    });
    this.materialSignal = new THREE.ShaderMaterial({
        uniforms: this.signalUniforms,
        vertexShader: VHS_VERTEX_SHADER,
        fragmentShader: VHS_SIGNAL_SHADER,
    });
    this.materialSignal.premultipliedAlpha = true;
    this.materialTube = new THREE.ShaderMaterial({
        uniforms: this.tubeUniforms,
        vertexShader: VHS_VERTEX_SHADER,
        fragmentShader: VHS_TUBE_SHADER,
    });
    this.materialTube.premultipliedAlpha = true;
    this.materialAccumulate = new THREE.ShaderMaterial({
        uniforms: this.accumulateUniforms,
        vertexShader: VHS_VERTEX_SHADER,
        fragmentShader: VHS_ACCUMULATE_SHADER,
    });
    this.materialAccumulate.premultipliedAlpha = true;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.enabled = true;
    this.needsSwap = true;
}

VhsPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
    constructor: VhsPass,
    setSize: function (width, height) {
        const w = Math.max(2, Math.round(width));
        const h = Math.max(2, Math.round(height));
        this.resolution.set(w, h);
        this.target.setSize(w, h);
        this.trailTargets.forEach(function (target) {
            target.setSize(w, h);
        });
    },
    setMask: function () {},
    // Averages the sampled source frames into one texture. Returns null when
    // the host supplies no samples (no Adjustment layer, or no trail requested).
    renderTrail: function (renderer) {
        const temporal = PZ.zoidium && PZ.zoidium.temporal;
        const samples = temporal && temporal.resolveFrameSamples
            ? temporal.resolveFrameSamples(this.effect) || []
            : [];
        let current = null;
        let total = 0;
        let slot = 0;
        for (let index = 0; index < samples.length; index += 1) {
            const sample = samples[index];
            const weight = Number(sample && sample.opacity);
            if (!sample || !sample.texture || !(weight > 0)) continue;
            total += weight;
            const target = this.trailTargets[slot % 2];
            slot += 1;
            this.accumulateUniforms.tBase.value = current ? current.texture : sample.texture;
            this.accumulateUniforms.tSample.value = sample.texture;
            this.accumulateUniforms.factor.value = current ? weight / total : 1;
            this.quad.material = this.materialAccumulate;
            renderer.render(this.scene, this.camera, target, true);
            current = target;
        }
        return current;
    },
    render: function (renderer, writeBuffer, readBuffer) {
        if (readBuffer.width > 0 && readBuffer.height > 0 &&
            (this.target.width !== readBuffer.width || this.target.height !== readBuffer.height)) {
            this.setSize(readBuffer.width, readBuffer.height);
        }
        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        const output = writeBuffer || readBuffer;
        const scale = this.uniforms.uvScale.value;
        const width = Math.round(readBuffer.width * scale.x);
        const height = Math.round(readBuffer.height * scale.y);
        this.resolution.set(width, height);
        this.target.viewport?.set?.(0, 0, width, height);
        this.trailTargets.forEach((target) => target.viewport?.set?.(0, 0, width, height));
        const trail = this.renderTrail(renderer);
        this.signalUniforms.tDiffuse.value = readBuffer.texture;
        this.signalUniforms.tPrev.value = trail ? trail.texture : readBuffer.texture;
        this.signalUniforms.hasHistory.value = trail ? 1 : 0;
        this.quad.material = this.materialSignal;
        renderer.render(this.scene, this.camera, this.target, true);
        this.tubeUniforms.tDiffuse.value = this.target.texture;
        this.quad.material = this.materialTube;
        renderer.render(this.scene, this.camera, output, true);
        renderer.autoClear = oldAutoClear;
    },
    dispose: function () {
        this.target.dispose();
        this.trailTargets.forEach(function (target) {
            target.dispose();
        });
        this.materialSignal.dispose();
        this.materialTube.dispose();
        this.materialAccumulate.dispose();
        this.quad.geometry.dispose();
    },
});

module.exports = { VhsPass };

