"use strict";
const { titles } = require("./properties.js");
const { find } = require("./editor-tree-data.js");
function createTree(s, container) {
  const tree = s.make("div", "sp-tree");
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-label", "Shape contents");
  container.append(tree);
  let signature = "",
    renaming = false;
  function rename(id) {
    const item = s.find(id),
      row = Array.from(tree.querySelectorAll(".sp-tree-row")).find(
        (el) => el.dataset.id === id,
      );
    if (!row || !item) return;
    const label = row.querySelector(".sp-tree-name"),
      input = s.make("input", "pz-inputbox sp-rename");
    input.value = item.properties.name.get();
    label.replaceWith(input);
    input.focus();
    input.select();
    renaming = true;
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      renaming = false;
      if (save && input.value.trim())
        s.mutate(() => {
          s.find(id)?.properties.name.set(input.value.trim());
          s.preview();
        });
      signature = "";
      render();
    };
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(e.key === "Enter");
        s.canvas.focus();
      }
    });
  }
  s.rename = rename;
  function render() {
    if (renaming) return;
    const summary = (list) =>
      Array.from(list, (item) => [
        item.id,
        item.kind,
        item.properties.name.get(),
        item.properties.enabled.get(),
        s.treeSelection.has(item.id),
        s.collapsed.has(item.id),
        item.contents ? summary(item.contents) : null,
      ]);
    const next = JSON.stringify(summary(s.layer.contents));
    if (signature === next) return;
    signature = next;
    tree.replaceChildren();
    if (!s.layer.contents.length) {
      const empty = s.make(
        "div",
        "sp-tree-empty",
        "No contents. Use Add or the Pen tool.",
      );
      tree.append(empty);
    }
    function rows(list, depth) {
      for (const item of list) {
        const row = s.make("div", "sp-tree-row"),
          selected = s.treeSelection.has(item.id);
        row.dataset.id = item.id;
        row.draggable = true;
        row.tabIndex = 0;
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-selected", String(selected));
        row.style.paddingLeft = 6 + depth * 16 + "px";
        row.classList.toggle("selected", selected);
        if (item.kind === "group")
          row.setAttribute("aria-expanded", String(!s.collapsed.has(item.id)));
        const enabled = s.button(
          "Enabled: " + item.properties.name.get(),
          "visible",
          () =>
            s.mutate(() => {
              const target = s.find(item.id);
              target.properties.enabled.set(
                target.properties.enabled.get() ? 0 : 1,
              );
              s.preview();
            }),
          "sp-enabled",
        );
        enabled.setAttribute(
          "aria-pressed",
          String(!!item.properties.enabled.get()),
        );
        enabled.classList.toggle("off", !item.properties.enabled.get());
        const twist = s.make(
          "button",
          "sp-twist",
          item.kind === "group" ? (s.collapsed.has(item.id) ? "▸" : "▾") : "",
        );
        twist.type = "button";
        twist.tabIndex = -1;
        twist.setAttribute("aria-label", "Toggle group");
        twist.disabled = item.kind !== "group";
        twist.addEventListener("click", (e) => {
          e.stopPropagation();
          if (s.collapsed.has(item.id)) s.collapsed.delete(item.id);
          else s.collapsed.add(item.id);
          render();
        });
        const name = s.make("span", "sp-tree-name", item.properties.name.get());
        row.append(
          enabled,
          twist,
          s.icon(
            item.kind === "group"
              ? "folder"
              : item.kind === "path"
                ? "edit2"
                : item.kind === "fill"
                  ? "image"
                  : item.kind === "stroke"
                    ? "edit"
                    : "shape",
          ),
          name,
        );
        row.addEventListener("click", (event) => {
          if (event.target.closest("button,input")) return;
          s.selectItem(item.id, event.shiftKey);
        });
        row.addEventListener("dblclick", (event) => {
          if (!event.target.closest("button,input")) {
            event.preventDefault();
            rename(item.id);
          }
        });
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === "F2") {
            event.preventDefault();
            event.stopPropagation();
            rename(item.id);
          } else if (event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            s.selectItem(item.id, event.shiftKey);
          }
        });
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          if (!selected) s.selectItem(item.id, false);
          s.openItemMenu(event.clientX, event.clientY);
        });
        row.addEventListener("dragstart", (event) => {
          s.pointer.cancel();
          if (!s.treeSelection.has(item.id)) s.selectItem(item.id, false);
          event.dataTransfer.setData(
            "application/x-shape-plus",
            JSON.stringify([...s.treeSelection]),
          );
          event.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragover", (event) => {
          if (
            !Array.from(event.dataTransfer.types).includes(
              "application/x-shape-plus",
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const r = row.getBoundingClientRect(),
            f = (event.clientY - r.top) / r.height;
          row.dataset.drop =
            item.kind === "group" && f > 0.25 && f < 0.75
              ? "inside"
              : f < 0.5
                ? "before"
                : "after";
        });
        row.addEventListener("dragleave", () => delete row.dataset.drop);
        row.addEventListener("drop", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const mode = row.dataset.drop;
          delete row.dataset.drop;
          try {
            const ids = JSON.parse(
                event.dataTransfer.getData("application/x-shape-plus"),
              ),
              entry = find(s.read(), item.id);
            if (!entry) return;
            const parent = entry.ancestors.at(-1)?.id || null;
            s.treeAction(
              "move",
              ids,
              mode === "inside" ? item.id : parent,
              mode === "inside"
                ? null
                : mode === "after"
                  ? entry.list[entry.index + 1]?.id || null
                  : item.id,
            );
          } catch (error) {
            s.message(error.message);
          }
        });
        tree.append(row);
        if (item.contents && !s.collapsed.has(item.id))
          rows(item.contents, depth + 1);
      }
    }
    rows(s.layer.contents, 0);
  }
  const dragover = (event) => {
    if (
      Array.from(event.dataTransfer.types).includes("application/x-shape-plus")
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  };
  const drop = (event) => {
    if (event.target.closest(".sp-tree-row")) return;
    event.preventDefault();
    try {
      s.treeAction(
        "move",
        JSON.parse(event.dataTransfer.getData("application/x-shape-plus")),
        null,
      );
    } catch (error) {
      s.message(error.message);
    }
  };
  tree.addEventListener("dragover", dragover);
  tree.addEventListener("drop", drop);
  render();
  return {
    render,
    dispose() {
      tree.remove();
    },
  };
}
module.exports = { createTree, titles };
