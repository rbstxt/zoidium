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

  function getParticleResetProperties(properties) {
    var resetProperties = {};

    Object.keys(properties).forEach(function (key) {
      var value = getResetData(properties[key]);
      if (value !== undefined) resetProperties[key] = value;
    });

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
        properties: getParticleResetProperties(this.properties),
      };
    }

    return originalLoad.call(this, data);
  };
  particlePrototype.__zoidiumParticleDefaultsPatch = true;
})(window);
