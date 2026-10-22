"use strict";
function registerAngle({ PZ, doc, register, commit }) {
  register("shader-plus/angle", PZ.property.type.NUMBER, property => {
    const C = PZ.ui.controls, original = C.generateInput.__zoidiumOriginal || C.generateInput;
    const box = original(property), dial = doc.createElement("button");
    dial.className = "zsp-angle"; dial.type = "button"; dial.title = "Drag to set angle. Arrow keys adjust degrees.";
    dial.setAttribute("role", "slider"); dial.setAttribute("aria-label", "Angle dial"); dial.setAttribute("aria-valuemin", "0"); dial.setAttribute("aria-valuemax", "360");
    dial.disabled = !!property.definition.readOnly || !!property.expression;
    box.append(dial); let drag = null, lastFrame = 0;
    function move(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const r = dial.getBoundingClientRect(), angle = Math.atan2(event.clientX - r.x - r.width / 2, -(event.clientY - r.y - r.height / 2));
      const value = angle + Math.round((drag.last - angle) / (2 * Math.PI)) * 2 * Math.PI;
      property.set(value, box.pz_frame); drag.last = value; event.preventDefault();
    }
    dial.onpointerdown = event => {
      if (event.button !== 0 || dial.disabled) return;
      C.editStart.call(dial, property); drag = { id: event.pointerId, last: property.get(box.pz_frame), before: property.get(box.pz_frame) };
      dial.setPointerCapture(event.pointerId); move(event); event.stopPropagation();
    };
    dial.onpointermove = move;
    function finish(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const unchanged = drag.last === drag.before; drag = null;
      dial.releasePointerCapture(event.pointerId); C.editFinish.call(dial, property, unchanged);
    }
    dial.onpointerup = finish;
    dial.onpointercancel = event => { if (drag) { property.set(drag.before, box.pz_frame); drag.last = drag.before; finish(event); } };
    dial.onkeydown = event => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const direction = ["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1;
      commit(dial, property, Number(property.get(lastFrame)) + direction * (event.shiftKey ? 10 : 1) * Math.PI / 180);
    };
    const update = box.pz_update;
    box.pz_update = frame => { lastFrame = frame ?? lastFrame; update.call(box, frame); const value = Number(property.get(frame)); dial.style.setProperty("--zsp-angle", value + "rad"); dial.setAttribute("aria-valuenow", String((value * 180 / Math.PI % 360 + 360) % 360)); };
    return box;
  });
}
module.exports = { registerAngle };
