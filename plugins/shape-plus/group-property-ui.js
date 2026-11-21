"use strict";
const { matchesController } = require("../shader-plus/visibility.js");
const { installPropertyControls } = require("../shader-plus/property-controls.js");
const { registerAngle } = require("../shader-plus/angle-control.js");
const { createRecord, editGroupProperties } = require("./group-properties.js");
const { openSettings } = require("./group-property-settings.js");
const { find } = require("./editor-tree-data.js");

const STYLE = "./plugins/shader-plus/property-controls.css";
const propertyId = property => property.definition.zoidiumShapeGroup.id;
const recordId = record => record.type.zoidiumShapeGroup.id;

function install(context, Layer, Content) {
  const { PZ, document: doc, lifecycle, ui } = context;
  const register = (id, type, create) => lifecycle.onDispose(context.apis.propertyControls.register(
    id.replace("shader-plus/", "shape-plus/group-"), { type, create },
  ));
  const { commit } = installPropertyControls({ PZ, doc, register, editor: () => context.editor });
  const angle = registerAngle({ PZ, doc, register, commit });
  lifecycle.onDispose(() => angle.close());
  const style = doc.createElement("style");
  style.textContent = context.getAsset("text", STYLE)
    + "\n.shape-plus-group-property[hidden],.shape-plus-group-property-button[hidden],.shape-plus-group-property[hidden]+ul{display:none!important}";
  doc.head.append(style);
  lifecycle.onDispose(() => style.remove());

  let active;
  const reveals = new WeakSet();
  const buttons = new WeakMap();
  function close() { active?.panel.remove(); active = null; }
  lifecycle.onDispose(close);

  function resolveGroup(editor, group) {
    const project = editor.project, layer = group.tryGetParentOfType(Layer), address = layer?.getAddress();
    return () => {
      if (editor.project !== project || !address) return null;
      try { return find(project.addressLookup(address).contents, group.id)?.item || null; }
      catch { return null; }
    };
  }
  function change(editor, group, edit) {
    const resolve = resolveGroup(editor, group);
    if (resolve() !== group) throw Error("This group is no longer available");
    if (globalThis.ZoidiumTrackSwitches?.isLocked(group)) throw Error("The layer is locked");
    editGroupProperties(editor, resolve, edit);
  }
  function settings(row, view, group, property) {
    close();
    const panel = openSettings(row, group, property, (definition, name) => {
      change(view.editor, group, records => {
        if (!property) {
          records.push(createRecord(PZ, definition, name));
          return;
        }
        const entry = records.find(record => recordId(record) === propertyId(property));
        if (!entry) throw Error("This property is no longer available");
        if (entry.type.zoidiumShader.kind !== definition.zoidiumShader.kind &&
            ["checkbox", "dropdown"].includes(definition.zoidiumShader.kind)) {
          for (const key of entry.keyframes) key.tween = 0;
        }
        entry.type = definition;
        entry.properties.name = name;
      });
    }, close);
    active = { row, panel };
  }
  function button(view, row, icon, label, run) {
    const el = view.generateButton(icon);
    el.classList.add("shape-plus-group-property-button");
    el.title = label;
    el.setAttribute("aria-label", label);
    el.onclick = event => { event.stopPropagation(); run(el); };
    row.children[1].classList.add("actions");
    row.children[1].prepend(el);
    return el;
  }
  function decorate(view, row, object) {
    if (object instanceof Content && object.kind === "group") {
      button(view, row, "add", "Add group property", () => settings(row, view, object));
      const show = button(view, row, "visible", "Show hidden group properties", el => {
        if (reveals.has(object)) reveals.delete(object);
        else reveals.add(object);
        el.setAttribute("aria-pressed", String(reveals.has(object)));
      });
      show.hidden = true;
      show.setAttribute("aria-pressed", String(reveals.has(object)));
      buttons.set(object, show);
      return;
    }
    if (!(object instanceof PZ.property)) return;
    const group = object.parent?.parentObject;
    if (!(group instanceof Content) || object.parent !== group.groupProperties) return;
    row.classList.add("shape-plus-group-property", "zsp-property");
    const help = object.definition.zoidiumShapeGroup.help;
    if (help) { row.title = help; row.firstElementChild.title = help; }
    row.oncontextmenu = event => {
      event.preventDefault();
      event.stopPropagation();
      const siblings = Array.from(group.groupProperties);
      const index = siblings.indexOf(object);
      const update = edit => {
        close();
        try { change(view.editor, group, edit); }
        catch (error) { ui.notify({ title: "Shape+", message: error.message }); }
      };
      const move = delta => update(records => {
        const i = records.findIndex(record => recordId(record) === propertyId(object));
        if (i < 0 || !records[i + delta]) return;
        [records[i], records[i + delta]] = [records[i + delta], records[i]];
      });
      ui.openMenu({ owner: row, x: event.clientX, y: event.clientY, items: [
        { label: "Property settings…", action: () => settings(row, view, group, object) },
        { label: "Move up", disabled: index <= 0, action: () => move(-1) },
        { label: "Move down", disabled: index >= siblings.length - 1, action: () => move(1) },
        { label: "Delete", action: () => update(records => {
          const i = records.findIndex(record => recordId(record) === propertyId(object));
          if (i >= 0) records.splice(i, 1);
        }) },
      ] });
    };
  }

  function update(list, frame) {
    const group = list.pz_object?.parent;
    if (!(group instanceof Content) || list.pz_object !== group.properties) return;
    const records = group.groupProperties;
    const show = buttons.get(group);
    if (!records) return;
    let conditional = false;
    for (const row of list.children) {
      const property = row.pz_object;
      if (!property || property.parent !== records) continue;
      const when = property.definition.zoidiumShapeGroup.visibleWhen;
      conditional ||= !!when;
      const controller = when && records[when.property];
      const hidden = !!when && (!controller || !matchesController(when, controller, controller.get(frame - controller.frameOffset)));
      const reveal = hidden && reveals.has(group);
      row.hidden = hidden && !reveal;
      row.classList.toggle("zsp-hidden-property", reveal);
    }
    if (show) show.hidden = !conditional;
  }

  return { decorate, update, unload(row) { if (active?.row === row) close(); } };
}

module.exports = { install };
