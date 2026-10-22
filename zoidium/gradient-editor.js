(function (global) {
  "use strict";
  const M = global.ZoidiumGradientModel, STORAGE = "zoidium.gradient-presets.v1";
  const builtins = [
    { name: "Black to white", stops: [{ position: 0, color: [0, 0, 0, 1] }, { position: 1, color: [1, 1, 1, 1] }] },
    { name: "Spectrum", stops: [[0, 1, 0, 0], [.17, 1, 1, 0], [.33, 0, 1, 0], [.5, 0, 1, 1], [.67, 0, 0, 1], [.83, 1, 0, 1], [1, 1, 0, 0]].map(s => ({ position: s[0], color: [...s.slice(1), 1] })) },
    { name: "Warm light", stops: [{ position: 0, color: [.15, .02, .1, 1] }, { position: .5, color: [1, .3, .08, 1] }, { position: 1, color: [1, .9, .6, 1] }] },
    { name: "Fade out", stops: [{ position: 0, color: [1, 1, 1, 1] }, { position: 1, color: [1, 1, 1, 0] }] },
  ];
  function create(options = {}) {
    const doc = options.document || global.document;
    function node(tag, cls, label) {
      const el = doc.createElement(tag); if (cls) el.className = cls;
      if (label) { el.setAttribute("aria-label", label); el.title = label; }
      return el;
    }
    const root = node("div", "zge-editor", "Gradient editor"), bar = node("div", "zge-bar", "Gradient bar"), canvas = node("canvas", "zge-preview"), markers = node("div", "zge-markers");
    canvas.width = 256; canvas.height = 1; bar.append(canvas, markers);
    let value = M.clone(options.value || { stops: builtins[0].stops }), selected = value.stops?.[0], kind = "color", editing = false, before, abortDrag;
    const advanced = options.advanced !== false, readonly = !!options.readOnly;
    const tools = node("div", "zge-tools"), fields = node("div", "zge-fields");
    function start() {
      if (editing) return true;
      if (readonly || options.onStart?.() === false) return false;
      editing = true; before = M.clone(value); return true;
    }
    function input() { options.onInput?.(M.clone(value)); paint(); }
    function finish(cancel = false) {
      if (!editing) return;
      const changed = JSON.stringify(before) !== JSON.stringify(value);
      if (cancel) { value = before; selected = value.stops?.[0]; options.onInput?.(M.clone(value)); }
      editing = false; options.onFinish?.(cancel || !changed); paint();
    }
    function run(work) { if (start()) { try { work(); input(); finish(); } catch (e) { finish(true); throw e; } } }
    function gesture(el, move, done) {
      el.addEventListener("pointerdown", e => {
        if (e.button !== 0 || readonly) return;
        e.preventDefault(); e.stopPropagation();
        if (!start()) return;
        el.focus(); abortDrag?.(); const controller = new AbortController();
        const end = (event, cancel) => { controller.abort(); abortDrag = null; if (!cancel) done?.(event); finish(cancel); };
        abortDrag = () => end(null, true);
        doc.addEventListener("pointermove", event => { move(event); input(); }, { signal: controller.signal });
        doc.addEventListener("pointerup", event => end(event, false), { once: true, signal: controller.signal });
        doc.addEventListener("pointercancel", event => end(event, true), { once: true, signal: controller.signal });
        doc.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); end(event, true); } }, { capture: true, signal: controller.signal });
        global.addEventListener("blur", () => end(null, true), { once: true, signal: controller.signal });
        // Color surfaces update on a click as well as during a drag.
        if (el.classList.contains("zge-sv")) { move(e); input(); }
      });
    }
    function button(label, action, parent = tools) {
      const b = node("button", "zge-button", label); b.type = "button"; b.textContent = label; b.disabled = readonly;
      b.onclick = e => { e.stopPropagation(); action(); }; parent.append(b); return b;
    }
    function currentList() { return kind === "opacity" ? value.opacityStops || [] : value.stops || []; }
    function sort() { value.stops.sort((a, b) => a.position-b.position); value.opacityStops?.sort((a, b) => a.position-b.position); }
    function remove() {
      const list = currentList(); if (!selected || list.length <= 1) return;
      run(() => { list.splice(list.indexOf(selected), 1); selected = list[0]; });
    }
    const position = node("input", "pz-inputbox", "Stop position"); position.type = "number"; position.min = 0; position.max = 100; position.step = "any";
    const opacity = node("input", "pz-inputbox", "Stop opacity"); opacity.type = "number"; opacity.min = 0; opacity.max = 100; opacity.step = "any";
    const mid = node("input", "pz-inputbox", "Midpoint"); mid.type = "number"; mid.min = 0; mid.max = 100; mid.step = "any";
    function field(label, input) { const line = node("label"); line.append(doc.createTextNode(label), input); fields.append(line); }
    field("Position %", position); field("Opacity %", opacity); if (advanced) field("Midpoint %", mid);
    position.onchange = () => run(() => { if (selected) { selected.position = M.clamp(Number(position.value)/100); sort(); } });
    opacity.onchange = () => run(() => { if (selected) { const a = M.clamp(Number(opacity.value)/100); if (kind === "opacity") selected.alpha = a; else selected.color = [...M.color(selected.color).slice(0, 3), a]; } });
    mid.onchange = () => run(() => { if (selected) selected.midpoint = M.clamp(Number(mid.value)/100); });
    button("Reverse", () => run(() => { value.stops = M.reverse(value.stops); if (value.opacityStops) value.opacityStops = M.reverse(value.opacityStops); selected = currentList()[0]; }));
    button("Distribute", () => run(() => { const list = currentList(); list.forEach((s, i) => { s.position = list.length > 1 ? i/(list.length-1) : 0; }); }));
    const del = button("Delete stop", remove);
    const panel = global.ZoidiumGradientColorPanel.create({ doc, node, gesture, run, start, finish, change(c) { if (selected && kind === "color") { selected.color = c; input(); } } });
    function add(t, opacityStop = false) {
      run(() => {
        kind = opacityStop ? "opacity" : "color";
        if (opacityStop && !value.opacityStops) value.opacityStops = [{ position: 0, alpha: 1 }, { position: 1, alpha: 1 }];
        selected = opacityStop ? { position: t, alpha: 1 } : { position: t, color: M.sample(value.stops, t) };
        currentList().push(selected); sort();
      });
    }
    bar.onclick = e => {
      if (e.target !== bar && e.target !== canvas) return;
      const r = bar.getBoundingClientRect(); add(M.clamp((e.clientX-r.left)/r.width), advanced && e.clientY < r.top+12);
    };
    function selectStop(stop, type) { selected = stop; kind = type; paint(); }
    function stopKey(event, stop, type) {
      if (readonly) return;
      selected = stop; kind = type;
      if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); remove(); }
      else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault(); run(() => { selected.position = M.clamp(selected.position+(event.key === "ArrowLeft" ? -1 : 1)*(event.shiftKey ? .01 : .001)); sort(); });
        markers.querySelector('[aria-pressed="true"]')?.focus();
      } else if (event.key === "Enter") { event.preventDefault(); (type === "color" ? panel.element.querySelector("input[aria-label='Hex color']") : opacity).focus(); }
    }
    function marker(stop, type) {
      const b = node("button", "zge-stop zge-stop-"+type, `${type === "color" ? "Color" : "Opacity"} stop at ${Math.round(stop.position*100)}%`);
      b.type = "button"; b.disabled = readonly; b.style.left = stop.position*100+"%";
      b.style.setProperty("--zge-stop-color", type === "color" ? M.rgba(M.color(stop.color)) : `rgba(255,255,255,${stop.alpha})`);
      b.setAttribute("aria-pressed", String(selected === stop && kind === type));
      b.onclick = e => { e.stopPropagation(); selectStop(stop, type); };
      b.ondblclick = e => { e.stopPropagation(); selectStop(stop, type); (type === "color" ? panel.element.querySelector("input") : opacity).focus(); };
      b.onkeydown = e => stopKey(e, stop, type);
      let moved = false;
      gesture(b, e => { selected = stop; kind = type; moved = true; const r = bar.getBoundingClientRect(); stop.position = M.clamp((e.clientX-r.left)/r.width); sort(); }, e => {
        if (!moved || !e) return;
        const r = bar.getBoundingClientRect(); selected = stop; kind = type;
        if (Math.abs(e.clientY-(r.top+r.height/2)) > 65 && currentList().length > 1) { currentList().splice(currentList().indexOf(stop), 1); selected = currentList()[0]; input(); }
      });
      return b;
    }
    const presets = node("div", "zge-presets", "Gradient presets");
    let users = [];
    try { const stored = JSON.parse(global.localStorage.getItem(STORAGE) || "[]"); if (Array.isArray(stored)) users = stored.filter(p => p && typeof p.name === "string" && Array.isArray(p.stops) && p.stops.length && p.stops.every(s => Number.isFinite(s.position) && Array.isArray(s.color) && s.color.length === 4 && s.color.every(Number.isFinite))).slice(0, 24); } catch { /* Local presets are optional. */ }
    function savePresets() { try { global.localStorage.setItem(STORAGE, JSON.stringify(users)); } catch { /* Keep session presets when storage is unavailable. */ } }
    function presetButtons() {
      presets.replaceChildren();
      [...builtins, ...users].forEach((p, i) => {
        const b = button(p.name, () => run(() => { value.stops = M.clone(p.stops); if (advanced) { delete value.opacityStops; if (p.opacityStops) value.opacityStops = M.clone(p.opacityStops); } selected = value.stops[0]; kind = "color"; }), presets);
        b.classList.add("zge-preset"); b.textContent = "";
        b.style.background = "linear-gradient(to right,"+p.stops.map(s => M.rgba(M.color(s.color))+" "+s.position*100+"%").join(",")+")";
        if (i >= builtins.length) {
          const remove = button("Remove "+p.name, () => { users.splice(i-builtins.length, 1); savePresets(); presetButtons(); }, presets);
          remove.textContent = "×"; remove.classList.add("zge-preset-remove");
        }
      });
      button("Save preset", () => { if (users.length >= 24) return; users.push({ name: "User preset "+(users.length+1), stops: value.stops.map(s => ({ ...s, color: M.color(s.color) })), ...(value.opacityStops ? { opacityStops: M.clone(value.opacityStops) } : {}) }); savePresets(); presetButtons(); }, presets);
    }
    function paint() {
      const ctx = canvas.getContext("2d"), image = ctx.createImageData(256, 1);
      const data = options.bake?.(value);
      for (let i = 0; i < 256; i++) { const c = data ? null : M.sample(value.stops, i/255); for (let j = 0; j < 4; j++) image.data[i*4+j] = data ? data[i*4+j] : Math.round(c[j]*255); }
      ctx.putImageData(image, 0, 0);
      markers.replaceChildren();
      for (const type of ["color", ...(advanced ? ["opacity"] : [])]) {
        const list = type === "color" ? value.stops || [] : value.opacityStops || [];
        list.forEach((s, i) => {
          markers.append(marker(s, type));
          if (advanced && i < list.length-1) {
            const next = list[i+1], b = node("button", "zge-mid zge-mid-"+type, "Edit "+type+" midpoint"); b.type = "button"; b.disabled = readonly;
            b.style.left = (s.position+(next.position-s.position)*(s.midpoint ?? .5))*100+"%";
            b.onclick = e => { e.stopPropagation(); selected = s; kind = type; paint(); mid.focus(); };
            gesture(b, e => { selected = s; kind = type; const r = bar.getBoundingClientRect(); s.midpoint = M.clamp(((e.clientX-r.left)/r.width-s.position)/Math.max(1e-12, next.position-s.position)); });
            markers.append(b);
          }
        });
      }
      if (advanced && !value.opacityStops) { bar.title = "Click above the bar to add opacity stops"; }
      if (!currentList().includes(selected)) selected = currentList()[0];
      for (const [el, v] of [[position, selected?.position*100], [opacity, (kind === "opacity" ? selected?.alpha : M.color(selected?.color)[3])*100], [mid, (selected?.midpoint ?? .5)*100]]) { if (doc.activeElement !== el) el.value = Number.isFinite(v) ? Math.round(v*1000)/1000 : 0; el.disabled = readonly || !selected; }
      del.disabled = readonly || currentList().length <= 1;
      panel.element.hidden = kind !== "color"; if (selected && kind === "color") panel.update(M.color(selected.color));
      options.onPaint?.(value, { node, gesture, run, input, selectStop, selected, stopKey, add, marker, kind });
    }
    root.append(bar, tools, fields, panel.element, presets); presetButtons(); panel.setDisabled(readonly);
    root.addEventListener("keydown", e => { if (!(e.ctrlKey || e.metaKey) || !["z", "y"].includes(e.key.toLowerCase())) e.stopPropagation(); });
    root.addEventListener("mousedown", e => e.stopPropagation());
    paint();
    return { element: root, get: () => M.clone(value), set(next) { if (editing) return; value = M.clone(next); selected = value.stops?.[0]; kind = "color"; paint(); }, get editing() { return editing; }, dispose() { abortDrag?.(); root.remove(); } };
  }
  global.ZoidiumGradientEditor = { create };
})(window);
