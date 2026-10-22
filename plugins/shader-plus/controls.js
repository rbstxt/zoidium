"use strict";
// Row editors for Shader+ kinds. Every edit goes through CM3's own
// editStart/editFinish on the real property, so history, keyframes and
// expressions behave exactly like native rows. Controls reuse CM3's native
// inputs, option menus and icon buttons wherever one exists.
const { KINDS, MAX_PALETTE, discreteValue, items } = require("./kinds.js");
const { parseJSON, parseText } = require("./bake.js");

function installControls({ PZ, doc, register, editor }) {
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
  function commit(anchor, property, value) {
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
    box.pz_update = frame => { if (doc.activeElement !== select) select.selectedIndex = discreteValue(kind, property.get(frameOf(box, frame)), property.definition); };
    return box;
  }
  register("shader-plus/checkbox", PZ.property.type.NUMBER, property => optionRow(property, "checkbox", () => ["off", "on"]));
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
    range.addEventListener("input", () => { start(); fill(Number(range.value)); property.set(Number(range.value) * scale, box.pz_frame); });
    range.addEventListener("change", () => { if (editing) { editing = false; finish(range, property); } });
    box.append(range);
    const update = box.pz_update;
    box.pz_update = frame => { update.call(box, frame); if (!editing) { range.value = Number(property.get(frame)) / scale; fill(Number(range.value)); } };
    return box;
  });

  register("shader-plus/seed", PZ.property.type.NUMBER, property => {
    const box = native("generateInput")(property);
    box.classList.add("zsp-inline-row");
    const button = iconButton("random", "Randomize seed");
    button.disabled = readOnly(property);
    button.onclick = event => { event.stopPropagation(); commit(button, property, Math.floor(Math.random() * 100000)); };
    box.append(button);
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

  register("shader-plus/palette", PZ.property.type.TEXT, property => {
    const box = editbox("zsp-palette"), swatches = element("div", "zsp-swatches"), anchor = element("span", "zsp-anchor");
    const add = iconButton("add", "Add color"), remove = iconButton("remove", "Remove last color");
    box.append(anchor, swatches);
    let shown = null, editing = false;
    const colors = () => { const list = parseJSON(property.get()).colors; return Array.isArray(list) ? list.slice(0, MAX_PALETTE) : []; };
    const write = list => property.set(JSON.stringify({ ...parseJSON(property.get()), colors: list }));
    function build() {
      const list = colors(); shown = property.get(); swatches.replaceChildren();
      list.forEach((color, index) => {
        const picker = new PZ.ui.colorPicker({ readOnly: false, alpha: true });
        picker.el.classList.add("zsp-swatch"); picker.el.title = "Color " + (index + 1);
        picker.editStart = () => { editing = true; begin(anchor, property); };
        picker.editFinish = () => { finish(anchor, property); editing = false; shown = property.get(); };
        picker.changed = () => { const next = colors(); next[index] = picker.value.slice(0, 4); write(next); };
        picker.update(color.length === 4 ? color : [...color, 1]);
        swatches.append(picker.el);
      });
      swatches.append(add, remove);
      add.disabled = list.length >= MAX_PALETTE; remove.disabled = list.length <= 1;
    }
    add.onclick = event => { event.stopPropagation(); const list = colors(); commit(anchor, property, JSON.stringify({ ...parseJSON(property.get()), colors: [...list, (list[list.length - 1] || [1, 1, 1, 1]).slice()] })); };
    remove.onclick = event => { event.stopPropagation(); commit(anchor, property, JSON.stringify({ ...parseJSON(property.get()), colors: colors().slice(0, -1) })); };
    box.pz_update = () => { if (!editing && property.get() !== shown) build(); };
    build();
    return box;
  });

  register("shader-plus/text", PZ.property.type.TEXT, property => {
    const box = editbox("zsp-text"), anchor = element("span", "zsp-anchor");
    const presets = PZ.asset.font.preset;
    // The same button CM3's Font rows use: dark pz-tweens frame, fonts.png sprite.
    const fontButton = element("button", "pz-tweens zsp-font", { type: "button", title: "font" });
    const sprite = element("span", "zsp-font-sprite");
    fontButton.append(sprite);
    const fontName = element("span", "zsp-font-name");
    fontButton.append(fontName);
    const file = element("input", "", { type: "file", accept: ".ttf,.otf,.woff,font/ttf,font/otf,font/woff" });
    file.hidden = true;
    const text = element("textarea", "pz-inputbox zsp-textarea", { rows: "2", "aria-label": "Text", spellcheck: "false" });
    const grid = element("div", "zsp-fields");
    function labeled(label, control) {
      const name = element("span", "zsp-field-label"); name.textContent = label;
      control.setAttribute("aria-label", label);
      grid.append(name, control); return control;
    }
    const number = (min, max, step) => element("input", "pz-inputbox", { type: "number", min, max, step });
    const raw = () => parseJSON(property.get());
    const write = patch => commit(anchor, property, JSON.stringify({ ...raw(), ...patch }));
    const size = labeled("Size", number("4", "512", "1"));
    const align = labeled("Align", options("Align", [["left", "Left"], ["center", "Center"], ["right", "Right"]], value => write({ align: value })));
    const lineHeight = labeled("Line", number("0.5", "4", "0.05"));
    const letterSpacing = labeled("Spacing", number("-0.5", "2", "0.01"));
    const mode = labeled("Mode", options("Mode", [["layout", "Layout"], ["atlas", "Atlas"]], value => write({ mode: value })));
    const sdf = labeled("SDF", options("SDF", [["off", "off"], ["on", "on"]], value => write({ sdf: value === "on" })));
    lineHeight.title = "Line height"; letterSpacing.title = "Letter spacing (em)";
    mode.title = "Layout: the text as written. Atlas: each character in a grid cell, for zGlyph().";
    sdf.title = "Store a signed distance field in alpha (0.5 at the edge) for outlines and glows";
    box.append(anchor, fontButton, file, text, grid);

    fontButton.onclick = event => { event.stopPropagation(); PZ.editor.showFontDropDown(fontButton); };
    fontButton.pz_set = index => {
      if (index >= 0 && index < presets.length) write({ font: "/assets/fonts/2d/" + presets[index] + ".ttf" });
      else file.click();
    };
    fontButton.pz_update = function () { sprite.style.backgroundPositionY = -25 * this.pz_value + "px"; };
    file.onchange = async () => {
      const chosen = file.files?.[0]; file.value = "";
      if (!chosen) return;
      const asset = await property.parentProject.assets.createFromFile(PZ.asset.type.FONT, chosen);
      write({ font: asset.key });
    };
    text.onchange = () => write({ text: text.value });
    text.addEventListener("keydown", event => event.stopPropagation());
    size.onchange = () => write({ size: Number(size.value) });
    lineHeight.onchange = () => write({ lineHeight: Number(lineHeight.value) });
    letterSpacing.onchange = () => write({ letterSpacing: Number(letterSpacing.value) });
    box.pz_update = () => {
      const value = parseText(property.get());
      const match = value.font && /\/assets\/fonts\/2d\/(.+)\.ttf$/.exec(value.font);
      const index = match ? presets.indexOf(match[1]) : -1;
      fontButton.pz_value = index >= 0 ? index : presets.length;
      fontButton.pz_update();
      sprite.hidden = index < 0;
      const asset = !match && value.font ? property.parentProject?.assets.list[value.font] : null;
      fontName.hidden = index >= 0;
      fontName.textContent = asset?.filename || (value.font ? "Imported font" : "Choose a font");
      if (doc.activeElement !== text) text.value = value.text;
      if (doc.activeElement !== size) size.value = value.size;
      if (doc.activeElement !== lineHeight) lineHeight.value = value.lineHeight;
      if (doc.activeElement !== letterSpacing) letterSpacing.value = value.letterSpacing;
      align.value = value.align; mode.value = value.mode; sdf.value = value.sdf ? "on" : "off";
    };
    return box;
  });

  return { commit, KINDS, options, iconButton };
}

module.exports = { installControls };
