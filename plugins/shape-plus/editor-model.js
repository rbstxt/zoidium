"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const { clone, validate } = require("./model.js");
const { createGesture, createPathOperationHost } = require("./editor-history.js");
const nativeChannels = require("./path-native-channels.js");
const animation = require("./path-animation.js");
const multiMask = require("./path-multi-mask.js");
const { topology, channels, applyTopology } = require("./editor-topology.js");
const tree = require("./editor-tree-data.js");
const g = require("./editor-geometry.js");
const { primitivePath } = require("./primitives.js");
const { planAdd } = require("./contents-ops.js");
const { isLocked: isMaskLocked } = require("./mask-metadata.js");
const { getMasks, coercePath: coerceMaskPath } = require("./mask-model.js");
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
  layer.signature = null; layer.contentsState?.invalidate();
}
// Replace only path nodes. Keep their parent lists, transforms, paints,
// and unrelated live properties intact. Remember slots for snapshot undo.
function writePathRecords(layer, Content, records, slots, groupId) {
  const contents = clone(layer.contents);
  const incoming = new Map(records.map(record => [record.id, record]));
  const changes = [];
  function visit(list, parentId = null) {
    for (let index = list.length - 1; index >= 0; index--) {
      const item = list[index];
      if (item.kind !== "path") {
        if (item.contents) visit(item.contents, item.id);
        continue;
      }
      const next = incoming.get(item.id);
      incoming.delete(item.id);
      if (next && JSON.stringify(next) === JSON.stringify(item)) continue;
      changes.push({ id: item.id, next });
      if (next) list[index] = next;
      else {
        slots.set(item.id, { parentId, index });
        list.splice(index, 1);
      }
    }
  }
  visit(contents);
  const additions = [...incoming.values()].map(next => {
    const { parentId, index } = slots.get(next.id) || { parentId: groupId, index: Infinity };
    return { next, parentId, index };
  }).sort((a, b) => a.index - b.index);
  for (const { next, parentId, index } of additions) {
    const list = tree.find(contents, parentId)?.item.contents || contents;
    list.splice(Math.min(index, list.length), 0, next);
  }
  validate(contents);
  const load = next => {
    if (!next) return null;
    const item = new Content(next.kind, next);
    item.load(next);
    return item;
  };
  const replacements = changes.map(({ id, next }) => ({ id, item: load(next) }));
  const inserts = additions.map(event => ({ ...event, item: load(event.next) }));
  for (const { id, item } of replacements) {
    const entry = tree.find(layer.contents, id);
    entry.item.unload();
    entry.list.splice(entry.index, 1, ...(item ? [item] : []));
  }
  for (const { item, parentId, index } of inserts) {
    const list = tree.find(layer.contents, parentId)?.item.contents || layer.contents;
    list.splice(Math.min(index, list.length), 0, item);
  }
  layer.signature = null;
  layer.contentsState?.invalidate();
}

function bindPathSession(s, controller, host) {
  s.pathController = controller;
  s.sharedPathHost = host;
  // The controller stores vertex IDs. Handles keep their distinct selection
  // keys in the overlay while their parent vertex stays selected.
  s.applyPathSelection = ({ pathId, vertices }) => {
    if (s.maskSelection) {
      s.maskSelection.prune(host.listPathIds());
      if (pathId && s.maskSelection.has(pathId)) s.maskSelection.setActive(pathId);
      else if (pathId) s.maskSelection.click(pathId);
    }
    const samePath = pathId === s.activeId;
    if (!samePath) {
      s.activeId = pathId;
      s.treeSelection = new Set(pathId ? [pathId] : []);
      s.penFinished = false;
    }
    const wanted = new Set(vertices);
    const keys = samePath ? [...s.selection].filter(key => wanted.has(selectionPart(key).id)) : [];
    for (const key of keys) wanted.delete(selectionPart(key).id);
    for (const id of wanted) keys.push(selectionKey(id));
    s.selection = new Set(keys);
    s.dirty = true;
    s.onPathSelection?.();
  };
  s.syncPathSelection = () => {
    if (controller.disposed) return;
    const id = s.activeId;
    if (id && s.treeSelection.size === 1 && host.hasPath(id)) {
      const vertices = [...new Set([...s.selection].map(key => selectionPart(key).id))];
      if (controller.activeHost !== host || controller.activePathId !== id) {
        s.pathInput?.notifyExternalSelection();
        controller.activate(host, id);
        if (!vertices.length) return;
      }
      const before = controller.getSelection();
      if (before.length !== vertices.length || vertices.some(vertex => !before.includes(vertex))) {
        s.pathInput?.notifyExternalSelection();
        controller.setSelection(host, id, vertices);
      }
    } else if (controller.activeHost === host) {
      // Preserve Shape+ group/primitive selection when leaving a path.
      controller.deactivate({ mirror: false });
      s.pathInput?.notifyExternalSelection();
    }
  };
  if (!s.pathRefresh) {
    s.pathRefresh = s.refresh;
    s.refresh = function(...args) {
      s.syncPathSelection?.();
      return s.pathRefresh?.apply(this, args);
    };
  }
  s.reconcilePaths = () => {
    if (controller.disposed) return;
    s.maskSelection?.prune(host.listPathIds());
    if (controller.activeHost === host) controller.handlePathsChanged(host);
  };
  if (s.maskSelection) s.multiMaskVertices = () => {
    const selected = s.maskSelection.getSelected();
    return new Map(selected.map(id => [id, id === s.activeId
      ? [...s.selection].map(selectionPart).filter(part => !part.side).map(part => part.id)
      : controller.getSelection(host, id)]));
  };
}

// A path host lets the same pen, pointer, transform and action modules edit
// something that is not a Shape+ layer. The default host is the layer's own
// contents; a host supplies { contents(), owns(target), valid(), write(data),
// addItemDefaults }. Layer masks use this to expose one mask per Content
// path item (see mask-host.js). Nothing here changes when no host is set.
function createEditorModel(s) {
  const { PZ, editor, layer, Content, project } = s;
  const host = s.pathHost || null;
  const liveContents = () => (host ? host.contents() : layer.contents);
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
    if (host) {
      if (history) return host.readHistory(target);
      return target && host.owns(target) ? (host.readLive?.() || clone(liveContents())) : null;
    }
    if (!history && target !== layer) return null;
    return target && target.type === layer.type ? clone(target.contents) : null;
  };
  const write = (data, history = false) => {
    const target = resolve();
    if (host) {
      if (history) host.writeHistory(target, data);
      else if (target && host.owns(target)) host.write(data);
      return;
    }
    if (!history && target !== layer) return;
    if (target && target.type === layer.type) replaceContents(target, data, Content);
  };
  s.valid = () =>
    host ? host.valid() : editor.project === project && resolve() === layer;
  s.read = read;
  s.find = (id) => tree.find(liveContents(), id)?.item || null;
  s.active = () => s.find(s.activeId);
  s.pathLocked = id => s.sharedPathHost?.isLocked(id) ||
    !!host && isMaskLocked(getMasks(resolve()).find(mask => mask.id === id));
  s.requireEditablePath = id => {
    if (s.pathLocked(id)) throw Error(host ? "Layer mask is locked" : "Shape+ path is locked");
  };
  s.pathClip = () => {
    try {
      return layer.tryGetParentOfType(PZ.clip);
    } catch (_error) {
      return null;
    }
  };
  s.localFrame = () => {
    const clip = s.pathClip();
    return editor.playback.currentFrame - (clip?.start || 0) + (clip?.offset || 0);
  };
  s.gesture = createGesture(editor.history, read, write, () => {
    // Property drags and nudges mutate the live items without a write; the
    // host persists the settled state so the layer field (rendering, saving,
    // the preview-cache key) never lags the editor.
    if (s.valid()) host?.persist?.();
    s.reconcilePaths?.();
    s.refresh?.(true);
  }, () => editor.project);
  s.preview = () => {
    layer.signature = null;
    // A mutation ends the current read scope: later reads in the same event
    // rebuild from the changed contents instead of reusing stale entries.
    s.canvasApi?.invalidateScene?.();
    // Native playback redraws evaluated layer data continuously. Project
    // change notifications belong to finishOperation, once per gesture.
    s.dirty = true;
  };
  s.mutate = (work, pathIds = []) => {
    s.pointer?.cancel();
    s.finishNudge?.();
    try {
      for (const id of pathIds) s.requireEditablePath(id);
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
    s.requireEditablePath(id);
    const entry = tree.find(liveContents(), id);
    if (!entry) return;
    if (!data) {
      entry.item.unload();
      entry.list.splice(entry.index, 1);
      layer.contentsState?.invalidate();
      s.canvasApi?.invalidateScene?.();
      return;
    }
    const item = new Content(data.kind, data);
    item.load(data);
    entry.item.unload();
    entry.list.splice(entry.index, 1, item);
    layer.signature = null;
    layer.contentsState?.invalidate();
    s.canvasApi?.invalidateScene?.();
  };
  s.pathAdapter = nativeChannels.create(PZ);
  s.pathFor = (id, { preview = false } = {}) => createPathOperationHost({
    read: () => {
      if (!s.valid()) return null;
      const item = host?.readLive ? host.readLive().find(item => item.id === id) : s.find(id);
      return item?.kind === "path" ? clone(item) : null;
    },
    write: next => {
      if (preview) s.pathAdapter.preview(s.find(id).properties.path, next.properties.path.objects);
      else s.replaceItem(id, next);
      s.preview();
    },
    assertEditable: () => s.requireEditablePath(id),
    gesture: s.gesture,
    playback: editor.playback,
    preview,
  });
  s.topology = (operation, id = s.activeId) => {
    s.requireEditablePath(id);
    const target = s.pathFor(id), data = target.data;
    if (!data) return false;
    if (applyTopology(target, data, operation, s.pathAdapter)) return true;
    data.vertexModes = data.vertexModes || {};
    s.replaceItem(id, topology(data, operation));
    s.preview();
    return true;
  };
  s.setFirstVertex = (id, vertex) => s.mutate(() => s.topology({ kind: "first", id: vertex }, id), [id]);
  // A snapshot transaction owns inverse data. Native keyframe objects and
  // notifications supply the same current-frame behavior as startEdit without
  // recording a second set of inverse commands for those same changes.
  s.setValue = (property, value, frame = s.localFrame()) => {
    const owner = property.parentObject;
    if (owner?.kind === "path" && owner.properties.path === property) {
      return animation.edit(s.pathFor(owner.id, { preview: true }), frame, value, s.pathAdapter);
    }
    if (owner?.kind === "path") s.requireEditablePath(owner.id);
    const axes = property.objects || [property],
      values = property.objects ? value : [value];
    if (
      property.expression ||
      axes.some((axis) => axis.expression || axis.definition.readOnly)
    )
      throw Error("Expression-driven properties cannot be edited");
    // Auto-keys keep the old behavior: every animated axis without a key at
    // this frame acquires one, once, before any channel is written. Later
    // moves find the keys and only update the channels that changed.
    axes.forEach((axis) => {
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
    });
    // A 240-vertex path holds 1,440 channels while a drag changes a few.
    // Unchanged channels keep their keys, values and notifications: only the
    // channels whose new value differs are written and announced.
    let changed = null;
    if (property.objects) {
      const current = property.get(frame);
      if (Array.isArray(current) && current.length === values.length)
        changed = values.map((v, i) => v !== current[i]);
    }
    axes.forEach((axis, i) => {
      if (changed && !changed[i]) return;
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
  s.setPoints = (points) => {
    const item = s.active();
    s.requireEditablePath(item.id);
    s.setValue(item.properties.path, g.values(points));
  };
  // Pen paths and context-menu shapes use the same AE structure as the
  // native add menu: a new group owns the shape and its paints unless a
  // group is selected (see contents-ops.js). A path host may override the
  // paint set (masks draw bare paths with no group and no paints).
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
      ...(host?.addItemDefaults || {}),
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
  s.treeAction = (action, ...args) => {
    if (s.maskSelection?.size() > 1 && ["forward", "backward"].includes(action))
      return s.moveMasks(s.activeId, action === "forward" ? -1 : 1);
    return s.mutate(() => {
      if (host && !host.allows(action)) throw Error("Layer masks do not support " + action);
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
    }, action === "delete" ? [...s.treeSelection] : []);
  };
  s.moveMasks = (id, step) => {
    const adapter = s.sharedPathHost;
    if (!adapter) return false;
    const order = adapter.listPathIds(), selected = s.maskSelection;
    const moving = selected.has(id) ? selected.getSelected() : [id];
    const wanted = new Set(moving), indexes = order.map((_, i) => i);
    if (step > 0) indexes.reverse();
    for (const i of indexes) {
      const j = i + step;
      if (j >= 0 && j < order.length && wanted.has(order[i]) && !wanted.has(order[j]))
        [order[i], order[j]] = [order[j], order[i]];
    }
    return s.mutate(() => multiMask.reorderSelected({ host: adapter, selection: moving, idsInOrder: order }));
  };
  s.previewMaskTransform = (geometry, frame) => {
    const adapter = s.sharedPathHost, byId = new Map(geometry.map(item => [item.id, item]));
    const vertices = Object.fromEntries(geometry.map(item => [
      item.id, item.changed.map(index => adapter.listVertexIds(item.id)[index]),
    ]));
    multiMask.transformSelected({
      host: adapter, selection: s.maskSelection, verticesByMask: vertices,
      apply(mask) {
        let next = mask;
        const values = g.values(byId.get(mask.id).vertices);
        animation.edit({ data: mask, commit: data => { next = data; } }, frame, values, s.pathAdapter);
        if (next !== mask) next.properties.path = coerceMaskPath(next.properties.path);
        return next;
      },
    });
    s.preview();
  };
  // Text Animator items: one history step per add or feature toggle.
  s.addAnimator = (textId, propertyKey) =>
    s.mutate(() => {
      const contents = read();
      const { planAnimator } = require("./contents-ops.js");
      const animator = planAnimator(contents, textId, s.nextId, propertyKey);
      validate(contents);
      write(contents);
      s.activeId = animator.id;
      s.treeSelection = new Set([animator.id]);
      s.selection.clear();
    });
  s.setAnimatorFlag = (animatorId, key, value) =>
    s.mutate(() => {
      const contents = read();
      require("./contents-ops.js").setAnimatorFlag(contents, animatorId, key, value);
      validate(contents);
      write(contents);
    });
  const convertPrimitive = () =>
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
  s.convert = async () => {
    const item = s.active();
    if (item?.kind !== "text") return convertPrimitive();
    try {
      const ids = await require("./text-convert.js").convert(s.context, layer, item, Content, s.localFrame());
      s.activeId = ids[0] || null; s.treeSelection = new Set(ids); s.selection.clear(); s.refresh();
    } catch (error) { s.message(error.message); }
  };
  const mutatePath = work => s.mutate(work, [s.activeId]);
  function pathAnimationCommand(id, work) {
    s.pointer?.commit();
    s.finishNudge?.();
    try {
      s.requireEditablePath(id);
      const target = s.pathFor(id);
      if (target.data) return work(target, s.localFrame());
    } catch (error) { s.message(error.message); }
    return false;
  }
  s.pathKeyState = (id = s.activeId) => {
    try {
      const data = s.pathFor(id).data;
      return data ? animation.diamond(data, s.localFrame()) : "hollow";
    } catch (_error) { return "hollow"; }
  };
  s.setPathAnimation = (id = s.activeId) => pathAnimationCommand(id, (target, frame) =>
    animation.setEnabled(target, animation.diamond(target.data, frame) === "hollow", frame, s.pathAdapter));
  s.togglePathKey = (id = s.activeId) => pathAnimationCommand(id, (target, frame) => {
    const status = animation.diamond(target.data, frame);
    if (status === "hollow") return animation.setEnabled(target, true, frame, s.pathAdapter);
    if (animation.toggleKey(target, frame, s.pathAdapter)) return true;
    s.message("The path must keep at least one key per channel.");
    return false;
  });
  // The original model command also acts as a stopwatch at the final key.
  s.keyframe = () => pathAnimationCommand(s.activeId, (target, frame) => {
    const status = animation.diamond(target.data, frame);
    if (status === "hollow") return animation.setEnabled(target, true, frame, s.pathAdapter);
    return animation.toggleKey(target, frame, s.pathAdapter) ||
      animation.setEnabled(target, false, frame, s.pathAdapter);
  });
  s.seekPathKey = (id, direction) => {
    s.pointer?.commit();
    s.finishNudge?.();
    try {
      const target = s.pathFor(id), data = target.data;
      if (!data) return false;
      const find = direction < 0 ? animation.previous : animation.next;
      const frame = find(data, editor.playback.currentFrame, s.pathClip());
      if (frame === null) { s.message("No further path keyframe"); return false; }
      target.seek(frame);
      return true;
    } catch (error) { s.message(error.message); return false; }
  };
  s.setMode = (mode) =>
    mutatePath(() => {
      const item = s.active();
      if (item?.kind !== "path") return;
      let points = s.pathPoints();
      for (const key of s.selection) {
        const index = item.vertexIds.indexOf(selectionPart(key).id);
        if (index < 0) continue;
        points = g.setMode(points, index, mode, Number(item.properties.closed.get()) === 1);
        item.vertexModes[item.vertexIds[index]] = mode;
      }
      s.setPoints(points);
    });
  s.deleteAnchors = () =>
    mutatePath(() => {
      const ids = [...s.selection]
        .map(selectionPart)
        .filter((part) => !part.side)
        .map((part) => part.id);
      s.topology({ kind: "delete", ids });
      s.selection.clear();
    });
  s.closePath = () =>
    mutatePath(() => {
      const item = s.active();
      if (item?.kind === "path") {
        channels(clone(item));
        item.properties.closed.set(Number(item.properties.closed.get()) === 1 ? 0 : 1);
        s.preview();
      }
    });
  s.reverse = () => mutatePath(() => s.topology({ kind: "reverse" }));
  return s;
}
module.exports = { bindPathSession, createEditorModel, replaceContents, writePathRecords };
