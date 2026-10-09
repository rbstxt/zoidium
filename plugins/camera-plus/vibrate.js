// Camera+ vibrate: seeded, stateless camera shake.
//
// Every offset is a pure function of the stored properties and the evaluation
// time t. Nothing is accumulated between calls, so repeated, reversed, or
// direct evaluation of the same time yields the same pose.
//
// Evaluated with (PZ, THREE, parts) by camera-runtime.js; publishes parts.vibrate.
parts.vibrate = (function () {
  function hashNoise(index, seed) {
    const r = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    return (r - Math.floor(r)) * 2 - 1;
  }

  // Value noise between integer lattice points. `stepped` rounds the blend
  // weight, giving a regular pulse instead of a smooth wobble.
  function sampleNoise(x, seed, stepped) {
    const i = Math.floor(x);
    let a = x - i;
    if (stepped) a = Math.floor(a + 0.5);
    a = a * a * (3 - 2 * a);
    return hashNoise(i, seed) * (1 - a) + hashNoise(i + 1, seed) * a;
  }

  function createDefinitions(PZ) {
    const T = PZ.property.type;
    return {
      enabled: { name: "Enabled", type: T.OPTION, value: 1, items: "off;on" },
      regularPulse: { name: "Regular Pulse", type: T.OPTION, value: 0, items: "off;on" },
      relative: { name: "Relative", type: T.OPTION, value: 0, items: "off;on" },
      seed: { name: "Seed", type: T.NUMBER, value: 0, min: 0, max: 100000, step: 1, decimals: 0 },
      enablePosition: { name: "Enable Position", type: T.OPTION, value: 0, items: "off;on" },
      positionAmplitude: { name: "Position Amplitude", type: T.VECTOR3, value: [0, 0, 0], min: 0, step: 1, decimals: 2 },
      positionFrequency: { name: "Position Frequency", type: T.NUMBER, value: 2, min: 0, step: 0.01, decimals: 2 },
      enableRotation: { name: "Enable Rotation", type: T.OPTION, value: 0, items: "off;on" },
      rotationAmplitude: { name: "Rotation Amplitude", type: T.VECTOR3, value: [0, 0, 0], min: 0, step: 1, decimals: 1 },
      rotationFrequency: { name: "Rotation Frequency", type: T.NUMBER, value: 2, min: 0, step: 0.01, decimals: 2 },
    };
  }

  function createProperties(PZ) {
    const list = new PZ.propertyList(createDefinitions(PZ));
    Object.defineProperty(list, "displayName", { value: "Vibrate", writable: true });
    return list;
  }

  // Writes the vibrate offsets onto the camera transform. `position` and
  // `rotation` are the base pose at time t (degrees are converted here).
  function applyVibrate(vibrate, t, camera, position, rotation) {
    if (vibrate.enabled.get() !== 1) return;
    const seed = vibrate.seed.get();
    const stepped = vibrate.regularPulse.get() === 1;
    const relative = vibrate.relative.get() === 1;
    const axes = ["x", "y", "z"];
    if (vibrate.enablePosition.get() === 1) {
      const amplitude = vibrate.positionAmplitude.get();
      const frequency = vibrate.positionFrequency.get();
      for (let h = 0; h < 3; h++) {
        let scale = amplitude[h] || 0;
        if (relative) scale = scale * 0.01 * Math.abs(position[h]);
        camera.position[axes[h]] += sampleNoise(t * frequency, seed + 17 * h, stepped) * scale;
      }
    }
    if (vibrate.enableRotation.get() === 1) {
      const amplitude = vibrate.rotationAmplitude.get();
      const frequency = vibrate.rotationFrequency.get();
      for (let f = 0; f < 3; f++) {
        let scale = amplitude[f] || 0;
        if (relative) scale = scale * 0.01 * Math.abs(rotation[f]);
        camera.rotation[axes[f]] += sampleNoise(t * frequency, seed + 101 + 17 * f, stepped) * scale * (Math.PI / 180);
      }
    }
  }

  return { createDefinitions: createDefinitions, createProperties: createProperties, applyVibrate: applyVibrate };
})();
