"use strict";

// The item table of the Assets window: AE Project panel columns with a label
// swatch, folder rows with disclosure triangles, keyboard navigation, inline
// folder rename, and drag and drop (items onto folders, footage onto the
// timeline through CM3's own media drag, items onto asset property rows).

const model = require("./assets-model.js");

const DRAG_TYPE = "application/x-zoidium-assets";

// `hooks` = { registry(), editor, notify, selectedId(), select(id, scroll),
// activate(row), contextMenu(row, event), labelMenu(ids, anchor),
// remove(row), sortChanged() }.
function createTable(doc, icon, view, hooks) {
  // Remembered as the collapsed set so new folders start open.
  const collapsed = new Set(readCollapsed());
  const wrap = make("div", "zam-table-wrap");
  wrap.tabIndex = 0;
  const table = make("table", "zam-table");
  const head = make("thead");
  const body = make("tbody");
  const empty = make("div", "zam-empty");
  table.append(head, body);
  wrap.append(table, empty);
  let rows = [];
  let renaming = null;
  let dragging = null;

  function make(tag, className, text) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function readCollapsed() {
    try {
      const saved = JSON.parse(localStorage.getItem("zoidium.assets.collapsed") || "null");
      return Array.isArray(saved) ? saved : [];
    } catch (error) {
      return [];
    }
  }

  function writeCollapsed() {
    try {
      localStorage.setItem("zoidium.assets.collapsed", JSON.stringify(Array.from(collapsed)));
    } catch (error) {
      // Only the remembered disclosure state is lost.
    }
  }

  function api() {
    return hooks.registry();
  }

  // ---- Header ------------------------------------------------------------

  const headRow = make("tr");
  for (const column of model.COLUMNS) {
    const cell = make("th", "zam-col-" + column.id, column.label);
    cell.dataset.column = column.id;
    cell.title = "Sort by " + (column.title || column.label).toLowerCase();
    cell.addEventListener("click", () => {
      if (view.sort.column === column.id) {
        view.sort.direction = view.sort.direction === "asc" ? "desc" : "asc";
      } else {
        const descending = column.id === "uses" || column.id === "size";
        view.sort = { column: column.id, direction: descending ? "desc" : "asc" };
      }
      hooks.sortChanged();
    });
    headRow.appendChild(cell);
  }
  head.appendChild(headRow);

  // ---- Rows --------------------------------------------------------------

  function cell(row, column, content) {
    const element = make("td", "zam-col-" + column);
    if (content instanceof Node) element.appendChild(content);
    else element.textContent = content || "";
    row.appendChild(element);
    return element;
  }

  function labelSwatch(label, ids) {
    const swatch = make("button", "zam-label");
    swatch.type = "button";
    const info = model.labelInfo(label);
    swatch.title = "Label: " + info.name;
    swatch.setAttribute("aria-label", "Label " + info.name);
    if (info.color) swatch.style.background = info.color;
    else swatch.classList.add("zam-label-none");
    swatch.addEventListener("click", (event) => {
      event.stopPropagation();
      hooks.labelMenu(ids, swatch);
    });
    return swatch;
  }

  function indent(depth) {
    const pad = make("span", "zam-indent");
    pad.style.width = depth * 16 + "px";
    return pad;
  }

  function folderRow(entry) {
    const folder = entry.folder;
    const row = make("tr", "zam-row zam-folder");
    row.dataset.id = entry.id;
    row.draggable = true;
    cell(row, "label", labelSwatch(folder.label || 0, [entry.id]));
    const name = make("span", "zam-name");
    name.appendChild(indent(entry.depth));
    const twisty = make("button", "zam-twisty", entry.expanded ? "▾" : "▸");
    twisty.type = "button";
    twisty.setAttribute("aria-label", entry.expanded ? "Collapse folder" : "Expand folder");
    twisty.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle(folder.id);
    });
    name.appendChild(twisty);
    name.appendChild(icon("folder"));
    const text = make("span", "zam-name-text", folder.name);
    name.appendChild(text);
    cell(row, "name", name).title = folder.name;
    cell(row, "kind", "Folder");
    cell(row, "status", "");
    cell(row, "uses", "");
    cell(row, "size", "");
    cell(row, "details", model.plural(entry.count, "item", "items"));
    row.addEventListener("dblclick", () => startRename(folder.id));
    return row;
  }

  function itemRow(entry) {
    const item = entry.item;
    const row = make("tr", "zam-row");
    row.dataset.id = item.id;
    row.draggable = true;
    if (item.status === "missing") row.classList.add("zam-missing");
    if (model.isProblem(item)) row.classList.add("zam-problem");
    if (!model.usageCount(item)) row.classList.add("zam-unused");
    cell(row, "label", labelSwatch(item.label || 0, [item.id]));
    const name = make("span", "zam-name");
    name.appendChild(indent(entry.depth));
    name.appendChild(icon(model.kindInfo(item.kind).icon));
    name.appendChild(make("span", "zam-name-text", item.name));
    cell(row, "name", name).title = item.name;
    cell(row, "kind", model.kindLabel(item.kind));
    const status = cell(row, "status", model.statusLabel(item.status));
    status.dataset.status = item.status;
    if (item.error) status.title = item.error;
    cell(row, "uses", String(model.usageCount(item)));
    cell(row, "size", model.formatSize(item.size));
    cell(row, "details", model.detailText(item));
    row.addEventListener("dblclick", () => hooks.activate(entry));
    return row;
  }

  function rowEntry(id) {
    return rows.find((entry) => entry.id === id) || null;
  }

  function wireRow(row, entry) {
    row.classList.toggle("selected", entry.id === hooks.selectedId());
    row.addEventListener("click", () => {
      wrap.focus({ preventScroll: true });
      hooks.select(entry.id, false);
    });
    row.addEventListener("contextmenu", (event) => {
      hooks.select(entry.id, false);
      hooks.contextMenu(entry, event);
    });
    row.addEventListener("dragstart", (event) => onDragStart(entry, event));
    row.addEventListener("dragend", onDragEnd);
    if (entry.type === "folder") {
      row.addEventListener("dragover", (event) => onFolderDragOver(entry, row, event));
      row.addEventListener("dragleave", () => row.classList.remove("zam-drop-target"));
      row.addEventListener("drop", (event) => onFolderDrop(entry.folder.id, row, event));
    }
  }

  function toggle(folderId) {
    if (collapsed.has(folderId)) collapsed.delete(folderId);
    else collapsed.add(folderId);
    writeCollapsed();
    hooks.sortChanged();
  }

  function render(snapshot) {
    const open = new Set((snapshot && snapshot.folders ? snapshot.folders : [])
      .map((folder) => folder.id).filter((id) => !collapsed.has(id)));
    rows = model.treeRows(snapshot, view, open);
    for (const header of head.querySelectorAll("th")) {
      const active = header.dataset.column === view.sort.column;
      header.classList.toggle("sorted", active);
      header.dataset.direction = active ? view.sort.direction : "";
    }
    const scroll = wrap.scrollTop;
    body.textContent = "";
    for (const entry of rows) {
      const row = entry.type === "folder" ? folderRow(entry) : itemRow(entry);
      wireRow(row, entry);
      body.appendChild(row);
    }
    wrap.scrollTop = scroll;
    if (renaming) startRename(renaming);
    return rows;
  }

  function markSelected(id, scroll) {
    for (const row of body.children) {
      const selected = row.dataset.id === id;
      row.classList.toggle("selected", selected);
      if (selected) {
        row.setAttribute("aria-selected", "true");
        if (scroll) row.scrollIntoView({ block: "nearest" });
      } else {
        row.removeAttribute("aria-selected");
      }
    }
  }

  // ---- Inline rename (AE: Enter or double-click renames) ----------------

  function startRename(folderId) {
    const rowId = model.folderRowId(folderId);
    const entry = rowEntry(rowId);
    if (!entry || !body.querySelector('tr[data-id="' + CSS.escape(rowId) + '"]')) {
      renaming = folderId;
      return;
    }
    renaming = null;
    renameRow(rowId, entry.folder.name, "Folder name", (name) => api().renameFolder(folderId, name));
  }

  // Renames an item row in place; `commit(name)` applies a changed name and
  // returns false when it was refused, which restores the old name.
  function startItemRename(itemId, name, commit) {
    renameRow(itemId, name, "Name", commit);
  }

  function renameRow(rowId, current, label, commit) {
    const row = body.querySelector('tr[data-id="' + CSS.escape(rowId) + '"]');
    const text = row && row.querySelector(".zam-name-text");
    if (!text) return;
    const input = make("input", "pz-inputbox zoidium-text zam-rename");
    input.value = current;
    input.setAttribute("aria-label", label);
    text.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (!(apply && name && name !== current && commit(name) !== false)) input.replaceWith(text);
      wrap.focus({ preventScroll: true });
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") finish(true);
      else if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (event) => event.stopPropagation());
  }

  // ---- Keyboard ----------------------------------------------------------

  wrap.addEventListener("keydown", (event) => {
    if (event.target !== wrap || !rows.length) return;
    const index = rows.findIndex((entry) => entry.id === hooks.selectedId());
    const current = rows[index];
    let next = null;
    if (event.key === "ArrowDown") next = rows[Math.min(rows.length - 1, index + 1)];
    else if (event.key === "ArrowUp") next = rows[Math.max(0, index - 1)];
    else if (event.key === "Home") next = rows[0];
    else if (event.key === "End") next = rows[rows.length - 1];
    else if (event.key === "ArrowRight" && current && current.type === "folder" && !current.expanded) toggle(current.folder.id);
    else if (event.key === "ArrowLeft" && current && current.type === "folder" && current.expanded) toggle(current.folder.id);
    else if (event.key === "Enter" && current) {
      if (current.type === "folder") startRename(current.folder.id);
      else hooks.activate(current);
    } else if ((event.key === "Delete" || event.key === "Backspace") && current) {
      hooks.remove(current);
    } else return;
    event.preventDefault();
    if (next) hooks.select(next.id, true);
  });

  // ---- Drag and drop -----------------------------------------------------

  function idsOf(entry) {
    return [entry.type === "folder" ? entry.folder.id : entry.id];
  }

  function onDragStart(entry, event) {
    const ids = idsOf(entry);
    dragging = { entry, ids };
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    // Footage also drags onto the timeline through CM3's own media drag.
    const registry = api();
    if (entry.type === "item" && registry && registry.dragMedia && hooks.editor) {
      let media = null;
      try {
        media = registry.dragMedia(entry.id);
      } catch (error) {
        console.warn("[Assets] could not prepare a timeline drag:", error);
      }
      if (media) {
        hooks.editor.draggingData = [media];
        event.dataTransfer.setData("text", "clip");
      }
    }
    if (entry.type === "item") doc.addEventListener("dragover", onPropertyDragOver, true);
    if (entry.type === "item") doc.addEventListener("drop", onPropertyDrop, true);
  }

  function onDragEnd() {
    dragging = null;
    doc.removeEventListener("dragover", onPropertyDragOver, true);
    doc.removeEventListener("drop", onPropertyDrop, true);
    clearPropertyTarget();
    for (const row of body.querySelectorAll(".zam-drop-target")) row.classList.remove("zam-drop-target");
  }

  function isOurs(event) {
    return !!dragging && Array.from(event.dataTransfer.types || []).includes(DRAG_TYPE);
  }

  function onFolderDragOver(entry, row, event) {
    if (!isOurs(event) || dragging.ids.includes(entry.folder.id)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    row.classList.add("zam-drop-target");
  }

  function onFolderDrop(folderId, row, event) {
    row.classList.remove("zam-drop-target");
    if (!isOurs(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!api().moveItems(dragging.ids, folderId)) {
      hooks.notify({ title: "Move", message: "A folder cannot move into itself." });
    }
  }

  // Dropping on empty table space moves to the root, like AE.
  wrap.addEventListener("dragover", (event) => {
    if (!isOurs(event) || event.target.closest("tr.zam-folder")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  wrap.addEventListener("drop", (event) => {
    if (!isOurs(event) || event.target.closest("tr.zam-folder")) return;
    event.preventDefault();
    event.stopPropagation();
    api().moveItems(dragging.ids, null);
  });

  let propertyTarget = null;

  function clearPropertyTarget() {
    if (propertyTarget) propertyTarget.classList.remove("zam-property-drop");
    propertyTarget = null;
  }

  function propertyAt(event) {
    const registry = api();
    if (!dragging || !registry || !registry.propertyAt || wrap.contains(event.target)) return null;
    const found = registry.propertyAt(event.target);
    if (!found) return null;
    const item = dragging.entry.item;
    return found.kind && item && found.kind !== item.kind ? null : found;
  }

  function onPropertyDragOver(event) {
    const found = propertyAt(event);
    const row = found && event.target.closest ? event.target.closest("li, tr, .proprow") : null;
    if (!found) {
      clearPropertyTarget();
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (row !== propertyTarget) {
      clearPropertyTarget();
      propertyTarget = row;
      if (row) row.classList.add("zam-property-drop");
    }
  }

  function onPropertyDrop(event) {
    const found = propertyAt(event);
    if (!found) return;
    event.preventDefault();
    event.stopPropagation();
    const item = dragging.entry.item;
    const result = api().assign(item.id, found.address, null);
    if (!result || !result.ok) {
      hooks.notify({
        title: "Assign " + item.name,
        message: result && result.reason === "kind"
          ? (found.name || "That property") + " does not take a " + model.kindLabel(item.kind).toLowerCase() + "."
          : (result && result.error) || "The item could not be assigned.",
      });
    }
    onDragEnd();
  }

  function dispose() {
    onDragEnd();
  }

  return {
    wrap, head, body, empty, render, markSelected, startRename, startItemRename, rowEntry, dispose,
    rows: () => rows,
  };
}

module.exports = { createTable };
