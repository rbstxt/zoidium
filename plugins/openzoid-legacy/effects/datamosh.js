// OpenZoid Legacy — Datamosh (realtime simulation).
// Ported verbatim from the OpenZoid effect/datamosh.js implementation. All
// shaders are inline, so no bundle adaptation was needed beyond this header.
// The realtime effect simulates compression breaks with a feedback buffer; the
// byte-exact export-time pass is installed by the datamosh-export module.
// Known limitation: the "Datamosh Setup" button action (datamoshSetup) is
// handled by the OpenZoid editor window, which arrives with the designer phase.
this.defaultName = "Datamosh";

// ---------------------------------------------------------------------------
// Datamosh 2-style setup — compression-break simulation (feedback + MV hack)
// ---------------------------------------------------------------------------
// Real datamosh tampers with video compression: delete I-frames, then let
// P-frame motion vectors smear old pixels into new motion. A realtime WebGL
// editor cannot rewrite an mp4's motion vectors, so this effect simulates the
// identical look with a feedback (history) buffer + per-macroblock motion
// vectors, gated by frame-difference (fake motion activity) + threshold.
//
// Params mirror Datamosh 2: Intensity, Acceleration, Blend, Threshold,
// Block size (macroblocks), Algorithm (80 presets), Hold (I-frame removal),
// Speed, Amount. Stack a Mask effect above it to act as a Mosh Map.
// ---------------------------------------------------------------------------

const DATAMOSH_VERTEX_SHADER = `
uniform vec2 uvScale;
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DATAMOSH_MOSH_SHADER = `
uniform sampler2D tDiffuse;
uniform sampler2D tPrev;
uniform vec2 resolution;
uniform vec2 uvScale;
uniform float time;
uniform float amount;
uniform float hasHistory;
uniform float intensity;
uniform float acceleration;
uniform float blend;
uniform float threshold;
uniform float blockSize;
uniform float algorithm;
uniform float hold;
uniform float speed;
varying vec2 vUv;

float dhash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float dnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = dhash(i);
    float b = dhash(i + vec2(1.0, 0.0));
    float c = dhash(i + vec2(0.0, 1.0));
    float d = dhash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec4 orig = texture2D(tDiffuse, vUv * uvScale);
    if (hasHistory < 0.5 || amount <= 0.001) {
        gl_FragColor = orig;
        return;
    }
    float t = time;
    float sF = floor(t * max(speed, 0.01) * 6.0);
    float bs = max(blockSize, 2.0);
    vec2 bid = floor(vUv * resolution / bs);
    vec2 bc = (bid * bs + bs * 0.5) / resolution;
    float bh1 = dhash(bid + vec2(sF * 0.37, sF * 0.11));
    float bh2 = dhash(bid * 1.71 + vec2(3.1, 7.7) + vec2(sF * 0.13, -sF * 0.07));
    float bh3 = dhash(bid * 0.37 + vec2(9.2, 1.3) + vec2(-sF * 0.21, sF * 0.31));

    vec3 cCurr = texture2D(tDiffuse, clamp(bc, 0.0, 1.0) * uvScale).rgb;
    vec3 cPrevB = texture2D(tPrev, clamp(bc, 0.0, 1.0)).rgb;
    float lC = dot(cCurr, vec3(0.299, 0.587, 0.114));
    float lP = dot(cPrevB, vec3(0.299, 0.587, 0.114));
    float diff = abs(lC - lP);
    float act = smoothstep(threshold, threshold + 0.22, diff + (bh1 - 0.5) * 0.30 * intensity);

    // REMOVE FRAMES: randomly freeze history (deleted I-frame = stuck P-chain)
    float holdR = dhash(vec2(sF, 17.0));
    if (holdR < hold * 0.65) {
        vec3 frozen = texture2D(tPrev, vUv).rgb;
        vec3 fmix = mix(orig.rgb, frozen, clamp(amount, 0.0, 1.0));
        gl_FragColor = vec4(fmix, orig.a);
        return;
    }

    float a = algorithm;
    vec2 n = vUv - 0.5;
    float r = max(length(n), 1e-4);
    vec2 dir = n / r;
    float inten = intensity * (1.0 + acceleration * 1.5);
    vec2 v = vec2(0.0);

    // ---- motion-vector families (80 presets mapped to shared cores) ----
    if (a < 0.5) { // Default
        v = vec2(bh1 - 0.5, (bh2 - 0.5) * 0.45) * 2.0 * inten;
    } else if (a < 1.5) { // Multiply
        v = vec2(bh1 - 0.5, bh2 - 0.5) * 2.0 * inten * 3.0;
    } else if (a < 2.5) { // Add to x and y
        v = vec2(bh1 + bh2 - 1.0, bh2 + bh3 - 1.0) * inten * 2.0;
    } else if (a < 3.5) { // Move vertical
        v = vec2(0.0, (bh1 - 0.5) * 2.0 * inten * 2.0);
    } else if (a < 4.5) { // Move horizontal
        v = vec2((bh1 - 0.5) * 2.0 * inten * 2.0, 0.0);
    } else if (a < 7.5) { // Zoom 1 / Zoom 2 / Zoom sin
        float zm = (a < 5.5) ? 1.0 : (a < 6.5 ? 1.8 : (0.8 + 0.8 * sin(t * 3.0 + r * 20.0)));
        v = -dir * (0.15 + bh1 * 0.85) * inten * 2.2 * zm;
    } else if (a < 8.5) { // Shear
        v = vec2(n.y * 2.0 * inten * (bh1 - 0.5) * 4.0, 0.0);
    } else if (a < 9.5) { // Experimental (turbulent)
        float nz = dnoise(bid * 0.35 + vec2(t * 0.7, -t * 0.5)) - 0.5;
        float nz2 = dnoise(bid * 0.5 + vec2(-t * 0.6, t * 0.8) + 31.0) - 0.5;
        v = vec2(nz, nz2) * 2.0 * inten * 2.5;
    } else if (a < 10.5) { // Swap (steal motion: swap axes)
        v = vec2((bh2 - 0.5), (bh1 - 0.5)) * 2.0 * inten * 2.0;
    } else if (a < 11.5) { // Random
        v = vec2(bh1 - 0.5, bh3 - 0.5) * 2.0 * inten * 3.0;
    } else if (a < 15.5) { // Random Blocks 1-4 (coarser seeds)
        float scl = (a < 12.5) ? 1.0 : (a < 13.5 ? 2.0 : (a < 14.5 ? 0.5 : 3.0));
        vec2 cb = floor(vUv * resolution / (bs * scl));
        float rh1 = dhash(cb + vec2(sF * 0.43, 1.7));
        float rh2 = dhash(cb * 1.3 + vec2(5.0, sF * 0.29));
        v = vec2(rh1 - 0.5, rh2 - 0.5) * 2.0 * inten * 2.6;
    } else if (a < 16.5) { // Spatial (position-driven)
        v = vec2(sin(bid.y * 0.35 + t), cos(bid.x * 0.35 - t * 1.2)) * inten * 1.6;
    } else if (a < 28.5) { // Multiply by X/Y/inverse variants
        float mx = vUv.x;
        float my = vUv.y;
        float ix = 1.0 - mx;
        float iy = 1.0 - my;
        vec2 base = vec2(bh1 - 0.5, bh2 - 0.5) * 2.0;
        if (a < 17.5) v = base * vec2(mx * 2.0, 1.0) * inten * 2.0;
        else if (a < 18.5) v = vec2(base.x * mx * 2.0, 0.0) * inten * 2.0;
        else if (a < 19.5) v = base * vec2(1.0, my * 2.0) * inten * 2.0;
        else if (a < 20.5) v = vec2(0.0, base.y * my * 2.0) * inten * 2.0;
        else if (a < 21.5) v = base * vec2(ix * 2.0, 1.0) * inten * 2.0;
        else if (a < 22.5) v = vec2(base.x * ix * 2.0, 0.0) * inten * 2.0;
        else if (a < 23.5) v = base * vec2(1.0, iy * 2.0) * inten * 2.0;
        else if (a < 24.5) v = vec2(0.0, base.y * iy * 2.0) * inten * 2.0;
        else if (a < 25.5) v = base * vec2(mx * my * 4.0, mx * my * 4.0) * inten * 2.0;
        else if (a < 26.5) v = base * vec2(ix * iy * 4.0, ix * iy * 4.0) * inten * 2.0;
        else if (a < 27.5) v = base * vec2(mx * 2.0, iy * 2.0) * inten * 2.0;
        else v = base * vec2(ix * 2.0, my * 2.0) * inten * 2.0;
    } else if (a < 41.5) { // Average / Add previous (handled via taps below)
        v = vec2(bh1 - 0.5, (bh2 - 0.5) * 0.5) * 2.0 * inten * 1.4;
        if (a >= 29.5 && a < 30.5) v *= vec2(0.6, 1.4);
    } else if (a < 47.5) { // Mirror family
        vec2 m = vUv;
        if (a < 42.5) m = vec2(1.0 - vUv.x, vUv.y);
        else if (a < 43.5) m = vec2(vUv.x, 1.0 - vUv.y);
        else if (a < 44.5) m = vec2(vUv.x < 0.5 ? vUv.x : 1.0 - vUv.x, vUv.y);
        else if (a < 45.5) m = vec2(vUv.x < 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
        else if (a < 46.5) m = vec2(vUv.x, vUv.y < 0.5 ? vUv.y : 1.0 - vUv.y);
        else m = vec2(vUv.x, vUv.y < 0.5 ? 1.0 - vUv.y : vUv.y);
        vec3 mc = texture2D(tPrev, clamp(m, 0.0, 1.0)).rgb;
        float mm = act * clamp(amount, 0.0, 1.0) * clamp(blend * 1.5, 0.0, 1.0);
        vec3 mout = mix(orig.rgb, mc, mm);
        gl_FragColor = vec4(mout, orig.a);
        return;
    } else if (a < 52.5) { // Sweep family
        float sp = fract(t * (0.1 + speed * 0.25));
        vec2 s = vUv;
        if (a < 48.5) s.x = fract(vUv.x + sp * inten * 2.0 + (bh1 - 0.5) * 0.1);
        else if (a < 49.5) s.x = fract(vUv.x + sp * inten * 2.0);
        else if (a < 50.5) s.x = fract(vUv.x - sp * inten * 2.0);
        else if (a < 51.5) s.y = fract(vUv.y + sp * inten * 2.0);
        else s.y = fract(vUv.y - sp * inten * 2.0);
        vec3 sc = texture2D(tPrev, clamp(s, 0.0, 1.0)).rgb;
        float sm = act * clamp(amount, 0.0, 1.0) * clamp(blend * 1.5, 0.0, 1.0);
        gl_FragColor = vec4(mix(orig.rgb, sc, sm), orig.a);
        return;
    } else { // Sin / cos / oscillate / tapered families
        float midx = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float midy = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float outx = abs(vUv.x - 0.5) * 2.0;
        float outy = abs(vUv.y - 0.5) * 2.0;
        float sx = sin(bid.y * 0.45 + t * (2.0 + speed * 2.0));
        float sy = sin(bid.x * 0.45 - t * (2.0 + speed * 2.0));
        float cx = cos(bid.y * 0.4 - t * 2.5);
        float cy = cos(bid.x * 0.4 + t * 2.5);
        if (a < 53.5) v = vec2(sx, cy) * inten * 1.8;                        // Sin and cos
        else if (a < 54.5) v = vec2(sx * midx, 0.0) * inten * 2.4;            // Middle sin X
        else if (a < 55.5) v = vec2(sx * midx, (bh2 - 0.5) * inten) * inten;  // Middle sin X no Y
        else if (a < 56.5) v = vec2(0.0, sy * midy) * inten * 2.4;            // Middle sin Y
        else if (a < 57.5) v = vec2((bh1 - 0.5) * inten, sy * midy) * inten;  // Middle sin Y no X
        else if (a < 58.5) v = vec2(sx * outx, 0.0) * inten * 2.4;            // Outside sin X
        else if (a < 59.5) v = vec2(sx * outx, (bh2 - 0.5) * inten);
        else if (a < 60.5) v = vec2(0.0, sy * outy) * inten * 2.4;            // Outside sin Y
        else if (a < 61.5) v = vec2((bh1 - 0.5) * inten, sy * outy);
        else if (a < 62.5) v = vec2(sx * outx * 0.5, 0.0) * inten * 2.4;      // Outside half sin X
        else if (a < 63.5) v = vec2(sx * outx * 0.5, (bh2 - 0.5) * inten);
        else if (a < 64.5) v = vec2(0.0, sy * outy * 0.5) * inten * 2.4;      // Outside half sin Y
        else if (a < 65.5) v = vec2((bh1 - 0.5) * inten, sy * outy * 0.5);
        else if (a < 66.5) v = vec2(sin(t * 4.0 + bid.y * 0.3), 0.0) * inten * 2.2; // Oscillate sin X
        else if (a < 67.5) v = vec2(sin(t * 4.0 + bid.y * 0.3), (bh2 - 0.5)) * inten * 1.6;
        else if (a < 68.5) v = vec2(0.0, sin(t * 4.0 + bid.x * 0.3)) * inten * 2.2; // Oscillate sin Y
        else if (a < 69.5) v = vec2((bh1 - 0.5), sin(t * 4.0 + bid.x * 0.3)) * inten * 1.6;
        else if (a < 70.5) v = vec2(sin(t * 4.0 + bid.y * 0.3), sin(t * 4.0 + bid.x * 0.3)) * inten * 2.0;
        else if (a < 73.5) { // tapered V1 (right / left / horizontal)
            float taper = (a < 71.5) ? smoothstep(0.0, 1.0, vUv.x) : (a < 72.5 ? smoothstep(1.0, 0.0, vUv.x) : sin(vUv.x * 3.14159));
            v = vec2(sx * taper, 0.0) * inten * 2.6;
        } else if (a < 77.5) { // tapered V2 + V3
            float taper2 = (a < 74.5) ? smoothstep(0.0, 1.0, vUv.x) : (a < 75.5 ? smoothstep(1.0, 0.0, vUv.x) : (a < 76.5 ? (0.5 + 0.5 * sin(vUv.x * 6.2831)) : sin(vUv.x * 3.14159)));
            if (a > 76.5) taper2 = sin(vUv.x * 3.14159) * (0.6 + 0.4 * sin(t * 2.0));
            v = vec2(sx * taper2 * 1.4, cy * 0.25 * taper2) * inten * 2.4;
        } else if (a < 78.5) v = vec2(cx, sy) * inten * 1.8;                  // Cos X & sin Y
        else v = vec2(sx, cy) * inten * 1.8;                                  // Sin X & cos Y
    }

    // taps for Average / Add-previous families + neighbor blur width
    float taps = 1.0;
    float addMix = 0.0;
    float neigh = 0.0;
    if (a > 28.5 && a < 29.5) { taps = 2.0; }
    else if (a >= 29.5 && a < 30.5) { taps = 2.0; }
    else if (a >= 30.5 && a < 31.5) { taps = 3.0; }
    else if (a >= 31.5 && a < 32.5) { taps = 5.0; }
    else if (a >= 32.5 && a < 33.5) { taps = 10.0; }
    else if (a >= 33.5 && a < 34.5) { taps = 15.0; }
    else if (a >= 34.5 && a < 35.5) { neigh = 1.0; }
    else if (a >= 35.5 && a < 36.5) { neigh = 2.0; }
    else if (a >= 36.5 && a < 37.5) { neigh = 3.0; }
    else if (a >= 37.5 && a < 38.5) { neigh = 4.0; }
    else if (a >= 38.5 && a < 39.5) { taps = 3.0; addMix = 0.35; }
    else if (a >= 39.5 && a < 40.5) { taps = 5.0; addMix = 0.35; }
    else if (a >= 40.5 && a < 41.5) { taps = 10.0; addMix = 0.35; }

    vec2 suv = vUv - v * act * 0.05;
    suv = clamp(suv, 0.0, 1.0);
    // macroblock pixelation: quantize the history fetch (the blocky logo look)
    vec2 q = floor(suv * resolution / bs) * bs / resolution + (bs * 0.5) / resolution;
    vec3 mosh = texture2D(tPrev, clamp(q, 0.0, 1.0)).rgb;
    // multi-tap smear along the vector (average previous N)
    for (int i = 1; i < 15; i++) {
        if (float(i) >= taps) break;
        vec2 tp = suv - v * act * 0.05 * float(i) / max(taps - 1.0, 1.0);
        tp = clamp(tp, 0.0, 1.0);
        vec2 tq = floor(tp * resolution / bs) * bs / resolution + (bs * 0.5) / resolution;
        vec3 ts = texture2D(tPrev, clamp(tq, 0.0, 1.0)).rgb;
        mosh = mix(mosh, ts, 1.0 / (float(i) + 1.0));
    }
    if (addMix > 0.001) mosh = clamp(mosh + orig.rgb * addMix, 0.0, 1.0);
    if (neigh > 0.5) {
        vec2 npx = neigh / resolution;
        vec3 acc = mosh;
        acc += texture2D(tPrev, clamp(q + vec2(npx.x, 0.0), 0.0, 1.0)).rgb;
        acc += texture2D(tPrev, clamp(q - vec2(npx.x, 0.0), 0.0, 1.0)).rgb;
        acc += texture2D(tPrev, clamp(q + vec2(0.0, npx.y), 0.0, 1.0)).rgb;
        acc += texture2D(tPrev, clamp(q - vec2(0.0, npx.y), 0.0, 1.0)).rgb;
        mosh = acc / 5.0;
    }
    // acceleration stretch: drag extra history for soupier trails
    vec3 stretched = texture2D(tPrev, clamp(q - v * act * 0.05 * acceleration, 0.0, 1.0)).rgb;
    mosh = mix(mosh, stretched, clamp(acceleration * 0.45, 0.0, 0.8));

    float m = act * clamp(blend, 0.0, 1.0) * 1.4 * clamp(amount, 0.0, 1.0);
    m = clamp(m, 0.0, 1.0);
    vec3 col = mix(orig.rgb, mosh, m);
    // faint compression noise so flat areas still boil like bad P-frames
    col += (dhash(floor(vUv * resolution) + vec2(sF, sF * 1.7)) - 0.5) * 0.02 * m;
    gl_FragColor = vec4(col, orig.a);
}
`;

const DATAMOSH_COPY_SHADER = `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
}
`;

if (!THREE.DatamoshPass) {
    THREE.DatamoshPass = function () {
        THREE.Pass.call(this);
        this.resolution = new THREE.Vector2(2, 2);
        this.uniforms = {
            uvScale: { type: "v2", value: new THREE.Vector2(1, 1) }
        };
        this.moshUniforms = {
            tDiffuse: { type: "t", value: null },
            tPrev: { type: "t", value: null },
            resolution: { type: "v2", value: this.resolution },
            uvScale: this.uniforms.uvScale,
            time: { type: "f", value: 0 },
            amount: { type: "f", value: 1 },
            hasHistory: { type: "f", value: 0 },
            intensity: { type: "f", value: 0.6 },
            acceleration: { type: "f", value: 0.35 },
            blend: { type: "f", value: 0.8 },
            threshold: { type: "f", value: 0.12 },
            blockSize: { type: "f", value: 12 },
            algorithm: { type: "f", value: 0 },
            hold: { type: "f", value: 0 },
            speed: { type: "f", value: 1 }
        };
        this.copyUniforms = { tDiffuse: { type: "t", value: null } };
        var options = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            depthBuffer: false,
            stencilBuffer: false
        };
        this.target = new THREE.WebGLRenderTarget(2, 2, options);
        this.target.texture.generateMipmaps = false;
        this.history = new THREE.WebGLRenderTarget(2, 2, options);
        this.history.texture.generateMipmaps = false;
        this.materialMosh = new THREE.ShaderMaterial({
            uniforms: this.moshUniforms,
            vertexShader: DATAMOSH_VERTEX_SHADER,
            fragmentShader: DATAMOSH_MOSH_SHADER
        });
        this.materialMosh.premultipliedAlpha = true;
        this.materialCopy = new THREE.ShaderMaterial({
            uniforms: this.copyUniforms,
            vertexShader: DATAMOSH_VERTEX_SHADER,
            fragmentShader: DATAMOSH_COPY_SHADER
        });
        this.materialCopy.premultipliedAlpha = true;
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene = new THREE.Scene();
        this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
        this.enabled = true;
        this.needsSwap = true;
        this.initialized = false;
    };
    THREE.DatamoshPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
        constructor: THREE.DatamoshPass,
        setSize: function (e, t) {
            var r = Math.max(2, Math.round(e));
            var i = Math.max(2, Math.round(t));
            this.resolution.set(r, i);
            this.target.setSize(r, i);
            this.history.setSize(r, i);
        },
        setMask: function () {},
        render: function (renderer, writeBuffer, readBuffer, delta, maskActive) {
            var oldAutoClear = renderer.autoClear;
            renderer.autoClear = false;
            var output = writeBuffer || readBuffer;
            this.moshUniforms.tDiffuse.value = readBuffer.texture;
            this.moshUniforms.tPrev.value = this.history.texture;
            this.moshUniforms.hasHistory.value = this.initialized ? 1 : 0;
            this.quad.material = this.materialMosh;
            renderer.render(this.scene, this.camera, this.target, true);
            this.copyUniforms.tDiffuse.value = this.target.texture;
            // show moshed frame
            this.quad.material = this.materialCopy;
            this.copyUniforms.tDiffuse.value = this.target.texture;
            renderer.render(this.scene, this.camera, output, true);
            // feed back into history for next frame (the P-frame chain)
            this.quad.material = this.materialCopy;
            this.copyUniforms.tDiffuse.value = this.target.texture;
            renderer.render(this.scene, this.camera, this.history, true);
            this.initialized = true;
            renderer.autoClear = oldAutoClear;
        },
        dispose: function () {
            this.target.dispose();
            this.history.dispose();
            this.materialMosh.dispose();
            this.materialCopy.dispose();
            this.quad.geometry.dispose();
        }
    });
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
        decimals: decimals
    };
}

this.propertyDefinitions = {
    enabled: {
        dynamic: true,
        name: "Enabled",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
        buttons: [{ name: "Datamosh Setup", title: "Open the Datamosh setup window", action: "datamoshSetup" }]
    },
    time: {
        dynamic: true,
        name: "Time",
        type: PZ.property.type.NUMBER,
        value: 0,
        step: 0.01,
        value: (e) => {
            e.animated = true;
            e.expression = new PZ.expression("time");
        }
    },
    amount: dmoshNum("Amount", 1, 0, 1, 0.01, 2),
    intensity: dmoshNum("Intensity", 0.6, 0, 2, 0.01, 2),
    acceleration: dmoshNum("Acceleration", 0.35, 0, 1, 0.01, 2),
    blend: dmoshNum("Blend", 0.8, 0, 1, 0.01, 2),
    threshold: dmoshNum("Threshold", 0.12, 0, 1, 0.01, 2),
    blockSize: {
        dynamic: true,
        name: "Block Size",
        type: PZ.property.type.NUMBER,
        value: 12,
        min: 2,
        max: 64,
        step: 1,
        decimals: 0
    },
    algorithm: {
        dynamic: false,
        name: "Algorithm",
        type: PZ.property.type.OPTION,
        value: 11,
        items: "Default;Multiply;Add to x and y;Move vertical;Move horizontal;Zoom 1;Zoom 2;Zoom sin;Shear;Experimental;Swap;Random;Random Blocks 1;Random Blocks 2;Random Blocks 3;Random Blocks 4;Spatial;Multiply by X;Multiply by X no Y;Multiply by Y;Multiply by Y no X;Multiply by inverse X;Multiply by inverse X no Y;Multiply by inverse Y;Multiply by inverse Y no X;Multiply by X&Y;Multiply by inverse X&Y;Multiply by X & inverse Y;Multiply by Y & inverse X;Average;Average X and Y;Average previous 3;Average previous 5;Average previous 10;Average previous 15;Average 1 neighbors;Average 2 neighbors;Average 3 neighbors;Average 4 neighbors;Add previous 3;Add previous 5;Add previous 10;Mirror X;Mirror Y;Mirror left;Mirror right;Mirror top;Mirror bottom;Sweep;Sweep horizontal;Sweep horizontal opposite;Sweep vertical;Sweep vertical opposite;Sin and cos;Middle sin X;Middle sin X no Y;Middle sin Y;Middle sin Y no X;Outside sin X;Outside sin X no Y;Outside sin Y;Outside sin Y no X;Outside half sin X;Outside half sin X no Y;Outside half sin Y;Outside half sin Y no X;Oscillate sin X;Oscillate sin X no Y;Oscillate sin Y;Oscillate sin Y no X;Oscillate sin X&Y;Right horizontal sin tapered V1;Left horizontal sin tapered V1;Horizontal sin tapered V1;Right horizontal sin tapered V2;Left horizontal sin tapered V2;Horizontal sin tapered V2;Horizontal sin tapered V3;Cos X & sin Y;Sin X & cos Y"
    },
    hold: dmoshNum("Remove Frames (Hold)", 0.15, 0, 1, 0.01, 2),
    speed: {
        dynamic: true,
        name: "Speed",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 5,
        step: 0.1,
        decimals: 1
    }
};

this.properties.addAll(this.propertyDefinitions, this);

function dmoshClamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
}

this.load = async function (e) {
    this.pass = new THREE.DatamoshPass();
    this.pass.setSize(2, 2);
    this.properties.load(e && e.properties);
};

this.toJSON = function () {
    return { type: this.type, properties: this.properties };
};

this.unload = function (e) {
    if (this.pass) this.pass.dispose();
};

this.update = function (e) {
    if (!this.pass) return;
    var rawT = this.properties.time.get(e);
    var t = Number(rawT);
    if (!isFinite(t)) t = 0;
    var amount = dmoshClamp01(this.properties.amount.get(e));
    var s = this.pass.moshUniforms;
    s.time.value = t;
    s.amount.value = amount;
    var inten = Number(this.properties.intensity.get(e));
    s.intensity.value = isFinite(inten) ? Math.min(2, Math.max(0, inten)) : 0.6;
    s.acceleration.value = dmoshClamp01(this.properties.acceleration.get(e));
    s.blend.value = dmoshClamp01(this.properties.blend.get(e));
    s.threshold.value = dmoshClamp01(this.properties.threshold.get(e));
    var bs = Number(this.properties.blockSize.get(e));
    s.blockSize.value = isFinite(bs) ? Math.min(64, Math.max(2, bs)) : 12;
    var algo = Number(this.properties.algorithm.get(e));
    s.algorithm.value = isFinite(algo) ? Math.max(0, Math.min(79, Math.round(algo))) : 0;
    s.hold.value = dmoshClamp01(this.properties.hold.get(e));
    var sp = Number(this.properties.speed.get(e));
    s.speed.value = isFinite(sp) ? Math.min(5, Math.max(0, sp)) : 1;
    this.pass.enabled = this.properties.enabled.get(e) === 1 && amount !== 0;
};

this.resize = function () {
    if (!this.pass || !this.parentLayer) return;
    var resolution = this.parentLayer.properties.resolution.get();
    this.pass.setSize(resolution[0], resolution[1]);
};
