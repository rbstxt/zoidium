"use strict";

// Observe Text+ font failures without warning during ordinary asset loading.
// Native CM3 can leave its font promise pending after a parse failure. A
// read-only probe of an existing local Blob distinguishes that failure from
// a delayed, valid font. It never fetches or installs replacement font data.
const { state } = require("./text-plus-utils.js");
const { propertyValue } = require("./text-plus-controls.js");

const FONT_STAGES = [
  "font-missing", "font-not-loaded", "font-unreadable", "font-unparseable",
  "no-shapes", "empty-characters", "zero-vertices",
];
let warnedByText = new WeakMap();
let observedByText = new WeakMap();
let probesByFile = new WeakMap();
let generation = 0;

function hasVisibleCharacters(text) {
  return /\S/.test(String(text == null ? "" : text));
}

function describeTextFont(textObject) {
  const read = (name, fallback) => propertyValue(textObject?.properties?.[name], 0, fallback);
  const text = String(read("text", ""));
  const wrapper = textObject?.font;
  return {
    name: String(read("name", "Text") || "Text"),
    fontKey: String(read("font", "") || "unassigned"),
    fontName: String(wrapper?.asset?.filename || wrapper?.data?.fontFamilyName || ""),
    text,
    length: text.length,
  };
}

function formatTextFontMessage(stage, info, extra) {
  const details = {
    "font-missing": "no font asset is assigned",
    "font-not-loaded": "the font is still unloaded after loading finished",
    "font-unreadable": "the font asset could not be read",
    "font-unparseable": "the font bytes could not be parsed into usable font data",
    "no-shapes": "the loaded font produced zero glyph shapes",
    "empty-characters": "the loaded font produced empty character geometry",
    "zero-vertices": "the loaded font produced zero vertices",
  };
  const where = {
    "font-missing": "font asset", "font-not-loaded": "font load",
    "font-unreadable": "font load", "font-unparseable": "font parse",
    "no-shapes": "glyph shapes", "empty-characters": "character vertices",
    "zero-vertices": "text vertices",
  };
  const reason = extra?.reason ? `; ${String(extra.reason).replace(/\s+/g, " ").slice(0, 120)}` : "";
  const counts = extra?.missing ? `; ${extra.missing} of ${extra.total} non-blank characters are empty` : "";
  return `[Zoidium] text-plus: Text "${info.name}", font "${info.fontKey}"` +
    `${info.fontName ? ` (${info.fontName})` : ""}, string length ${info.length}: ` +
    `${details[stage]} (stage: ${where[stage]})${counts}${reason}.`;
}

function reportTextFontIssue(textObject, stage, extra) {
  if (!textObject || !FONT_STAGES.includes(stage)) return;
  const info = describeTextFont(textObject);
  if (!hasVisibleCharacters(info.text)) return;
  // Changing the asset or text is a new diagnostic, repeated failed builds
  // of the same input are not. A successful build clears this entry.
  const input = JSON.stringify([info.fontKey, info.text]);
  const signature = JSON.stringify([stage, extra]);
  let previous = warnedByText.get(textObject);
  if (!previous || previous.wrapper !== textObject.font || previous.input !== input) {
    previous = { wrapper: textObject.font, input, issues: new Set() };
    warnedByText.set(textObject, previous);
  }
  if (previous.issues.has(signature)) return;
  previous.issues.add(signature);
  try {
    globalThis.ZOIDIUM_DEBUG_LOG?.record?.("text-plus-font", {
      stage, text: info.name, font: info.fontKey, characters: info.length,
    });
  } catch (_error) {
    // Optional logging must never interrupt a Text rebuild.
  }
  console.warn(formatTextFontMessage(stage, info, extra));
}

function clearTextFontWarnings(textObject) {
  warnedByText.delete(textObject);
}

function countGeometryVertices(geometry) {
  const position = geometry?.attributes?.position;
  if (position && Number.isFinite(position.count)) return position.count;
  if (Array.isArray(geometry?.vertices)) return geometry.vertices.length;
  return -1;
}

function currentRecord(textObject) {
  const wrapper = textObject?.font;
  let record = observedByText.get(textObject);
  if (!record || record.wrapper !== wrapper) {
    record = { wrapper, font: wrapper?.font3d, data: wrapper?.font3d?.data, pending: null };
    observedByText.set(textObject, record);
  }
  return record;
}

// Run before the native Text update. A newly available font, or replaced font
// data, invalidates both the source geometry and Text+'s split mesh cache.
function observeFontRevision(textObject) {
  const record = currentRecord(textObject);
  const font = textObject.font?.font3d;
  if (record.font !== font || record.data !== font?.data) {
    record.font = font;
    record.data = font?.data;
    textObject.geometryNeedsUpdate = true;
  }
}

function validateFontBytes(bytes) {
  try {
    const data = new state.THREE.TTFLoader().parse(bytes);
    if (data?.glyphs && typeof data.familyName === "string") return;
  } catch (_error) {
    // CM3 also accepts JSON font data; apply the same fallback here.
  }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!data?.glyphs || typeof data.familyName !== "string") {
    throw new Error("No usable glyph table or font family name");
  }
}

function probeLocalFont(wrapper) {
  const file = wrapper?.asset?.file;
  if (!file || typeof file.arrayBuffer !== "function" || !state.THREE?.TTFLoader) return null;
  let probe = probesByFile.get(file);
  if (!probe) {
    probe = Promise.resolve().then(() => file.arrayBuffer()).then((bytes) => {
      try {
        validateFontBytes(bytes);
        return null;
      } catch (error) {
        return { stage: "font-unparseable", reason: error.message };
      }
    }, (error) => ({ stage: "font-unreadable", reason: error.message }));
    probesByFile.set(file, probe);
  }
  return probe;
}

function watchFontLoad(textObject) {
  const record = currentRecord(textObject);
  const wrapper = record.wrapper;
  if (!wrapper || wrapper.font3d) return;
  const pending = wrapper.loading3d;
  if (!pending || typeof pending.then !== "function" || record.pending === pending) return;
  record.pending = pending;
  const token = generation;
  const isCurrent = () => token === generation && textObject.font === wrapper;
  pending.then(() => {
    if (!isCurrent()) return;
    if (wrapper.font3d) {
      clearTextFontWarnings(textObject);
      textObject.geometryNeedsUpdate = true;
    } else {
      reportTextFontIssue(textObject, "font-unparseable");
    }
  }, (error) => {
    if (!isCurrent()) return;
    reportTextFontIssue(textObject, "font-unreadable", { reason: error?.message || String(error) });
  });
  // Native get3DFont() swallows parse errors and never settles its promise.
  // Checking only bytes already attached to the asset catches that case
  // without a timer, an extra network request, or a warning for valid bytes.
  probeLocalFont(wrapper)?.then((issue) => {
    if (isCurrent() && !wrapper.font3d && issue) reportTextFontIssue(textObject, issue.stage, issue);
  });
}

function reportUnavailableFont(textObject) {
  const wrapper = textObject?.font;
  const project = textObject?.parentProject;
  const projectReady = !!project && state.editor?.project === project;
  if (!wrapper) {
    if (projectReady) reportTextFontIssue(textObject, "font-missing");
    return;
  }
  if (wrapper.font3d) return;
  const asset = wrapper.asset;
  const fileSource = state.PZ?.asset?.source?.FILE;
  if (projectReady && fileSource !== undefined && asset?.source === fileSource && !asset.file) {
    reportTextFontIssue(textObject, "font-unreadable", { reason: "The project has no attached font file" });
  } else if (projectReady && !wrapper.loading3d && !textObject.fontNeedsUpdate) {
    reportTextFontIssue(textObject, "font-not-loaded");
  }
  // A pending load with valid bytes stays silent even after project open.
}

function resetTextFontDiagnostics() {
  generation += 1;
  warnedByText = new WeakMap();
  observedByText = new WeakMap();
  probesByFile = new WeakMap();
}

module.exports = {
  FONT_STAGES, hasVisibleCharacters, describeTextFont, formatTextFontMessage,
  reportTextFontIssue, reportUnavailableFont, countGeometryVertices,
  clearTextFontWarnings, resetTextFontDiagnostics, watchFontLoad,
  observeFontRevision, validateFontBytes,
};
