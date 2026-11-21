"use strict";

const QUALITY = [[1, "Full"], [0.5, "1/2"], [0.25, "1/4"], [0.125, "1/8"]];

function createPopup(document, button, className) {
  const menu = document.createElement("div");
  menu.className = "zoidium-player-plus-popup " + className;
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  document.body.appendChild(menu);
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  function close(focus) {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (focus) button.focus();
  }
  function open() {
    const rect = button.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.hidden = false;
    const win = document.defaultView;
    const width = menu.offsetWidth, height = menu.offsetHeight;
    menu.style.left = Math.max(0, Math.min(rect.left, (win?.innerWidth || rect.right + width) - width)) + "px";
    menu.style.top = Math.max(0, rect.bottom + height > (win?.innerHeight || Infinity) ? rect.top - height : rect.bottom) + "px";
    button.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("button, input, select");
    first?.focus();
  }
  const toggle = () => menu.hidden ? open() : close(false);
  const outside = event => {
    if (!menu.contains(event.target) && !button.contains(event.target) &&
        !(className === "zoidium-player-plus-overflow-menu" && event.target.closest?.(".zoidium-player-plus-quality-menu, .zoidium-player-plus-quality"))) close(false);
  };
  const keyboard = event => {
    if (event.key === "Escape") { event.preventDefault(); close(true); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(menu.querySelectorAll("button, input, select")).filter(item => !item.disabled && !item.hidden && !item.closest("[hidden]"));
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  };
  button.addEventListener("click", toggle);
  menu.addEventListener("keydown", keyboard);
  document.addEventListener("pointerdown", outside);
  return { menu, close, dispose() { document.removeEventListener("pointerdown", outside); menu.remove(); } };
}

function createQualityMenu(document, options) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "zoidium-player-plus-quality";
  button.title = "Preview quality";
  button.setAttribute("aria-label", "Preview quality");
  const popup = createPopup(document, button, "zoidium-player-plus-quality-menu");
  const choices = QUALITY.map(([value, label]) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.textContent = label === "Full" ? "Full quality" : label + " quality";
    choice.setAttribute("role", "menuitemradio");
    choice.addEventListener("click", () => { options.setQuality(value); update(); popup.close(true); });
    popup.menu.appendChild(choice);
    return choice;
  });
  const adaptiveLabel = document.createElement("label");
  const adaptive = document.createElement("input");
  adaptive.type = "checkbox";
  adaptive.setAttribute("aria-label", "Adaptive preview quality");
  adaptiveLabel.appendChild(adaptive);
  const text = document.createElement("span"); text.textContent = "Adaptive"; adaptiveLabel.appendChild(text);
  popup.menu.appendChild(adaptiveLabel);
  const fpsLabel = document.createElement("label");
  const fpsMeter = document.createElement("input");
  fpsMeter.type = "checkbox";
  fpsMeter.setAttribute("aria-label", "Show FPS meter");
  fpsLabel.appendChild(fpsMeter);
  const fpsText = document.createElement("span"); fpsText.textContent = "FPS meter"; fpsLabel.appendChild(fpsText);
  fpsMeter.addEventListener("change", () => { options.setFpsMeter(fpsMeter.checked); update(); });
  const limitLabel = document.createElement("label");
  const limitText = document.createElement("span"); limitText.textContent = "Lowest"; limitLabel.appendChild(limitText);
  const limit = document.createElement("select");
  limit.title = "Lowest adaptive quality"; limit.setAttribute("aria-label", limit.title);
  for (const [value, label] of [["auto", "Auto"], ["0.5", "1/2"], ["0.25", "1/4"], ["0.125", "1/8"]]) {
    const item = document.createElement("option"); item.value = value; item.textContent = label; limit.appendChild(item);
  }
  limitLabel.appendChild(limit); popup.menu.appendChild(limitLabel);
  popup.menu.appendChild(fpsLabel);
  adaptive.addEventListener("change", () => { options.setAdaptive(adaptive.checked); update(); });
  limit.addEventListener("change", () => { options.setLimit(limit.value); update(); });
  function update() {
    const state = options.getState();
    const label = QUALITY.find(([value]) => value === state.effective)?.[1] || "Full";
    button.textContent = state.effective !== state.quality ? "Auto · " + label : label;
    choices.forEach((choice, index) => choice.setAttribute("aria-checked", String(QUALITY[index][0] === state.quality)));
    adaptive.checked = state.enabled;
    fpsMeter.checked = state.fpsMeter;
    limit.value = state.limit;
    limitLabel.hidden = !state.enabled;
  }
  update();
  return { button, update, dispose: popup.dispose };
}

function createOverflow(document, toolbar, controls) {
  const button = document.createElement("button");
  button.type = "button"; button.className = "zoidium-player-plus-overflow";
  button.textContent = "⋯"; button.title = "More player controls";
  button.setAttribute("aria-label", button.title);
  button.hidden = true;
  toolbar.appendChild(button);
  const popup = createPopup(document, button, "zoidium-player-plus-overflow-menu");
  const order = Array.from(toolbar.children);
  const widths = new Map();
  let count = 0;
  function restore(control) {
    const index = order.indexOf(control);
    const next = order.slice(index + 1).find(item => item.parentElement === toolbar);
    toolbar.insertBefore(control, next || button);
  }
  function layout() {
    const children = Array.from(toolbar.children);
    let right = 0;
    for (const child of children) {
      if (child !== button && child.offsetParent) right = Math.max(right, child.offsetLeft + child.offsetWidth);
    }
    for (const control of controls) if (control.parentElement === toolbar && control.offsetWidth) widths.set(control, control.offsetWidth + 2);
    const spans = children.filter(child => child.tagName === "SPAN");
    const extra = spans.reduce((sum, span) => sum + Math.max(0, span.offsetWidth - 8), 0);
    const compressed = toolbar.classList.contains("is-player-plus-compressed");
    // Reconstruct the normal minimum width while spacing is compressed.
    const visible = children.filter(child => child !== button && child.offsetParent);
    const spacing = compressed ? 5 + visible.length * 2 + spans.length * 8 : 0;
    let required = right - extra + 6 + spacing;
    for (let i = 0; i < count; i++) required += widths.get(controls[i]) || 32;
    let next = 0;
    if (required > toolbar.clientWidth) {
      required += 31;
      while (next < controls.length && required > toolbar.clientWidth) required -= widths.get(controls[next++]) || 32;
    }
    const shouldCompress = next === controls.length && required > toolbar.clientWidth;
    const compressionChanged = compressed !== shouldCompress;
    toolbar.classList.toggle("is-player-plus-compressed", shouldCompress);
    if (next === count) return compressionChanged;
    for (let i = count - 1; i >= next; i--) restore(controls[i]);
    for (let i = count; i < next; i++) popup.menu.appendChild(controls[i]);
    count = next;
    button.hidden = count === 0;
    if (!count) popup.close(false);
    return true;
  }
  return { layout, dispose() { toolbar.classList.remove("is-player-plus-compressed"); for (let i = count - 1; i >= 0; i--) restore(controls[i]); popup.dispose(); button.remove(); } };
}

module.exports = { createPopup, createQualityMenu, createOverflow };
