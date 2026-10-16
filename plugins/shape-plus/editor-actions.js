"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const g = require("./editor-geometry.js");
const { titles } = require("./properties.js");
function installActions(s, root) {
  let menu = null,
    nudge = null;
  s.closeMenu = () => {
    menu?.remove();
    menu = null;
  };
  s.menu = (x, y, items) => {
    s.closeMenu();
    menu = s.make("div", "sp-menu");
    menu.setAttribute("role", "menu");
    for (const item of items) {
      const button = s.make("button", "sp-menu-item", item.label);
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.disabled = !!item.disabled;
      button.addEventListener("click", () => {
        s.closeMenu();
        item.action();
        s.canvas.focus();
      });
      menu.append(button);
    }
    root.append(menu);
    const r = root.getBoundingClientRect();
    menu.style.left =
      Math.max(0, Math.min(x - r.left, root.clientWidth - menu.offsetWidth)) +
      "px";
    menu.style.top =
      Math.max(0, Math.min(y - r.top, root.clientHeight - menu.offsetHeight)) +
      "px";
    menu.querySelector("button:not(:disabled)")?.focus();
  };
  s.addMenu = (x, y) =>
    s.menu(
      x,
      y,
      Object.entries(titles).map(([kind, title]) => ({
        label: title,
        action: () => s.mutate(() => s.addItem(kind)),
      })),
    );
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
    if (typing(event.target)) return;
    const key = event.key.toLowerCase(),
      command = event.metaKey || event.ctrlKey;
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
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
    if (event.code === "Space") {
      consume();
      s.space = true;
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
    if (["v", "p", "h"].includes(key)) {
      consume();
      s.pointer.cancel();
      finishNudge();
      s.tool = { v: "select", p: "pen", h: "hand" }[key];
      s.penFinished = false;
      s.refresh();
      return;
    }
    if (key === "0" || (event.shiftKey && event.code === "Digit1")) {
      consume();
      s.canvasApi.fit();
      return;
    }
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
    if (key === "f2") {
      consume();
      if (s.active()) s.rename(s.activeId);
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
      event.stopPropagation();
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
  root.addEventListener("keydown", keydown, true);
  root.addEventListener("keyup", keyup, true);
  root.addEventListener("pointerdown", outside, true);
  root.addEventListener("contextmenu", context);
  s.window.addEventListener("blur", blur);
  return {
    check() {
      if (
        nudge &&
        (nudge.frame !== s.localFrame() || nudge.target !== s.activeId)
      )
        finishNudge(true);
    },
    dispose() {
      blur();
      root.removeEventListener("keydown", keydown, true);
      root.removeEventListener("keyup", keyup, true);
      root.removeEventListener("pointerdown", outside, true);
      root.removeEventListener("contextmenu", context);
      s.window.removeEventListener("blur", blur);
    },
  };
}
module.exports = { installActions };
