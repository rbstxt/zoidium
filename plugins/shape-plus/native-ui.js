"use strict";
// Extend the existing Edit tree only for Shape+ ownership. The main Edit
// panel normally filters out custom object lists and hides delete buttons.
function install(PZ, Layer, Content, onDispose) {
  function patch(target, key, wrap) {
    const original = target[key], replacement = wrap(original);
    target[key] = replacement;
    onDispose(() => { if (target[key] === replacement) target[key] = original; });
  }
  const proto = PZ.ui.edit.prototype;
  const watched = new Map();
  function watchFocus(panel) {
    if (!panel.options.keyframePanel || watched.has(panel)) return;
    const refresh = () => {
      if (panel.enabled && panel.selection.some(object => object instanceof Content)) panel.options.keyframePanel.objects = panel.selection;
    };
    panel.onEnabledChanged.watch(refresh); watched.set(panel, refresh);
  }
  onDispose(() => { for (const [panel, refresh] of watched) panel.onEnabledChanged.unwatch(refresh); watched.clear(); });
  patch(proto, "generateListItem", original => function (container, object) {
    if (!(object instanceof Layer || object instanceof Content)) return original.apply(this, arguments);
    watchFocus(this);
    const filter = this.options.childFilter;
    this.options.childFilter = child => child === object.contents || filter(child);
    try { return original.apply(this, arguments); } finally { this.options.childFilter = filter; }
  });
  patch(proto, "generateItemCommands", original => function (element, object) {
    const previous = this.options.showListItemButtons;
    if (object instanceof Content) this.options.showListItemButtons = true;
    try { return original.apply(this, arguments); } finally { this.options.showListItemButtons = previous; }
  });
  const focused = new Set();
  patch(proto, "selectItems", original => function () {
    const result = original.apply(this, arguments);
    if (this.options.keyframePanel) {
      if (this.selection.some(object => object instanceof Content)) {
        // Selection becomes the root, so an arbitrary nested item remains
        // within the shared three-generation timeline traversal budget.
        this.options.keyframePanel.objects = this.selection; focused.add(this);
      } else if (focused.delete(this)) this.options.keyframePanel.objects = this.objects;
    }
    return result;
  });
  onDispose(() => { for (const panel of focused) panel.options.keyframePanel.objects = panel.objects; focused.clear(); });
  // Native dynamic.group builds an aggregate key containing all child keys.
  // Keep the native channel tracks alive for history/Graph+, but show only
  // the Path aggregate in the timeline. Edit still exposes every channel.
  const style = document.createElement("style");
  style.textContent = ".shape-plus-path-channel{display:none!important}";
  document.head.appendChild(style); onDispose(() => style.remove());
  patch(PZ.ui.timeline.keyframes.prototype, "createKeyframeTrack", original => function (container, object) {
    const track = original.apply(this, arguments);
    if (track && (object instanceof Content && object.kind === "path" || object.parentObject instanceof PZ.property.dynamic.group && object.parentObject.definition.zoidiumControl === "shape-plus/path")) {
      track.classList.add("shape-plus-path-channel"); track.pz_label.classList.add("shape-plus-path-channel");
    }
    return track;
  });
}
module.exports = { install };
