// Tracery — motion-tracking callout overlay (boxes, markers, spline
// connection lines, arrows, labels, grid) rendered as a canvas overlay
// composited over the layer image. Points are manual track markers the
// user animates (keyframes or wiggle expressions); see effect-windows.js
// for the setup window. Output is a pure function of the properties and the
// input pixels of the current frame; no state survives between renders.
// Split: paths live in tracery-paths.js, region detection in
// tracery-detect.js, overlay drawing in tracery-overlay.js and property
// definitions in tracery-props.js. They load from this plugin's bundle
// through the shared module loader; no runtime fetch is issued.

const traceryEffect = this;

const traceryParts = (function loadTraceryParts() {
    const getAsset = traceryEffect && traceryEffect._zoidiumGetAsset;
    const apis = typeof ZoidiumPluginApis !== "undefined" ? ZoidiumPluginApis : null;
    const createRequire = apis && apis.modules && apis.modules.createRequire;
    if (typeof getAsset !== "function" || typeof createRequire !== "function") {
        throw new Error("Tracery effect needs its bundle parts (this._zoidiumGetAsset and ZoidiumPluginApis.modules.createRequire).");
    }
    const scope = {};
    if (typeof PZ !== "undefined") scope.PZ = PZ;
    if (typeof THREE !== "undefined") scope.THREE = THREE;
    if (typeof document !== "undefined") scope.document = document;
    return createRequire(getAsset, { root: "./plugins/openzoid-legacy/", scope: scope });
}).call(this);

const traceryPathsMod = traceryParts("./effects/tracery-paths.js");
const traceryDetect = traceryParts("./effects/tracery-detect.js");
const traceryOverlay = traceryParts("./effects/tracery-overlay.js");
const traceryProps = traceryParts("./effects/tracery-props.js");

this.defaultName = "Tracery";

// Exposed for unit tests and debugging (the file otherwise only installs
// per-instance members when evaluated as an effect module).
this.traceryPaths = {
    route: traceryPathsMod.trRoutePath,
    clean: traceryPathsMod.trCleanPath,
    point: traceryPathsMod.trPathPoint,
    css: traceryOverlay.trCss,
    draw: traceryOverlay.trDrawOverlay,
    detect: traceryDetect.trDetectRegions,
    region: traceryOverlay.trLayerRegion,
};

this.propertyDefinitions = traceryProps.traceryPropertyDefinitions();

if (this.properties && typeof this.properties.addAll === "function") {
    this.properties.addAll(this.propertyDefinitions, this);
}

// Resolves once the label font is available (see ascii.js for the rationale).
function trFontReady() {
    var fonts = typeof document !== "undefined" ? document.fonts : null;
    if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
    return Promise.resolve(fonts.load("600 20px 'Source Code Pro'")).then(
        function () {},
        function () {}
    );
}

this.load = async function (e) {
    this.pass = new THREE.TraceryPass();
    this.pass.setSize(2, 2);
    this.properties.load(e && e.properties);
    this._fontReady = trFontReady();
    await this._fontReady;
};

this.prepare = async function () {
    if (this._fontReady) await this._fontReady;
};

this.toJSON = function () {
    return { type: this.type, properties: this.properties };
};

this.unload = function (e) {
    if (this.pass && typeof this.pass.dispose === "function") {
        this.pass.dispose();
    }
    this.pass = null;
};

// The state object keeps its identity while its serialized form is
// unchanged, so the overlay canvas is redrawn only when the state changes
// (or when detection, which follows the footage, is enabled).
this.update = function (e) {
    if (!this.pass) {
        return;
    }
    var st;
    try {
        st = traceryOverlay.trCollectState(this.properties, e);
    } catch (err) {
        st = { points: [] };
    }
    var sig = JSON.stringify(st);
    if (sig !== this._overlaySignature || !this._overlayState) {
        this._overlaySignature = sig;
        this._overlayState = st;
    }
    var on = false;
    try {
        on = this.properties.enabled.get(e) === 1;
    } catch (err) {}
    // The effect sits under a small list of effects before its layer.
    var res = null;
    try {
        var owner = this.parent;
        for (var depth = 0; owner && depth < 8 && !(owner.properties && owner.properties.resolution); depth++) {
            owner = owner.parent;
        }
        if (owner) res = owner.properties.resolution.get(e);
    } catch (err) {}
    this.pass.enabled = on;
    this.pass.opacity = 1;
    this.pass.overlayState = this._overlayState;
    this.pass.layerResolution = Array.isArray(res) && res.length >= 2 ? res : null;
};

if (!THREE.TraceryPass) {
    THREE.TraceryPass = function () {
        this.enabled = true;
        this.needsSwap = true;
        this.opacity = 1;
        this.overlayState = null;
        this.drawnState = null;
        this.canvas = null;
        this.canvasTexture = null;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.detectTarget = null;
        this.detectPixels = null;
        this.detectWidth = 0;
        this.detectHeight = 0;
        this.layerResolution = null;
        var material = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { type: "t", value: null },
                tOverlay: { type: "t", value: null },
                uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
                opacity: { type: "f", value: 1 },
                alphaOnly: { type: "f", value: 0 },
            },
            vertexShader: [
                "uniform vec2 uvScale;",
                "varying vec2 vUv;",
                "varying vec2 vUvScaled;",
                "void main() {",
                "    vUv = uv;",
                "    vUvScaled = uv * uvScale;",
                "    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
                "}",
            ].join("\n"),
            fragmentShader: [
                "uniform sampler2D tDiffuse;",
                "uniform sampler2D tOverlay;",
                "uniform float opacity;",
                "uniform float alphaOnly;",
                "varying vec2 vUv;",
                "varying vec2 vUvScaled;",
                "void main() {",
                "    vec4 bg = texture2D(tDiffuse, vUvScaled);",
                // The overlay covers exactly the layer frame, so it is sampled unscaled.
                "    vec4 ov = texture2D(tOverlay, vUv);",
                "    float a = clamp(ov.a * opacity, 0.0, 1.0);",
                "    vec3 rgb = mix(mix(bg.rgb, ov.rgb, a), ov.rgb, alphaOnly);",
                "    float alpha = mix(max(bg.a, a), ov.a, alphaOnly);",
                "    gl_FragColor = vec4(rgb, alpha);",
                "}",
            ].join("\n"),
        });
        material.transparent = true;
        this.material = material;
        this.uniforms = material.uniforms;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene.add(this.camera);
        this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), material);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
        var detectMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { type: "t", value: null },
                keyColor: { type: "v3", value: new THREE.Vector3(1, 1, 1) },
                blurR: { type: "f", value: 0 },
                texel: { type: "v2", value: new THREE.Vector2(1 / 64, 1 / 64) },
                uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
            },
            vertexShader: [
                "varying vec2 vUv;",
                "void main() {",
                "    vUv = uv;",
                "    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
                "}",
            ].join("\n"),
            fragmentShader: [
                "uniform sampler2D tDiffuse;",
                "uniform vec3 keyColor;",
                "uniform float blurR;",
                "uniform vec2 texel;",
                "uniform vec2 uvScale;",
                "varying vec2 vUv;",
                "void main() {",
                "    vec3 acc = vec3(0.0);",
                "    float n = 0.0;",
                "    for (int i = -8; i <= 8; i++) {",
                "        for (int j = -8; j <= 8; j++) {",
                "            float fi = float(i);",
                "            float fj = float(j);",
                "            if (abs(fi) <= blurR && abs(fj) <= blurR) {",
                "                acc += texture2D(tDiffuse, (vUv + vec2(fi, fj) * texel) * uvScale).rgb;",
                "                n += 1.0;",
                "            }",
                "        }",
                "    }",
                "    vec3 avg = acc / max(n, 1.0);",
                "    float d = distance(avg, keyColor);",
                "    float strength = clamp(1.0 - d / 1.5, 0.0, 1.0);",
                "    gl_FragColor = vec4(strength, strength, strength, 1.0);",
                "}",
            ].join("\n"),
        });
        this.detectMaterial = detectMaterial;
        this.detectUniforms = detectMaterial.uniforms;
    };
    THREE.TraceryPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
        constructor: THREE.TraceryPass,
        setSize: function (e, t) {},
        detectSizes: function () {
            return [[64, 36], [128, 72], [192, 108], [320, 180]];
        },
        render: function (renderer, writeBuffer, readBuffer) {
            var w = readBuffer ? readBuffer.width : 0;
            var h = readBuffer ? readBuffer.height : 0;
            if (!w || !h) return;
            var region = traceryOverlay.trLayerRegion(w, h, this.uniforms.uvScale.value, this.layerResolution);
            var lw = region.width;
            var lh = region.height;
            if (!this.canvas || this.canvasWidth !== lw || this.canvasHeight !== lh) {
                this.canvas = document.createElement("canvas");
                this.canvas.width = lw;
                this.canvas.height = lh;
                this.canvasWidth = lw;
                this.canvasHeight = lh;
                if (this.canvasTexture) this.canvasTexture.dispose();
                this.canvasTexture = new THREE.CanvasTexture(this.canvas);
                // Without mipmaps a non-power-of-two canvas is uploaded at its own
                // size instead of being resampled, so thin strokes keep their position.
                this.canvasTexture.generateMipmaps = false;
                this.canvasTexture.minFilter = THREE.LinearFilter;
                this.drawnState = null;
            }
            var st = this.overlayState;
            var detect = !!(st && st.detectEnable);
            var regions = detect ? this.detectRegions(renderer, readBuffer, st, region) || [] : [];
            // Detected regions follow the footage, so detection redraws every frame.
            if (st && (detect || st !== this.drawnState)) {
                try {
                    var ctx = this.canvas.getContext("2d");
                    var drawState = st;
                    if (regions.length) {
                        var merged = [];
                        for (var m = 0; m < st.points.length; m++) merged.push(st.points[m]);
                        for (var r = 0; r < regions.length; r++) merged.push(regions[r]);
                        drawState = {};
                        for (var k in st) {
                            if (Object.prototype.hasOwnProperty.call(st, k)) {
                                drawState[k] = st[k];
                            }
                        }
                        drawState.points = merged;
                    }
                    traceryOverlay.trDrawOverlay(ctx, lw, lh, drawState);
                    this.canvasTexture.needsUpdate = true;
                    this.drawnState = st;
                } catch (err) {
                    var message = String((err && err.stack) || err).slice(0, 300);
                    if (message !== this.lastError) {
                        this.lastError = message;
                        console.error("[Zoidium] Tracery overlay failed:", message);
                    }
                }
            }
            this.uniforms.tDiffuse.value = readBuffer.texture;
            if (st && st.showMask && st.detectEnable && this.detectTarget) {
                this.uniforms.tOverlay.value = this.detectTarget.texture;
            } else {
                this.uniforms.tOverlay.value = this.canvasTexture ? this.canvasTexture : null;
            }
            this.uniforms.opacity.value = this.opacity;
            this.uniforms.alphaOnly.value = st && st.alphaLayer ? 1 : 0;
            var oldAutoClear = renderer.autoClear;
            renderer.autoClear = false;
            renderer.render(this.scene, this.camera, writeBuffer || readBuffer, true);
            renderer.autoClear = oldAutoClear;
        },
        detectRegions: function (renderer, readBuffer, st, region) {
            var sizes = this.detectSizes();
            var q = Math.max(0, Math.min(3, st.detectionQuality || 0));
            var dw = sizes[q][0];
            var dh = sizes[q][1];
            if (!this.detectTarget || this.detectWidth !== dw || this.detectHeight !== dh) {
                if (this.detectTarget) this.detectTarget.dispose();
                this.detectTarget = new THREE.WebGLRenderTarget(dw, dh, {
                    minFilter: THREE.LinearFilter,
                    magFilter: THREE.LinearFilter,
                    format: THREE.RGBAFormat,
                    depthBuffer: false,
                    stencilBuffer: false,
                });
                this.detectWidth = dw;
                this.detectHeight = dh;
                this.detectPixels = new Uint8Array(dw * dh * 4);
            }
            var oldMat = this.quad.material;
            this.detectUniforms.tDiffuse.value = readBuffer.texture;
            this.detectUniforms.keyColor.value.set(st.keyColor[0], st.keyColor[1], st.keyColor[2]);
            this.detectUniforms.blurR.value = Math.max(0, Math.min(8, st.blurStrength));
            this.detectUniforms.texel.value.set(1 / dw, 1 / dh);
            this.detectUniforms.uvScale.value.set(region.sx, region.sy);
            this.quad.material = this.detectMaterial;
            var oldAutoClear = renderer.autoClear;
            renderer.autoClear = false;
            renderer.render(this.scene, this.camera, this.detectTarget, true);
            renderer.autoClear = oldAutoClear;
            this.quad.material = oldMat;
            renderer.readRenderTargetPixels(this.detectTarget, 0, 0, dw, dh, this.detectPixels);
            // Match strengths live in R; flip rows to top-down for labeling.
            var grid = new Uint8Array(dw * dh);
            for (var y = 0; y < dh; y++) {
                for (var x = 0; x < dw; x++) {
                    grid[y * dw + x] = this.detectPixels[((dh - 1 - y) * dw + x) * 4];
                }
            }
            var minArea = Math.max(4, Math.round((dw * dh) / 4000));
            var found = traceryDetect.trDetectRegions(grid, dw, dh, st.threshold, minArea, 24);
            var S = region.height / 1080;
            var pts = [];
            for (var i = 0; i < found.length; i++) {
                (function (g, n) {
                    var bw = Math.max(8, (g.maxX - g.minX + 1) * (region.width / dw));
                    var bh = Math.max(8, (g.maxY - g.minY + 1) * (region.height / dh));
                    pts.push({
                        enable: true,
                        x: ((g.minX + g.maxX + 1) / 2 / dw) * 100,
                        y: ((g.minY + g.maxY + 1) / 2 / dh) * 100,
                        size: Math.max(bw, bh) / S,
                        label: "",
                        labelDX: (n % 3 - 1) * 180,
                        labelDY: n % 2 ? 90 : -90,
                    });
                })(found[i], i);
            }
            return pts;
        },
        dispose: function () {
            if (this.canvasTexture) this.canvasTexture.dispose();
            this.canvasTexture = null;
            this.canvas = null;
            if (this.detectTarget) this.detectTarget.dispose();
            this.detectTarget = null;
            this.detectPixels = null;
            if (this.material) this.material.dispose();
            if (this.detectMaterial) this.detectMaterial.dispose();
            if (this.quad) this.quad.geometry.dispose();
        },
    });
}

