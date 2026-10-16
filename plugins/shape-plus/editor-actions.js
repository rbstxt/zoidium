"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const g = require("./editor-geometry.js");
function installActions(s, root) {
  let menu = null,
    nudge = null;
  s.closeMenu = () => {
    const current = menu;
    menu = null;
    current?.remove();
  };
  s.menu = (x, y, items) => {
    s.closeMenu();
    // Use the same native select menu as CM3 list properties. It is transient
    // UI state, never a project property or a second styled panel.
    menu = s.make("select", "pz-inputbox");
    menu.setAttribute("aria-label", "Path actions");
    menu.style.cssText = "position:fixed;z-index:10;left:" + x + "px;top:" + y + "px";
    const placeholder = s.make("option", "", "Path actions");
    menu.append(placeholder);
    items.forEach((item, i) => {
      const option = s.make("option", "", item.label);
      option.value = String(i); option.disabled = !!item.disabled;
      menu.append(option);
    });
    menu.onchange = () => {
      const index = menu.selectedIndex - 1;
      s.closeMenu(); items[index]?.action();
      if (!s.document.activeElement?.matches("input,textarea,[contenteditable='true']")) s.canvas.focus();
    };
    menu.onblur = s.closeMenu;
    menu.onkeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); s.closeMenu(); s.canvas.focus();
      }
    };
    s.document.body.append(menu); menu.focus();
    // Native select popups require a trusted gesture on supporting browsers.
    try { menu.showPicker?.(); } catch (_error) { /* The focused select remains usable. */ }
  };
  s.openItemMenu = (x, y) => {
    const item = s.active(),
      path = item?.kind === "path",
      shape = ["rectangle", "ellipse", "polystar"].includes(item?.kind);
    const items = [
      { label: "Rename", action: () => s.rename(s.activeId), disabled: !item },
      {
        label: "Duplicate",
        action: () => s.treeAction("duplicate"),
        disabled: !item,
      },
      {
        label: "Delete item",
        action: () => s.treeAction("delete"),
        disabled: !item,
      },
      {
        label: "Group selection",
        action: () => s.treeAction("group"),
        disabled: !item,
      },
      {
        label: "Ungroup",
        action: () => s.treeAction("ungroup"),
        disabled: item?.kind !== "group",
      },
    ];
    if (shape) items.unshift({ label: "Convert to Path", action: s.convert });
    if (path)
      items.unshift(
        {
          label: item.properties.closed.get() ? "Open path" : "Close path",
          action: s.closePath,
        },
        { label: "Reverse path direction", action: s.reverse },
        ...["corner", "smooth", "symmetric", "independent"].map((mode) => ({
          label: mode[0].toUpperCase() + mode.slice(1),
          action: () => s.setMode(mode),
          disabled: !s.selection.size,
        })),
      );
    s.menu(x, y, items);
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
    if (typing(event.target) && !(menu && event.key === "Escape")) return;
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
      if (menu) {
        s.closeMenu();
        consume();
        s.canvas.focus();
        return;
      }
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
      }
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
      s.pointer.cancel();
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
    if (direction && s.active()?.kind === "path" && s.selection.size) {
      consume();
      s.pointer.cancel();
      if (!nudge) {
        if (!s.gesture.begin()) return;
        nudge = { frame: s.localFrame(), target: s.activeId, matrix: JSON.stringify(s.canvasApi.activeMatrix()) };
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
  function blur() {
    s.space = false;
    finishNudge(true);
    s.closeMenu();
  }
  function outside(event) {
    if (menu && !menu.contains(event.target)) s.closeMenu();
  }
  function context(event) {
    if (event.target !== s.canvas) return;
    event.preventDefault();
    s.openItemMenu(event.clientX, event.clientY);
  }
  const keyRoot = s.canvas;
  keyRoot.addEventListener("keydown", keydown, true);
  keyRoot.addEventListener("keyup", keyup, true);
  root.addEventListener("pointerdown", outside, true);
  root.addEventListener("contextmenu", context);
  const focusout = () =>
    s.window.queueMicrotask(() => {
      if (!keyRoot.contains(s.document.activeElement) && !menu?.contains(s.document.activeElement)) {
        s.pointer.cancel();
        blur();
      }
    });
  keyRoot.addEventListener("focusout", focusout);
  s.window.addEventListener("blur", blur);
  return {
    check() {
      if (
        nudge &&
        (nudge.frame !== s.localFrame() || nudge.target !== s.activeId || nudge.matrix !== JSON.stringify(s.canvasApi.activeMatrix()))
      )
        finishNudge(true);
    },
    dispose() {
      blur();
      keyRoot.removeEventListener("keydown", keydown, true);
      keyRoot.removeEventListener("keyup", keyup, true);
      root.removeEventListener("pointerdown", outside, true);
      root.removeEventListener("contextmenu", context);
      keyRoot.removeEventListener("focusout", focusout);
      s.window.removeEventListener("blur", blur);
    },
  };
}
module.exports = { installActions };
