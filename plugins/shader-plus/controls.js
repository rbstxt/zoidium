"use strict";
// Row editors for Shader+ kinds. Every edit goes through CM3's own
// editStart/editFinish on the real property, so history, keyframes and
// expressions behave exactly like native rows.
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

  register("shader-plus/checkbox", PZ.property.type.NUMBER, property => {
    const box = editbox(), input = element("input", "zsp-check", { type: "checkbox", "aria-label": "On" });
    input.disabled = readOnly(property);
    input.onchange = () => commit(input, property, input.checked ? 1 : 0);
    box.append(input);
    box.pz_update = frame => { input.checked = discreteValue("checkbox", property.get(frameOf(box, frame)), property.definition) === 1; };
    box.pz_property = property;
    return box;
  });

  register("shader-plus/dropdown", PZ.property.type.NUMBER, property => {
    const box = editbox(), select = element("select", "pz-inputbox zsp-select");
    select.disabled = readOnly(property);
    for (const label of items(property.definition)) { const option = element("option"); option.textContent = label; select.append(option); }
    select.onchange = () => commit(select, property, select.selectedIndex);
    box.append(select);
    box.pz_update = frame => { if (doc.activeElement !== select) select.selectedIndex = discreteValue("dropdown", property.get(frameOf(box, frame)), property.definition); };
    box.pz_property = property;
    return box;
  });

  register("shader-plus/slider", PZ.property.type.NUMBER, property => {
    const box = native("generateInput")(property);
    const d = property.definition, scale = d.scaleFactor || 1;
    const range = element("input", "zsp-range", { type: "range", min: d.min ?? 0, max: d.max ?? 1, step: d.step || "any", "aria-label": "Slider" });
    range.disabled = readOnly(property);
    let editing = false;
    const start = () => { if (!editing) { editing = true; begin(range, property); } };
    range.addEventListener("pointerdown", start);
    range.addEventListener("input", () => { start(); property.set(Number(range.value) * scale, box.pz_frame); });
    range.addEventListener("change", () => { if (editing) { editing = false; finish(range, property); } });
    box.append(range);
    const update = box.pz_update;
    box.pz_update = frame => { update.call(box, frame); if (!editing) range.value = Number(property.get(frame)) / scale; };
    return box;
  });

  register("shader-plus/seed", PZ.property.type.NUMBER, property => {
    const box = native("generateInput")(property);
    const button = element("button", "zsp-button", { type: "button", title: "Randomize seed", "aria-label": "Randomize seed" });
    button.textContent = "Random";
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
    const add = element("button", "zsp-button", { type: "button", title: "Add color" }), remove = element("button", "zsp-button", { type: "button", title: "Remove last color" });
    add.textContent = "+"; remove.textContent = "−";
    box.append(anchor, swatches, add, remove);
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
    const fontButton = element("button", "pz-tweens zsp-font", { type: "button", title: "font" });
    const sprite = element("span", "zsp-font-sprite");
    fontButton.append(sprite);
    const fontName = element("span", "zsp-font-name");
    const file = element("input", "", { type: "file", accept: ".ttf,.otf,.woff,font/ttf,font/otf,font/woff" });
    file.hidden = true;
    const text = element("textarea", "pz-inputbox zsp-textarea", { rows: "2", "aria-label": "Text", spellcheck: "false" });
    const options = element("div", "zsp-text-options");
    const size = element("input", "pz-inputbox zsp-number", { type: "number", min: "4", max: "512", step: "1", title: "Size (px)", "aria-label": "Size" });
    const align = element("select", "pz-inputbox", { title: "Alignment", "aria-label": "Alignment" });
    for (const value of ["left", "center", "right"]) { const o = element("option", "", { value }); o.textContent = value[0].toUpperCase() + value.slice(1); align.append(o); }
    const mode = element("select", "pz-inputbox", { title: "Layout: the text as written. Atlas: each character in a grid cell, for zGlyph().", "aria-label": "Mode" });
    for (const [value, label] of [["layout", "Layout"], ["atlas", "Atlas"]]) { const o = element("option", "", { value }); o.textContent = label; mode.append(o); }
    const sdfLabel = element("label", "zsp-inline", { title: "Store a signed distance field in alpha (0.5 at the edge) for outlines and glows" });
    const sdf = element("input", "", { type: "checkbox" });
    sdfLabel.append(sdf, doc.createTextNode("SDF"));
    const lineHeight = element("input", "pz-inputbox", { type: "number", min: "0.5", max: "4", step: "0.05", title: "Line height", "aria-label": "Line height" });
    const letterSpacing = element("input", "pz-inputbox", { type: "number", min: "-0.5", max: "2", step: "0.01", title: "Letter spacing (em)", "aria-label": "Letter spacing" });
    options.append(size, align, mode, lineHeight, letterSpacing, sdfLabel);
    box.append(anchor, fontButton, fontName, file, text, options);

    const raw = () => parseJSON(property.get());
    const write = patch => commit(anchor, property, JSON.stringify({ ...raw(), ...patch }));
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
    align.onchange = () => write({ align: align.value });
    mode.onchange = () => write({ mode: mode.value });
    sdf.onchange = () => write({ sdf: sdf.checked });
    box.pz_update = () => {
      const value = parseText(property.get());
      const match = value.font && /\/assets\/fonts\/2d\/(.+)\.ttf$/.exec(value.font);
      const index = match ? presets.indexOf(match[1]) : -1;
      fontButton.pz_value = index >= 0 ? index : presets.length;
      fontButton.pz_update();
      sprite.hidden = index < 0;
      const asset = !match && value.font ? property.parentProject?.assets.list[value.font] : null;
      fontName.textContent = index >= 0 ? "" : asset?.filename || (value.font ? "Imported font" : "Choose a font");
      if (doc.activeElement !== text) text.value = value.text;
      if (doc.activeElement !== size) size.value = value.size;
      if (doc.activeElement !== lineHeight) lineHeight.value = value.lineHeight;
      if (doc.activeElement !== letterSpacing) letterSpacing.value = value.letterSpacing;
      align.value = value.align; mode.value = value.mode; sdf.checked = value.sdf;
    };
    return box;
  });

  return { commit, KINDS };
}

module.exports = { installControls };
