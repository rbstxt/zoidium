(function (global) {
  "use strict";
  function create(options) {
    const { doc, node, gesture, change } = options, M = global.ZoidiumGradientModel;
    const panel = node("div", "zge-color"), sv = node("div", "zge-sv"), hue = node("input", "zge-hue"), alpha = node("input", "zge-alpha");
    const marker = node("span", "zge-sv-marker"); sv.append(marker); sv.tabIndex = 0;
    sv.setAttribute("role", "slider"); sv.setAttribute("aria-label", "Saturation and value");
    const fields = node("div", "zge-color-fields");
    let value = [1, 1, 1, 1], hsv = [0, 0, 1], disabled = false;
    const C = global.ZoidiumSharedColor;
    function emit(c) { value = c; change(c); update(c); }
    function hsvEmit(next) { hsv = next; emit([...C.hsvToRgb01(...next), value[3]]); }
    gesture(sv, event => {
      const rect = sv.getBoundingClientRect();
      hsvEmit([hsv[0], M.clamp((event.clientX-rect.left)/rect.width), 1-M.clamp((event.clientY-rect.top)/rect.height)]);
    });
    sv.onkeydown = e => {
      const key = { ArrowLeft: [1, -.01], ArrowRight: [1, .01], ArrowUp: [2, .01], ArrowDown: [2, -.01] }[e.key];
      if (!key || disabled) return;
      e.preventDefault(); options.run(() => { const next = hsv.slice(); next[key[0]] = M.clamp(next[key[0]]+key[1]*(e.shiftKey ? 10 : 1)); hsvEmit(next); });
    };
    for (const [input, label] of [[hue, "Hue"], [alpha, "Alpha"]]) {
      input.type = "range"; input.min = 0; input.max = 1; input.step = "any"; input.setAttribute("aria-label", label);
      let started = false;
      const start = () => { if (!started) started = options.start(); };
      input.onpointerdown = start;
      input.oninput = () => { start(); if (started) { if (input === hue) hsvEmit([Number(hue.value), hsv[1], hsv[2]]); else emit([...value.slice(0, 3), Number(alpha.value)]); } };
      input.onchange = () => { if (started) { started = false; options.finish(); } };
      input.onpointerup = () => { if (started) { started = false; options.finish(); } };
      input.onpointercancel = () => { if (started) { started = false; options.finish(true); } };
    }
    const hex = node("input", "pz-inputbox"); hex.setAttribute("aria-label", "Hex color"); hex.maxLength = 9;
    hex.onchange = () => {
      const match = /^#?([\da-f]{6})([\da-f]{2})?$/i.exec(hex.value.trim());
      if (!match) { update(value); return; }
      options.run(() => emit([0, 2, 4].map(i => parseInt(match[1].slice(i, i+2), 16)/255).concat(match[2] ? parseInt(match[2], 16)/255 : value[3])));
    };
    fields.append(hex);
    const numbers = ["R", "G", "B"].map((label, i) => {
      const line = node("label"); line.textContent = label;
      const input = node("input", "pz-inputbox"); input.type = "number"; input.min = 0; input.max = 255; input.step = "any"; input.setAttribute("aria-label", label);
      input.onchange = () => options.run(() => { const c = value.slice(); c[i] = M.clamp(Number(input.value)/255); emit(c); });
      line.append(input); fields.append(line); return input;
    });
    panel.append(sv, hue, fields, alpha);
    function update(c) {
      value = c.slice();
      const next = C.rgbToHsv01(...value); if (next[1] > 0) hsv[0] = next[0]; hsv[1] = next[1]; hsv[2] = next[2];
      sv.style.setProperty("--zge-hue", M.rgba([...C.hsvToRgb01(hsv[0], 1, 1), 1]));
      marker.style.left = hsv[1]*100+"%"; marker.style.top = (1-hsv[2])*100+"%";
      sv.setAttribute("aria-valuetext", `Saturation ${Math.round(hsv[1]*100)}%, value ${Math.round(hsv[2]*100)}%`);
      if (doc.activeElement !== hue) hue.value = hsv[0]; if (doc.activeElement !== alpha) alpha.value = value[3];
      alpha.style.setProperty("--zge-color", M.rgba([...value.slice(0, 3), 1]));
      if (doc.activeElement !== hex) hex.value = "#"+value.slice(0, 3).map(v => Math.round(v*255).toString(16).padStart(2, "0")).join("").toUpperCase();
      numbers.forEach((input, i) => { if (doc.activeElement !== input) input.value = Math.round(value[i]*255*100)/100; });
    }
    return { element: panel, update, setDisabled(flag) { disabled = flag; panel.inert = flag; } };
  }
  global.ZoidiumGradientColorPanel = { create };
})(window);
