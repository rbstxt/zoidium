(function (global) {
  "use strict";
  var builder = global.ZoidiumUIBuilder, model = builder.themeModel, editor = builder.themeEditor;
  var registered = new Map(), aliases = Object.create(null), observer = null;
  function keyFor(clip) {
    if (!clip) return null;
    var PZ = global.PZ, object = clip.object;
    var audio = PZ.clip?.audio && clip instanceof PZ.clip.audio || PZ.audio && object instanceof PZ.audio;
    return model.typeKey(object && object.type, audio, aliases);
  }
  function types() {
    var PZ = global.PZ, result = new Map();
    function add(type, name) {
      var key = model.typeKey(type, false, aliases);
      if (key) result.set(key, { key: key, name: type === 4 ? "3D Scene" : name });
    }
    (PZ.ui.objectTypes.get(PZ.layer) || []).forEach(function (entry) {
      if (!entry.category && entry.type !== undefined) add(entry.type, entry.name);
    });
    // These native factory classes have no Add-layer picker entry.
    if (PZ.layer.texture) add(0, "Media/footage");
    add(5, "Layer");
    result.set("audio", { key: "audio", name: "Audio" });
    registered.forEach(function (spec) { add(spec.type, spec.name || spec.id); });
    global.document.querySelectorAll(".clip").forEach(function (element) {
      var key = keyFor(element.pz_object);
      if (key && !result.has(key)) result.set(key, { key: key, name: key });
    });
    // Retain colors for temporarily disabled plugins so they can be reset.
    var theme = editor.selected();
    if (theme) Object.keys(theme.clips).forEach(function (key) {
      if (!result.has(key)) result.set(key, { key: key, name: key + " (unavailable)" });
    });
    return Array.from(result.values()).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function apply(element) {
    if (!element.classList?.contains("clip")) return;
    var key = keyFor(element.pz_object);
    if (!key) return;
    element.dataset.zoidiumLayerType = key;
    var theme = editor.selected(), palette = editor.palette();
    var color = theme && theme.clips[key], selected = color ? model.selectedClip(color) : palette.clipSelected;
    if (color) {
      element.style.setProperty("--zoidium-layer-clip", color);
      element.style.setProperty("--zoidium-layer-clip-selected", selected);
    } else {
      element.style.removeProperty("--zoidium-layer-clip");
      element.style.removeProperty("--zoidium-layer-clip-selected");
    }
    // Native presets keep their original label tint, including Gray.
    element.style.setProperty("--zoidium-clip-label", theme ? model.labelColor(color || palette.clip) : "#2c323f");
    element.style.setProperty("--zoidium-clip-label-selected", theme ? model.labelColor(selected) : "#2c323f");
  }
  function applyTree(root) {
    apply(root);
    root.querySelectorAll?.(".clip").forEach(apply);
  }
  function refresh() { global.document.querySelectorAll(".clip").forEach(apply); }
  var proto = global.PZ.ui.timeline.tracks.prototype;
  var original = proto.createClipElement;
  proto.createClipElement = function () {
    var element = original.apply(this, arguments);
    apply(element);
    return element;
  };
  // CM3 creates drag proxies outside createClipElement. Observe additions only;
  // changing a selection class never replaces a node or affects a gesture.
  observer = new MutationObserver(function (records) {
    records.forEach(function (record) { record.addedNodes.forEach(function (node) { if (node.nodeType === 1) applyTree(node); }); });
  });
  observer.observe(global.document.body, { childList: true, subtree: true });
  global.addEventListener("zoidium:theme-changed", refresh);
  global.addEventListener("pagehide", function () {
    observer.disconnect();
    global.removeEventListener("zoidium:theme-changed", refresh);
  }, { once: true });
  builder.themeClips = {
    types: types,
    register: function (spec) {
      registered.set(spec.type, spec);
      if (spec.legacyType !== undefined) aliases[spec.legacyType] = spec.type;
      global.dispatchEvent(new CustomEvent("zoidium:theme-types-changed"));
      refresh();
      return function () {
        registered.delete(spec.type);
        if (spec.legacyType !== undefined) delete aliases[spec.legacyType];
        global.dispatchEvent(new CustomEvent("zoidium:theme-types-changed"));
        refresh();
      };
    },
  };
})(window);
