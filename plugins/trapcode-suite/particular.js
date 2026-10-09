// OpenZoid Trapcode Suite — Particular (ported verbatim from particular.js).
/*
 * particular.js
 *
 * A Trapcode Particular style particle system implemented as a native
 * PZ.object3d type so it can live inside a normal 3D Scene layer next to
 * Shape / Light / Model objects. It plugs into the existing property,
 * keyframe, expression, material, camera, DOF and motion blur systems.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var clamp = T.clamp;
    var parseColor = T.parseColor;
    var colorBrightness = T.colorBrightness;
    var gradientColor = T.gradientColor;
    var curveValue = T.curveValue;
    var fillGradient = T.fillGradient;
    var fillCurve = T.fillCurve;
    var signature = T.signature;
    var createPalette = T.createPalette;

    // Guarded property reads for parameters added after earlier saves:
    // objects deserialized from old projects lack these controls, so every
    // new read falls back to the definition default instead of throwing.
    function tnum(obj, key, fb) {
        try {
            if (!obj || !obj[key]) return fb;
            var v = obj[key].get(PZ.trapcode.currentTime);
            return typeof v === "number" && isFinite(v) ? v : fb;
        } catch (err) {
            return fb;
        }
    }

    var VERTEX_SHADER = [
        "uniform vec2 resolution;",
        "uniform float time;",
        "uniform float rate;",
        "uniform float lifetime;",
        "uniform float lifeRandom;",
        "uniform vec3 accel;",
        "uniform vec3 ipos;",
        "uniform vec3 ivel;",
        "uniform float speed;",
        "uniform float emitterSize;",
        "uniform float emitterShape;",
        "uniform float behavior;",
        "uniform float burstInterval;",
        "uniform float vspread;",
        "uniform float size;",
        "uniform float sizeRandom;",
        "uniform float glow;",
        "uniform vec4 colorTint;",
        "uniform vec3 emitterVel;",
        "uniform float emitterVelAmt;",
        "uniform float massDiv;",
        "uniform float orient;",
        "uniform float orientFade;",
        "uniform float sceneFps;",
        "uniform vec3 rotBase;",
        "uniform vec3 spinRate;",
        "uniform float spinRnd;",
        "uniform float spinRateRnd;",
        "uniform float spinDist;",
        "uniform float rotAir;",
        "uniform float stretch;",
        "varying vec2 vMotion;",
        "varying float vElong;",
        "varying float vRot;",
        "varying vec2 vTilt;",
        "uniform sampler2D colorOverLife;",
        "uniform sampler2D sizeOverLife;",
        "uniform sampler2D opacityOverLife;",
        "uniform float audioLevel;",
        "uniform float layerColorMix;",
        "uniform float layerSizeStrength;",
        "#ifdef USE_LAYER_COLOR",
        "uniform sampler2D layerColor;",
        "#endif",
        "#ifdef USE_LAYER_SIZE",
        "uniform sampler2D layerSize;",
        "#endif",
        "#ifdef USE_CPU",
        "attribute float life;",
        "attribute vec3 velocity;",
        "attribute float pid;",
        "#else",
        "attribute float pid;",
        "#endif",
        "varying vec4 vColor;",
        "varying float vGlow;",
        "float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }",
        "void main()",
        "{",
        "#ifdef USE_CPU",
        "float rawPhase = life;",
        "float alive = step(0.0, rawPhase);",
        "float phase = clamp(rawPhase, 0.0, 1.0);",
        "vec3 worldPos = position;",
        "#else",
        "float lifeScale = 1.0 + (rand(vec2(pid, 7.0)) - 0.5) * lifeRandom;",
        "float life = max(lifetime * lifeScale, 0.0001);",
        "float delay = pid / max(rate, 0.0001);",
        "float t;",
        "float alive;",
        "float age;",
        "float phase;",
        "if (behavior < 0.5) {",
        "t = time - delay;",
        "alive = step(0.0, t);",
        "age = mod(max(t, 0.0), life);",
        "phase = age / life;",
        "} else if (behavior < 1.5) {",
        "t = time;",
        "age = t;",
        "alive = step(0.0, t) * (1.0 - step(life, t));",
        "phase = clamp(age / life, 0.0, 1.0);",
        "age = min(max(age, 0.0), life);",
        "} else {",
        "float cycle = mod(time, max(burstInterval, 0.0001));",
        "t = cycle - delay;",
        "age = t;",
        "alive = step(0.0, t) * (1.0 - step(life, t));",
        "phase = clamp(max(age, 0.0) / life, 0.0, 1.0);",
        "age = min(max(age, 0.0), life);",
        "}",
        "vec3 jitter = vec3(rand(vec2(pid, 1.0)), rand(vec2(pid, 2.0)), rand(vec2(pid, 3.0))) - 0.5;",
        "vec3 jitter2 = vec3(rand(vec2(pid, 5.0)), rand(vec2(pid, 6.0)), rand(vec2(pid, 8.0))) - 0.5;",
        "vec3 emission = vec3(0.0);",
        "if (emitterShape > 0.5 && emitterShape < 1.5) emission = jitter * emitterSize;",
        "else if (emitterShape > 1.5 && emitterShape < 2.5) emission = normalize(jitter + vec3(0.0001, 0.0002, 0.0003)) * emitterSize * 0.5;",
        "vec3 rdir = normalize(jitter + vec3(0.0001, 0.0002, 0.0003));",
        "vec3 baseVel = length(ivel) > 0.0001 ? ivel : rdir * speed;",
        "vec3 vel = baseVel + emitterVel * emitterVelAmt + jitter2 * vspread;",
        "vec3 effAccel = accel / max(massDiv, 0.01);",
        "vec3 worldPos = ipos + emission + vel * age + effAccel * age * age * 0.5;",
        "#endif",
        "#ifdef USE_CPU",
        "vec3 wVel = velocity;",
        "float wAge = clamp(phase, 0.0, 1.0) * max(lifetime, 0.0001);",
        "float wPid = pid;",
        "#else",
        "vec3 wVel = vel;",
        "float wAge = age;",
        "float wPid = pid;",
        "#endif",
        "float wK = max(rotAir, 0.0);",
        "float wDamp = wK > 0.0001 ? (1.0 - exp(-wK * wAge)) / wK : wAge;",
        "float wR1 = rand(vec2(wPid, 11.0));",
        "float wR2 = rand(vec2(wPid, 12.0));",
        "float wR3 = rand(vec2(wPid, 13.0));",
        "float wR4 = rand(vec2(wPid, 14.0));",
        "float wRateScale = 1.0 + (wR4 - 0.5) * 2.0 * spinRateRnd * (0.5 + spinDist);",
        "float wSpinZ = rotBase.z + (wR1 - 0.5) * 6.2831853 * spinRnd + spinRate.z * wRateScale * wDamp;",
        "float wTiltX = max(cos(rotBase.x + spinRate.x * wRateScale * wDamp), 0.2);",
        "float wTiltY = max(cos(rotBase.y + spinRate.y * wRateScale * wDamp), 0.2);",
        "vec4 wMv = modelViewMatrix * vec4(worldPos, 1.0);",
        "vec4 wCa = projectionMatrix * wMv;",
        "vec4 wCb = projectionMatrix * (modelViewMatrix * vec4(worldPos + wVel * 0.016, 1.0));",
        "vec2 wSv = (wCb.xy / max(wCb.w, 0.0001) - wCa.xy / max(wCa.w, 0.0001));",
        "wSv.x *= resolution.x / max(resolution.y, 1.0);",
        "float wSl = length(wSv);",
        "float wSpd = wSl / 0.016;",
        "float wMAng = wSl > 0.00001 ? atan(wSv.y, wSv.x) : 0.0;",
        "float wFade = orientFade < 0.5 ? 1.0 : clamp(wAge * sceneFps / orientFade, 0.0, 1.0);",
        "float wBlend = orient * wFade;",
        "float wElong = 1.0 + stretch * min(wSpd * 0.9, 3.0) * wBlend;",
        "vMotion = vec2(cos(wMAng), sin(wMAng));",
        "vElong = wElong;",
        "vRot = mix(wSpinZ, wMAng, wBlend);",
        "vTilt = vec2(wTiltX, wTiltY);",
        "vec2 layerUv = clamp(vec2(0.5) + worldPos.xy * 0.001, 0.0, 1.0);",
        "vec4 layerSample = vec4(1.0);",
        "float layerSizeSample = 1.0;",
        "#ifdef USE_LAYER_COLOR",
        "layerSample = texture2D(layerColor, layerUv);",
        "#endif",
        "#ifdef USE_LAYER_SIZE",
        "layerSizeSample = texture2D(layerSize, layerUv).r;",
        "#endif",
        "vec4 lifeColor = texture2D(colorOverLife, vec2(phase, 0.0));",
        "float lifeSize = texture2D(sizeOverLife, vec2(phase, 0.0)).r;",
        "float lifeOpacity = texture2D(opacityOverLife, vec2(phase, 0.0)).r;",
        "vec3 baseRgb = mix(lifeColor.rgb, lifeColor.rgb * layerSample.rgb, layerColorMix);",
        "float layerAlpha = mix(1.0, layerSample.a, layerColorMix);",
        "float sizeCull = step(0.004, lifeSize);",
        "vColor = vec4(baseRgb * colorTint.rgb, lifeColor.a * colorTint.a * lifeOpacity * layerAlpha) * (alive * sizeCull);",
        "vGlow = glow;",
        "vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);",
        "#ifdef USE_CPU",
        "float pointSize = size * lifeSize * mix(1.0, layerSizeSample, layerSizeStrength);",
        "#else",
        "float pointSize = size * (1.0 + (rand(vec2(pid, 4.0)) - 0.5) * sizeRandom) * lifeSize * mix(1.0, layerSizeSample, layerSizeStrength);",
        "#endif",
        "pointSize *= max(audioLevel, 0.0001);",
        "pointSize *= mix(1.0, wElong, 0.85);",
        "gl_PointSize = max(pointSize * resolution.y * 0.5 * projectionMatrix[1][1] / max(-mvPosition.z, 1.0), 1.0);",
        "gl_Position = projectionMatrix * mvPosition;",
        "}",
    ].join("\n");

    var FRAGMENT_SHADER = [
        "uniform sampler2D image;",
        "uniform float opacity;",
        "varying vec4 vColor;",
        "varying float vGlow;",
        "varying vec2 vMotion;",
        "varying float vElong;",
        "varying float vRot;",
        "varying vec2 vTilt;",
        "void main()",
        "{",
        "vec2 pc = gl_PointCoord - 0.5;",
        "vec2 pt = vec2(pc.x / max(vTilt.x, 0.2), pc.y / max(vTilt.y, 0.2));",
        "float mAng = atan(vMotion.y, vMotion.x);",
        "float mc = cos(-mAng);",
        "float ms = sin(-mAng);",
        "vec2 mq = vec2(pt.x * mc - pt.y * ms, pt.x * ms + pt.y * mc);",
        "mq.x /= max(vElong, 1.0);",
        "float maskAmt = clamp(max(vElong - 1.0, (1.0 - min(vTilt.x, vTilt.y)) * 2.0), 0.0, 1.0);",
        "float mask = mix(1.0, smoothstep(0.5, 0.42, length(mq)), maskAmt);",
        "float rc = cos(-vRot);",
        "float rs = sin(-vRot);",
        "vec2 sp = vec2(pt.x * rc - pt.y * rs, pt.x * rs + pt.y * rc);",
        "vec4 tcolor = texture2D(image, sp + 0.5);",
        "vec3 rgb = tcolor.rgb * vColor.rgb + vColor.rgb * vGlow;",
        "gl_FragColor = vec4(rgb, tcolor.a * vColor.a * opacity * mask);",
        "if (gl_FragColor.a < 0.004) discard;",
        "}",
    ].join("\n");

    /* ------------------------------------------------------------------ */
    /* Deterministic CPU simulation                                       */
    /* ------------------------------------------------------------------ */
    //
    // The particle state at project time t is a pure function of the system
    // properties (including the random seed) and t. Frames can be evaluated in
    // any order, sparsely or repeatedly and give identical particles.
    //
    // - A fixed grid (SIM.STEP seconds) samples every property the simulation
    //   reads once per grid step ("row"). The grid starts at a pre-roll origin
    //   derived from the particle life at time 0, so the stream is already
    //   populated at t = 0. Negative times sample the row at time 0.
    // - Continuous emission integrates the flow rate over the grid, so births
    //   follow an animated rate: event k is born when the cumulative count
    //   reaches k + 1. Burst cycles start where the previous interval ends.
    //   Explode emits every particle at time 0.
    // - Each particle is integrated from its own birth to t in sub-steps of at
    //   most SIM.STEP, sampling forces from the row at each sub-step time.
    // - Random values are integer hashes of (seed, event key, channel).
    //
    // The row table is an append-only cache keyed by a serialization of every
    // input. Extending it never changes existing rows, so a warm cache and a
    // cold cache give identical output.
    //
    // Per-evaluation limits: time is clamped to MAX_TIME seconds, particle life
    // to MAX_LIFE seconds, at most MAX_ALIVE particles are simulated (the newest
    // are kept), and parent emission nests at most MAX_DEPTH systems. The
    // emitter behavior (continuous, explode, burst) is read once and is not
    // animatable.
    var SIM = {
        STEP: 1 / 60,
        MAX_TIME: 600,
        MAX_LIFE: 30,
        MAX_ALIVE: 20000,
        MAX_DEPTH: 2,
        CYCLE_STRIDE: 65536,
        CHECKPOINT: 16,
        CHECKPOINT_BUDGET: 200000,
    };

    function simHash(seed, key, channel) {
        var h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(key | 0, 0x85ebca77) ^ Math.imul(channel | 0, 0xc2b2ae3d);
        h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
        h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }

    function simNoise(x, y, z, time) {
        var t = time * 0.1;
        return [
            Math.sin(x + t) * Math.cos(y * 1.3 - t) + Math.sin(z * 0.7 + t * 0.5),
            Math.cos(y + t * 1.1) * Math.sin(z * 1.1 + t) + Math.cos(x * 0.9 - t),
            Math.sin(z + t * 0.9) * Math.cos(x * 1.2 + t) + Math.sin(y * 0.8 - t * 0.7),
        ];
    }

    function simNumber(prop, frame, fallback) {
        if (!prop || typeof prop.get !== "function") return fallback;
        var value;
        try {
            value = prop.get(frame);
        } catch (err) {
            return fallback;
        }
        return typeof value === "number" && isFinite(value) ? value : fallback;
    }

    function simVector(prop, frame, fallback) {
        var value = null;
        try {
            value = prop && typeof prop.get === "function" ? prop.get(frame) : null;
        } catch (err) {
            value = null;
        }
        if (!value || value.length < 3 || !isFinite(value[0]) || !isFinite(value[1]) || !isFinite(value[2])) {
            return fallback.slice();
        }
        return [value[0], value[1], value[2]];
    }

    // Samples every input the simulation reads at one grid time (seconds).
    function simSampleRow(table, sec) {
        var system = table.system;
        var frame = sec * table.fps;
        var P = system.properties;
        var E = P.emitter, Q = P.particle, Y = P.physics, V = P.environment;
        var D = P.displace, S = P.spherical, K = P.kaleidospace;
        var num = function (prop, fallback) { return simNumber(prop, frame, fallback); };

        var perSec = Math.max(num(E.particlesPerSec, 0), 0);
        var burst = Math.max(Math.round(num(E.burstCount, 0)), 0);
        var life = clamp(num(Q.life, 3), 0.0001, SIM.MAX_LIFE);
        var lifeRandom = num(Q.lifeRandom, 0) / 100;
        var gravity = num(Y.gravity, 0);
        var meanderOn = num(Y.meanderEnabled, 0) === 1;
        var fromParent = num(E.emitFromParent, 0) === 1;

        // Continuous flow (particles per second). A burst count without a flow
        // rate keeps about that many particles alive.
        var flow = perSec > 0 ? perSec : burst > 0 ? burst / life : 0;
        if (fromParent) {
            // Each parent particle emits at the flow rate (or a percentage of
            // the parent's flow), so the child flow scales with parent count.
            var parentRow = table.parentTable ? table.parentTable.rowAtTime(sec) : null;
            if (!parentRow) {
                flow = 0;
            } else {
                var perParent = num(E.ratePercent, 0) === 1 ? parentRow.flow * (perSec / 100) : perSec;
                flow = perParent * parentRow.count;
            }
        }
        var base = burst > 0 ? burst : Math.max(1, Math.round(flow * life));
        var count = clamp(Math.round(base * table.mult), 0, SIM.MAX_ALIVE);
        var speed = num(E.velocity, 100);
        var velocityRandom = num(E.velocityRandom, 20) / 100;
        var directionSpread = num(E.directionSpread, 20) / 360;

        return {
            seed: Math.floor(num(E.randomSeed, 0)),
            flow: flow,
            count: count,
            emitRate: burst > 0 && perSec <= 0 ? Math.max(count, 1) : Math.max(perSec, 1),
            interval: Math.max(num(E.burstInterval, 1), SIM.STEP),
            life: life,
            lifeRandom: lifeRandom,
            lifeBound: Math.min(life * (1 + Math.abs(lifeRandom) / 2), SIM.MAX_LIFE),
            speed: speed,
            spread: speed * velocityRandom + speed * directionSpread,
            direction: simVector(E.direction, frame, [0, 0, 0]),
            position: simVector(E.position, frame, [0, 0, 0]),
            emitterSize: num(E.emitterSize, 100),
            shape: Math.round(num(E.emitterType, 0)),
            inherit: num(E.inheritVelocity, 0) / 100,
            emitAmt: num(E.velocityFromEmitterMotion, 0) / 100,
            fromParent: fromParent,
            massBase: Math.max(num(Y.mass, 10), 0.01) / 10,
            massRandom: num(Y.massRandom, 0) / 100,
            massSize: num(Y.sizeAffectsMass, 0) / 100,
            airRandom: num(Y.airResistanceRandom, 0) / 100,
            airSize: num(Y.sizeAffectsAirResistance, 0) / 100,
            drag: num(Y.drag, 0),
            wind: [num(V.windX, 0), num(V.windY, 0) + gravity, num(V.windZ, 0)],
            bounce: num(Y.bounceEnabled, 0) === 1,
            bounceHeight: num(Y.bounceHeight, 500),
            bounceStrength: num(Y.bounceStrength, 50) / 100,
            meanderOn: meanderOn,
            meanderDir: meanderOn ? num(Y.meanderAffectDirection, 20) : 0,
            meanderSpeed: meanderOn ? num(Y.meanderAffectSpeed, 20) : 0,
            turbulence: num(V.turbulenceEnabled, 0) === 1 ? num(V.turbulenceAffectPosition, 0) : 0,
            turbulenceScale: Math.max(num(V.turbulenceScale, 10), 0.0001),
            sphere: num(S.strength, 0) / 100,
            sphereCenter: simVector(S.position, frame, [720, 540, 0]),
            sphereRadius: Math.max(num(S.radius, 100), 0.0001),
            sphereFeather: num(S.feather, 50) / 100,
            vortex: num(Y.fluidEnabled, 0) === 1 ? num(Y.vortexStrength, 100) : 0,
            disperse: num(P.displace.disperse, 0),
            twist: num(P.displace.twist, 0),
            mirror: [num(K.mirrorX, 0) === 1, num(K.mirrorY, 0) === 1, num(K.mirrorZ, 0) === 1],
            kaleidoCenter: simVector(K.center, frame, [720, 540, 0]),
        };
    }

    // Append-only grid of sampled rows for one system at one nesting depth.
    class SimTable {
        constructor(system, fps, parentTable, signature) {
            this.system = system;
            this.fps = fps;
            this.parentTable = parentTable;
            this.signature = signature;
            this.h = SIM.STEP;
            this.maxIndex = Math.ceil(SIM.MAX_TIME / this.h) + 1;
            this.mult = system.secondaryCountMultiplier();
            this.rows = [];
            this.cum = [0];
            this.lifeMax = [];
            this.cycles = null;
            this.checkpoints = new Map();
            this.checkpointBudget = SIM.CHECKPOINT_BUDGET;
            var row0 = simSampleRow(this, 0);
            this.behavior = Math.min(Math.max(Math.round(simNumber(system.properties.emitter.emitterBehavior, 0, 0)), 0), 2);
            this.n0 = -Math.ceil(row0.lifeBound / this.h);
            for (var i = this.n0; i <= 0; i++) this.append(row0);
        }

        append(row) {
            var len = this.rows.length;
            this.rows.push(row);
            this.cum.push(this.cum[len] + row.flow * this.h);
            this.lifeMax.push(len ? Math.max(this.lifeMax[len - 1], row.lifeBound) : row.lifeBound);
        }

        extendOne() {
            var index = this.n0 + this.rows.length;
            if (index > this.maxIndex) return false;
            this.append(simSampleRow(this, index * this.h));
            return true;
        }

        // Position index into rows for a time, extending the grid as needed.
        index(sec) {
            var n = Math.floor(sec / this.h);
            if (n < this.n0) n = this.n0;
            while (this.n0 + this.rows.length - 1 < n && this.extendOne()) { /* grow */ }
            var i = n - this.n0;
            return i >= this.rows.length ? this.rows.length - 1 : i;
        }

        rowAtTime(sec) {
            return this.rows[this.index(sec)];
        }

        lifeBoundAt(sec) {
            return this.lifeMax[this.index(sec)];
        }

        // Cumulative emitted count at a time (continuous emission).
        cumAt(sec) {
            if (sec < this.n0 * this.h) return 0;
            var i = this.index(sec);
            return this.cum[i] + this.rows[i].flow * (sec - (this.n0 + i) * this.h);
        }

        // Birth time of continuous event k, the moment the count reaches k + 1.
        birthOfIndex(k) {
            var v = k + 1;
            while (this.cum[this.cum.length - 1] < v && this.extendOne()) { /* grow */ }
            var cum = this.cum;
            if (cum[cum.length - 1] < v) return null;
            var lo = 1, hi = cum.length - 1;
            while (lo < hi) {
                var mid = (lo + hi) >> 1;
                if (cum[mid] >= v) hi = mid;
                else lo = mid + 1;
            }
            var seg = lo - 1;
            return (this.n0 + seg) * this.h + (v - cum[seg]) / this.rows[seg].flow;
        }

        // Start time of burst cycle c. Each cycle starts one interval after the previous.
        cycleStart(c) {
            if (!this.cycles) this.cycles = [0];
            while (this.cycles.length <= c) {
                var last = this.cycles[this.cycles.length - 1];
                if (last > SIM.MAX_TIME) return Infinity;
                this.cycles.push(last + this.rowAtTime(last).interval);
            }
            return this.cycles[c];
        }

        cycleAtOrBefore(t) {
            this.cycleStart(0);
            while (this.cycles[this.cycles.length - 1] <= t && this.cycleStart(this.cycles.length) !== Infinity) { /* grow */ }
            var lo = 0, hi = this.cycles.length - 1;
            while (lo < hi) {
                var mid = (lo + hi + 1) >> 1;
                if (this.cycles[mid] <= t) lo = mid;
                else hi = mid - 1;
            }
            return lo;
        }

        cycleInfo(c) {
            var start = this.cycleStart(c);
            if (!isFinite(start)) return null;
            var row = this.rowAtTime(start);
            return { start: start, count: row.count, rate: row.emitRate };
        }

        // Event identity for a key. Continuous: k. Explode: particle index.
        // Burst: cycle * CYCLE_STRIDE + particle index.
        eventFor(key) {
            var birth;
            if (this.behavior === 0) {
                birth = this.birthOfIndex(key);
                if (birth === null) return null;
            } else if (this.behavior === 1) {
                birth = 0;
            } else {
                var info = this.cycleInfo(Math.floor(key / SIM.CYCLE_STRIDE));
                if (!info) return null;
                birth = info.start + (key % SIM.CYCLE_STRIDE) / info.rate;
            }
            var row = this.rowAtTime(birth);
            var scale = 1 + (simHash(row.seed, key, 4) - 0.5) * row.lifeRandom;
            return { key: key, birth: birth, life: clamp(row.life * scale, 0.0001, SIM.MAX_LIFE), row: row };
        }

        // Emitter velocity from the sampled emitter position (central difference).
        emitterVelocityAt(sec) {
            var a = Math.max(sec - this.h, 0);
            var b = sec + this.h;
            var pa = this.rowAtTime(a).position;
            var pb = this.rowAtTime(b).position;
            var span = b - a;
            return [(pb[0] - pa[0]) / span, (pb[1] - pa[1]) / span, (pb[2] - pa[2]) / span];
        }
    }

    // Initial state of a particle at birth, including emitter motion and parent sources.
    function simSpawn(table, ev) {
        var row = ev.row;
        var key = ev.key;
        var seed = row.seed;
        var jx = (simHash(seed, key, 1) - 0.5) * 2;
        var jy = (simHash(seed, key, 2) - 0.5) * 2;
        var jz = (simHash(seed, key, 3) - 0.5) * 2;
        var ox = 0, oy = 0, oz = 0;
        if (row.shape === 1) {
            ox = jx * row.emitterSize * 0.5;
            oy = jy * row.emitterSize * 0.5;
            oz = jz * row.emitterSize * 0.5;
        } else if (row.shape === 2) {
            var jl = Math.sqrt(jx * jx + jy * jy + jz * jz) || 1;
            ox = (jx / jl) * row.emitterSize * 0.5;
            oy = (jy / jl) * row.emitterSize * 0.5;
            oz = (jz / jl) * row.emitterSize * 0.5;
        }
        var px, py, pz, vx, vy, vz, spreadScale;
        if (row.fromParent) {
            var src = simParentSource(table, ev);
            if (!src) return null;
            px = src.x;
            py = src.y;
            pz = src.z;
            vx = src.vx * row.inherit;
            vy = src.vy * row.inherit;
            vz = src.vz * row.inherit;
            spreadScale = 0.12;
        } else {
            px = row.position[0];
            py = row.position[1];
            pz = row.position[2];
            var d = row.direction;
            var len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
            if (len > 0.0001) {
                vx = (d[0] / len) * row.speed;
                vy = (d[1] / len) * row.speed;
                vz = (d[2] / len) * row.speed;
            } else {
                var dl = Math.sqrt(jx * jx + jy * jy + jz * jz) || 1;
                vx = (jx / dl) * row.speed;
                vy = (jy / dl) * row.speed;
                vz = (jz / dl) * row.speed;
            }
            spreadScale = 1;
            if (row.emitAmt !== 0) {
                var motion = table.emitterVelocityAt(ev.birth);
                vx += motion[0] * row.emitAmt;
                vy += motion[1] * row.emitAmt;
                vz += motion[2] * row.emitAmt;
            }
        }
        var spread = row.spread * spreadScale;
        vx += (simHash(seed, key, 11) - 0.5) * spread;
        vy += (simHash(seed, key, 12) - 0.5) * spread;
        vz += (simHash(seed, key, 13) - 0.5) * spread;
        return {
            x: px + ox,
            y: py + oy,
            z: pz + oz,
            vx: vx,
            vy: vy,
            vz: vz,
            massVar: (1 + (simHash(seed, key, 17) - 0.5) * 2 * row.massRandom) *
                (1 + (simHash(seed, key, 19) - 0.5) * 2 * row.massSize),
            dragVar: (1 + (simHash(seed, key, 23) - 0.5) * 2 * row.airRandom) *
                (1 + (simHash(seed, key, 29) - 0.5) * 2 * row.airSize),
        };
    }

    // Parent emission: the most recent parent event born at or before the child birth.
    // Returns the parent particle state at that time, or null when no live parent exists.
    function simParentSource(table, ev) {
        var parent = table.parentTable;
        if (!parent) return null;
        var b = ev.birth;
        var key;
        if (parent.behavior === 0) {
            var k = Math.floor(parent.cumAt(b)) - 1;
            if (k < 0) return null;
            key = k;
        } else if (parent.behavior === 1) {
            var count = parent.rowAtTime(0).count;
            if (count < 1) return null;
            key = ev.key % count;
        } else {
            var c = parent.cycleAtOrBefore(b);
            var info = parent.cycleInfo(c);
            if (!info || info.count < 1) return null;
            var i = Math.min(Math.floor((b - info.start) * info.rate), info.count - 1);
            if (i < 0) return null;
            key = c * SIM.CYCLE_STRIDE + i;
        }
        var pev = parent.eventFor(key);
        if (!pev || !(pev.birth <= b && b < pev.birth + pev.life)) return null;
        var pspawn = simSpawn(parent, pev);
        if (!pspawn) return null;
        return simIntegrate(parent, pev, pspawn, b);
    }

    // Forces and motion for one fixed sub-step. Row values are sampled at the sub-step time.
    function simAdvance(st, row, dt, time, kk) {
        var x = st.x, y = st.y, z = st.z;
        var vx = st.vx, vy = st.vy, vz = st.vz;
        if (row.turbulence !== 0) {
            var n = simNoise(x / row.turbulenceScale, y / row.turbulenceScale, z / row.turbulenceScale, time);
            vx += n[0] * row.turbulence * dt;
            vy += n[1] * row.turbulence * dt;
            vz += n[2] * row.turbulence * dt;
        }
        if (row.meanderOn && (row.meanderDir !== 0 || row.meanderSpeed !== 0)) {
            var mPhase = kk * 12.9898;
            var wX = Math.sin(time * 1.7 + mPhase) + 0.5 * Math.sin(time * 3.1 + mPhase * 1.7);
            var wY = Math.sin(time * 1.3 + mPhase * 1.3 + 2.0) + 0.5 * Math.sin(time * 2.7 + mPhase * 0.7);
            var wZ = Math.cos(time * 1.5 + mPhase * 0.9 + 4.0) + 0.5 * Math.sin(time * 2.3 + mPhase * 1.1);
            if (row.meanderDir !== 0) {
                vx += wX * row.meanderDir * dt;
                vy += wY * row.meanderDir * dt;
                vz += wZ * row.meanderDir * dt;
            }
            if (row.meanderSpeed !== 0) {
                var spd = Math.sqrt(vx * vx + vy * vy + vz * vz);
                if (spd > 0.0001) {
                    var sAmt = Math.sin(time * 2.2 + mPhase * 2.0) * (row.meanderSpeed / 100) * 60 * dt;
                    vx += (vx / spd) * sAmt;
                    vy += (vy / spd) * sAmt;
                    vz += (vz / spd) * sAmt;
                }
            }
        }
        var c = row.sphereCenter;
        if (row.sphere !== 0) {
            var dx = x - c[0], dy = y - c[1], dz = z - c[2];
            var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
            var influence = 1;
            if (dist > row.sphereRadius) {
                influence = Math.max(0, 1 - (dist - row.sphereRadius) / (row.sphereRadius * (1 - row.sphereFeather + 0.0001)));
            }
            var force = (row.sphere * influence * 100) / (dist * dist + 1);
            vx -= dx * force * dt;
            vy -= dy * force * dt;
            vz -= dz * force * dt;
        }
        if (row.vortex !== 0) {
            var vdx = x - c[0], vdz = z - c[2];
            var vdist = Math.sqrt(vdx * vdx + vdz * vdz) || 1;
            if (vdist < row.sphereRadius) {
                var swirl = (row.vortex / 100) * (1 - vdist / row.sphereRadius) * dt;
                vx += (-vdz / vdist) * swirl * 100;
                vz += (vdx / vdist) * swirl * 100;
                vy += Math.sin(vdist * 0.01 + time) * swirl * 10;
            }
        }
        var massDiv = row.massBase * (st.massVar || 1);
        if (!(massDiv > 0)) massDiv = 1;
        vx += (row.wind[0] / massDiv) * dt;
        vy += (row.wind[1] / massDiv) * dt;
        vz += (row.wind[2] / massDiv) * dt;
        if (row.drag > 0) {
            var damp = Math.max(0, 1 - ((row.drag * (st.dragVar || 1)) / massDiv) * dt * 10);
            vx *= damp;
            vy *= damp;
            vz *= damp;
        }
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;
        if (row.bounce && y < 0) {
            y = 0;
            vy = Math.abs(vy) * row.bounceStrength + row.bounceHeight * 0.01;
        }
        if (row.disperse !== 0) {
            var amt = row.disperse * dt;
            x += Math.sin(kk * 12.9898 + time) * amt;
            y += Math.sin(kk * 78.233 + time) * amt;
            z += Math.sin(kk * 37.719 + time) * amt;
        }
        if (row.twist !== 0) {
            var angle = (row.twist * Math.PI * dt) / 180;
            var ca = Math.cos(angle), sa = Math.sin(angle);
            var nx = x * ca - z * sa;
            z = x * sa + z * ca;
            x = nx;
        }
        var kc = row.kaleidoCenter;
        if (row.mirror[0] && x > kc[0]) x = kc[0] - (x - kc[0]);
        if (row.mirror[1] && y > kc[1]) y = kc[1] - (y - kc[1]);
        if (row.mirror[2] && z > kc[2]) z = kc[2] - (z - kc[2]);
        st.x = x;
        st.y = y;
        st.z = z;
        st.vx = vx;
        st.vy = vy;
        st.vz = vz;
    }

    function simCopyState(st) {
        return {
            x: st.x, y: st.y, z: st.z, vx: st.vx, vy: st.vy, vz: st.vz,
            massVar: st.massVar, dragVar: st.dragVar,
        };
    }

    // Integrates one particle from its birth to time t on fixed sub-steps.
    // Checkpoints store the state after each CHECKPOINT full sub-steps. A
    // checkpoint is reused only when the last of its full steps began at least
    // one STEP before t, which makes every step in the reused prefix identical
    // to the uncached sequence. Output does not depend on the cache.
    function simIntegrate(table, ev, spawn, t) {
        var kk = ev.key % 100000;
        var store = table.checkpoints.get(ev.key);
        if (!store) {
            store = [];
            table.checkpoints.set(ev.key, store);
        }
        var st = null;
        var tc = ev.birth;
        var steps = 0;
        for (var j = store.length - 1; j >= 0; j--) {
            if (t - store[j].last >= SIM.STEP) {
                st = simCopyState(store[j].st);
                tc = store[j].tc;
                steps = store[j].steps;
                break;
            }
        }
        if (!st) {
            st = {
                x: spawn.x, y: spawn.y, z: spawn.z,
                vx: spawn.vx, vy: spawn.vy, vz: spawn.vz,
                massVar: spawn.massVar, dragVar: spawn.dragVar,
            };
        }
        while (t - tc > 1e-9) {
            var dt = Math.min(SIM.STEP, t - tc);
            var last = tc;
            simAdvance(st, table.rowAtTime(tc), dt, tc, kk);
            tc += dt;
            if (dt === SIM.STEP) {
                steps++;
                if (steps === (store.length + 1) * SIM.CHECKPOINT && table.checkpointBudget > 0) {
                    store.push({ steps: steps, tc: tc, last: last, st: simCopyState(st) });
                    table.checkpointBudget--;
                }
            }
        }
        return st;
    }

    // Events alive at time t, oldest first, limited to the newest MAX_ALIVE.
    function simEnumerate(table, t) {
        var out = [];
        var add = function (ev) {
            if (!ev || ev.birth > t || !(t < ev.birth + ev.life)) return;
            var spawn = simSpawn(table, ev);
            if (spawn) out.push({ ev: ev, spawn: spawn });
        };
        if (table.behavior === 0) {
            var lb = table.lifeBoundAt(t);
            var hi = Math.floor(table.cumAt(t)) - 1;
            var lo = Math.max(0, Math.floor(table.cumAt(t - lb)) - 1);
            for (var k = hi; k >= lo && out.length < SIM.MAX_ALIVE; k--) add(table.eventFor(k));
        } else if (table.behavior === 1) {
            var total = table.rowAtTime(0).count;
            for (var e = total - 1; e >= 0 && out.length < SIM.MAX_ALIVE; e--) add(table.eventFor(e));
        } else {
            var lbBurst = table.lifeBoundAt(t);
            for (var c = table.cycleAtOrBefore(t); c >= 0 && out.length < SIM.MAX_ALIVE; c--) {
                var info = table.cycleInfo(c);
                if (!info) continue;
                if (info.start + info.count / info.rate + lbBurst < t) break;
                for (var i = info.count - 1; i >= 0 && out.length < SIM.MAX_ALIVE; i--) {
                    add(table.eventFor(c * SIM.CYCLE_STRIDE + i));
                }
            }
        }
        return out.reverse();
    }

    // Full particle state of a system at time t (seconds). Pure in (system, t).
    function simulateSystem(system, t) {
        var table = system.simTable(0);
        var alive = simEnumerate(table, t);
        var count = alive.length;
        var out = {
            count: count,
            positions: new Float32Array(count * 3),
            velocities: new Float32Array(count * 3),
            phases: new Float32Array(count),
            pids: new Float32Array(count),
        };
        for (var i = 0; i < count; i++) {
            var item = alive[i];
            var st = simIntegrate(table, item.ev, item.spawn, t);
            out.positions[i * 3] = st.x;
            out.positions[i * 3 + 1] = st.y;
            out.positions[i * 3 + 2] = st.z;
            out.velocities[i * 3] = st.vx;
            out.velocities[i * 3 + 1] = st.vy;
            out.velocities[i * 3 + 2] = st.vz;
            out.phases[i] = clamp((t - item.ev.birth) / item.ev.life, 0, 1);
            out.pids[i] = item.ev.key;
        }
        return out;
    }

    // Reactor level 0..1 at a project frame, from the decoded clip. Silence outside
    // the clip window; 0.5 (neutral) while the source is missing or not decoded yet.
    function audioReactorLevel(system, frame) {
        var audio = system.properties.audio;
        var source = audio.audioLayer ? audio.audioLayer.get(frame) : null;
        if (!source) return 0.5;
        var local = frame / system.sceneRate() - simNumber(audio.audioOffset, frame, 0);
        var trimIn = Math.max(simNumber(audio.audioTrimIn, frame, 0), 0);
        var trimOut = Math.max(simNumber(audio.audioTrimOut, frame, 0), 0);
        var media = trimIn + local;
        if (local < 0 || (trimOut > 0 && media >= trimOut)) return 0;
        var level = T.audioAnalysis.levelAt(source, media);
        return level === null ? 0.5 : level;
    }

    function audioReactorsOn(audio, frame) {
        return audio.reactor1Enabled.get(frame) === 1 ||
            audio.reactor2Enabled.get(frame) === 1 ||
            audio.reactor3Enabled.get(frame) === 1 ||
            audio.reactor4Enabled.get(frame) === 1;
    }

    /* ------------------------------------------------------------------ */
    /* Particular (container of systems)                                  */
    /* ------------------------------------------------------------------ */

    PZ.object3d.particular = class extends PZ.object3d {
        constructor() {
            super();
            this.threeObj = new THREE.Object3D();
            this.systems = new PZ.objectList(this, PZ.object3d.particular.system);
            this.systems.name = "Systems";
            this.children.push(this.systems);
        }
        load(e) {
            this.properties.load(e && e.properties);
            if ("object" == typeof e && e.systems && e.systems.length) {
                for (var t = 0; t < e.systems.length; t++) {
                    var r = new PZ.object3d.particular.system();
                    this.systems.push(r);
                    r.loading = r.load(e.systems[t], this);
                }
            } else {
                var system = new PZ.object3d.particular.system();
                this.systems.push(system);
                system.loading = system.load(null, this);
                var objectType = e && "object" == typeof e ? e.objectType : 0;
                if (objectType === 1) system.applyPreset("burst");
                else if (objectType === 2) system.applyPreset("fountain");
                else if (objectType === 3) system.applyPreset("snow");
            }
            this.parentChanged();
        }
        toJSON() {
            return { type: this.type, properties: this.properties, systems: this.systems };
        }
        unload() {
            for (var i = 0; i < this.systems.length; i++) this.systems[i].unload();
        }
        update(e) {
            for (var i = 0; i < this.systems.length; i++) this.systems[i].update(e);
        }
        async prepare(e) {
            for (var i = 0; i < this.systems.length; i++) await this.systems[i].prepare(e);
        }
    };

    PZ.object3d.particular.prototype.defaultName = "Particular";
    PZ.object3d.particular.presetTexturesList = [
        "circle_soft",
        "circle_sft2",
        "circle_soft3",
        "circle_soft4",
        "dots",
        "spots",
        "square_soft",
        "squae_soft_blob",
        "ring",
        "ring_blur",
        "star1",
        "star2",
        "star3",
        "flash1",
        "flash2",
        "flash3",
        "plume",
        "plume2",
        "plume3",
        "plume4",
        "nebula",
        "smokey",
        "splash",
        "splotch1",
        "splotch2",
        "artsy",
        "clumpy_blurry",
        "misc",
        "skull",
        "squiggles",
        "tentacles",
        "tribal",
        "twisted",
        "waterfall",
        "bar_blur",
        "ring_partial",
    ];

    PZ.object3d.particular.propertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Particular" },
    };

    /* ------------------------------------------------------------------ */
    /* System                                                             */
    /* ------------------------------------------------------------------ */

    var systemPropertyDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "System" },
    };

    PZ.object3d.particular.system = class extends PZ.object {
        static create() {
            return new PZ.object3d.particular.system();
        }
        constructor() {
            super();
            this.particular = null;
            this.threeObj = new THREE.Points(new THREE.BufferGeometry(), new THREE.Material());
            this.threeObj.frustumCulled = false;
            this.threeObj.onBeforeRender = function (renderer) {
                if (!this.material || !this.material.uniforms) return;
                var size = renderer.getSize();
                this.material.uniforms.resolution.value.set(size.width, size.height);
            };
            this.material = null;
            this.texture = null;
            this.palettes = {
                colorOverLife: createPalette(),
                sizeOverLife: createPalette(),
                opacityOverLife: createPalette(),
            };
            this._count = -1;
            this.properties = new PZ.propertyList(
                {
                    name: PZ.property.create(PZ.object3d.particular.system.propertyDefinitions.name),
                    emitter: new PZ.propertyList(PZ.object3d.particular.system.emitterDefinitions),
                    particle: new PZ.propertyList(PZ.object3d.particular.system.particleDefinitions),
                    physics: new PZ.propertyList(PZ.object3d.particular.system.physicsDefinitions),
                    environment: new PZ.propertyList(PZ.object3d.particular.system.environmentDefinitions),
                    displace: new PZ.propertyList(PZ.object3d.particular.system.displaceDefinitions),
                    spherical: new PZ.propertyList(PZ.object3d.particular.system.sphericalDefinitions),
                    kaleidospace: new PZ.propertyList(PZ.object3d.particular.system.kaleidoDefinitions),
                    transform: new PZ.propertyList(PZ.object3d.particular.system.transformDefinitions),
                    layerMaps: new PZ.propertyList(PZ.object3d.particular.system.layerMapDefinitions),
                    audio: new PZ.propertyList(PZ.object3d.particular.system.audioDefinitions),
                    lighting: new PZ.propertyList(PZ.object3d.particular.system.lightingDefinitions),
                },
                this
            );
            var groups = {
                emitter: "Emitter",
                particle: "Particle",
                physics: "Physics",
                environment: "Environment",
                displace: "Displace",
                spherical: "Spherical Field",
                kaleidospace: "Kaleidospace",
                transform: "Transform",
                layerMaps: "Layer Maps",
                audio: "Audio React",
                lighting: "Lighting",
            };
            for (var g in groups) {
                Object.defineProperty(this.properties[g], "displayName", { value: groups[g], writable: true });
            }
            var propertyList = this.properties;
            Object.defineProperty(propertyList, "toJSON", {
                value: function () {
                    var result = {};
                    var keys = Object.keys(this);
                    for (var k = 0; k < keys.length; k++) result[keys[k]] = this[keys[k]];
                    return result;
                },
                writable: true,
            });
            this.children = [this.properties];
            this.onParentChanged.watch(
                function () {
                    if (!this.threeObj) return;
                    if (this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
                    if (!this.parent) return;
                    var particular = this.tryGetParentOfType(PZ.object3d.particular);
                    if (particular && particular.threeObj) particular.threeObj.add(this.threeObj);
                }.bind(this)
            );
        }
        get parentParticular() {
            return this.getParentOfType(PZ.object3d.particular);
        }
        get parentSystemIndex() {
            var emitter = this.properties && this.properties.emitter;
            if (emitter && emitter.parentSystemIndex) {
                return Math.max(0, Math.round(emitter.parentSystemIndex.get(PZ.trapcode.currentTime) || 0));
            }
            return 0;
        }
        get parentSystem() {
            var particular = this.parentParticular;
            if (!particular || !particular.systems || !particular.systems.length) return null;
            var idx = this.parentSystemIndex;
            if (idx >= particular.systems.length) idx = 0;
            return particular.systems[idx] || null;
        }
        get primarySystem() {
            var particular = this.parentParticular;
            if (!particular) return null;
            return particular.systems && particular.systems.length ? particular.systems[0] : null;
        }
        get palette() {
            return this.palettes;
        }
        applyPreset(name) {
            var p = this.properties;
            if (name === "burst") {
                p.emitter.particlesPerSec.set(0);
                p.emitter.burstCount.set(120);
                p.particle.life.set(1.6);
                p.emitter.velocity.set(380);
                p.emitter.velocityRandom.set(80);
                p.emitter.directionSpread.set(180);
                p.particle.size.set(6);
                p.particle.colorGradient.set([
                    { position: 0, color: "rgba(255,255,255,1)" },
                    { position: 0.6, color: "rgba(255,220,120,1)" },
                    { position: 1, color: "rgba(255,60,0,0)" },
                ]);
                p.physics.drag.set(0.02);
                p.emitter.randomSeed.set(101);
            } else if (name === "fountain") {
                p.emitter.particlesPerSec.set(300);
                p.emitter.burstCount.set(0);
                p.particle.life.set(2.4);
                p.emitter.velocity.set(260);
                p.emitter.velocityRandom.set(12);
                p.emitter.direction.set([0, -1, 0]);
                p.emitter.directionSpread.set(16);
                p.particle.size.set(4);
                p.physics.gravity.set(180);
                p.particle.colorGradient.set([
                    { position: 0, color: "rgba(180,220,255,1)" },
                    { position: 1, color: "rgba(40,90,255,0)" },
                ]);
                p.emitter.randomSeed.set(202);
            } else if (name === "snow") {
                p.emitter.particlesPerSec.set(220);
                p.emitter.burstCount.set(0);
                p.particle.life.set(6);
                p.particle.lifeRandom.set(40);
                p.emitter.velocity.set(40);
                p.emitter.velocityRandom.set(50);
                p.particle.size.set(3);
                p.physics.gravity.set(12);
                p.environment.windX.set(25);
                p.particle.opacity.set(90);
                p.particle.colorGradient.set([{ position: 0, color: "rgba(255,255,255,1)" }]);
                p.emitter.randomSeed.set(303);
            }
            this.rebuildMaterial();
            this.redrawTexture();
        }
        rebuildMaterial() {
            var palette = this.palettes;
            this.material = new THREE.ShaderMaterial({
                uniforms: {
                    resolution: { type: "v2", value: new THREE.Vector2(1920, 1080) },
                    image: { type: "t", value: this.material ? this.material.uniforms.image.value : null },
                    colorOverLife: { type: "t", value: palette ? palette.colorOverLife : null },
                    sizeOverLife: { type: "t", value: palette ? palette.sizeOverLife : null },
                    opacityOverLife: { type: "t", value: palette ? palette.opacityOverLife : null },
                    time: { type: "f", value: 0 },
                    rate: { type: "f", value: 1 },
                    lifetime: { type: "f", value: 1 },
                    lifeRandom: { type: "f", value: 0 },
                    accel: { type: "v3", value: new THREE.Vector3() },
                    ipos: { type: "v3", value: new THREE.Vector3() },
                    ivel: { type: "v3", value: new THREE.Vector3() },
                    speed: { type: "f", value: 100 },
                    emitterSize: { type: "f", value: 0 },
                    emitterShape: { type: "f", value: 0 },
                    behavior: { type: "f", value: 0 },
                    burstInterval: { type: "f", value: 1 },
                    vspread: { type: "f", value: 0 },
                    size: { type: "f", value: 5 },
                    sizeRandom: { type: "f", value: 0 },
                    opacity: { type: "f", value: 1 },
                    colorTint: { type: "v4", value: new THREE.Vector4(1, 1, 1, 1) },
                    glow: { type: "f", value: 0 },
                    emitterVel: { type: "v3", value: new THREE.Vector3() },
                    emitterVelAmt: { type: "f", value: 0 },
                    massDiv: { type: "f", value: 1 },
                    orient: { type: "f", value: 0 },
                    orientFade: { type: "f", value: 20 },
                    sceneFps: { type: "f", value: 30 },
                    rotBase: { type: "v3", value: new THREE.Vector3() },
                    spinRate: { type: "v3", value: new THREE.Vector3() },
                    spinRnd: { type: "f", value: 0 },
                    spinRateRnd: { type: "f", value: 0 },
                    spinDist: { type: "f", value: 0.5 },
                    rotAir: { type: "f", value: 0 },
                    stretch: { type: "f", value: 0 },
                    audioLevel: { type: "f", value: 1 },
                    layerColorMix: { type: "f", value: 1 },
                    layerSizeStrength: { type: "f", value: 1 },
                    layerColor: { type: "t", value: this.layerColorTex || null },
                    layerSize: { type: "t", value: this.layerSizeTex || null },
                },
                vertexShader: VERTEX_SHADER,
                fragmentShader: FRAGMENT_SHADER,
                defines: {},
                transparent: true,
                depthTest: true,
                depthWrite: false,
                blending: THREE.NormalBlending,
            });
            this.threeObj.material = this.material;
        }
        redrawTexture() {
            if (!this.material) return;
            var value = this.properties.particle.texture.get(PZ.trapcode.currentTime);
            if (this._textureValue === value && this.texture) return;
            this._textureValue = value;
            var project = this.tryGetParentOfType(PZ.project);
            if (this.texture) {
                project && project.assets.unload(this.texture);
                this.texture = null;
                this.material.uniforms.image.value = null;
            }
            if (value && project) {
                this.texture = new PZ.asset.image(project.assets.load(value));
                this.material.uniforms.image.value = this.texture.getTexture(true);
            }
            this.material.needsUpdate = true;
        }
        loadLayerTexture(property, key, uniformName) {
            var project = this.tryGetParentOfType(PZ.project);
            var value = property ? property.get(PZ.trapcode.currentTime) : null;
            if (this[key + "Value"] === value && this[key]) return;
            this[key + "Value"] = value;
            if (this[key]) {
                project && project.assets.unload(this[key]);
                this[key] = null;
            }
            if (value && project) {
                this[key] = new PZ.asset.image(project.assets.load(value));
            }
            if (this.material) {
                this.material.uniforms[uniformName].value = this[key] ? this[key].getTexture(true) : null;
                this.material.needsUpdate = true;
            }
        }
        updateLayerMaps() {
            if (!this.material) return;
            var maps = this.properties.layerMaps;
            var colorOn = maps.colorAlphaEnabled.get(PZ.trapcode.currentTime) === 1;
            var sizeOn = maps.sizeEnabled.get(PZ.trapcode.currentTime) === 1;
            if (colorOn) this.loadLayerTexture(maps.colorAlphaLayer, "layerColorTex", "layerColor");
            if (sizeOn) this.loadLayerTexture(maps.sizeLayer, "layerSizeTex", "layerSize");
            if (colorOn) this.material.defines.USE_LAYER_COLOR = 1;
            else delete this.material.defines.USE_LAYER_COLOR;
            if (sizeOn) this.material.defines.USE_LAYER_SIZE = 1;
            else delete this.material.defines.USE_LAYER_SIZE;
            this.material.uniforms.layerColorMix.value = maps.colorAlphaMix.get(PZ.trapcode.currentTime) / 100;
            this.material.uniforms.layerSizeStrength.value = maps.sizeStrength.get(PZ.trapcode.currentTime) / 100;
            this.material.needsUpdate = true;
        }
        updateAudio() {
            if (!this.material) return;
            var audio = this.properties.audio;
            var frame = PZ.trapcode.currentTime;
            if (!audioReactorsOn(audio, frame)) {
                this.material.uniforms.audioLevel.value = 1;
                return;
            }
            var level = audioReactorLevel(this, frame);
            var strength = audio.reactor1Strength.get(frame) / 100;
            this.material.uniforms.audioLevel.value = 1 + (level - 0.5) * 2 * strength;
        }

        load(e, parent) {
            this.particular = parent || this.particular;
            this.properties.load(e && e.properties);
            if (!this.material) this.rebuildMaterial();
            this.redrawTexture();
            this._count = -1;
            var particular = this.particular || this.parentParticular;
            if (this.threeObj) {
                if (this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
                if (particular && particular.threeObj) particular.threeObj.add(this.threeObj);
            }
        }
        toJSON() {
            return { type: this.type, properties: this.properties };
        }
        unload() {
            if (this.threeObj && this.threeObj.parent) this.threeObj.parent.remove(this.threeObj);
            if (this.threeObj && this.threeObj.geometry) this.threeObj.geometry.dispose();
            if (this.material) this.material.dispose();
            if (this.palettes) {
                this.palettes.colorOverLife.dispose();
                this.palettes.sizeOverLife.dispose();
                this.palettes.opacityOverLife.dispose();
                this.palettes = null;
            }
            if (this.texture) {
                var project = this.tryGetParentOfType(PZ.project);
                project && project.assets.unload(this.texture);
                this.texture = null;
            }
            var unloadLayer = function (self, key) {
                if (self[key]) {
                    var p = self.tryGetParentOfType(PZ.project);
                    p && p.assets.unload(self[key]);
                    self[key] = null;
                }
            };
            unloadLayer(this, "layerColorTex");
            unloadLayer(this, "layerSizeTex");
        }
        particleCount() {
            var emitter = this.properties.emitter;
            var perSec = emitter.particlesPerSec.get(PZ.trapcode.currentTime);
            var life = this.properties.particle.life.get(PZ.trapcode.currentTime);
            var base = Math.max(1, Math.round(perSec * life));
            if (emitter.emitFromParent && emitter.emitFromParent.get(PZ.trapcode.currentTime) === 1) {
                var parent = this.parentSystem;
                if (parent && parent !== this) {
                    // each parent particle acts as an emitter at perSec (like AE Particular)
                    var ratePerParent = perSec;
                    if (emitter.ratePercent && emitter.ratePercent.get(PZ.trapcode.currentTime) === 1) {
                        ratePerParent = parent.properties.emitter.particlesPerSec.get(PZ.trapcode.currentTime) * (perSec / 100);
                    }
                    var parentCount = Math.max(1, Math.round(parent.particleCount ? parent.particleCount() : 1));
                    base = Math.max(1, Math.round(ratePerParent * life * parentCount));
                }
            }
            // System 2+: double the particles/sec-driven count (2x density).
            return Math.max(1, Math.round(base * this.secondaryCountMultiplier()));
        }
        updateGeometry() {
            var emitter = this.properties.emitter;
            var burst = emitter.burstCount.get(PZ.trapcode.currentTime);
            var count = Math.round(burst > 0 ? burst * this.secondaryCountMultiplier() : this.particleCount());
            count = clamp(count, 0, 50000);
            if (this._count === count && this._mode === "gpu") return;
            this._count = count;
            this._mode = "gpu";
            if (this.threeObj.geometry) this.threeObj.geometry.dispose();
            var pid = new Float32Array(count);
            for (var i = 0; i < count; i++) pid[i] = i;
            var geometry = new THREE.BufferGeometry();
            geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
            geometry.addAttribute("pid", new THREE.BufferAttribute(pid, 1));
            this.threeObj.geometry = geometry;
        }
        emitterVectors() {
            var emitter = this.properties.emitter;
            var t = PZ.trapcode.currentTime;
            var position = emitter.position.get(t);
            var direction = emitter.direction.get(t);
            var speed = emitter.velocity.get(t);
            var velocity = [0, 0, 0];
            var length = Math.sqrt(direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]);
            if (length > 0.0001) {
                velocity = [(direction[0] / length) * speed, (direction[1] / length) * speed, (direction[2] / length) * speed];
            }
            var spread = speed * (emitter.velocityRandom.get(t) / 100) + speed * (emitter.directionSpread.get(t) / 360);
            return {
                position: position,
                velocity: velocity,
                speed: speed,
                emitterSize: emitter.emitterSize.get(t),
                emitterShape: emitter.emitterType.get(t),
                behavior: emitter.emitterBehavior.get(t),
                burstInterval: emitter.burstInterval.get(t),
                spread: spread,
            };
        }
        sceneRate() {
            var sequence = this.tryGetParentOfType(PZ.sequence);
            return sequence ? sequence.properties.rate.get(PZ.trapcode.currentTime) || 1 : 1;
        }
        needsCPU() {
            var p = this.properties;
            var e = p.emitter;
            if (e.emitFromParent && e.emitFromParent.get(PZ.trapcode.currentTime) === 1) return true;
            var particular = this.parentParticular;
            if (particular && particular.systems && particular.systems.indexOf) {
                var myIndex = particular.systems.indexOf(this);
                for (var sib = 0; sib < particular.systems.length; sib++) {
                    var child = particular.systems[sib];
                    if (child === this) continue;
                    var ce = child.properties && child.properties.emitter;
                    if (!ce || !ce.emitFromParent || ce.emitFromParent.get(PZ.trapcode.currentTime) !== 1) continue;
                    var wants = child.parentSystemIndex !== undefined ? child.parentSystemIndex : 0;
                    if (wants === myIndex) return true;
                }
            }
            if (e.position.animated || e.direction.animated || e.velocity.animated) return true;
            if (p.physics.enabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.physics.bounceEnabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.physics.meanderEnabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.physics.flockingEnabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.physics.fluidEnabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.environment.turbulenceEnabled.get(PZ.trapcode.currentTime) === 1) return true;
            if (p.displace.disperse.get(PZ.trapcode.currentTime) !== 0) return true;
            if (p.displace.twist.get(PZ.trapcode.currentTime) !== 0) return true;
            if (p.displace.spinAmplitude.get(PZ.trapcode.currentTime) !== 0) return true;
            // Per-particle mass/drag variance has no closed GPU form.
            try {
                if (p.physics.massRandom && p.physics.massRandom.get(PZ.trapcode.currentTime) !== 0) return true;
                if (p.physics.sizeAffectsMass && p.physics.sizeAffectsMass.get(PZ.trapcode.currentTime) !== 0) return true;
                if (p.physics.airResistanceRandom && p.physics.airResistanceRandom.get(PZ.trapcode.currentTime) !== 0) return true;
                if (p.physics.sizeAffectsAirResistance && p.physics.sizeAffectsAirResistance.get(PZ.trapcode.currentTime) !== 0) return true;
            } catch (_mv) { /* absent on old saves: stays on GPU */ }
            if (p.spherical.strength.get(PZ.trapcode.currentTime) !== 0) return true;
            if (p.kaleidospace.mirrorX.get(PZ.trapcode.currentTime) === 1 || p.kaleidospace.mirrorY.get(PZ.trapcode.currentTime) === 1 || p.kaleidospace.mirrorZ.get(PZ.trapcode.currentTime) === 1) return true;
            return false;
        }
        secondaryCountMultiplier() {
            // System 2+ (any non-primary system) runs at 2x density: its final
            // particle count is doubled, so its effective particles/sec doubles.
            // Primary System (index 0) is unaffected.
            try {
                var particular = this.tryGetParentOfType(PZ.object3d.particular);
                if (!particular || !particular.systems || !particular.systems.indexOf) return 1;
                return particular.systems.indexOf(this) > 0 ? 2 : 1;
            } catch (err) {
                return 1;
            }
        }
        // Cached row table for this system at a nesting depth. Keyed by a
        // serialization of every input, so a stale table is never reused.
        simTable(depth) {
            var fps = this.sceneRate();
            var parentSystem = depth < SIM.MAX_DEPTH ? this.parentSystem : null;
            var parentTable = parentSystem && parentSystem !== this ? parentSystem.simTable(depth + 1) : null;
            var signature = JSON.stringify(this.properties) + "|" + fps + "|" + depth + "|" +
                (parentTable ? parentTable.signature : "");
            this._simTables = this._simTables || {};
            var cached = this._simTables[depth];
            if (cached && cached.signature === signature) return cached;
            var table = new SimTable(this, fps, parentTable, signature);
            this._simTables[depth] = table;
            return table;
        }
        // Pure function of (properties, seed, project frame e).
        simulateFrame(e) {
            var seconds = e / this.sceneRate();
            if (!isFinite(seconds) || seconds < 0) seconds = 0;
            return simulateSystem(this, Math.min(seconds, SIM.MAX_TIME));
        }
        writeCPU(state) {
            var count = Math.max(state.count, 1);
            var geometry = this.threeObj.geometry;
            if (this._mode !== "cpu" || this._cpuCount !== count || !geometry || !geometry.attributes || !geometry.attributes.life) {
                if (geometry) geometry.dispose();
                var pid = new Float32Array(count);
                var geo = new THREE.BufferGeometry();
                geo.addAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
                geo.addAttribute("life", new THREE.BufferAttribute(new Float32Array(count), 1));
                geo.addAttribute("pid", new THREE.BufferAttribute(pid, 1));
                geo.addAttribute("velocity", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
                this.threeObj.geometry = geo;
                geometry = geo;
                this._mode = "cpu";
                this._cpuCount = count;
                this._count = count;
            }
            var attrs = geometry.attributes;
            var positions = attrs.position.array;
            var lifeArr = attrs.life.array;
            var pidArr = attrs.pid.array;
            var velocities = attrs.velocity.array;
            for (var i = 0; i < count; i++) {
                if (i < state.count) {
                    positions[i * 3] = state.positions[i * 3];
                    positions[i * 3 + 1] = state.positions[i * 3 + 1];
                    positions[i * 3 + 2] = state.positions[i * 3 + 2];
                    velocities[i * 3] = state.velocities[i * 3];
                    velocities[i * 3 + 1] = state.velocities[i * 3 + 1];
                    velocities[i * 3 + 2] = state.velocities[i * 3 + 2];
                    lifeArr[i] = state.phases[i];
                    pidArr[i] = state.pids[i];
                } else {
                    // Hidden slot: the shader discards life < 0.
                    positions[i * 3] = positions[i * 3 + 1] = positions[i * 3 + 2] = 0;
                    velocities[i * 3] = velocities[i * 3 + 1] = velocities[i * 3 + 2] = 0;
                    lifeArr[i] = -1;
                    pidArr[i] = 0;
                }
            }
            attrs.position.needsUpdate = true;
            attrs.life.needsUpdate = true;
            attrs.pid.needsUpdate = true;
            attrs.velocity.needsUpdate = true;
        }
        // Emitter world velocity by central difference of the sampled position (GPU uniform).
        emitterMotionAt(seconds) {
            var fps = this.sceneRate();
            var h = SIM.STEP;
            var E = this.properties.emitter;
            var a = Math.max(seconds - h, 0);
            var b = seconds + h;
            var pa = simVector(E.position, a * fps, [0, 0, 0]);
            var pb = simVector(E.position, b * fps, [0, 0, 0]);
            var span = b - a;
            return [(pb[0] - pa[0]) / span, (pb[1] - pa[1]) / span, (pb[2] - pa[2]) / span];
        }

        update(e) {
            PZ.trapcode.setTime(e);
            if (!this.material) this.rebuildMaterial();
            var useCPU = this.needsCPU();
            var p = this.properties;
            var emitter = p.emitter;
            var burst = emitter.burstCount.get(PZ.trapcode.currentTime);

            if (useCPU) {
                this.writeCPU(this.simulateFrame(e));
            } else {
                this.updateGeometry();
            }

            this.updatePalettes();
            this.updateLayerMaps();
            this.updateAudio();
            var u = this.material.uniforms;
            var seconds = e / this.sceneRate();
            u.time.value = seconds;
            var perSec = emitter.particlesPerSec.get(PZ.trapcode.currentTime);
            u.rate.value = burst > 0 && perSec <= 0 ? this._count : Math.max(perSec, 1);
            u.lifetime.value = Math.max(p.particle.life.get(PZ.trapcode.currentTime), 0.0001);
            u.lifeRandom.value = p.particle.lifeRandom.get(PZ.trapcode.currentTime) / 100;
            var vectors = this.emitterVectors();
            u.ipos.value.set(vectors.position[0], vectors.position[1], vectors.position[2]);
            u.ivel.value.set(vectors.velocity[0], vectors.velocity[1], vectors.velocity[2]);
            u.speed.value = vectors.speed;
            u.emitterSize.value = vectors.emitterSize;
            u.emitterShape.value = vectors.emitterShape;
            u.behavior.value = vectors.behavior;
            u.burstInterval.value = Math.max(vectors.burstInterval, 0.0001);
            u.vspread.value = vectors.spread;
            var gravity = p.physics.gravity.get(PZ.trapcode.currentTime);
            u.accel.value.set(p.environment.windX.get(PZ.trapcode.currentTime), gravity + p.environment.windY.get(PZ.trapcode.currentTime), p.environment.windZ.get(PZ.trapcode.currentTime));
            u.size.value = p.particle.size.get(PZ.trapcode.currentTime);
            u.sizeRandom.value = p.particle.sizeRandom.get(PZ.trapcode.currentTime) / 100;
            u.opacity.value = p.particle.opacity.get(PZ.trapcode.currentTime) / 100;
            var tint = p.particle.color.get(PZ.trapcode.currentTime);
            u.colorTint.value.set(tint[0], tint[1], tint[2], 1);
            u.glow.value = p.particle.glow.get(PZ.trapcode.currentTime);
            // Streak controls (guarded: absent on projects saved before them).
            var pp = p.particle;
            var D2R = Math.PI / 180;
            u.emitterVelAmt.value = tnum(emitter, "velocityFromEmitterMotion", 0) / 100;
            u.massDiv.value = Math.max(tnum(p.physics, "mass", 10), 0.01) / 10;
            u.orient.value = tnum(pp, "orientToMotion", 0) / 100;
            u.orientFade.value = Math.max(tnum(pp, "orientFadeIn", 20), 0);
            u.sceneFps.value = this.sceneRate() || 30;
            u.rotBase.value.set(
                tnum(pp, "rotateX", 0) * D2R,
                tnum(pp, "rotateY", 0) * D2R,
                tnum(pp, "rotateZ", 0) * D2R
            );
            u.spinRate.value.set(
                tnum(pp, "degreesPerSecX", 0) * D2R,
                tnum(pp, "degreesPerSecY", 0) * D2R,
                tnum(pp, "degreesPerSecZ", 0) * D2R
            );
            u.spinRnd.value = tnum(pp, "randomRotation", 0) / 100;
            u.spinRateRnd.value = tnum(pp, "randomSpeedRotate", 0) / 100;
            u.spinDist.value = tnum(pp, "randomSpeedDistribution", 0.5);
            u.rotAir.value = Math.max(tnum(p.physics, "rotationalAirResistance", 0), 0);
            u.stretch.value = tnum(pp, "stretch", 0) / 100;
            var evel = this.emitterMotionAt(seconds);
            u.emitterVel.value.set(evel[0], evel[1], evel[2]);
            this.material.blending = p.particle.blending.get(PZ.trapcode.currentTime) === 1 ? THREE.AdditiveBlending : THREE.NormalBlending;
            if (useCPU) this.material.defines.USE_CPU = 1;
            else delete this.material.defines.USE_CPU;
            this.material.needsUpdate = true;
        }
        updatePalettes() {
            var palette = this.palettes;
            if (!this.material || !palette) return;
            if (this.material.uniforms.colorOverLife.value !== palette.colorOverLife) {
                this.material.uniforms.colorOverLife.value = palette.colorOverLife;
                this.material.uniforms.sizeOverLife.value = palette.sizeOverLife;
                this.material.uniforms.opacityOverLife.value = palette.opacityOverLife;
            }
            var particle = this.properties.particle;
            var colorGradient = particle.colorGradient.get(PZ.trapcode.currentTime);
            if (this._colorSignature !== signature(colorGradient)) {
                this._colorSignature = signature(colorGradient);
                fillGradient(palette.colorOverLife, colorGradient);
            }
            var sizeCurve = particle.sizeOverLife.get(PZ.trapcode.currentTime);
            var sizeEnabled = particle.sizeOverLifeEnabled.get(PZ.trapcode.currentTime);
            if (this._sizeSignature !== sizeEnabled + "|" + signature(sizeCurve)) {
                this._sizeSignature = sizeEnabled + "|" + signature(sizeCurve);
                fillCurve(palette.sizeOverLife, sizeCurve, sizeEnabled);
            }
            var opacityCurve = particle.opacityOverLife.get(PZ.trapcode.currentTime);
            var opacityEnabled = particle.opacityOverLifeEnabled.get(PZ.trapcode.currentTime);
            if (this._opacitySignature !== opacityEnabled + "|" + signature(opacityCurve)) {
                this._opacitySignature = opacityEnabled + "|" + signature(opacityCurve);
                fillCurve(palette.opacityOverLife, opacityCurve, opacityEnabled);
            }
        }
        async prepare(e) {
            if (this.texture) await this.texture.loading;
            await this.prepareAudio(e);
        }
        // Audio reactors need decoded PCM before a final render; export awaits this.
        async prepareAudio(e) {
            var audio = this.properties.audio;
            if (!audioReactorsOn(audio, e)) return;
            var source = audio.audioLayer.get(e);
            if (!source || T.audioAnalysis.has(source)) return;
            var project = this.tryGetParentOfType(PZ.project);
            try {
                await T.audioAnalysis.load(project, source);
            } catch (err) {
                console.warn("Trapcode Particular: the audio reactor source could not be decoded; reactors stay neutral.", err);
            }
        }
    };

    PZ.object3d.particular.system.prototype.defaultName = "System";
    PZ.object3d.particular.system.simulation = { SIM: SIM, audioLevel: audioReactorLevel, simulate: simulateSystem };

    var number = T.number;
    var vector3 = T.vector3;
    var option = T.option;
    var imageAsset = T.imageAsset;
    var curveProperty = T.curveProperty;

    PZ.object3d.particular.system.propertyDefinitions = systemPropertyDefinitions;

    PZ.object3d.particular.system.emitterDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Emitter" },
        emitterType: option("Emitter type", 0, "point;box;sphere;light;layer;model;text"),
        emitterBehavior: option("Emitter behavior", 0, "continuous;explode;burst"),
        emitFromParent: option("Emit from parent", 0, "off;on"),
        parentSystemIndex: number("Parent system index", 0, { min: 0, step: 1, decimals: 0 }),
        inheritVelocity: number("Inherit parent velocity[%]", 0, { min: 0, max: 100, step: 1 }),
        ratePercent: option("Particles/sec are % of primary", 0, "off;on"),
        burstInterval: number("Burst interval", 1, { min: 0.05, step: 0.05, decimals: 2 }),
        particlesPerSec: number("Particles/sec", 100, { min: 0, step: 1, decimals: 0 }),
        burstCount: number("Burst count", 0, { min: 0, step: 1, decimals: 0 }),
        position: vector3("Position", [0, 0, 0], { step: 1 }),
        emitterSize: number("Emitter size", 100, { min: 0, step: 1 }),
        direction: vector3("Direction", [0, 0, 0], { step: 0.01, decimals: 3 }),
        directionSpread: number("Direction spread", 20, { min: 0, step: 0.1, decimals: 1 }),
        velocity: number("Velocity", 100, { step: 1 }),
        velocityRandom: number("Velocity random", 20, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        velocityDistribution: number("Velocity distribution", 0.5, { min: 0, max: 1, step: 0.01, decimals: 2 }),
        velocityFromEmitterMotion: number("Velocity from emitter motion", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        rotation: number("Rotation", 0, { step: 1 }),
        rotationRandom: number("Rotation random", 0, { min: 0, step: 0.1, decimals: 1 }),
        rotationSpeed: number("Rotation speed", 0, { step: 1 }),
        rotationSpeedRandom: number("Rotation speed random", 0, { min: 0, step: 0.1, decimals: 1 }),
        randomSeed: number("Random seed", 100000, { step: 1, decimals: 0 }),
    };

    PZ.object3d.particular.system.particleDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Particle" },
        life: number("Life (seconds)", 3, { min: 0.01, step: 0.1, decimals: 2 }),
        lifeRandom: number("Life random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        particleType: option("Particle type", 1, "sprite;sphere;box;text"),
        texture: {
            name: "Texture",
            type: PZ.property.type.ASSET,
            items: PZ.object3d.particular.presetTexturesList,
            baseUrl: "/assets/textures/particles/",
            assetType: PZ.asset.type.IMAGE,
            accept: "image/*",
            value: "/assets/textures/particles/circle_soft.png",
            changed: function () {
                this.parentObject.redrawTexture();
            },
        },
        size: number("Size", 5, { min: 0, step: 0.1, decimals: 2 }),
        sizeRandom: number("Size random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeOverLifeEnabled: option("Size over life", 0, "off;on"),
        sizeOverLife: curveProperty("Size curve"),
        aspect: number("Aspect ratio", 1, { min: 0.01, step: 0.01, decimals: 2 }),
        orientToMotion: number("Orient to motion", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        orientFadeIn: number("Orient to motion fade-in", 20, { min: 0, step: 1, decimals: 0 }),
        rotateX: number("Rotate X", 0, { step: 1, decimals: 1 }),
        rotateY: number("Rotate Y", 0, { step: 1, decimals: 1 }),
        rotateZ: number("Rotate Z", 0, { step: 1, decimals: 1 }),
        randomRotation: number("Random rotation", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        degreesPerSecX: number("Degrees/sec X", 0, { step: 1, decimals: 1 }),
        degreesPerSecY: number("Degrees/sec Y", 0, { step: 1, decimals: 1 }),
        degreesPerSecZ: number("Degrees/sec Z", 0, { step: 1, decimals: 1 }),
        randomSpeedRotate: number("Random speed rotate", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        randomSpeedDistribution: number("Random speed distribution", 0.5, { min: 0, max: 1, step: 0.01, decimals: 2 }),
        stretch: number("Stretch along motion", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacity: number("Opacity", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacityRandom: number("Opacity random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        opacityOverLifeEnabled: option("Opacity over life", 0, "off;on"),
        opacityOverLife: curveProperty("Opacity curve"),
        setColor: option("Set color", 0, "at start;over life"),
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
        colorGradient: {
            name: "Color over life",
            type: PZ.property.type.GRADIENT,
            value: [{ position: 0, color: "rgba(255,255,255,1)" }],
        },
        colorRandom: number("Color random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        blending: option("Blend mode", 0, "normal;add;screen;multiply"),
        glow: number("Glow", 0, { min: 0, step: 0.01, decimals: 2 }),
        randomSeed: number("Random seed", 0, { step: 1, decimals: 0 }),
    };

    PZ.object3d.particular.system.physicsDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Physics" },
        enabled: option("Enabled", 0, "off;on"),
        gravity: number("Gravity", 0, { step: 1 }),
        drag: number("Air resistance", 0, { min: 0, step: 0.01, decimals: 3 }),
        mass: number("Mass", 10, { min: 0.01, step: 0.1, decimals: 2 }),
        massRandom: number("Mass random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeAffectsMass: number("Size affects mass", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        airResistanceRandom: number("Air resistance random", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeAffectsAirResistance: number("Size affects air resistance", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        rotationalAirResistance: number("Rotational air resistance", 0, { min: 0, step: 0.01, decimals: 3 }),
        bounceEnabled: option("Enable bounce", 0, "off;on"),
        bounceHeight: number("Bounce height", 500, { step: 1 }),
        bounceStrength: number("Bounce strength", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        meanderEnabled: option("Enable meander", 0, "off;on"),
        meanderAffectDirection: number("Affect direction", 20, { step: 0.1, decimals: 1 }),
        meanderAffectSpeed: number("Affect speed", 20, { step: 0.1, decimals: 1 }),
        flockingEnabled: option("Enable flocking", 0, "off;on"),
        flockAttract: number("Attract", 10, { step: 0.1, decimals: 1 }),
        flockSeparate: number("Separate", 10, { step: 0.1, decimals: 1 }),
        flockAlign: number("Align", 10, { step: 0.1, decimals: 1 }),
        flockRangeValue: number("Range of view", 500, { step: 1 }),
        flockFieldOfView: number("Field of view", 270, { step: 1 }),
        fluidEnabled: option("Enable fluid dynamics", 0, "off;on"),
        buoyancy: number("Buoyancy", 5, { step: 0.01, decimals: 2 }),
        vortexStrength: number("Vortex strength", 100, { step: 1 }),
        vortexCoreSize: number("Vortex core size", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.environmentDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Environment" },
        windX: number("Wind X", 0, { step: 1 }),
        windY: number("Wind Y", 0, { step: 1 }),
        windZ: number("Wind Z", 0, { step: 1 }),
        airDensity: number("Air density", 1, { min: 0, step: 0.01, decimals: 3 }),
        turbulenceEnabled: option("Air turbulence", 0, "off;on"),
        turbulenceAffectPosition: number("Affect position", 0, { min: 0, step: 0.1, decimals: 1 }),
        turbulenceAffectOrientation: number("Affect orientation/spin", 0, { min: 0, step: 0.1, decimals: 1 }),
        turbulenceScale: number("Scale", 10, { step: 0.1, decimals: 1 }),
        turbulenceComplexity: number("Complexity", 3, { min: 1, max: 8, step: 1, decimals: 0 }),
        turbulenceEvolutionSpeed: number("Evolution speed", 50, { step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.displaceDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Displace" },
        driftX: number("Drift X", 0, { step: 1 }),
        driftY: number("Drift Y", 0, { step: 1 }),
        driftZ: number("Drift Z", 0, { step: 1 }),
        spinAmplitude: number("Spin amplitude", 0, { step: 1 }),
        spinFrequency: number("Spin frequency", 1, { step: 0.01, decimals: 2 }),
        disperse: number("Disperse", 0, { step: 1 }),
        disperseStrengthOver: option("Disperse strength over", 0, "off;life;velocity;position"),
        disperseStrengthCurve: curveProperty("Disperse curve"),
        twist: number("Twist", 0, { step: 1 }),
        turbulenceAffectSize: number("Turbulence field affect size", 0, { step: 1 }),
        turbulenceAffectOpacity: number("Turbulence field affect opacity", 0, { step: 1 }),
    };

    PZ.object3d.particular.system.sphericalDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Spherical field" },
        strength: number("Strength[%]", 0, { step: 1 }),
        radius: number("Radius", 100, { min: 0, step: 1 }),
        position: vector3("Sphere position", [720, 540, 0], { step: 1 }),
        scaleX: number("Scale X", 100, { step: 1 }),
        scaleY: number("Scale Y", 100, { step: 1 }),
        scaleZ: number("Scale Z", 100, { step: 1 }),
        feather: number("Feather", 50, { min: 0, max: 100, step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.kaleidoDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Kaleidospace" },
        mirrorX: option("Mirror on X", 0, "off;on"),
        mirrorY: option("Mirror on Y", 0, "off;on"),
        mirrorZ: option("Mirror on Z", 0, "off;on"),
        center: vector3("Center position", [720, 540, 0], { step: 1 }),
    };

    PZ.object3d.particular.system.transformDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Transform" },
        rotationX: number("X rotation", 0, { step: 1 }),
        rotationY: number("Y rotation", 0, { step: 1 }),
        rotationZ: number("Z rotation", 0, { step: 1 }),
        scale: number("Scale", 100, { step: 1 }),
        offsetX: number("X offset", 0, { step: 1 }),
        offsetY: number("Y offset", 0, { step: 1 }),
        offsetZ: number("Z offset", 0, { step: 1 }),
    };

    PZ.object3d.particular.system.layerMapDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Layer maps" },
        colorAlphaEnabled: option("Color and alpha", 0, "off;on"),
        colorAlphaLayer: imageAsset("Color layer"),
        colorAlphaMix: number("Color mix", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        sizeEnabled: option("Size", 0, "off;on"),
        sizeLayer: imageAsset("Size layer"),
        sizeStrength: number("Size strength", 100, { step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.audioDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Audio react" },
        audioLayer: {
            name: "Audio layer",
            type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.AV,
            accept: "audio/*,video/*",
            value: null,
        },
        audioOffset: number("Audio offset (seconds)", 0, { min: 0, step: 0.01, decimals: 3 }),
        audioTrimIn: number("Audio trim in (seconds)", 0, { min: 0, step: 0.01, decimals: 3 }),
        audioTrimOut: number("Audio trim out (seconds, 0 = end)", 0, { min: 0, step: 0.01, decimals: 3 }),
        reactor1Enabled: option("Reactor 1", 0, "off;on"),
        reactor1Target: option("Reactor 1 target", 0, "size;opacity;velocity;color"),
        reactor1Strength: number("Reactor 1 strength", 100, { step: 0.1, decimals: 1 }),
        reactor2Enabled: option("Reactor 2", 0, "off;on"),
        reactor2Target: option("Reactor 2 target", 0, "size;opacity;velocity;color"),
        reactor2Strength: number("Reactor 2 strength", 100, { step: 0.1, decimals: 1 }),
        reactor3Enabled: option("Reactor 3", 0, "off;on"),
        reactor3Target: option("Reactor 3 target", 0, "size;opacity;velocity;color"),
        reactor3Strength: number("Reactor 3 strength", 100, { step: 0.1, decimals: 1 }),
        reactor4Enabled: option("Reactor 4", 0, "off;on"),
        reactor4Target: option("Reactor 4 target", 0, "size;opacity;velocity;color"),
        reactor4Strength: number("Reactor 4 strength", 100, { step: 0.1, decimals: 1 }),
    };

    PZ.object3d.particular.system.lightingDefinitions = {
        name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Lighting" },
        enabled: option("Shading", 0, "off;on"),
        lightFalloff: option("Light falloff", 0, "natural (lux);inverse square;inverse cube;none"),
        ambient: number("Ambient", 20, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        diffuse: number("Diffuse", 80, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specularAmount: number("Specular amount", 0, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        specularSharpness: number("Specular sharpness", 100, { min: 0, max: 100, step: 0.1, decimals: 1 }),
        reflectionStrength: number("Reflection strength", 100, { min: 0, step: 0.1, decimals: 1 }),
    };

    if (PZ.ui && PZ.ui.objectTypes) {
        PZ.ui.objectTypes.set(PZ.object3d.particular.system, [
            { name: "System", desc: "A particle emitting system.", type: 0 },
        ]);
    }

    var BLOCKS = [
        { key: "emitter", name: "Emitter" },
        { key: "particle", name: "Particle" },
        { key: "physics", name: "Physics" },
        { key: "environment", name: "Environment" },
        { key: "displace", name: "Displace" },
        { key: "spherical", name: "Spherical" },
        { key: "kaleidospace", name: "Kaleido" },
        { key: "transform", name: "Transform" },
        { key: "layerMaps", name: "Layer Maps" },
        { key: "audio", name: "Audio" },
        { key: "lighting", name: "Lighting" },
    ];

    var PRESETS = [
        { name: "Default burst", preset: "burst" },
        { name: "Fountain", preset: "fountain" },
        { name: "Snow", preset: "snow" },
    ];

    if (PZ.trapcode && PZ.trapcode.designer) {
        PZ.trapcode.designer.registerConfig(PZ.object3d.particular, {
            title: "Trapcode Particular Designer",
            targets: function (root) {
                return root.systems;
            },
            targetName: function (system, index) {
                if (index === 0) return "Primary System";
                return "System " + (index + 1);
            },
            addKinds: [
                {
                    name: "Add a System",
                    create: function (root) {
                        var system = new PZ.object3d.particular.system();
                        root.systems.push(system);
                        system.loading = system.load(null, root);
                        system.update(0);
                        return system;
                    },
                },
            ],
            blocks: function () {
                return BLOCKS;
            },
            groupFor: function (target, key) {
                return target.properties ? target.properties[key] : null;
            },
            presets: PRESETS,
            applyPreset: function (root, target, preset) {
                if (target && target.applyPreset) target.applyPreset(preset.preset);
            },
        });
    }
})();

