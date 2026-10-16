// Particular emitter rotation and deterministic particle orientation noise.
var PZ = PZ || {};

(function () {
    var T = PZ.trapcode;
    var D2R = Math.PI / 180;
    function enabled(system) {
        return (system.particular || system.parentParticular)?.spinMode === 1;
    }
    function read(property, frame, fallback) {
        return ZoidiumPluginApis.props.readNumber(property, frame, fallback);
    }
    function sample(system, seconds, fps) {
        if (!enabled(system)) return null;
        var p = system.properties, e = p.emitter, d = p.displace, v = p.environment;
        var frame = seconds * fps;
        return {
            rotation: read(e.rotation, frame, 0),
            rotationRandom: read(e.rotationRandom, frame, 0) / 100,
            speed: read(e.rotationSpeed, frame, 0),
            speedRandom: read(e.rotationSpeedRandom, frame, 0) / 100,
            amplitude: read(d.spinAmplitude, frame, 0) * D2R,
            frequency: read(d.spinFrequency, frame, 1),
            turbulence: read(v.turbulenceEnabled, frame, 0) === 1
                ? read(v.turbulenceAffectOrientation, frame, 0) * D2R : 0,
            scale: Math.max(Math.abs(read(v.turbulenceScale, frame, 10)), 0.0001),
            complexity: Math.min(Math.max(Math.round(read(v.turbulenceComplexity, frame, 3)), 1), 8),
            evolution: read(v.turbulenceEvolutionSpeed, frame, 50) * 0.002,
            wind: [read(v.windX, frame, 0), read(v.windY, frame, 0), read(v.windZ, frame, 0)],
        };
    }
    function active(system, frame, fps) {
        var settings = sample(system, frame / fps, fps);
        return !!(settings && (settings.rotation !== 0 || settings.rotationRandom !== 0 || settings.speed !== 0 ||
            settings.amplitude !== 0 || settings.turbulence !== 0 || system.properties.emitter.rotationSpeed?.animated));
    }
    function hash(seed, key, channel) {
        return ZoidiumPluginApis.random.particularSimHash(seed, key, channel);
    }
    function emitterAngle(settings, seed, key, integratedSpeed) {
        if (!settings) return 0;
        return (settings.rotation + (hash(seed, key, 41) - 0.5) * 360 * settings.rotationRandom +
            integratedSpeed * (1 + (hash(seed, key, 43) - 0.5) * 2 * settings.speedRandom)) * D2R;
    }
    function rotateXY(x, y, angle) {
        var c = Math.cos(angle), s = Math.sin(angle);
        return [x * c - y * s, x * s + y * c];
    }
    function orientation(settings, seed, key, seconds, position) {
        var out = [0, 0, 0];
        if (!settings || (!settings.amplitude && !settings.turbulence)) return out;
        for (var axis = 0; axis < 3; axis++) {
            var phase = hash(seed, key, 47 + axis) * Math.PI * 2;
            out[axis] = settings.amplitude * Math.sin(seconds * settings.frequency * Math.PI * 2 + phase);
            if (!settings.turbulence) continue;
            var x = (position[0] - settings.wind[0] * seconds) / settings.scale;
            var y = (position[1] - settings.wind[1] * seconds) / settings.scale;
            var z = (position[2] - settings.wind[2] * seconds) / settings.scale;
            var time = seconds * settings.evolution;
            var noise = 0, weight = 1, total = 0, scale = 1;
            for (var octave = 0; octave < settings.complexity; octave++) {
                noise += Math.sin(x * scale + time + phase) * Math.cos(y * scale * 1.3 - time + phase) *
                    Math.sin(z * scale * 0.7 + time * 0.5 + phase) * weight;
                total += weight; weight *= 0.5; scale *= 2;
            }
            out[axis] += settings.turbulence * noise / total;
        }
        return out;
    }
    T.particularSpin = { enabled: enabled, sample: sample, active: active,
        emitterAngle: emitterAngle, rotateXY: rotateXY, orientation: orientation };
})();
