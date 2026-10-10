// Shared surface shader and parameter semantics ported from DaviFX OpenZoid.
return function installSurface(PZ, THREE, nodes, document) {
this.defaultName = "PBR Material";

// PBR Material: the Custom Material feature set (Color + Color Ramp,
// Roughness, Metalness, Texture, Bump, Normal map, Fresnel, Ambient
// Occlusion, Cel Renderer, Opacity/Blending, UV Tiling, spherical /
// cylindrical / cubic projection, Reflection layer + Specular) with the
// Node Editor displaced into it: the procedural graph bakes Color,
// Luminance (emissive), Roughness, Metalness, Bump and Opacity maps.

const WRAP_VALUES = [
    THREE.ClampToEdgeWrapping,
    THREE.RepeatWrapping,
    THREE.MirroredRepeatWrapping,
];

const PZ_RAMP_SOURCE = "luminance;u;v";
const PZ_RAMP_INTERPOLATION = "linear;constant;ease";

const PZ_VERTEX_HEADER = [
    "uniform vec2 uPzRepeat;",
    "uniform vec2 uPzOffset;",
    "uniform vec2 uPzCenter;",
    "uniform float uPzRotation;",
    "uniform vec3 uPzProjRotation;",
    "uniform vec3 uPzProjScale;",
    "uniform vec3 uPzProjTranslate;",
    "vec3 pzRotateXYZ( vec3 p, vec3 r ) {",
    "    float cx = cos( r.x );",
    "    float sx = sin( r.x );",
    "    float cy = cos( r.y );",
    "    float sy = sin( r.y );",
    "    float cz = cos( r.z );",
    "    float sz = sin( r.z );",
    "    vec3 q = vec3( p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z );",
    "    q = vec3( cy * q.x + sy * q.z, q.y, -sy * q.x + cy * q.z );",
    "    return vec3( cz * q.x - sz * q.y, sz * q.x + cz * q.y, q.z );",
    "}",
].join("\n");

const PZ_UV_PROJECTION_CODE = [
    "#include <begin_vertex>",
    "vec3 pzProjected = transformed * uPzProjScale + uPzProjTranslate;",
    "pzProjected = pzRotateXYZ( pzProjected, uPzProjRotation );",
    "vec2 pzBaseUv = uv;",
    "#if PZ_PROJECTION == 1",
    "float pzRadius = max( length( pzProjected ), 0.0001 );",
    "pzBaseUv = vec2( atan( pzProjected.x, pzProjected.z ) * 0.15915494 + 0.5, asin( clamp( pzProjected.y / pzRadius, -1.0, 1.0 ) ) * 0.31830989 + 0.5 );",
    "#elif PZ_PROJECTION == 2",
    "pzBaseUv = vec2( atan( pzProjected.x, pzProjected.z ) * 0.15915494 + 0.5, pzProjected.y * 0.5 + 0.5 );",
    "#elif PZ_PROJECTION == 3",
    "vec3 pzAbsNormal = abs( normalize( objectNormal ) );",
    "if ( pzAbsNormal.x >= pzAbsNormal.y && pzAbsNormal.x >= pzAbsNormal.z ) {",
    "    pzBaseUv = vec2( pzProjected.z, pzProjected.y );",
    "} else if ( pzAbsNormal.y >= pzAbsNormal.z ) {",
    "    pzBaseUv = vec2( pzProjected.x, pzProjected.z );",
    "} else {",
    "    pzBaseUv = vec2( pzProjected.x, pzProjected.y );",
    "}",
    "#endif",
    "vec2 pzUv = pzBaseUv - uPzCenter;",
    "float pzCos = cos( uPzRotation );",
    "float pzSin = sin( uPzRotation );",
    "vPzUv = vec2( uPzRepeat.x * ( pzCos * pzUv.x + pzSin * pzUv.y ), uPzRepeat.y * ( -pzSin * pzUv.x + pzCos * pzUv.y ) ) + uPzCenter + uPzOffset;",
    "#if defined( USE_MAP ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( USE_EMISSIVEMAP ) || defined( USE_ALPHAMAP ) || defined( USE_ROUGHNESSMAP ) || defined( USE_METALNESSMAP ) || defined( USE_SPECULARMAP )",
    "vUv = vPzUv;",
    "#endif",
].join("\n");

const PZ_FRAGMENT_HEADER = [
    "varying vec2 vPzUv;",
    "uniform vec3 uPzColor;",
    "uniform sampler2D uPzRamp;",
    "uniform float uPzRampFactor;",
    "uniform vec3 uPzFresnelColor;",
    "uniform float uPzFresnelPower;",
    "uniform float uPzFresnelMix;",
    "uniform sampler2D uPzGraphColor;",
    "uniform sampler2D uPzAOMap;",
    "uniform vec3 uPzAOColor;",
    "uniform float uPzAOIntensity;",
    "uniform float uPzAODistance;",
    "uniform float uPzCelSteps;",
    "uniform float uPzCelSmoothness;",
    "uniform float uPzCelSpecularSteps;",
    "uniform float uPzSpecularStrength;",
    "uniform float uPzSpecularEnabled;",
    "uniform float uPzSpecularOpacity;",
    "float pzRampCoord( vec3 color, vec2 uv ) {",
    "#if PZ_RAMP_SRC == 1",
    "    return clamp( uv.x, 0.0, 1.0 );",
    "#elif PZ_RAMP_SRC == 2",
    "    return clamp( uv.y, 0.0, 1.0 );",
    "#else",
    "    return clamp( dot( color, vec3( 0.299, 0.587, 0.114 ) ), 0.0, 1.0 );",
    "#endif",
    "}",
    "vec3 pzComputeColor( vec2 uv ) {",
    "    vec3 pzBase = uPzColor;",
    "#if PZ_RAMP",
    "    vec3 pzRamp = texture2D( uPzRamp, vec2( pzRampCoord( pzBase, uv ), 0.5 ) ).rgb;",
    "    pzBase = mix( pzBase, pzRamp, uPzRampFactor );",
    "#endif",
    "    return pzBase;",
    "}",
].join("\n");

const PZ_MAP_CODE = [
    "#include <map_fragment>",
    "diffuseColor.rgb *= pzComputeColor( vPzUv );",
    "#if PZ_GRAPH_COLOR",
    "diffuseColor.rgb *= texture2D( uPzGraphColor, vPzUv ).rgb;",
    "#endif",
].join("\n");

const PZ_PHYSICAL_CODE = [
    "#include <lights_physical_fragment>",
    "material.specularColor *= uPzSpecularStrength * uPzSpecularEnabled * uPzSpecularOpacity;",
].join("\n");

const PZ_FRESNEL_CODE = [
    "#include <normal_fragment_maps>",
    "#if PZ_FRESNEL",
    "float pzFresnel = 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) );",
    "pzFresnel = pow( pzFresnel, uPzFresnelPower ) * uPzFresnelMix;",
    "diffuseColor.rgb = mix( diffuseColor.rgb, uPzFresnelColor, pzFresnel );",
    "#endif",
].join("\n");

const PZ_LIGHTING_CODE = [
    "#include <lights_fragment_end>",
    "#if PZ_AO",
    "float pzAO = 1.0;",
    "bool pzAOHas = false;",
    "#if PZ_AO_MAP",
    "pzAO = texture2D( uPzAOMap, vPzUv ).r;",
    "pzAOHas = true;",
    "#elif defined( USE_BUMPMAP )",
    "pzAO = texture2D( bumpMap, vPzUv ).r;",
    "pzAOHas = true;",
    "#endif",
    "if ( pzAOHas ) {",
    "    pzAO = pow( clamp( pzAO, 0.0, 1.0 ), max( uPzAODistance, 0.001 ) );",
    "    pzAO = mix( 1.0, pzAO, clamp( uPzAOIntensity, 0.0, 1.0 ) );",
    "    reflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), uPzAOColor, clamp( uPzAOIntensity, 0.0, 1.0 ) ) * pzAO;",
    "    reflectedLight.indirectSpecular *= pzAO;",
    "}",
    "#endif",
    "#if PZ_CEL",
    "float pzCelDiffuse = dot( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3( 0.299, 0.587, 0.114 ) );",
    "float pzCelSpecular = dot( reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3( 0.299, 0.587, 0.114 ) );",
    "float pzCelDiffuseLevels = max( uPzCelSteps, 1.0 );",
    "float pzCelSpecularLevels = max( uPzCelSpecularSteps, 1.0 );",
    "float pzCelDiffuseQ = floor( pzCelDiffuse * pzCelDiffuseLevels + 0.5 ) / pzCelDiffuseLevels;",
    "float pzCelSpecularQ = floor( pzCelSpecular * pzCelSpecularLevels + 0.5 ) / pzCelSpecularLevels;",
    "pzCelDiffuseQ = mix( pzCelDiffuseQ, pzCelDiffuse, clamp( uPzCelSmoothness, 0.0, 1.0 ) );",
    "pzCelSpecularQ = mix( pzCelSpecularQ, pzCelSpecular, clamp( uPzCelSmoothness, 0.0, 1.0 ) );",
    "float pzCelDiffuseScale = pzCelDiffuse > 0.0001 ? pzCelDiffuseQ / pzCelDiffuse : 1.0;",
    "float pzCelSpecularScale = pzCelSpecular > 0.0001 ? pzCelSpecularQ / pzCelSpecular : 1.0;",
    "reflectedLight.directDiffuse *= pzCelDiffuseScale;",
    "reflectedLight.indirectDiffuse *= pzCelDiffuseScale;",
    "reflectedLight.directSpecular *= pzCelSpecularScale;",
    "reflectedLight.indirectSpecular *= pzCelSpecularScale;",
    "#endif",
].join("\n");

function pzRandom(seed) {
    var value = seed | 0;
    return function () {
        value = (value + 0x6d2b79f5) | 0;
        var t = Math.imul(value ^ (value >>> 15), 1 | value);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pzNoiseCanvas(size, cells, seed) {
    var canvas = null;
    if (typeof document !== "undefined") {
        canvas = document.createElement("canvas");
    } else if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(size, size);
    }
    if (!canvas) return null;
    canvas.width = size;
    canvas.height = size;
    var context = canvas.getContext("2d");
    if (!context || !context.createImageData) return null;
    var image = context.createImageData(size, size);
    var data = image.data;
    var random = pzRandom(seed);
    var octaves = 3;
    var frequency = Math.max(2, Math.round(cells));
    var amplitude = 1;
    var total = 0;
    var values = new Float32Array(size * size);
    for (var o = 0; o < octaves; o++) {
        var lattice = new Float32Array((frequency + 1) * (frequency + 1));
        for (var i = 0; i < lattice.length; i++) {
            lattice[i] = random();
        }
        for (var y = 0; y < size; y++) {
            var gy = (y / size) * frequency;
            var y0 = Math.min(gy | 0, frequency - 1);
            var fy = gy - y0;
            var sy = fy * fy * (3 - 2 * fy);
            for (var x = 0; x < size; x++) {
                var gx = (x / size) * frequency;
                var x0 = Math.min(gx | 0, frequency - 1);
                var fx = gx - x0;
                var sx = fx * fx * (3 - 2 * fx);
                var i00 = x0 + y0 * (frequency + 1);
                var i10 = i00 + 1;
                var i01 = i00 + frequency + 1;
                var i11 = i01 + 1;
                var top = lattice[i00] + (lattice[i10] - lattice[i00]) * sx;
                var bottom = lattice[i01] + (lattice[i11] - lattice[i01]) * sx;
                values[x + y * size] += (top + (bottom - top) * sy) * amplitude;
            }
        }
        total += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    for (var p = 0; p < size * size; p++) {
        var gray = Math.round((values[p] / total) * 255);
        var index = p * 4;
        data[index] = gray;
        data[index + 1] = gray;
        data[index + 2] = gray;
        data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas;
}

function pzParseStopColor(value) {
    var color = { r: 0, g: 0, b: 0, a: 1 };
    if (typeof value === "string" && value.indexOf("(") >= 0) {
        var parts = value.split("(")[1].split(")")[0].split(",");
        color.r = parseInt(parts[0], 10) || 0;
        color.g = parseInt(parts[1], 10) || 0;
        color.b = parseInt(parts[2], 10) || 0;
        color.a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
        return color;
    }
    if (Array.isArray(value)) {
        color.r = Math.round((value[0] || 0) * 255);
        color.g = Math.round((value[1] || 0) * 255);
        color.b = Math.round((value[2] || 0) * 255);
        color.a = value[3] !== undefined ? value[3] : 1;
    }
    return color;
}

function pzSampleStops(stops, t, interpolation) {
    if (!stops || !stops.length) {
        return { r: 255, g: 255, b: 255, a: 255 };
    }
    var first = pzParseStopColor(stops[0].color);
    var last = pzParseStopColor(stops[stops.length - 1].color);
    if (t <= stops[0].position) return first;
    if (t >= stops[stops.length - 1].position) return last;
    for (var i = 0; i < stops.length - 1; i++) {
        var a = stops[i];
        var b = stops[i + 1];
        if (t < a.position || t > b.position) continue;
        var span = Math.max(b.position - a.position, 0.00001);
        var f = (t - a.position) / span;
        if (interpolation === 1) {
            f = 0;
        } else if (interpolation === 2) {
            f = f * f * (3 - 2 * f);
        }
        var ca = pzParseStopColor(a.color);
        var cb = pzParseStopColor(b.color);
        return {
            r: ca.r + (cb.r - ca.r) * f,
            g: ca.g + (cb.g - ca.g) * f,
            b: ca.b + (cb.b - ca.b) * f,
            a: ca.a + (cb.a - ca.a) * f,
        };
    }
    return last;
}

function pzDrawGradient(data, stops, interpolation) {
    var sorted = (stops || []).slice().sort(function (a, b) {
        return a.position - b.position;
    });
    var count = data.length / 4;
    for (var i = 0; i < count; i++) {
        var t = count > 1 ? i / (count - 1) : 0;
        var color = pzSampleStops(sorted, t, interpolation || 0);
        var index = i * 4;
        data[index] = Math.max(0, Math.min(255, Math.round(color.r)));
        data[index + 1] = Math.max(0, Math.min(255, Math.round(color.g)));
        data[index + 2] = Math.max(0, Math.min(255, Math.round(color.b)));
        data[index + 3] = Math.max(0, Math.min(255, Math.round(color.a * 255)));
    }
}

this.load = function (e) {
    var material = this;
    this.pzUnloaded = false;
    this.threeObj = this.threeObj || new THREE.MeshPhysicalMaterial();
    this.threeObj.color.setRGB(1, 1, 1);
    this.pzImages = { texture: null, ao: null };
    this.pzTextures = { texture: null, ao: null };
    this.pzGraphTextures = { color: null, luminance: null, roughness: null, metalness: null, bump: null, opacity: null };
    this.pzNoiseTexture = null;
    this.pzFresnel = null;
    this.pzAnimated = false;
    this.pzGraph = null;
    this.pzUniforms = {
        uPzRepeat: { value: new THREE.Vector2(1, 1) },
        uPzOffset: { value: new THREE.Vector2(0, 0) },
        uPzCenter: { value: new THREE.Vector2(0, 0) },
        uPzRotation: { value: 0 },
        uPzProjRotation: { value: new THREE.Vector3(0, 0, 0) },
        uPzProjScale: { value: new THREE.Vector3(1, 1, 1) },
        uPzProjTranslate: { value: new THREE.Vector3(0, 0, 0) },
        uPzColor: { value: new THREE.Vector3(1, 1, 1) },
        uPzRamp: { value: null },
        uPzRampFactor: { value: 1 },
        uPzFresnelColor: { value: new THREE.Vector3(1, 1, 1) },
        uPzFresnelPower: { value: 4 },
        uPzFresnelMix: { value: 0.7 },
        uPzGraphColor: { value: null },
        uPzAOMap: { value: null },
        uPzAOColor: { value: new THREE.Vector3(0, 0, 0) },
        uPzAOIntensity: { value: 0.5 },
        uPzAODistance: { value: 1 },
        uPzCelSteps: { value: 4 },
        uPzCelSmoothness: { value: 0.1 },
        uPzCelSpecularSteps: { value: 6 },
        uPzSpecularStrength: { value: 1 },
        uPzSpecularEnabled: { value: 1 },
        uPzSpecularOpacity: { value: 1 },
    };
    this.pzRampTexture = this.createGradientTexture([
        { position: 0, color: "rgba(0,0,0,1)" },
        { position: 1, color: "rgba(255,255,255,1)" },
    ]);
    this.pzUniforms.uPzRamp.value = this.pzRampTexture;
    this.threeObj.onBeforeCompile = function (shader) {
        for (var key in material.pzUniforms) {
            shader.uniforms[key] = material.pzUniforms[key];
        }
        shader.vertexShader = shader.vertexShader
            .replace("#include <uv_pars_vertex>", "#include <uv_pars_vertex>\nvarying vec2 vPzUv;")
            .replace("#include <begin_vertex>", PZ_UV_PROJECTION_CODE)
            .replace("void main() {", PZ_VERTEX_HEADER + "\nvoid main() {");
        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <lights_physical_pars_fragment>",
                PZ_FRAGMENT_HEADER + "\n#include <lights_physical_pars_fragment>"
            )
            .replace("#include <map_fragment>", PZ_MAP_CODE)
            .replace("#include <normal_fragment_maps>", PZ_FRESNEL_CODE)
            .replace("#include <lights_physical_fragment>", PZ_PHYSICAL_CODE)
            .replace("#include <lights_fragment_end>", PZ_LIGHTING_CODE);
    };
    if (e && e.surfaceOnly) return;
    this.pzLoading = true;
    if (e) this.properties.load(e.properties);
    this.pzLoading = false;
    this.syncRamp();
    this.updateDefines();
    this.updateBumpMap();
    this.refreshBindings();
    this.refreshAO();
    this.bakeGraph();
    this.initReflection();
    this.threeObj.roughness = this.properties.roughness.get();
    this.threeObj.metalness = this.properties.metalness.get();
    this.threeObj.normalScale.set(this.properties.normalScale.get(), this.properties.normalScale.get());
};

this.createGradientTexture = function (stops) {
    var data = new Uint8Array(32 * 4);
    pzDrawGradient(data, stops, 0);
    var texture = new THREE.DataTexture(data, 32, 1, THREE.RGBAFormat);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
};

this.updateGradientTexture = function (stops) {
    if (!this.pzRampTexture) return;
    var interpolation = this.properties.rampInterpolation.get() || 0;
    pzDrawGradient(this.pzRampTexture.image.data, stops, interpolation);
    this.pzRampTexture.needsUpdate = true;
};

this.syncRamp = function () {
    this.updateGradientTexture(this.properties.ramp.get());
};

this.unload = function () {
    this.pzUnloaded = true;
    if (nodes && nodes.editor) {
        nodes.editor.closeMaterial(this);
    }
    if (this.threeObj.envMap) {
        this.parentLayer?.envMap?.releaseTexture?.();
        this.threeObj.envMap = null;
    }
    var slots = Object.keys(this.pzImages);
    for (var i = 0; i < slots.length; i++) {
        var asset = this.pzImages[slots[i]];
        if (asset) {
            this.parentProject.assets.unload(asset);
        }
        var texture = this.pzTextures[slots[i]];
        if (texture) {
            texture.dispose();
        }
        this.pzImages[slots[i]] = null;
        this.pzTextures[slots[i]] = null;
    }
    var graphSlots = Object.keys(this.pzGraphTextures);
    for (var g = 0; g < graphSlots.length; g++) {
        var graphTexture = this.pzGraphTextures[graphSlots[g]];
        if (graphTexture) {
            graphTexture.dispose();
            this.pzGraphTextures[graphSlots[g]] = null;
        }
    }
    if (this.pzNoiseTexture) {
        this.pzNoiseTexture.dispose();
        this.pzNoiseTexture = null;
    }
    if (this.pzRampTexture) {
        this.pzRampTexture.dispose();
        this.pzRampTexture = null;
    }
    this.threeObj.dispose();
};

this.toJSON = function () {
    return { type: this.type, properties: this.properties };
};

this.setImage = function (slot, path) {
    var asset = this.pzImages[slot];
    if (asset) {
        this.parentProject.assets.unload(asset);
        this.pzImages[slot] = null;
    }
    var texture = this.pzTextures[slot];
    if (texture) {
        texture.dispose();
        this.pzTextures[slot] = null;
    }
    if (!path) return null;
    var loaded = new PZ.asset.image(this.parentProject.assets.load(path));
    var threeTexture = loaded.getTexture(true);
    this.pzImages[slot] = loaded;
    this.pzTextures[slot] = threeTexture;
    this.applyWrap(threeTexture);
    return threeTexture;
};

this.applyWrap = function (texture) {
    if (!texture) return;
    var wrap = this.properties.wrap.get() ?? 1;
    texture.wrapS = WRAP_VALUES[wrap];
    texture.wrapT = WRAP_VALUES[wrap];
    texture.needsUpdate = true;
};

this.applyUvTransform = function (texture, repeat, offset, center, rotation) {
    if (!texture) return;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.offset.set(offset[0], offset[1]);
    texture.center.set(center[0], center[1]);
    texture.rotation = rotation;
};

// Assign a built-in map slot. Only null<->texture flips change the compiled
// program and need needsUpdate; texture<->texture swaps are uniform-only.
this.pzAssignMap = function (slot, texture) {
    var t = this.threeObj;
    var next = texture || null;
    var current = t[slot] || null;
    if (current === next) return false;
    t[slot] = next;
    return current === null || next === null;
};

this.updateDefines = function () {
    var graph = this.pzGraphTextures || {};
    var defines = {
        PZ_PROJECTION: this.properties.projection.get() || 0,
        PZ_RAMP: this.properties.rampEnabled.get() === 1 ? 1 : 0,
        PZ_RAMP_SRC: this.properties.rampSource.get() || 0,
        PZ_FRESNEL: this.pzFresnel || this.properties.fresnel.get() === 1 ? 1 : 0,
        PZ_AO: this.properties.aoEnabled.get() === 1 ? 1 : 0,
        PZ_AO_MAP: this.pzTextures.ao ? 1 : 0,
        PZ_CEL: this.properties.celEnabled.get() === 1 ? 1 : 0,
        PZ_GRAPH_COLOR: this._nodeBaseMap ? 0 : graph.color ? 1 : 0,
    };
    var current = this.threeObj.defines || {};
    var changed = false;
    for (var key in defines) {
        if (current[key] !== defines[key]) {
            changed = true;
            break;
        }
    }
    if (!changed) return;
    this.threeObj.defines = Object.assign({}, current, defines);
    this.threeObj.needsUpdate = true;
};

this.refreshBindings = function () {
    var graph = this.pzGraphTextures || {};
    var needsUpdate = false;
    needsUpdate = this.pzAssignMap("roughnessMap", graph.roughness) || needsUpdate;
    needsUpdate = this.pzAssignMap("metalnessMap", graph.metalness) || needsUpdate;
    needsUpdate = this.pzAssignMap("emissiveMap", graph.luminance) || needsUpdate;
    needsUpdate = this.pzAssignMap("alphaMap", graph.opacity) || needsUpdate;
    if (graph.opacity) {
        this.threeObj.transparent = true;
    }
    needsUpdate = this.pzAssignMap("normalMap", this.pzTextures.normalMap) || needsUpdate;
    this.pzUniforms.uPzGraphColor.value = graph.color || null;
    this.pzUniforms.uPzAOMap.value = this.pzTextures.ao || null;
    if (this.properties.bumpNoise.get() === 1) {
        needsUpdate = this.pzAssignMap("bumpMap", this.pzNoiseTexture) || needsUpdate;
    } else {
        needsUpdate = this.pzAssignMap("bumpMap", graph.bump) || needsUpdate;
    }
    if (needsUpdate) {
        this.threeObj.needsUpdate = true;
    }
    this.updateDefines();
};

this.updateMipFalloff = function () {
    var mip = this.properties.bumpMipFalloff.get() === 1;
    var wanted = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    var list = [this.pzNoiseTexture, this.pzGraphTextures.bump];
    for (var i = 0; i < list.length; i++) {
        var texture = list[i];
        if (!texture) continue;
        if (texture.minFilter === wanted && texture.generateMipmaps === mip) continue;
        texture.generateMipmaps = mip;
        texture.minFilter = wanted;
        texture.needsUpdate = true;
    }
};

this.updateBumpMap = function () {
    if (this.pzNoiseTexture) {
        this.pzNoiseTexture.dispose();
        this.pzNoiseTexture = null;
    }
    if (this.properties.bumpNoise.get() === 1) {
        var canvas = pzNoiseCanvas(256, this.properties.bumpNoiseScale.get(), 7);
        if (canvas) {
            this.pzNoiseTexture = new THREE.CanvasTexture(canvas);
            this.applyWrap(this.pzNoiseTexture);
        }
    }
    this.refreshBindings();
    this.updateMipFalloff();
};

this.bindGraphChannel = function (slot) {
    // Returns true when a built-in map slot changed presence (program rebuild).
    var graph = this.pzGraphTextures || {};
    if (slot === "color") {
        this.pzUniforms.uPzGraphColor.value = graph.color || null;
        return false;
    } else if (slot === "luminance") {
        return this.pzAssignMap("emissiveMap", graph.luminance);
    } else if (slot === "roughness") {
        return this.pzAssignMap("roughnessMap", graph.roughness);
    } else if (slot === "metalness") {
        return this.pzAssignMap("metalnessMap", graph.metalness);
    } else if (slot === "bump") {
        if (this.properties.bumpNoise.get() !== 1) {
            var changed = this.pzAssignMap("bumpMap", graph.bump);
            this.updateMipFalloff();
            return changed;
        }
        return false;
    } else if (slot === "opacity") {
        var alphaChanged = this.pzAssignMap("alphaMap", graph.opacity);
        if (graph.opacity) {
            this.threeObj.transparent = true;
        }
        return alphaChanged;
    }
    return false;
};

this.setGraphChannel = function (slot, canvas, batch) {
    var existing = this.pzGraphTextures[slot];
    var had = !!existing;
    var has = !!canvas;
    if (has) {
        if (existing) {
            // Reuse the GPU texture object: swap canvas pixels in place instead
            // of disposing + recreating a CanvasTexture every bake.
            existing.image = canvas;
            existing.needsUpdate = true;
        } else {
            this.pzGraphTextures[slot] = new THREE.CanvasTexture(canvas);
        }
    } else if (existing) {
        existing.dispose();
        this.pzGraphTextures[slot] = null;
    }
    var mapChanged = this.bindGraphChannel(slot);
    if (mapChanged) {
        this.threeObj.needsUpdate = true;
    }
    if (!batch && had !== has) {
        this.updateDefines();
    }
    return had !== has || mapChanged;
};

this.graphBakeKey = function (time) {
    var graph = nodes.parse(this.properties.graph.get());
    return JSON.stringify([graph, this.properties.bakeResolution.get(),
        time,
        nodes.dependencySignature(graph, this)]);
};

this.bakeGraph = function (time) {
    if (time === undefined) time = this.pzTime || 0;
    if (!nodes || !this.pzTextures || this.pzUnloaded) return;
    if (this.pzBaking) {
        this.pzBakeQueued = time || 0;
        return;
    }
    this.pzBaking = true;
    try {
        var material = this;
        var graph = nodes.parse(this.properties.graph.get());
        this.pzGraph = graph;
        var resolution = [128, 256, 512][this.properties.bakeResolution.get()] || 256;
        var outputs = nodes.evaluate(graph, resolution, time || 0, {
            material: material, images: nodes.imageBuffers(graph, resolution, material),
        });
        this.pzFresnel = nodes.fresnelSettings(graph);
        if (this.pzFresnel) {
            var color = this.pzFresnel.color || [1, 1, 1];
            this.pzUniforms.uPzFresnelColor.value.set(color[0], color[1], color[2]);
            this.pzUniforms.uPzFresnelPower.value = this.pzFresnel.power;
            this.pzUniforms.uPzFresnelMix.value = this.pzFresnel.mix;
        }
        this.pzAnimated = nodes.isAnimated(graph, material);
        var definesDirty = false;
        definesDirty = this.setGraphChannel("color", outputs.color, true) || definesDirty;
        definesDirty = this.setGraphChannel("luminance", outputs.luminance, true) || definesDirty;
        definesDirty = this.setGraphChannel("roughness", outputs.roughness, true) || definesDirty;
        definesDirty = this.setGraphChannel("metalness", outputs.metalness, true) || definesDirty;
        definesDirty = this.setGraphChannel("bump", outputs.bump, true) || definesDirty;
        definesDirty = this.setGraphChannel("opacity", outputs.opacity, true) || definesDirty;
        this.pzBakeKey = this.graphBakeKey(time === undefined ? (this.pzTime || 0) : time);
        if (definesDirty) {
            this.updateDefines();
        }
    } finally {
        this.pzBaking = false;
        if (this.pzBakeQueued !== undefined && this.pzBakeQueued !== null) {
            var queued = this.pzBakeQueued;
            this.pzBakeQueued = null;
            if (queued !== (time || 0)) {
                this.bakeGraph(queued);
            }
        }
    }
};

this.refreshAO = function () {
    this.pzUniforms.uPzAOMap.value = this.pzTextures.ao || null;
    this.updateDefines();
};

this.initReflection = function () {
    var enabled = this.properties.reflection.get() === 1 || this.properties.reflReflection.get() === 1;
    if (enabled && !this.threeObj.envMap) {
        this.threeObj.envMap = this.parentLayer?.envMap?.getTexture?.() || null;
        this.threeObj.needsUpdate = true;
    } else if (!enabled && this.threeObj.envMap) {
        this.parentLayer?.envMap?.releaseTexture?.();
        this.threeObj.envMap = null;
        this.threeObj.needsUpdate = true;
    }
};

this.prepare = async function (e) {
    if (nodes && !this.pzUnloaded) {
        await nodes.prepareImages(nodes.parse(this.properties.graph.get()), this);
        if (!this.pzUnloaded) this.update(e);
    }
    var slots = Object.keys(this.pzImages);
    for (var i = 0; i < slots.length; i++) {
        var asset = this.pzImages[slots[i]];
        if (asset) {
            await asset.loading;
        }
    }
};

this.update = function (e) {
    var t = this.threeObj;
    var props = this.properties;
    var uniforms = this.pzUniforms;
    var rate = 30;
    if (this.parentProject && this.parentProject.sequence && this.parentProject.sequence.properties.rate) {
        rate = this.parentProject.sequence.properties.rate.get() || 30;
    }
    var time = (e || 0) / rate;
    this.pzTime = time;
    if (!this.pzBaking && this.pzBakeKey !== this.graphBakeKey(time)) {
        
        this.bakeGraph(time);
    }
    t.color.setRGB(1, 1, 1);
    t.opacity = props.opacity.get(e);
    t.bumpScale = props.bumpStrength.get(e);
    t.clearCoat = props.reflReflection.get() === 1 ? props.reflReflectionStrength.get(e) * props.reflReflectionOpacity.get(e) : 0;
    t.clearCoatRoughness = props.reflReflectionRoughness.get(e);
    t.envMapIntensity = props.reflGlobalReflectionBrightness.get(e);
    var v = props.color.get(e);
    uniforms.uPzColor.value.set(v[0], v[1], v[2]);
    uniforms.uPzRampFactor.value = props.rampFactor.get(e);
    var repeat = props.repeat.get(e);
    var offset = props.offset.get(e);
    var center = props.center.get(e);
    var rotation = props.rotation.get(e);
    this.applyUvTransform(t.map, repeat, offset, center, rotation);
    this.applyUvTransform(t.normalMap, repeat, offset, center, rotation);
    this.applyUvTransform(t.bumpMap, repeat, offset, center, rotation);
    uniforms.uPzRepeat.value.set(repeat[0], repeat[1]);
    uniforms.uPzOffset.value.set(offset[0], offset[1]);
    uniforms.uPzCenter.value.set(center[0], center[1]);
    uniforms.uPzRotation.value = rotation;
    uniforms.uPzProjRotation.value.set(...props.projRotation.get(e));
    var scale = props.projScale.get(e);
    uniforms.uPzProjScale.value.set(...(props.projLockAspect.get() === 1 ? [scale[0], scale[0], scale[0]] : scale));
    uniforms.uPzProjTranslate.value.set(...props.projTranslate.get(e));
    v = props.emissive.get(e);
    t.emissive.setRGB(v[0], v[1], v[2]);
    // A connected graph Fresnel node wins over the channel controls.
    if (!this.pzFresnel) {
        v = props.fresnelColor.get(e);
        uniforms.uPzFresnelColor.value.set(v[0], v[1], v[2]);
        uniforms.uPzFresnelPower.value = props.fresnelPower.get(e);
        uniforms.uPzFresnelMix.value = props.fresnelMixStrength.get(e);
    }
    uniforms.uPzAOIntensity.value = props.aoIntensity.get(e);
    uniforms.uPzAODistance.value = props.aoDistance.get(e);
    v = props.aoColor.get(e);
    uniforms.uPzAOColor.value.set(v[0], v[1], v[2]);
    uniforms.uPzCelSteps.value = props.celSteps.get(e);
    uniforms.uPzCelSmoothness.value = props.celSmoothness.get(e);
    uniforms.uPzCelSpecularSteps.value = props.celSpecularSteps.get(e);
    uniforms.uPzSpecularStrength.value = props.reflSpecularStrength.get(e);
    uniforms.uPzSpecularEnabled.value = props.reflSpecular.get() === 1 ? 1 : 0;
    uniforms.uPzSpecularOpacity.value = props.reflSpecularOpacity.get(e);
};

this.props = {
    nodeEditor: {
        name: "Node Editor",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            var e = this.parentObject;
            if (e.pzLoading || !nodes || !nodes.editor) return;
            if (this.value === 1) {
                nodes.editor.open(e);
            } else {
                nodes.editor.closeMaterial(e);
            }
        },
        items: "closed;open",
    },
    graph: {
        visible: false,
        name: "Graph",
        type: PZ.property.type.TEXT,
        value: "{\"nodes\":[{\"id\":\"output\",\"type\":\"output\",\"x\":640,\"y\":80,\"params\":{}}],\"links\":[]}",
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.bakeGraph();
        },
    },
    bakeResolution: {
        name: "Bake Resolution",
        type: PZ.property.type.OPTION,
        value: 1,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.bakeGraph();
        },
        items: "128;256;512",
    },
    color: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Color.R", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
            { dynamic: true, name: "Color.G", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
            { dynamic: true, name: "Color.B", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
        ],
        name: "Color",
        type: PZ.property.type.COLOR,
    },
    emissive: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Emissive.R", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
            { dynamic: true, name: "Emissive.G", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
            { dynamic: true, name: "Emissive.B", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
        ],
        name: "Luminance Color",
        type: PZ.property.type.COLOR,
    },
    rampEnabled: {
        name: "Color Ramp",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: "off;on",
    },
    ramp: {
        name: "Color Ramp Curve",
        type: PZ.property.type.GRADIENT,
        value: [
            { position: 0, color: "rgba(0,0,0,1)" },
            { position: 1, color: "rgba(255,255,255,1)" },
        ],
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.syncRamp();
        },
    },
    rampSource: {
        name: "Color Ramp Source",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: PZ_RAMP_SOURCE,
    },
    rampInterpolation: {
        name: "Color Ramp Interpolation",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.syncRamp();
        },
        items: PZ_RAMP_INTERPOLATION,
    },
    rampFactor: {
        dynamic: true,
        name: "Color Ramp Factor",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    roughness: {
        name: "Roughness",
        type: PZ.property.type.NUMBER,
        value: 0.5,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.roughness = this.value;
        },
        max: 1,
        min: 0,
        step: 0.01,
    },
    metalness: {
        name: "Metalness",
        type: PZ.property.type.NUMBER,
        value: 0.5,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.metalness = this.value;
        },
        max: 1,
        min: 0,
        step: 0.01,
    },
    texture: {
        name: "Texture",
        type: PZ.property.type.ASSET,
        assetType: PZ.asset.type.IMAGE,
        accept: "image/*",
        value: null,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            var e = this.parentObject;
            if (e.pzAssignMap("map", e.setImage("texture", this.value))) {
                e.threeObj.needsUpdate = true;
            }
        },
    },
    bumpStrength: {
        dynamic: true,
        name: "Bump Strength",
        type: PZ.property.type.NUMBER,
        value: 0,
        min: 0,
        max: 2,
        step: 0.01,
        decimals: 3,
    },
    bumpNoise: {
        name: "Bump Noise",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateBumpMap();
        },
        items: "off;on",
    },
    bumpNoiseScale: {
        name: "Bump Noise Scale",
        type: PZ.property.type.NUMBER,
        value: 4,
        min: 1,
        max: 64,
        step: 1,
        decimals: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            if (this.parentObject.properties.bumpNoise.get() === 1) {
                this.parentObject.updateBumpMap();
            }
        },
    },
    bumpMipFalloff: {
        name: "Bump MIP Falloff",
        type: PZ.property.type.OPTION,
        value: 1,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateMipFalloff();
        },
        items: "off;on",
    },
    normalMap: {
        name: "Normal map",
        type: PZ.property.type.ASSET,
        assetType: PZ.asset.type.IMAGE,
        accept: "image/*",
        value: null,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            var e = this.parentObject;
            if (e.pzAssignMap("normalMap", e.setImage("normalMap", this.value))) {
                e.threeObj.needsUpdate = true;
            }
        },
    },
    normalScale: {
        name: "Normal scale",
        type: PZ.property.type.NUMBER,
        value: 1,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.normalScale.set(this.value, this.value);
        },
        decimals: 3,
        min: 0,
        step: 0.01,
    },
    fresnel: {
        name: "Fresnel",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: "off;on",
    },
    fresnelColor: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Fresnel.R", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
            { dynamic: true, name: "Fresnel.G", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
            { dynamic: true, name: "Fresnel.B", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 1 },
        ],
        name: "Fresnel Color",
        type: PZ.property.type.COLOR,
    },
    fresnelPower: {
        dynamic: true,
        name: "Fresnel Power",
        type: PZ.property.type.NUMBER,
        value: 4,
        min: 0.1,
        max: 8,
        step: 0.05,
        decimals: 2,
    },
    fresnelMixStrength: {
        dynamic: true,
        name: "Fresnel Mix Strength",
        type: PZ.property.type.NUMBER,
        value: 0.7,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    aoEnabled: {
        name: "Ambient Occlusion",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: "off;on",
    },
    aoTexture: {
        name: "Ambient Occlusion Texture",
        type: PZ.property.type.ASSET,
        assetType: PZ.asset.type.IMAGE,
        accept: "image/*",
        value: null,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            var e = this.parentObject;
            e.setImage("ao", this.value);
            e.refreshAO();
        },
    },
    aoIntensity: {
        dynamic: true,
        name: "Ambient Occlusion Intensity",
        type: PZ.property.type.NUMBER,
        value: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    aoDistance: {
        dynamic: true,
        name: "Ambient occlusion exponent",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0.01,
        max: 8,
        step: 0.01,
        decimals: 2,
    },
    aoColor: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "AO.R", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
            { dynamic: true, name: "AO.G", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
            { dynamic: true, name: "AO.B", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 1 },
        ],
        name: "Ambient Occlusion Color",
        type: PZ.property.type.COLOR,
    },
    celEnabled: {
        name: "Cel Renderer",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: "off;on",
    },
    celSteps: {
        dynamic: true,
        name: "Cel Steps",
        type: PZ.property.type.NUMBER,
        value: 4,
        min: 1,
        max: 16,
        step: 1,
        decimals: 0,
    },
    celSmoothness: {
        dynamic: true,
        name: "Cel Smoothness",
        type: PZ.property.type.NUMBER,
        value: 0.1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    celSpecularSteps: {
        dynamic: true,
        name: "Cel Specular Steps",
        type: PZ.property.type.NUMBER,
        value: 6,
        min: 1,
        max: 32,
        step: 1,
        decimals: 0,
    },
    transparent: {
        name: "Transparency",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.transparent = this.value === 1;
        },
        items: "off;on",
    },
    opacity: {
        dynamic: true,
        name: "Opacity",
        type: PZ.property.type.NUMBER,
        value: 1,
        max: 1,
        min: 0,
        step: 0.01,
    },
    blending: {
        name: "Blending",
        type: PZ.property.type.OPTION,
        value: 1,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.blending = this.value;
        },
        items: "none;normal;additive;subtractive;multiply",
    },
    side: {
        name: "Render side",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function (e) {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.threeObj.side = this.value;
        },
        items: "front;back;both",
    },
    wrap: {
        name: "Wrap",
        type: PZ.property.type.OPTION,
        value: 1,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            var e = this.parentObject;
            e.applyWrap(e.threeObj.map);
            e.applyWrap(e.threeObj.normalMap);
            e.applyWrap(e.threeObj.bumpMap);
            e.applyWrap(e.pzTextures.ao);
            e.applyWrap(e.pzNoiseTexture);
        },
        items: "none;tile;reflect",
    },
    repeat: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Repeat.U", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 1 },
            { dynamic: true, name: "Repeat.V", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 1 },
        ],
        name: "Repeat",
        type: PZ.property.type.VECTOR2,
        step: 0.1,
        decimals: 3,
        linkRatio: true,
    },
    offset: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Offset.U", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
            { dynamic: true, name: "Offset.V", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
        ],
        name: "Offset",
        step: 0.1,
        decimals: 3,
        type: PZ.property.type.VECTOR2,
    },
    center: {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: "Center.U", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
            { dynamic: true, name: "Center.V", type: PZ.property.type.NUMBER, step: 0.1, decimals: 3, value: 0 },
        ],
        name: "Center",
        step: 0.1,
        decimals: 3,
        type: PZ.property.type.VECTOR2,
    },
    rotation: {
        dynamic: true,
        name: "Rotation",
        type: PZ.property.type.NUMBER,
        value: 0,
        step: 0.5,
        scaleFactor: Math.PI / 180,
    },
    projRotation: {
        dynamic: true,
        group: true,
        objects: [
            {
                dynamic: true,
                name: "R.X",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 1,
                decimals: 1,
                scaleFactor: Math.PI / 180,
            },
            {
                dynamic: true,
                name: "R.Y",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 1,
                decimals: 1,
                scaleFactor: Math.PI / 180,
            },
            {
                dynamic: true,
                name: "R.Z",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 1,
                decimals: 1,
                scaleFactor: Math.PI / 180,
            },
        ],
        name: "Projection Rotation",
        type: PZ.property.type.VECTOR3,
        scaleFactor: Math.PI / 180,
    },
    projScale: {
        dynamic: true,
        group: true,
        objects: [
            {
                dynamic: true,
                name: "S.X",
                type: PZ.property.type.NUMBER,
                value: 1,
                step: 0.1,
                decimals: 3,
            },
            {
                dynamic: true,
                name: "S.Y",
                type: PZ.property.type.NUMBER,
                value: 1,
                step: 0.1,
                decimals: 3,
            },
            {
                dynamic: true,
                name: "S.Z",
                type: PZ.property.type.NUMBER,
                value: 1,
                step: 0.1,
                decimals: 3,
            },
        ],
        name: "Projection Scale",
        type: PZ.property.type.VECTOR3,
    },
    projTranslate: {
        dynamic: true,
        group: true,
        objects: [
            {
                dynamic: true,
                name: "T.X",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 0.1,
                decimals: 3,
            },
            {
                dynamic: true,
                name: "T.Y",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 0.1,
                decimals: 3,
            },
            {
                dynamic: true,
                name: "T.Z",
                type: PZ.property.type.NUMBER,
                value: 0,
                step: 0.1,
                decimals: 3,
            },
        ],
        name: "Projection Translation",
        type: PZ.property.type.VECTOR3,
    },
    projLockAspect: {
        name: "Projection Lock Aspect Ratio",
        type: PZ.property.type.OPTION,
        value: 0,
        items: "off;on",
    },
    projection: {
        name: "Projection",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.updateDefines();
        },
        items: "uv;spherical;cylindrical;cubic",
    },
    reflection: {
        name: "Reflection",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.initReflection();
        },
        items: "off;on",
    },
    reflReflection: {
        name: "Reflection Layer",
        type: PZ.property.type.OPTION,
        value: 0,
        changed: function () {
            if (this.parentObject.pzLoading || this.parentObject._zoidiumLoading || !this.parentObject.pzUniforms) return;
            this.parentObject.initReflection();
        },
        items: "off;on",
    },
    reflReflectionStrength: {
        dynamic: true,
        name: "Reflection Layer Strength",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    reflReflectionOpacity: {
        dynamic: true,
        name: "Reflection Layer Opacity",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    reflReflectionRoughness: {
        dynamic: true,
        name: "Reflection Layer Roughness",
        type: PZ.property.type.NUMBER,
        value: 0,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    reflSpecular: {
        name: "Specular Layer",
        type: PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
    },
    reflSpecularStrength: {
        dynamic: true,
        name: "Specular Strength",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 2,
        step: 0.01,
        decimals: 2,
    },
    reflSpecularOpacity: {
        dynamic: true,
        name: "Specular Opacity",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 1,
        step: 0.01,
        decimals: 2,
    },
    reflGlobalReflectionBrightness: {
        dynamic: true,
        name: "Global Reflection Brightness",
        type: PZ.property.type.NUMBER,
        value: 1,
        min: 0,
        max: 2,
        step: 0.01,
        decimals: 2,
    },
};

delete this.props.nodeEditor;
this.props.graph.value = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "output", type: "output", x: 640, y: 80, params: {} }], links: [] });
this.props.aoEnabled.name = "Ambient occlusion map";
this.props.aoTexture.name = "Ambient occlusion map texture";
this.properties.addAll(this.props);

};
