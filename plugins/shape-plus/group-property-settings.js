"use strict";
const { KINDS, kindOf, items, MAX_ITEMS } = require("../shader-plus/kinds.js");
const { parseConditions, formatConditions } = require("../shader-plus/visibility.js");
const { settingsFields } = require("../shader-plus/settings-fields.js");
const { KINDS_IN_ORDER, definitionFor } = require("./group-properties.js");

const DEGREES = Math.PI / 180;
const choices = labels => labels.map((label, index) => [String(index), label]);
const readItems = text => text.split(/[;\n]/).map(item => item.trim()).filter(Boolean);

function openSettings(row, group, property, apply, close) {
  const doc = row.ownerDocument, current = kindOf(property);
  const source = property?.definition, metadata = source?.zoidiumShapeGroup;
  const panel = doc.createElement("div");
  panel.className = "zsp-settings";
  panel.setAttribute("role", "group");
  const title = doc.createElement("div");
  title.className = "zsp-settings-title";
  title.textContent = property ? "Property settings" : "Add group property";
  panel.setAttribute("aria-label", title.textContent);
  const indent = (parseInt(row.firstElementChild.style.paddingLeft, 10) || 0) + 15;
  title.style.paddingLeft = indent + "px";
  panel.append(title);

  const { fields, input, select, line } = settingsFields(doc, row, indent);
  const name = input(panel, "name", "Name", property?.properties.name.get() || "");
  name.placeholder = "Property name";
  const kinds = KINDS_IN_ORDER.filter(kind => !source || KINDS[kind].create().type === source.type);
  const kind = select(panel, "kind", "Kind", kinds.map(kind => [kind, KINDS[kind].label]), current || "slider");
  const options = doc.createElement("div");
  panel.append(options);

  const id = metadata?.id || "p" + crypto.randomUUID();
  let definition;
  function showKind() {
    options.replaceChildren();
    definition = kind.value === current ? JSON.parse(JSON.stringify(source)) : definitionFor(kind.value, id);
    const number = (key, label, value) => input(options, key, label, value, "number");
    switch (kind.value) {
      case "slider":
        number("min", "Minimum", definition.min);
        number("max", "Maximum", definition.max);
        number("step", "Step", definition.step);
        number("value", "Default", definition.value);
        break;
      case "angle":
        number("value", "Default (°)", definition.value / DEGREES);
        break;
      case "checkbox":
        select(options, "value", "Default", choices(["off", "on"]), String(definition.value));
        select(options, "display", "Display", [["menu", "Off/on menu"], ["checkbox", "Checkbox"]], definition.zoidiumShader.display || "menu");
        break;
      case "dropdown": {
        const area = doc.createElement("textarea");
        area.className = "pz-inputbox zsp-settings-options";
        area.rows = 3;
        area.placeholder = "One option per line";
        area.value = items(definition).join("\n");
        line(options, "items", "Options", area);
        const value = select(options, "value", "Default", [], "");
        const refill = () => {
          const selected = value.value || String(definition.value);
          value.replaceChildren(...choices(readItems(area.value)).map(([value, label]) => {
            const option = doc.createElement("option");
            option.value = value; option.textContent = label;
            return option;
          }));
          value.value = selected;
          if (value.selectedIndex < 0) value.selectedIndex = 0;
        };
        area.oninput = refill;
        refill();
        break;
      }
      case "point":
      case "color4":
        for (const axis of definition.objects) number(axis.name, "Default " + axis.name, axis.value);
        break;
    }
  }
  kind.onchange = showKind;
  showKind();
  input(panel, "help", "Tooltip", metadata?.help);
  const controllers = Array.from(group.groupProperties || []).filter(p => p !== property && !p.definition.group);
  const when = select(panel, "when", "Visible when", [["", "Always"], ...controllers.map(p => [
    p.definition.zoidiumShapeGroup.id, p.properties.name.get(),
  ])], metadata?.visibleWhen?.property || "");
  const condition = input(panel, "condition", "Has value", formatConditions(metadata?.visibleWhen));
  condition.placeholder = "e.g. > 5.5; 1..5; != 3";
  const sync = () => { condition.closest(".zsp-settings-line").hidden = !when.value; };
  when.onchange = sync;
  sync();

  const error = doc.createElement("div"), actions = doc.createElement("div");
  error.className = "zsp-settings-error";
  error.setAttribute("role", "status");
  error.style.paddingLeft = indent + "px";
  actions.className = "zsp-settings-actions";
  const button = (label, primary = false) => {
    const element = doc.createElement("button");
    element.type = "button";
    element.className = "zsp-settings-button" + (primary ? " zsp-settings-primary" : "");
    element.textContent = label;
    actions.append(element);
    return element;
  };
  const cancel = button("Cancel"), save = button(property ? "Apply" : "Add", true);
  panel.append(error, actions);
  cancel.onclick = close;
  save.onclick = () => {
    try {
      const label = name.value.trim();
      if (!label) throw Error("Enter a name");
      const number = key => {
        const field = fields[key], value = Number(field.value);
        if (!field.value.trim() || !Number.isFinite(value)) throw Error("Enter a number for " + field.getAttribute("aria-label"));
        return value;
      };
      const next = JSON.parse(JSON.stringify(definition));
      if (next.group) {
        for (const axis of next.objects) {
          axis.value = number(axis.name);
          if (axis.value < axis.min || axis.value > axis.max) throw Error("Color channels must be between 0 and 1");
        }
      } else {
        if (kind.value === "dropdown") {
          const labels = readItems(fields.items.value);
          if (!labels.length || labels.length > MAX_ITEMS) throw Error("Enter between 1 and " + MAX_ITEMS + " options");
          next.zoidiumShader.items = labels;
        }
        next.value = number("value");
        if (kind.value === "angle") next.value *= DEGREES;
        if (kind.value === "checkbox") next.zoidiumShader.display = fields.display.value;
        if (kind.value === "slider") {
          for (const key of ["min", "max", "step"]) next[key] = number(key);
          if (next.max < next.min || next.step <= 0) throw Error("Use an ordered range and a positive step");
          if (next.value < next.min || next.value > next.max) throw Error("The default must be within the range");
        }
      }
      next.zoidiumShapeGroup = { id };
      const help = fields.help.value.trim();
      if (help) next.zoidiumShapeGroup.help = help;
      if (when.value) next.zoidiumShapeGroup.visibleWhen = { property: when.value, ...parseConditions(condition.value) };
      apply(next, label);
      close();
    } catch (failure) { error.textContent = failure.message; }
  };
  panel.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Enter" && event.target.tagName === "INPUT") { event.preventDefault(); save.click(); }
  });
  row.before(panel);
  name.focus();
  name.select();
  return panel;
}

module.exports = { openSettings };
