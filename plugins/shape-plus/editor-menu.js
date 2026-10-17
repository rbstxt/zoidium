"use strict";
// One transient context menu in CM3's dark list style. It replaces the old
// native <select> picker, which showed a styled select box and the operating
// system's popup at the same time. Entries: { label, shortcut, action,
// disabled } or { separator: true }.
const STYLE_ID = "shape-plus-menu-style";
const CSS = `.shape-plus-menu{position:fixed;z-index:1000;min-width:210px;max-height:calc(100vh - 16px);overflow-y:auto;
padding:4px 0;background:#262626;border:1px solid #474747;box-shadow:0 6px 18px rgba(0,0,0,.55);color:#ddd;
font:inherit;font-size:13px;outline:none;user-select:none}
.shape-plus-menu-item{display:flex;align-items:center;gap:18px;padding:5px 14px;cursor:default;white-space:nowrap}
.shape-plus-menu-item span:first-child{flex:1}
.shape-plus-menu-item .shape-plus-menu-key{color:#8a8a8a}
.shape-plus-menu-item.active{background:#3d4d75}
.shape-plus-menu-item.disabled{color:#666}
.shape-plus-menu-item.disabled .shape-plus-menu-key{color:#555}
.shape-plus-menu-title{padding:4px 14px 5px;color:#8a8a8a;font-size:12px;white-space:nowrap}
.shape-plus-menu-separator{height:1px;margin:4px 0;background:#3a3a3a}`;
function createMenu(document) {
  let element = null, restoreFocus = null, entries = [], active = -1;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID; style.textContent = CSS;
    document.head.append(style);
  }
  const rows = () => element ? Array.from(element.querySelectorAll(".shape-plus-menu-item")) : [];
  function highlight(index) {
    active = index;
    rows().forEach((row, i) => row.classList.toggle("active", i === index));
    rows()[index]?.scrollIntoView?.({ block: "nearest" });
  }
  function step(direction) {
    const items = rows();
    if (!items.length) return;
    for (let i = 1; i <= items.length; i++) {
      const next = (active + direction * i + items.length * 2) % items.length;
      if (!items[next].classList.contains("disabled")) return highlight(next);
    }
  }
  function close(focus = true) {
    if (!element) return;
    const current = element;
    element = null; entries = []; active = -1;
    document.removeEventListener("pointerdown", outside, true);
    document.defaultView.removeEventListener("blur", blur);
    current.remove();
    if (focus) restoreFocus?.focus?.({ preventScroll: true });
  }
  function run(entry) {
    if (!entry || entry.disabled) return;
    close();
    entry.action();
  }
  function outside(event) {
    if (element && !element.contains(event.target)) close(false);
  }
  const blur = () => close(false);
  function keydown(event) {
    const key = event.key;
    if (["ArrowDown", "ArrowUp", "Enter", "Escape", " ", "Tab", "Home", "End"].includes(key)) {
      event.preventDefault(); event.stopPropagation();
    } else return;
    if (key === "ArrowDown" || key === "Tab" && !event.shiftKey) step(1);
    else if (key === "ArrowUp" || key === "Tab") step(-1);
    else if (key === "Home") { active = -1; step(1); }
    else if (key === "End") { active = rows().length; step(-1); }
    else if (key === "Escape") close();
    else run(entries[active]);
  }
  function open(x, y, list, { title, focusReturn } = {}) {
    close(false);
    restoreFocus = focusReturn || document.activeElement;
    element = document.createElement("div");
    element.className = "shape-plus-menu";
    element.setAttribute("role", "menu");
    element.tabIndex = -1;
    if (title) {
      const heading = document.createElement("div");
      heading.className = "shape-plus-menu-title"; heading.textContent = title;
      element.append(heading);
    }
    entries = [];
    let previousSeparator = true;
    for (const entry of list) {
      if (entry.separator) {
        if (previousSeparator) continue;
        const line = document.createElement("div");
        line.className = "shape-plus-menu-separator"; line.setAttribute("role", "separator");
        element.append(line); previousSeparator = true;
        continue;
      }
      const row = document.createElement("div");
      row.className = "shape-plus-menu-item" + (entry.disabled ? " disabled" : "");
      row.setAttribute("role", "menuitem");
      if (entry.disabled) row.setAttribute("aria-disabled", "true");
      const label = document.createElement("span");
      label.textContent = entry.label;
      row.append(label);
      if (entry.shortcut) {
        const key = document.createElement("span");
        key.className = "shape-plus-menu-key"; key.textContent = entry.shortcut;
        row.append(key);
      }
      const index = entries.length;
      row.addEventListener("pointermove", () => { if (!entry.disabled && active !== index) highlight(index); });
      row.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); });
      row.addEventListener("click", event => { event.stopPropagation(); run(entry); });
      element.append(row); entries.push(entry); previousSeparator = false;
    }
    element.lastElementChild?.classList.contains("shape-plus-menu-separator") && element.lastElementChild.remove();
    element.addEventListener("keydown", keydown);
    element.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); });
    document.body.append(element);
    // Keep the whole menu inside the window, flipping at the right/bottom edge.
    const view = document.defaultView, rect = element.getBoundingClientRect();
    const left = x + rect.width > view.innerWidth - 4 ? Math.max(4, x - rect.width) : x;
    const top = y + rect.height > view.innerHeight - 4 ? Math.max(4, view.innerHeight - rect.height - 4) : y;
    element.style.left = left + "px"; element.style.top = top + "px";
    document.addEventListener("pointerdown", outside, true);
    view.addEventListener("blur", blur);
    element.focus({ preventScroll: true });
  }
  return { open, close, get element() { return element; } };
}
module.exports = { createMenu };
