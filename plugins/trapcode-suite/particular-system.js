// OpenZoid Trapcode Suite — Particular System per-frame methods.
/*
 * particular-system.js
 *
 * The System methods that run every frame: CPU/GPU path selection,
 * the simTable cache, frame simulation, and update/prepare. They
 * extend PZ.object3d.particular.system, defined in particular.js.
 */

var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var SIM = T.particularSim.SIM;
    var SimTable = T.particularSim.SimTable;
    var simulateSystem = T.particularSim.simulateSystem;
    var simVector = T.particularSim.simVector;
    var audioReactorLevel = T.particularSim.audioReactorLevel;
    var audioReactorsOn = T.particularSim.audioReactorsOn;
    var signature = T.signature;
    var fillGradient = T.fillGradient;
    var fillCurve = T.fillCurve;
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

    PZ.object3d.particular.system.prototype.needsCPU = function () {
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
    };
    PZ.object3d.particular.system.prototype.secondaryCountMultiplier = function () {
        // System 2+ (any non-primary system) runs at 2x density: its final
        // particle count is doubled, so its effective particles/sec doubles.
        // Primary System (index 0) is unaffected.
        try {
            var particular = T.findParent(this, PZ.object3d.particular);
            if (!particular || !particular.systems || !particular.systems.indexOf) return 1;
            return particular.systems.indexOf(this) > 0 ? 2 : 1;
        } catch (err) {
            return 1;
        }
    };
    // Cached row table for this system at a nesting depth. Keyed by a
    // serialization of every input, so a stale table is never reused.
    PZ.object3d.particular.system.prototype.simTable = function (depth) {
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
    };
    // Pure function of (properties, seed, project frame e).
    PZ.object3d.particular.system.prototype.simulateFrame = function (e) {
        var seconds = e / this.sceneRate();
        if (!isFinite(seconds) || seconds < 0) seconds = 0;
        return simulateSystem(this, Math.min(seconds, SIM.MAX_TIME));
    };
    PZ.object3d.particular.system.prototype.writeCPU = function (state) {
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
    };
    // Emitter world velocity by central difference of the sampled position (GPU uniform).
    PZ.object3d.particular.system.prototype.emitterMotionAt = function (seconds) {
        var fps = this.sceneRate();
        var h = SIM.STEP;
        var E = this.properties.emitter;
        var a = Math.max(seconds - h, 0);
        var b = seconds + h;
        var pa = simVector(E.position, a * fps, [0, 0, 0]);
        var pb = simVector(E.position, b * fps, [0, 0, 0]);
        var span = b - a;
        return [(pb[0] - pa[0]) / span, (pb[1] - pa[1]) / span, (pb[2] - pa[2]) / span];
    };

    PZ.object3d.particular.system.prototype.update = function (e) {
        PZ.trapcode.setTime(e);
        if (!this.material) this.rebuildMaterial();
        var useCPU = this.needsCPU();
        var p = this.properties;
        var emitter = p.emitter;
        var burst = emitter.burstCount.get(PZ.trapcode.currentTime);

        var cpuState = null;
        if (useCPU) {
            cpuState = this.simulateFrame(e);
            this.writeCPU(cpuState);
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
        // Guarded: absent on projects saved before the direction control.
        var gravityDir = [0, 1, 0];
        try {
            var gd = p.physics.gravityDirection ? p.physics.gravityDirection.get(PZ.trapcode.currentTime) : null;
            if (gd && isFinite(gd[0]) && isFinite(gd[1]) && isFinite(gd[2])) {
                var gdLen = Math.sqrt(gd[0] * gd[0] + gd[1] * gd[1] + gd[2] * gd[2]);
                if (gdLen > 0.0001) gravityDir = [gd[0] / gdLen, gd[1] / gdLen, gd[2] / gdLen];
            }
        } catch (_gd) { /* old saves keep gravity on +Y */ }
        u.accel.value.set(
            p.environment.windX.get(PZ.trapcode.currentTime) + gravityDir[0] * gravity,
            p.environment.windY.get(PZ.trapcode.currentTime) + gravityDir[1] * gravity,
            p.environment.windZ.get(PZ.trapcode.currentTime) + gravityDir[2] * gravity);
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
        // Per-particle lighting from the scene lights (Lighting group).
        // CPU frames reuse the simulated bounds for the shadowlet axis;
        // GPU frames approximate the cloud box from the emitter (a pure
        // function of the properties, no history). While off the call
        // only clears the define, so legacy frames are untouched.
        var shadeBox = null;
        if (cpuState) {
            shadeBox = T.shading.boxFromPositions(cpuState.positions, cpuState.count);
        } else {
            var shadeLife = Math.max(p.particle.life.get(PZ.trapcode.currentTime), 0.0001);
            var shadeR = Math.max(1, vectors.emitterSize +
                Math.abs(vectors.speed) * shadeLife + Math.abs(vectors.spread) * 2);
            var shadeC = vectors.position;
            shadeBox = {
                min: [shadeC[0] - shadeR, shadeC[1] - shadeR, shadeC[2] - shadeR],
                max: [shadeC[0] + shadeR, shadeC[1] + shadeR, shadeC[2] + shadeR],
                center: [shadeC[0], shadeC[1], shadeC[2]],
            };
        }
        T.shading.update(this.material, p.lighting, this.threeObj, shadeBox);
        this.material.blending = p.particle.blending.get(PZ.trapcode.currentTime) === 1 ? THREE.AdditiveBlending : THREE.NormalBlending;
        if (useCPU) this.material.defines.USE_CPU = 1;
        else delete this.material.defines.USE_CPU;
        this.material.needsUpdate = true;
    };
    PZ.object3d.particular.system.prototype.updatePalettes = function () {
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
    };
    PZ.object3d.particular.system.prototype.prepare = async function (e) {
        if (this.texture) await this.texture.loading;
        await this.prepareAudio(e);
    };
    // Audio reactors need decoded PCM before a final render; export awaits this.
    PZ.object3d.particular.system.prototype.prepareAudio = async function (e) {
        var audio = this.properties.audio;
        if (!audioReactorsOn(audio, e)) return;
        var source = audio.audioLayer.get(e);
        if (!source || T.audioAnalysis.has(source)) return;
        var project = T.findParent(this, PZ.project);
        try {
            await T.audioAnalysis.load(project, source);
        } catch (err) {
            console.warn("Trapcode Particular: the audio reactor source could not be decoded; reactors stay neutral.", err);
        }
    };

    PZ.object3d.particular.system.prototype.defaultName = "System";
    PZ.object3d.particular.system.simulation = { SIM: SIM, audioLevel: audioReactorLevel, simulate: simulateSystem };
})();
