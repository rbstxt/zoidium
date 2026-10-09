// Camera+ — depth-of-field shader and SceneDof pass (extracted verbatim).
THREE.SceneDofShader = {
    vertexShader: [
        "uniform vec2 uvScale;",
        "varying vec2 vUv;",
        "varying vec2 vUvScaled;",
        "void main() {",
        "    vUv = uv;",
        "    vUvScaled = uv * uvScale;",
        "    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
        "}",
    ].join("\n"),
    fragmentShader: [
        "uniform sampler2D tColor;",
        "uniform sampler2D tDepth;",
        "uniform vec2 resolution;",
        "uniform vec2 uvScale;",
        "uniform float near;",
        "uniform float far;",
        "uniform float aperture;",
        "uniform float focusDistance;",
        "uniform float focusAreaWidth;",
        "uniform float nearBlurLevel;",
        "uniform float farBlurLevel;",
        "uniform float orthographic;",
        "varying vec2 vUv;",
        "varying vec2 vUvScaled;",
        "const float UnpackDownscale = 255. / 256.;",
        "const vec3 PackFactors = vec3( 256. * 256. * 256., 256. * 256., 256. );",
        "const vec4 UnpackFactors = UnpackDownscale / vec4( PackFactors, 1. );",
        "float unpackDepth( const in vec4 rgba ) {",
        "    return dot( rgba, UnpackFactors );",
        "}",
        "float linearizeDepth( const in float depth ) {",
        "    if ( orthographic > 0.5 ) {",
        "        return near + ( far - near ) * depth;",
        "    }",
        "    float z = depth * 2.0 - 1.0;",
        "    return ( 2.0 * near * far ) / ( far + near - z * ( far - near ) );",
        "}",
        "float blurAmount( const in float linearDepth ) {",
        "    float halfWidth = focusAreaWidth * max( focusDistance, 1.0 ) / max( resolution.x, 1.0 );",
        "    float dist = linearDepth - focusDistance;",
        "    float over = max( abs( dist ) - halfWidth, 0.0 );",
        "    float level = dist < 0.0 ? nearBlurLevel : farBlurLevel;",
        "    return clamp( over / max( focusDistance, 1.0 ) / 4.0 * level, 0.0, 1.0 );",
        "}",
        "void main() {",
        "    vec2 uv = vUvScaled;",
        "    vec2 texel = 1.0 / max( resolution, vec2( 1.0 ) );",
        "    vec4 centerColor = texture2D( tColor, uv );",
        "    if ( centerColor.a < 0.02 ) {",
        "        gl_FragColor = centerColor;",
        "        return;",
        "    }",
        "    float centerLinear = linearizeDepth( unpackDepth( texture2D( tDepth, uv ) ) );",
        "    float centerBlur = blurAmount( centerLinear );",
        "    float maxRadius = centerBlur * aperture * 0.02 * min( resolution.x, resolution.y );",
        "    maxRadius = min( maxRadius, min( resolution.x, resolution.y ) * 0.05 );",
        "    vec3 accum = centerColor.rgb;",
        "    float totalWeight = 1.0;",
        "    const int SAMPLES = 32;",
        "    for ( int i = 1; i < SAMPLES; i ++ ) {",
        "        float fi = float( i );",
        "        float radius = sqrt( ( fi + 0.5 ) / float( SAMPLES ) );",
        "        float angle = fi * 2.399963229728653;",
        "        vec2 offset = vec2( cos( angle ), sin( angle ) ) * radius * maxRadius * texel;",
        "        vec2 sampleUV = clamp( uv + offset, vec2( 0.0 ), vec2( 1.0 ) );",
        "        vec4 sampleColor = texture2D( tColor, sampleUV );",
        "        float sampleLinear = linearizeDepth( unpackDepth( texture2D( tDepth, sampleUV ) ) );",
        "        float sampleBlur = blurAmount( sampleLinear );",
        "        float weight = sampleColor.a * ( 1.0 - abs( sampleBlur - centerBlur ) );",
        "        weight *= weight;",
        "        accum += sampleColor.rgb * weight;",
        "        totalWeight += weight;",
        "    }",
        "    gl_FragColor = vec4( accum / max( totalWeight, 0.0001 ), centerColor.a );",
        "}",
    ].join("\n"),
};
THREE.SceneDof = function () {
    this.enabled = false;
    this.aperture = 0;
    this.focusDistance = 80;
    this.focusAreaWidth = 0;
    this.nearBlurLevel = 100;
    this.farBlurLevel = 100;
    this.near = 0.1;
    this.far = 5e3;
    this.orthographic = 0;
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.material = new THREE.ShaderMaterial({
        uniforms: {
            tColor: { type: "t", value: null },
            tDepth: { type: "t", value: null },
            resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
            uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
            near: { type: "f", value: 0.1 },
            far: { type: "f", value: 5e3 },
            aperture: { type: "f", value: 0 },
            focusDistance: { type: "f", value: 80 },
            focusAreaWidth: { type: "f", value: 0 },
            nearBlurLevel: { type: "f", value: 1 },
            farBlurLevel: { type: "f", value: 1 },
            orthographic: { type: "f", value: 0 },
        },
        vertexShader: THREE.SceneDofShader.vertexShader,
        fragmentShader: THREE.SceneDofShader.fragmentShader,
    });
    this.material.transparent = true;
    this.material.premultipliedAlpha = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene.add(this.camera);
    this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), this.material);
    this.scene.add(this.quad);
    this.colorTarget = null;
    this.depthTarget = null;
    this.setSize(1, 1);
};
THREE.SceneDof.prototype = {
    setSize: function (e, t) {
        if (this.colorTarget && this.colorTarget.width === e && this.colorTarget.height === t) return;
        if (this.colorTarget) this.colorTarget.dispose();
        if (this.depthTarget) this.depthTarget.dispose();
        var r = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
        var d = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat };
        this.colorTarget = new THREE.WebGLRenderTarget(e, t, r);
        this.depthTarget = new THREE.WebGLRenderTarget(e, t, d);
    },
    render: function (e, t, r, i, a, s) {
        this.setSize(t.width, t.height);
        this.colorTarget.viewport.copy(a);
        this.depthTarget.viewport.copy(a);
        e.render(r, i, this.colorTarget, s);
        r.overrideMaterial = this.depthMaterial;
        e.render(r, i, this.depthTarget, s);
        r.overrideMaterial = null;
        this.material.uniforms.tColor.value = this.colorTarget.texture;
        this.material.uniforms.tDepth.value = this.depthTarget.texture;
        this.material.uniforms.resolution.value.set(a.z, a.w);
        this.material.uniforms.uvScale.value.set(a.z / t.width, a.w / t.height);
        this.material.uniforms.near.value = this.near;
        this.material.uniforms.far.value = this.far;
        this.material.uniforms.aperture.value = this.aperture;
        this.material.uniforms.focusDistance.value = this.focusDistance;
        this.material.uniforms.focusAreaWidth.value = this.focusAreaWidth;
        this.material.uniforms.nearBlurLevel.value = this.nearBlurLevel / 100;
        this.material.uniforms.farBlurLevel.value = this.farBlurLevel / 100;
        this.material.uniforms.orthographic.value = this.orthographic;
        e.render(this.scene, this.camera, t, s);
    },
    unload: function () {
        if (this.colorTarget) (this.colorTarget.dispose(), (this.colorTarget = null));
        if (this.depthTarget) (this.depthTarget.dispose(), (this.depthTarget = null));
        if (this.material) this.material.dispose();
        if (this.depthMaterial) this.depthMaterial.dispose();
    },
};;
