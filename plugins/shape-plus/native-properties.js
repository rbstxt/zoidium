"use strict";
// Presentation groups only. Properties keep their native owners, addresses,
// history and serialized keys; no synthetic property enters the model.
const groups = {
  Dashes: ["dashPairs", "dash1", "gap1", "dash2", "gap2", "dash3", "gap3", "dashOffset"],
  Taper: ["startLength", "endLength", "startWidth", "endWidth", "startEase", "endEase"],
  Wave: ["waveAmount", "waveUnits", "wavelength", "waveCycles", "wavePhase"],
};
function visible(key, p) {
  const dash = /^(dash|gap)([123])$/.exec(key);
  if (dash) return Number(dash[2]) <= Number(p.dashPairs.get());
  if (key === "dashOffset") return Number(p.dashPairs.get()) > 0;
  if (key === "wavelength") return p.waveUnits.get() === "length";
  if (key === "waveCycles") return p.waveUnits.get() !== "length";
  if (key.startsWith("highlight")) return p.gradientType.get() === "radial";
  if (key === "innerRadius" || key === "innerRoundness") return p.mode.get() === "star";
  if (key === "miterLimit") return p.join.get() === "miter";
  return true;
}
function nondefault(property) {
  const data = JSON.parse(JSON.stringify(property));
  if (data?.animated || data?.objects?.some(p => p.animated)) return true;
  const definition = property.definition;
  return JSON.stringify(property.get(0)) !== JSON.stringify(definition.value);
}
function decorate(panel, row, item) {
  const list = row.nextElementSibling;
  if (!list) return;
  const p = item.properties, rows = new Map();
  for (const child of list.children) {
    const key = Object.keys(p).find(key => p[key] === child.pz_object);
    if (key) rows.set(key, [child, child.nextElementSibling?.tagName === "UL" ? child.nextElementSibling : null]);
  }
  for (const [name, keys] of Object.entries(groups)) {
    const entries = keys.filter(key => rows.has(key));
    if (!entries.length) continue;
    const first = rows.get(entries[0])[0], header = document.createElement("li"), label = document.createElement("div");
    header.className = "parent"; header.style.gridTemplateColumns = panel.columnTemplate;
    header.pz_object = p;
    label.style.paddingLeft = first.firstElementChild.style.paddingLeft;
    const button = document.createElement("button"); button.className = "collapse"; button.textContent = "⯆";
    button.title = name; button.setAttribute("aria-label", name);
    const text = document.createElement("span"); text.textContent = name;
    label.append(button, text); header.append(label, document.createElement("div"));
    const children = document.createElement("ul");
    list.insertBefore(header, first); header.after(children);
    for (const key of entries) for (const element of rows.get(key)) if (element) children.append(element);
    const collapsed = !entries.some(key => nondefault(p[key]));
    button.classList.toggle("collapsed", collapsed); children.style.display = collapsed ? "none" : "";
    button.onclick = panel.collapseClick;
    header.addEventListener("mousedown", event => event.stopPropagation());
    header.addEventListener("click", event => event.stopPropagation());
  }
  function refresh() {
    for (const [key, elements] of rows) for (const element of elements) if (element) {
      const hidden = !visible(key, p);
      // Preserve the native collapsed state of vector/channel child lists.
      if (element === elements[0]) element.hidden = hidden;
      else element.hidden = hidden;
    }
  }
  const watched = ["dashPairs", "waveUnits", "gradientType", "mode", "join"].map(key => p[key]).filter(Boolean);
  for (const property of watched) property.onChanged.watch(refresh);
  refresh();
  const previous = row.pz_shapeCleanup;
  row.pz_shapeCleanup = () => { previous?.(); for (const property of watched) property.onChanged.unwatch(refresh); };
}
module.exports = { decorate, visible, nondefault };
