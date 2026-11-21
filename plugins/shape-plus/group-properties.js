"use strict";
const { KINDS, kindOf } = require("../shader-plus/kinds.js");

const STORAGE = "zoidiumGroupProperties";
const KINDS_IN_ORDER = ["slider", "checkbox", "angle", "point", "color4", "dropdown"];
const MAX_PROPERTIES = 64;
const clone = value => JSON.parse(JSON.stringify(value));

function validateGroupProperties(records, reserved = []) {
  if (records === undefined) return;
  if (!Array.isArray(records) || records.length > MAX_PROPERTIES) {
    throw Error("A Shape+ group supports up to " + MAX_PROPERTIES + " custom properties");
  }
  const names = new Set(reserved), ids = new Set();
  for (const record of records) {
    const definition = record?.type, kind = kindOf({ definition });
    const name = record?.properties?.name, id = definition?.zoidiumShapeGroup?.id;
    if (!KINDS_IN_ORDER.includes(kind) || !definition.custom || !definition.dynamic
        || typeof id !== "string" || !/^p[a-z0-9-]{1,64}$/i.test(id) || ids.has(id)) {
      throw Error("Invalid Shape+ group property");
    }
    const template = KINDS[kind].create();
    if (definition.type !== template.type || Boolean(definition.group) !== Boolean(template.group)
        || template.group && (!Array.isArray(definition.objects) || definition.objects.length !== template.objects.length
          || !definition.objects.every(axis => axis?.dynamic && axis.type === 0))) {
      throw Error("Invalid Shape+ group property type");
    }
    if (typeof name !== "string" || !name.trim() || names.has(name)) {
      throw Error("Property names must be nonempty and unique in the group");
    }
    names.add(name);
    ids.add(id);
  }
}

function definitionFor(kind, id) {
  if (!KINDS_IN_ORDER.includes(kind)) throw Error("Choose a group property kind");
  const definition = KINDS[kind].create();
  if (definition.zoidiumControl) {
    definition.zoidiumControl = definition.zoidiumControl.replace("shader-plus/", "shape-plus/group-");
  }
  definition.zoidiumShapeGroup = { id };
  return definition;
}

function createProperty(PZ, definition, data) {
  const property = PZ.property.create(clone(definition));
  const discrete = ["checkbox", "dropdown"].includes(kindOf(property));
  if (discrete) {
    property.defaultTween = 0;
    property.interpolated = false;
  }
  property.load(data && clone(data));
  return property;
}

function createRecord(PZ, definition, name) {
  const property = createProperty(PZ, definition);
  property.properties.name.set(name);
  return clone(property);
}

function restoreGroupProperties(PZ, group, records = []) {
  const reserved = Object.entries(group.properties).filter(([key]) => key !== STORAGE)
    .flatMap(([key, p]) => [key, p.definition.name]);
  validateGroupProperties(records, reserved);
  const properties = Object.fromEntries(records.map(record => [
    record.type.zoidiumShapeGroup.id, createProperty(PZ, record.type, record),
  ]));
  const list = group.groupProperties;
  if (list) {
    list.removeAll();
    list.addAll(properties);
  } else if (records.length) {
    group.properties.add(STORAGE, new PZ.propertyList(properties, group.properties));
  }
}

function readGroupProperties(group) {
  return Array.from(group.groupProperties || [], clone);
}

function editGroupProperties(editor, resolve, change) {
  const { createGesture } = require("./editor-history.js");
  const project = editor.project;
  const read = () => { const group = resolve(); return group ? readGroupProperties(group) : null; };
  const write = data => {
    const group = resolve();
    if (group) group.setGroupProperties(data);
  };
  const notify = () => {
    project.ui?.onChanged?.update();
    editor.mainViewport?.requestRender?.();
  };
  const gesture = createGesture(editor.history, read, write, notify, () => editor.project);
  if (!gesture.run(() => {
    const data = read();
    change(data);
    if (JSON.stringify(data) !== JSON.stringify(read())) write(data);
  })) throw Error("Finish the current edit before changing group properties");
}

module.exports = { STORAGE, KINDS_IN_ORDER, validateGroupProperties,
  definitionFor, createRecord, restoreGroupProperties, readGroupProperties, editGroupProperties };
