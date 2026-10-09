(function installParticleDefaultsPatch(global) {
  "use strict";

  var PZ = global.PZ;
  var particleClass = PZ && PZ.object3d && PZ.object3d.particles;
  var particlePrototype = particleClass && particleClass.prototype;

  if (
    !particlePrototype ||
    typeof particlePrototype.load !== "function" ||
    particlePrototype.__zoidiumParticleDefaultsPatch
  ) {
    return;
  }

  function cloneJson(value) {
    if (value === undefined || typeof value === "function") return undefined;
    if (value === null || typeof value !== "object") return value;

    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return value;
    }
  }

  function getResetData(property) {
    var definition = property && property.definition;
    if (!definition) return undefined;

    if (property instanceof PZ.property.dynamic.group) {
      return {
        objects: property.objects.map(getResetData),
      };
    }

    if (property instanceof PZ.property.dynamic.keyframes) {
      var dynamicValue = cloneJson(definition.value);
      if (dynamicValue === undefined) return undefined;

      return {
        animated: false,
        keyframes: [
          {
            frame: 0,
            value: dynamicValue,
            tween: property.defaultTween,
          },
        ],
      };
    }

    return cloneJson(definition.value);
  }

  // The Reset values are all zero or empty: zero particles, a zero emitter rate
  // (delay = index / rate becomes Infinity in the shader, so no particle is
  // ever emitted), a zero lifetime (mod by zero in the shader), no sprite
  // texture (the fragment shader samples an empty texture), and no spread
  // (every particle sits on the origin). Give a new Particles
  // object a small deterministic emitter instead. None of these values use
  // randomness, and they only apply when a new object is created without data.
  var NEW_PARTICLE_DEFAULTS = {
    number: 400,
    rate: 200,
    lifetime: 3,
    pspread: [20, 20, 20],
    vspread: [100, 100, 100],
    color: [
      { position: 0, color: "rgba(255,255,255,1)" },
      { position: 1, color: "rgba(255,255,255,0)" },
    ],
    // CM3 reads the size ramp's red channel as a point-scale factor (38/255).
    size: [{ position: 0, color: "rgba(38,38,38,1)" }],
  };

  function getDefaultSpriteTexture(particle) {
    var presets = particle.presetTextures;
    if (!presets || !presets.length) return null;

    var preset = presets.indexOf("circle_soft") >= 0 ? "circle_soft" : presets[0];
    var baseUrl = particle.properties.texture.definition.baseUrl || "";
    return baseUrl + preset + ".png";
  }

  function getParticleResetProperties(particle) {
    var properties = particle.properties;
    var resetProperties = {};

    Object.keys(properties).forEach(function (key) {
      var value = getResetData(properties[key]);
      if (value !== undefined) resetProperties[key] = value;
    });

    Object.keys(NEW_PARTICLE_DEFAULTS).forEach(function (key) {
      if (properties[key]) resetProperties[key] = cloneJson(NEW_PARTICLE_DEFAULTS[key]);
    });

    var texturePath = properties.texture && getDefaultSpriteTexture(particle);
    if (texturePath && particle.parentProject && particle.parentProject.assets) {
      // Register the preset the same way CM3's randomizer does before the
      // texture property resolves it through the project asset list.
      particle.parentProject.assets.createFromPreset(PZ.asset.type.IMAGE, texturePath);
      resetProperties.texture = texturePath;
    }

    // Particle's time is the one intentional exception to the Reset button's
    // literal value: it should follow the project clock as an expression.
    if (properties.time) {
      var timeResetData = getResetData(properties.time);
      if (timeResetData && typeof timeResetData === "object") {
        timeResetData.animated = true;
        timeResetData.expression = "time";
        resetProperties.time = timeResetData;
      }
    }

    return resetProperties;
  }

  var originalLoad = particlePrototype.load;
  particlePrototype.load = function loadParticle(data) {
    // The object picker calls load() without data for a new Particle. CM3's
    // built-in path randomizes that case; use the same property defaults as
    // the Reset command instead.
    if (!data || typeof data !== "object" || !data.properties) {
      data = {
        properties: getParticleResetProperties(this),
      };
    }

    return originalLoad.call(this, data);
  };
  particlePrototype.__zoidiumParticleDefaultsPatch = true;
})(window);
