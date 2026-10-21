"use strict";
const { KINDS } = require("./controls.js");
function installControlsUI({ context, store, patch }) {
  const { PZ, document: doc, editor: CM } = context;
  const ui = context.ui;
  const refresh = () => { if (CM.project?.ui) CM.project.ui.dirty = true; CM.mainViewport?.requestRender?.(); };
  function resolve(address) { return CM.project.addressLookup(address, 0); }
  function exchange(command) {
    const sequence = resolve(command.address), current = store.snapshot(sequence);
    store.restore(sequence, command.data);
    CM.history.pushCommand(exchange, { ...command, data: current }); refresh();
  }
  function edit(sequence, work) {
    if (CM.history.operation !== null) throw new Error("Finish the current edit before changing controls");
    const before = store.snapshot(sequence);
    CM.history.startOperation();
    try {
      work();
      if (JSON.stringify(before) === JSON.stringify(store.snapshot(sequence))) { CM.history.discardOperation(); return; }
      CM.history.pushCommand(exchange, { address: sequence.getAddress(), data: before });
      CM.history.finishOperation(); refresh();
    } catch (error) { store.restore(sequence, before); CM.history.discardOperation(); throw error; }
  }
  function safe(work) { try { work(); } catch (error) { ui.notify({ title: "Sequence Controls", message: error.message }); } }
  function inline(row, fields, commit) {
    const line = doc.createElement("li");line.className = "proprow";
    const inputs = fields.map(field => {
      const input = doc.createElement("input"); input.className = "pz-inputbox";input.type = field.type || "text";
      input.value = field.value;input.setAttribute("aria-label", field.label);input.title = field.label;
      input.style.width = fields.length === 1 ? "95%" : "30%";
      line.appendChild(input); return input;
    });
    const done = () => { safe(() => commit(inputs.map(input => input.value))); line.remove(); };
    line.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Enter") done(); if (event.key === "Escape") line.remove(); });
    const button = doc.createElement("button");button.textContent = "Apply";button.className = "proprow propbutton";button.onclick = done;line.appendChild(button);
    const after = row.nextElementSibling?.tagName === "UL" ? row.nextElementSibling : row;
    after.after(line); inputs[0].focus(); inputs[0].select();
  }
  function addMenu(anchor, sequence) {
    ui.openMenu({ anchor, owner: anchor.closest("ul"), title: "Add control", items: Object.keys(KINDS).map(kind => ({ label: kind, action: () => safe(() => edit(sequence, () => store.add(sequence, kind))) })) });
  }
  function controlItems(row, p) {
    const sequence = store.sequenceOf(p), list = store.list(sequence), index = list.indexOf(p);
    const items = [
      { label: "Rename…", action: () => inline(row, [{ label: "Control name", value: store.label(p) }], ([name]) => edit(sequence, () => store.rename(sequence, p, name))) },
      { label: "Move up", disabled: index === 0, action: () => safe(() => edit(sequence, () => store.move(sequence, p, -1))) },
      { label: "Move down", disabled: index === list.length - 1, action: () => safe(() => edit(sequence, () => store.move(sequence, p, 1))) },
    ];
    if (p.definition.zoidiumControlKind === "Slider") items.push({ label: "Slider settings…", action: () => inline(row,
      ["min", "max", "step"].map(key => ({ label: key, value: p.definition[key], type: "number" })), values => edit(sequence, () => {
        const [min, max, step] = values.map(Number);
        if (![min, max, step].every(Number.isFinite) || max < min || step <= 0) throw new Error("Use a finite range and a positive step");
        Object.assign(p.definition, { min, max, step });
      })) });
    items.push({ separator: true }, { label: "Remove control", action: () => safe(() => edit(sequence, () => store.remove(sequence, p))) });
    return items;
  }
  function controlMenu(row, p, event) {
    ui.openMenu({ x: event.clientX, y: event.clientY, owner: row, title: store.label(p), items: controlItems(row, p) });
  }
  function sequenceOf(p) { try { return p.tryGetParentOfType(PZ.sequence); } catch { return CM.sequence; } }
  function linkItems(row, p, event) {
    const sequence = sequenceOf(p);
    const controls = Array.from(store.list(sequence)).filter(c => store.compatible(p, c));
    return [{ label: "Link to control…", disabled: !controls.length, action: () => ui.openMenu({ x: event.clientX, y: event.clientY, owner: row, title: "Compatible controls", items: controls.map(c => ({ label: store.label(c), action: () => safe(() => {
      if (CM.history.operation !== null) throw new Error("Finish the current edit before linking a control");
      CM.history.startOperation();
      try { new PZ.ui.properties(CM).setExpression({ property: p.getAddress(), expression: "control(" + JSON.stringify(store.label(c)) + ", " + JSON.stringify(c.definition.zoidiumControlId) + ")" }); CM.history.finishOperation(); refresh(); }
      catch (error) { CM.history.discardOperation(); throw error; }
    }) })) }) }];
  }
  function linkMenu(row, p, event) {
    ui.openMenu({ x: event.clientX, y: event.clientY, owner: row, items: linkItems(row, p, event) });
  }
  patch(PZ.ui.edit.prototype, "generatePropertyList", original => function propertyListWithControls(row, properties) {
    const result = original.apply(this, arguments);
    if (!(properties.parent instanceof PZ.sequence) || properties !== properties.parent.properties || !this.options.showPropertyControls) return result;
    const list = row.nextElementSibling, originalChanged = list.pz_listChanged;
    properties.onListChanged.unwatch(originalChanged);
    list.pz_listChanged = () => { originalChanged(); this.generateListItem(list, store.list(properties.parent)); };
    properties.onListChanged.watch(list.pz_listChanged, true);
    return result;
  });
  patch(PZ.ui.edit.prototype, "generateListItem", original => function listItemWithControls(parent, target) {
    const row = original.apply(this, arguments);
    const sequence = store.sequenceOfList(target);
    if (sequence && this.options.showPropertyControls) {
      row.querySelector('button[title="add"]')?.remove();
      const button = this.generateButton("add");button.title = "Add control…";button.onclick = event => { event.stopPropagation(); addMenu(button, sequence); };
      row.children[1].appendChild(button);
    } else if (store.isControl(target)) row.oncontextmenu = event => { event.preventDefault();event.stopPropagation();controlMenu(row, target, event); };
    else if (target instanceof PZ.property.dynamic && [0, 1, 2, 3, 4, 6].includes(target.definition.type) && this.options.showPropertyControls) row.oncontextmenu = event => {
      event.preventDefault();event.stopPropagation();linkMenu(row, target, event);
    };
    return row;
  });
  // Graph Editor 2 handles contextmenu during document capture, before native
  // row handlers. Add our actions to its shared menu without changing that
  // plugin's selection/focus behavior or replacing its Graph command.
  const kit = context.window?.ZoidiumUI;
  if (kit?.registerMenuExtension) context.lifecycle.onDispose(kit.registerMenuExtension({ id: "expressions-plus/controls", items(options) {
    const row = options?.owner?.closest?.("li"), target = row?.pz_object;
    if (target instanceof PZ.property.dynamic && options.items?.some(item => item.label === "Show in Graph Editor")) {
      const additions = store.isControl(target) ? controlItems(row, target) : [0, 1, 2, 3, 4, 6].includes(target.definition.type) ? linkItems(row, target, { clientX: options.x, clientY: options.y }) : [];
      if (additions.length) return [{ separator: true }, ...additions];
    }
    return [];
  } }));
  return { edit, addMenu, linkMenu };
}
module.exports = { installControlsUI };
