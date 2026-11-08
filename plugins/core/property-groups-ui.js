(function (global) {
  "use strict";
  const PZ = global.PZ, api = PZ?.zoidium?.propertyGroups, prototype = PZ?.ui?.edit?.prototype;
  if (!api || !prototype) return;
  // Keys follow the panel DOM. The editor's iterable index contains only
  // WeakRefs, so abandoned panels never become session-owned roots.
  const lists = new WeakMap(), nativeRows = new WeakMap(), panels = new WeakMap();
  const editors = new WeakMap(), lifetimes = new WeakMap();
  let open = null;
  const close = () => { open?.deref()?.remove(); open = null; };
  const css = `
    .zpg-heading { display:flex; align-items:center; min-height:28px; background:var(--zui-bg-sunken); color:var(--zui-text); border-bottom:1px solid var(--zui-border); }
    .zpg-heading button { font:inherit; color:inherit; border:0; background:transparent; cursor:pointer; }
    .zpg-toggle { flex:1; text-align:left; padding:4px 6px; min-width:0; overflow:hidden; text-overflow:ellipsis; }
    .zpg-toggle::before { content:'▾'; display:inline-block; width:20px; }
    .zpg-toggle[aria-expanded=false]::before { content:'▸'; }
    .zpg-settings-button { padding:4px 8px; font-size:var(--zui-font-size-small) !important; }
    .zpg-heading[data-locked=true] .zpg-toggle::after { content:' · Locked'; color:var(--zui-text-muted); }
    .zpg-settings { background:var(--zui-bg-sunken); padding:8px; border-bottom:1px solid var(--zui-border); white-space:normal; }
    .zpg-settings-title { color:var(--zui-text-muted); margin-bottom:6px; }
    .zpg-settings label { display:grid; grid-template-columns:minmax(60px,1fr) minmax(0,2fr); align-items:center; gap:8px; min-height:28px; }
    .zpg-settings input[type=text] { width:100%; box-sizing:border-box; }
    .zpg-settings input[type=checkbox] { justify-self:start; }
    .zpg-settings-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
    .zpg-settings-error { color:var(--zui-danger); }
    .actionbutton.zpg-native-lock { width:auto; min-width:32px; padding:0 4px; line-height:17px; font:inherit; font-size:var(--zui-font-size-small); color:var(--zui-text-muted); }
  `;
  function ensureStyle(doc) {
    if (doc.getElementById("zoidium-property-groups-style")) return;
    const style = doc.createElement("style"); style.id = "zoidium-property-groups-style";
    style.textContent = css; doc.head.append(style);
  }
  function editorState(editor) {
    let state = editors.get(editor);
    if (state) return state;
    state = { views: new Set(), renders: 0, domMoves: 0 };
    editors.set(editor, state);
    editor.onProjectChanged.watch(() => {
      for (const ref of state.views) {
        const view = ref.deref();
        if (!view) state.views.delete(ref);
        else if (panels.get(view)?.project !== editor.project) releasePanel(view);
      }
      close();
    });
    return state;
  }
  function panelState(view) {
    let state = panels.get(view);
    if (state) return state;
    const editor = editorState(view.editor), ref = new WeakRef(view);
    state = { lists: new Set(), rows: new Set(), project: view.editor.project, ref };
    panels.set(view, state); editor.views.add(ref);
    if (!lifetimes.has(view)) {
      const enabled = () => { if (view.enabled) rescan(view); else releasePanel(view); };
      view.onEnabledChanged.watch(enabled); lifetimes.set(view, enabled);
    }
    return state;
  }
  function releaseList(view, el) {
    lists.delete(el); panels.get(view)?.lists.delete(el);
  }
  function releasePanel(view) {
    const state = panels.get(view);
    if (!state) return;
    for (const el of state.lists) lists.delete(el);
    for (const row of state.rows) nativeRows.delete(row);
    state.lists.clear(); state.rows.clear();
    editors.get(view.editor)?.views.delete(state.ref); panels.delete(view);
    if (view.el.contains(open?.deref())) close();
  }
  function registerList(view, el) {
    let entry = lists.get(el);
    if (!entry) {
      entry = { view, dirty: false, queued: false, organized: Array.from(el.children).some(child => child.classList.contains("zpg-heading")) };
      lists.set(el, entry); panelState(view).lists.add(el);
    }
    schedule(el, entry);
    return entry;
  }
  function schedule(el, entry) {
    entry.dirty = true;
    if (entry.queued) return;
    entry.queued = true;
    const ref = new WeakRef(el);
    global.queueMicrotask(() => {
      const element = ref.deref(), current = element && lists.get(element);
      if (!current || current !== entry) return;
      current.queued = false;
      if (!current.dirty) return;
      current.dirty = false; render(element, current);
    });
  }
  function registerNative(view, row, object) {
    let button = row.querySelector(".zpg-native-lock");
    if (!button) {
      button = row.ownerDocument.createElement("button"); button.className = "actionbutton zpg-native-lock";
      button.onclick = event => { event.stopPropagation(); api.setNativeLock(view.editor, object, !api.nativeOwnLock(object)); };
      row.children[1].prepend(button);
    }
    nativeRows.set(row, button); panelState(view).rows.add(row); syncNative(row);
  }
  function rescan(view) {
    ensureStyle(view.el.ownerDocument);
    for (const el of view.el.querySelectorAll("ul")) if (api.isList(el.pz_object)) registerList(view, el);
    for (const row of view.el.querySelectorAll("li")) {
      if (row.pz_object instanceof PZ.object3d.group && !view.options.showPropertyControls) registerNative(view, row, row.pz_object);
    }
  }
  function panel(anchor, title) {
    close();
    ensureStyle(anchor.ownerDocument);
    const doc = anchor.ownerDocument, el = doc.createElement("div");
    el.className = "zpg-settings"; el.setAttribute("role", "group"); el.setAttribute("aria-label", title);
    const heading = doc.createElement("div"); heading.className = "zpg-settings-title"; heading.textContent = title; el.append(heading);
    function field(label, type, value) {
      const row = doc.createElement("label"), text = doc.createElement("span"), input = doc.createElement("input");
      text.textContent = label; input.type = type; input.className = "pz-inputbox";
      if (type === "checkbox") input.checked = !!value; else input.value = value;
      row.append(text, input); el.append(row); return input;
    }
    const error = doc.createElement("div"); error.className = "zpg-settings-error"; error.setAttribute("role", "status");
    const actions = doc.createElement("div"); actions.className = "zpg-settings-actions";
    function finish(apply) {
      const cancel = doc.createElement("button"), ok = doc.createElement("button");
      cancel.textContent = "Cancel"; ok.textContent = "Apply"; cancel.className = ok.className = "pz-inputbox";
      cancel.onclick = close;
      ok.onclick = () => { const message = apply(); if (message) error.textContent = message; else close(); };
      actions.append(cancel, ok); el.append(error, actions); anchor.after(el); open = new WeakRef(el);
      el.addEventListener("mousedown", event => event.stopPropagation());
      el.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") close(); if (event.key === "Enter") { event.preventDefault(); ok.click(); } });
      el.querySelector("input")?.focus();
    }
    return { field, finish };
  }
  function settings(view, anchor, list, group) {
    const form = panel(anchor, "Group settings"), name = form.field("Name", "text", group), lock = form.field("Lock", "checkbox", api.locked(list, group));
    form.finish(() => {
      const label = name.value.trim();
      if (!label) return "Enter a group name";
      if (label !== group && api.members(list, label).length) return "A group already uses this name";
      if (view.editor.history.operation !== null) return "Finish the current edit first";
      api.settings(view.editor, list, group, { name: label, locked: lock.checked });
    });
  }
  function choose(view, anchor, property) {
    const selected = Array.from(view.el.querySelectorAll(".selected"), row => row.pz_object)
      .filter(p => p instanceof PZ.property && p.parent === property.parent);
    const properties = selected.includes(property) ? selected : [property];
    const form = panel(anchor, "Property group"), input = form.field("Group", "text", api.name(property));
    const doc = anchor.ownerDocument, choices = doc.createElement("datalist");
    choices.id = "zpg-choices-" + Math.random().toString(36).slice(2);
    for (const block of api.blocks(property.parent)) if (block.name && !api.locked(property.parent, block.name)) {
      const option = doc.createElement("option"); option.value = block.name; choices.append(option);
    }
    input.setAttribute("list", choices.id); input.after(choices);
    input.placeholder = "Empty for no group";
    form.finish(() => {
      if (properties.some(p => p.parent !== property.parent || !api.canAssign(p, input.value.trim()))) return "Unlock the group before moving its properties";
      if (view.editor.history.operation !== null) return "Finish the current edit first";
      api.setGroup(view.editor, properties, input.value);
    });
  }
  function propertyMenu(view, row, property) {
    return [{ label: "Group…", disabled: !api.canAssign(property, ""), action: () => choose(view, row, property) }];
  }
  const generate = prototype.generateListItem;
  prototype.generateListItem = function (parent, object) {
    const row = generate.apply(this, arguments);
    if (api.isList(parent.pz_object) && object instanceof PZ.property) {
      row.classList.add("zpg-property");
      const originalMenu = row.oncontextmenu, view = this;
      row.oncontextmenu = event => {
        if (!global.ZoidiumUI) return originalMenu?.call(this, event);
        event.preventDefault(); event.stopPropagation();
        global.ZoidiumUI.openMenu({ owner: row, x: event.clientX, y: event.clientY, items: [
          { label: "Rename", action: () => view.renameClick({ currentTarget: row, preventDefault() {} }) }, ...propertyMenu(view, row, object),
        ] });
      };
      ensureStyle(row.ownerDocument); registerMenu();
      registerList(this, parent);
    }
    if (object instanceof PZ.object3d.group && !this.options.showPropertyControls) {
      ensureStyle(row.ownerDocument); registerNative(this, row, object);
    }
    return row;
  };
  const generateList = prototype.generateObjectList;
  prototype.generateObjectList = function (row, list) {
    const result = generateList.apply(this, arguments);
    if (!api.isList(list)) return result;
    const el = row.nextElementSibling;
    // Native callbacks remove by the nth LI. Display groups deliberately use
    // a different row order, so remove the row with the exact object instead.
    list.onObjectRemoved.unwatch(el.pz_objectRemoved);
    el.pz_objectRemoved = object => {
      const item = Array.from(el.children).find(child => child.pz_object === object);
      if (item) this.unloadListItem(item);
      const entry = lists.get(el); if (entry) schedule(el, entry);
    };
    list.onObjectRemoved.watch(el.pz_objectRemoved);
    registerList(this, el);
    return result;
  };
  function render(el, entry) {
    const list = el.pz_object;
    const rows = Array.from(el.children).filter(child => child.tagName === "LI" && child.pz_object instanceof PZ.property);
    const organized = Array.from(list).some(p => api.name(p));
    // Untouched native lists require no DOM writes, signatures, or sorting.
    if (!organized && !entry.organized) return;
    editorState(entry.view.editor).renders++;
    if (open?.deref()?.parentElement === el) close();
    for (const heading of Array.from(el.children).filter(child => child.classList.contains("zpg-heading"))) heading.remove();
    const nodes = new Map(rows.map(row => [row.pz_object, { row, child: row.nextElementSibling?.tagName === "UL" ? row.nextElementSibling : null }]));
    if (!organized) {
      for (const p of list) {
        const pair = nodes.get(p);
        if (!pair) continue;
        const { row, child } = pair;
        row.firstElementChild.style.paddingLeft = (row.zpgBasePadding || 0) + "px"; row.style.display = "";
        append(el, row, entry);
        if (child) { child.style.display = row.querySelector(".collapse")?.classList.contains("collapsed") ? "none" : ""; append(el, child, entry); }
      }
      entry.organized = false; return;
    }
    entry.organized = true;
    for (const block of api.blocks(list)) {
      const collapsed = block.name && block.items.some(p => api.meta(p).collapsed);
      if (block.name) {
        const doc = el.ownerDocument, heading = doc.createElement("div"), toggle = doc.createElement("button"), button = doc.createElement("button");
        heading.className = "zpg-heading"; heading.zpg = { list, name: block.name };
        heading.dataset.locked = String(block.items.some(p => api.meta(p).locked === true));
        toggle.className = "zpg-toggle"; toggle.textContent = block.name; toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.style.paddingLeft = (el.pz_paddingLevel || 0) + "px";
        toggle.onclick = () => api.collapse(entry.view.editor, list, block.name);
        button.className = "zpg-settings-button"; button.textContent = "Settings"; button.setAttribute("aria-label", block.name + " settings");
        button.onclick = event => { event.stopPropagation(); settings(entry.view, heading, list, block.name); };
        heading.append(toggle, button); append(el, heading, entry); entry.view.item_drag.addElts(heading);
      }
      for (const p of block.items) {
        const nodesForProperty = nodes.get(p); if (!nodesForProperty) continue;
        const { row, child } = nodesForProperty;
        if (row.zpgBasePadding === undefined) row.zpgBasePadding = parseFloat(row.firstElementChild.style.paddingLeft) || 0;
        row.firstElementChild.style.paddingLeft = row.zpgBasePadding + (block.name ? 15 : 0) + "px";
        row.style.display = collapsed ? "none" : "";
        append(el, row, entry);
        if (child) { child.style.display = collapsed ? "none" : row.querySelector(".collapse")?.classList.contains("collapsed") ? "none" : ""; append(el, child, entry); }
      }
    }
  }
  function append(parent, node, entry) {
    editorState(entry.view.editor).domMoves++; parent.append(node);
  }
  function syncNative(row) {
    const button = nativeRows.get(row);
    if (!button) return;
    const value = api.nativeOwnLock(row.pz_object);
    button.textContent = value ? "Locked" : "Lock";
    button.title = value ? "Unlock group" : "Lock group";
    button.setAttribute("aria-label", button.title); button.setAttribute("aria-pressed", String(value));
  }
  const unloadItem = prototype.unloadListItem;
  prototype.unloadListItem = function (row) {
    const next = row.nextElementSibling;
    if (next?.tagName === "UL") releaseList(this, next);
    nativeRows.delete(row); panels.get(this)?.rows.delete(row);
    if (row.contains(open?.deref()) || next?.contains(open?.deref())) close();
    return unloadItem.apply(this, arguments);
  };
  const changed = prototype.objectsChanged;
  prototype.objectsChanged = function () {
    releasePanel(this);
    return changed.apply(this, arguments);
  };
  const unload = prototype.unload;
  prototype.unload = function () {
    this.enabled = false; this.objects = null;
    this.objectsChanged(); releasePanel(this);
    const listener = lifetimes.get(this);
    if (listener) this.onEnabledChanged.unwatch(listener);
    lifetimes.delete(this);
    return unload?.apply(this, arguments);
  };
  let menuRegistered = false;
  function registerMenu() {
    if (menuRegistered || !global.ZoidiumUI?.registerMenuExtension) return;
    menuRegistered = true;
    global.ZoidiumUI.registerMenuExtension({ id: "core/property-groups", items(options) {
      const row = options?.owner?.closest?.("li"), p = row?.pz_object;
      if (!(p instanceof PZ.property) || !api.isList(p.parent) || options.items?.some(item => item.label === "Group…")) return [];
      const entry = lists.get(row.parentElement);
      return entry ? propertyMenu(entry.view, row, p) : [];
    } });
  }
  api.refresh = (editor = global.CM, subject) => {
    registerMenu();
    const index = editors.get(editor);
    if (!index) return;
    for (const ref of index.views) {
      const view = ref.deref(), state = view && panels.get(view);
      if (!state) { index.views.delete(ref); continue; }
      ensureStyle(view.el.ownerDocument);
      for (const el of state.lists) if (!subject || el.pz_object === subject) schedule(el, lists.get(el));
      for (const row of state.rows) if (!subject || row.pz_object === subject) syncNative(row);
    }
  };
  // Counts contain no objects and allow lifecycle checks without retaining DOM.
  api.uiStats = editor => {
    const index = editors.get(editor);
    let count = 0, listCount = 0, rowCount = 0, queued = 0;
    for (const ref of index?.views || []) {
      const view = ref.deref(), state = view && panels.get(view);
      if (!state) { index.views.delete(ref); continue; }
      count++; listCount += state.lists.size; rowCount += state.rows.size;
      for (const el of state.lists) if (lists.get(el)?.queued) queued++;
    }
    return { panels: count, lists: listCount, nativeRows: rowCount, queuedLists: queued,
      renders: index?.renders || 0, domMoves: index?.domMoves || 0 };
  };
  api.propertyMenu = propertyMenu;
  api.groupSettings = settings;
  global.addEventListener("zoidium:ready", registerMenu, { once: true });
  registerMenu();
})(window);
