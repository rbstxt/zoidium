(function (global) {
  "use strict";
  const PZ = global.PZ, api = PZ?.zoidium?.propertyGroups, prototype = PZ?.ui?.edit?.prototype;
  if (!api || !prototype) return;
  const lists = new Map(), nativeRows = new Set();
  let open = null;
  const close = () => { open?.remove(); open = null; };
  const style = global.document.createElement("style");
  style.textContent = `
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
  global.document.head.append(style);
  function panel(anchor, title) {
    close();
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
      actions.append(cancel, ok); el.append(error, actions); anchor.after(el); open = el;
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
    const form = panel(anchor, "Property group"), input = form.field("Group", "text", api.name(property));
    const doc = anchor.ownerDocument, choices = doc.createElement("datalist");
    choices.id = "zpg-choices-" + Math.random().toString(36).slice(2);
    for (const block of api.blocks(property.parent)) if (block.name && !api.locked(property.parent, block.name)) {
      const option = doc.createElement("option"); option.value = block.name; choices.append(option);
    }
    input.setAttribute("list", choices.id); input.after(choices);
    input.placeholder = "Empty for no group";
    form.finish(() => {
      if (!api.canAssign(property, input.value.trim())) return "Unlock the group before moving its properties";
      if (view.editor.history.operation !== null) return "Finish the current edit first";
      api.setGroup(view.editor, property, input.value);
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
      let entry = lists.get(parent);
      if (!entry) { entry = { view: this, generation: 0 }; lists.set(parent, entry); }
      entry.generation++; render(parent, entry);
    }
    if (object instanceof PZ.object3d.group && !this.options.showPropertyControls) {
      const button = row.ownerDocument.createElement("button"); button.className = "actionbutton zpg-native-lock";
      button.onclick = event => { event.stopPropagation(); api.setNativeLock(this.editor, object, !api.nativeOwnLock(object)); };
      row.children[1].prepend(button); nativeRows.add({ row, button, object }); syncNative();
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
      const entry = lists.get(el); if (entry) { entry.generation++; render(el, entry); }
    };
    list.onObjectRemoved.watch(el.pz_objectRemoved);
    return result;
  };
  function render(el, entry) {
    const list = el.pz_object;
    const rows = Array.from(el.children).filter(child => child.tagName === "LI" && child.pz_object instanceof PZ.property);
    const signature = JSON.stringify([entry.generation, Array.from(list, p => [api.name(p), api.meta(p)])]);
    if (signature === entry.signature) return;
    entry.signature = signature;
    if (open?.parentElement === el) close();
    for (const heading of Array.from(el.children).filter(child => child.classList.contains("zpg-heading"))) {
      entry.view.item_drag.removeElts?.(heading); heading.remove();
    }
    const nodes = new Map(rows.map(row => [row.pz_object, { row, child: row.nextElementSibling?.tagName === "UL" ? row.nextElementSibling : null }]));
    for (const block of api.blocks(list)) {
      const collapsed = block.name && block.items.some(p => api.meta(p).collapsed);
      if (block.name) {
        const doc = el.ownerDocument, heading = doc.createElement("div"), toggle = doc.createElement("button"), button = doc.createElement("button");
        heading.className = "zpg-heading"; heading.zpg = { list, name: block.name };
        heading.dataset.locked = String(api.locked(list, block.name));
        toggle.className = "zpg-toggle"; toggle.textContent = block.name; toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.style.paddingLeft = (el.pz_paddingLevel || 0) + "px";
        toggle.onclick = () => api.collapse(entry.view.editor, list, block.name);
        button.className = "zpg-settings-button"; button.textContent = "Settings"; button.setAttribute("aria-label", block.name + " settings");
        button.onclick = event => { event.stopPropagation(); settings(entry.view, heading, list, block.name); };
        heading.append(toggle, button); el.append(heading); entry.view.item_drag.addElts(heading);
      }
      for (const p of block.items) {
        const nodesForProperty = nodes.get(p); if (!nodesForProperty) continue;
        const { row, child } = nodesForProperty;
        if (row.zpgBasePadding === undefined) row.zpgBasePadding = parseFloat(row.firstElementChild.style.paddingLeft) || 0;
        row.firstElementChild.style.paddingLeft = row.zpgBasePadding + (block.name ? 15 : 0) + "px";
        row.style.display = collapsed ? "none" : "";
        el.append(row);
        if (child) { child.style.display = collapsed ? "none" : row.querySelector(".collapse")?.classList.contains("collapsed") ? "none" : ""; el.append(child); }
      }
    }
  }
  function syncNative() {
    for (const entry of nativeRows) {
      if (entry.seen && !entry.row.isConnected) { nativeRows.delete(entry); continue; }
      entry.seen ||= entry.row.isConnected;
      const value = api.nativeOwnLock(entry.object);
      entry.button.textContent = value ? "Locked" : "Lock";
      entry.button.title = value ? "Unlock group" : "Lock group";
      entry.button.setAttribute("aria-label", entry.button.title);
      entry.button.setAttribute("aria-pressed", String(value));
    }
  }
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
  api.refresh = () => {
    registerMenu();
    for (const [el, entry] of lists) {
      if (entry.seen && !el.isConnected) { lists.delete(el); continue; }
      entry.seen ||= el.isConnected;
      render(el, entry);
    }
    syncNative();
    if (open && !open.isConnected) close();
  };
  api.propertyMenu = propertyMenu;
  api.groupSettings = settings;
  global.setInterval(api.refresh, 150);
})(window);
