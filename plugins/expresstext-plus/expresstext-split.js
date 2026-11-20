"use strict";

// ExpressText+ Split into letters: one 3D Text becomes a Group holding one
// Text per visible character, placed exactly where each letter was.
//
// Placement reuses the ExpressText+ layout math (getExpressLayout) plus the
// per-letter geometry boxes and centering the renderer uses, so a split
// text renders the same as the original. The whole command is a single
// history operation: one Ctrl+Z restores the original Text exactly (same
// object data, same parent, same index), Ctrl+Y redoes the split.

const { state } = require("./expresstext-constants.js");
const { numberValue } = require("./expresstext-select.js");
const { createLetterShapes, finiteBox, getExpressCenterOffset, propertyValue } = require("./expresstext-layout.js");
const { sourceExtrudeOptions } = require("./expresstext-render.js");

// Numeric PZ.object3d subtypes (see PZ.object3d.create): 1 is 3D Text,
// 5 is Group.
const TEXT_SUBTYPE = 1;
const GROUP_SUBTYPE = 5;

// Whitespace advances the cursor but produces no letter object.
function isSkippedCharacter(character) {
  return character === "" || /\s/.test(character);
}

// Code-point walk mirroring getExpressLayout (which walks UTF-16 units):
// identical output for BMP text, while a surrogate pair (emoji, etc.)
// stays one unit with one advance. Newlines reset the cursor and produce
// no unit, exactly like the layout.
function splitLetterUnits(text, fontData, size, spacing) {
  const data = fontData && typeof fontData === "object" ? fontData : {};
  const resolution = numberValue(data.resolution, 1000);
  const scale = resolution !== 0 ? numberValue(size, 100) / resolution : 0;
  const characterSpacing = numberValue(spacing, 0);
  const bounds = data.boundingBox || {};
  const lineHeight =
    (numberValue(bounds.yMax, 0) -
      numberValue(bounds.yMin, 0) +
      numberValue(data.underlineThickness, 0)) *
    scale;
  const glyphs = data.glyphs || {};
  const characters = Array.from(String(text == null ? "" : text));
  const units = [];
  let cursorX = 0;
  let cursorY = 0;
  let sourceIndex = 0;
  for (const character of characters) {
    if (character === "\n") {
      cursorX = 0;
      cursorY -= lineHeight;
      sourceIndex += character.length;
      continue;
    }
    const glyph = glyphs[character] || glyphs["?"] || null;
    const advance = glyph ? numberValue(glyph.ha, 0) * scale : 0;
    units.push({
      character,
      sourceIndex,
      index: units.length,
      x: cursorX,
      y: cursorY,
      advance,
    });
    cursorX += advance + characterSpacing;
    sourceIndex += character.length;
  }
  return { units, count: units.length, lineHeight };
}

// Per-character geometry boxes for the letter objects, keyed by character
// (measured once, reused). Characters with no outline (missing glyph and
// no "?" fallback) resolve to null: the letter object still exists and
// still advances, with a zero box, matching the layout cursor.
function measureSplitBoxes(THREE, font, characters, size, extrudeOptions) {
  const boxes = new Map();
  for (const character of characters) {
    if (boxes.has(character)) continue;
    let box = null;
    try {
      const shapes = createLetterShapes(THREE, font, character, size);
      if (shapes.length) {
        const geometry = new THREE.ExtrudeGeometry(shapes, extrudeOptions);
        box = finiteBox(geometry);
        try {
          geometry.dispose?.();
        } catch (_dispose) {}
      }
    } catch (_shapes) {
      box = null;
    }
    boxes.set(character, box);
  }
  return boxes;
}

function boxCenter(box) {
  if (!box || !box.min || !box.max) return [0, 0, 0];
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

// Local offsets for one Text object per visible character: the full-text
// anchor (unit cursor plus whole-text centering) minus the anchor the
// native single-character text computes for itself (own-box centering).
// Pure: boxes are {min,max} triples, no THREE needed.
function splitLetterPlacements(units, boxesByChar, positionMode) {
  const items = (units || []).filter(
    (unit) => unit && !isSkippedCharacter(unit.character)
  );
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const unit of items) {
    const box = boxesByChar.get(unit.character);
    if (!box) continue;
    bounds.min[0] = Math.min(bounds.min[0], box.min[0] + unit.x);
    bounds.min[1] = Math.min(bounds.min[1], box.min[1] + unit.y);
    bounds.min[2] = Math.min(bounds.min[2], box.min[2]);
    bounds.max[0] = Math.max(bounds.max[0], box.max[0] + unit.x);
    bounds.max[1] = Math.max(bounds.max[1], box.max[1] + unit.y);
    bounds.max[2] = Math.max(bounds.max[2], box.max[2]);
  }
  if (!(bounds.max[0] > bounds.min[0]) && !(bounds.max[1] > bounds.min[1])) {
    bounds.min = [0, 0, 0];
    bounds.max = [0, 0, 0];
  }
  const fullOffset = getExpressCenterOffset(bounds, positionMode);
  return items.map((unit) => {
    const box = boxesByChar.get(unit.character);
    const center = boxCenter(box);
    const singleOffset = getExpressCenterOffset(
      box
        ? { min: box.min.slice(), max: box.max.slice() }
        : { min: [0, 0, 0], max: [0, 0, 0] },
      positionMode
    );
    return {
      character: unit.character,
      unitIndex: unit.index,
      position: [
        unit.x + center[0] + fullOffset[0] - (center[0] + singleOffset[0]),
        unit.y + center[1] + fullOffset[1] - (center[1] + singleOffset[1]),
        center[2] + fullOffset[2] - (center[2] + singleOffset[2]),
      ],
    };
  });
}

// Static XYZ vector property data (single keyframe per axis at frame 0),
// matching the host's saved shape for unkeyframed dynamic vectors.
function staticVectorData(vector) {
  const values = [0, 1, 2].map((axis) => numberValue(vector && vector[axis], axis === 3 ? 1 : 0));
  return {
    objects: values.map((value) => ({
      animated: false,
      keyframes: [
        {
          value,
          frame: 0,
          tween: 1,
          controlPoints: [
            [-10, 0],
            [10, 0],
          ],
        },
      ],
    })),
  };
}

function cloneData(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function readRow(properties, key, frame, fallback) {
  try {
    return propertyValue(properties && properties[key], frame, fallback);
  } catch (_read) {
    return fallback;
  }
}

// Split one 3D Text into a Group of per-character Texts. One history
// operation: the Group lands at the original's parent and index holding
// one Text per placement, then the original is deleted — undo restores the
// original exactly, redo restores the split. Position/rotation/scale
// (keyframes and expressions included) move onto the Group; letters get
// static local offsets. Material and font are shared with the original,
// not cloned.
function runSplitTextIntoLetters(textObject, deps) {
  const host = (deps && deps.PZ) || state.PZ;
  if (!host || !host.object3d || !host.object3d.text) {
    throw new Error("Split into letters needs the CM3 3D Text API.");
  }
  if (!(textObject instanceof host.object3d.text)) {
    throw new Error("Split into letters needs a 3D Text object.");
  }
  // Stock deleteObject records its inverse as createObject with the removed
  // object's own type. Directly constructed texts (new PZ.object3d.text)
  // carry no type, which would rebuild the wrong class on undo — stamp it.
  if (textObject.type == null) textObject.type = TEXT_SUBTYPE;
  const edit = deps && deps.edit;
  const history = edit && edit.editor && edit.editor.history;
  if (!edit || !history || typeof edit.createObject !== "function") {
    throw new Error("Split into letters needs the editor history.");
  }
  const frame =
    (deps && Number.isFinite(deps.frame) && deps.frame) ||
    (Number.isFinite(edit.editor.playback && edit.editor.playback.currentFrame) &&
      edit.editor.playback.currentFrame) ||
    0;
  const THREE = (deps && deps.THREE) || state.THREE;
  if (!THREE) throw new Error("Split into letters needs THREE.");
  const properties = textObject.properties || {};
  const rawText = readRow(properties, "text", frame, "");
  const rawSize = readRow(properties, "size", frame, [20, 3]);
  const size = numberValue(Array.isArray(rawSize) ? rawSize[0] : rawSize, 20);
  const depth = numberValue(Array.isArray(rawSize) ? rawSize[1] : 3, 3);
  const spacing = readRow(properties, "spacing", frame, 0);
  const positionMode = readRow(properties, "positionMode", frame, 0);
  const font = textObject.font && textObject.font.font3d;
  const fontData = font && font.data;
  if (!fontData) throw new Error("Wait for the text font to finish loading before splitting.");
  const layout = splitLetterUnits(rawText, fontData, size, spacing);
  const targets = layout.units.filter(
    (unit) => !isSkippedCharacter(unit.character)
  );
  if (!targets.length) throw new Error("There are no letters to split out of this text.");
  const sourceOptions = sourceExtrudeOptions(textObject, null);
  const extrudeOptions = {
    amount: depth,
    depth,
    bevelEnabled: false,
    curveSegments: 6,
  };
  for (const key of Object.keys(sourceOptions || {})) {
    extrudeOptions[key] = sourceOptions[key];
  }
  const boxes = measureSplitBoxes(
    THREE,
    font,
    targets.map((unit) => unit.character),
    size,
    extrudeOptions
  );
  const placements = splitLetterPlacements(targets, boxes, positionMode);
  const parent = textObject.parent;
  if (!parent || typeof parent.indexOf !== "function") {
    throw new Error("Split into letters needs the text inside the project hierarchy.");
  }
  const originalIndex = parent.indexOf(textObject);
  if (originalIndex < 0) throw new Error("Split into letters needs the text inside the project hierarchy.");
  let parentAddress = null;
  try {
    parentAddress = parent.getAddress();
  } catch (_address) {
    parentAddress = null;
  }
  if (!Array.isArray(parentAddress)) {
    throw new Error("Split into letters needs the text inside the project hierarchy.");
  }
  const originalName = readRow(properties, "name", frame, "Text") || "Text";
  const propertiesJSON = JSON.parse(JSON.stringify(properties));
  let materialJSON = null;
  try {
    if (textObject.material) {
      const serialized = JSON.parse(JSON.stringify(textObject.material));
      if (serialized) materialJSON = serialized;
    }
  } catch (_material) {
    materialJSON = null;
  }
  const originalFont = textObject.font || null;
  const groupData = {
    properties: {
      name: `${originalName} letters`,
      position: cloneData(propertiesJSON.position) || staticVectorData([0, 0, 0]),
      rotation: cloneData(propertiesJSON.rotation) || staticVectorData([0, 0, 0]),
      scale: cloneData(propertiesJSON.scale) || staticVectorData([1, 1, 1]),
      eulerOrder: cloneData(propertiesJSON.eulerOrder) || "XYZ",
    },
    objects: [],
  };
  history.startOperation();
  try {
    edit.createObject({
      newParentAddress: parentAddress,
      newIdx: originalIndex,
      baseType: host.object3d,
      subType: GROUP_SUBTYPE,
      data: groupData,
    });
    const group = parent[originalIndex];
    if (!group || !group.objects) throw new Error("The letters group could not be created.");
    const groupAddress = group.objects.getAddress();
    const letters = [];
    for (const placement of placements) {
      const letterData = {
        properties: {
          ...cloneData(propertiesJSON),
          name: placement.character,
          text: placement.character,
          position: staticVectorData(placement.position),
          rotation: staticVectorData([0, 0, 0]),
          scale: staticVectorData([1, 1, 1]),
        },
      };
      if (materialJSON) letterData.material = cloneData(materialJSON);
      edit.createObject({
        newParentAddress: groupAddress,
        baseType: host.object3d,
        subType: TEXT_SUBTYPE,
        data: letterData,
      });
      const letter = group.objects[group.objects.length - 1];
      if (!letter) throw new Error("A letter object could not be created.");
      // The font row load already resolves the shared project asset in
      // the editor (same path, refcounted); headless fixtures carry the
      // live font object beside the rows, so share it when load left none.
      if (!letter.font && originalFont) letter.font = originalFont;
      letters.push(letter);
    }
    edit.deleteObject({
      oldParentAddress: parentAddress,
      oldIdx: originalIndex + 1,
    });
    history.finishOperation();
    return { group, letters };
  } catch (error) {
    try {
      if (history.operation !== null && history.operation !== undefined) {
        history.discardOperation();
      }
    } catch (_discard) {}
    throw error;
  }
}

function shouldOfferSplit(host, object) {
  try {
    return !!(
      host &&
      host.object3d &&
      host.object3d.text &&
      object instanceof host.object3d.text
    );
  } catch (_check) {
    return false;
  }
}

// 3D Text row command, the same shape as Shape+ "Convert to Shape+":
// a change button on the row, error notice instead of a throw.
function installSplitCommand(deps) {
  const host = (deps && deps.PZ) || (typeof window !== "undefined" && window.PZ) || null;
  const proto = host && host.ui && host.ui.edit && host.ui.edit.prototype;
  const original =
    proto && typeof proto.generateItemCommands === "function"
      ? proto.generateItemCommands
      : null;
  if (!host || !proto || !original) return () => {};
  const notify =
    (deps && deps.notify) ||
    ((error) => {
      try {
        console.error("[ExpressText+]", error && error.message);
      } catch (_log) {}
    });
  function replacement(row, object) {
    const result = original.apply(this, arguments);
    try {
      if (
        shouldOfferSplit(host, object) &&
        !this.options.hideAllListItemButtons
      ) {
        const button = this.generateButton("change");
        button.title = "Split into letters";
        button.setAttribute("aria-label", button.title);
        button.onclick = (event) => {
          event.stopPropagation();
          try {
            const edit = this;
            const atFrame =
              (edit.editor &&
                edit.editor.playback &&
                Number.isFinite(edit.editor.playback.currentFrame) &&
                edit.editor.playback.currentFrame) ||
              0;
            runSplitTextIntoLetters(object, { PZ: host, edit, frame: atFrame });
          } catch (error) {
            notify({ title: "ExpressText+", message: error.message });
          }
        };
        row.children[1].prepend(button);
      }
    } catch (_button) {}
    return result;
  }
  proto.generateItemCommands = replacement;
  return () => {
    if (proto.generateItemCommands === replacement) {
      proto.generateItemCommands = original;
    }
  };
}

module.exports = {
  GROUP_SUBTYPE,
  TEXT_SUBTYPE,
  installSplitCommand,
  isSkippedCharacter,
  measureSplitBoxes,
  runSplitTextIntoLetters,
  shouldOfferSplit,
  splitLetterPlacements,
  splitLetterUnits,
  staticVectorData,
};
