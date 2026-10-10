// Camera+ depth of field: a per-scene post pass over the active camera.
//
// The scene is rendered twice into offscreen targets (color, then packed
// depth). Three full-screen passes follow:
//   1. tiles: the largest blur radius inside each 16x16 pixel tile;
//   2. dilate: each tile takes the largest radius of the tiles whose blur can
//      reach it, so a blurred object's spread is known around its outline;
//   3. composite: a deterministic golden-angle disc over that local radius,
//      gathered as scatter (a sample counts when its own blur disc reaches
//      the pixel, weighted by the share of that disc a sample stands for).
//      Samples in front of the pixel form a layer over the pixel's own
//      surface and what lies behind it, so an out-of-focus foreground bleeds
//      past its silhouette over sharper or transparent pixels instead of
//      being clipped at the object's outline, and background blur never
//      spreads over a sharper object in front of it.
// Colors are premultiplied by alpha, like the scene render they replace, so
// a blurred edge over a transparent layer fades out instead of brightening.
// In-focus pixels with nothing blurred nearby pass through untouched. The
// output depends only on the current scene render and the configured
// uniforms, so it is a pure function of the project state at time t.
//
// Evaluated with (PZ, THREE, parts) by camera-runtime.js; publishes parts.dof.
parts.dof = (function () {
  const TILE = 16;
  const DEPTH_LOOKUP = "unpackDepth( texture2D( tDepth, uv ) )";

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

  const COMMON = [
    "uniform sampler2D tColor;",
    "uniform sampler2D tDepth;",
    "uniform vec2 resolution;",
    "uniform vec2 uvScale;",
    "uniform vec2 tileCount;",
    "uniform float orthographic;",
    "uniform float near;",
    "uniform float far;",
    "uniform float aperture;",
    "uniform float focusDistance;",
    "uniform float focusAreaWidth;",
    "uniform float nearBlurLevel;",
    "uniform float farBlurLevel;",
    "const float TILE = " + TILE.toFixed(1) + ";",
    "const float UnpackDownscale = 255. / 256.;",
    "const vec3 PackFactors = vec3( 256. * 256. * 256., 256. * 256., 256. );",
    "const vec4 UnpackFactors = UnpackDownscale / vec4( PackFactors, 1. );",
    "float unpackDepth( const in vec4 rgba ) {",
    "    return dot( rgba, UnpackFactors );",
    "}",
    "float linearizeDepth( const in float depth ) {",
    "    if ( orthographic > 0.5 ) return mix( near, far, depth );",
    "    float z = depth * 2.0 - 1.0;",
    "    return ( 2.0 * near * far ) / ( far + near - z * ( far - near ) );",
    "}",
    // Nothing was drawn where the depth is still cleared to zero.
    "float sceneDepth( const in vec2 uv ) {",
    "    float depth = " + DEPTH_LOOKUP + ";",
    "    return depth <= 0.0 ? far : linearizeDepth( depth );",
    "}",
    "float blurAmount( const in float linearDepth ) {",
    "    float halfWidth = focusAreaWidth * max( focusDistance, 1.0 ) / max( resolution.x, 1.0 );",
    "    float dist = linearDepth - focusDistance;",
    "    float over = max( abs( dist ) - halfWidth, 0.0 );",
    "    float level = dist < 0.0 ? nearBlurLevel : farBlurLevel;",
    "    return clamp( over / max( focusDistance, 1.0 ) / 4.0 * level, 0.0, 1.0 );",
    "}",
    "float maxBlurRadius() {",
    "    float minSide = min( resolution.x, resolution.y );",
    "    return max( min( aperture * 0.02 * minSide, minSide * 0.05 ), 0.0001 );",
    "}",
    // Blur radius in pixels.
    "float blurRadius( const in float linearDepth ) {",
    "    return blurAmount( linearDepth ) * maxBlurRadius();",
    "}",
  ].join("\n");

  // One output pixel per tile: the largest blur radius of its visible pixels,
  // stored as a fraction of the maximum radius.
  const TILE_SHADER = COMMON + "\n" + [
    "void main() {",
    "    vec2 tile = floor( gl_FragCoord.xy );",
    "    float largest = 0.0;",
    "    for ( int y = 0; y < " + TILE + "; y ++ ) {",
    "        for ( int x = 0; x < " + TILE + "; x ++ ) {",
    "            vec2 pixel = tile * TILE + vec2( float( x ), float( y ) ) + 0.5;",
    "            if ( pixel.x > resolution.x || pixel.y > resolution.y ) continue;",
    "            vec2 uv = pixel / resolution * uvScale;",
    "            if ( texture2D( tColor, uv ).a < 0.004 ) continue;",
    "            largest = max( largest, blurRadius( sceneDepth( uv ) ) );",
    "        }",
    "    }",
    "    gl_FragColor = vec4( largest / maxBlurRadius(), 0.0, 0.0, 1.0 );",
    "}",
  ].join("\n");

  // Each tile takes the largest radius among the tiles whose blur reaches it.
  // Eight tiles cover the 5% radius cap up to 4K output.
  const DILATE_SHADER = COMMON + "\n" + [
    "uniform sampler2D tTiles;",
    "void main() {",
    "    vec2 tile = floor( gl_FragCoord.xy );",
    "    float largest = 0.0;",
    "    float scale = maxBlurRadius();",
    "    for ( int y = -8; y <= 8; y ++ ) {",
    "        for ( int x = -8; x <= 8; x ++ ) {",
    "            vec2 other = tile + vec2( float( x ), float( y ) );",
    "            if ( other.x < 0.0 || other.y < 0.0 || other.x >= tileCount.x || other.y >= tileCount.y ) continue;",
    "            float radius = texture2D( tTiles, ( other + 0.5 ) / tileCount ).r * scale;",
    "            float gap = ( max( abs( float( x ) ), abs( float( y ) ) ) - 1.0 ) * TILE;",
    "            if ( gap <= radius ) largest = max( largest, radius );",
    "        }",
    "    }",
    "    gl_FragColor = vec4( largest / scale, 0.0, 0.0, 1.0 );",
    "}",
  ].join("\n");

  const FRAGMENT_SHADER = COMMON + "\n" + [
    "uniform sampler2D tTiles;",
    // Blur under a pixel is invisible; scattering it would only add noise.
    "float visibleRadius( const in float radius ) {",
    "    return radius < 1.0 ? 0.0 : radius;",
    "}",
    "varying vec2 vUv;",
    "varying vec2 vUvScaled;",
    "void main() {",
    "    vec2 uv = vUvScaled;",
    "    vec2 texel = uvScale / max( resolution, vec2( 1.0 ) );",
    "    vec4 centerColor = texture2D( tColor, uv );",
    // Transparent pixels count as far away: nothing there occludes a sample.
    "    bool centerEmpty = centerColor.a < 0.004;",
    "    float centerLinear = centerEmpty ? far : sceneDepth( uv );",
    "    float centerRadius = centerEmpty ? 0.0 : visibleRadius( blurRadius( centerLinear ) );",
    "    vec2 tile = min( floor( vUv * resolution / TILE ), tileCount - 1.0 );",
    "    float maxRadius = max( texture2D( tTiles, ( tile + 0.5 ) / tileCount ).r * maxBlurRadius(), centerRadius );",
    "    if ( maxRadius < 1.0 ) {",
    "        gl_FragColor = centerColor;",
    "        return;",
    "    }",
    "    float frontLimit = centerLinear - max( centerLinear * 0.01, 0.01 );",
    "    float backLimit = centerLinear + max( centerLinear * 0.01, 0.01 );",
    "    const int SAMPLES = 64;",
    "    float share = maxRadius * maxRadius / float( SAMPLES );",
    // The pixel itself: one pixel's share of its own blur disc (all of it
    // when the disc is smaller than a pixel).
    "    vec4 back = centerColor * min( 1.0 / ( 3.14159265 * centerRadius * centerRadius ), 1.0 );",
    "    vec4 front = vec4( 0.0 );",
    // What the pixel's own blurred surface no longer covers shows the
    // surroundings behind it, which the color buffer only has around it:
    // take the nearest of them.
    "    vec4 fill = vec4( 0.0 );",
    "    float fillCount = 0.0;",
    "    float spin = 6.283185307 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );",
    "    for ( int i = 0; i < SAMPLES; i ++ ) {",
    "        float fi = float( i );",
    "        float radius = sqrt( ( fi + 0.5 ) / float( SAMPLES ) ) * maxRadius;",
    "        float angle = fi * 2.399963229728653 + spin;",
    // Snap to texel centers so color and (nearest) depth describe the same
    // pixel.
    "        vec2 sampleUV = clamp( uv + vec2( cos( angle ), sin( angle ) ) * radius * texel, vec2( 0.0 ), uvScale - texel * 0.5 );",
    "        sampleUV = ( floor( sampleUV / texel ) + 0.5 ) * texel;",
    "        vec4 sampleColor = texture2D( tColor, sampleUV );",
    "        float nearness = 1.0 / ( 1.0 + radius * radius );",
    "        if ( sampleColor.a < 0.004 ) {",
    "            fillCount += nearness;",
    "            continue;",
    "        }",
    "        float sampleLinear = sceneDepth( sampleUV );",
    "        float sampleRadius = visibleRadius( blurRadius( sampleLinear ) );",
    "        bool behind = !centerEmpty && sampleLinear > backLimit;",
    "        if ( behind ) {",
    "            fill += sampleColor * nearness;",
    "            fillCount += nearness;",
    // A surface behind the pixel cannot spread over it further than the
    // pixel's own blur.
    "            sampleRadius = min( sampleRadius, centerRadius );",
    "        }",
    "        if ( sampleRadius < radius ) continue;",
    "        vec4 contribution = sampleColor * min( share / max( sampleRadius * sampleRadius, 1.0 ), 1.0 );",
    "        if ( sampleLinear < frontLimit ) front += contribution;",
    "        else back += contribution;",
    "    }",
    "    front /= max( front.a, 1.0 );",
    "    back /= max( back.a, 1.0 );",
    "    back += fill / max( fillCount, 0.0001 ) * ( 1.0 - back.a );",
    "    gl_FragColor = front + back * ( 1.0 - front.a );",
    "}",
  ].join("\n");

  function createSceneDofClass(THREE) {
    function passMaterial(uniforms, fragmentShader) {
      const material = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, uniforms, { tTiles: { type: "t", value: null } }),
        vertexShader: VERTEX_SHADER,
        fragmentShader: fragmentShader,
      });
      material.transparent = false;
      material.depthTest = false;
      material.depthWrite = false;
      return material;
    }

    function SceneDof() {
      this.enabled = false;
      this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      // The passes share the uniform objects, so configure() and the
      // per-render sizes reach all of them.
      const uniforms = {
        tColor: { type: "t", value: null },
        tDepth: { type: "t", value: null },
        resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
        tileCount: { type: "v2", value: new THREE.Vector2(1, 1) },
        orthographic: { type: "f", value: 0 },
        near: { type: "f", value: 0.1 },
        far: { type: "f", value: 5000 },
        aperture: { type: "f", value: 0 },
        focusDistance: { type: "f", value: 80 },
        focusAreaWidth: { type: "f", value: 0 },
        nearBlurLevel: { type: "f", value: 1 },
        farBlurLevel: { type: "f", value: 1 },
      };
      this.tileMaterial = passMaterial(uniforms, TILE_SHADER);
      this.dilateMaterial = passMaterial(uniforms, DILATE_SHADER);
      this.material = passMaterial(uniforms, FRAGMENT_SHADER);
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.scene.add(this.camera);
      this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), this.material);
      this.scene.add(this.quad);
      this.colorTarget = null;
      this.depthTarget = null;
      this.tileTarget = null;
      this.dilateTarget = null;
    }

    SceneDof.prototype.configure = function (settings) {
      const u = this.material.uniforms;
      u.orthographic.value = settings.orthographic ? 1 : 0;
      u.near.value = settings.near;
      u.far.value = settings.far;
      u.aperture.value = settings.aperture;
      u.focusDistance.value = settings.focusDistance;
      u.focusAreaWidth.value = settings.focusAreaWidth;
      u.nearBlurLevel.value = settings.nearBlurLevel;
      u.farBlurLevel.value = settings.farBlurLevel;
    };

    // The shared sequence depth stores linear distance / 5000 in red instead
    // of packed perspective depth.
    SceneDof.prototype.useLinearDepthTexture = function () {
      for (const material of [this.tileMaterial, this.dilateMaterial, this.material]) {
        material.fragmentShader = material.fragmentShader.replace(DEPTH_LOOKUP, "texture2D( tDepth, uv ).r");
        material.needsUpdate = true;
      }
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

    SceneDof.prototype.setTileSize = function (width, height) {
      if (this.tileTarget && this.tileTarget.width === width && this.tileTarget.height === height) return;
      if (this.tileTarget) this.tileTarget.dispose();
      if (this.dilateTarget) this.dilateTarget.dispose();
      const options = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat };
      this.tileTarget = new THREE.WebGLRenderTarget(width, height, options);
      this.dilateTarget = new THREE.WebGLRenderTarget(width, height, options);
    };

    // Runs the tile, dilate and composite passes over a color and depth
    // texture covering width x height pixels at uv * uvScale. target null
    // draws to the canvas.
    SceneDof.prototype.composite = function (renderer, colorTexture, depthTexture, width, height, uvScaleX, uvScaleY, target, forceClear) {
      const tilesX = Math.max(1, Math.ceil(width / TILE));
      const tilesY = Math.max(1, Math.ceil(height / TILE));
      this.setTileSize(tilesX, tilesY);
      const u = this.material.uniforms;
      u.tColor.value = colorTexture;
      u.tDepth.value = depthTexture;
      u.resolution.value.set(width, height);
      u.uvScale.value.set(uvScaleX, uvScaleY);
      u.tileCount.value.set(tilesX, tilesY);
      this.dilateMaterial.uniforms.tTiles.value = this.tileTarget.texture;
      u.tTiles.value = this.dilateTarget.texture;
      try {
        this.quad.material = this.tileMaterial;
        renderer.render(this.scene, this.camera, this.tileTarget, true);
        this.quad.material = this.dilateMaterial;
        renderer.render(this.scene, this.camera, this.dilateTarget, true);
      } finally {
        this.quad.material = this.material;
      }
      renderer.render(this.scene, this.camera, target, forceClear);
    };

    // renderer: WebGL renderer; target: the pass output target; scene/camera:
    // the RenderPass inputs; viewport: target viewport; forceClear: as in
    // THREE.RenderPass.
    SceneDof.prototype.render = function (renderer, target, scene, camera, viewport, forceClear) {
      this.setSize(target.width, target.height);
      this.colorTarget.viewport.copy(viewport);
      this.depthTarget.viewport.copy(viewport);
      const previous = scene.overrideMaterial;
      renderer.render(scene, camera, this.colorTarget, forceClear);
      const hidden = [];
      scene.traverse?.((node) => {
        if (node.__zoidiumOpticalFlareQuad) {
          hidden.push([node, node.visible]);
          node.visible = false;
        }
      });
      try {
        scene.overrideMaterial = this.depthMaterial;
        renderer.render(scene, camera, this.depthTarget, forceClear);
      } finally {
        scene.overrideMaterial = previous;
        for (const [node, visible] of hidden) node.visible = visible;
      }
      this.composite(renderer, this.colorTarget.texture, this.depthTarget.texture, viewport.z, viewport.w,
        viewport.z / target.width, viewport.w / target.height, target, forceClear);
    };

    SceneDof.prototype.unload = function () {
      for (const key of ["colorTarget", "depthTarget", "tileTarget", "dilateTarget"]) {
        if (this[key]) this[key].dispose();
        this[key] = null;
      }
      for (const material of [this.material, this.tileMaterial, this.dilateMaterial, this.depthMaterial]) {
        if (material) material.dispose();
      }
      this.quad.geometry.dispose();
      this.enabled = false;
    };

    return SceneDof;
  }

  return { createSceneDofClass: createSceneDofClass };
})();
