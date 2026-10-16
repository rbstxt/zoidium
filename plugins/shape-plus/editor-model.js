"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const { clone, validate } = require("./model.js");
const { createGesture } = require("./editor-history.js");
const { topology, channels } = require("./editor-topology.js");
const tree = require("./editor-tree-data.js");
const g = require("./editor-geometry.js");
const { primitivePath } = require("./primitives.js");
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
    try {
      return project.addressLookup(address);
    } catch (_error) {
      return null;
    }
  };
  const read = () => {
    const target = resolve();
    return target?.type === layer.type ? clone(target.contents) : null;
  };
  const write = (data) => {
    const target = resolve();
    if (target?.type === layer.type) replaceContents(target, data, Content);
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
  s.gesture = createGesture(editor.history, read, write, () =>
    s.refresh?.(true),
  );
  s.preview = () => {
    layer.signature = null;
    project.ui.onChanged.update();
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
  s.addItem = (kind, point = [0, 0]) => {
    const contents = read(),
      entry = tree.find(contents, s.activeId),
      list =
        entry?.item.kind === "group"
          ? entry.item.contents
          : entry?.list || contents;
    const index =
      entry?.item.kind === "group" ? list.length : (entry?.index ?? 0);
    const id = s.nextId(),
      item = { id, kind, properties: {} };
    if (["rectangle", "ellipse", "polystar"].includes(kind))
      item.properties.position = {
        animated: false,
        keyframes: [{ frame: 0, value: point, tween: 1 }],
      };
    if (kind === "group") item.contents = [];
    if (kind === "path")
      Object.assign(item, {
        vertexIds: [s.nextId()],
        vertexModes: {},
        properties: {
          closed: 0,
          path: {
            animated: false,
            keyframes: [{ frame: 0, value: [...point, 0, 0, 0, 0], tween: 1 }],
          },
        },
      });
    list.splice(index, 0, item);
    if (["path", "rectangle", "ellipse", "polystar"].includes(kind)) {
      // Paints below collect the newly inserted geometry. Add defaults only
      // when the destination group has no paint of that kind below the item.
      for (const paint of ["fill", "stroke"])
        if (!list.slice(index + 1).some((n) => n.kind === paint))
          list.push({
            id: s.nextId(),
            kind: paint,
            properties:
              paint === "stroke"
                ? {
                    width: {
                      animated: false,
                      keyframes: [{ frame: 0, value: 2, tween: 1 }],
                    },
                  }
                : {},
          });
    }
    validate(contents);
    write(contents);
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
      if (
        Object.values(item.properties).some((p) => p.animated || p.expression)
      )
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
      const value = path.get(s.localFrame()).slice();
      if (!path.animated)
        for (const channel of path.objects) channel.animated = true;
      s.setValue(path, value);
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
