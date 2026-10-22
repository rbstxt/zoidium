"use strict";
// Angle rows keep CM3's number input and add a compact dial button that
// fits the row height. Clicking it opens a large direction dial below the
// row: drag the handle (Shift snaps to 15°), arrow keys nudge. 0° points
// up and angles grow clockwise; the stored value is radians.
const SIZE = 168, R = 66, TAU = Math.PI * 2;
function registerAngle({ PZ, doc, register, commit }) {
  const SVG = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, parent) {
    const el = doc.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (parent) parent.append(el);
    return el;
  }
  const point = (angle, radius) => [SIZE / 2 + Math.sin(angle) * radius, SIZE / 2 - Math.cos(angle) * radius];
  let open = null;
  function close() { if (open) { open.dispose(); open = null; } }

  function popover(anchor, property, box) {
    close();
    const C = PZ.ui.controls;
    const panel = doc.createElement("div");
    panel.className = "zsp-angle-pop"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Angle dial");
    const dial = svg("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE, class: "zsp-dial", tabindex: "0", role: "slider", "aria-label": "Angle", "aria-valuemin": "0", "aria-valuemax": "360" }, panel);
    svg("circle", { cx: SIZE / 2, cy: SIZE / 2, r: R + 10, class: "zsp-dial-face" }, dial);
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * TAU, long = i % 6 === 0, [x1, y1] = point(a, R + 6), [x2, y2] = point(a, R + (long ? -4 : 1));
      svg("line", { x1, y1, x2, y2, class: long ? "zsp-dial-tick zsp-dial-tick-major" : "zsp-dial-tick" }, dial);
    }
    const sector = svg("path", { class: "zsp-dial-sector" }, dial);
    svg("line", { x1: SIZE / 2, y1: SIZE / 2, x2: SIZE / 2, y2: SIZE / 2 - R, class: "zsp-dial-zero" }, dial);
    const hand = svg("line", { x1: SIZE / 2, y1: SIZE / 2, class: "zsp-dial-hand" }, dial);
    svg("circle", { cx: SIZE / 2, cy: SIZE / 2, r: 3, class: "zsp-dial-hub" }, dial);
    const knob = svg("g", { class: "zsp-dial-knob" }, dial);
    svg("circle", { r: 11, class: "zsp-dial-knob-disc" }, knob);
    svg("path", { d: "M-5 0H4M1-4L5 0L1 4", class: "zsp-dial-knob-arrow" }, knob);
    const readout = doc.createElement("div"); readout.className = "zsp-dial-readout"; panel.append(readout);

    const frame = () => box.pz_frame ?? 0;
    function paint() {
      const value = Number(property.get(frame())) || 0, wrapped = (value % TAU + TAU) % TAU;
      const [x, y] = point(wrapped, R);
      hand.setAttribute("x2", x); hand.setAttribute("y2", y);
      knob.setAttribute("transform", `translate(${x} ${y}) rotate(${wrapped * 180 / Math.PI - 90})`);
      const [sx, sy] = point(0, R - 18), [ex, ey] = point(wrapped, R - 18);
      sector.setAttribute("d", wrapped < 1e-6 ? "" : `M${SIZE / 2} ${SIZE / 2}L${sx} ${sy}A${R - 18} ${R - 18} 0 ${wrapped > Math.PI ? 1 : 0} 1 ${ex} ${ey}Z`);
      const degrees = value * 180 / Math.PI;
      readout.textContent = (Math.round(degrees * 10) / 10) + "°";
      dial.setAttribute("aria-valuenow", String(Math.round(((degrees % 360) + 360) % 360)));
    }
    let drag = null;
    function angleAt(event) {
      const r = dial.getBoundingClientRect();
      return Math.atan2(event.clientX - r.left - r.width / 2, -(event.clientY - r.top - r.height / 2));
    }
    function move(event) {
      if (!drag || drag.id !== event.pointerId) return;
      let angle = angleAt(event);
      if (event.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
      // Keep turns continuous so dragging past 0° does not jump a revolution.
      const value = angle + Math.round((drag.last - angle) / TAU) * TAU;
      property.set(value, frame()); drag.last = value; paint(); event.preventDefault();
    }
    dial.addEventListener("pointerdown", event => {
      if (event.button !== 0 || anchor.disabled) return;
      event.preventDefault(); event.stopPropagation();
      C.editStart.call(anchor, property);
      drag = { id: event.pointerId, last: Number(property.get(frame())) || 0, before: property.get(frame()) };
      dial.setPointerCapture(event.pointerId); move(event);
    });
    dial.addEventListener("pointermove", move);
    function end(event, cancel) {
      if (!drag || event.pointerId !== drag.id) return;
      if (cancel) property.set(drag.before, frame());
      const unchanged = cancel || drag.last === drag.before; drag = null;
      if (dial.hasPointerCapture(event.pointerId)) dial.releasePointerCapture(event.pointerId);
      C.editFinish.call(anchor, property, unchanged); paint();
    }
    dial.addEventListener("pointerup", event => end(event, false));
    dial.addEventListener("pointercancel", event => end(event, true));
    dial.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); close(); anchor.focus(); return; }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const direction = ["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1;
      commit(anchor, property, (Number(property.get(frame())) || 0) + direction * (event.shiftKey ? 15 : 1) * Math.PI / 180); paint();
    });

    doc.body.append(panel);
    const place = () => {
      if (!anchor.isConnected) { close(); return; }
      const a = anchor.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight;
      const left = Math.max(4, Math.min(innerWidth - w - 4, a.left + a.width / 2 - w / 2));
      const below = a.bottom + 8 + h <= innerHeight;
      panel.style.left = left + "px"; panel.style.top = (below ? a.bottom + 8 : a.top - h - 8) + "px";
      panel.classList.toggle("zsp-angle-pop-above", !below);
      panel.style.setProperty("--zsp-caret", (a.left + a.width / 2 - left) + "px");
    };
    place(); paint(); dial.focus();
    const outside = event => { if (!panel.contains(event.target) && event.target !== anchor && !anchor.contains(event.target)) close(); };
    const timer = setInterval(() => { place(); if (!drag) paint(); }, 150);
    doc.addEventListener("pointerdown", outside, true);
    anchor.setAttribute("aria-expanded", "true");
    open = { anchor, dispose() { anchor.setAttribute("aria-expanded", "false"); clearInterval(timer); doc.removeEventListener("pointerdown", outside, true); panel.remove(); } };
  }

  register("shader-plus/angle", PZ.property.type.NUMBER, property => {
    const C = PZ.ui.controls, original = C.generateInput.__zoidiumOriginal || C.generateInput;
    const box = original(property), button = doc.createElement("button");
    box.classList.add("zsp-inline-row");
    button.className = "zsp-angle"; button.type = "button"; button.title = "Open the angle dial";
    button.setAttribute("aria-label", "Open the angle dial"); button.setAttribute("aria-haspopup", "dialog");
    button.disabled = !!property.definition.readOnly || !!property.expression;
    const needle = doc.createElement("span"); needle.className = "zsp-angle-needle"; button.append(needle);
    button.onclick = event => { event.stopPropagation(); if (open?.anchor === button) close(); else popover(button, property, box); };
    box.append(button);
    const update = box.pz_update;
    box.pz_update = frame => { update.call(box, frame); button.style.setProperty("--zsp-angle", (Number(property.get(frame)) || 0) + "rad"); };
    return box;
  });
  return { close };
}
module.exports = { registerAngle };
