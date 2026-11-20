(function installEffectBypassRender(global) {
  "use strict";
  const PZ = global.PZ, api = PZ?.zoidium?.effectBypass;
  const prototype = PZ?.compositor?.prototype;
  if (!api || !prototype?.renderEffects) return;
  const render = prototype.renderEffects;
  prototype.renderEffects = function (effects) {
    if (!effects || !Array.from(effects).some(effect => api.bypassed(effect))) {
      return render.apply(this, arguments);
    }
    const args = Array.from(arguments);
    args[0] = Array.from(effects).filter(effect => !api.bypassed(effect));
    return render.apply(this, args);
  };
})(window);
