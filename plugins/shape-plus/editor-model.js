"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const { clone, validate } = require("./model.js");
const { createGesture } = require("./editor-history.js");
const { topology, channels } = require("./editor-topology.js");
const tree = require("./editor-tree-data.js");
const g = require("./editor-geometry.js");
const { primitivePath } = require("./primitives.js");
const { planAdd } = require("./contents-ops.js");
function replaceContents(layer, contents, Content) {
  validate(contents);
  // Load detached first, then publish the whole valid list in one notification.
  const nodes = contents.map((data) => {
    const item = new Content(data.kind, data);
    item.load(data);
    return item;
  });
  for (const item of layer.contents) item.unload();
  layer.contents.splice(0, layer.contents.length, ...nodes);
  layer.signature = null;
}
function createEditorModel(s) {
  const { PZ, editor, layer, Content, project } = s;
  const address = layer.getAddress();
  const resolve = () => {
    if (editor.project !== project) return null;
    try {
      return project.addressLookup(address);
    } catch (_error) {
      return null;
    }
  };
  const read = (history = false) => {
    const target = resolve();
    if (!history && target !== layer) return null;
    return target && target.type === layer.type ? clone(target.contents) : null;
  };
  const write = (data, history = false) => {
    const target = resolve();
    if (!history && target !== layer) return;
    if (target && target.type === layer.type) replaceContents(target, data, Content);
  };
  s.valid = () => editor.project === project && resolve() === layer;
  s.read = read;
  s.find = (id) => tree.find(layer.contents, id)?.item || null;
  s.active = () => s.find(s.activeId);
  s.localFrame = () => {
    let clip = null;
    try {
      clip = layer.tryGetParentOfType(PZ.clip);
    } catch (_error) {
      /* Detached target closes below. */
    }
    return (
      editor.playback.currentFrame - (clip?.start || 0) + (clip?.offset || 0)
    );
  };
  s.gesture = createGesture(editor.history, read, write, () => s.refresh?.(true), () => editor.project);
  s.preview = () => {
    layer.signature = null;
    // Native playback redraws evaluated layer data continuously. Project
    // change notifications belong to finishOperation, once per gesture.
    s.dirty = true;
  };
  s.mutate = (work) => {
    s.pointer?.cancel();
    s.finishNudge?.();
    try {
      return s.gesture.run(() => {
        work();
        validate(read());
        s.preview();
      });
    } catch (error) {
      s.message(error.message);
      return false;
    }
  };
  s.replaceItem = (id, data) => {
    const entry = tree.find(layer.contents, id);
    if (!entry) return;
    if (!data) {
      entry.item.unload();
      entry.list.splice(entry.index, 1);
      return;
    }
    const item = new Content(data.kind, data);
    item.load(data);
    entry.item.unload();
    entry.list.splice(entry.index, 1, item);
    layer.signature = null;
  };
  s.topology = (operation) => {
    const item = s.active();
    if (item?.kind !== "path") return;
    const data = clone(item);
    data.vertexModes = data.vertexModes || {};
    s.replaceItem(item.id, topology(data, operation));
    s.preview();
  };
  // A snapshot transaction owns inverse data. Native keyframe objects and
  // notifications supply the same current-frame behavior as startEdit without
  // recording a second set of inverse commands for those same changes.
  s.setValue = (property, value, frame = s.localFrame()) => {
    const axes = property.objects || [property],
      values = property.objects ? value : [value];
    if (
      property.expression ||
      axes.some((axis) => axis.expression || axis.definition.readOnly)
    )
      throw Error("Expression-driven properties cannot be edited");
    axes.forEach((axis, i) => {
      if (axis.animated && !axis.hasKeyframe(frame)) {
        const closest = axis.keyframes[axis.getClosestKeyframeIndex(frame)];
        const key = new PZ.keyframe(
          axis.get(frame),
          frame,
          closest?.tween ?? axis.defaultTween,
        );
        axis.addKeyframe(key);
        axis.onKeyframeCreated.update(key);
      }
      axis.set(values[i], frame);
      const key = axis.keyframes?.[axis.getClosestKeyframeIndex(frame)];
      axis.onKeyframeChanged?.update(key);
    });
    s.preview();
  };
  s.pathPoints = () => {
    const item = s.active();
    return item?.kind === "path"
      ? g.vertices(item.properties.path.get(s.localFrame()))
      : [];
  };
  s.setPoints = (points) =>
    s.setValue(s.active().properties.path, g.values(points));
  // Pen paths and context-menu shapes use the same AE structure as the
  // native add menu: a new group owns the shape and its paints unless a
  // group is selected (see contents-ops.js).
  s.addItem = (kind, point = [0, 0], options = {}) => {
    const contents = read();
    const pen = kind === "path";
    const { item, select } = planAdd(contents, kind, {
      nextId: s.nextId,
      selected: s.activeId ? [s.activeId] : [],
      point,
      paints: pen ? ["stroke", "fill"] : ["fill"],
      strokeWidth: pen ? 2 : undefined,
      groupsOnly: true,
      ...options,
    });
    validate(contents);
    write(contents);
    const id = pen ? item.id : select;
    s.activeId = id;
    s.treeSelection = new Set([id]);
    s.selection.clear();
    s.preview();
    return s.active();
  };
  s.treeAction = (action, ...args) =>
    s.mutate(() => {
      const contents = read();
      let selected;
      if (action === "group") {
        const item = tree.group(contents, [...s.treeSelection], s.nextId());
        selected = item ? [item.id] : [];
      } else if (action === "ungroup")
        selected = tree.ungroup(contents, s.activeId);
      else if (action === "duplicate")
        selected = tree.duplicate(contents, [...s.treeSelection], s.nextId);
      else if (action === "delete") tree.remove(contents, [...s.treeSelection]);
      else if (action === "forward" || action === "backward") {
        // Earlier contents draw on top, so forward moves toward index 0.
        const step = action === "forward" ? -1 : 1;
        const entries = [...s.treeSelection].map((id) => tree.find(contents, id)).filter(Boolean)
          .sort((a, b) => step * (b.index - a.index));
        for (const entry of entries) {
          const index = entry.list.indexOf(entry.item), next = index + step;
          if (next < 0 || next >= entry.list.length || s.treeSelection.has(entry.list[next].id)) continue;
          entry.list.splice(index, 1);
          entry.list.splice(next, 0, entry.item);
        }
        selected = [...s.treeSelection];
      } else if (action === "paint") {
        const { select } = planAdd(contents, args[0], { nextId: s.nextId, selected: [...s.treeSelection] });
        selected = [select];
      }
      else if (action === "move") tree.move(contents, ...args);
      write(contents);
      if (selected?.length) {
        s.activeId = selected[0];
        s.treeSelection = new Set(selected);
      }
      s.selection.clear();
    });
  s.convert = () =>
    s.mutate(() => {
      const item = s.active();
      if (!item || !["rectangle", "ellipse", "polystar"].includes(item.kind))
        return;
      const evaluated = item.evaluate(s.localFrame());
      // Converting an animated procedural shape would discard its parameter
      // curves. Refuse rather than silently flattening that animation.
      const hasAnimation = (property) =>
        property.animated ||
        property.expression ||
        property.keyframes?.length > 1 ||
        property.objects?.some(hasAnimation);
      if (Object.values(item.properties).some(hasAnimation))
        throw Error(
          "Convert a static primitive to Path; animated parameters must remain editable",
        );
      const path = primitivePath(evaluated),
        data = clone(item);
      const vertexIds = path.vertices.map(() => s.nextId());
      const properties = {
        ...data.properties,
        name: data.properties.name,
        enabled: data.properties.enabled,
        closed: 1,
        path: {
          animated: false,
          keyframes: [{ frame: 0, value: g.values(path.vertices), tween: 1 }],
        },
      };
      s.replaceItem(item.id, {
        ...data,
        kind: "path",
        vertexIds,
        vertexModes: {},
        properties,
      });
      s.selection.clear();
      s.preview();
    });
  s.keyframe = () =>
    s.mutate(() => {
      const item = s.active();
      if (item?.kind !== "path") return;
      const path = item.properties.path;
      channels(clone(item));
      const frame = s.localFrame(),
        value = path.get(frame).slice();
      if (
        path.animated &&
        path.objects.every((channel) => channel.hasKeyframe(frame))
      ) {
        if (path.objects.every((channel) => channel.keyframes.length > 1)) {
          for (const channel of path.objects) {
            const key = channel.deleteKeyframe(frame);
            channel.onKeyframeDeleted.update(key);
          }
        } else {
          // Disable the stopwatch without removing the sole native key.
          for (const channel of path.objects) channel.animated = false;
        }
        s.preview();
      } else {
        for (const channel of path.objects) channel.animated = true;
        s.setValue(path, value, frame);
      }
    });
  s.setMode = (mode) =>
    s.mutate(() => {
      const item = s.active();
      if (item?.kind !== "path") return;
      let points = s.pathPoints();
      for (const key of s.selection) {
        const index = item.vertexIds.indexOf(selectionPart(key).id);
        if (index < 0) continue;
        points = g.setMode(points, index, mode, !!item.properties.closed.get());
        item.vertexModes[item.vertexIds[index]] = mode;
      }
      s.setPoints(points);
    });
  s.deleteAnchors = () =>
    s.mutate(() => {
      const ids = [...s.selection]
        .map(selectionPart)
        .filter((part) => !part.side)
        .map((part) => part.id);
      s.topology({ kind: "delete", ids });
      s.selection.clear();
    });
  s.closePath = () =>
    s.mutate(() => {
      const item = s.active();
      if (item?.kind === "path") {
        channels(clone(item));
        item.properties.closed.set(item.properties.closed.get() ? 0 : 1);
        s.preview();
      }
    });
  s.reverse = () => s.mutate(() => s.topology({ kind: "reverse" }));
  return s;
}
module.exports = { createEditorModel, replaceContents };
