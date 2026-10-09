// Camera+ depth of field: a per-scene post pass over a perspective camera.
//
// The scene is rendered twice into offscreen targets (color, then packed
// depth). A single full-screen pass then gathers a disc of samples whose
// radius follows the distance from the focus plane. The output depends only
// on the current scene render and the configured uniforms, so it is a pure
// function of the project state at time t.
//
// Evaluated with (PZ, THREE, parts) by camera-runtime.js; publishes parts.dof.
parts.dof = (function () {
  const VERTEX_SHADER = [
    "uniform vec2 uvScale;",
    "varying vec2 vUv;",
    "varying vec2 vUvScaled;",
    "void main() {",
    "    vUv = uv;",
    "    vUvScaled = uv * uvScale;",
    "    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
    "}",
  ].join("\n");

  const FRAGMENT_SHADER = [
    "uniform sampler2D tColor;",
    "uniform sampler2D tDepth;",
    "uniform vec2 resolution;",
    "uniform float near;",
    "uniform float far;",
    "uniform float aperture;",
    "uniform float focusDistance;",
    "uniform float focusAreaWidth;",
    "uniform float nearBlurLevel;",
    "uniform float farBlurLevel;",
    "varying vec2 vUvScaled;",
    "const float UnpackDownscale = 255. / 256.;",
    "const vec3 PackFactors = vec3( 256. * 256. * 256., 256. * 256., 256. );",
    "const vec4 UnpackFactors = UnpackDownscale / vec4( PackFactors, 1. );",
    "float unpackDepth( const in vec4 rgba ) {",
    "    return dot( rgba, UnpackFactors );",
    "}",
    "float linearizeDepth( const in float depth ) {",
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
  ].join("\n");

  function createSceneDofClass(THREE) {
    function SceneDof() {
      this.enabled = false;
      this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      this.material = new THREE.ShaderMaterial({
        uniforms: {
          tColor: { type: "t", value: null },
          tDepth: { type: "t", value: null },
          resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
          uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
          near: { type: "f", value: 0.1 },
          far: { type: "f", value: 5000 },
          aperture: { type: "f", value: 0 },
          focusDistance: { type: "f", value: 80 },
          focusAreaWidth: { type: "f", value: 0 },
          nearBlurLevel: { type: "f", value: 1 },
          farBlurLevel: { type: "f", value: 1 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
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
    }

    SceneDof.prototype.configure = function (settings) {
      const u = this.material.uniforms;
      u.near.value = settings.near;
      u.far.value = settings.far;
      u.aperture.value = settings.aperture;
      u.focusDistance.value = settings.focusDistance;
      u.focusAreaWidth.value = settings.focusAreaWidth;
      u.nearBlurLevel.value = settings.nearBlurLevel;
      u.farBlurLevel.value = settings.farBlurLevel;
    };

    SceneDof.prototype.setSize = function (width, height) {
      if (this.colorTarget && this.colorTarget.width === width && this.colorTarget.height === height) return;
      if (this.colorTarget) this.colorTarget.dispose();
      if (this.depthTarget) this.depthTarget.dispose();
      this.colorTarget = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
      });
      this.depthTarget = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
      });
    };

    // renderer: WebGL renderer; target: the pass output target; scene/camera:
    // the RenderPass inputs; viewport: target viewport; forceClear: as in
    // THREE.RenderPass.
    SceneDof.prototype.render = function (renderer, target, scene, camera, viewport, forceClear) {
      this.setSize(target.width, target.height);
      this.colorTarget.viewport.copy(viewport);
      this.depthTarget.viewport.copy(viewport);
      renderer.render(scene, camera, this.colorTarget, forceClear);
      scene.overrideMaterial = this.depthMaterial;
      renderer.render(scene, camera, this.depthTarget, forceClear);
      scene.overrideMaterial = null;
      this.material.uniforms.tColor.value = this.colorTarget.texture;
      this.material.uniforms.tDepth.value = this.depthTarget.texture;
      this.material.uniforms.resolution.value.set(viewport.z, viewport.w);
      this.material.uniforms.uvScale.value.set(viewport.z / target.width, viewport.w / target.height);
      renderer.render(this.scene, this.camera, target, forceClear);
    };

    SceneDof.prototype.unload = function () {
      if (this.colorTarget) this.colorTarget.dispose();
      if (this.depthTarget) this.depthTarget.dispose();
      this.colorTarget = null;
      this.depthTarget = null;
      if (this.material) this.material.dispose();
      if (this.depthMaterial) this.depthMaterial.dispose();
      this.enabled = false;
    };

    return SceneDof;
  }

  return { createSceneDofClass: createSceneDofClass };
})();
