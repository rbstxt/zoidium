(function installEmptyKeyframesRepair(global) {
  "use strict";

  // CM3 adds a property's default keyframe only when the saved data has no
  // keyframe list at all. Saved data with an empty list ("keyframes": [])
  // loads with no keyframe, and every later get() without an expression
  // throws while reading keyframes[0]. Some plugin and donor properties were
  // saved that way; a Text+ seed in that state made Text+ rebuild its glyph
  // meshes on every frame. Give such a property the default keyframe CM3
  // would have created, unless its definition allows an empty list.
  var PZ = global.PZ;
  var keyframesClass = PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.keyframes;
  var prototype = keyframesClass && keyframesClass.prototype;
  if (!prototype || typeof prototype.load !== "function" || prototype.__zoidiumEmptyKeyframesRepair) return;

  var originalLoad = prototype.load;
  prototype.load = function load(data) {
    var result = originalLoad.apply(this, arguments);
    if (data && this.keyframes && this.keyframes.length === 0 && !(this.definition && this.definition.allowEmpty)) {
      var value = this.getDefaultValue();
      if (typeof value === "function") value(this);
      else this.keyframes.push(new PZ.keyframe(value, 0, this.defaultTween));
    }
    return result;
  };
  prototype.__zoidiumEmptyKeyframesRepair = true;
})(typeof window !== "undefined" ? window : globalThis);
