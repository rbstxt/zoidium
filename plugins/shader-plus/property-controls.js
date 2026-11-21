"use strict";
// Shared native editors for Shader+ and Shape+ custom properties.
const { discreteValue, items } = require("./kinds.js");
const { snapValue } = require("./snap.js");

function installPropertyControls({ PZ, doc, register, editor }) {
  const C = PZ.ui.controls;
  const native = name => C[name].__zoidiumOriginal || C[name];
  const readOnly = p => !!(p.definition.readOnly || (p.animated && p.expression));
  function element(tag, className, attrs = {}) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    for (const [key, value] of Object.entries(attrs)) if (value !== undefined) el.setAttribute(key, value);
    return el;
  }
  function editbox(extra = "") { return element("div", ("editbox zsp-box " + extra).trim()); }
  // CM3's icon button: the same element the list uses for clone/delete.
  function iconButton(icon, label) {
    const button = element("button", "actionbutton zsp-icon", { type: "button", title: label, "aria-label": label });
    const svg = PZ.ui.generateIcon(icon); svg.setAttribute("aria-hidden", "true"); button.append(svg);
    return button;
  }
  // A native select with fixed labels, for settings stored inside JSON.
  function options(label, entries, change) {
    const select = element("select", "pz-inputbox zsp-option", { "aria-label": label, title: label });
    for (const [value, text] of entries) { const option = element("option", "", { value }); option.textContent = text; select.append(option); }
    select.onchange = () => change(select.value);
    return select;
  }
  // `anchor` must be a direct child of the editbox: CM3 keeps the edit frame
  // on the anchor's parent and finds the list controller from there.
  function begin(anchor, property) { C.editStart.call(anchor, property); return anchor.parentElement.pz_frame; }
  function finish(anchor, property, discard) { C.editFinish.call(anchor, property, discard); }
  function currentProperty(project, property, address) {
    try { return !!project && editor()?.project === project && project.addressLookup(address) === property; }
    catch { return false; } // Native lookup throws when an address no longer exists.
  }
  function commit(anchor, property, value) {
    const project = editor()?.project;
    if (!currentProperty(project, property, property.getAddress())) return false;
    const currentFrame = (editor()?.playback?.currentFrame || 0) - property.frameOffset;
    if (JSON.stringify(property.get(currentFrame)) === JSON.stringify(value)) return false;
    const frame = begin(anchor, property);
    try { property.set(value, frame); } catch (error) { finish(anchor, property, true); throw error; }
    finish(anchor, property);
  }
  const frameOf = (box, frame) => frame ?? ((editor()?.playback?.currentFrame || 0) - (box.pz_property?.frameOffset || 0));

  // Checkbox and Dropdown are CM3's own option menu over the NUMBER value.
  // The proxy only supplies the labels; get/set/address stay the real
  // property's, so history and keyframes are native.
  function optionRow(property, kind, labels) {
    const facade = new Proxy(property, { get(target, key) {
      if (key === "definition") return { ...target.definition, items: labels() };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const box = native("generateOptionInput")(facade), select = box.querySelector("select");
    select.classList.add("zsp-option");
    box.pz_property = property;
    box.pz_update = frame => { if (select.ownerDocument.activeElement !== select) select.selectedIndex = discreteValue(kind, property.get(frameOf(box, frame)), property.definition); };
    return box;
  }
  register("shader-plus/checkbox", PZ.property.type.NUMBER, property => {
    if (property.definition.zoidiumShader?.display !== "checkbox") return optionRow(property, "checkbox", () => ["off", "on"]);
    const box = editbox(), input = element("input", "zsp-checkbox", { type: "checkbox", "aria-label": property.properties.name.get() || "Toggle" });
    input.disabled = readOnly(property);
    input.onclick = event => event.stopPropagation();
    input.onchange = () => { commit(input, property, input.checked ? 1 : 0); box.pz_update(); };
    box.append(input);
    box.pz_update = frame => { input.checked = discreteValue("checkbox", property.get(frameOf(box, frame)), property.definition) === 1; };
    return box;
  });
  register("shader-plus/dropdown", PZ.property.type.NUMBER, property => optionRow(property, "dropdown", () => items(property.definition)));

  register("shader-plus/slider", PZ.property.type.NUMBER, property => {
    const box = native("generateInput")(property);
    box.classList.add("zsp-slider");
    const d = property.definition, scale = d.scaleFactor || 1, min = d.min ?? 0, max = d.max ?? 1;
    const range = element("input", "zsp-range", { type: "range", min, max, step: d.step || "any", "aria-label": "Slider" });
    range.disabled = readOnly(property);
    let editing = false;
    const fill = value => range.style.setProperty("--zsp-fill", (max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) * 100 : 0) + "%");
    const start = () => { if (!editing) { editing = true; begin(range, property); } };
    range.addEventListener("pointerdown", event => { event.stopPropagation(); start(); });
    range.addEventListener("input", () => {
      start();
      // Snap is display units, like Step: the range commits through
      // property.set directly, bypassing the snapped native number input.
      const unsnapped = Number(range.value), snapped = snapValue(unsnapped, property.definition);
      if (snapped !== unsnapped) range.value = String(snapped);
      fill(snapped); property.set(snapped * scale, box.pz_frame);
    });
    range.addEventListener("change", () => { if (editing) { editing = false; finish(range, property); } });
    box.append(range);
    const update = box.pz_update;
    box.pz_update = frame => { update.call(box, frame); if (!editing) { range.value = Number(property.get(frame)) / scale; fill(Number(range.value)); } };
    return box;
  });

  register("shader-plus/color4", PZ.property.type.VECTOR4, property => {
    const box = editbox(), picker = new PZ.ui.colorPicker({ readOnly: readOnly(property), alpha: true });
    box.style.lineHeight = "0";
    box.append(picker.el);
    picker.editStart = C.editStart.bind(picker.el, property);
    picker.editFinish = C.editFinish.bind(picker.el, property);
    picker.changed = () => property.set(picker.value.slice(0, 4), box.pz_frame);
    box.pz_update = frame => picker.update(property.get(frame));
    return box;
  });

  return { C, native, readOnly, element, editbox, iconButton, options, begin, finish, currentProperty, commit };
}
module.exports = { installPropertyControls };
