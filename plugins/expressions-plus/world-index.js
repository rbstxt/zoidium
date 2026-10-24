"use strict";

// Cache authored structure only. Every pose still samples fresh properties at
// the caller's exact time. Weak event keys do not retain deleted projects.
function createWorldIndex({ PZ, patch }) {
  const events = new WeakSet(), indexes = new WeakMap();
  let revision = 0;
  if (patch && PZ.observable?.prototype) {
    patch(PZ.observable.prototype, "update", original => function () {
      if (events.has(this)) revision++;
      return original.apply(this, arguments);
    });
  }
  function observe(event) {
    if (event && patch) { events.add(event); return true; }
    return false;
  }
  return function index(scene, readId) {
    const previous = indexes.get(scene);
    if (previous?.revision === revision && previous.cacheable) return previous;
    const parents = new Map(), order = new Map(), ids = new Map(), sampledIds = [];
    let cacheable = !!patch;
    function collect(nodes, parent) {
      // Plain arrays have no mutation contract. Keep the uncached path for
      // callers outside the native project model.
      if (nodes && !observe(nodes.onListChanged)) cacheable = false;
      for (const host of nodes || []) {
        parents.set(host, parent); order.set(host, order.size);
        observe(host.onParentChanged);
        observe(host.properties?.onListChanged);
        const property = host.properties?.zoidiumId;
        if (property) {
          if (PZ.property?.static && property instanceof PZ.property.static && observe(property.onChanged)) {
            const id = readId(property);
            if (id) ids.set(id, host);
          } else sampledIds.push(host);
        }
        collect(host.objects, host);
      }
    }
    collect(scene.objects, null);
    const result = { parents, order, ids, sampledIds, revision, cacheable };
    indexes.set(scene, result);
    return result;
  };
}
module.exports = { createWorldIndex };
