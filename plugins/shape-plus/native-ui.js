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
// The native "+" list appends at the end of the Contents list, below any
// paint, so a new path would draw nothing. Route it through planAdd instead:
// geometry gets its own group and fill, paints go below the paths they draw.
function createAddRouting(PZ, Layer, Content) {
  const layerOf = object => {
    for (let node = object, depth = 0; node && depth < 64; depth++, node = node.parent ? node.parentObject : null)
      if (node instanceof Layer) return node;
    return null;
  };
  function select(panel, id) {
    const row = Array.from(panel.list.querySelectorAll("li")).find(li => li.pz_object instanceof Content && li.pz_object.id === id);
    if (!row) return;
    panel.deselectItems();
    row.classList.add("selected");
    panel.selectItems();
    row.scrollIntoViewIfNeeded?.(false);
  }
  return function addTo(panel, list, kind, container) {
    const owner = list.parentObject, layer = owner instanceof Layer ? owner : owner instanceof Content ? layerOf(owner) : null;
    if (!layer) return false;
    const { clone, validate } = require("./model.js");
    const { replaceContents } = require("./editor-model.js");
    const { createGesture } = require("./editor-history.js");
    const { planAdd } = require("./contents-ops.js");
    const editor = panel.editor, project = editor.project, address = layer.getAddress();
    const resolve = () => {
      try { return project.addressLookup(address); } catch (_error) { return null; }
    };
    const read = () => resolve() instanceof Layer ? clone(resolve().contents) : null;
    const write = data => {
      const target = resolve();
      if (target instanceof Layer) replaceContents(target, data, Content);
    };
    const selected = Array.from(panel.selection).filter(item => item instanceof Content && layerOf(item) === layer).map(item => item.id);
    let plan = null;
    try {
      createGesture(editor.history, read, write).run(() => {
        const contents = read();
        plan = planAdd(contents, kind, { nextId: () => "sp-" + crypto.randomUUID(), selected, groupId: owner instanceof Content ? owner.id : null });
        validate(contents);
        write(contents);
      });
    } catch (error) {
      plan = null;
      console.error("Shape+ could not add the item:", error);
    }
    container.firstElementChild?.click();
    if (plan) select(panel, plan.select);
    return true;
  };
}
function install(PZ, Layer, Content, onDispose) {
  function patch(target, key, wrap) {
    const original = target[key], replacement = wrap(original);
    target[key] = replacement;
    onDispose(() => { if (target[key] === replacement) target[key] = original; });
  }
  const proto = PZ.ui.edit.prototype;
  const watched = new Map();
  const focus = require("./native-focus.js").createFocus(PZ, Content);
  function watchFocus(panel) {
    if (!panel.options.keyframePanel || watched.has(panel)) return;
    const refresh = () => {
      if (panel.enabled) focus.refresh(panel);
    };
    panel.onEnabledChanged.watch(refresh); watched.set(panel, refresh);
  }
  onDispose(() => { for (const [panel, refresh] of watched) panel.onEnabledChanged.unwatch(refresh); watched.clear(); });
  const panels = findObjectsPanel(PZ, window.CM, document);
  if (panels) connectObjectsPanel(PZ, panels.top, panels.bottom, Content, onDispose);
  const icons = require("./editor-icons.js");
  const hints = require("./native-hints.js").createHints({ PZ, Layer, Content, document });
  onDispose(() => hints.dispose());
  const addTo = createAddRouting(PZ, Layer, Content);
  patch(proto, "generateListItem", original => function (container, object) {
    if (object instanceof Content) watchFocus(this);
    const row = original.apply(this, arguments);
    if (object instanceof Content) {
      const image=icons.icon(document,object.kind);
      if(image){image.style.cssText="width:17px;height:17px;vertical-align:middle;margin-right:5px;color:#ccc;pointer-events:none";row.firstElementChild.insertBefore(image,row.firstElementChild.querySelector("span"));}
    }
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
      row.pz_shapeCleanup = () => { property.onChanged.unwatch(refresh); hints.detach(row); };
      row.children[1].prepend(button);
      hints.attach(row, object);
    }
    if (object instanceof Content && this.options.showPropertyControls && this !== panels?.top)
      require("./native-properties.js").decorate(this, row, object);
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
  patch(proto, "generateAdd", original => function(list) {
    const result=original.apply(this,arguments);
    if(list.type!==Content)return result;
    // CM3 appends the add container last: Cancel, filter box, option list.
    // The filter and Enter key reuse these same <li> elements and handlers.
    const container=this.el.lastElementChild;
    for(const row of container.querySelectorAll(".pz-options li")) {
      const item=row.pz_item, image=icons.icon(document,item?.type);
      if(image){image.style.cssText="width:20px;height:20px;vertical-align:middle;margin-right:7px;color:#ccc;pointer-events:none";row.prepend(image);}
      if(!item||item.list||typeof item.type!=="string")continue;
      const native=row.onclick;
      row.onclick=event=>{ if(!addTo(this,list,item.type,container))return native.call(row,event); };
    }
    return result;
  });
  patch(proto, "selectItems", original => function () {
    const result = original.apply(this, arguments);
    focus.refresh(this);
    return result;
  });
  onDispose(() => focus.dispose());
  // Native dynamic.group builds an aggregate key containing all child keys.
  // Keep the native channel tracks alive for history/Graph+, but show only
  // the Path aggregate in the timeline. Edit still exposes every channel.
  const style = document.createElement("style");
  style.textContent = ".shape-plus-path-channel,.shape-plus-native-hidden{display:none!important}";
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
module.exports = { install, connectObjectsPanel, findObjectsPanel, createAddRouting };
