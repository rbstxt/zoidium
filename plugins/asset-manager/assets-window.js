"use strict";

// The Assets window: an After Effects style Project panel. The top area
// previews the selected item with its "Used N times" menu, below are search,
// view and type menus, a sortable item table and a status line. All data
// comes from the core registry (ZoidiumAssets); this file only renders it and
// forwards Reveal requests.

const model = require("./assets-model.js");
const { createActions } = require("./assets-actions.js");
const { createResolveFonts } = require("./assets-fonts.js");
const { createTable } = require("./assets-table.js");

const VIEW_KEY = "zoidium.assets.view";
const WINDOW_ID = "assets";

function readView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    return {
      filter: model.FILTERS.some((entry) => entry.id === saved.filter) ? saved.filter : "all",
      kind: typeof saved.kind === "string" ? saved.kind : "all",
      sort: {
        column: model.COLUMNS.some((entry) => entry.id === saved.column) ? saved.column : "name",
        direction: saved.direction === "desc" ? "desc" : "asc",
      },
    };
  } catch (error) {
    return { filter: "all", kind: "all", sort: { column: "name", direction: "asc" } };
  }
}

function writeView(view) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      filter: view.filter,
      kind: view.kind,
      column: view.sort.column,
      direction: view.sort.direction,
    }));
  } catch (error) {
    // Private mode or a full quota only loses the remembered view.
  }
}

function make(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

// `session` = { context, kit, registry(), icon(name), notify }.
function createAssetsWindow(session) {
  const doc = session.document;
  const view = Object.assign(readView(), { query: "", selectedId: null });
  let win = null;
  let parts = null;
  let snapshot = null;
  let shown = [];
  let usageMenu = null;
  let fontFaces = new Map();
  let contextMenu = null;
  const actions = createActions({
    document: doc,
    registry: () => session.registry(),
    notify: (detail) => session.notify(detail),
    confirm: (options) => session.kit.confirm(options),
    reveal: (item) => revealFirst(item),
    resolveFonts: () => resolveFonts.open(),
    select: (id) => {
      pendingSelect = id;
      if (snapshot && snapshot.items.some((item) => item.id === id)) select(id, true);
    },
  });
  const resolveFonts = createResolveFonts({
    context: session.context,
    kit: session.kit,
    document: doc,
    registry: () => session.registry(),
    notify: (detail) => session.notify(detail),
    actions,
  });
  // An imported item appears with the next snapshot; select it then.
  let pendingSelect = null;

  function registry() {
    return session.registry();
  }

  function icon(name, className) {
    const holder = make(doc, "span", className || "zam-icon");
    const svg = session.icon(name);
    if (svg) holder.appendChild(svg);
    return holder;
  }

  function selectedItem() {
    if (!snapshot) return null;
    return snapshot.items.find((item) => item.id === view.selectedId) || null;
  }

  // ---- Reveal ------------------------------------------------------------

  function reveal(usage) {
    const api = registry();
    if (!api || !usage) return;
    let ok = false;
    try {
      ok = api.reveal(usage) === true;
    } catch (error) {
      console.warn("[Assets] reveal failed:", error);
    }
    if (ok) return;
    if (usage.composition) {
      session.notify({
        title: "In composition " + usage.composition.name,
        message: "Open that composition in the Compositions window to see this use.",
      });
    } else {
      session.notify({ title: "Reveal", message: "This use cannot be selected in the editor." });
    }
  }

  function revealFirst(item) {
    if (!item) return;
    const usages = item.usages || [];
    const target = usages.find((usage) => usage.revealable) || usages[0];
    if (target) reveal(target);
    else session.notify({ title: item.name, message: "This item is not used in the project." });
  }

  // ---- Usage menu (AE: the arrow beside "Used N times") -------------------

  function closeUsageMenu() {
    if (!usageMenu) return;
    usageMenu.remove();
    usageMenu = null;
    doc.removeEventListener("pointerdown", onOutsidePointer, true);
  }

  function onOutsidePointer(event) {
    if (usageMenu && !usageMenu.contains(event.target) && !parts.uses.contains(event.target)) closeUsageMenu();
  }

  function toggleUsageMenu() {
    if (usageMenu) {
      closeUsageMenu();
      return;
    }
    const item = selectedItem();
    if (!item || !model.usageCount(item)) return;
    usageMenu = make(doc, "div", "zam-usage-menu");
    usageMenu.setAttribute("role", "menu");
    for (const usage of item.usages) {
      const entry = make(doc, "button", "zam-usage-entry", model.usagePath(usage));
      entry.type = "button";
      entry.setAttribute("role", "menuitem");
      entry.title = usage.revealable ? "Select this use in the editor" : "Not selectable from here";
      if (!usage.revealable) entry.classList.add("zam-muted");
      entry.addEventListener("click", () => {
        closeUsageMenu();
        reveal(usage);
      });
      usageMenu.appendChild(entry);
    }
    parts.info.appendChild(usageMenu);
    doc.addEventListener("pointerdown", onOutsidePointer, true);
    const first = usageMenu.querySelector("button");
    if (first) first.focus();
  }

  // ---- Commands: icon bar and row context menu ----------------------------

  function closeContextMenu() {
    if (!contextMenu) return;
    contextMenu.remove();
    contextMenu = null;
    doc.removeEventListener("pointerdown", onContextOutside, true);
  }

  function onContextOutside(event) {
    if (contextMenu && !contextMenu.contains(event.target)) closeContextMenu();
  }

  // One menu at a time. `place` = { x, y } (pointer) or { anchor } (button).
  // Entries: { label, hint, enabled, run, color? }.
  function showMenu(entries, place) {
    closeContextMenu();
    const menu = make(doc, "div", "zam-usage-menu zam-context-menu");
    menu.setAttribute("role", "menu");
    for (const command of entries) {
      const entry = make(doc, "button", "zam-usage-entry");
      entry.type = "button";
      entry.setAttribute("role", "menuitem");
      if (command.color !== undefined) {
        const swatch = make(doc, "span", "zam-label zam-menu-swatch");
        if (command.color) swatch.style.background = command.color;
        entry.appendChild(swatch);
      }
      entry.appendChild(doc.createTextNode(command.label));
      entry.disabled = command.enabled === false;
      if (command.hint) entry.title = command.hint;
      entry.addEventListener("click", () => {
        closeContextMenu();
        command.run();
      });
      menu.appendChild(entry);
    }
    const bounds = parts.root.getBoundingClientRect();
    if (place.anchor) {
      const at = place.anchor.getBoundingClientRect();
      menu.style.top = (at.bottom - bounds.top + 2) + "px";
      if (at.left - bounds.left < bounds.width / 2) {
        menu.style.left = Math.max(0, at.left - bounds.left) + "px";
        menu.style.right = "auto";
      } else {
        menu.style.left = "auto";
        menu.style.right = Math.max(0, bounds.right - at.right) + "px";
      }
    } else {
      menu.style.left = Math.max(0, place.x - bounds.left) + "px";
      menu.style.top = Math.max(0, place.y - bounds.top) + "px";
      menu.style.right = "auto";
    }
    parts.root.appendChild(menu);
    // Open upward when the menu would leave the window at the bottom.
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > bounds.bottom) {
      const above = place.anchor ? place.anchor.getBoundingClientRect().top : place.y;
      menu.style.top = Math.max(0, above - bounds.top - rect.height - 2) + "px";
    }
    contextMenu = menu;
    doc.addEventListener("pointerdown", onContextOutside, true);
    const first = menu.querySelector("button:not(:disabled)");
    if (first) first.focus();
  }

  function labelEntries(ids) {
    const api = registry();
    return model.LABELS.map((label, index) => ({
      label: label.name,
      color: label.color,
      enabled: !!(api && api.setLabel),
      run: () => api.setLabel(ids, index),
    }));
  }

  function openLabelMenu(ids, anchor) {
    showMenu(labelEntries(ids.map(rawId)), { anchor });
  }

  // Folder ids travel through the registry without the row prefix.
  function rawId(id) {
    return model.isFolderRow(id) ? id.slice("folder:".length) : id;
  }

  function openContextMenu(item, event) {
    event.preventDefault();
    const entries = actions.list(item).map((command) => Object.assign({}, command));
    entries.push({ label: "Label ▸", run: () => openLabelMenu([item.id], parts.commands) });
    showMenu(entries, { x: event.clientX, y: event.clientY });
  }

  function folderCommands(entry) {
    const api = registry();
    return [
      { id: "rename", label: "Rename", icon: "edit", hint: "Rename this folder",
        enabled: !!(api && api.renameFolder), run: () => parts.table.startRename(entry.folder.id) },
      { id: "new-folder", label: "New Folder Inside", icon: "folder", hint: "Create a folder inside this one",
        enabled: !!(api && api.createFolder), run: () => newFolder(entry.folder.id) },
      { id: "delete", label: "Delete Folder", icon: "remove", hint: "Delete this folder; its contents move up a level",
        enabled: !!(api && api.deleteFolder), run: () => removeRow(entry) },
    ];
  }

  function openFolderMenu(entry, event) {
    event.preventDefault();
    const entries = folderCommands(entry);
    entries.push({ label: "Label ▸", run: () => openLabelMenu([entry.id], parts.commands) });
    showMenu(entries, { x: event.clientX, y: event.clientY });
  }

  function openProjectMenu(anchor) {
    showMenu([
      actions.importCommand(),
      newFolderCommand(),
      actions.removeUnusedCommand(snapshot),
      actions.resolveFontsCommand(snapshot),
    ], { anchor });
  }

  // AE File > New > New Folder: inside the selected folder (or the folder of
  // the selected item), named "Untitled N", then renamed in place.
  function newFolder(parent) {
    const api = registry();
    if (!api || !api.createFolder) return;
    const folders = (snapshot && snapshot.folders) || [];
    let index = 1;
    while (folders.some((folder) => folder.name === "Untitled " + index)) index += 1;
    const id = api.createFolder("Untitled " + index, parent === undefined ? null : parent);
    if (!id) return;
    view.selectedId = model.folderRowId(id);
    parts.table.startRename(id);
  }

  function newFolderCommand() {
    const api = registry();
    return {
      id: "new-folder",
      label: "New Folder",
      icon: "folder",
      hint: "Create a folder to organize items",
      enabled: !!(api && api.createFolder),
      run: () => {
        const folder = selectedFolder();
        const item = selectedItem();
        newFolder(folder ? folder.id : item && item.folder ? item.folder : null);
      },
    };
  }

  function renderCommands() {
    parts.commands.textContent = "";
    const entry = parts.table.rowEntry(view.selectedId);
    if (!entry) return;
    const commands = entry.type === "folder" ? folderCommands(entry) : actions.list(entry.item);
    for (const command of commands) {
      const button = make(doc, "button", "zam-command");
      button.type = "button";
      button.title = command.label.replace("…", "") + " — " + command.hint;
      button.setAttribute("aria-label", command.label);
      button.disabled = !command.enabled;
      button.appendChild(icon(command.icon));
      button.addEventListener("click", () => command.run());
      parts.commands.appendChild(button);
    }
  }

  // ---- Info area ---------------------------------------------------------

  function fontPreviewFamily(item) {
    // Only real font files can be shown by the browser; built-in fonts are
    // typeface JSON and fall back to the UI font.
    if (!item.url || !/\.(ttf|otf|woff2?)$/i.test(item.name || "") || typeof FontFace !== "function") return "";
    if (fontFaces.has(item.id)) return fontFaces.get(item.id).family;
    const family = "zam-preview-" + fontFaces.size;
    const face = new FontFace(family, "url(" + JSON.stringify(item.url) + ")");
    fontFaces.set(item.id, { family, face });
    face.load().then(() => {
      doc.fonts.add(face);
      if (selectedItem() === item) renderInfo();
    }, () => fontFaces.set(item.id, { family: "", face: null }));
    return "";
  }

  function thumbFor(item) {
    const box = make(doc, "div", "zam-thumb");
    if (item.status === "missing") {
      box.classList.add("zam-thumb-missing");
      box.appendChild(icon("error"));
      return box;
    }
    if (item.kind === "image" && item.url) {
      const image = make(doc, "img");
      image.alt = "";
      image.decoding = "async";
      image.src = item.url;
      box.appendChild(image);
      return box;
    }
    if (item.kind === "video" && item.url) {
      const video = make(doc, "video");
      video.muted = true;
      video.preload = "metadata";
      video.src = item.url + "#t=0.1";
      box.appendChild(video);
      return box;
    }
    if (item.kind === "font") {
      const sample = make(doc, "span", "zam-font-sample", "Aa");
      const loaded = fontFaces.get(item.id);
      const family = loaded ? loaded.family : fontPreviewFamily(item);
      if (family) sample.style.fontFamily = JSON.stringify(family) + ", var(--zui-font)";
      box.appendChild(sample);
      return box;
    }
    box.appendChild(icon(model.kindInfo(item.kind).icon));
    return box;
  }

  function renderInfo() {
    closeUsageMenu();
    renderCommands();
    const item = selectedItem();
    const info = parts.info;
    info.textContent = "";
    const folderEntry = !item && parts.table.rowEntry(view.selectedId);
    if (folderEntry && folderEntry.type === "folder") {
      const box = make(doc, "div", "zam-thumb");
      box.appendChild(icon("folder"));
      const text = make(doc, "div", "zam-info-text");
      text.appendChild(make(doc, "div", "zam-info-name", folderEntry.folder.name));
      text.appendChild(make(doc, "div", "zam-info-line", "Folder · " + model.plural(folderEntry.count, "item", "items")));
      info.append(box, text);
      return;
    }
    if (!item) {
      info.appendChild(make(doc, "div", "zam-info-empty", snapshot && snapshot.items.length
        ? "Select an item to see where it is used."
        : ""));
      return;
    }
    info.appendChild(thumbFor(item));
    const text = make(doc, "div", "zam-info-text");
    const name = make(doc, "div", "zam-info-name", item.name);
    name.title = item.name;
    text.appendChild(name);
    const uses = make(doc, "button", "zam-uses", model.usageText(item));
    uses.type = "button";
    uses.disabled = !model.usageCount(item);
    if (model.usageCount(item)) uses.appendChild(make(doc, "span", "zam-caret", "▾"));
    uses.title = model.usageCount(item) ? "Show where this item is used" : "Not used in the project";
    uses.addEventListener("click", toggleUsageMenu);
    parts.uses = uses;
    text.appendChild(uses);
    const facts = [model.kindLabel(item.kind), model.detailText(item), model.formatSize(item.size)]
      .filter(Boolean);
    text.appendChild(make(doc, "div", "zam-info-line", facts.join(" · ")));
    const state = [model.sourceLabel(item.source)];
    if (item.status !== "ready" && item.status !== "unknown") state.push(model.statusLabel(item.status));
    const stateLine = make(doc, "div", "zam-info-line zam-wrap", state.join(" · "));
    if (item.error) {
      stateLine.appendChild(make(doc, "span", "zam-error", " — " + item.error));
    }
    text.appendChild(stateLine);
    info.appendChild(text);
  }

  // ---- Toolbar -----------------------------------------------------------

  function option(select, value, label) {
    const entry = make(doc, "option", null, label);
    entry.value = value;
    select.appendChild(entry);
  }

  function renderMenus() {
    const items = snapshot ? snapshot.items : [];
    const counts = snapshot && snapshot.counts ? snapshot.counts : {};
    parts.filter.textContent = "";
    for (const entry of model.FILTERS) {
      const count = Number.isFinite(counts[entry.id]) ? counts[entry.id] : null;
      option(parts.filter, entry.id, count === null ? entry.label : entry.label + " (" + count + ")");
    }
    parts.filter.value = view.filter;
    const kinds = model.presentKinds(items);
    if (view.kind !== "all" && !kinds.includes(view.kind)) kinds.push(view.kind);
    parts.kind.textContent = "";
    option(parts.kind, "all", "All types");
    for (const kind of kinds) option(parts.kind, kind, model.kindLabel(kind));
    parts.kind.value = view.kind;
  }

  function buildToolbar() {
    const bar = make(doc, "div", "zam-toolbar");
    const search = make(doc, "input", "zoidium-text zam-search");
    search.type = "search";
    search.placeholder = "Search";
    search.setAttribute("aria-label", "Search assets");
    search.addEventListener("input", () => {
      view.query = search.value;
      renderTable();
    });
    const filter = make(doc, "select", "zoidium-select zam-filter");
    filter.setAttribute("aria-label", "Show");
    filter.addEventListener("change", () => {
      view.filter = filter.value;
      writeView(view);
      renderTable();
    });
    const kind = make(doc, "select", "zoidium-select zam-kind");
    kind.setAttribute("aria-label", "Type");
    kind.addEventListener("change", () => {
      view.kind = kind.value;
      writeView(view);
      renderTable();
    });
    const importButton = make(doc, "button", "zam-command");
    importButton.type = "button";
    importButton.title = "Import — add files to the project";
    importButton.setAttribute("aria-label", "Import");
    importButton.appendChild(icon("addmedia"));
    importButton.addEventListener("click", () => actions.importCommand().run());
    const more = make(doc, "button", "zam-command");
    more.type = "button";
    more.title = "Project commands";
    more.setAttribute("aria-label", "Project commands");
    more.appendChild(icon("ellipsis"));
    more.addEventListener("click", () => (contextMenu ? closeContextMenu() : openProjectMenu(more)));
    const folderButton = make(doc, "button", "zam-command");
    folderButton.type = "button";
    folderButton.title = "New Folder — create a folder to organize items";
    folderButton.setAttribute("aria-label", "New Folder");
    folderButton.appendChild(icon("folder"));
    folderButton.addEventListener("click", () => newFolderCommand().run());
    bar.append(importButton, folderButton, search, filter, kind, more);
    return { bar, search, filter, kind, importButton, folderButton };
  }

  // ---- Table -------------------------------------------------------------

  function select(id, scroll) {
    if (view.selectedId === id) return;
    view.selectedId = id;
    parts.table.markSelected(id, scroll);
    renderInfo();
  }

  function selectedFolder() {
    const entry = parts && parts.table.rowEntry(view.selectedId);
    return entry && entry.type === "folder" ? entry.folder : null;
  }

  function activate(entry) {
    if (entry.type === "item") revealFirst(entry.item);
  }

  async function removeRow(entry) {
    if (entry.type === "item") {
      const command = actions.list(entry.item).find((candidate) => candidate.id === "delete");
      if (command && command.enabled) command.run();
      return;
    }
    const api = registry();
    if (!api.deleteFolder) return;
    // AE deletes a folder's contents with it; here they move up a level so
    // no file is lost, and the question says so.
    if (entry.count) {
      const approved = await session.kit.confirm({
        title: "Delete folder",
        message: 'Delete folder "' + entry.folder.name + '"? Its ' + model.plural(entry.count, "item moves", "items move") +
          " to the folder above. You can undo this.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!approved) return;
    }
    api.deleteFolder(entry.folder.id);
  }

  function renderTable() {
    const items = snapshot ? snapshot.items : [];
    shown = parts.table.render(snapshot);
    const itemCount = shown.filter((entry) => entry.type === "item").length;
    parts.table.empty.hidden = shown.length > 0;
    parts.table.empty.textContent = items.length
      ? (view.filter === "problems" && !view.query && view.kind === "all"
        ? "No missing or failed items."
        : "No items match.")
      : "No assets yet. Import media in the Media tab, or choose a file in an image or font property.";
    parts.status.textContent = model.summaryText(items, model.isFlatView(view) ? itemCount : undefined);
    if (!shown.some((entry) => entry.id === view.selectedId)) {
      view.selectedId = shown.length ? shown[0].id : null;
      parts.table.markSelected(view.selectedId, false);
    }
    renderInfo();
  }

  // ---- Snapshot updates --------------------------------------------------

  function update(next) {
    if (!parts) return;
    snapshot = next || null;
    renderMenus();
    renderTable();
    parts.importButton.disabled = !actions.importCommand().enabled;
    parts.folderButton.disabled = !newFolderCommand().enabled;
    if (pendingSelect && snapshot && snapshot.items.some((item) => item.id === pendingSelect)) {
      const id = pendingSelect;
      pendingSelect = null;
      if (!shown.some((entry) => entry.id === id)) {
        view.filter = "all";
        view.kind = "all";
        view.query = "";
        parts.search.value = "";
        renderMenus();
        renderTable();
      }
      select(id, true);
    }
  }

  // Files dropped on the window are imported like AE's Project panel drop.
  function installDrop(root) {
    const hasFiles = (event) => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes("Files");
    root.addEventListener("dragover", (event) => {
      if (!hasFiles(event) || !actions.importCommand().enabled) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      root.classList.add("zam-drop");
    });
    root.addEventListener("dragleave", (event) => {
      if (!root.contains(event.relatedTarget)) root.classList.remove("zam-drop");
    });
    root.addEventListener("drop", (event) => {
      root.classList.remove("zam-drop");
      if (!hasFiles(event) || !actions.importCommand().enabled) return;
      event.preventDefault();
      event.stopPropagation();
      actions.importFiles(Array.from(event.dataTransfer.files || [])).catch((error) => {
        session.notify({ title: "Import", message: (error && error.message) || "The files could not be imported." });
      });
    });
  }

  function mount(body) {
    const root = make(doc, "div", "zam");
    const api = registry();
    if (!api) {
      root.appendChild(session.kit.controls.note(
        "The asset registry is not available. Reload the editor and try again.", "warning"
      ).element);
      body.appendChild(root);
      return null;
    }
    const info = make(doc, "div", "zam-info");
    const toolbar = buildToolbar();
    const table = createTable(doc, icon, view, {
      registry,
      editor: session.editor,
      notify: (detail) => session.notify(detail),
      selectedId: () => view.selectedId,
      select,
      activate,
      contextMenu: (entry, event) => (entry.type === "item"
        ? openContextMenu(entry.item, event)
        : openFolderMenu(entry, event)),
      labelMenu: openLabelMenu,
      remove: removeRow,
      sortChanged: () => {
        writeView(view);
        renderTable();
      },
    });
    const bottom = make(doc, "div", "zam-bottom");
    const status = make(doc, "div", "zam-status");
    const commands = make(doc, "div", "zam-commands");
    bottom.append(status, commands);
    root.append(info, toolbar.bar, table.wrap, bottom);
    body.appendChild(root);
    parts = {
      root, info, uses: info, status, commands, table,
      search: toolbar.search, filter: toolbar.filter, kind: toolbar.kind, importButton: toolbar.importButton,
      folderButton: toolbar.folderButton,
    };
    installDrop(root);
    const unsubscribe = api.subscribe(update);
    update(api.snapshot());
    return function cleanup() {
      unsubscribe();
      closeUsageMenu();
      closeContextMenu();
      table.dispose();
      for (const entry of fontFaces.values()) {
        if (entry.face) doc.fonts.delete(entry.face);
      }
      fontFaces = new Map();
      parts = null;
    };
  }

  function open(options) {
    const existing = session.context.ui.getWindow(WINDOW_ID);
    if (existing) {
      existing.reveal();
      applyOptions(options);
      return existing;
    }
    win = session.context.ui.openWindow({
      id: WINDOW_ID,
      title: "Assets",
      persistKey: "assets",
      width: 560,
      height: 560,
      minWidth: 380,
      minHeight: 320,
      mount,
    });
    applyOptions(options);
    return win;
  }

  // open({ select, filter }) from the sidebar or a notice.
  function applyOptions(options) {
    if (!options || !parts) return;
    if (options.filter) {
      view.filter = options.filter;
      view.query = "";
      parts.search.value = "";
      renderMenus();
      renderTable();
    }
    if (options.select) select(options.select, true);
  }

  return { open, close: () => win && win.close(), resolveFonts: () => resolveFonts.open() };
}

module.exports = { createAssetsWindow };
