(function installCameraResources(global) {
  "use strict";
  const prototype = global.PZ?.object3d?.camera?.prototype;
  if (!prototype?.changeObjectType || prototype.__zoidiumCameraResources) return;
  const subscriptions = new WeakMap(), retiredActive = new WeakMap();
  const changeObjectType = prototype.changeObjectType, unload = prototype.unload;

  function release(camera) {
    const entry = subscriptions.get(camera);
    if (!entry) return;
    subscriptions.delete(camera);
    if (retiredActive.get(entry.layer) === camera) retiredActive.delete(entry.layer);
    for (const callback of entry.callbacks) entry.signal.unwatch(callback);
    if (entry.cachedProject) delete camera.parentProject;
  }

  prototype.changeObjectType = function () {
    release(this);
    const layer = this.parentLayer, signal = layer?.properties?.resolution?.onChanged;
    // Native PZ.observable appends bound callbacks to watchers synchronously.
    // Capture that appended range without replacing the shared watch method.
    if (!Array.isArray(signal?.watchers)) return changeObjectType.apply(this, arguments);
    const start = signal.watchers.length;
    try {
      const result = changeObjectType.apply(this, arguments);
      subscriptions.set(this, { signal, layer, callbacks: signal.watchers.slice(start) });
      const previous = retiredActive.get(layer);
      if (previous && previous !== this) release(previous);
      return result;
    } catch (error) {
      for (const callback of signal.watchers.slice(start)) signal.unwatch(callback);
      throw error;
    }
  };
  prototype.unload = function () {
    try { return unload?.apply(this, arguments); }
    finally {
      const entry = subscriptions.get(this), layer = entry?.layer || this.parentLayer;
      // CM3 keeps drawing through a deleted active camera until replaced.
      // Its resolution callback must remain attached during that interval.
      if (this.threeObj && layer?.pass?.camera === this.threeObj) {
        // Native deletion clears parent, but resolutionChanged reads the
        // project through it. Keep that lookup valid until replacement.
        if (entry && !Object.hasOwn(this, "parentProject")) {
          Object.defineProperty(this, "parentProject", { configurable: true, value: this.parentProject });
          entry.cachedProject = true;
        }
        const previous = retiredActive.get(layer);
        if (previous && previous !== this) release(previous);
        retiredActive.set(layer, this);
      } else release(this);
    }
  };
  prototype.__zoidiumCameraResources = true;
})(typeof window !== "undefined" ? window : globalThis);
