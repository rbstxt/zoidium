// OpenZoid Legacy — Echo (Legacy).
// Ported from the OpenZoid effect/echo.js rolling history-buffer implementation.
// Behavior is preserved exactly; it is intentionally distinct from Native FX
// Echo, which re-evaluates explicit earlier frames instead of playback history.
// Zoidium adaptation: shaders resolve from the plugin bundle via
// this._zoidiumGetAsset, with fallback to the CM3 asset pipeline.
this.defaultName = "Echo (Legacy)";
this.shaderfile = "fx_echo";
this.shaderUrl = "/assets/shaders/fragment/" + this.shaderfile + ".glsl";
this.vertShader = this.parentProject.assets.createFromPreset(
    PZ.asset.type.SHADER,
    "/assets/shaders/vertex/common.glsl"
);
this.fragShader = this.parentProject.assets.createFromPreset(
    PZ.asset.type.SHADER,
    this.shaderUrl
);

var ECHO_MAX = 100;

this.propertyDefinitions = {
    enabled: {
        dynamic: true,
        name: "Enabled",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
    },
    mode: {
        name: "Mode",
        type: PZ.property.type.OPTION,
        value: 1,
        changed: function () {
            let e = this.parentObject;
            if (e && e.pass && e.pass.stepMaterial) {
                e.pass.stepMaterial.defines.ECHO_MODE = this.value;
                e.pass.stepMaterial.needsUpdate = true;
            }
        },
        items: "smear;maximum;additive;screen",
    },
    echoes: {
        dynamic: true,
        name: "Number of Echoes",
        type: PZ.property.type.NUMBER,
        value: 6,
        min: 0,
        max: 100,
        step: 1,
        decimals: 0,
    },
    decay: {
        dynamic: true,
        name: "Decay",
        type: PZ.property.type.NUMBER,
        value: 0.88,
        min: 0,
        max: 0.99,
        step: 0.01,
        decimals: 3,
    },
    strength: {
        dynamic: true,
        name: "Strength",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 3,
    },
    threshold: {
        dynamic: true,
        name: "Threshold",
        type: PZ.property.type.NUMBER,
        value: 0,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 3,
    },
    clearOnJump: {
        name: "Clear On Jump",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
    },
};

this.properties.addAll(this.propertyDefinitions, this);

if (!THREE.EchoPass) {
    THREE.EchoPass = function (stepMaterial, maxEchoes) {
        THREE.Pass.call(this);
        this.stepMaterial = stepMaterial;
        this.uniforms = stepMaterial.uniforms;
        this.maxEchoes = maxEchoes || 100;
        this.slotOptions = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            depthBuffer: false,
            stencilBuffer: false,
        };
        this.slots = [];
        this.tmpA = new THREE.WebGLRenderTarget(2, 2, this.slotOptions);
        this.tmpA.texture.generateMipmaps = false;
        this.tmpB = new THREE.WebGLRenderTarget(2, 2, this.slotOptions);
        this.tmpB.texture.generateMipmaps = false;
        this.head = 0;
        this.valid = 0;
        this.width = 2;
        this.height = 2;
        this.decayVal = 0.88;
        this.strengthVal = 1;
        this.echoCount = 6;
        this.blank = new THREE.DataTexture(
            new Uint8Array([0, 0, 0, 0]),
            1,
            1
        );
        this.blank.needsUpdate = true;
        var holdVertex = [
            "uniform vec2 uvScale;",
            "varying vec2 vUv;",
            "varying vec2 vUvScaled;",
            "void main() {",
            "vUv = uv;",
            "vUvScaled = uv * uvScale;",
            "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
            "}",
        ].join("\n");
        this.copyUniforms = {
            tDiffuse: { type: "t", value: null },
            uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
        };
        this.copyMaterial = new THREE.ShaderMaterial({
            uniforms: this.copyUniforms,
            vertexShader: holdVertex,
            fragmentShader: [
                "uniform sampler2D tDiffuse;",
                "varying vec2 vUvScaled;",
                "void main() {",
                "gl_FragColor = texture2D( tDiffuse, vUvScaled );",
                "}",
            ].join("\n"),
        });
        this.copyMaterial.premultipliedAlpha = true;
        this.mixUniforms = {
            tDry: { type: "t", value: null },
            tWet: { type: "t", value: null },
            uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
            strength: { type: "f", value: 1 },
        };
        this.mixMaterial = new THREE.ShaderMaterial({
            uniforms: this.mixUniforms,
            vertexShader: holdVertex,
            fragmentShader: [
                "uniform sampler2D tDry;",
                "uniform sampler2D tWet;",
                "uniform float strength;",
                "varying vec2 vUv;",
                "varying vec2 vUvScaled;",
                "void main() {",
                "vec4 dry = texture2D( tDry, vUvScaled );",
                "vec4 wet = texture2D( tWet, vUv );",
                "gl_FragColor = mix( dry, wet, clamp( strength, 0.0, 1.0 ) );",
                "}",
            ].join("\n"),
        });
        this.mixMaterial.premultipliedAlpha = true;
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene = new THREE.Scene();
        this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
        this.enabled = true;
        this.needsSwap = true;
        this.needsClear = false;
        this.holdHistory = false;
    };
    THREE.EchoPass.prototype = Object.assign(
        Object.create(THREE.Pass.prototype),
        {
            constructor: THREE.EchoPass,
            setSize: function (e, t) {
                this.width = Math.max(2, Math.round(e));
                this.height = Math.max(2, Math.round(t));
                for (let i = 0; i < this.slots.length; i++) {
                    this.slots[i].setSize(this.width, this.height);
                }
                this.tmpA.setSize(this.width, this.height);
                this.tmpB.setSize(this.width, this.height);
            },
            ensure: function (count) {
                count = Math.max(0, Math.min(this.maxEchoes, Math.round(count) || 0));
                if (count > this.slots.length) {
                    for (let i = this.slots.length; i < count; i++) {
                        let rt = new THREE.WebGLRenderTarget(
                            this.width,
                            this.height,
                            this.slotOptions
                        );
                        rt.texture.generateMipmaps = false;
                        this.slots.push(rt);
                    }
                    this.valid = 0;
                    this.head = 0;
                }
            },
            tapTexture: function (k) {
                let alloc = this.slots.length;
                if (alloc === 0 || k >= this.valid || k >= alloc) {
                    return this.blank;
                }
                let idx = (this.head - k - 1 + alloc * 4096) % alloc;
                return this.slots[idx].texture;
            },
            syncScales: function () {
                let s = this.uniforms.uvScale.value;
                this.copyUniforms.uvScale.value.copy(s);
                this.mixUniforms.uvScale.value.copy(s);
            },
            pushCurrent: function (renderer, readBuffer) {
                let alloc = this.slots.length;
                if (alloc === 0) {
                    return;
                }
                this.copyUniforms.tDiffuse.value = readBuffer.texture;
                this.quad.material = this.copyMaterial;
                renderer.render(this.scene, this.camera, this.slots[this.head], true);
                this.head = (this.head + 1) % alloc;
                this.valid = Math.min(this.valid + 1, 100000);
            },
            render: function (renderer, writeBuffer, readBuffer, delta, maskActive) {
                let output = writeBuffer || readBuffer;
                let su = this.uniforms;
                if (this.needsClear) {
                    this.valid = 0;
                    this.needsClear = false;
                }
                this.syncScales();
                let alloc = this.slots.length;
                let K = Math.min(this.echoCount, this.valid, alloc);
                let oldAutoClear = renderer.autoClear;
                renderer.autoClear = false;
                if (K <= 0) {
                    this.copyUniforms.tDiffuse.value = readBuffer.texture;
                    this.quad.material = this.copyMaterial;
                    renderer.render(this.scene, this.camera, output, true);
                } else {
                    let decay = Math.min(0.99, Math.max(0, this.decayVal));
                    let wsum = 1.0;
                    let ww = decay;
                    for (let c = 0; c < K; c++) {
                        wsum += ww;
                        ww *= decay;
                    }
                    let w = decay;
                    let prev = null;
                    for (let k = 1; k <= K; k++) {
                        su.tBase.value = k === 1 ? readBuffer.texture : prev.texture;
                        su.useScaledBase.value = k === 1 ? 1 : 0;
                        su.tTap.value = this.tapTexture(k);
                        su.weight.value = w;
                        w *= decay;
                        su.wsum.value = wsum;
                        su.finalize.value = k === K ? 1 : 0;
                        this.quad.material = this.stepMaterial;
                        let dest = k % 2 === 1 ? this.tmpA : this.tmpB;
                        renderer.render(this.scene, this.camera, dest, true);
                        prev = dest;
                    }
                    this.mixUniforms.tDry.value = readBuffer.texture;
                    this.mixUniforms.tWet.value = prev.texture;
                    this.mixUniforms.strength.value = this.strengthVal;
                    this.quad.material = this.mixMaterial;
                    renderer.render(this.scene, this.camera, output, true);
                }
                if (!this.holdHistory) {
                    this.pushCurrent(renderer, readBuffer);
                }
                renderer.autoClear = oldAutoClear;
            },
            dispose: function () {
                for (let i = 0; i < this.slots.length; i++) {
                    this.slots[i].dispose();
                }
                this.slots = [];
                this.tmpA.dispose();
                this.tmpB.dispose();
                this.blank.dispose();
                this.stepMaterial.dispose();
                this.copyMaterial.dispose();
                this.mixMaterial.dispose();
                this.quad.geometry.dispose();
            },
        }
    );
}

function echoClamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
}

this.load = async function (e) {
    // Zoidium bundle adaptation: prefer the plugin-bundled shader text so the
    // effect never fans out into runtime fetches. Falls back to the CM3 asset
    // pipeline when the bundle resolver is unavailable (legacy checkout).
    var zoidiumGetAsset = (typeof this._zoidiumGetAsset === "function")
        ? this._zoidiumGetAsset.bind(this)
        : null;
    var zoidiumBundledVert = zoidiumGetAsset
        ? zoidiumGetAsset("text", "./plugins/openzoid-legacy/shaders/common.glsl")
        : undefined;
    var zoidiumBundledFrag = zoidiumGetAsset
        ? zoidiumGetAsset("text", "./plugins/openzoid-legacy/shaders/" + this.shaderfile + ".glsl")
        : undefined;
    this._zoidiumBundledShaders = {
        vert: typeof zoidiumBundledVert === "string",
        frag: typeof zoidiumBundledFrag === "string",
    };
    this.vertShader = this._zoidiumBundledShaders.vert
        ? { getShader: async function () { return zoidiumBundledVert; } }
        : new PZ.asset.shader(
            this.parentProject.assets.load(this.vertShader)
        );
    this.fragShader = this._zoidiumBundledShaders.frag
        ? { getShader: async function () { return zoidiumBundledFrag; } }
        : new PZ.asset.shader(
            this.parentProject.assets.load(this.fragShader)
        );
    var stepMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tBase: { type: "t", value: null },
            tTap: { type: "t", value: null },
            uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
            weight: { type: "f", value: 0.88 },
            threshold: { type: "f", value: 0 },
            wsum: { type: "f", value: 1 },
            finalize: { type: "f", value: 0 },
            useScaledBase: { type: "f", value: 0 },
        },
        vertexShader: await this.vertShader.getShader(),
        fragmentShader: await this.fragShader.getShader(),
    });
    stepMaterial.premultipliedAlpha = true;
    stepMaterial.defines.ECHO_MODE = 1;
    this.pass = new THREE.EchoPass(stepMaterial, ECHO_MAX);
    this.pass.setSize(2, 2);
    this._lastEchoTime = undefined;
    this.properties.load(e && e.properties);
    try {
        this.pass.stepMaterial.defines.ECHO_MODE = this.properties.mode.get();
        this.pass.stepMaterial.needsUpdate = true;
    } catch (err) {}
};

this.toJSON = function () {
    return { type: this.type, properties: this.properties };
};

this.unload = function (e) {
    if (this.pass) {
        this.pass.dispose();
        this.pass = null;
    }
    // Bundled shader shims are plain objects, not CM3 assets: nothing to unload.
    if (!this._zoidiumBundledShaders || !this._zoidiumBundledShaders.vert) {
        this.parentProject.assets.unload(this.vertShader);
    }
    if (!this._zoidiumBundledShaders || !this._zoidiumBundledShaders.frag) {
        this.parentProject.assets.unload(this.fragShader);
    }
};

this.update = function (e) {
    if (!this.pass) {
        return;
    }
    let strength = echoClamp01(this.properties.strength.get(e));
    let echoes = Math.max(
        0,
        Math.min(ECHO_MAX, Math.round(Number(this.properties.echoes.get(e)) || 0))
    );
    this.pass.uniforms.threshold.value = echoClamp01(
        this.properties.threshold.get(e)
    );
    this.pass.decayVal = Math.min(
        0.99,
        Math.max(0, Number(this.properties.decay.get(e)) || 0)
    );
    this.pass.strengthVal = strength;
    this.pass.echoCount = echoes;
    this.pass.ensure(echoes);
    let on =
        this.properties.enabled.get(e) === 1 &&
        strength > 0.0005 &&
        echoes >= 1;
    this.pass.enabled = on;
    if (!on) {
        this.pass.valid = 0;
        this.pass.needsClear = false;
        this.pass.holdHistory = false;
        this._lastEchoTime = e;
        return;
    }
    let t = Number(e);
    if (isFinite(t)) {
        if (this._lastEchoTime !== undefined) {
            let dt = t - this._lastEchoTime;
            if (dt === 0) {
                this.pass.holdHistory = true;
            } else {
                this.pass.holdHistory = false;
                if (dt < -0.000001 || dt > 10) {
                    try {
                        if (this.properties.clearOnJump.get(e) === 1) {
                            this.pass.needsClear = true;
                        }
                    } catch (err) {
                        this.pass.needsClear = true;
                    }
                }
            }
        } else {
            this.pass.holdHistory = false;
        }
        this._lastEchoTime = t;
    } else {
        this.pass.holdHistory = false;
    }
};

this.resize = function () {
    if (!this.pass || !this.parentLayer) {
        return;
    }
    let resolution = this.parentLayer.properties.resolution.get();
    this.pass.setSize(resolution[0], resolution[1]);
};
