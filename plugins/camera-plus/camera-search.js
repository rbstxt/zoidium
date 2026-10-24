// Bound shared-camera evaluation to authored camera hierarchies. Plans are
// rebuilt for every lookup: property edits and shutter times can change both
// selection and dependencies while the project frame stays the same.
parts.cameraSearch = function (PZ, TYPE) {
  function isCamera(object) {
    return object.type === 6 || object.type === TYPE || object instanceof PZ.object3d.camera;
  }
  function hasExpression(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (value.expression) return true;
    // Inspect only property payloads, never ownership links or observers.
    if (Array.isArray(value)) return value.some(child => hasExpression(child, seen));
    if (value instanceof PZ.propertyList) return Object.keys(value).some(key => hasExpression(value[key], seen));
    return hasExpression(value.objects, seen) || hasExpression(value.childProperties, seen);
  }
  function plan(scene) {
    const nodes = [];
    const required = new Set();
    function walk(objects, ancestors) {
      for (const object of objects || []) {
        nodes.push(object);
        if (isCamera(object)) {
          required.add(object);
          for (const ancestor of ancestors) required.add(ancestor);
        }
        if (object.objects) walk(object.objects, ancestors.concat(object));
      }
    }
    walk(scene.objects, []);
    if (!required.size) return null;
    // Expressions may read world transforms or execute arbitrary native code.
    // Track To and custom objects may depend on siblings as well. Inspect only
    // scenes with a possible camera, without evaluating any property reader.
    const full = nodes.some(object => hasExpression(object.properties) || hasExpression(object.customProperties) ||
      object.properties?.zoidiumTrackTo && object.properties.zoidiumTrackTo.value !== '' || object.__zoidiumRepeater ||
      !(Number.isInteger(object.type) && object.type >= 0 && object.type <= 6 || object.type === 99 || object.type === TYPE) ||
      object.objects && !(PZ.object3d.group && Object.getPrototypeOf(object) === PZ.object3d.group.prototype));
    return { full, required };
  }
  function update(scene, time, evaluation) {
    function walk(objects) {
      for (const object of objects) {
        if (!evaluation.required.has(object)) continue;
        if (object.objects) {
          // Native groups recursively update their object list. Use a receiver
          // with only required children, sharing the real properties and Three
          // transform. Never replace or reparent the authored object list.
          const receiver = Object.create(object);
          receiver.objects = object.objects.filter(child => evaluation.required.has(child)).map(child => {
            if (!child.objects) return child;
            return { update: () => walk([child]) };
          });
          object.update.call(receiver, time);
        } else object.update(time);
      }
    }
    if (evaluation.full) for (const object of scene.objects) object.update(time);
    else walk(scene.objects);
    scene.threeObj.updateMatrixWorld(true);
  }
  return { plan, update };
};
