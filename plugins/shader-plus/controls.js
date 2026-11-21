"use strict";
// Row editors for Shader+ kinds. Every edit goes through CM3's own
// editStart/editFinish on the real property, so history, keyframes and
// expressions behave exactly like native rows. Controls reuse CM3's native
// inputs, option menus and icon buttons wherever one exists.
const { KINDS, MAX_PALETTE } = require("./kinds.js");
const { parseJSON, parseText } = require("./bake.js");
const { snapValue } = require("./snap.js");
const { installPropertyControls } = require("./property-controls.js");

function installControls({ PZ, doc, register, editor }) {
  const { native, readOnly, element, editbox, iconButton, options, begin, finish, currentProperty, commit } =
    installPropertyControls({ PZ, doc, register, editor });

  register("shader-plus/seed", PZ.property.type.NUMBER, property => {
    const box = native("generateInput")(property);
    box.classList.add("zsp-inline-row");
    const button = iconButton("random", "Randomize seed");
    button.disabled = readOnly(property);
    button.onclick = event => { event.stopPropagation(); commit(button, property, snapValue(Math.floor(Math.random() * 100000), property.definition)); };
    box.append(button);
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
    // Descriptor dispatch for the project-font picker (see
    // plugins/core/font-picker.js): the rebuilt dropdown calls this with
    // {kind:"preset",index} | {kind:"project",key} | {kind:"custom"}
    // instead of a raw row index, so project rows select correctly.
    fontButton.pz_setDescriptor = descriptor => {
      if (!descriptor || descriptor.kind === "custom") { file.click(); return; }
      if (descriptor.kind === "preset" && descriptor.index >= 0 && descriptor.index < presets.length) {
        write({ font: "/assets/fonts/2d/" + presets[descriptor.index] + ".ttf" });
        return;
      }
      if (descriptor.kind === "project" && descriptor.key) write({ font: descriptor.key });
    };
    fontButton._zoidiumFontValue = () => {
      try {
        const value = parseText(property.get());
        return value.font || null;
      } catch { return null; }
    };
    fontButton.pz_update = function () { sprite.style.backgroundPositionY = -25 * this.pz_value + "px"; };
    file.onchange = async () => {
      const chosen = file.files?.[0]; file.value = "";
      if (!chosen) return;
      const project = editor()?.project, address = property.getAddress();
      if (!currentProperty(project, property, address)) return;
      const asset = await project.assets.createFromFile(PZ.asset.type.FONT, chosen);
      if (!currentProperty(project, property, address)) {
        project.assets.removeIfUnused(asset);
        return;
      }
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
      if (index >= 0) fontName.textContent = "";
      else if (asset) fontName.textContent = asset.filename || value.font;
      else fontName.textContent = value.font ? "(missing)" : "Choose a font";
      if (text.ownerDocument.activeElement !== text) text.value = value.text;
      if (size.ownerDocument.activeElement !== size) size.value = value.size;
      if (lineHeight.ownerDocument.activeElement !== lineHeight) lineHeight.value = value.lineHeight;
      if (letterSpacing.ownerDocument.activeElement !== letterSpacing) letterSpacing.value = value.letterSpacing;
      align.value = value.align; mode.value = value.mode; sdf.value = value.sdf ? "on" : "off";
    };
    return box;
  });

  register("shader-plus/path", PZ.property.type.TEXT, property => {
    const box = editbox("zsp-path"), anchor = element("span", "zsp-anchor");
    const api = () => (window.PZ && window.PZ.zoidium && window.PZ.zoidium.layerMask) || null;
    const grid = element("div", "zsp-fields");
    const kind = options("Source", [["mask", "Mask"], ["shape", "Shape+ path"]], () => writeRef({ source: kind.value }));
    const layer = element("select", "pz-inputbox zsp-option", { "aria-label": "Layer", title: "Layer" });
    layer.onchange = () => writeRef({ layer: layer.value });
    const item = element("select", "pz-inputbox zsp-option", { "aria-label": "Path", title: "Path" });
    item.onchange = () => writeRef({ item: item.value });
    const status = element("span", "zsp-field-label");
    grid.append(kind, layer, item);
    box.append(anchor, grid, status);
    const write = patch => commit(anchor, property, patch);
    function lists() {
      try {
        const project = editor()?.project;
        return (api() && project && api().listSources(project)) || [];
      } catch (_error) {
        return [];
      }
    }
    function current() {
      try {
        return (api() && api().parseReference(property.get())) || null;
      } catch (_error) {
        return null;
      }
    }
    function writeRef(change) {
      const sources = lists();
      const previous = current() || {};
      const next = { source: "mask", ...previous, ...change };
      // The clip address is the stable source token; a stored track list
      // index could never re-link a stale address, so it is not persisted.
      delete next.track;
      const candidates = sources.filter(s => s.kind === next.source);
      // The layer dropdown hands over a live list index; a stored reference
      // re-links through its clip address only.
      const chosen = candidates.find(s => String(sources.indexOf(s)) === String(next.layer)) ||
        candidates.find(s => next.clip && s.clip && JSON.stringify(s.clip) === JSON.stringify(next.clip)) ||
        candidates[0];
      if (!chosen) return;
      const items = chosen.kind === "mask" ? chosen.masks : chosen.paths;
      const key = chosen.kind === "mask" ? "mask" : "path";
      const picked = items.find(entry => entry.id === next.item) || items[0];
      if (!picked) return;
      write(api().formatReference({ source: chosen.kind, clip: chosen.clip || undefined, [key]: picked.id }));
    }
    box.pz_update = () => {
      if (!api()) {
        status.textContent = "Enable Shape+ for Path inputs";
        kind.disabled = layer.disabled = item.disabled = true;
        return;
      }
      kind.disabled = layer.disabled = item.disabled = false;
      const sources = lists();
      const ref = current();
      const candidates = sources.filter(s => s.kind === (ref?.source || "mask"));
      if (document.activeElement !== kind) kind.value = ref?.source || "mask";
      if (document.activeElement !== layer) {
        layer.textContent = "";
        for (const [index, source] of sources.entries()) {
          if (source.kind !== kind.value) continue;
          const option = element("option", "", { value: String(index) });
          option.textContent = "Track " + (source.track + 1) + " · " + source.layer;
          layer.append(option);
        }
        const at = sources.findIndex(s => s.kind === kind.value && (ref?.clip && s.clip && JSON.stringify(s.clip) === JSON.stringify(ref.clip)));
        layer.value = String(at >= 0 ? at : sources.findIndex(s => s.kind === kind.value));
      }
      const chosen = sources[Number(layer.value)] || candidates[0];
      const items = chosen ? (chosen.kind === "mask" ? chosen.masks : chosen.paths) : [];
      const key = chosen?.kind === "mask" ? "mask" : "path";
      if (document.activeElement !== item) {
        item.textContent = "";
        for (const entry of items) {
          const option = element("option", "", { value: entry.id });
          option.textContent = entry.name || entry.id;
          item.append(option);
        }
        item.value = (chosen && ref?.[key] && items.some(entry => entry.id === ref[key]) && ref[key]) || (items[0] && items[0].id) || "";
      }
      const names = chosen ? chosen.layer + " / " + ((items.find(entry => entry.id === item.value) || {}).name || item.value) : null;
      status.textContent = ref ? (names ? "✓ " + names : "Missing source") : "Choose a source";
    };
    box.pz_update();
    return box;
  });

  return { commit, KINDS, options, iconButton };
}

module.exports = { installControls };
