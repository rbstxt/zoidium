"use strict";
function install(s) {
  let session = null;
  function finish() {
    if (!session) return;
    const { input } = session; session = null;
    input.remove(); s.gesture.finish(); s.refresh(); s.canvas.focus();
  }
  s.editText = item => {
    finish(); s.selectItem(item.id);
    if (item.properties.sourceText.expression) { s.message("Expression-driven text cannot be edited inline."); return; }
    if (!s.gesture.begin()) return;
    const entry = s.canvasApi.entries().find(entry => entry.item.id === item.id);
    const points = entry ? s.canvasApi.cssPoints(entry).map(v => v.point) : [[10,10],[300,160]];
    const r = s.canvas.getBoundingClientRect(), left = Math.min(...points.map(p=>p[0])), top = Math.min(...points.map(p=>p[1]));
    const input = s.document.createElement("textarea");
    input.setAttribute("aria-label", "Edit Shape+ text");
    input.value = require("./text-properties.js").holdValue(item.properties.sourceText, s.localFrame());
    input.style.cssText = `position:fixed;z-index:10000;left:${r.left+left}px;top:${r.top+top}px;width:${Math.max(180,Math.max(...points.map(p=>p[0]))-left)}px;min-height:100px;font-size:20px;resize:both;box-sizing:border-box`;
    const frame = s.localFrame(); session = { input, frame, id: item.id };
    input.oninput = () => { if (session && s.valid()) { s.setValue(item.properties.sourceText, input.value, frame); s.refresh(); } };
    input.onkeydown = event => {
      event.stopPropagation();
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); finish(); }
    };
    input.onblur = finish;
    s.document.body.append(input); input.focus(); input.select();
  };
  return { finish, check() { if (session && (!s.valid() || s.localFrame() !== session.frame || !s.find(session.id))) finish(); } };
}
module.exports = { install };
