"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// CC Pixel Polly: the layer breaks into a grid of polygons/squares that fly
// apart under force and gravity with spin. Motion is analytic in time
// (position = f(time since start), no simulation history), so random-order
// evaluation gives identical pixels. Pieces render as one merged triangle
// mesh in a single draw call (bounded piece count); the vertex data is
// recomputed deterministically from the properties and the frame each
// render. Before the start time the input passes through exactly.

var pollyEffect = this;

var pollyMath = (function loadPollyMath() {
  var getAsset = pollyEffect && pollyEffect._zoidiumGetAsset;
  var apis = typeof ZoidiumPluginApis !== "undefined" ? ZoidiumPluginApis : null;
  var createRequire = apis && apis.modules && apis.modules.createRequire;
  if (typeof getAsset !== "function" || typeof createRequire !== "function") {
    throw new Error("CC Pixel Polly needs its bundle math (this._zoidiumGetAsset and ZoidiumPluginApis.modules.createRequire).");
  }
  var loader = createRequire(getAsset, { root: "./plugins/native-fx/", scope: {} });
  return loader("./effects/fxtrans-math.js");
})();

var POLLY_MAX_PIECES = 8192;

var POLLY_VERT = [
  "varying vec2 vLuv;",
  "varying vec2 vCuv;",
  "varying float vShade;",
  "attribute vec2 aCenter;",
  "attribute float aShade;",
  "void main() {",
  "  vLuv = uv;",
  "  vCuv = aCenter;",
  "  vShade = aShade;",
  "  gl_Position = vec4(position.xy, 0.0, 1.0);",
  "}",
].join("\n");

var POLLY_FRAG = [
  "precision highp float;",
  "uniform sampler2D tDiffuse;",
  "uniform vec2 uvScale;",
  "uniform float flatMode;",
  "varying vec2 vLuv;",
  "varying vec2 vCuv;",
  "varying float vShade;",
  "void main() {",
  "  if (vLuv.x < 0.0 || vLuv.x > 1.0 || vLuv.y < 0.0 || vLuv.y > 1.0) {",
  "    gl_FragColor = vec4(0.0);",
  "    return;",
  "  }",
  "  if (flatMode > 0.5) {",
  "    if (vCuv.x < 0.0 || vCuv.x > 1.0 || vCuv.y < 0.0 || vCuv.y > 1.0) {",
  "      gl_FragColor = vec4(0.0);",
  "      return;",
  "    }",
  "    vec4 c = texture2D(tDiffuse, vCuv * uvScale);",
  "    if (c.a <= 0.0001) {",
  "      gl_FragColor = vec4(0.0);",
  "      return;",
  "    }",
  "    gl_FragColor = vec4(c.rgb / c.a * vShade * c.a, c.a);",
  "  } else {",
  "    vec4 texel = texture2D(tDiffuse, vLuv * uvScale);",
  "    gl_FragColor = vec4(texel.rgb * vShade, texel.a);",
  "  }",
  "}",
].join("\n");

function pollyNumber(value, fallback) {
  var number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

(function buildPolly() {
  var effect = pollyEffect;

  effect.defaultName = "CC Pixel Polly";
  effect.propertyDefinitions = {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    force: {
      dynamic: true,
      name: "Force",
      type: PZ.property.type.NUMBER,
      value: 100,
      max: 1000,
      min: -1000,
      step: 1,
      decimals: 1,
    },
    gravity: {
      dynamic: true,
      name: "Gravity",
      type: PZ.property.type.NUMBER,
      value: 1,
      max: 20,
      min: -20,
      step: 0.05,
      decimals: 2,
    },
    spinning: {
      dynamic: true,
      name: "Spinning",
      type: PZ.property.type.NUMBER,
      value: 0,
      max: 720,
      min: -720,
      step: 1,
      decimals: 1,
    },
    forceCenter: {
      dynamic: true,
      group: true,
      objects: [
        {
          dynamic: true,
          name: "Force Center.X",
          type: PZ.property.type.NUMBER,
          value: 0.5,
          min: 0,
          max: 1,
          step: 0.01,
          decimals: 3,
        },
        {
          dynamic: true,
          name: "Force Center.Y",
          type: PZ.property.type.NUMBER,
          value: 0.5,
          min: 0,
          max: 1,
          step: 0.01,
          decimals: 3,
        },
      ],
      name: "Force Center",
      type: PZ.property.type.VECTOR2,
    },
    directionRandomness: {
      dynamic: true,
      name: "Direction Randomness",
      type: PZ.property.type.NUMBER,
      value: 10,
      max: 100,
      min: 0,
      step: 1,
      decimals: 0,
    },
    speedRandomness: {
      dynamic: true,
      name: "Speed Randomness",
      type: PZ.property.type.NUMBER,
      value: 10,
      max: 100,
      min: 0,
      step: 1,
      decimals: 0,
    },
    gridSpacing: {
      dynamic: true,
      name: "Grid Spacing",
      type: PZ.property.type.NUMBER,
      value: 10,
      max: 500,
      min: 1,
      step: 1,
      decimals: 0,
    },
    object: {
      dynamic: true,
      name: "Object",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Polygon;Textured Polygon;Square;Textured Square",
    },
    enableDepthSort: {
      dynamic: true,
      name: "Enable Depth Sort",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    startTime: {
      dynamic: true,
      name: "Start Time (sec)",
      type: PZ.property.type.NUMBER,
      value: 0,
      max: 1000,
      min: -1000,
      step: 0.1,
      decimals: 2,
    },
    randomSeed: {
      dynamic: true,
      name: "Random Seed",
      type: PZ.property.type.NUMBER,
      value: 1,
      max: 10000,
      min: 0,
      step: 1,
      decimals: 0,
    },
  };
  effect.properties.addAll(effect.propertyDefinitions, effect);

  effect.pollyFps = function pollyFps() {
    try {
      var rate = effect.parentProject.sequence.properties.rate.get();
      var fps = Number(rate);
      if (Number.isFinite(fps) && fps > 0) return fps;
    } catch (_error) {
      // Fall through to the default below.
    }
    return 30;
  };

  effect.pollyRebuild = function pollyRebuild(layerW, layerH) {
    var spacing = Math.max(1, Math.round(pollyNumber(effect.cachedSpacing, 10)));
    var object = Math.max(0, Math.min(3, Math.round(pollyNumber(effect.cachedObject, 0))));
    var signature = layerW + "x" + layerH + ":" + spacing + ":" + object;
    if (effect.pollyGeometry && effect.pollySignature === signature) return;
    var plan = pollyMath.pollyPlan({
      layerWidth: layerW,
      layerHeight: layerH,
      force: 0,
      gravity: 0,
      spinning: 0,
      forceCenter: [0, 0],
      directionRandomness: 0,
      speedRandomness: 0,
      gridSpacing: spacing,
      object: object,
      enableDepthSort: false,
      randomSeed: 0,
      t: 0,
      maxPieces: POLLY_MAX_PIECES,
    });
    var pieces = plan.pieces;
    var tri = object <= 1;
    var vertsPer = tri ? 3 : 4;
    var vertCount = pieces.length * vertsPer;
    var positions = new Float32Array(vertCount * 2);
    var uvs = new Float32Array(vertCount * 2);
    var centers = new Float32Array(vertCount * 2);
    var shades = new Float32Array(vertCount);
    var indexCount = pieces.length * (tri ? 3 : 6);
    var index = new Uint16Array(indexCount);
    for (var p = 0; p < pieces.length; p++) {
      var piece = pieces[p];
      for (var v = 0; v < vertsPer; v++) {
        var corner = piece.poly[v];
        var vi = p * vertsPer + v;
        uvs[vi * 2] = corner[0] / layerW;
        uvs[vi * 2 + 1] = corner[1] / layerH;
        centers[vi * 2] = piece.center[0] / layerW;
        centers[vi * 2 + 1] = piece.center[1] / layerH;
      }
    }
    if (effect.pollyGeometry) effect.pollyGeometry.dispose();
    var geometry = new THREE.BufferGeometry();
    var positionAttr = new THREE.BufferAttribute(positions, 2);
    var shadeAttr = new THREE.BufferAttribute(shades, 1);
    if (typeof positionAttr.setUsage === "function" && THREE.DynamicDrawUsage) {
      positionAttr.setUsage(THREE.DynamicDrawUsage);
      shadeAttr.setUsage(THREE.DynamicDrawUsage);
    } else if (typeof positionAttr.setDynamic === "function") {
      positionAttr.setDynamic(true);
      shadeAttr.setDynamic(true);
    }
    geometry.addAttribute("position", positionAttr);
    geometry.addAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.addAttribute("aCenter", new THREE.BufferAttribute(centers, 2));
    geometry.addAttribute("aShade", shadeAttr);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    effect.pollyMesh.geometry = geometry;
    effect.pollyGeometry = geometry;
    effect.pollySignature = signature;
    effect.pollyPieces = pieces;
    effect.pollyTri = tri;
  };

  effect.pollyDraw = function pollyDraw(layerW, layerH, bufW, bufH, t) {
    var tri = effect.pollyTri;
    var vertsPer = tri ? 3 : 4;
    var fcf = effect.cachedForceCenterFrac || [0.5, 0.5];
    var fc = [fcf[0] * layerW, fcf[1] * layerH];
    var plan = pollyMath.pollyPlan({
      layerWidth: layerW,
      layerHeight: layerH,
      force: effect.cachedForce,
      gravity: effect.cachedGravity,
      spinning: effect.cachedSpinning,
      forceCenter: fc,
      directionRandomness: effect.cachedDirRand,
      speedRandomness: effect.cachedSpdRand,
      gridSpacing: effect.pollySpacing(),
      object: effect.cachedObject,
      enableDepthSort: effect.cachedDepthSort,
      randomSeed: effect.cachedSeed,
      t: t,
      maxPieces: POLLY_MAX_PIECES,
    });
    var camD = 2 * Math.max(layerW, layerH);
    var positions = effect.pollyGeometry.attributes.position.array;
    var shades = effect.pollyGeometry.attributes.aShade.array;
    var index = effect.pollyGeometry.index.array;
    var ordered = plan.pieces;
    for (var o = 0; o < ordered.length; o++) {
      var piece = ordered[o];
      var base = piece.index * vertsPer;
      for (var v = 0; v < vertsPer; v++) {
        var corner = piece.poly[v];
        var projected = pollyMath.projectCorner(
          corner[0] - piece.center[0], corner[1] - piece.center[1],
          piece, layerW, layerH, camD
        );
        var vi = base + v;
        positions[vi * 2] = (projected.x / bufW) * 2 - 1;
        positions[vi * 2 + 1] = (projected.y / bufH) * 2 - 1;
        shades[vi] = piece.shade;
      }
      var io = o * (tri ? 3 : 6);
      if (tri) {
        index[io] = base;
        index[io + 1] = base + 1;
        index[io + 2] = base + 2;
      } else {
        index[io] = base;
        index[io + 1] = base + 1;
        index[io + 2] = base + 2;
        index[io + 3] = base;
        index[io + 4] = base + 2;
        index[io + 5] = base + 3;
      }
    }
    effect.pollyGeometry.attributes.position.needsUpdate = true;
    effect.pollyGeometry.attributes.aShade.needsUpdate = true;
    effect.pollyGeometry.index.needsUpdate = true;
  };

  effect.pollySpacing = function pollySpacing() {
    return Math.max(1, Math.round(pollyNumber(effect.cachedSpacing, 10)));
  };

  effect.load = async function load(data) {
    effect.pollyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { type: "t", value: null },
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
        flatMode: { type: "f", value: 1 },
      },
      vertexShader: POLLY_VERT,
      fragmentShader: POLLY_FRAG,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    effect.pollyMaterial.blending = THREE.CustomBlending;
    effect.pollyMaterial.blendSrc = THREE.OneFactor;
    effect.pollyMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
    effect.pollyScene = new THREE.Scene();
    effect.pollyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    effect.pollyMesh = new THREE.Mesh(new THREE.BufferGeometry(), effect.pollyMaterial);
    effect.pollyMesh.frustumCulled = false;
    effect.pollyScene.add(effect.pollyMesh);
    effect.pollyGeometry = null;
    effect.pollySignature = "";
    effect.pollyPieces = [];

    effect.pass = {
      enabled: true,
      uniforms: { uvScale: { value: new THREE.Vector2(1, 1) } },
      needsSwap: true,
      clear: false,
      renderToScreen: false,
      render: function renderPolly(renderer, writeBuffer, readBuffer) {
        var resolution = effect.cachedResolution || [readBuffer.width, readBuffer.height];
        var layerW = Math.max(1, Math.round(resolution[0]));
        var layerH = Math.max(1, Math.round(resolution[1]));
        var fps = effect.pollyFps();
        var start = pollyNumber(effect.cachedStart, 0);
        var frame = pollyNumber(effect.cachedFrame, 0);
        var t = frame / fps - start;
        if (!(t > 0)) {
          effect.pollyCopy = effect.pollyCopy || ZoidiumPluginApis.gl.createCopyPass(THREE);
          effect.pollyCopy.uniforms.tDiffuse.value = readBuffer.texture;
          if (effect.pollyCopy.uniforms.uvScale) effect.pollyCopy.uniforms.uvScale.value.set(1, 1);
          if (effect.pollyCopy.uniforms.uvOffset) effect.pollyCopy.uniforms.uvOffset.value.set(0, 0);
          effect.pollyCopy.render(renderer, writeBuffer, readBuffer, false);
          return;
        }
        effect.pollyRebuild(layerW, layerH);
        effect.pollyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
        effect.pollyMaterial.uniforms.uvScale.value.copy(effect.pass.uniforms.uvScale.value);
        var object = Math.round(pollyNumber(effect.cachedObject, 0));
        effect.pollyMaterial.uniforms.flatMode.value = object === 1 || object === 3 ? 0 : 1;
        effect.pollyDraw(layerW, layerH, readBuffer.width, readBuffer.height, t);
        renderer.setClearColor(0x000000, 0);
        renderer.clearTarget(writeBuffer, true, true, true);
        renderer.render(effect.pollyScene, effect.pollyCamera, writeBuffer, false);
      },
    };
    effect.properties.load(data && data.properties);
  };

  effect.toJSON = function toJSON() {
    return { type: effect.type, properties: effect.properties };
  };

  effect.unload = function unload() {
    if (effect.pollyMesh && effect.pollyMesh.geometry) effect.pollyMesh.geometry.dispose();
    effect.pollyGeometry = null;
    if (effect.pollyMaterial) effect.pollyMaterial.dispose();
    if (effect.pollyCopy) effect.pollyCopy.material.dispose();
    effect.pollyCopy = null;
  };

  effect.update = function update(frame) {
    if (!effect.pass) return;
    effect.cachedFrame = Number(frame) || 0;
    effect.cachedForce = pollyNumber(effect.properties.force.get(frame), 100);
    effect.cachedGravity = pollyNumber(effect.properties.gravity.get(frame), 1);
    effect.cachedSpinning = pollyNumber(effect.properties.spinning.get(frame), 0);
    var fc = effect.properties.forceCenter.get(frame);
    effect.cachedForceCenterFrac = [pollyNumber(fc[0], 0.5), pollyNumber(fc[1], 0.5)];
    effect.cachedDirRand = pollyNumber(effect.properties.directionRandomness.get(frame), 10);
    effect.cachedSpdRand = pollyNumber(effect.properties.speedRandomness.get(frame), 10);
    effect.cachedSpacing = pollyNumber(effect.properties.gridSpacing.get(frame), 10);
    effect.cachedObject = pollyNumber(effect.properties.object.get(frame), 0);
    effect.cachedDepthSort = pollyNumber(effect.properties.enableDepthSort.get(frame), 1) === 1;
    effect.cachedStart = pollyNumber(effect.properties.startTime.get(frame), 0);
    effect.cachedSeed = pollyNumber(effect.properties.randomSeed.get(frame), 1);
    effect.pass.enabled = effect.properties.enabled.get(frame) === 1;
  };

  effect.resize = function resize() {
    if (effect.parentLayer && effect.parentLayer.properties) {
      effect.cachedResolution = effect.parentLayer.properties.resolution.get();
    }
  };
})();
