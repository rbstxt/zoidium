// OpenZoid Legacy — Datamosh (deterministic segment model).
//
// A real datamosh removes an I-frame, so the last clean picture keeps moving
// through the following P-frames. This effect reproduces that look without
// render history, so the same frame always renders the same pixels:
//
//   - Keyframe Interval splits the timeline into segments. The segment start S
//     (a multiple of the interval) is shown untouched.
//   - For a frame t inside a segment, up to Motion Samples earlier frames of
//     that segment are requested from the frame sampler at fixed offsets. Only
//     source frames in [anchor .. t] are read. The anchor is the earliest
//     sampled frame, which equals S whenever the segment fits the sample count.
//   - Each consecutive pair of sampled frames is block-matched on the GPU (one
//     pass per step). The per-block displacements are accumulated.
//   - The anchor is warped by the accumulated displacement and blended in where
//     it differs from the current source picture.
//
// The result depends only on the source frames, the properties and the frame
// index. It does not depend on playback direction, seeks, or earlier renders.
// Frame sampling needs an Adjustment layer. Elsewhere the frame passes through.
// The export-time byte-level renderer is gone, so preview and export match.
// The "Setup" row opens the Datamosh Setup floating window (datamosh-setup.js).

const DATAMOSH_MAX_STEPS = 15; // the host caps frame samples at 16
const DATAMOSH_SETUP_CONTROL = "openzoid-legacy.datamosh-setup";
const DATAMOSH_MOTION_ITEMS =
  "Identity;Scale;Vertical;Horizontal;Zoom;Shear;Wave;Swap;Random";
// Properties replaced or dropped since the algorithm catalogue. Saved values
// are migrated in load(); anything not listed here is kept as is.
const DATAMOSH_RETIRED_KEYS = ["algorithm", "hold", "speed", "time"];

const DATAMOSH_VERTEX_SHADER = `
uniform vec2 uvScale;
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Shared GLSL. Motion vectors are stored in RGBA8 targets as two 16-bit
// fixed-point components (1/64 pixel, range -512..512): RG holds x, BA holds y.
const DATAMOSH_COMMON_GLSL = `
precision highp float;
uniform vec2 resolution;
uniform vec2 uvScale;
float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}
vec2 texCoord(vec2 p) {
    return (clamp(p, vec2(0.0), resolution - vec2(1.0)) + 0.5) / resolution * uvScale;
}
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float decodeComponent(vec2 c) {
    float hi = floor(c.x * 255.0 + 0.5);
    float lo = floor(c.y * 255.0 + 0.5);
    return (hi * 256.0 + lo) / 64.0 - 512.0;
}
vec2 decodeVector(vec4 c) {
    return vec2(decodeComponent(c.rg), decodeComponent(c.ba));
}
vec2 encodeComponent(float x) {
    float u = floor(clamp((x + 512.0) * 64.0, 0.0, 65535.0) + 0.5);
    float hi = floor(u / 256.0);
    return vec2(hi, u - hi * 256.0) / 255.0;
}
vec4 encodeVector(vec2 v) {
    return vec4(encodeComponent(v.x), encodeComponent(v.y));
}
`;

// One step of the chain: block-match the later frame (tCurrent) against the
// earlier frame (tEarlier) and add the best displacement to the running total.
const DATAMOSH_MOTION_SHADER = DATAMOSH_COMMON_GLSL + `
uniform sampler2D tCurrent;
uniform sampler2D tEarlier;
uniform sampler2D tAccumulated;
uniform float hasAccumulated;
uniform vec2 blocks;
uniform float blockSize;
uniform float spacing;

float blockCost(vec2 block, vec2 offset) {
    float sum = 0.0;
    for (int gy = 0; gy < 4; gy++) {
        for (int gx = 0; gx < 4; gx++) {
            vec2 p = block * blockSize + (vec2(float(gx), float(gy)) + 0.5) * (blockSize * 0.25);
            float a = luma(texture2D(tCurrent, texCoord(p)).rgb);
            float b = luma(texture2D(tEarlier, texCoord(p - offset)).rgb);
            sum += abs(a - b);
        }
    }
    return sum;
}

void main() {
    vec2 block = floor(gl_FragCoord.xy);
    vec2 total = vec2(0.0);
    if (hasAccumulated > 0.5) {
        total = decodeVector(texture2D(tAccumulated, (block + 0.5) / blocks));
    }
    float best = 1e9;
    vec2 bestOffset = vec2(0.0);
    for (int j = -2; j <= 2; j++) {
        for (int i = -2; i <= 2; i++) {
            vec2 offset = vec2(float(i), float(j)) * spacing;
            float cost = blockCost(block, offset) + 0.05 * length(offset);
            if (cost < best) {
                best = cost;
                bestOffset = offset;
            }
        }
    }
    gl_FragColor = encodeVector(total + bestOffset);
}
`;

// Final pass: warp the anchor through the accumulated motion, then blend it in
// where it differs from the current picture. Passes the source through when
// hasSamples is 0 (keyframe frames and frames without sampler support).
const DATAMOSH_WARP_SHADER = DATAMOSH_COMMON_GLSL + `
uniform sampler2D tOriginal;
uniform sampler2D tAnchor;
uniform sampler2D tAccumulated;
uniform vec2 blocks;
uniform float blockSize;
uniform float hasSamples;
uniform float amount;
uniform float blend;
uniform float intensity;
uniform float acceleration;
uniform float threshold;
uniform float motionMode;
uniform float frameIndex;
uniform float segment;
uniform float seed;
varying vec2 vUv;

vec2 transformMotion(vec2 total, vec2 block, vec2 p) {
    vec2 v = total * intensity;
    vec2 n = p / resolution - 0.5;
    if (motionMode < 0.5) return v;
    if (motionMode < 1.5) return v * 2.0;
    if (motionMode < 2.5) return vec2(0.0, v.y);
    if (motionMode < 3.5) return vec2(v.x, 0.0);
    if (motionMode < 4.5) return -n * resolution.x * 0.04 * intensity;
    if (motionMode < 5.5) return vec2(v.x + n.y * resolution.x * 0.05 * intensity, v.y);
    if (motionMode < 6.5) {
        return v + vec2(sin(frameIndex * 0.2 + block.y * 0.35), cos(frameIndex * 0.25 + block.x * 0.35)) * 4.0 * intensity;
    }
    if (motionMode < 7.5) return v.yx;
    vec2 r = vec2(hash12(block + vec2(seed * 0.37, segment * 0.11)),
                  hash12(block * 1.7 + vec2(segment * 0.23 + 3.1, seed * 0.13)));
    return (r - 0.5) * 24.0 * intensity;
}

void main() {
    vec4 original = texture2D(tOriginal, vUv * uvScale);
    if (hasSamples < 0.5 || amount <= 0.001) {
        gl_FragColor = original;
        return;
    }
    vec2 p = vUv * resolution;
    vec2 block = floor(p / blockSize);
    vec2 total = decodeVector(texture2D(tAccumulated, (block + 0.5) / blocks));
    vec2 v = transformMotion(total, block, p);
    vec3 moshed = texture2D(tAnchor, texCoord(p - v)).rgb;
    vec3 stretched = texture2D(tAnchor, texCoord(p - v * acceleration * 0.5)).rgb;
    moshed = mix(moshed, stretched, clamp(acceleration * 0.45, 0.0, 0.8));
    float diff = abs(luma(original.rgb) - luma(moshed));
    float jitter = (hash12(block + vec2(seed, segment)) - 0.5) * 0.30 * intensity;
    float act = smoothstep(threshold, threshold + 0.22, diff + jitter);
    float m = clamp(act * clamp(blend, 0.0, 1.0) * 1.4 * clamp(amount, 0.0, 1.0), 0.0, 1.0);
    vec3 col = mix(original.rgb, moshed, m);
    col += (hash12(floor(p) + vec2(frameIndex, seed * 1.7)) - 0.5) * 0.02 * m;
    gl_FragColor = vec4(col, original.a);
}
`;

function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
}

function clampInteger(v, min, max, fallback) {
    v = Number(v);
    if (!isFinite(v)) v = fallback;
    return Math.min(max, Math.max(min, Math.round(v)));
}

function readNumber(property, frame, fallback) {
    try {
        const value = Number(property && property.get ? property.get(frame) : NaN);
        return Number.isFinite(value) ? value : fallback;
    } catch (_error) {
        return fallback;
    }
}

function frameIndexOf(frame) {
    const value = Math.floor(Number(frame));
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function keyframeIntervalOf(effect, frame) {
    return clampInteger(readNumber(effect.properties.interval, frame, 30), 2, 240, 30);
}

// Frame-sampler request. Samples sit at fixed offsets -d, -2d, ... so the
// earliest one is the anchor. d is an integer, so requests are exact.
function datamoshRequest(effect, frame) {
    const f = frameIndexOf(frame);
    const interval = keyframeIntervalOf(effect, frame);
    const age = f - Math.floor(f / interval) * interval;
    const enabled = readNumber(effect.properties.enabled, frame, 1) === 1 &&
        readNumber(effect.properties.amount, frame, 1) > 0.001;
    const wanted = clampInteger(readNumber(effect.properties.samples, frame, 6), 1, DATAMOSH_MAX_STEPS, 6);
    const steps = Math.min(wanted, age);
    if (!enabled || steps < 1) {
        return { enabled: false, count: 0, offsetFrames: -1, startOpacity: 1, decay: 1 };
    }
    return {
        enabled: true,
        count: steps,
        offsetFrames: -Math.floor(age / steps),
        startOpacity: 1,
        decay: 1,
    };
}

// Maps an index from the retired 80-item Algorithm list to the nine motion
// modes. Families with no close equivalent use the nearest visual behavior.
function legacyAlgorithmToMotion(index) {
    const a = Math.round(Number(index));
    if (!(a > 0)) return 0;
    if (a <= 2) return 1;
    if (a === 3) return 2;
    if (a === 4) return 3;
    if (a <= 7) return 4;
    if (a === 8) return 5;
    if (a === 9 || a === 16) return 6;
    if (a === 10) return 7;
    if (a <= 15) return 8;
    if (a <= 28) return 1;
    if (a <= 41) return 0;
    if (a <= 52) return 3;
    return 6;
}

function savedNumber(entry) {
    if (typeof entry === "number") return entry;
    if (entry && typeof entry === "object") {
        if (typeof entry.value === "number") return entry.value;
        const first = Array.isArray(entry.keyframes) ? entry.keyframes[0] : null;
        if (first && typeof first.value === "number") return first.value;
    }
    return undefined;
}

// Returns a copy of saved properties in the current key layout. Older projects
// stored Algorithm, Hold, Speed and Time. Those values are mapped or dropped.
function migrateSavedProperties(saved) {
    if (!saved || typeof saved !== "object") return saved;
    const next = Object.assign({}, saved);
    if (next.motion === undefined && next.algorithm !== undefined) {
        const legacy = savedNumber(next.algorithm);
        if (legacy !== undefined) next.motion = legacyAlgorithmToMotion(legacy);
    }
    DATAMOSH_RETIRED_KEYS.forEach(function (key) {
        delete next[key];
    });
    return next;
}

function dmoshNum(name, value, min, max, step, decimals) {
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

function dmoshStructural(name, value, min, max) {
    return {
        dynamic: false,
        name: name,
        type: PZ.property.type.NUMBER,
        value: value,
        min: min,
        max: max,
        step: 1,
        decimals: 0,
    };
}

const datamoshProperties = {
    enabled: {
        dynamic: true,
        name: "Enabled",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
    },
    setup: {
        name: "Setup",
        type: PZ.property.type.TEXT,
        value: "",
        zoidiumControl: DATAMOSH_SETUP_CONTROL,
    },
    amount: dmoshNum("Amount", 1, 0, 1, 0.01, 2),
    interval: dmoshStructural("I-frame Interval", 30, 2, 240),
    samples: dmoshStructural("Motion Samples", 6, 1, DATAMOSH_MAX_STEPS),
    motion: {
        dynamic: false,
        name: "Motion",
        type: PZ.property.type.OPTION,
        value: 0,
        items: DATAMOSH_MOTION_ITEMS,
    },
    intensity: dmoshNum("Intensity", 0.6, 0, 2, 0.01, 2),
    acceleration: dmoshNum("Acceleration", 0.35, 0, 1, 0.01, 2),
    blend: dmoshNum("Blend", 0.8, 0, 1, 0.01, 2),
    threshold: dmoshNum("Threshold", 0.12, 0, 1, 0.01, 2),
    blockSize: dmoshStructural("Block Size", 12, 2, 64),
    seed: dmoshStructural("Seed", 0, 0, 9999),
};

// Pass object assigned to effect.pass. render() runs one motion pass per
// sampled step and then one warp pass into the output. It keeps no history.
function DatamoshPass(effect) {
    THREE.Pass.call(this);
    this.effect = effect;
    this.resolution = new THREE.Vector2(2, 2);
    this.uniforms = {
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    };
    this.blockSize = 12;
    this.motionUniforms = {
        tCurrent: { type: "t", value: null },
        tEarlier: { type: "t", value: null },
        tAccumulated: { type: "t", value: null },
        hasAccumulated: { type: "f", value: 0 },
        resolution: { type: "v2", value: this.resolution },
        uvScale: this.uniforms.uvScale,
        blocks: { type: "v2", value: new THREE.Vector2(1, 1) },
        blockSize: { type: "f", value: 12 },
        spacing: { type: "f", value: 4 },
    };
    this.warpUniforms = {
        tOriginal: { type: "t", value: null },
        tAnchor: { type: "t", value: null },
        tAccumulated: { type: "t", value: null },
        resolution: { type: "v2", value: this.resolution },
        uvScale: this.uniforms.uvScale,
        blocks: { type: "v2", value: new THREE.Vector2(1, 1) },
        blockSize: { type: "f", value: 12 },
        hasSamples: { type: "f", value: 0 },
        amount: { type: "f", value: 1 },
        blend: { type: "f", value: 0.8 },
        intensity: { type: "f", value: 0.6 },
        acceleration: { type: "f", value: 0.35 },
        threshold: { type: "f", value: 0.12 },
        motionMode: { type: "f", value: 0 },
        frameIndex: { type: "f", value: 0 },
        segment: { type: "f", value: 0 },
        seed: { type: "f", value: 0 },
    };
    const blockOptions = {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
    };
    // Nearest filtering keeps the encoded vectors exact.
    this.blockTargets = [
        new THREE.WebGLRenderTarget(1, 1, blockOptions),
        new THREE.WebGLRenderTarget(1, 1, blockOptions),
    ];
    this.blockTargets.forEach(function (target) {
        target.texture.generateMipmaps = false;
    });
    this.materialMotion = new THREE.ShaderMaterial({
        uniforms: this.motionUniforms,
        vertexShader: DATAMOSH_VERTEX_SHADER,
        fragmentShader: DATAMOSH_MOTION_SHADER,
    });
    this.materialWarp = new THREE.ShaderMaterial({
        uniforms: this.warpUniforms,
        vertexShader: DATAMOSH_VERTEX_SHADER,
        fragmentShader: DATAMOSH_WARP_SHADER,
    });
    this.materialWarp.premultipliedAlpha = true;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.enabled = true;
    this.needsSwap = true;
}

DatamoshPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
    constructor: DatamoshPass,
    setSize: function (width, height) {
        this.resolution.set(Math.max(2, Math.round(width)), Math.max(2, Math.round(height)));
    },
    setMask: function () {},
    resolveSamples: function () {
        const temporal = PZ.zoidium && PZ.zoidium.temporal;
        const samples = temporal && temporal.resolveFrameSamples
            ? temporal.resolveFrameSamples(this.effect) || []
            : [];
        return samples.filter(function (sample) {
            return sample && sample.texture;
        }).slice(0, DATAMOSH_MAX_STEPS);
    },
    // Chain step k pairs frame F(k) with the earlier sample k (F(0) is the
    // current source). Targets alternate so every step reads the last result.
    accumulateMotion: function (renderer, readBuffer, samples) {
        const cols = Math.max(1, Math.ceil(this.resolution.x / this.blockSize));
        const rows = Math.max(1, Math.ceil(this.resolution.y / this.blockSize));
        this.blockTargets.forEach(function (target) {
            if (target.width !== cols || target.height !== rows) target.setSize(cols, rows);
        });
        this.motionUniforms.blocks.value.set(cols, rows);
        this.warpUniforms.blocks.value.set(cols, rows);
        this.motionUniforms.blockSize.value = this.blockSize;
        this.warpUniforms.blockSize.value = this.blockSize;
        this.motionUniforms.spacing.value = Math.max(1, Math.floor(this.blockSize / 3));
        this.quad.material = this.materialMotion;
        for (let k = 0; k < samples.length; k += 1) {
            const current = k === 0 ? readBuffer.texture : samples[k - 1].texture;
            const write = this.blockTargets[k % 2];
            const previous = this.blockTargets[(k + 1) % 2];
            this.motionUniforms.tCurrent.value = current;
            this.motionUniforms.tEarlier.value = samples[k].texture;
            this.motionUniforms.tAccumulated.value = k > 0 ? previous.texture : samples[k].texture;
            this.motionUniforms.hasAccumulated.value = k > 0 ? 1 : 0;
            renderer.render(this.scene, this.camera, write, true);
        }
    },
    render: function (renderer, writeBuffer, readBuffer) {
        if (readBuffer.width > 0 && readBuffer.height > 0) {
            this.resolution.set(readBuffer.width, readBuffer.height);
        }
        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        const output = writeBuffer || readBuffer;
        const samples = this.resolveSamples();
        const steps = samples.length;
        if (steps > 0) this.accumulateMotion(renderer, readBuffer, samples);
        const warp = this.warpUniforms;
        warp.tOriginal.value = readBuffer.texture;
        warp.tAnchor.value = steps > 0 ? samples[steps - 1].texture : readBuffer.texture;
        warp.tAccumulated.value = steps > 0 ? this.blockTargets[(steps - 1) % 2].texture : readBuffer.texture;
        warp.hasSamples.value = steps > 0 ? 1 : 0;
        this.quad.material = this.materialWarp;
        renderer.render(this.scene, this.camera, output, true);
        renderer.autoClear = oldAutoClear;
    },
    dispose: function () {
        this.blockTargets.forEach(function (target) {
            target.dispose();
        });
        this.materialMotion.dispose();
        this.materialWarp.dispose();
        this.quad.geometry.dispose();
    },
});

const datamoshEffect = this;

ZoidiumPluginApis.defineFrameSampler.call(datamoshEffect, {
    displayName: "Datamosh",
    properties: datamoshProperties,
    getRequest(effect, frame) {
        return datamoshRequest(effect, frame);
    },
    lifecycle: {
        load(data) {
            datamoshEffect.pass = new DatamoshPass(datamoshEffect);
            datamoshEffect.pass.setSize(2, 2);
            datamoshEffect.properties.load(migrateSavedProperties(data && data.properties));
        },
        update(e) {
            const pass = datamoshEffect.pass;
            if (!pass) return;
            const props = datamoshEffect.properties;
            const f = frameIndexOf(e);
            const interval = keyframeIntervalOf(datamoshEffect, e);
            const blockSize = clampInteger(readNumber(props.blockSize, e, 12), 2, 64, 12);
            const amount = clamp01(readNumber(props.amount, e, 1));
            pass.blockSize = blockSize;
            const w = pass.warpUniforms;
            w.amount.value = amount;
            w.blend.value = clamp01(readNumber(props.blend, e, 0.8));
            w.intensity.value = Math.min(2, Math.max(0, readNumber(props.intensity, e, 0.6)));
            w.acceleration.value = clamp01(readNumber(props.acceleration, e, 0.35));
            w.threshold.value = clamp01(readNumber(props.threshold, e, 0.12));
            w.blockSize.value = blockSize;
            w.motionMode.value = clampInteger(readNumber(props.motion, e, 0), 0, 8, 0);
            w.frameIndex.value = f;
            w.segment.value = Math.floor(f / interval);
            w.seed.value = clampInteger(readNumber(props.seed, e, 0), 0, 9999, 0);
            pass.enabled = readNumber(props.enabled, e, 1) === 1 && amount !== 0;
        },
        unload() {
            if (datamoshEffect.pass) {
                datamoshEffect.pass.dispose();
            }
        },
        resize() {
            if (!datamoshEffect.pass || !datamoshEffect.parentLayer) {
                return;
            }
            const resolution = datamoshEffect.parentLayer.properties.resolution.get();
            datamoshEffect.pass.setSize(resolution[0], resolution[1]);
        },
    },
});
