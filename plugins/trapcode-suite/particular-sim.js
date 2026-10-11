// OpenZoid Trapcode Suite — Particular deterministic CPU simulation core.
/*
 * particular-sim.js
 *
 * Pure simulation for Particular: the fixed-grid row cache
 * (SimTable), the particle integrator, and the audio reactor
 * readers. No THREE objects, no UI. Shared with the object
 * classes through T.particularSim; loaded before particular.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var clamp = T.clamp;

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
        var gravityDir = simVector(Y.gravityDirection, frame, [0, 1, 0]);
        var gravityLen = Math.sqrt(
            gravityDir[0] * gravityDir[0] + gravityDir[1] * gravityDir[1] + gravityDir[2] * gravityDir[2]);
        if (gravityLen > 0.0001) {
            gravityDir = [gravityDir[0] / gravityLen, gravityDir[1] / gravityLen, gravityDir[2] / gravityLen];
        } else {
            gravityDir = [0, 1, 0];
        }
        var fluidOn = num(Y.fluidEnabled, 0) === 1;
        // Fluid force type 0 is the legacy vortex swirl. Type 1 switches to
        // buoyancy with random swirl. The default keeps old projects identical.
        var fluidBuoyant = fluidOn && Math.round(num(Y.fluidForceType, 0)) === 1;
        var swirlOn = fluidOn && num(Y.fluidSwirlEnabled, 0) === 1;
        var sphereC = simVector(S.position, frame, [720, 540, 0]);
        var fluidOff = simVector(Y.fluidOffset, frame, [0, 0, 0]);
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
            wind: [
                num(V.windX, 0) + gravityDir[0] * gravity,
                num(V.windY, 0) + gravityDir[1] * gravity + (fluidBuoyant ? num(Y.buoyancy, 5) * 10 : 0),
                num(V.windZ, 0) + gravityDir[2] * gravity,
            ],
            bounce: num(Y.bounceEnabled, 0) === 1,
            bounceHeight: num(Y.bounceHeight, 500),
            bounceStrength: num(Y.bounceStrength, 50) / 100,
            meanderOn: meanderOn,
            meanderDir: meanderOn ? num(Y.meanderAffectDirection, 20) : 0,
            meanderSpeed: meanderOn ? num(Y.meanderAffectSpeed, 20) : 0,
            turbulence: num(V.turbulenceEnabled, 0) === 1 ? num(V.turbulenceAffectPosition, 0) : 0,
            turbulenceScale: Math.max(num(V.turbulenceScale, 10), 0.0001),
            sphere: num(S.strength, 0) / 100,
            sphereCenter: sphereC,
            sphereRadius: Math.max(num(S.radius, 100), 0.0001),
            sphereFeather: num(S.feather, 50) / 100,
            // Fluid motion. Gravity, wind and air resistance above keep
            // applying while fluid mode is on; fluid adds its own forces.
            fluidTime: fluidOn ? num(Y.fluidTimeScale, 100) / 100 : 1,
            viscosity: fluidOn ? Math.max(num(Y.fluidViscosity, 0), 0) : 0,
            vortex: fluidOn && !fluidBuoyant ? num(Y.vortexStrength, 100) : 0,
            // Core size 50 reproduces the legacy radius (the spherical field
            // radius); other values scale it.
            vortexCore: fluidOn ? Math.max(num(Y.vortexCoreSize, 50), 0) / 50 : 1,
            vortexTilt: fluidOn ? num(Y.fluidVortexTilt, 0) * Math.PI / 180 : 0,
            vortexSpin: fluidOn ? num(Y.fluidVortexRotate, 0) * Math.PI / 180 : 0,
            fluidCenter: [sphereC[0] + fluidOff[0], sphereC[1] + fluidOff[1], sphereC[2] + fluidOff[2]],
            swirl: swirlOn ? num(Y.fluidSwirlStrength, 100) : 0,
            swirlScale: Math.max(num(Y.fluidSwirlScale, 100), 0.0001),
            swirlSeed: num(Y.fluidSeed, 0),
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

    // Parent events that may be alive at time b, as a counted key range per
    // emission run (continuous: one run; burst: one run per live cycle).
    function simParentCandidates(parent, b) {
        if (parent.behavior === 0) {
            var hi = Math.floor(parent.cumAt(b)) - 1;
            if (hi < 0) return [];
            var lo = Math.max(0, Math.floor(parent.cumAt(b - parent.lifeBoundAt(b))) - 1);
            return [{ first: lo, n: hi - lo + 1 }];
        }
        if (parent.behavior === 1) {
            var count = parent.rowAtTime(0).count;
            return count >= 1 ? [{ first: 0, n: count }] : [];
        }
        var runs = [];
        var lb = parent.lifeBoundAt(b);
        for (var c = parent.cycleAtOrBefore(b); c >= 0; c--) {
            var info = parent.cycleInfo(c);
            if (!info || info.count < 1) continue;
            if (info.start + info.count / info.rate + lb < b) break;
            var born = Math.min(Math.floor((b - info.start) * info.rate) + 1, info.count);
            if (born > 0) runs.push({ first: c * SIM.CYCLE_STRIDE, n: born });
        }
        return runs;
    }

    // Parent emission: child events are dealt round-robin over every parent
    // particle alive at the child birth, so each parent emits at the same rate
    // and leaves a continuous trail along its own path (aux streaks). Returns
    // that parent's state at the birth time, or null when no parent is alive.
    var PARENT_PROBES = 8;
    function simParentSource(table, ev) {
        var parent = table.parentTable;
        if (!parent) return null;
        var b = ev.birth;
        var runs = simParentCandidates(parent, b);
        var total = 0;
        for (var r = 0; r < runs.length; r++) total += runs[r].n;
        if (total < 1) return null;
        var start = ev.key % total;
        for (var probe = 0; probe < Math.min(total, PARENT_PROBES); probe++) {
            // Newest first, so a short probe skips parents that already died.
            var slot = (start + probe) % total;
            var key = -1;
            for (var j = 0; j < runs.length; j++) {
                if (slot < runs[j].n) {
                    key = runs[j].first + runs[j].n - 1 - slot;
                    break;
                }
                slot -= runs[j].n;
            }
            var pev = key >= 0 ? parent.eventFor(key) : null;
            if (!pev || !(pev.birth <= b && b < pev.birth + pev.life)) continue;
            var pspawn = simSpawn(parent, pev);
            if (!pspawn) continue;
            return simIntegrate(parent, pev, pspawn, b);
        }
        return null;
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
            var fc = row.fluidCenter;
            var fdx = x - fc[0], fdy = y - fc[1], fdz = z - fc[2];
            // Vortex tilt rotates the swirl plane around X. At zero tilt this
            // is the legacy XZ swirl around the field center.
            var cT = Math.cos(row.vortexTilt), sT = Math.sin(row.vortexTilt);
            var txx = fdx, tyy = fdy * cT - fdz * sT, tzz = fdy * sT + fdz * cT;
            var vdist = Math.sqrt(txx * txx + tzz * tzz) || 1;
            var vrad = Math.max(row.sphereRadius * row.vortexCore, 0.0001);
            if (vdist < vrad) {
                var swirl = (row.vortex / 100) * (1 - vdist / vrad) * dt * row.fluidTime;
                var tgvx = (-tzz / vdist) * swirl * 100;
                var tgvz = (txx / vdist) * swirl * 100;
                var tgvy = Math.sin(vdist * 0.01 + time) * swirl * 10;
                // Vortex rotate biases the swirl direction toward radial
                // inflow/outflow. At zero it is the legacy tangential swirl.
                var cA = Math.cos(row.vortexSpin), sA = Math.sin(row.vortexSpin);
                var fvx = tgvx * cA - tgvz * sA;
                var fvz = tgvx * sA + tgvz * cA;
                // Back through the inverse tilt.
                vx += fvx;
                vy += tgvy * cT + fvz * sT;
                vz += -tgvy * sT + fvz * cT;
            }
        }
        if (row.swirl !== 0) {
            var sn = simNoise(x / row.swirlScale, y / row.swirlScale, z / row.swirlScale, time + row.swirlSeed);
            var sAmt = row.swirl * row.fluidTime * dt;
            vx += sn[0] * sAmt;
            vy += sn[1] * sAmt;
            vz += sn[2] * sAmt;
        }
        var massDiv = row.massBase * (st.massVar || 1);
        if (!(massDiv > 0)) massDiv = 1;
        vx += (row.wind[0] / massDiv) * dt;
        vy += (row.wind[1] / massDiv) * dt;
        vz += (row.wind[2] / massDiv) * dt;
        if (row.drag > 0 || row.viscosity > 0) {
            var visc = (row.drag > 0 ? row.drag * (st.dragVar || 1) : 0) + row.viscosity;
            var damp = Math.max(0, 1 - (visc / massDiv) * dt * 10);
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
        var local = T.audioClipTime(system, source, frame, system.sceneRate()) - simNumber(audio.audioOffset, frame, 0);
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


    // Shared with particular.js / particular-system.js, which load
    // after this file and alias the entries they need.
    T.particularSim = {
        SIM: SIM,
        SimTable: SimTable,
        simulateSystem: simulateSystem,
        simVector: simVector,
        audioReactorLevel: audioReactorLevel,
        audioReactorsOn: audioReactorsOn,
    };
})();
