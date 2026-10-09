// OpenZoid Legacy — Posterize Time (Legacy).
// Ported from the OpenZoid effect/posterizetime.js hold-buffer implementation.
// Behavior is preserved exactly; it is intentionally distinct from Native FX
// Posterize Time, which quantizes on a deterministic clock instead of holding
// rendered frames. Zoidium adaptation: shaders resolve from the plugin bundle
// via this._zoidiumGetAsset, with fallback to the CM3 asset pipeline.
this.defaultName = "Posterize Time (Legacy)";
this.shaderfile = "fx_posterizetime";
this.shaderUrl = "/assets/shaders/fragment/" + this.shaderfile + ".glsl";
this.vertShader = this.parentProject.assets.createFromPreset(
    PZ.asset.type.SHADER,
    "/assets/shaders/vertex/common.glsl"
);
this.fragShader = this.parentProject.assets.createFromPreset(
    PZ.asset.type.SHADER,
    this.shaderUrl
);

this.propertyDefinitions = {
    enabled: {
        dynamic: true,
        name: "Enabled",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
    },
    frameRate: {
        dynamic: true,
        name: "Frame Rate",
        type: PZ.property.type.NUMBER,
        value: 8,
        min: 1,
        max: 120,
        step: 1,
        decimals: 2,
    },
};

this.properties.addAll(this.propertyDefinitions, this);

if (!THREE.PosterizeTimePass) {
    THREE.PosterizeTimePass = function (material) {
        THREE.Pass.call(this);
        this.material = material;
        this.uniforms = material.uniforms;
        var options = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            depthBuffer: false,
            stencilBuffer: false,
        };
        this.held = new THREE.WebGLRenderTarget(2, 2, options);
        this.held.texture.generateMipmaps = false;
        this.copyUniforms = {
            tDiffuse: { type: "t", value: null },
        };
        this.copyMaterial = new THREE.ShaderMaterial({
            uniforms: this.copyUniforms,
            vertexShader: [
                "varying vec2 vUv;",
                "void main() {",
                "vUv = uv;",
                "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
                "}",
            ].join("\n"),
            fragmentShader: [
                "uniform sampler2D tDiffuse;",
                "varying vec2 vUv;",
                "void main() {",
                "gl_FragColor = texture2D( tDiffuse, vUv );",
                "}",
            ].join("\n"),
        });
        this.copyMaterial.premultipliedAlpha = true;
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene = new THREE.Scene();
        this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
        this.enabled = true;
        this.needsSwap = true;
        this.initialized = false;
        this.needsCapture = false;
    };
    THREE.PosterizeTimePass.prototype = Object.assign(
        Object.create(THREE.Pass.prototype),
        {
            constructor: THREE.PosterizeTimePass,
            setSize: function (e, t) {
                let r = Math.max(2, Math.round(e));
                let i = Math.max(2, Math.round(t));
                this.held.setSize(r, i);
            },
            render: function (renderer, writeBuffer, readBuffer, delta, maskActive) {
                let output = writeBuffer || readBuffer;
                if (this.needsCapture || !this.initialized) {
                    let oldAutoClear = renderer.autoClear;
                    renderer.autoClear = false;
                    this.copyUniforms.tDiffuse.value = readBuffer.texture;
                    this.quad.material = this.copyMaterial;
                    renderer.render(this.scene, this.camera, this.held, true);
                    renderer.autoClear = oldAutoClear;
                    this.needsCapture = false;
                    this.initialized = true;
                }
                this.uniforms.tHeld.value = this.held.texture;
                let oldAutoClear = renderer.autoClear;
                renderer.autoClear = false;
                this.quad.material = this.material;
                renderer.render(this.scene, this.camera, output, true);
                renderer.autoClear = oldAutoClear;
            },
            dispose: function () {
                this.held.dispose();
                this.material.dispose();
                this.copyMaterial.dispose();
                this.quad.geometry.dispose();
            },
        }
    );
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
    var material = new THREE.ShaderMaterial({
        uniforms: {
            tHeld: { type: "t", value: null },
            uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
        },
        vertexShader: await this.vertShader.getShader(),
        fragmentShader: await this.fragShader.getShader(),
    });
    material.premultipliedAlpha = true;
    this.pass = new THREE.PosterizeTimePass(material);
    this.pass.setSize(2, 2);
    this._lastHoldKey = undefined;
    this.properties.load(e && e.properties);
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
    let on = this.properties.enabled.get(e) === 1;
    if (!on) {
        this.pass.enabled = false;
        this.pass.initialized = false;
        this.pass.needsCapture = false;
        this._lastHoldKey = undefined;
        return;
    }
    this.pass.enabled = true;
    let fps = Number(this.properties.frameRate.get(e));
    if (!isFinite(fps) || fps < 1) {
        fps = 1;
    }
    // Engine time `e` is in project frames, not seconds: quantize against
    // the sequence frame rate so Frame Rate behaves like AE Posterize Time.
    let rate = 30;
    try {
        rate = Number(this.parentProject.sequence.properties.rate.get());
        if (!isFinite(rate) || rate <= 0) {
            rate = 30;
        }
    } catch (err) {
        rate = 30;
    }
    let t = Number(e);
    if (!isFinite(t)) {
        return;
    }
    let key = Math.floor((t * fps) / rate);
    if (this._lastHoldKey === undefined || key !== this._lastHoldKey) {
        this.pass.needsCapture = true;
        this._lastHoldKey = key;
    }
};

this.resize = function () {
    if (!this.pass || !this.parentLayer) {
        return;
    }
    let resolution = this.parentLayer.properties.resolution.get();
    this.pass.setSize(resolution[0], resolution[1]);
};
