"use strict";
const model = require("./looks-instances.js");

function mount({ state, body, effect, session, view, custom }) {
  const { ui, editor: CM, Looks } = state, tools = Looks.tools, ctl = ui.controls;
  const root = document.createElement("div"); root.className = "lk-root lk-instances";
  body.appendChild(root);
  let widgets = [], propertyView = null, timer, signature = "", disposed = false, dragging = null;
  const snapshot = target => ({ schema: model.clone(target.looksInstances),
    properties: model.clone(target.properties) });
  function notify() { CM.project.ui?.onChanged?.update(); }
  function apply(target, data) { target.looksSetInstances(data.schema, data.properties); notify(); }
  function exchange(command) {
    const target = CM.project.addressLookup(command.address, 0);
    if (!target?.looksSetInstances) return;
    const before = snapshot(target), selected = view.selectedTool;
    apply(target, command.data);
    if (target === effect) view.selectedTool = model.selection(target.looksInstances, command.selected);
    CM.history.pushCommand(exchange, { ...command, data: before, selected });
  }
  function commit(schema, properties = snapshot(effect).properties, selected = view.selectedTool) {
    if (!effect.parent || effect.parentProject !== CM.project || CM.history.operation !== null) return false;
    const before = snapshot(effect), previousSelection = view.selectedTool;
    if (JSON.stringify(before) === JSON.stringify({ schema, properties })) return false;
    CM.history.startOperation();
    try {
      apply(effect, { schema, properties });
      view.selectedTool = model.selection(schema, selected, before.schema.order);
      CM.history.pushCommand(exchange, { address: effect.getAddress(), data: before, selected: previousSelection });
      CM.history.finishOperation();
    } catch (error) {
      try { apply(effect, before); } finally { CM.history.discardOperation(); }
      throw error;
    }
    rebuild(); return true;
  }
  function add(tool, duplicate) {
    const current = effect.looksInstances;
    const next = model.append(current, tool, tools, duplicate?.id);
    const instance = next.order.find(item => !current.order.some(old => old.id === item.id));
    const properties = snapshot(effect).properties;
    if (duplicate) for (const key of model.toolKeys(tool, tools)) {
      properties[model.key(instance.id, key)] = model.clone(properties[model.key(duplicate.id, key)]);
    }
    commit(next, properties, instance.id);
  }
  function el(tag, text, className) {
    const result = document.createElement(tag);
    if (text) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  function button(title, action, disabled = false, hint) {
    const control = ctl.button({ title, onClick: action, hint });
    control.setDisabled(disabled); control.element.dataset.action = title;
    return control.element;
  }
  function sectionFor(title, id, collapsed = false) {
    view.sections ||= {};
    const section = ctl.section({ title, collapsed: view.sections[id] ?? collapsed });
    section.element.querySelector(".zoidium-section-title").addEventListener("click", () => {
      view.sections[id] = section.element.classList.contains("collapsed");
    });
    return section;
  }
  function chainSection() {
    const section = sectionFor("Tool chain", "chain"), chain = effect.looksInstances.order;
    const list = el("ol", null, "lk-chain");
    list.setAttribute("aria-label", "Tool chain");
    for (const [index, item] of chain.entries()) {
      const tool = tools.byId(item.tool), key = model.key(item.id, tools.propMap()[item.tool].enable);
      const on = effect.properties[key].get(CM.playback.currentFrame - effect.properties[key].frameOffset) === 1;
      const row = el("li", null, "lk-chain-row"); row.dataset.instance = item.id;
      row.classList.toggle("selected", view.selectedTool === item.id);
      row.draggable = true;
      row.addEventListener("dragstart", event => { dragging = item.id; event.dataTransfer.setData("text/plain", item.id); });
      row.addEventListener("dragend", () => { dragging = null; });
      row.addEventListener("dragover", event => { if (dragging) event.preventDefault(); });
      row.addEventListener("drop", event => {
        event.preventDefault();
        const id = dragging; dragging = null;
        if (id) commit(model.move(effect.looksInstances, id, index, tools), undefined, id);
      });
      const select = el("button", `${index + 1}. ${tool.name} ${item.id.slice(1)}`, "lk-chain-select");
      select.title = select.textContent;
      select.dataset.action = "select";
      select.type = "button"; select.setAttribute("aria-pressed", String(view.selectedTool === item.id));
      select.addEventListener("click", () => { view.selectedTool = item.id; rebuild(); });
      select.addEventListener("keydown", event => {
        if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault(); commit(model.move(effect.looksInstances, item.id, index + (event.key === "ArrowUp" ? -1 : 1), tools), undefined, item.id);
        } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? chain.length - 1 :
            Math.max(0, Math.min(chain.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
          view.selectedTool = chain[next].id; rebuild();
          root.querySelector(`[data-instance="${view.selectedTool}"] .lk-chain-select`)?.focus({ preventScroll: true });
          root.querySelector(`[data-instance="${view.selectedTool}"]`)?.scrollIntoView({ block: "nearest" });
        }
      });
      const actions = el("div", null, "lk-chain-actions");
      actions.append(button(on ? "On" : "Off", () => { view.selectedTool = item.id; session.commit([{ key, value: on ? 0 : 1 }]); rebuild(); }, false,
        "Enable or disable " + tool.name),
      button("Duplicate", () => add(item.tool, item), chain.length >= model.MAX_INSTANCES),
      button("Remove", () => commit(model.remove(effect.looksInstances, item.id, tools))));
      row.append(select, actions);
      list.appendChild(row);
    }
    if (!chain.length) section.body.appendChild(ctl.note("Add a tool to start your look.").element);
    section.body.appendChild(list);
    const index = chain.findIndex(item => item.id === view.selectedTool);
    const moves = el("div", null, "lk-chain-moves");
    moves.append(button("Move up", () => commit(model.move(effect.looksInstances, view.selectedTool, index - 1, tools)), index <= 0),
      button("Move down", () => commit(model.move(effect.looksInstances, view.selectedTool, index + 1, tools)), index < 0 || index >= chain.length - 1));
    section.body.appendChild(moves);
    const category = ctl.select({ label: "Category", value: view.toolGroup || "color",
      options: tools.GROUPS.map(group => ({ value: group.id, label: group.name })),
      onChange(value) { view.toolGroup = value; rebuild(); } });
    section.body.appendChild(category.element);
    const picker = ctl.select({ label: "Add tool", value: "", options: [{ value: "", label: "Choose a tool" }].concat(
      tools.TOOLS.filter(tool => tool.group === (view.toolGroup || "color")).map(tool => ({ value: tool.id, label: tool.name }))),
    onChange(tool) { if (tool) add(tool); } });
    picker.setDisabled(chain.length >= model.MAX_INSTANCES);
    section.body.appendChild(picker.element);
    return section.element;
  }
  function resetProperties(properties, schema) {
    for (const instance of schema.order) for (const key of model.toolKeys(instance.tool, tools)) {
      delete properties[model.key(instance.id, key)];
    }
  }
  function applyPreset(preset) {
    let schema = effect.looksInstances;
    const properties = snapshot(effect).properties;
    resetProperties(properties, schema);
    for (const [toolId, patch] of Object.entries(preset.tools)) {
      let item = schema.order.find(item => item.tool === toolId);
      if (!item) { schema = model.append(schema, toolId, tools); item = schema.order.at(-1); }
      const map = tools.propMap()[toolId];
      const write = (key, value) => { properties[model.key(item.id, key)] = { keyframes: [{ frame: 0, value, tween: 1 }] }; };
      write(map.enable, 1);
      for (const [name, value] of Object.entries(patch.p || {})) write(map.params[name], value);
      for (const [name, rgb] of Object.entries(patch.w || {})) {
        const keys = map.wheels[name] || map.custom.fourway?.[name];
        keys?.forEach((key, index) => write(key, rgb[index]));
      }
    }
    commit(schema, properties);
  }
  function lookSection() {
    const section = sectionFor("Look presets", "presets", true);
    const search = ctl.text({ label: "Search looks", value: view.filter.text,
      onChange(value) { view.filter.text = String(value).toLowerCase(); rebuild(); } });
    search.element.querySelector("input").setAttribute("aria-label", "Search looks");
    section.body.appendChild(search.element);
    section.body.appendChild(ctl.select({ label: "Look", value: "", options: [{ value: "", label: "Choose a look" }].concat(
      tools.PRESETS.filter(p => p.name.toLowerCase().includes(view.filter.text)).map(p => ({ value: p.id, label: p.group + " · " + p.name }))),
    onChange(id) { const preset = tools.PRESETS.find(item => item.id === id); if (preset) applyPreset(preset); } }).element);
    section.body.appendChild(button("Clear look", () => {
      const properties = snapshot(effect).properties; resetProperties(properties, effect.looksInstances);
      commit(effect.looksInstances, properties);
    }));
    return section.element;
  }
  function parameters() {
    const section = sectionFor("Parameters", "parameters");
    section.element.classList.add("lk-parameters");
    section.element.dataset.selected = view.selectedTool || "";
    const item = effect.looksInstances.order.find(item => item.id === view.selectedTool);
    if (!item) return section.element;
    const tool = tools.byId(item.tool), keys = model.toolKeys(item.tool, tools);
    section.element.querySelector(".zoidium-section-title span:last-child").textContent =
      "Parameters · " + tool.name + " " + item.id.slice(1);
    const mapKey = key => model.key(item.id, key);
    propertyView = ui.properties({ target: effect, labelWidth: 0.46,
      keys: keys.map(mapKey).filter(key => effect.properties[key].definition.visible !== false) });
    section.body.appendChild(propertyView.element);
    const projected = { properties: {}, parent: effect.parent, parentProject: effect.parentProject };
    for (const key of keys) projected.properties[key] = effect.properties[mapKey(key)];
    const mappedSession = {
      live: (key, value) => session.live(mapKey(key), value),
      commit: writes => session.commit(writes.map(write => ({ ...write, key: mapKey(write.key) }))),
    };
    const after = () => rebuild();
    const localFrame = CM.playback.currentFrame - effect.properties.enabled.frameOffset;
    effect.update(localFrame);
    const stage = effect._looksPipeline.stage(item.id);
    projected._looksLutAssets = stage?._looksLutAssets;
    projected._looksCubeError = stage?._looksCubeError;
    projected._looksCubeAtlas = stage?._looksCubeAtlas;
    projected.prepare = () => effect.prepare(localFrame);
    if (tool.custom === "curves") custom.buildCurves(projected, mappedSession, tool, section.body, widgets, after, view);
    else if (tool.custom === "scurve") custom.buildScurve(projected, mappedSession, tool, section.body, after);
    else if (tool.custom === "lut") Looks.lutUI.buildLut({ Looks, ctl, effect: projected, session: mappedSession,
      tool, body: section.body, view, afterCommit: after, nativeParameters: true, ...custom.lut });
    // Wheels keep the visual tint gesture alongside the native RGB channels.
    custom.buildWheels(projected, mappedSession, tool, section.body, widgets, after);
    if (tool.custom === "fourway") custom.buildFourway(projected, mappedSession, tool, section.body, widgets, after);
    return section.element;
  }
  function historySig() { return JSON.stringify([CM.history.undoStack.length, CM.history.redoStack.length, effect.looksInstances]); }
  function cleanupViews() {
    propertyView?.dispose(); propertyView = null;
    for (const widget of widgets) widget.destroy(); widgets = [];
  }
  function rebuild() {
    if (disposed) return;
    const scroll = body.scrollTop, chainScroll = root.querySelector(".lk-chain")?.scrollTop || 0;
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const row = focused?.closest(".lk-chain-row");
    const action = focused?.dataset.action;
    const oldSelection = root.dataset.selected;
    const fields = "button,input,select,textarea,canvas";
    const focusIndex = Array.from(root.querySelectorAll(fields)).indexOf(focused);
    cleanupViews(); root.textContent = "";
    view.selectedTool = model.selection(effect.looksInstances, view.selectedTool);
    root.dataset.selected = view.selectedTool || "";
    root.append(chainSection(), parameters(), lookSection());
    if (row && action) {
      const changed = oldSelection !== root.dataset.selected;
      const id = !changed && effect.looksInstances.order.some(item => item.id === row.dataset.instance) ? row.dataset.instance : view.selectedTool;
      const nextRow = root.querySelector(`.lk-chain-row[data-instance="${id}"]`);
      Array.from(nextRow?.querySelectorAll("button") || []).find(button => button.dataset.action === (changed ? "select" : action))?.focus({ preventScroll: true });
    } else if (focusIndex >= 0 && oldSelection === root.dataset.selected) {
      root.querySelectorAll(fields)[focusIndex]?.focus({ preventScroll: true });
    }
    const chain = root.querySelector(".lk-chain");
    chain.scrollTop = chainScroll;
    const selected = chain.querySelector(".selected");
    if (selected) {
      const item = selected.getBoundingClientRect(), list = chain.getBoundingClientRect();
      if (item.top < list.top) chain.scrollTop += item.top - list.top;
      else if (item.bottom > list.bottom) chain.scrollTop += item.bottom - list.bottom;
    }
    body.scrollTop = scroll; signature = historySig();
  }
  rebuild();
  timer = setInterval(() => { if (historySig() !== signature) rebuild(); }, 200);
  return () => { disposed = true; clearInterval(timer); cleanupViews(); root.remove(); };
}
module.exports = { mount };
