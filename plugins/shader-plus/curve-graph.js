"use strict";
const { parseJSON, parseCurve } = require("./bake.js");
const { pointsWithHandles, segmentHandles, createGraphSampler, PRESETS, clamp } = require("./curve-math.js");
function createCurveGraph(property, { doc, PZ, curves }) {
  const root = doc.createElement("div"); root.className = "editbox zsp-graph";
  const anchor = doc.createElement("span"); anchor.hidden = true; root.append(anchor);
  function node(tag, cls, text, parent = root) { const el = doc.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; parent.append(el); return el; }
  function svgNode(tag, attrs, parent) { const el = doc.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); parent.append(el); return el; }
  const toolbar = node("div", "zsp-graph-tools"), handles = node("label", "zsp-inline", "", toolbar), showHandles = node("input", "", "", handles);
  showHandles.type = "checkbox"; showHandles.setAttribute("aria-label", "Handles"); handles.append(doc.createTextNode("Handles"));
  const readOnly = !!(property.definition.readOnly || property.animated && property.expression);
  const raw = () => parseJSON(property.get());
  let points, selected = 0, active = false, before, shown, cancelDrag;
  function begin() {
    const history = root.closest("ul")?.pz_controls?.editor.history;
    if (readOnly || active || !history || history.operation !== null) return false;
    before = property.get(); active = true; PZ.ui.controls.editStart.call(anchor, property); return true;
  }
  function write() {
    const state = raw(); property.set(JSON.stringify({ ...state, points, ...(state.composite ? { composite: points } : {}) })); draw();
  }
  function finish(cancel = false) {
    if (!active) return;
    if (cancel) property.set(before);
    const same = property.get() === before; active = false;
    PZ.ui.controls.editFinish.call(anchor, property, cancel || same); root.pz_update();
  }
  function run(work) { if (!begin()) return; try { work(); write(); finish(); } catch (error) { finish(true); throw error; } }
  function button(label, action) {
    const b = node("button", "zge-button", label, toolbar); b.type = "button"; b.setAttribute("aria-label", label); b.disabled = readOnly; b.onclick = e => { e.stopPropagation(); action(); }; return b;
  }
  const remove = button("Delete point", () => { if (selected > 0 && selected < points.length-1) run(() => { points.splice(selected, 1); selected = Math.max(0, selected-1); }); });
  button("Random", () => run(() => {
    // Randomness is authored once into the static JSON, never sampled at render time.
    const bytes = new Uint32Array(5); doc.defaultView.crypto.getRandomValues(bytes);
    points = Array.from(bytes, (n, i) => [i/4, Math.round(n/4294967295*10000)/10000]); selected = 0;
  }));
  button("Reset", () => run(() => {
    const value = property.definition.zoidiumShader?.default ?? property.definition.value;
    const defaults = parseJSON(value); points = pointsWithHandles(defaults.composite || defaults.points || PRESETS["Linear up"], curves); selected = 0;
  }));
  const count = node("span", "zsp-graph-count", "", toolbar); count.setAttribute("aria-live", "polite");
  const plot = node("div", "zsp-graph-plot"), max = node("span", "zsp-graph-max", "", plot), min = node("span", "zsp-graph-min", "", plot);
  const svg = svgNode("svg", { viewBox: "0 0 400 200", preserveAspectRatio: "none", tabindex: "0", role: "application", "aria-label": "Over-life curve graph" }, plot);
  svgNode("path", { d: "M0 0H400V200H0ZM100 0V200M200 0V200M300 0V200M0 50H400M0 100H400M0 150H400", class: "zsp-graph-grid" }, svg);
  const fill = svgNode("path", { class: "zsp-graph-fill" }, svg), line = svgNode("path", { class: "zsp-graph-line" }, svg), layer = svgNode("g", {}, svg);
  const labels = node("div", "zsp-graph-axis"), presets = node("div", "zsp-graph-presets");
  for (const [label, preset] of Object.entries(PRESETS)) {
    const b = node("button", "zge-button", label, presets); b.type = "button"; b.disabled = readOnly;
    b.onclick = () => run(() => { points = preset.map(p => p.slice()); selected = 0; });
  }
  const fields = node("div", "zge-fields");
  const coordinates = ["Point input", "Point value"].map((label, index) => {
    const el = node("input", "pz-inputbox", "", fields); el.type = "number"; el.step = "any"; el.setAttribute("aria-label", label); el.title = label; el.disabled = readOnly;
    el.onchange = () => run(() => { const range = parseCurve(property.get(), curves).range, n = Number(el.value); if (!Number.isFinite(n)) return; movePoint(index === 0 ? n : points[selected][0], index === 1 ? (n-range[0])/(range[1]-range[0] || 1) : points[selected][1]); }); return el;
  });
  function movePoint(x, y) {
    const p = points[selected], old = p.slice(), last = points.length-1;
    p[0] = selected === 0 ? 0 : selected === last ? 1 : Math.min(points[selected+1][0]-.001, Math.max(points[selected-1][0]+.001, x)); p[1] = clamp(y);
    if (p[3]) for (const key of ["in", "out"]) if (p[3][key]) p[3][key] = [clamp(p[3][key][0]+p[0]-old[0]), clamp(p[3][key][1]+p[1]-old[1])];
  }
  function draw() {
    const sample = createGraphSampler(points, curves), path = Array.from({ length: 129 }, (_, i) => `${i ? "L" : "M"}${i/128*400} ${(1-sample(i/128))*200}`).join(" ");
    line.setAttribute("d", path); fill.setAttribute("d", path+" L400 200 L0 200 Z"); layer.replaceChildren();
    points.forEach((p, i) => {
      const c = svgNode("circle", { cx: p[0]*400, cy: (1-p[1])*200, r: i === selected ? 5 : 4, class: "zsp-graph-point", "data-point": i, "aria-label": `Point ${i+1}` }, layer); c.dataset.selected = String(i === selected);
    });
    if (showHandles.checked && points[selected]) {
      for (const key of ["in", "out"]) {
        const index = key === "in" ? selected-1 : selected;
        if (index < 0 || index >= points.length-1) continue;
        const handle = segmentHandles(points, index)[key === "in" ? 1 : 0], p = points[selected];
        svgNode("path", { d: `M${p[0]*400} ${(1-p[1])*200}L${handle[0]*400} ${(1-handle[1])*200}`, class: "zsp-graph-tangent" }, layer);
        svgNode("rect", { x: handle[0]*400-4, y: (1-handle[1])*200-4, width: 8, height: 8, "data-handle": key, class: "zsp-graph-handle", "aria-label": key === "in" ? "Incoming tangent" : "Outgoing tangent" }, layer);
      }
    }
    const range = parseCurve(property.get(), curves).range; max.textContent = range[1]; min.textContent = range[0]; count.textContent = points.length+" pts";
    remove.disabled = readOnly || selected <= 0 || selected >= points.length-1;
    const axis = property.definition.zoidiumShader?.axis;
    const names = Array.isArray(axis) && axis.length >= 2 ? axis.slice(0, 3).map(String) : typeof axis === "string" && axis.includes("/") ? axis.split("/").map(s => s.trim()).slice(0, 3) : ["0", "1"];
    labels.replaceChildren(...names.map(name => { const span = doc.createElement("span"); span.textContent = name; return span; }));
    coordinates.forEach((el, i) => { if (doc.activeElement !== el) el.value = Math.round((i ? range[0]+points[selected][1]*(range[1]-range[0]) : points[selected][0])*10000)/10000; });
  }
  showHandles.onchange = draw;
  function eventPoint(e) { const r = svg.getBoundingClientRect(); return [clamp((e.clientX-r.left)/r.width), clamp(1-(e.clientY-r.top)/r.height)]; }
  svg.onpointerdown = e => {
    if (e.button !== 0 || readOnly || active) return;
    const point = e.target.getAttribute("data-point"), handle = e.target.getAttribute("data-handle");
    if (point !== null) selected = Number(point);
    if (!begin()) return;
    e.preventDefault(); e.stopPropagation(); svg.focus();
    if (point === null && !handle) {
      const p = eventPoint(e); p[0] = Math.max(.001, Math.min(.999, p[0]));
      if (points.length >= 16 || points.some(q => Math.abs(q[0]-p[0]) < .001)) { finish(true); return; }
      points.push(p); points.sort((a, b) => a[0]-b[0]); selected = points.indexOf(p); write();
    }
    draw(); const controller = new AbortController();
    const end = cancel => { controller.abort(); cancelDrag = null; finish(cancel); };
    cancelDrag = () => end(true);
    doc.addEventListener("pointermove", event => {
      const [x, y] = eventPoint(event);
      if (handle) {
        const p = points[selected]; if (!p[3]) { p[2] = p[2] ?? null; p[3] = {}; }
        const edge = handle === "in" ? points[selected-1][0] : points[selected+1][0];
        p[3][handle] = [Math.min(Math.max(x, Math.min(p[0], edge)), Math.max(p[0], edge)), y];
      } else movePoint(x, y);
      write();
    }, { signal: controller.signal });
    doc.addEventListener("pointerup", () => end(false), { once: true, signal: controller.signal });
    doc.addEventListener("pointercancel", () => end(true), { once: true, signal: controller.signal });
    doc.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); end(true); } }, { capture: true, signal: controller.signal });
    doc.defaultView.addEventListener("blur", () => end(true), { once: true, signal: controller.signal });
  };
  svg.onkeydown = e => {
    if (readOnly) return;
    if (["Delete", "Backspace"].includes(e.key)) { e.preventDefault(); remove.click(); }
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); run(() => { const p = points[selected], step = e.shiftKey ? .01 : .001; movePoint(p[0]+(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0), p[1]+(e.key === "ArrowDown" ? -step : e.key === "ArrowUp" ? step : 0)); }); }
    else if (e.key === "Tab") { e.preventDefault(); selected = (selected+(e.shiftKey ? points.length-1 : 1))%points.length; draw(); }
  };
  root.addEventListener("keydown", e => { if (!(e.ctrlKey || e.metaKey) || !["z", "y"].includes(e.key.toLowerCase())) e.stopPropagation(); });
  root.addEventListener("mousedown", e => e.stopPropagation());
  root.pz_update = () => {
    if (active || shown === property.get()) return; shown = property.get();
    const value = raw(); points = pointsWithHandles(value.composite || value.points, curves); selected = Math.min(selected, points.length-1); draw();
  };
  root.dispose = () => cancelDrag?.(); root.pz_update(); return root;
}
module.exports = { createCurveGraph };
