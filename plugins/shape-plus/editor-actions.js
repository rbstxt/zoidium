"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const g = require("./editor-geometry.js");
const { createMenu } = require("./editor-menu.js");
const xf = require("./editor-transform.js");
const { pickTarget, parentOf } = require("./editor-pick.js");
function installActions(s, root) {
  let nudge = null;
  const menu = createMenu(s.document, root, s.context?.ui || s.window.ZoidiumUI);
  s.closeMenu = () => menu.close(false);
  const mac = /Mac|iPhone|iPad/.test(s.window.navigator?.platform || "");
  const key = (text) => (mac ? text.replace("Ctrl+Shift+", "\u21e7\u2318").replace("Ctrl+", "\u2318") : text);
  // Right-click selects what is under the pointer first, like a click, then
  // shows one menu for that selection. Empty space offers new shapes there.
  s.openItemMenu = (x, y, point) => {
    const item = s.active(),
      many = s.treeSelection.size > 1,
      path = !many && item?.kind === "path",
      primitive = !many && ["rectangle", "ellipse", "polystar", "text"].includes(item?.kind);
    const local = point && s.canvasApi.local(point, { matrix: s.insertionMatrix() });
    const add = (kind) => () =>
      s.mutate(() => {
        s.addItem(kind, local || [0, 0], { paints: ["fill"], strokeWidth: undefined });
      });
    const entries = [];
    if (!item) {
      entries.push(
        { label: "Add Text", action: add("text"), disabled: !local },
        { label: "Add Rectangle", action: add("rectangle"), disabled: !local },
        { label: "Add Ellipse", action: add("ellipse"), disabled: !local },
        { label: "Add Polystar", action: add("polystar"), disabled: !local },
        { separator: true },
        { label: "Pen", shortcut: "P", action: () => s.setTool?.("pen") },
      );
      menu.open(x, y, entries, { title: "Shape+", focusReturn: s.canvas });
      return;
    }
    if (path)
      entries.push(
        { label: item.properties.closed.get() ? "Open Path" : "Close Path", action: s.closePath },
        { label: "Reverse Path Direction", action: s.reverse },
        { separator: true },
        ...["corner", "smooth", "symmetric", "independent"].map((mode) => ({
          label: mode[0].toUpperCase() + mode.slice(1) + " Points",
          action: () => s.setMode(mode),
          disabled: !s.selection.size,
        })),
        { separator: true },
      );
    if (primitive) entries.push({ label: "Convert to Path", action: s.convert }, { separator: true });
    const animatorLabels = { position: "Position", scale: "Scale", rotation: "Rotation", skew: "Skew", skewAxis: "Skew Axis", anchor: "Anchor Point", tracking: "Tracking Amount", charOffset: "Character Offset", groupingAlignment: "Grouping Alignment" };
    const axisOf = (node) => Object.keys(node.properties || {}).filter(key => key.startsWith("axis_")).map(key => ({ key, label: node.properties[key].definition?.name || key.slice(5) }));
    const flagOf = (node, key) => { try { return node.properties["enabled_" + key]?.get() ? true : false; } catch (_error) { return false; } };
    if (!many && item?.kind === "text") {
      const choices = [...Object.entries(animatorLabels).map(([key, label]) => ({ key, label })), ...axisOf(item)];
      entries.push({ label: "Add Text Animator", action: () => menu.open(x, y, choices.map(({ key, label }) => ({
        label, action: () => s.addAnimator(item.id, key),
      })), { title: "Add Text Animator", focusReturn: s.canvas }) }, { separator: true });
    }
    if (!many && item?.kind === "textAnimator") {
      const fixed = Object.entries(animatorLabels).map(([key, label]) => ({ key, label }));
      const choices = [...fixed, ...axisOf(item)];
      const on = choices.filter(({ key }) => flagOf(item, key)), off = choices.filter(({ key }) => !flagOf(item, key));
      let wiggly = false;
      try { wiggly = item.properties.wigglyOn?.get() ? true : false; } catch (_error) { /* Detached item. */ }
      entries.push(
        { label: "Add Property", disabled: !off.length, action: () => menu.open(x, y, off.map(({ key, label }) => ({
          label, action: () => s.setAnimatorFlag(item.id, key, 1),
        })), { title: "Add Property", focusReturn: s.canvas }) },
        { label: "Remove Property", disabled: !on.length, action: () => menu.open(x, y, on.map(({ key, label }) => ({
          label, action: () => s.setAnimatorFlag(item.id, key, 0),
        })), { title: "Remove Property", focusReturn: s.canvas }) },
        wiggly
          ? { label: "Remove Wiggly Selector", action: () => s.setAnimatorFlag(item.id, "wiggly", 0) }
          : { label: "Add Wiggly Selector", action: () => s.setAnimatorFlag(item.id, "wiggly", 1) },
        { separator: true },
      );
    }
    entries.push(
      { label: "Add Fill", action: () => s.treeAction("paint", "fill") },
      { label: "Add Stroke", action: () => s.treeAction("paint", "stroke") },
      { separator: true },
      { label: "Group", shortcut: key("Ctrl+G"), action: () => s.treeAction("group") },
      { label: "Ungroup", shortcut: key("Ctrl+Shift+G"), action: () => s.treeAction("ungroup"), disabled: many || item.kind !== "group" },
      { label: "Bring Forward", shortcut: key("Ctrl+]"), action: () => s.treeAction("forward") },
      { label: "Send Backward", shortcut: key("Ctrl+["), action: () => s.treeAction("backward") },
      { separator: true },
      { label: "Rename", action: () => s.rename(s.activeId), disabled: many },
      { label: "Duplicate", shortcut: key("Ctrl+D"), action: () => s.treeAction("duplicate") },
      { label: "Delete", shortcut: "Del", action: () => s.treeAction("delete") },
    );
    const name = item.properties.name?.get?.() || item.kind;
    menu.open(x, y, entries, { title: many ? s.treeSelection.size + " items" : name, focusReturn: s.canvas });
  };
  function finishNudge(cancel = false) {
    if (!nudge) return;
    nudge = null;
    s.gesture.finish(cancel);
    s.refresh(true);
  }
  s.finishNudge = finishNudge;
  const typing = (target) =>
    !!target.closest?.("input,textarea,select,[contenteditable='true']");
  function keydown(event) {
    if (typing(event.target)) return;
    const key = event.key.toLowerCase(),
      command = event.metaKey || event.ctrlKey;
    const consume = () => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    if (command && ["z", "y"].includes(key)) {
      consume();
      s.pointer.cancel();
      finishNudge(true);
      if (key === "y" || event.shiftKey) s.editor.history.redo();
      else s.editor.history.undo();
      s.refresh(true);
      return;
    }
    if (key === "escape") {
      if (s.pointer.active || nudge) {
        s.pointer.cancel();
        finishNudge(true);
        consume();
        return;
      }
      if (s.tool === "pen" && !s.penFinished) {
        s.penFinished = true;
        s.selection.clear();
        s.refresh();
        consume();
        return;
      }
      if (s.selection.size) {
        s.selection.clear();
        s.refresh();
        consume();
        return;
      }
      if (s.treeSelection.size) {
        // Step out of a group like AE, then clear the selection.
        const parent = s.treeSelection.size === 1 && parentOf(s.layer.contents, s.activeId);
        if (parent) s.selectItem(parent);
        else s.clearSelection();
        consume();
      }
      return;
    }
    if (command && (key === "]" || key === "[")) {
      consume();
      s.treeAction(key === "]" ? "forward" : "backward");
      return;
    }
    if (command && key === "a" && s.active()?.kind === "path") {
      consume();
      s.selection = new Set(s.active().vertexIds.map((id) => selectionKey(id)));
      s.refresh();
      return;
    }
    if (command && key === "d") {
      consume();
      s.treeAction("duplicate");
      return;
    }
    if (command && key === "g") {
      consume();
      s.treeAction(event.shiftKey ? "ungroup" : "group");
      return;
    }
    if (command) return;
    if (key === "enter") {
      consume();
      s.pointer.commit();
      finishNudge();
      s.penFinished = true;
      s.selection.clear();
      s.refresh();
      return;
    }
    if (key === "delete" || key === "backspace") {
      consume();
      if (s.selection.size) s.deleteAnchors();
      else s.treeAction("delete");
      return;
    }
    const direction = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, 1],
      arrowdown: [0, -1],
    }[key];
    if (direction && !(s.active()?.kind === "path" && s.selection.size) && s.treeSelection.size) {
      // No anchors selected: arrows move the selected items themselves.
      consume();
      s.pointer.commit();
      if (!nudge) {
        if (!s.gesture.begin()) return;
        nudge = { frame: s.localFrame(), target: s.activeId };
      }
      try {
        if (!xf.nudge(s, [...s.treeSelection], g.mul(direction, event.shiftKey ? 10 : 1))) finishNudge(true);
      } catch (error) {
        finishNudge(true);
        s.message(error.message);
      }
      return;
    }
    if (direction && s.active()?.kind === "path" && s.selection.size) {
      consume();
      s.pointer.commit();
      if (!nudge) {
        if (!s.gesture.begin()) return;
        nudge = { frame: s.localFrame(), target: s.activeId };
      }
      const item = s.active(),
        points = s.pathPoints(),
        delta = g.mul(direction, event.shiftKey ? 10 : 1);
      try {
        points.forEach((vertex, i) => {
          const id = item.vertexIds[i];
          if (s.selection.has(selectionKey(id)))
            vertex.point = g.add(vertex.point, delta);
          else
            for (const side of ["in", "out"])
              if (s.selection.has(selectionKey(id, side)))
                points[i] = g.handle(
                  points[i],
                  side,
                  g.add(vertex[side], delta),
                  item.vertexModes[id] || "corner",
                );
        });
        s.setPoints(points);
      } catch (error) {
        finishNudge(true);
        s.message(error.message);
      }
    }
  }
  function keyup(event) {
    if (event.code === "Space") {
      s.space = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (event.key.startsWith("Arrow")) finishNudge();
  }
  // Losing focus ends a nudge but keeps it; only Escape and undo roll back.
  function blur() {
    s.space = false;
    finishNudge();
    s.closeMenu();
  }
  function context(event) {
    if (event.target !== s.canvas) return;
    event.preventDefault();
    event.stopPropagation();
    if (!s.valid()) return;
    s.pointer.commit();
    const r = s.canvas.getBoundingClientRect(),
      point = [event.clientX - r.left, event.clientY - r.top];
    const entry = s.canvasApi.itemAt(point);
    if (entry) {
      const target = pickTarget(s.layer.contents, entry.item.id, s.treeSelection);
      if (!s.treeSelection.has(target)) s.selectItem(target);
    } else if (s.tool === "select" && !s.selection.size) s.clearSelection();
    s.openItemMenu(event.clientX, event.clientY, point);
  }
  const keyRoot = s.canvas;
  keyRoot.addEventListener("keydown", keydown, true);
  keyRoot.addEventListener("keyup", keyup, true);
  root.addEventListener("contextmenu", context);
  const focusout = () =>
    s.window.queueMicrotask(() => {
      // A pointer drag keeps running under pointer capture even if another
      // element takes focus mid-drag; it ends on release.
      if (!keyRoot.contains(s.document.activeElement) && !menu.element?.contains(s.document.activeElement)) blur();
    });
  keyRoot.addEventListener("focusout", focusout);
  s.window.addEventListener("blur", blur);
  return {
    check() {
      if (
        nudge &&
        (nudge.frame !== s.localFrame() || nudge.target !== s.activeId)
      )
        finishNudge();
    },
    dispose() {
      blur();
      keyRoot.removeEventListener("keydown", keydown, true);
      keyRoot.removeEventListener("keyup", keyup, true);
      root.removeEventListener("contextmenu", context);
      keyRoot.removeEventListener("focusout", focusout);
      s.window.removeEventListener("blur", blur);
    },
  };
}
module.exports = { installActions };
