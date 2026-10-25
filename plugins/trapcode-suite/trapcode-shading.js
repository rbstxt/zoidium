// OpenZoid Trapcode Suite — Trapcode per-particle shading from scene lights.
/*
 * trapcode-shading.js
 *
 * The shared shading model: scene-light collection, parameter
 * reads, the CPU shadePoint reference, and the GLSL chunk with
 * its vertex-line applier. Loaded after trapcode-common.js.
 */

var PZ = PZ || {};

(function () {
    PZ.trapcode = PZ.trapcode || {};
    var T = PZ.trapcode;

    /* Per-particle shading from scene lights                             */
    /* ------------------------------------------------------------------ */
    // Form Shading and Particular Lighting share this model (Trapcode Form /
    // Particular shading, as close as point sprites allow in three.js r91):
    // per-particle diffuse light from the scene lights (CM3 lights and
    // Trapcode lights are all real THREE lights in the same scene graph),
    // with a falloff mode, an ambient floor, a camera-facing specular lobe
    // and a reflection term. Sprites always face the camera, so the diffuse
    // normal is the view direction; directionality comes from light color,
    // distance falloff and the specular lobe. Shadowlet darkens particles
    // behind the cloud along the dominant light direction: a bounded soft
    // self-shadow approximation, not a shadow map. With shading off the
    // shader keeps its legacy path, so existing projects render identically.
    T.shading = {
        MAX_LIGHTS: 4,
        KIND_POINT: 0,
        KIND_DIRECTIONAL: 1,
        KIND_AMBIENT: 2,
    };

    // Translation-only world position (sums .position up the parent chain).
    // Exact while ancestors carry no rotation or scale, which holds for the
    // light rigs this collects; deterministic in every host.
    function shadeWorldPosition(object) {
        var x = 0;
        var y = 0;
        var z = 0;
        var current = object;
        var guard = 0;
        while (current && guard < 64) {
            var p = current.position;
            if (p) {
                x += p.x || 0;
                y += p.y || 0;
                z += p.z || 0;
            }
            current = current.parent;
            guard++;
        }
        return [x, y, z];
    }

    function shadeLightColor(light) {
        var c = light && light.color;
        if (c && typeof c.r === "number") return [c.r, c.g, c.b];
        return [1, 1, 1];
    }

    function shadeLightIntensity(light) {
        var v = light && light.intensity;
        return typeof v === "number" && isFinite(v) ? v : 1;
    }

    // Class without the THREE namespace so node tests (stub classes without
    // isX flags) and old three.js builds classify the same way.
    function shadeClassify(light) {
        if (!light) return T.shading.KIND_POINT;
        if (light.isAmbientLight || light.isHemisphereLight) return T.shading.KIND_AMBIENT;
        if (light.isDirectionalLight) return T.shading.KIND_DIRECTIONAL;
        if (light.isPointLight || light.isSpotLight || light.isRectAreaLight) return T.shading.KIND_POINT;
        var name = (light.constructor && light.constructor.name) || light.type || "";
        if (/ambient|hemisphere/i.test(name)) return T.shading.KIND_AMBIENT;
        if (/directional/i.test(name)) return T.shading.KIND_DIRECTIONAL;
        return T.shading.KIND_POINT;
    }

    function shadeIsLight(object) {
        if (!object || object === null || typeof object !== "object") return false;
        if (object.isLight) return true;
        if (typeof THREE !== "undefined" && THREE && THREE.Light && object instanceof THREE.Light) return true;
        var name = (object.constructor && object.constructor.name) || object.type || "";
        return /light$/i.test(name) && !!object.color && object.intensity !== undefined;
    }

    // Climbs to the scene root, then walks depth-first (fixed order, so the
    // result is a pure function of the scene). Spot and area lights are
    // treated as point lights (no cone); hemisphere lights join the ambient
    // term at half intensity through their sky color.
    T.shading.collectLights = function (threeObj) {
        var root = threeObj;
        var guard = 0;
        while (root && root.parent && guard < 64) {
            root = root.parent;
            guard++;
        }
        var out = [];
        if (!root) return out;
        var stack = [root];
        while (stack.length) {
            var node = stack.pop();
            if (node !== threeObj && shadeIsLight(node)) {
                var kind = shadeClassify(node);
                var color = shadeLightColor(node);
                var intensity = shadeLightIntensity(node);
                var entry = { kind: kind, color: color, intensity: intensity, position: null, direction: null };
                if (kind === T.shading.KIND_DIRECTIONAL) {
                    var from = shadeWorldPosition(node);
                    var target = node.target ? shadeWorldPosition(node.target) : [0, 0, 0];
                    var dx = from[0] - target[0];
                    var dy = from[1] - target[1];
                    var dz = from[2] - target[2];
                    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (len < 0.0001) {
                        dx = -from[0];
                        dy = -from[1];
                        dz = -from[2];
                        len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    }
                    entry.direction = len > 0.0001 ? [dx / len, dy / len, dz / len] : [0.4, 0.8, 0.6];
                } else if (kind === T.shading.KIND_POINT) {
                    entry.position = shadeWorldPosition(node);
                }
                out.push(entry);
            }
            var children = node && node.children;
            if (children && children.length) {
                for (var i = children.length - 1; i >= 0; i--) stack.push(children[i]);
            }
        }
        return out;
    };

    function shadeNumber(group, key, fallback) {
        try {
            if (!group || !group[key] || typeof group[key].get !== "function") return fallback;
            var v = group[key].get(T.currentTime);
            return typeof v === "number" && isFinite(v) ? v : fallback;
        } catch (_error) {
            return fallback;
        }
    }

    // Reads either control layout: Form names the switch "shading",
    // Particular names it "enabled"; Particular saves may also lack the two
    // newest controls (nominal distance, shadowlet), which fall back to the
    // Form defaults. All outputs are plain numbers, on is 0/1.
    T.shading.readParams = function (group) {
        var on = group && group.shading
            ? shadeNumber(group, "shading", 0)
            : shadeNumber(group, "enabled", 0);
        return {
            on: on === 1 ? 1 : 0,
            falloff: Math.max(0, Math.min(3, Math.round(shadeNumber(group, "lightFalloff", 0)))),
            nominal: Math.max(0, shadeNumber(group, "nominalDistance", 250)),
            ambient: T.clamp(shadeNumber(group, "ambient", 20) / 100, 0, 1),
            diffuse: T.clamp(shadeNumber(group, "diffuse", 80) / 100, 0, 4),
            specAmt: T.clamp(shadeNumber(group, "specularAmount", 0) / 100, 0, 4),
            specSharp: T.clamp(shadeNumber(group, "specularSharpness", 100) / 100, 0, 1),
            reflect: T.clamp(shadeNumber(group, "reflectionStrength", 100) / 100, 0, 4),
            shadowlet: group && group.shadowlet ? (shadeNumber(group, "shadowlet", 0) === 1 ? 1 : 0) : 0,
        };
    };

    // Axis-aligned box of a flat xyz array: { min, max, center }. Pure and
    // deterministic; empty input gives the origin box.
    T.shading.boxFromPositions = function (array, count) {
        var min = [Infinity, Infinity, Infinity];
        var max = [-Infinity, -Infinity, -Infinity];
        var n = Math.max(0, Math.min(count || 0, (array ? array.length : 0) / 3));
        for (var i = 0; i < n; i++) {
            for (var a = 0; a < 3; a++) {
                var v = array[i * 3 + a];
                if (v < min[a]) min[a] = v;
                if (v > max[a]) max[a] = v;
            }
        }
        if (n === 0) {
            min = [0, 0, 0];
            max = [0, 0, 0];
        }
        return {
            min: min,
            max: max,
            center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
        };
    };

    // Toward-light unit vector for the shadowlet depth axis: the first
    // directional light wins, else the direction from the cloud center to
    // the first point light, else a fixed diagonal.
    T.shading.dominantDir = function (lights, center) {
        lights = lights || [];
        var i;
        for (i = 0; i < lights.length; i++) {
            if (lights[i].kind === T.shading.KIND_DIRECTIONAL && lights[i].direction) {
                return lights[i].direction;
            }
        }
        for (i = 0; i < lights.length; i++) {
            if (lights[i].kind === T.shading.KIND_POINT && lights[i].position) {
                var dx = lights[i].position[0] - center[0];
                var dy = lights[i].position[1] - center[1];
                var dz = lights[i].position[2] - center[2];
                var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (len > 0.0001) return [dx / len, dy / len, dz / len];
            }
        }
        return [0.4, 0.8, 0.6];
    };

    function shadeVec(x, y, z) {
        try {
            if (typeof THREE !== "undefined" && THREE && THREE.Vector3) return new THREE.Vector3(x, y, z);
        } catch (_error) { /* plain fallback below */ }
        return { x: x, y: y, z: z };
    }

    // Uniform block merged into the point ShaderMaterials. Always present so
    // toggling shading never reallocates the material; the shader only reads
    // them under USE_SHADING.
    T.shading.newUniforms = function () {
        var zeros = function () {
            return [shadeVec(0, 0, 0), shadeVec(0, 0, 0), shadeVec(0, 0, 0), shadeVec(0, 0, 0)];
        };
        return {
            uShadeAmbient: { type: "f", value: 1 },
            uShadeDiffuse: { type: "f", value: 0 },
            uShadeSpecAmt: { type: "f", value: 0 },
            uShadeSpecSharp: { type: "f", value: 1 },
            uShadeReflect: { type: "f", value: 0 },
            uShadeFalloff: { type: "f", value: 0 },
            uShadeNominal: { type: "f", value: 250 },
            uShadeShadowlet: { type: "f", value: 0 },
            uShadeBoxMin: { type: "v3", value: shadeVec(0, 0, 0) },
            uShadeBoxMax: { type: "v3", value: shadeVec(0, 0, 0) },
            uShadeLightDir: { type: "v3", value: shadeVec(0.4, 0.8, 0.6) },
            uShadeLightCount: { type: "f", value: 0 },
            uShadeLightPos: { type: "v3v", value: zeros() },
            uShadeLightColor: { type: "v3v", value: zeros() },
            uShadeLightKind: { type: "v3v", value: zeros() },
        };
    };

    function shadeSetVec(uniform, p) {
        if (!uniform || !uniform.value) return;
        if (typeof uniform.value.set === "function") uniform.value.set(p[0], p[1], p[2]);
        else {
            uniform.value.x = p[0];
            uniform.value.y = p[1];
            uniform.value.z = p[2];
        }
    }

    // Fills the uniform block for this frame and toggles USE_SHADING.
    // Returns true while shading is on. Pure function of (properties, scene
    // lights, box) at the current time: no history is read or stored.
    T.shading.update = function (material, group, threeObj, box) {
        if (!material || !material.uniforms) return false;
        var params = T.shading.readParams(group);
        if (!params.on) {
            if (material.defines && material.defines.USE_SHADING) {
                delete material.defines.USE_SHADING;
                material.needsUpdate = true;
            }
            return false;
        }
        if (material.defines && !material.defines.USE_SHADING) {
            material.defines.USE_SHADING = 1;
            material.needsUpdate = true;
        }
        var lights = T.shading.collectLights(threeObj).slice(0, T.shading.MAX_LIGHTS);
        var u = material.uniforms;
        if (u.uShadeAmbient) u.uShadeAmbient.value = params.ambient;
        if (u.uShadeDiffuse) u.uShadeDiffuse.value = params.diffuse;
        if (u.uShadeSpecAmt) u.uShadeSpecAmt.value = params.specAmt;
        if (u.uShadeSpecSharp) u.uShadeSpecSharp.value = params.specSharp;
        if (u.uShadeReflect) u.uShadeReflect.value = params.reflect;
        if (u.uShadeFalloff) u.uShadeFalloff.value = params.falloff;
        if (u.uShadeNominal) u.uShadeNominal.value = params.nominal;
        if (u.uShadeShadowlet) u.uShadeShadowlet.value = params.shadowlet;
        box = box || { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0] };
        if (u.uShadeBoxMin) shadeSetVec(u.uShadeBoxMin, box.min);
        if (u.uShadeBoxMax) shadeSetVec(u.uShadeBoxMax, box.max);
        var dir = T.shading.dominantDir(lights, box.center);
        if (u.uShadeLightDir) shadeSetVec(u.uShadeLightDir, dir);
        if (u.uShadeLightCount) u.uShadeLightCount.value = lights.length;
        for (var i = 0; i < T.shading.MAX_LIGHTS; i++) {
            var light = lights[i];
            var pos = (u.uShadeLightPos && u.uShadeLightPos.value && u.uShadeLightPos.value[i]) || null;
            var col = (u.uShadeLightColor && u.uShadeLightColor.value && u.uShadeLightColor.value[i]) || null;
            var kind = (u.uShadeLightKind && u.uShadeLightKind.value && u.uShadeLightKind.value[i]) || null;
            if (!light) {
                if (pos) shadeSetVec({ value: pos }, [0, 0, 0]);
                if (col) shadeSetVec({ value: col }, [0, 0, 0]);
                if (kind) shadeSetVec({ value: kind }, [3, 0, 0]);
                continue;
            }
            // uShadeLightColor always carries color times full intensity.
            // shadeSurface applies the ambient half factor once, as shadePoint does.
            var scaled = [light.color[0] * light.intensity, light.color[1] * light.intensity, light.color[2] * light.intensity];
            if (light.kind === T.shading.KIND_AMBIENT) {
                if (pos) shadeSetVec({ value: pos }, [0, 0, 0]);
            } else if (light.kind === T.shading.KIND_DIRECTIONAL) {
                if (pos) shadeSetVec({ value: pos }, light.direction);
            } else {
                if (pos) shadeSetVec({ value: pos }, light.position);
            }
            if (col) shadeSetVec({ value: col }, scaled);
            if (kind) shadeSetVec({ value: kind }, [light.kind, 0, 0]);
        }
        return true;
    };

    // World-space attenuation shared by the shader and the JS mirror below.
    T.shading.attenuation = function (falloff, nominal, dist) {
        var n = Math.max(nominal, 0.0001);
        if (falloff < 0.5) return n / (n + dist);
        if (falloff < 1.5) {
            var q = n / Math.max(dist, 0.0001);
            return Math.min(q * q, 4);
        }
        if (falloff < 2.5) {
            var q2 = n / Math.max(dist, 0.0001);
            return Math.min(q2 * q2 * q2, 8);
        }
        return 1;
    };

    // Plain-JS mirror of the shader math (world space, camera at cameraP)
    // for unit tests: returns { mul: [r,g,b], spec: [r,g,b] }. The shader
    // runs the same computation in the vertex stage.
    T.shading.shadePoint = function (worldP, cameraP, params, lights, box) {
        var mul = [params.ambient, params.ambient, params.ambient];
        var spec = [0, 0, 0];
        var nx = cameraP[0] - worldP[0];
        var ny = cameraP[1] - worldP[1];
        var nz = cameraP[2] - worldP[2];
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nl < 0.0001) {
            nx = 0;
            ny = 0;
            nz = 1;
            nl = 1;
        }
        nx /= nl;
        ny /= nl;
        nz /= nl;
        for (var i = 0; i < (lights || []).length; i++) {
            var light = lights[i];
            var lc = [light.color[0] * light.intensity, light.color[1] * light.intensity, light.color[2] * light.intensity];
            if (light.kind === T.shading.KIND_AMBIENT) {
                mul[0] += lc[0] * 0.5;
                mul[1] += lc[1] * 0.5;
                mul[2] += lc[2] * 0.5;
                continue;
            }
            var toL;
            var dist = 0;
            if (light.kind === T.shading.KIND_DIRECTIONAL) {
                toL = light.direction;
            } else {
                toL = [light.position[0] - worldP[0], light.position[1] - worldP[1], light.position[2] - worldP[2]];
                dist = Math.sqrt(toL[0] * toL[0] + toL[1] * toL[1] + toL[2] * toL[2]);
                if (dist > 0.0001) {
                    toL = [toL[0] / dist, toL[1] / dist, toL[2] / dist];
                } else {
                    toL = [nx, ny, nz];
                }
            }
            var atten = T.shading.attenuation(params.falloff, params.nominal, dist);
            var ndl = Math.max(nx * toL[0] + ny * toL[1] + nz * toL[2], 0);
            var diff = params.diffuse * atten * (0.35 + 0.65 * ndl);
            mul[0] += lc[0] * diff + lc[0] * params.reflect * 0.25 * atten;
            mul[1] += lc[1] * diff + lc[1] * params.reflect * 0.25 * atten;
            mul[2] += lc[2] * diff + lc[2] * params.reflect * 0.25 * atten;
            var hx = toL[0] + nx;
            var hy = toL[1] + ny;
            var hz = toL[2] + nz;
            var hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
            if (hl > 0.0001) {
                var s = Math.pow(Math.max((nx * hx + ny * hy + nz * hz) / hl, 0), 1 + 127 * params.specSharp) *
                    params.specAmt * atten;
                spec[0] += lc[0] * s;
                spec[1] += lc[1] * s;
                spec[2] += lc[2] * s;
            }
        }
        if (params.shadowlet === 1 && box) {
            var diag = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
            var diagLen = Math.max(Math.sqrt(diag[0] * diag[0] + diag[1] * diag[1] + diag[2] * diag[2]), 0.0001);
            var dir = T.shading.dominantDir(lights, box.center);
            var depth = ((worldP[0] - box.min[0]) * dir[0] + (worldP[1] - box.min[1]) * dir[1] +
                (worldP[2] - box.min[2]) * dir[2]) / diagLen;
            depth = depth < 0 ? 0 : depth > 1 ? 1 : depth;
            var keep = 1 - 0.6 * depth;
            mul = [mul[0] * keep, mul[1] * keep, mul[2] * keep];
        }
        return { mul: mul, spec: spec };
    };

    // Vertex-stage GLSL: uniform block, attenuation, and the surface
    // function. World-space; three.js provides cameraPosition and
    // viewMatrix in every vertex shader. uShadeLightKind packs the light
    // kind into .x (0 point, 1 directional, 2 ambient, 3 empty slot).
    T.shading.VERTEX_LINES = [
        "uniform float uShadeAmbient;",
        "uniform float uShadeDiffuse;",
        "uniform float uShadeSpecAmt;",
        "uniform float uShadeSpecSharp;",
        "uniform float uShadeReflect;",
        "uniform float uShadeFalloff;",
        "uniform float uShadeNominal;",
        "uniform float uShadeShadowlet;",
        "uniform vec3 uShadeBoxMin;",
        "uniform vec3 uShadeBoxMax;",
        "uniform vec3 uShadeLightDir;",
        "uniform float uShadeLightCount;",
        "uniform vec3 uShadeLightPos[4];",
        "uniform vec3 uShadeLightColor[4];",
        "uniform vec3 uShadeLightKind[4];",
        "float shadeAtten(float dist) {",
        "float n = max(uShadeNominal, 0.0001);",
        "if (uShadeFalloff < 0.5) { return n / (n + dist); }",
        "else if (uShadeFalloff < 1.5) { float q = n / max(dist, 0.0001); return min(q * q, 4.0); }",
        "else if (uShadeFalloff < 2.5) { float q2 = n / max(dist, 0.0001); return min(q2 * q2 * q2, 8.0); }",
        "return 1.0;",
        "}",
        "vec3 shadeSurface(vec3 worldP, out vec3 specOut) {",
        "vec3 mul = vec3(uShadeAmbient);",
        "vec3 spec = vec3(0.0);",
        "vec3 N = normalize(cameraPosition - worldP + vec3(0.0, 0.0, 0.0001));",
        "for (int li = 0; li < 4; li++) {",
        "if (float(li) >= uShadeLightCount) { break; }",
        "float kind = uShadeLightKind[li].x;",
        "vec3 lCol = uShadeLightColor[li];",
        "if (kind > 1.5) { mul += lCol * 0.5; }",
        "else {",
        "vec3 toL; float dist = 0.0;",
        "if (kind < 0.5) {",
        "toL = uShadeLightPos[li] - worldP;",
        "dist = length(toL);",
        "toL = dist > 0.0001 ? toL / dist : N;",
        "} else {",
        "toL = uShadeLightPos[li];",
        "}",
        "float atten = shadeAtten(dist);",
        "float ndl = max(dot(N, toL), 0.0);",
        "mul += lCol * (uShadeDiffuse * atten * (0.35 + 0.65 * ndl));",
        "mul += lCol * (uShadeReflect * 0.25 * atten);",
        "vec3 hv = normalize(toL + N);",
        "float s = pow(max(dot(N, hv), 0.0), mix(1.0, 128.0, clamp(uShadeSpecSharp, 0.0, 1.0))) * uShadeSpecAmt * atten;",
        "spec += lCol * s;",
        "}",
        "}",
        "if (uShadeShadowlet > 0.5) {",
        "vec3 diag = uShadeBoxMax - uShadeBoxMin;",
        "float diagLen = max(length(diag), 0.0001);",
        "float depth = clamp(dot(worldP - uShadeBoxMin, uShadeLightDir) / diagLen, 0.0, 1.0);",
        "mul *= (1.0 - 0.6 * depth);",
        "}",
        "specOut = spec;",
        "return mul;",
        "}",
    ];

    // Vertex-main snippet applying the model to vColor. worldExpr is a GLSL
    // expression for the particle world position ("position" for Form,
    // "worldPos" for Particular). No effect unless USE_SHADING is defined.
    T.shading.applyLines = function (worldExpr) {
        return [
            "#ifdef USE_SHADING",
            "vec3 shadeSpecTmp;",
            "vColor.rgb = vColor.rgb * shadeSurface(" + worldExpr + ", shadeSpecTmp) + shadeSpecTmp;",
            "#endif",
        ];
    };
})();
