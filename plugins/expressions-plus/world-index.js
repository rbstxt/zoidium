"use strict";

// Cache authored structure only. Every pose still samples fresh properties at
// the caller's exact time. Weak event keys do not retain deleted projects.
//
// The structural observables visited by index() are wrapped per instance, so
// projects that never evaluate a world helper keep the native shared update
// untouched. Passing patch opts into cached indexing; without it every call
// re-collects, which is also the path for callers outside the native project
// model.
function createWorldIndex({ PZ, patch }) {
  const events = new WeakMap(), indexes = new WeakMap();
  let revision = 0;
  function observe(event) {
    if (!event || !patch) return false;
    if (!events.has(event)) {
      // A re-activated provider adopts the live root instead of chaining a
      // wrapper around a previous provider's stale delegation.
      let native = event.update;
      while (typeof native === "function" && native.zoidiumWorldIndexRoot !== undefined) native = native.zoidiumWorldIndexRoot;
      if (typeof native === "function") {
        const wrapped = function () {
          revision++;
          return native.apply(this, arguments);
        };
        wrapped.zoidiumWorldIndexRoot = native;
        event.update = wrapped;
      }
      events.set(event, native);
    }
    return true;
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
