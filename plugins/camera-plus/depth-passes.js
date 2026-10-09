// Camera+ — depth compositing passes (extracted verbatim from the OpenZoid core).
PZ.compositor.prototype.renderSceneDepth = function (e, t, s, n) {
        if (!this.sceneDepthBuffer || !e.pass || !e.pass.camera) return;
        let cam = e.pass.camera;
        this.sceneDepthBuffer.viewport.set(0, 0, s, n);
        e.threeObj.overrideMaterial = this.sceneDepthMaterial;
        this.renderer.render(e.threeObj, cam, this.sceneDepthBuffer, true);
        e.threeObj.overrideMaterial = null;
        this.sceneDepthNear = cam.near;
        this.sceneDepthFar = cam.far;
        this.sceneDepthOrtho = cam.isOrthographicCamera ? 1 : 0;
        this.sceneDepthReady = true;
    
};
PZ.compositor.prototype.compositeDepth = function (e, t, o, p) {
        if (!this.depthBuffer || e instanceof PZ.layer.composite) return;
        if (!e.properties || !e.properties.depth || !e.composite.quad.material || !e.composite.quad.material.uniforms) return;
        let oldMat = e.composite.quad.material;
        if (!this.depthBlendMaterial || this.depthBlendMaterial.vertexShader !== oldMat.vertexShader) {
            if (this.depthBlendMaterial) this.depthBlendMaterial.dispose();
            this.depthBlendMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    tDiffuse: { type: "t", value: null },
                    tSceneDepth: { type: "t", value: null },
                    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
                    opacity: { type: "f", value: 1 },
                    depthValue: { type: "f", value: 0 },
                    baseDepth: { type: "f", value: 0 },
                    dofNear: { type: "f", value: 0 },
                    dofFar: { type: "f", value: 1000 },
                    use3D: { type: "f", value: 0 },
                    camNear: { type: "f", value: 0.1 },
                    camFar: { type: "f", value: 5e3 },
                    camOrtho: { type: "f", value: 0 },
                },
                vertexShader: oldMat.vertexShader,
                fragmentShader: [
                    "uniform sampler2D tDiffuse;",
                    "uniform sampler2D tSceneDepth;",
                    "uniform vec2 uvScale;",
                    "uniform float opacity;",
                    "uniform float depthValue;",
                    "uniform float baseDepth;",
                    "uniform float dofNear;",
                    "uniform float dofFar;",
                    "uniform float use3D;",
                    "uniform float camNear;",
                    "uniform float camFar;",
                    "uniform float camOrtho;",
                    "varying vec2 vUv;",
                    "varying vec2 vUvScaled;",
                    "varying vec2 bgCoord;",
                    "const float UnpackDownscale = 255. / 256.;",
                    "const vec3 PackFactors = vec3( 256. * 256. * 256., 256. * 256., 256. );",
                    "const vec4 UnpackFactors = UnpackDownscale / vec4( PackFactors, 1. );",
                    "float unpackDepth( const in vec4 rgba ) {",
                    "    return dot( rgba, UnpackFactors );",
                    "}",
                    "void main() {",
                    "    vec4 texel = texture2D( tDiffuse, vUvScaled );",
                    "    float coverage = clamp( texel.a * opacity, 0.0, 1.0 );",
                    "    float normalized = depthValue;",
                    "    if ( use3D > 0.5 ) {",
                    "        float nd = unpackDepth( texture2D( tSceneDepth, vUvScaled ) );",
                    "        float dist;",
                    "        if ( camOrtho > 0.5 ) {",
                    "            dist = camNear + ( camFar - camNear ) * nd;",
                    "        } else {",
                    "            dist = ( camNear * camFar ) / max( camFar - ( camFar - camNear ) * nd, 0.0001 );",
                    "        }",
                    "        float range = dofFar - dofNear;",
                    "        normalized = range != 0.0 ? clamp( ( baseDepth + dist - dofNear ) / range, 0.0, 1.0 ) : 0.5;",
                    "    }",
                    "    gl_FragColor = vec4( normalized * coverage, normalized * coverage, normalized * coverage, coverage );",
                    "}",
                ].join("\n"),
                premultipliedAlpha: true,
                transparent: true,
                depthTest: false,
                depthWrite: false,
            });
        }
        let op = oldMat.uniforms.opacity ? oldMat.uniforms.opacity.value : 1;
        e.composite.quad.material = this.depthBlendMaterial;
        let depth = 0;
        try {
            depth = e.properties.depth.get();
        } catch (_depthErr) {
            return;
        }
        let seq = this._sequence ? this._sequence.properties : null;
        const safeGet = function (prop, fallback) {
            try {
                if (prop && typeof prop.get === "function") {
                    const v = prop.get();
                    if (typeof v === "number" && isFinite(v)) return v;
                }
            } catch (_getErr) { /* fall through */ }
            return fallback;
        };
        let near = seq && seq.dofNear ? safeGet(seq.dofNear, 0) : 0;
        let far = seq && seq.dofFar ? safeGet(seq.dofFar, 1000) : 1000;
        let range = far - near;
        let normalizedDepth = 0 !== range ? Math.max(0, Math.min(1, (depth - near) / range)) : 0.5;
        let use3D = e instanceof PZ.layer.scene && this.sceneDepthReady ? 1 : 0;
        let u = this.depthBlendMaterial.uniforms;
        u.tDiffuse.value = this.readBuffer.texture;
        u.tSceneDepth.value = this.sceneDepthBuffer ? this.sceneDepthBuffer.texture : null;
        u.opacity.value = op;
        u.uvScale.value.set(o || 1, p || 1);
        u.depthValue.value = normalizedDepth;
        u.baseDepth.value = depth;
        u.dofNear.value = near;
        u.dofFar.value = far;
        u.use3D.value = use3D;
        u.camNear.value = this.sceneDepthNear;
        u.camFar.value = this.sceneDepthFar;
        u.camOrtho.value = this.sceneDepthOrtho;
        this.scene.add(e.composite.group);
        this.scene.background = null;
        this.depthBuffer.viewport.set(0, 0, t.width, t.height);
        let autoClear = this.renderer.autoClear;
        this.renderer.autoClear = false;
        this.renderer.render(this.scene, this.camera, this.depthBuffer, false);
        this.renderer.autoClear = autoClear;
        this.scene.remove(e.composite.group);
        e.composite.quad.material = oldMat;
    
};
