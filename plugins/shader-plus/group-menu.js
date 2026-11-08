"use strict";
function installGroupMenu({ context, patch }) {
  const { PZ, editor, document: doc } = context, groups = PZ.zoidium?.propertyGroups;
  if (!groups) return;
  let open;
  const close = () => { open?.remove(); open = null; };
  context.lifecycle.onDispose(close);
  patch(PZ.ui.edit.prototype, "generateAdd", original => function (list) {
    if (!(list?.parent instanceof PZ.effect.shader) || list.parent.customProperties !== list) return original.apply(this, arguments);
    const selected = Array.from(this.el.querySelectorAll(".selected"), row => row.pz_object).filter(p => p instanceof PZ.property && p.parent === list);
    const menu = PZ.ui.objectTypes.get(list.type), entry = { name: "Group", desc: "Move selected properties into a new group." };
    PZ.ui.objectTypes.set(list.type, [...menu, entry]);
    let result;
    try { result = original.apply(this, arguments); } finally { PZ.ui.objectTypes.set(list.type, menu); }
    const picker = this.el.lastElementChild, item = Array.from(picker.querySelectorAll("li")).find(row => row.pz_item === entry);
    item.onclick = event => {
      event.stopPropagation(); picker.firstElementChild.click(); close();
      const anchor = Array.from(this.el.querySelectorAll("li")).find(row => row.pz_object === list);
      if (!anchor) return;
      const panel = doc.createElement("div"); panel.className = "zpg-settings"; panel.setAttribute("role", "group"); panel.setAttribute("aria-label", "Create property group");
      const label = doc.createElement("label"), text = doc.createElement("span"), input = doc.createElement("input");
      text.textContent = "Name"; input.type = "text"; input.className = "pz-inputbox"; input.setAttribute("aria-label", "Group name"); label.append(text, input);
      const error = doc.createElement("div"); error.className = "zpg-settings-error"; error.setAttribute("role", "status");
      const actions = doc.createElement("div"); actions.className = "zpg-settings-actions";
      const cancel = doc.createElement("button"), apply = doc.createElement("button"); cancel.textContent = "Cancel"; apply.textContent = "Apply";
      cancel.className = apply.className = "pz-inputbox"; cancel.onclick = close;
      apply.onclick = () => {
        const name = input.value.trim();
        if (!selected.length) { error.textContent = "Select property rows before choosing Group"; return; }
        if (!name) { error.textContent = "Enter a group name"; return; }
        if (groups.members(list, name).length) { error.textContent = "A group already uses this name"; return; }
        if (selected.some(p => p.parent !== list || !groups.canAssign(p, name))) { error.textContent = "Unlock the group before moving its properties"; return; }
        if (editor.history.operation !== null) { error.textContent = "Finish the current edit first"; return; }
        groups.setGroup(editor, selected, name); close();
      };
      actions.append(cancel, apply); panel.append(label, error, actions); anchor.after(panel); open = panel;
      panel.addEventListener("mousedown", event => event.stopPropagation());
      panel.addEventListener("keydown", event => { event.stopPropagation(); if (event.key === "Escape") close(); if (event.key === "Enter") { event.preventDefault(); apply.click(); } });
      input.focus();
    };
    return result;
  });
}
module.exports = { installGroupMenu };
