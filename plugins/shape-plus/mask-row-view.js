"use strict";
// Mask property view: one labelled, expandable mask row (plan package P1.3).
//
// This module is pure view code: given a mask snapshot plus UI state it builds
// a dark-editor row with a header (expand, enable, name, combine mode, invert,
// keyframe diamond, Edit, delete) and an expandable body (keyframe navigation,
// Feather, Opacity, Expansion, outline colour, rename, lock, duplicate,
// reorder). Every mutation reports through callbacks; the module never touches
// mask storage itself. Snapshot reads tolerate legacy fields (P1.2 defaults):
// missing name/expansion/outlineColor/locked fall back to DEFAULTS so old
// projects render exactly as before until the user edits.
//
// Consumed contracts (provided by the integration package P1.7):
// - model snapshot: { id, name|properties.name, mode, invert, enabled,
//   feather, opacity (0..1), expansion, outlineColor, locked }.
// - state: { active, expanded, editing, keyframeState ("off"|"armed"|"keyed"),
//   canMoveUp, canMoveDown }. keyframeState follows design.md "Animation":
//   off = hollow diamond, armed = outlined active diamond (animation on, no
//   key at the playhead), keyed = filled diamond (key at the playhead).
// - callbacks: onActivate(id), onToggleExpand(id), onToggleEdit(id),
//   onRename(id, name), onModeChange(id, mode), onToggleInvert(id),
//   onToggleEnabled(id), onKeyframeToggle(id), onKeyframePrev(id),
//   onKeyframeNext(id), onFeatherChange(id, px), onOpacityChange(id, 0..1),
//   onExpansionChange(id, px), onOutlineColorChange(id, css),
//   onToggleLock(id), onDuplicate(id), onDelete(id), onMove(id, -1|+1).
//   Every callback is optional; missing ones are ignored.
//
// Numeric ranges: feather 0..500 px and opacity 0..100% mirror mask-model.js
// validation. Expansion accepts -128 to 128 layer pixels. Invalid edits
// restore the field and commit nothing.
(function (root) {
  const MODES = ["add", "subtract", "intersect"];
  const MODE_LABELS = { add: "Add", subtract: "Subtract", intersect: "Intersect" };
  // design.md "Animation": off = hollow, armed = outlined active, keyed = filled.
  const KEYFRAME_STATES = ["off", "armed", "keyed"];
  const GLYPHS = { off: "◇", armed: "◈", keyed: "◆" };
  const LIMITS = {
    featherMin: 0, featherMax: 500,
    opacityMin: 0, opacityMax: 100,
    expansionMin: -128, expansionMax: 128,
  };
  const DEFAULTS = {
    name: "Mask",
    mode: "add",
    invert: 0,
    enabled: 1,
    feather: 0,
    opacity: 1,
    expansion: 0,
    outlineColor: "#58a6ff",
    locked: false,
  };

  function readModel(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const properties = source.properties && typeof source.properties === "object" ? source.properties : {};
    const invert = source.invert === true ? 1 : source.invert === false ? 0 : source.invert;
    const enabled = source.enabled === 0 || source.enabled === false ? 0
      : properties.enabled === 0 || properties.enabled === false ? 0 : 1;
    return {
      id: typeof source.id === "string" ? source.id : "",
      name: typeof source.name === "string" && source.name ? source.name
        : typeof properties.name === "string" && properties.name ? properties.name : DEFAULTS.name,
      mode: MODES.includes(source.mode) ? source.mode : DEFAULTS.mode,
      invert: invert === 1 ? 1 : 0,
      enabled,
      feather: typeof source.feather === "number" && Number.isFinite(source.feather) ? source.feather : DEFAULTS.feather,
      opacity: typeof source.opacity === "number" && Number.isFinite(source.opacity) ? source.opacity : DEFAULTS.opacity,
      expansion: typeof source.expansion === "number" && Number.isFinite(source.expansion) ? source.expansion : DEFAULTS.expansion,
      outlineColor: typeof source.outlineColor === "string" && source.outlineColor ? source.outlineColor
        : typeof properties.outlineColor === "string" && properties.outlineColor ? properties.outlineColor
          : DEFAULTS.outlineColor,
      locked: source.locked === true || properties.locked === true,
    };
  }

  function keyframeGlyph(state) {
    return GLYPHS[state] || GLYPHS.off;
  }

  function describeKeyframe(state, name) {
    const label = name || DEFAULTS.name;
    if (state === "keyed") return "Keyframe at playhead for " + label + " (click to remove the path key)";
    if (state === "armed") return "Animation on for " + label + ", no keyframe at playhead (click to add a path key)";
    return "Animation off for " + label + " (click to animate the path)";
  }

  function isValidColor(value) {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  function call(callbacks, key, ...args) {
    const fn = callbacks?.[key];
    if (typeof fn === "function") fn(...args);
  }

  function make(document, tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function styleButton(node, active) {
    node.style.cssText = "min-width:24px;height:20px;font-size:11px;padding:0 6px;cursor:pointer;border-radius:3px" +
      (active
        ? ";border-color:var(--zui-accent,#58a6ff);color:var(--zui-accent,#58a6ff)"
        : ";background:var(--zui-input-bg,#222);color:var(--zui-text,#ddd);border:1px solid var(--zui-border,#444)");
    return node;
  }

  function headerButton(document, className, label, pressed, title, onClick) {
    const button = make(document, "button", className, label);
    styleButton(button, pressed);
    button.setAttribute("aria-label", title);
    button.title = title;
    if (pressed !== undefined) button.setAttribute("aria-pressed", String(!!pressed));
    button.addEventListener("click", event => {
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      onClick();
    });
    return button;
  }

  function labeledNumber(document, className, labelText, value, min, max, step, title, commit) {
    const wrap = make(document, "span", className + "-wrap");
    wrap.style.cssText = "display:inline-flex;gap:4px;align-items:center";
    const label = make(document, "label", "", labelText);
    label.style.cssText = "font-size:11px;color:var(--zui-text-muted,#999)";
    const input = make(document, "input", className);
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.cssText = "width:56px;background:var(--zui-input-bg,#222);color:var(--zui-text,#ddd);border:1px solid var(--zui-border,#444);border-radius:3px;padding:1px 4px;font-size:11px";
    input.setAttribute("aria-label", title);
    input.title = title;
    label.htmlFor = className;
    input.addEventListener("change", event => {
      const raw = event?.target?.value ?? input.value;
      const next = Number(raw);
      if (!Number.isFinite(next) || next < min || next > max) {
        input.setCustomValidity?.("Enter a number from " + min + " to " + max + ".");
        input.reportValidity?.();
        input.setCustomValidity?.("");
        input.value = String(value);
        return;
      }
      value = next;
      commit(next);
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    return { wrap, input, sync: next => { value = next; input.value = String(next); } };
  }

  // Builds one expandable mask row. Returns the root element.
  function renderMaskRow(document, rawModel, rawState = {}, callbacks = {}) {
    const mask = readModel(rawModel);
    const state = rawState && typeof rawState === "object" ? rawState : {};
    const keyframeState = KEYFRAME_STATES.includes(state.keyframeState) ? state.keyframeState : "off";
    const active = state.active === true;
    const editing = state.editing === true;
    const expanded = state.expanded !== false;
    const locked = mask.locked === true;
    const canMoveUp = state.canMoveUp !== false;
    const canMoveDown = state.canMoveDown !== false;
    const id = mask.id;

    const root = make(document, "div", "mask-row-view" + (active ? " is-active" : ""));
    root.style.cssText = "padding:3px 0 3px 8px;border-top:1px solid var(--zui-border,#333);border-left:2px solid transparent" +
      (active ? ";border-left-color:var(--zui-accent,#58a6ff);background:rgba(88,166,255,.08)" : "");
    if (active) root.setAttribute("aria-current", "true");
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", mask.name + (locked ? " (locked)" : ""));

    const head = make(document, "div", "mask-row-head");
    head.style.cssText = "display:flex;gap:4px;align-items:center;flex-wrap:wrap";
    root.appendChild(head);

    const expander = make(document, "button", "mask-row-expander", expanded ? "▾" : "▸");
    styleButton(expander, false);
    expander.setAttribute("aria-label", (expanded ? "Collapse " : "Expand ") + mask.name + " settings");
    expander.title = (expanded ? "Collapse " : "Expand ") + mask.name + " settings";
    expander.setAttribute("aria-expanded", String(expanded));
    expander.addEventListener("click", event => {
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      call(callbacks, "onToggleExpand", id);
    });
    head.appendChild(expander);

    const enabled = mask.enabled !== 0;
    const enable = headerButton(document, "mask-row-enable", enabled ? "●" : "○", enabled,
      (enabled ? "Disable " : "Enable ") + mask.name, () => call(callbacks, "onToggleEnabled", id));
    if (enabled) enable.style.color = "#f05555";
    enable.disabled = locked;
    head.appendChild(enable);

    const name = make(document, "button", "mask-row-name", mask.name + (active ? " ●" : ""));
    name.style.cssText = "font-size:11px;margin-right:2px;background:none;border:none;cursor:pointer;padding:0 2px" +
      (active ? ";color:var(--zui-accent,#58a6ff);font-weight:600" : ";color:var(--zui-text,#ddd)");
    name.setAttribute("aria-label", "Activate " + mask.name + " for editing");
    name.title = "Activate " + mask.name + " for editing (click to edit its path in the preview)";
    name.addEventListener("click", event => {
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      call(callbacks, "onActivate", id);
    });
    head.appendChild(name);

    const mode = make(document, "select", "mask-row-mode");
    mode.style.cssText = "height:20px;font-size:11px;background:var(--zui-input-bg,#222);color:var(--zui-text,#ddd);border:1px solid var(--zui-border,#444);border-radius:3px;cursor:pointer";
    for (const value of MODES) {
      const option = make(document, "option", "", MODE_LABELS[value]);
      option.value = value;
      mode.appendChild(option);
    }
    mode.value = mask.mode;
    mode.setAttribute("aria-label", "Combine mode for " + mask.name);
    mode.title = "Combine mode for " + mask.name + " (Add, Subtract, Intersect)";
    mode.disabled = locked;
    mode.addEventListener("change", event => {
      const next = event?.target?.value ?? mode.value;
      if (!MODES.includes(next)) { mode.value = mask.mode; return; }
      mask.mode = next;
      call(callbacks, "onModeChange", id, next);
    });
    head.appendChild(mode);

    const invert = headerButton(document, "mask-row-invert", "INV", mask.invert === 1,
      "Invert " + mask.name + (mask.invert === 1 ? " (currently inverted)" : " (currently normal)"),
      () => call(callbacks, "onToggleInvert", id));
    invert.disabled = locked;
    head.appendChild(invert);

    const key = headerButton(document, "mask-row-key", keyframeGlyph(keyframeState), keyframeState === "keyed",
      describeKeyframe(keyframeState, mask.name), () => call(callbacks, "onKeyframeToggle", id));
    key.disabled = locked;
    head.appendChild(key);

    const edit = headerButton(document, "mask-row-edit", "Edit", editing,
      "Edit " + mask.name + " path points in the preview", () => call(callbacks, "onToggleEdit", id));
    edit.disabled = locked;
    head.appendChild(edit);

    const del = headerButton(document, "mask-row-delete", "×", false,
      "Delete " + mask.name, () => call(callbacks, "onDelete", id));
    del.disabled = locked;
    head.appendChild(del);

    const body = make(document, "div", "mask-row-body");
    body.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:4px 0 2px 22px;font-size:11px;color:var(--zui-text-muted,#999)";
    body.hidden = !expanded;
    root.appendChild(body);

    const prev = headerButton(document, "mask-row-key-prev", "‹", false,
      "Previous path keyframe for " + mask.name, () => call(callbacks, "onKeyframePrev", id));
    prev.disabled = locked;
    body.appendChild(prev);
    const next = headerButton(document, "mask-row-key-next", "›", false,
      "Next path keyframe for " + mask.name, () => call(callbacks, "onKeyframeNext", id));
    next.disabled = locked;
    body.appendChild(next);

    const feather = labeledNumber(document, "mask-row-feather", "Feather",
      mask.feather, LIMITS.featherMin, LIMITS.featherMax, 1,
      "Feather in pixels for " + mask.name + " (0 to 500)",
      px => call(callbacks, "onFeatherChange", id, px));
    feather.input.disabled = locked;
    body.appendChild(feather.wrap);

    const opacityPct = Math.round(mask.opacity * 100);
    const opacity = labeledNumber(document, "mask-row-opacity", "Opacity",
      opacityPct, LIMITS.opacityMin, LIMITS.opacityMax, 1,
      "Opacity percent for " + mask.name + " (0 to 100)",
      pct => call(callbacks, "onOpacityChange", id, pct / 100));
    opacity.input.disabled = locked;
    body.appendChild(opacity.wrap);

    const expansion = labeledNumber(document, "mask-row-expansion", "Expansion",
      mask.expansion, LIMITS.expansionMin, LIMITS.expansionMax, 1,
      "Expansion in layer pixels for " + mask.name + " (" + LIMITS.expansionMin + " to " + LIMITS.expansionMax + ")",
      px => call(callbacks, "onExpansionChange", id, px));
    expansion.input.disabled = locked;
    body.appendChild(expansion.wrap);

    const colorWrap = make(document, "span", "mask-row-color-wrap");
    colorWrap.style.cssText = "display:inline-flex;gap:4px;align-items:center";
    const colorLabel = make(document, "label", "", "Outline color");
    colorLabel.style.cssText = "font-size:11px;color:var(--zui-text-muted,#999)";
    const color = make(document, "input", "mask-row-color");
    color.type = "color";
    color.value = isValidColor(mask.outlineColor) ? mask.outlineColor : DEFAULTS.outlineColor;
    color.style.cssText = "width:28px;height:18px;padding:0;border:1px solid var(--zui-border,#444);border-radius:3px;background:none;cursor:pointer";
    color.setAttribute("aria-label", "Outline color for " + mask.name);
    color.title = "Outline color for " + mask.name + " in the preview";
    color.disabled = locked;
    color.addEventListener("change", event => {
      const value = event?.target?.value ?? color.value;
      if (!isValidColor(value)) { color.value = mask.outlineColor; return; }
      mask.outlineColor = value;
      call(callbacks, "onOutlineColorChange", id, value);
    });
    colorWrap.appendChild(colorLabel);
    colorWrap.appendChild(color);
    body.appendChild(colorWrap);

    const nameWrap = make(document, "span", "mask-row-rename-wrap");
    nameWrap.style.cssText = "display:inline-flex;gap:4px;align-items:center";
    const nameLabel = make(document, "label", "", "Name");
    nameLabel.style.cssText = "font-size:11px;color:var(--zui-text-muted,#999)";
    const nameInput = make(document, "input", "mask-row-name-input");
    nameInput.type = "text";
    nameInput.value = mask.name;
    nameInput.style.cssText = "width:90px;background:var(--zui-input-bg,#222);color:var(--zui-text,#ddd);border:1px solid var(--zui-border,#444);border-radius:3px;padding:1px 4px;font-size:11px";
    nameInput.setAttribute("aria-label", "Rename " + mask.name);
    nameInput.title = "Rename " + mask.name + " (names never change mask identity)";
    nameInput.disabled = locked;
    nameInput.addEventListener("change", event => {
      const value = String(event?.target?.value ?? nameInput.value).trim();
      if (!value) { nameInput.value = mask.name; return; }
      mask.name = value;
      call(callbacks, "onRename", id, value);
    });
    nameWrap.appendChild(nameLabel);
    nameWrap.appendChild(nameInput);
    body.appendChild(nameWrap);

    const lock = headerButton(document, "mask-row-lock", locked ? "🔒" : "🔓", locked,
      (locked ? "Unlock " : "Lock ") + mask.name + " (locking blocks geometry, keys, properties and deletion; reordering remains allowed)",
      () => call(callbacks, "onToggleLock", id));
    lock.disabled = false;
    body.appendChild(lock);

    const duplicate = headerButton(document, "mask-row-duplicate", "Duplicate", false,
      "Duplicate " + mask.name + " with fresh IDs", () => call(callbacks, "onDuplicate", id));
    duplicate.disabled = locked;
    body.appendChild(duplicate);

    const up = headerButton(document, "mask-row-up", "▲", false,
      "Move " + mask.name + " earlier in combine order", () => call(callbacks, "onMove", id, -1));
    up.disabled = !canMoveUp;
    body.appendChild(up);
    const down = headerButton(document, "mask-row-down", "▼", false,
      "Move " + mask.name + " later in combine order", () => call(callbacks, "onMove", id, 1));
    down.disabled = !canMoveDown;
    body.appendChild(down);

    return root;
  }

  const api = {
    MODES, MODE_LABELS, KEYFRAME_STATES, LIMITS, DEFAULTS,
    readModel, keyframeGlyph, describeKeyframe, renderMaskRow,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZoidiumMaskRowView = api;
})(typeof window !== "undefined" ? window : globalThis);
