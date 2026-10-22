"use strict";
const { KINDS, ORDER, kindOf, items } = require("./kinds.js");
const clone = value => JSON.parse(JSON.stringify(value));
function installEditor({ context, patch, presetFont }) {
  const { PZ, editor: CM, document: doc, window: win } = context;
  const rows = new Set(), folded = new WeakMap();
  const menu = PZ.ui.objectTypes.get(PZ.property), added = [{ name: "ZOIDIUM", category: true }];
  for (const kind of ORDER) {
    const entry = { name: KINDS[kind].label, desc: KINDS[kind].desc };
    entry.data = function () {
      const p = PZ.property.create(KINDS[kind].create(presetFont())); p.load();
      const base = { checkbox: "Enabled", dropdown: "Mode", staticDropdown: "Static Mode", color4: "Color" }[kind] || KINDS[kind].label;
      const names = new Set();
      CM.project.forEachItemOfType(PZ.effect.shader, effect => { for (const q of effect.customProperties) names.add(q.properties.name.get()); });
      let name = base, suffix = 2; while (names.has(name)) name = base + " " + suffix++;
      p.properties.name.set(name);
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
  function notify(effect) { effect.fragmentShaderNeedsUpdate = true; CM.project.ui?.onChanged?.update(); CM.mainViewport?.requestRender?.(); }
  function snapshot(p) { return { definition: clone(p.definition), name: p.properties.name.get() }; }
  function apply(p, state) {
    for (const key of Object.keys(p.definition)) delete p.definition[key];
    Object.assign(p.definition, clone(state.definition)); p.properties.name.set(state.name);
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
    if (JSON.stringify(before) === JSON.stringify(state)) return;
    CM.history.startOperation();
    try { apply(p, state); CM.history.pushCommand(exchange, { address: p.getAddress(), state: before }); CM.history.finishOperation(); }
    catch (error) { apply(p, before); CM.history.discardOperation(); throw error; }
  }
  function settings(row, p) {
    row.parentElement.querySelector(".zsp-settings")?.remove();
    const panel = doc.createElement("div"); panel.className = "zsp-settings"; panel.setAttribute("aria-label", "Property settings");
    const fields = {}, d = p.definition, meta = d.zoidiumShader || {};
    function field(key, label, value, type = "text") {
      const line = doc.createElement("label"); line.textContent = label;
      const input = doc.createElement(type === "select" ? "select" : "input");
      input.className = "pz-inputbox"; if (type !== "select") input.type = type;
      input.value = value ?? ""; input.setAttribute("aria-label", label); line.append(input); panel.append(line); fields[key] = input; return input;
    }
    field("name", "Name", p.properties.name.get());
    const kind = field("kind", "Kind", "", "select");
    for (const key of ORDER.filter(key => { const candidate = KINDS[key].create(); return candidate.type === d.type && !!candidate.dynamic === !!d.dynamic; })) {
      const option = doc.createElement("option"); option.value = key; option.textContent = KINDS[key].label; kind.append(option);
    }
    kind.value = kindOf(p) || kind.options[0]?.value || "";
    for (const [key, label, value] of [["min", "Minimum", d.min], ["max", "Maximum", d.max], ["step", "Step", d.step], ["default", "Default", meta.default ?? d.value]]) field(key, label, typeof value === "object" ? JSON.stringify(value) : value);
    field("items", "Items (semicolon separated)", items(d).join(";"));
    field("space", "Space (uv or pixels)", meta.space || "uv");
    field("group", "Group", meta.group); field("help", "Help", meta.help);
    field("visibleWhen", "Visible when (JSON)", meta.visibleWhen ? JSON.stringify(meta.visibleWhen) : "");
    const error = doc.createElement("div"); error.setAttribute("role", "status"); panel.append(error);
    const button = doc.createElement("button"); button.textContent = "Apply"; button.className = "pz-inputbox";
    button.onclick = () => {
      try {
        const definition = clone(d), target = KINDS[kind.value]?.create(presetFont());
        if (!target) throw new Error("Choose a compatible property kind");
        delete definition.zoidiumControl;
        for (const key of ["zoidiumControl", "scaleFactor", "decimals"]) { delete definition[key]; if (target[key] !== undefined) definition[key] = target[key]; }
        const next = { ...meta, kind: kind.value, group: fields.group.value, help: fields.help.value };
        for (const key of ["min", "max", "step"]) {
          if (fields[key].value.trim()) { const n = Number(fields[key].value); if (!Number.isFinite(n)) throw new Error("Use finite numeric settings"); definition[key] = n; }
          else delete definition[key];
        }
        if (definition.min > definition.max || definition.step <= 0) throw new Error("Use an ordered range and positive step");
        const value = fields.default.value;
        if (value !== "") { try { next.default = JSON.parse(value); } catch { next.default = value; } }
        if (kind.value === "dropdown") next.items = fields.items.value.split(";").slice(0, 32);
        if (kind.value === "staticDropdown") definition.items = fields.items.value;
        if (kind.value === "point") next.space = fields.space.value === "pixels" ? "pixels" : "uv";
        if (fields.visibleWhen.value.trim()) {
          next.visibleWhen = JSON.parse(fields.visibleWhen.value);
          if (typeof next.visibleWhen.property !== "string" || !Array.isArray(next.visibleWhen.values)) throw new Error("Visible when needs a property name and values array");
        } else delete next.visibleWhen;
        definition.zoidiumShader = next;
        edit(p, { definition, name: fields.name.value }); panel.remove();
      } catch (e) { error.textContent = e.message; }
    };
    const cancel = doc.createElement("button"); cancel.textContent = "Cancel"; cancel.className = "pz-inputbox"; cancel.onclick = () => panel.remove();
    panel.append(button, cancel); panel.addEventListener("keydown", e => e.stopPropagation()); row.after(panel); fields.name.focus();
  }
  function actions(row, p) { return [{ label: "Property settings…", action: () => settings(row, p) }]; }
  patch(PZ.ui.edit.prototype, "generateListItem", original => function shaderPropertyRow(parent, p) {
    const row = original.apply(this, arguments), effect = effectOf(p);
    if (!effect || !this.options.showPropertyControls) return row;
    rows.add({ row, p, effect });
    row.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); context.ui.openMenu({ owner: row, x: event.clientX, y: event.clientY, items: actions(row, p) }); };
    sync(); return row;
  });
  if (win.ZoidiumUI?.registerMenuExtension) context.lifecycle.onDispose(win.ZoidiumUI.registerMenuExtension({ id: "shader-plus/settings", items(options) {
    const row = options?.owner?.closest?.("li"), p = row?.pz_object;
    return effectOf(p) && !options.items?.some(i => i.label === "Property settings…") ? actions(row, p) : [];
  } }));
  function sync() {
    for (const entry of rows) {
      const { row, p, effect } = entry;
      if (!row.isConnected) { if (entry.seenConnected) rows.delete(entry); continue; }
      entry.seenConnected = true;
      const meta = p.definition.zoidiumShader || {}, group = meta.group || "";
      let groups = folded.get(row.parentElement);
      if (!groups) { groups = new Map(); folded.set(row.parentElement, groups); }
      if (group && !groups.has(group)) {
        const heading = doc.createElement("button"); heading.className = "zsp-group"; heading.textContent = group; heading.setAttribute("aria-expanded", "true");
        const state = { heading, collapsed: false }; groups.set(group, state); row.before(heading);
        heading.onclick = () => { state.collapsed = !state.collapsed; heading.setAttribute("aria-expanded", String(!state.collapsed)); sync(); };
      }
      const when = meta.visibleWhen, controller = when && effect.customProperties.find(q => q.properties.name.get() === when.property);
      const frame = CM.playback.currentFrame - p.frameOffset;
      const visible = !when || !!controller && when.values.includes(controller.get(frame));
      row.hidden = !visible || !!groups.get(group)?.collapsed;
      if (row.nextElementSibling?.tagName === "UL" && p.definition.group) row.nextElementSibling.hidden = row.hidden;
      if (meta.help) { row.title = meta.help; row.firstElementChild.title = meta.help; }
    }
  }
  const timer = win.setInterval(sync, 100);
  context.lifecycle.onDispose(() => { win.clearInterval(timer); for (const { row } of rows) { row.hidden = false; row.parentElement?.querySelectorAll(".zsp-group,.zsp-settings").forEach(el => el.remove()); } rows.clear(); });
  // New keys created by the discrete editors use hold. Existing keys and
  // user-selected tweens keep their values, including history replay.
  for (const method of ["startEdit", "toggleKeyframe"]) patch(PZ.ui.properties.prototype, method, original => function discreteKey(p) {
    if (!["checkbox", "dropdown"].includes(kindOf(p))) return original.apply(this, arguments);
    const create = this.createKeyframe;
    this.createKeyframe = function (record) { return create.call(this, { ...record, data: { ...record.data, tween: 0 } }); };
    try { return original.apply(this, arguments); } finally { this.createKeyframe = create; }
  });
  return { settings, edit, effectOf, sync };
}
module.exports = { installEditor };
