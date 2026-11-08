"use strict";
const { KINDS, ORDER, kindOf, items, MAX_TIME_SAMPLES } = require("./kinds.js");
const clone = value => JSON.parse(JSON.stringify(value));
const NUMERIC = ["slider", "seed"], OPTIONS = ["dropdown", "staticDropdown"];
const list = text => String(text).split(/[\n;]/).map(s => s.trim()).filter(Boolean);
const { parseConditions, formatConditions, matches } = require("./visibility.js");
const { installReset } = require("./reset.js");
function installEditor({ context, patch, presetFont }) {
  const { PZ, editor: CM, document: doc, window: win } = context;
  const rows = new Set(), connectedRows = new WeakSet();
  const groups = PZ.zoidium?.propertyGroups;
  const { resetCustom } = installReset({ context, patch });
  require("./group-menu.js").installGroupMenu({ context, patch });
  let openPanel = null;
  function uniqueName(base) {
    const names = new Set();
    CM.project.forEachItemOfType(PZ.effect.shader, effect => { for (const q of effect.customProperties) names.add(q.properties.name.get()); });
    let name = base, suffix = 2; while (names.has(name)) name = base + " " + suffix++;
    return name;
  }
  const menu = PZ.ui.objectTypes.get(PZ.property), added = [{ name: "ZOIDIUM", category: true }];
  for (const kind of ORDER.filter(key => !KINDS[key].hidden)) {
    const entry = { name: KINDS[kind].label, desc: KINDS[kind].desc };
    entry.data = function () {
      const p = PZ.property.create(KINDS[kind].create(presetFont())); p.load();
      p.properties.name.set(uniqueName({ checkbox: "Enabled", dropdown: "Mode", staticDropdown: "Static Mode", color4: "Color" }[kind] || KINDS[kind].label));
      if (["checkbox", "dropdown"].includes(kind)) for (const key of p.keyframes) key.tween = 0;
      const data = clone(p);
      if (kind === "staticDropdown" && data.value === 0) data.value = "0";
      return data;
    };
    Object.defineProperty(entry, "type", { get: () => KINDS[kind].create(presetFont()) }); added.push(entry);
  }
  menu.push(...added);
  context.lifecycle.onDispose(() => { for (const entry of added) { const i = menu.indexOf(entry); if (i >= 0) menu.splice(i, 1); } });
  function effectOf(p) { return p?.parent instanceof PZ.objectList && p.parent.parent instanceof PZ.effect.shader ? p.parent.parent : null; }
  function notify(effect) { groups?.refresh?.(CM, effect?.customProperties); effect.fragmentShaderNeedsUpdate = true; CM.project.ui?.onChanged?.update(); CM.mainViewport?.requestRender?.(); }
  function historyDefinition(value) {
    const definition = clone(value), meta = definition.zoidiumPropertyGroup;
    if (meta) { delete meta.collapsed; if (!Object.keys(meta).length) delete definition.zoidiumPropertyGroup; }
    return definition;
  }
  function snapshot(p) { return { definition: historyDefinition(p.definition), name: p.properties.name.get() }; }
  function apply(p, state) {
    const collapsed = groups?.meta(p).collapsed;
    for (const key of Object.keys(p.definition)) delete p.definition[key];
    Object.assign(p.definition, clone(state.definition)); p.properties.name.set(state.name);
    if (groups) {
      const meta = { ...p.definition.zoidiumPropertyGroup }; delete meta.collapsed;
      if (collapsed !== undefined) meta.collapsed = collapsed;
      if (Object.keys(meta).length) p.definition.zoidiumPropertyGroup = meta;
      else delete p.definition.zoidiumPropertyGroup;
    }
    p.parent.onObjectRemoved.update(p, p.parent.indexOf(p));
    p.parent.onObjectAdded.update(p, p.parent.indexOf(p));
    notify(effectOf(p));
  }
  function exchange(command) {
    const p = CM.project.addressLookup(command.address, 0), current = snapshot(p);
    apply(p, command.state); CM.history.pushCommand(exchange, { ...command, state: current });
  }
  function edit(p, state) {
    if (CM.history.operation !== null) throw new Error("Finish the current edit before changing property settings");
    const before = snapshot(p);
    state = { ...state, definition: historyDefinition(state.definition) };
    if (JSON.stringify(before) === JSON.stringify(state)) return;
    CM.history.startOperation();
    try { apply(p, state); CM.history.pushCommand(exchange, { address: p.getAddress(), state: before }); CM.history.finishOperation(); }
    catch (error) { apply(p, before); CM.history.discardOperation(); throw error; }
  }
  function closeSettings() { openPanel?.panel.remove(); openPanel = null; }

  // Property settings open inline under the row, laid out like native
  // property rows: label in the name column, control in the value column.
  function settings(row, p) {
    closeSettings();
    const d = p.definition, meta = d.zoidiumShader || {}, effect = effectOf(p);
    const panel = doc.createElement("div"); panel.className = "zsp-settings"; panel.setAttribute("role", "group"); panel.setAttribute("aria-label", "Property settings");
    const indent = (parseInt(row.firstElementChild?.style.paddingLeft, 10) || 0) + 15;
    const title = doc.createElement("div"); title.className = "zsp-settings-title"; title.style.paddingLeft = indent + "px"; title.textContent = "Property settings";
    const body = doc.createElement("div"), specific = doc.createElement("div"), common = doc.createElement("div");
    body.append(specific, common);
    const fields = {};
    function line(parent, key, label, control) {
      const el = doc.createElement("div"); el.className = "zsp-settings-line"; el.style.gridTemplateColumns = row.style.gridTemplateColumns;
      const name = doc.createElement("span"); name.textContent = label; name.title = label; name.style.paddingLeft = indent + "px";
      const cell = doc.createElement("div"); cell.className = "editbox"; cell.append(control);
      control.setAttribute("aria-label", label); el.append(name, cell); parent.append(el); fields[key] = control; return control;
    }
    function input(parent, key, label, value, type = "text") {
      const el = doc.createElement("input"); el.className = "pz-inputbox"; el.type = type; if (type === "number") el.step = "any";
      el.value = value ?? ""; return line(parent, key, label, el);
    }
    function select(parent, key, label, entries, value) {
      const el = doc.createElement("select"); el.className = "pz-inputbox";
      for (const [v, text] of entries) { const option = doc.createElement("option"); option.value = v; option.textContent = text; el.append(option); }
      el.value = value; if (el.selectedIndex < 0) el.selectedIndex = 0; return line(parent, key, label, el);
    }
    input(body, "name", "Name", p.properties.name.get());
    body.insertBefore(body.lastElementChild, specific);
    const compatible = ORDER.filter(key => { const c = KINDS[key].create(); return (!KINDS[key].hidden || key === kindOf(p)) && c.type === d.type && !!c.dynamic === !!d.dynamic; });
    // Native numbers share Slider's range settings. Other native types keep
    // an explicit entry instead of silently selecting a specialized control.
    const current = kindOf(p) || (d.type === 0 && d.dynamic ? "slider" : "native");
    const choices = compatible.map(key => [key, KINDS[key].label]);
    if (current === "native") choices.unshift(["native", "Native"]);
    const kind = select(body, "kind", "Kind", choices, current);
    body.insertBefore(body.lastElementChild, specific);
    function buildSpecific() {
      for (const key of Object.keys(fields)) if (!["name", "kind"].includes(key) && specific.contains(fields[key])) delete fields[key];
      specific.replaceChildren();
      const k = kind.value, same = k === current;
      if (NUMERIC.includes(k)) {
        input(specific, "min", "Minimum", d.min, "number"); input(specific, "max", "Maximum", d.max, "number");
        input(specific, "step", "Step", d.step, "number"); input(specific, "default", "Default", same ? meta.default ?? d.value : "", "number");
      } else if (k === "timeSample") {
        select(specific, "units", "Offset units", [["frames", "Frames"], ["seconds", "Seconds"]], meta.units || "frames");
      } else if (k === "angle") {
        input(specific, "default", "Default (°)", same && Number.isFinite(meta.default) ? meta.default * 180 / Math.PI : "", "number");
      } else if (k === "checkbox") {
        select(specific, "default", "Default", [["0", "off"], ["1", "on"]], String(same ? meta.default ?? 0 : 0));
        select(specific, "display", "Display", [["menu", "Off/on menu"], ["checkbox", "Checkbox"]], meta.display || "menu");
      } else if (OPTIONS.includes(k)) {
        const area = doc.createElement("textarea"); area.className = "pz-inputbox zsp-settings-options"; area.rows = 4; area.spellcheck = false;
        area.placeholder = "One option per line"; area.value = items(d).join("\n");
        line(specific, "items", "Options", area);
        const def = select(specific, "default", "Default", [], "");
        const refill = () => { const chosen = def.value || String(same ? meta.default ?? 0 : 0); def.replaceChildren(); list(area.value).forEach((label, i) => { const o = doc.createElement("option"); o.value = String(i); o.textContent = label; def.append(o); }); def.value = chosen; if (def.selectedIndex < 0) def.selectedIndex = 0; };
        area.addEventListener("input", refill); refill();
      } else if (k === "point") {
        select(specific, "space", "Space", [["uv", "UV (0–1)"], ["pixels", "Pixels"]], meta.space || "uv");
      } else if (k === "curve") {
        select(specific, "editor", "Editor", [["graph", "Graph"], ["curves", "Curves"]], meta.editor || "graph");
        input(specific, "axis", "Axis labels", Array.isArray(meta.axis) ? meta.axis.join("; ") : "").placeholder = "e.g. Start; Peak; End";
      }
    }
    kind.onchange = buildSpecific; buildSpecific();
    const groupField = input(common, "group", "Group", groups ? groups.name(p) : meta.group);
    if (groups && !groups.canAssign(p, "")) groupField.disabled = true;
    input(common, "help", "Tooltip", meta.help);
    const others = (effect?.customProperties || []).filter(q => q !== p).map(q => q.properties.name.get());
    const when = select(common, "when", "Visible when", [["", "Always"], ...others.map(n => [n, n])], meta.visibleWhen?.property || "");
    const values = input(common, "whenValues", "Has value", formatConditions(meta.visibleWhen));
    values.placeholder = "e.g. > 5.5; 1..5; != 3";
    const initialWhen = when.value, initialValues = values.value;
    const syncWhen = () => { values.closest(".zsp-settings-line").hidden = !when.value; };
    when.addEventListener("change", syncWhen); syncWhen();
    const error = doc.createElement("div"); error.className = "zsp-settings-error"; error.setAttribute("role", "status"); error.style.paddingLeft = indent + "px";
    const actionsRow = doc.createElement("div"); actionsRow.className = "zsp-settings-actions";
    const cancel = doc.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel"; cancel.className = "zsp-settings-button";
    const ok = doc.createElement("button"); ok.type = "button"; ok.textContent = "Apply"; ok.className = "zsp-settings-button zsp-settings-primary";
    actionsRow.append(cancel, ok);
    cancel.onclick = closeSettings;
    function number(key) {
      const text = fields[key]?.value?.trim?.() ?? "";
      if (!text) return undefined;
      const n = Number(text); if (!Number.isFinite(n)) throw new Error("Use finite numbers"); return n;
    }
    const fieldState = () => JSON.stringify(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])));
    const initialFields = fieldState();
    ok.onclick = () => {
      try {
        if (fieldState() === initialFields) { closeSettings(); return; }
        const definition = clone(d), changedKind = kind.value !== current;
        const target = KINDS[kind.value]?.create(presetFont());
        if (!target && kind.value !== "native") throw new Error("Choose a compatible property kind");
        if (changedKind) for (const key of ["zoidiumControl", "scaleFactor", "decimals"]) {
          delete definition[key]; if (target?.[key] !== undefined) definition[key] = target[key];
        }
        const next = { ...meta };
        if (changedKind) {
          next.kind = kind.value;
          for (const key of ["default", "items", "space", "editor", "axis", "units", "display"]) delete next[key];
        }
        if (NUMERIC.includes(kind.value)) {
          for (const key of ["min", "max", "step"]) { const n = number(key); if (n === undefined) delete definition[key]; else definition[key] = n; }
          if (definition.min > definition.max || definition.step <= 0) throw new Error("Use an ordered range and a positive step");
          const def = number("default"); if (def !== undefined) { next.default = def; definition.value = def; }
        } else if (kind.value === "timeSample") {
          if (current !== "timeSample" && effect.customProperties.filter(q => kindOf(q) === "timeSample").length >= MAX_TIME_SAMPLES) throw new Error("Shader+ supports at most four Time sample properties per effect");
          next.units = fields.units.value;
          if (current !== "timeSample") { delete definition.min; delete definition.max; }
          definition.step = next.units === "seconds" ? 0.01 : 1;
        } else if (kind.value === "angle") {
          const def = number("default"); if (def !== undefined) { next.default = def * Math.PI / 180; definition.value = next.default; }
        } else if (kind.value === "checkbox") {
          next.default = Number(fields.default.value) ? 1 : 0;
          next.display = fields.display.value;
        } else if (OPTIONS.includes(kind.value)) {
          const labels = list(fields.items.value).slice(0, 32);
          if (!labels.length) throw new Error("Add at least one option");
          next.default = Number(fields.default.value) || 0;
          if (kind.value === "dropdown") next.items = labels; else definition.items = labels.join(";");
        } else if (kind.value === "point") next.space = fields.space.value === "pixels" ? "pixels" : "uv";
        else if (kind.value === "curve") {
          next.editor = fields.editor.value;
          const axis = list(fields.axis.value);
          if (axis.length && (axis.length < 2 || axis.length > 3)) throw new Error("Axis labels need two or three names");
          if (axis.length) next.axis = axis;
        }
        for (const key of ["group", "help"]) { const v = fields[key].value.trim(); if (v) next[key] = v; else delete next[key]; }
        if (when.value) {
          if (when.value !== initialWhen || values.value !== initialValues) next.visibleWhen = { property: when.value, ...parseConditions(values.value) };
        } else delete next.visibleWhen;
        const name = fields.name.value.trim();
        if (!name) throw new Error("Enter a name");
        const group = fields.group.value.trim();
        if (groups && group !== groups.name(p)) {
          if (!groups.canAssign(p, group)) throw new Error("Unlock the group before moving its properties");
          definition.zoidiumPropertyGroup = { ...definition.zoidiumPropertyGroup, name: group };
        }
        if (Object.keys(next).length) definition.zoidiumShader = next;
        else delete definition.zoidiumShader;
        closeSettings(); edit(p, { definition, name });
      } catch (e) { error.textContent = e.message; }
    };
    panel.append(title, body, error, actionsRow);
    panel.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); closeSettings(); }
      else if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); ok.click(); }
    });
    row.after(panel); openPanel = { row, p, panel }; fields.name.focus(); fields.name.select();
  }

  function duplicate(view, p) {
    const address = p.getAddress(), data = clone(p);
    data.properties = { ...data.properties, name: uniqueName(p.properties.name.get()) };
    const command = { newParentAddress: address, newIdx: address.pop() + 1, baseType: p.parent.type, subType: p.type, data };
    CM.history.startOperation(); view.createObject(command); CM.history.finishOperation();
  }
  function remove(view, p) {
    if (openPanel?.p === p) closeSettings();
    const address = p.getAddress(), command = { oldParentAddress: address, oldIdx: address.pop() };
    CM.history.startOperation(); view.deleteObject(command); CM.history.finishOperation();
  }
  function actions(view, row, p) {
    return [
      { label: "Rename", action: () => { view.renameClick({ currentTarget: row, preventDefault() {} }); row.querySelector("input.rename")?.select(); } },
      { label: "Duplicate", action: () => duplicate(view, p) },
      { label: "Delete", action: () => remove(view, p) },
      { separator: true },
      ...(groups?.propertyMenu?.(view, row, p) || []),
      { label: "Property settings…", action: () => settings(row, p) },
    ];
  }
  patch(PZ.ui.edit.prototype, "generateListItem", original => function shaderPropertyRow(parent, p) {
    const row = original.apply(this, arguments), effect = effectOf(p);
    if (!effect || !this.options.showPropertyControls) return row;
    const view = this;
    row.classList.add("zsp-property");
    rows.add(new WeakRef(row));
    row.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); context.ui.openMenu({ owner: row, x: event.clientX, y: event.clientY, items: actions(view, row, p) }); };
    sync(); return row;
  });
  if (win.ZoidiumUI?.registerMenuExtension) context.lifecycle.onDispose(win.ZoidiumUI.registerMenuExtension({ id: "shader-plus/settings", items(options) {
    const row = options?.owner?.closest?.("li"), p = row?.pz_object;
    return effectOf(p) && !options.items?.some(i => i.label === "Property settings…") ? [{ label: "Property settings…", action: () => settings(row, p) }] : [];
  } }));
  function sync() {
    if (openPanel && (!openPanel.row.isConnected || !effectOf(openPanel.p))) closeSettings();
    for (const ref of rows) {
      const row = ref.deref();
      if (!row) { rows.delete(ref); continue; }
      if (!row.isConnected) { if (connectedRows.has(row)) rows.delete(ref); continue; }
      connectedRows.add(row);
      const p = row.pz_object, effect = effectOf(p);
      if (!effect) { rows.delete(ref); continue; }
      const meta = p.definition.zoidiumShader || {};
      const when = meta.visibleWhen, controller = when && effect.customProperties.find(q => q.properties.name.get() === when.property);
      const visible = !when || !!controller && matches(when, controller.get(CM.playback.currentFrame - p.frameOffset));
      row.hidden = !visible;
      if (row.nextElementSibling?.tagName === "UL" && p.definition.group) row.nextElementSibling.hidden = row.hidden;
      if (meta.help) { row.title = meta.help; row.firstElementChild.title = meta.help; }
    }
  }
  const timer = win.setInterval(sync, 100);
  context.lifecycle.onDispose(() => { win.clearInterval(timer); closeSettings(); for (const ref of rows) { const row = ref.deref(); if (!row) continue; row.hidden = false; row.parentElement?.querySelectorAll(".zsp-settings").forEach(el => el.remove()); } rows.clear(); });
  // New keys created by the discrete editors use hold. Existing keys and
  // user-selected tweens keep their values, including history replay.
  for (const method of ["startEdit", "toggleKeyframe"]) patch(PZ.ui.properties.prototype, method, original => function discreteKey(p) {
    if (!["checkbox", "dropdown"].includes(kindOf(p))) return original.apply(this, arguments);
    const create = this.createKeyframe;
    this.createKeyframe = function (record) { return create.call(this, { ...record, data: { ...record.data, tween: 0 } }); };
    try { return original.apply(this, arguments); } finally { this.createKeyframe = create; }
  });
  return { settings, edit, effectOf, sync, resetCustom };
}
module.exports = { installEditor };
