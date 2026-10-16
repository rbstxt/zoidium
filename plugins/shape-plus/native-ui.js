"use strict";
// Only the existing Objects split needs different filters. Lists keep their
// Content type, factory, addresses and saved contents fields.
function connectObjectsPanel(PZ, top, bottom, Content, onDispose) {
  const isContents = child => child instanceof PZ.objectList && child.type === Content;
  for (const [panel, include] of [[top, true], [bottom, false]]) {
    const original = panel.options.childFilter;
    const replacement = child => isContents(child) ? include : original(child);
    panel.options.childFilter = replacement;
    onDispose(() => {
      if (panel.options.childFilter === replacement) panel.options.childFilter = original;
      panel.objectsChanged();
    });
    panel.objectsChanged();
  }
  return { top, bottom };
}
function findObjectsPanel(PZ, editor, document) {
  const selection = editor?.mainViewport?.options.helper3dObjects;
  const panels = Array.from(document.querySelectorAll(".editorpanel"), el => el.pz_panel);
  const top = panels.find(panel => panel instanceof PZ.ui.edit && panel.selection === selection);
  const bottom = top && panels.find(panel => panel instanceof PZ.ui.edit && panel.objects === top.selection);
  return top && bottom ? { top, bottom } : null;
}
function install(PZ, Layer, Content, onDispose) {
  function patch(target, key, wrap) {
    const original = target[key], replacement = wrap(original);
    target[key] = replacement;
    onDispose(() => { if (target[key] === replacement) target[key] = original; });
  }
  const proto = PZ.ui.edit.prototype;
  const watched = new Map();
  function contentTarget(object) {
    for (let node = object, depth = 0; node && depth < 64; depth++, node = node.parent ? node.parentObject : null) if (node instanceof Content) return true;
    return false;
  }
  function watchFocus(panel) {
    if (!panel.options.keyframePanel || watched.has(panel)) return;
    const refresh = () => {
      if (panel.enabled && panel.selection.some(contentTarget)) panel.options.keyframePanel.objects = panel.selection;
    };
    panel.onEnabledChanged.watch(refresh); watched.set(panel, refresh);
  }
  onDispose(() => { for (const [panel, refresh] of watched) panel.onEnabledChanged.unwatch(refresh); watched.clear(); });
  const panels = findObjectsPanel(PZ, window.CM, document);
  if (panels) connectObjectsPanel(PZ, panels.top, panels.bottom, Content, onDispose);
  patch(proto, "generateListItem", original => function (container, object) {
    if (object instanceof Content) watchFocus(this);
    const row = original.apply(this, arguments);
    if (object instanceof Content && this === panels?.top) {
      const button = this.generateButton("visible"), property = object.properties.enabled;
      const refresh = () => {
        button.title = property.get() ? "Disable item" : "Enable item";
        button.setAttribute("aria-pressed", String(!!property.get()));
        button.style.opacity = property.get() ? "" : ".4";
      };
      button.onclick = event => {
        event.stopPropagation();
        this.editor.history.startOperation();
        this.propertyOps.setValue({ property: property.getAddress(), value: property.get() ? 0 : 1, oldValue: property.get() });
        this.editor.history.finishOperation();
      };
      property.onChanged.watch(refresh, true);
      row.pz_shapeCleanup = () => property.onChanged.unwatch(refresh);
      row.children[1].prepend(button);
    }
    return row;
  });
  patch(proto, "unloadListItem", original => function (row) {
    row.pz_shapeCleanup?.();
    return original.apply(this, arguments);
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
      if (this.selection.some(contentTarget)) {
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
    if (track && (object instanceof Content && object.kind === "path" || object.parent && container.pz_parent?.pz_object === object.parentObject && object.parentObject instanceof PZ.property.dynamic.group && object.parentObject.definition.zoidiumControl === "shape-plus/path")) {
      track.classList.add("shape-plus-path-channel"); track.pz_label.classList.add("shape-plus-path-channel");
    }
    return track;
  });
  onDispose(() => {
    if (!panels) return;
    const selected = Array.from(panels.top.selection).filter(item => !(item instanceof Content));
    panels.top.selection.splice(0, panels.top.selection.length, ...selected);
  });
  return panels;
}
module.exports = { install, connectObjectsPanel, findObjectsPanel };
