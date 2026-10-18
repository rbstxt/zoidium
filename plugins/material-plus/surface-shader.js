"use strict";

// Shared surface shader chunks and gradient canvas helpers: the GLSL
// string tables the PBR onBeforeCompile assembly stitches together,
// plus the seeded random and color-ramp painters for baked textures.

module.exports = function createSurfaceShader(THREE, document) {
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
    // Reoriented normal mapping in view space. Rotate the geometric normal
    // onto the normal-map result, then apply that same rotation to the bump
    // normal, preserving the detail's strength instead of averaging it away.
    // https://blog.selfshadow.com/publications/blending-in-detail/
    "#if defined( USE_NORMALMAP ) && defined( USE_BUMPMAP )",
    "vec3 pzReorientBump( vec3 surfaceNormal, vec3 mapNormal, vec3 bumpNormal ) {",
    "    vec4 q = vec4( cross( surfaceNormal, mapNormal ), 1.0 + clamp( dot( surfaceNormal, mapNormal ), -1.0, 1.0 ) );",
    // At opposite normals the shortest rotation is ambiguous. Choose a
    // perpendicular axis so imported normals cannot produce a zero quaternion.
    "    if ( q.w < 0.00001 ) {",
    "        vec3 axis = abs( surfaceNormal.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 0.0, 1.0, 0.0 );",
    "        q = vec4( normalize( cross( surfaceNormal, axis ) ), 0.0 );",
    "    }",
    "    return normalize( bumpNormal + 2.0 * cross( q.xyz, cross( q.xyz, bumpNormal ) + q.w * bumpNormal ) / dot( q, q ) );",
    "}",
    "#endif",
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
    "#if defined( USE_NORMALMAP ) && defined( USE_BUMPMAP )",
    "vec3 pzSurfaceNormal = normal;",
    "#endif",
    "#include <normal_fragment_maps>",
    "#if defined( USE_NORMALMAP ) && defined( USE_BUMPMAP )",
    "vec3 pzBumpNormal = perturbNormalArb( -vViewPosition, pzSurfaceNormal, dHdxy_fwd() );",
    "normal = pzReorientBump( pzSurfaceNormal, normal, pzBumpNormal );",
    "#endif",
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

    return {
  WRAP_VALUES, PZ_RAMP_SOURCE, PZ_RAMP_INTERPOLATION, PZ_VERTEX_HEADER,
  PZ_UV_PROJECTION_CODE, PZ_FRAGMENT_HEADER, PZ_MAP_CODE,
  PZ_PHYSICAL_CODE, PZ_FRESNEL_CODE, PZ_LIGHTING_CODE, pzRandom,
  pzNoiseCanvas, pzParseStopColor, pzSampleStops, pzDrawGradient,
 };
};
