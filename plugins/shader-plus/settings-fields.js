"use strict";

function settingsFields(doc, row, indent) {
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
  return { fields, line, input, select };
}

module.exports = { settingsFields };
