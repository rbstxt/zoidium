"use strict";

// ExpressText+ section header row and recovery of values the old row damaged.
//
// An effector section is a dynamic group whose definition type is VECTOR3, so
// saved projects route its row to CM3's three-field editor. That editor writes
// an array of three values through group.set(), which assigns every child: the
// first three rows take the fields and the next rows take undefined until the
// first nested vector row throws. A section row therefore shows no fields.

const { kindOfGroup } = require("./expresstext-sections.js");

const SECTION_ROW_CONTROL = "zoidium:expresstext-plus/section-row";
let unregisterControl = null;

function isSection(PZ, property) {
  const Group = PZ && PZ.property && PZ.property.dynamic && PZ.property.dynamic.group;
  return !!(
    Group &&
    property instanceof Group &&
    property.objects &&
    property.objects.length > 3 &&
    kindOfGroup(property)
  );
}

// The stamp is not enumerable, so saved files keep their exact definition.
function markSection(PZ, property) {
  if (!isSection(PZ, property) || !property.definition) return;
  Object.defineProperty(property.definition, "zoidiumControl", {
    value: SECTION_ROW_CONTROL, enumerable: false, configurable: true,
  });
}

function markSections(PZ, list) {
  const count = (list && list.length) || 0;
  for (let i = 0; i < count; i += 1) markSection(PZ, list[i]);
}

// Marks sections before the property panel's own list watcher renders them.
function watchSections(PZ, list) {
  if (list && list.onObjectAdded && typeof list.onObjectAdded.watch === "function") {
    list.onObjectAdded.watch((property) => markSection(PZ, property));
  }
}

function installSectionRow(PZ, apis) {
  const controls = apis && apis.propertyControls;
  if (unregisterControl || !controls || typeof controls.register !== "function") return false;
  try {
    unregisterControl = controls.register(SECTION_ROW_CONTROL, {
      type: PZ.property.type.VECTOR3,
      create(_property, context) {
        const box = context.document.createElement("div");
        box.classList.add("editbox");
        // The property panel calls pz_update on every row.
        box.pz_update = function () {};
        return box;
      },
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function uninstallSectionRow() {
  if (unregisterControl) unregisterControl();
  unregisterControl = null;
}

// True when a saved value can only come from the old row, given the row's
// place. Rows 1 to 3 took a number or NaN, which saves as null. Later rows took
// undefined, which saves as a missing value. Only a text row can show a number
// as damage, because a number row can hold any number.
function isDamagedValue(value, definition, PZ, index) {
  const types = PZ.property.type;
  const lost = value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));
  if (definition.type === types.TEXT) return lost || (index < 3 && typeof value === "number");
  if (definition.type === types.NUMBER || definition.type === types.OPTION) return lost;
  return false;
}

// Replaces only damaged values with the row's default. The old row stopped at
// the first nested vector, so that row and every later row stay as saved. Runs
// after the saved definitions are attached. Never throws.
function recoverSectionValues(PZ, liveList) {
  try {
    const count = (liveList && liveList.length) || 0;
    for (let i = 0; i < count; i += 1) {
      if (!isSection(PZ, liveList[i])) continue;
      const rows = liveList[i].objects;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!row || row.objects) break;
        const definition = row.definition;
        if (!definition || !row.keyframes || definition.value === undefined) continue;
        for (let k = 0; k < row.keyframes.length; k += 1) {
          const keyframe = row.keyframes[k];
          if (keyframe && isDamagedValue(keyframe.value, definition, PZ, index)) keyframe.value = definition.value;
        }
      }
    }
  } catch (_error) {}
}

module.exports = { SECTION_ROW_CONTROL, installSectionRow, isDamagedValue, isSection, markSection, markSections, recoverSectionValues, uninstallSectionRow, watchSections };
