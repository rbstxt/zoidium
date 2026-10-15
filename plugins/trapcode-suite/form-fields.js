// OpenZoid Trapcode Suite — Form deformations and frame update.
/*
 * form-fields.js
 *
 * The Form deformation pass: strings, palettes, disperse,
 * fractal, spherical and audio deformations, vertex colors, and
 * the per-frame update(e). The methods extend
 * PZ.object3d.form.instance, defined in form.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var ROTATION_ORDERS = T.formShared.rotationOrders;
    var rand = T.formSampling.rand;
    var clamp01 = T.formSampling.clamp01;
    var hash3 = T.formSampling.hash3;
    var smoothNoise = T.formSampling.smoothNoise;
    var fbm = T.formSampling.fbm;
    var sampleMap = T.formSampling.sampleMap;
    var MAP_RGBA = T.formSampling.MAP_RGBA;
    var SPHERE_OUT = T.formSampling.SPHERE_OUT;

    PZ.object3d.form.instance.prototype.layerSample = function (property) {
        var value = property ? property.get(PZ.trapcode.currentTime) : null;
        return this._assets.ready("layer", value);
    };
    // Form "Strings" controls. Density scales how many of the neighbour
    // pairs connect (15 reproduces the legacy topology exactly); size
    // raises string opacity (WebGL ignores line width, so size cannot
    // widen lines); size random varies per-string brightness instead;
    // position distribution rehashes which pairs connect. All default to
    // the legacy look. Reads are guarded for saves from before them.
    PZ.object3d.form.instance.prototype.stringParams = function () {
        var t = PZ.trapcode.currentTime;
        var base = this.properties.base;
        var num = function (key, fallback) {
            try {
                if (!base || !base[key]) return fallback;
                var v = base[key].get(t);
                return typeof v === "number" && isFinite(v) ? v : fallback;
            } catch (_error) {
                return fallback;
            }
        };
        return {
            size: num("stringSize", 0),
            density: num("stringDensity", 15),
            sizeRandom: num("stringSizeRandom", 0),
            position: num("stringPosition", 0),
        };
    };
    PZ.object3d.form.instance.prototype.stringKey = function (counts, on) {
        var p = this.stringParams();
        return counts.join(",") + "|" + on + "|" + [p.size, p.density, p.sizeRandom, p.position].join(",");
    };
    PZ.object3d.form.instance.prototype.rebuildStrings = function (counts, on) {
        var params = this.stringParams();
        this._stringKey = counts.join(",") + "|" + on + "|" +
            [params.size, params.density, params.sizeRandom, params.position].join(",");
        this._stringSize = params.size;
        this.strings.visible = on;
        if (!on) return;
        var nx = counts[0];
        var ny = counts[1];
        var nz = counts[2];
        var count = nx * ny * nz;
        var indices = [];
        // Per-point brightness from String size random: each emitted
        // segment votes a hash onto both endpoints; points average their
        // votes. sizeRandom 0 leaves every point at exactly 1.
        var brightSum = new Float32Array(count);
        var brightCount = new Float32Array(count);
        var jitter = Math.min(Math.max(params.sizeRandom, 0), 10) * 0.2;
        // Legacy per-axis connection odds; density 15 keeps them whole.
        var densF = params.density < 0 ? 0 : params.density > 30 ? 2 : params.density / 15;
        var probs = [0.98 * densF, 0.98 * densF, 0.5 * densF];
        var rehash = params.position * 7.13;
        var segs = 0;
        function id(x, y, z) {
            return z * nx * ny + y * nx + x;
        }
        // Shared Form string-network hash (zoidium/shared/random.js). Pinned
        // bit-for-bit by test/migrate-shared-pins.test.js.
        function srand(i) {
            return ZoidiumPluginApis.random.formSrand(i);
        }
        function link(a, b) {
            indices.push(a, b);
            var h = srand(segs * 3.7 + 11.1 + rehash) - 0.5;
            brightSum[a] += h;
            brightSum[b] += h;
            brightCount[a]++;
            brightCount[b]++;
            segs++;
        }
        for (var z = 0; z < nz; z++) {
            for (var y = 0; y < ny; y++) {
                for (var x = 0; x < nx; x++) {
                    var a = id(x, y, z);
                    if (x + 1 < nx && srand(a * 3 + x + rehash) < probs[0]) link(a, id(x + 1, y, z));
                    if (y + 1 < ny && srand(a * 3 + y + 1 + rehash) < probs[1]) link(a, id(x, y + 1, z));
                    if (z + 1 < nz && srand(a * 3 + z + 2 + rehash) < probs[2]) link(a, id(x, y, z + 1));
                }
            }
        }
        var pointBright = new Float32Array(count).fill(1);
        if (jitter !== 0) {
            for (var p = 0; p < count; p++) {
                if (brightCount[p] > 0) pointBright[p] = 1 + (brightSum[p] / brightCount[p]) * jitter;
            }
        }
        if (this.strings.geometry) this.strings.geometry.dispose();
        var geometry = new THREE.BufferGeometry();
        geometry.setIndex(indices);
        geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        geometry.addAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        this.strings.geometry = geometry;
        this._stringBright = pointBright;
    };
    PZ.object3d.form.instance.prototype.updatePalettes = function () {
        var t = PZ.trapcode.currentTime;
        var particle = this.properties.particle;
        var colorOver = particle.colorOver.get(t);
        if (this._colorSig !== T.signature(colorOver)) {
            this._colorSig = T.signature(colorOver);
            T.fillGradient(this.palettes.colorOver, colorOver);
        }
        var sizeCurve = particle.sizeCurve.get(t);
        var sizeEnabled = particle.sizeOverEnabled.get(t);
        if (this._sizeSig !== sizeEnabled + "|" + T.signature(sizeCurve)) {
            this._sizeSig = sizeEnabled + "|" + T.signature(sizeCurve);
            T.fillCurve(this.palettes.sizeOver, sizeCurve, sizeEnabled);
        }
        var opacityCurve = particle.opacityCurve.get(t);
        var opacityEnabled = particle.opacityOverEnabled.get(t);
        if (this._opacitySig !== opacityEnabled + "|" + T.signature(opacityCurve)) {
            this._opacitySig = opacityEnabled + "|" + T.signature(opacityCurve);
            T.fillCurve(this.palettes.opacityOver, opacityCurve, opacityEnabled);
        }
    };
    PZ.object3d.form.instance.prototype.applyDeformations = function (count, audio) {
        var audioMult = audio || { disperse: 1, twist: 1, fractal: 1 };
        var out = this.outPositions;
        out.set(this.basePositions);
        var t = PZ.trapcode.currentTime;
        var base = this.properties.base;
        var disperse = this.properties.disperse;
        var spherical = this.properties.spherical;
        var fractal = this.properties.fractal;
        var seed = fractal.randomSeed.get(t);

        var rotation = base.rotation.get(t);
        var basePosition = base.position.get(t);
        var cosX = Math.cos((rotation[0] * Math.PI) / 180);
        var sinX = Math.sin((rotation[0] * Math.PI) / 180);
        var cosY = Math.cos((rotation[1] * Math.PI) / 180);
        var sinY = Math.sin((rotation[1] * Math.PI) / 180);
        var cosZ = Math.cos((rotation[2] * Math.PI) / 180);
        var sinZ = Math.sin((rotation[2] * Math.PI) / 180);

        var disperseAmount = disperse.disperse.get(t) * audioMult.disperse;
        var twist = disperse.twist.get(t) * audioMult.twist;
        var sphereStrength = spherical.strength.get(t) / 100;
        var sphereCenterRaw = spherical.position.get(t);
        var sphereRadius = spherical.radius.get(t);
        var sphereFeather = Math.max(spherical.feather.get(t) / 100, 0.001);
        var sphereScale = [
            Math.max(spherical.scaleX.get(t) / 100, 0.001),
            Math.max(spherical.scaleY.get(t) / 100, 0.001),
            Math.max(spherical.scaleZ.get(t) / 100, 0.001),
        ];
        var sphereRot = [
            (spherical.rotationX.get(t) * Math.PI) / 180,
            (spherical.rotationY.get(t) * Math.PI) / 180,
            (spherical.rotationZ.get(t) * Math.PI) / 180,
        ];
        var sphere2On = spherical.sphereEnabled.get(t) === 1;
        var sphere2Strength = spherical.sphere2Strength.get(t) / 100;
        var sphere2CenterRaw = spherical.sphere2Position.get(t);
        var sphere2Radius = spherical.sphere2Radius.get(t);
        var fractalAmount = fractal.displace.get(t) * audioMult.fractal;
        var fractalY = fractal.yDisplace.get(t) * audioMult.fractal;
        var fractalZ = fractal.zDisplace.get(t) * audioMult.fractal;
        var dispMode = fractal.displacementMode.get(t);
        var affectSize = fractal.affectSize.get(t);
        var affectOpacity = fractal.affectOpacity.get(t);
        var fScale = fractal.fScale.get(t);
        var fTime = t / 30;
        var fluid = this.properties.fluid;
        var kaleido = this.properties.kaleidospace;
        var fluidOn = fluid.fluidMotion.get(t) === 1;
        var buoyancy = fluidOn ? fluid.buoyancy.get(t) : 0;
        var swirlOn = fluidOn && fluid.randomSwirl.get(t) === 1;
        var swirlScale = fluidOn ? fluid.swirlScale.get(t) : 10;
        var fluidSeed = fluidOn ? fluid.randomSeed.get(t) : 0;
        var vortexStrength = fluidOn ? fluid.vortexStrength.get(t) / 100 : 0;
        var vortexCore = fluidOn ? fluid.vortexCoreSize.get(t) : 50;
        var vortexTilt = fluidOn ? (fluid.vortexTilt.get(t) * Math.PI) / 180 : 0;
        var vortexRotate = fluidOn ? (fluid.vortexRotate.get(t) * Math.PI) / 180 : 0;
        var mirrorX = kaleido.mirrorX.get(t) === 1;
        var mirrorY = kaleido.mirrorY.get(t) === 1;
        var mirrorZ = kaleido.mirrorZ.get(t) === 1;
        var kaleidoBehaviour = kaleido.behaviour.get(t);
        var kaleidoCenterRaw = kaleido.center.get(t);
        // Sphere / kaleido positions are authored in comp pixels (default 720,540).
        // Form particles live around local origin, so map comp coords -> local.
        var compToLocal = function (c) {
            if (!c) return [0, 0, 0];
            var looksLikeComp = Math.abs(c[0]) > 400 || Math.abs(c[1]) > 400;
            if (looksLikeComp) return [c[0] - 720, -(c[1] - 540), c[2] || 0];
            return [c[0], c[1], c[2] || 0];
        };
        var sphereCenter = compToLocal(sphereCenterRaw);
        var sphere2Center = compToLocal(sphere2CenterRaw);
        var kaleidoCenter = compToLocal(kaleidoCenterRaw);
        var fractalParams = {
            complexity: fractal.complexity.get(t),
            octaveMultiplier: fractal.octaveMultiplier.get(t),
            octaveScale: fractal.octaveScale.get(t),
            flowX: fractal.flowX.get(t),
            flowY: fractal.flowY.get(t),
            flowZ: fractal.flowZ.get(t),
            flowEvolution: fractal.flowEvolution.get(t) * 0.01,
            fractalSum: fractal.fractalSum.get(t),
            gamma: fractal.gamma.get(t),
            addSubtract: fractal.addSubtract.get(t),
            min: fractal.min.get(t),
            max: fractal.max.get(t),
            seed: seed,
            sum: fractal.fractalSum.get(t),
        };
        var fractalScale = Math.max(fScale, 0.01) * 0.0005;
        var useFractal = fractalAmount !== 0 || fractalY !== 0 || fractalZ !== 0 || affectSize !== 0 || affectOpacity !== 0;
        var maps = this.properties.layerMaps;
        var fractalStrengthSample = maps.fractalStrengthEnabled.get(t) === 1 ? this.layerSample(maps.fractalStrengthLayer) : null;
        var displacementSample = maps.displacementEnabled.get(t) === 1 ? this.layerSample(maps.displacementLayer) : null;
        var rotateSample = maps.rotateEnabled.get(t) === 1 ? this.layerSample(maps.rotateLayer) : null;
        var colorMapSample = maps.colorAlphaEnabled.get(t) === 1 ? this.layerSample(maps.colorAlphaLayer) : null;
        var sizeMapSample = maps.sizeEnabled.get(t) === 1 ? this.layerSample(maps.sizeLayer) : null;
        var disperseMapSample = maps.disperseEnabled.get(t) === 1 ? this.layerSample(maps.disperseLayer) : null;
        var useColors = !!colorMapSample;
        this.setVertexColors(useColors);

        var sizeMod = this.sizeModArray;
        var alphaMod = this.alphaModArray;
        var colors = this.colorArray;
        for (var zz = 0; zz < count; zz++) {
            sizeMod[zz] = 1;
            alphaMod[zz] = 1;
        }

        var cosSX = Math.cos(-sphereRot[0]);
        var sinSX = Math.sin(-sphereRot[0]);
        var cosSY = Math.cos(-sphereRot[1]);
        var sinSY = Math.sin(-sphereRot[1]);
        var cosSZ = Math.cos(-sphereRot[2]);
        var sinSZ = Math.sin(-sphereRot[2]);
        // Writes the displaced point to SPHERE_OUT.
        var applySphere = function (px, py, pz, cx, cy, cz, strength, radius, featherAmt) {
            var dx = px - cx;
            var dy = py - cy;
            var dz = pz - cz;
            // inverse rotate into ellipsoid space
            var ry = dy * cosSX - dz * sinSX;
            var rz = dy * sinSX + dz * cosSX;
            dy = ry;
            dz = rz;
            var rx = dx * cosSY + dz * sinSY;
            rz = -dx * sinSY + dz * cosSY;
            dx = rx;
            dz = rz;
            rx = dx * cosSZ - dy * sinSZ;
            ry = dx * sinSZ + dy * cosSZ;
            dx = rx;
            dy = ry;
            // inverse scale
            var ex = dx / sphereScale[0];
            var ey = dy / sphereScale[1];
            var ez = dz / sphereScale[2];
            var dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
            var sr = Math.max(radius, 0.0001);
            var feather = Math.max(featherAmt, 0.001);
            var influence;
            if (dist <= sr) influence = 1;
            else influence = Math.max(0, 1 - (dist - sr) / Math.max(sr * feather, 0.0001));
            SPHERE_OUT[0] = px;
            SPHERE_OUT[1] = py;
            SPHERE_OUT[2] = pz;
            if (influence <= 0 || strength === 0) return;
            var ox = px - cx;
            var oy = py - cy;
            var oz = pz - cz;
            var olen = Math.sqrt(ox * ox + oy * oy + oz * oz);
            if (olen < 0.0001) {
                ox = 0;
                oy = 1;
                oz = 0;
                olen = 1;
            }
            var push = strength * influence * sr;
            SPHERE_OUT[0] = px + (ox / olen) * push;
            SPHERE_OUT[1] = py + (oy / olen) * push;
            SPHERE_OUT[2] = pz + (oz / olen) * push;
        };
        var swirlFreq = Math.max(swirlScale, 0.01) * 0.002;
        var buoyOffset = buoyancy * (t / 30) * 4.0;
        var vortexCorePx = 20 + (Math.max(0, Math.min(100, vortexCore)) / 100) * 220;
        var tSec = t / 30;

        for (var i = 0; i < count; i++) {
            var x = out[i * 3];
            var y = out[i * 3 + 1];
            var z = out[i * 3 + 2];

            var u = 0.5 + x * 0.001;
            var v = 0.5 + y * 0.001;

            // deterministic per-particle random offsets (seeded, decorrelated per axis)
            var r1 = hash3(i, 0, fluidSeed, seed) - 0.5;
            var r2 = hash3(i, 1, fluidSeed, seed) - 0.5;
            var r3 = hash3(i, 2, fluidSeed, seed) - 0.5;

            var dispMod = 1;
            var fracMod = 1;
            if (disperseMapSample && sampleMap(disperseMapSample, u, v)) {
                dispMod = (MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3;
            }
            if (fractalStrengthSample && sampleMap(fractalStrengthSample, u, v)) {
                fracMod = (MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3;
            }

            if (disperseAmount !== 0) {
                x += r1 * disperseAmount * dispMod;
                y += r2 * disperseAmount * dispMod;
                z += r3 * disperseAmount * dispMod;
            }

            if (useFractal) {
                var nx0 = x * fractalScale;
                var ny0 = y * fractalScale;
                var nz0 = z * fractalScale;
                var nMain = 0;
                var nX = 0;
                var nY = 0;
                var nZ = 0;
                if (dispMode === 1) {
                    nX = fbm(nx0, ny0, nz0, fractalParams, fTime);
                    nY = fbm(nx0 + 31.7, ny0 + 17.3, nz0 + 11.1, fractalParams, fTime);
                    nZ = fbm(nx0 + 57.3, ny0 + 43.7, nz0 + 23.9, fractalParams, fTime);
                    nMain = (nX + nY + nZ) / 3;
                } else {
                    nMain = fbm(nx0, ny0, nz0, fractalParams, fTime);
                    nX = nMain;
                    nY = nMain;
                    nZ = nMain;
                }
                var fAmt = fractalAmount * fracMod;
                var fYAmt = fractalY * fracMod;
                var fZAmt = fractalZ * fracMod;
                if (dispMode === 3) {
                    // SCALE mode: uniform scale around origin driven by noise.
                    // Displace acts as % scale (100 = +/-100% at full noise).
                    var sAmt = (fAmt !== 0 ? fAmt : fYAmt !== 0 ? fYAmt : fZAmt) / 100;
                    var sF = 1 + nMain * 0.5 * sAmt;
                    if (sF < 0.01) sF = 0.01;
                    x *= sF;
                    y *= sF;
                    z *= sF;
                } else if (dispMode === 2) {
                    // SPHERICAL: push along radial direction
                    var rl = Math.sqrt(x * x + y * y + z * z);
                    if (rl < 0.0001) {
                        x += nMain * fAmt;
                    } else {
                        var ux = x / rl;
                        var uy = y / rl;
                        var uz = z / rl;
                        var avg = (fAmt + fYAmt + fZAmt) / 3;
                        var pushS = nMain * avg;
                        x += ux * pushS;
                        y += uy * pushS;
                        z += uz * pushS;
                    }
                } else {
                    // 0 = XYZ linked (single noise), 1 = independent XYZ
                    x += nX * fAmt;
                    y += nY * fYAmt;
                    z += nZ * fZAmt;
                }
                // Affect size / opacity driven by same fractal value
                if (affectSize !== 0) {
                    var sm = 1 + nMain * 0.5 * (affectSize / 100);
                    if (sm < 0.05) sm = 0.05;
                    sizeMod[i] = sm;
                }
                if (affectOpacity !== 0) {
                    var am = 1 + nMain * 0.5 * (affectOpacity / 100);
                    if (am < 0) am = 0;
                    if (am > 1) am = 1;
                    alphaMod[i] = am;
                }
                // Layer-map size modulation
                if (sizeMapSample && sampleMap(sizeMapSample, u, v)) {
                    var lum = (MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3;
                    sizeMod[i] *= 0.2 + lum * 1.6;
                    alphaMod[i] *= 0.25 + MAP_RGBA[3] * 0.75;
                }
            } else if (sizeMapSample && sampleMap(sizeMapSample, u, v)) {
                var lum2 = (MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3;
                sizeMod[i] = 0.2 + lum2 * 1.6;
                alphaMod[i] = 0.25 + MAP_RGBA[3] * 0.75;
            }

            // Layer-map displacement (along normal-ish Z + slight XY)
            if (displacementSample && sampleMap(displacementSample, u, v)) {
                var dlum = (MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3 - 0.5;
                x += dlum * 60;
                y += dlum * 60;
                z += (MAP_RGBA[3] - 0.5) * 120;
            }

            // Fluid: buoyancy + random swirl + vortex
            if (fluidOn) {
                if (buoyancy !== 0) y += buoyOffset;
                if (swirlOn) {
                    var sxn = smoothNoise(y * swirlFreq + fluidSeed, z * swirlFreq, fTime * 0.7 + i * 0.0001, fluidSeed);
                    var syn = smoothNoise(z * swirlFreq, x * swirlFreq + fluidSeed, fTime * 0.7, fluidSeed + 5.2);
                    var szn = smoothNoise(x * swirlFreq, y * swirlFreq, fTime * 0.7, fluidSeed + 9.1);
                    var swAmt = Math.max(swirlScale, 0) * 3.0;
                    x += sxn * swAmt;
                    y += syn * swAmt;
                    z += szn * swAmt;
                }
                if (vortexStrength !== 0) {
                    var cT = Math.cos(vortexTilt);
                    var sT = Math.sin(vortexTilt);
                    var vy2 = y * cT - z * sT;
                    var vz2 = y * sT + z * cT;
                    var rad = Math.sqrt(x * x + vz2 * vz2);
                    var fall = Math.exp(-(rad * rad) / Math.max(vortexCorePx * vortexCorePx, 1));
                    var vang = vortexStrength * fall * (1.0 + tSec * 0.6) + vortexRotate;
                    var cv = Math.cos(vang);
                    var sv = Math.sin(vang);
                    var nxv = x * cv - vz2 * sv;
                    var nzv = x * sv + vz2 * cv;
                    x = nxv;
                    y = vy2 * cT + nzv * sT;
                    z = -vy2 * sT + nzv * cT;
                }
            }

            if (twist !== 0) {
                var rotExtra = 0;
                if (rotateSample && sampleMap(rotateSample, u, v)) {
                    rotExtra = ((MAP_RGBA[0] + MAP_RGBA[1] + MAP_RGBA[2]) / 3 - 0.5) * 180;
                }
                var angle = (y * 0.01) * ((twist + rotExtra) * Math.PI) / 180;
                var ca = Math.cos(angle);
                var sa = Math.sin(angle);
                var nx = x * ca - z * sa;
                var nz = x * sa + z * ca;
                x = nx;
                z = nz;
            }

            if (sphereStrength !== 0) {
                applySphere(x, y, z, sphereCenter[0], sphereCenter[1], sphereCenter[2], sphereStrength, sphereRadius, sphereFeather);
                x = SPHERE_OUT[0];
                y = SPHERE_OUT[1];
                z = SPHERE_OUT[2];
            }
            if (sphere2On && sphere2Strength !== 0) {
                applySphere(x, y, z, sphere2Center[0], sphere2Center[1], sphere2Center[2], sphere2Strength, sphere2Radius, sphereFeather);
                x = SPHERE_OUT[0];
                y = SPHERE_OUT[1];
                z = SPHERE_OUT[2];
            }

            // Kaleidospace
            if (mirrorX || mirrorY || mirrorZ) {
                if (kaleidoBehaviour === 1) {
                    // mirror and keep: distribute folded copies on both sides
                    var keep = (i % 2 === 0) ? 1 : -1;
                    if (mirrorX) x = kaleidoCenter[0] + Math.abs(x - kaleidoCenter[0]) * keep;
                    if (mirrorY) y = kaleidoCenter[1] + Math.abs(y - kaleidoCenter[1]) * keep;
                    if (mirrorZ) z = kaleidoCenter[2] + Math.abs(z - kaleidoCenter[2]) * keep;
                } else {
                    if (mirrorX) x = kaleidoCenter[0] + Math.abs(x - kaleidoCenter[0]);
                    if (mirrorY) y = kaleidoCenter[1] + Math.abs(y - kaleidoCenter[1]);
                    if (mirrorZ) z = kaleidoCenter[2] + Math.abs(z - kaleidoCenter[2]);
                }
            }

            var ty = y * cosX - z * sinX;
            var tz = y * sinX + z * cosX;
            y = ty;
            z = tz;
            var tx = x * cosY + z * sinY;
            tz = -x * sinY + z * cosY;
            x = tx;
            z = tz;
            tx = x * cosZ - y * sinZ;
            ty = x * sinZ + y * cosZ;
            x = tx;
            y = ty;

            out[i * 3] = x + basePosition[0];
            out[i * 3 + 1] = y + basePosition[1];
            out[i * 3 + 2] = z + basePosition[2];

            if (useColors) {
                if (sampleMap(colorMapSample, u, v)) {
                    colors[i * 3] = MAP_RGBA[0];
                    colors[i * 3 + 1] = MAP_RGBA[1];
                    colors[i * 3 + 2] = MAP_RGBA[2];
                } else {
                    colors[i * 3] = 1;
                    colors[i * 3 + 1] = 1;
                    colors[i * 3 + 2] = 1;
                }
            }
        }

        var geometry = this.points.geometry;
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.aSizeM.needsUpdate = true;
        geometry.attributes.aAlphaM.needsUpdate = true;
        if (useColors) {
            this.colorAttribute.needsUpdate = true;
        }
        if (this.strings && this.strings.visible) {
            this.updateStrings(count);
        }
    };
    // Copies the displaced lattice into the string geometry and colors each
    // point from the color-over ramp (sampled from the palette texture),
    // scaled by the per-string brightness from String size random.
    PZ.object3d.form.instance.prototype.updateStrings = function (count) {
        var geometry = this.strings.geometry;
        geometry.attributes.position.array.set(this.outPositions);
        geometry.attributes.position.needsUpdate = true;
        var ramp = this.palettes.colorOver.image.data;
        var cols = geometry.attributes.color.array;
        var pointBright = this._stringBright || null;
        for (var s = 0; s < count; s++) {
            var ri = Math.round((count > 1 ? s / (count - 1) : 0) * 255) * 4;
            var b = pointBright && s < pointBright.length ? pointBright[s] : 1;
            cols[s * 3] = (ramp[ri] / 255) * b;
            cols[s * 3 + 1] = (ramp[ri + 1] / 255) * b;
            cols[s * 3 + 2] = (ramp[ri + 2] / 255) * b;
        }
        geometry.attributes.color.needsUpdate = true;
    };
    PZ.object3d.form.instance.prototype.setVertexColors = function (on) {
        if (on === this._useVColor) return;
        this._useVColor = on;
        if (on) this.material.defines.USE_VCOLOR = 1;
        else delete this.material.defines.USE_VCOLOR;
        this.material.needsUpdate = true;
    };
    PZ.object3d.form.instance.prototype.update = function (e) {
        PZ.trapcode.setTime(e);
        this._time = e;
        if (!this.material) this.rebuildMaterial();
        var t = PZ.trapcode.currentTime;
        var base = this.properties.base;
        var counts = this.gridCounts();
        var count = counts[0] * counts[1] * counts[2];
        this.requestAssets();
        var signature = this.baseSignature(counts);
        if (signature !== this._baseSig) this.rebuildBase(counts, signature);
        var stringsOn = base.stringEnabled.get(t) === 1;
        if (this._stringKey !== this.stringKey(counts, stringsOn)) this.rebuildStrings(counts, stringsOn);
        this.updatePalettes();
        // Audio reactors (deterministic offline levels; all multipliers
        // are 1 while no reactor is on, so existing projects render
        // identically). Reactor 1 drives size, 2 opacity, 3 disperse,
        // 4 fractal displacement, 5 twist.
        var formAudio = this.properties.audio;
        var audioLevel = this.audioLevel(e);
        var audioMult = { disperse: 1, twist: 1, fractal: 1 };
        var reactorSize = 1;
        var reactorOpacity = 1;
        if (formAudio && audioLevel > 0) {
            if (formAudio.reactor1.get(t) === 1) reactorSize = 1 + audioLevel;
            if (formAudio.reactor2.get(t) === 1) reactorOpacity = 1 + audioLevel;
            if (formAudio.reactor3.get(t) === 1) audioMult.disperse = 1 + audioLevel;
            if (formAudio.reactor4.get(t) === 1) audioMult.fractal = 1 + audioLevel;
            if (formAudio.reactor5.get(t) === 1) audioMult.twist = 1 + audioLevel;
        }
        this.applyDeformations(count, audioMult);

        var particle = this.properties.particle;
        var u = this.material.uniforms;
        u.size.value = particle.size.get(t) * reactorSize;
        u.sizeRandom.value = particle.sizeRandom.get(t) / 100;
        u.opacity.value = Math.min(1, particle.opacity.get(t) / 100 * reactorOpacity);
        var tint = particle.color.get(t);
        u.colorTint.value.set(tint[0], tint[1], tint[2], 1);
        // Per-particle lighting from the scene lights (Shading group). The
        // box is rebuilt only while shading is on; while off the call
        // below only clears the define, so legacy frames are untouched.
        var shadeGroup = this.properties.shading;
        var shadeOn = false;
        try {
            shadeOn = shadeGroup && shadeGroup.shading.get(t) === 1;
        } catch (_shade) { shadeOn = false; } // Absent on old saves: shading stays off.
        T.shading.update(this.material, shadeGroup, this.threeObj,
            shadeOn ? T.shading.boxFromPositions(this.outPositions, count) : null);
        var additive = particle.blending.get(t) === 1;
        this.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
        if (this.stringMaterial) {
            // String size raises line opacity (line width is fixed at 1:
            // WebGL ignores wider lines); size 0 keeps the legacy look.
            var stringBoost = 1 + Math.max(this._stringSize || 0, 0) * 0.05;
            this.stringMaterial.opacity = stringsOn ? Math.min(1, particle.opacity.get(t) / 100 * stringBoost) : 0.5;
            this.stringMaterial.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
        }
        var transform = this.properties.transform;
        this.threeObj.position.set(transform.offsetX.get(t), transform.offsetY.get(t), transform.offsetZ.get(t));
        var scale = transform.scale.get(t) / 100;
        this.threeObj.scale.set(scale, scale, scale);
        var rotationOrder = transform.rotationOrder.get();
        this.threeObj.rotation.set(
            transform.rotationX.get(t) * Math.PI / 180,
            transform.rotationY.get(t) * Math.PI / 180,
            transform.rotationZ.get(t) * Math.PI / 180,
            ROTATION_ORDERS.indexOf(rotationOrder) >= 0 ? rotationOrder : "XYZ"
        );
        this._renderedRevision = this._assets.revision;
    };
    // Waits for every asset this frame needs, then makes sure the frame was
    // computed with the settled data.
    // Preview frame cache probe: the last update used settled assets and no
    // asset this frame needs is still loading (see plugins/core/output-frame-cache.js).
    PZ.object3d.form.instance.prototype.zoidiumFrameReady = function () {
        var loading = this.requestAssets().some(function (entry) { return entry.status === "loading"; });
        return !loading && !!this.material && this._renderedRevision === this._assets.revision;
    };
    PZ.object3d.form.instance.prototype.prepare = async function (e) {
        PZ.trapcode.setTime(e);
        var waits = this.requestAssets().map(function (entry) { return entry.promise; });
        if (this.texture && this.texture.loading) waits.push(this.texture.loading);
        await Promise.all(waits);
        if (!this.material || this._time !== e || this._renderedRevision !== this._assets.revision) {
            this.update(e);
        }
    };
})();
