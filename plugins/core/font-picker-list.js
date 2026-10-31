(function (global) {
  "use strict";

  // Pure project-font list logic for the font picker (font-picker.js wires
  // it into the host controls). Kept free of DOM and host calls so Node
  // tests can drive it directly. Must load before font-picker.js.

  var SEPARATOR_LABEL = "Project fonts";

  function presetPath(name) {
    return "/assets/fonts/2d/" + name + ".ttf";
  }

  function isProjectKey(key) {
    return typeof key === "string" && key.length > 0 && key.charAt(0) !== "/";
  }

  function presetNameFromKey(key) {
    if (typeof key !== "string" || key.charAt(0) !== "/") return null;
    var match = /([^/]+)\.ttf$/.exec(key);
    return match ? match[1] : null;
  }

  // A project font is any FONT asset whose key is not a preset path. The
  // asset data map is keyed by asset class when the host provides it;
  // otherwise fall back to the file extension, mirroring the status probe.
  function assetIsFont(asset, PZ) {
    if (!asset) return false;
    try {
      if (asset.data && typeof asset.data.has === "function" && PZ && PZ.asset && PZ.asset.font) {
        if (asset.data.has(PZ.asset.font)) return true;
      }
    } catch (_error) {
      // Fall through to the extension check below.
    }
    var name = asset.filename || asset.key || asset.url || "";
    return /\.(ttf|otf|woff2?)(?:$|[?#])/i.test(name);
  }

  function collectProjectFonts(assetsList, PZ) {
    var entries = [];
    if (!assetsList || typeof assetsList !== "object") return entries;
    var seen = {};
    var keys = Object.keys(assetsList);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (!isProjectKey(key) || seen[key]) continue;
      var asset = assetsList[key];
      if (!assetIsFont(asset, PZ)) continue;
      seen[key] = true;
      entries.push({ key: key, asset: asset });
    }
    return entries;
  }

  function fileNameOf(entry) {
    var asset = entry && entry.asset;
    var name = (asset && (asset.filename || asset.key)) || (entry && entry.key) || "Untitled";
    return String(name);
  }

  // The family name from the parsed font's name table, plus the subfamily
  // when it is not Regular. Falls back to the file name until parsed.
  function labelFor(entry) {
    var font = entry && entry.font2d;
    var family = null;
    var subfamily = null;
    try {
      if (font && typeof font.getEnglishName === "function") {
        family = font.getEnglishName("fontFamily");
        subfamily = font.getEnglishName("fontSubfamily");
      }
    } catch (_error) {
      family = null;
    }
    if (typeof family !== "string" || !family) return fileNameOf(entry);
    var label = family;
    if (typeof subfamily === "string" && subfamily && subfamily.toLowerCase() !== "regular") {
      label += " " + subfamily;
    }
    return label;
  }

  function sortProjectFonts(entries) {
    var sorted = entries.slice();
    sorted.sort(function (left, right) {
      var a = labelFor(left).toLowerCase();
      var b = labelFor(right).toLowerCase();
      if (a < b) return -1;
      if (a > b) return 1;
      if (left.key < right.key) return -1;
      if (left.key > right.key) return 1;
      return 0;
    });
    return sorted;
  }

  // Row descriptors drive click and Enter; the separator is skipped by
  // keyboard navigation. Presets keep the host order first, so preset row
  // indexes match PZ.asset.font.preset indexes. The separator exists only
  // when the project holds at least one font.
  function buildDescriptors(presetNames, projectEntries) {
    var descriptors = [];
    for (var i = 0; i < presetNames.length; i += 1) {
      descriptors.push({ kind: "preset", index: i, name: presetNames[i] });
    }
    if (projectEntries.length > 0) {
      descriptors.push({ kind: "separator" });
      for (var j = 0; j < projectEntries.length; j += 1) {
        descriptors.push({ kind: "project", key: projectEntries[j].key });
      }
    }
    descriptors.push({ kind: "custom" });
    return descriptors;
  }

  // Maps a stored value to its row: a preset path through indexOf (as the
  // host does), a project key to its row, and anything else (custom file,
  // empty, or a removed asset) to the custom row, as the host does.
  function descriptorIndexForValue(descriptors, presetNames, value) {
    var custom = descriptors.length - 1;
    if (typeof value === "string" && value.charAt(0) === "/") {
      var name = presetNameFromKey(value);
      var at = presetNames.indexOf(name);
      if (at >= 0) {
        for (var i = 0; i < descriptors.length; i += 1) {
          if (descriptors[i].kind === "preset" && descriptors[i].index === at) return i;
        }
      }
      return custom;
    }
    if (isProjectKey(value)) {
      for (var j = 0; j < descriptors.length; j += 1) {
        if (descriptors[j].kind === "project" && descriptors[j].key === value) return j;
      }
    }
    return custom;
  }

  function stepIndex(descriptors, from, delta) {
    var next = from + delta;
    if (next < 0) next = 0;
    if (next > descriptors.length - 1) next = descriptors.length - 1;
    while (descriptors[next] && descriptors[next].kind === "separator") {
      next += delta > 0 ? 1 : -1;
      if (next < 0) { next = 0; break; }
      if (next > descriptors.length - 1) { next = descriptors.length - 1; break; }
    }
    return next;
  }

  function fileIdentity(asset) {
    if (!asset) return null;
    if (asset.file) return asset.file;
    return asset.url || asset.sha256 || null;
  }

  // Exposed for font-picker.js and Node tests; harmless in the browser.
  global.__zoidiumFontPicker = {
    presetPath: presetPath,
    isProjectKey: isProjectKey,
    presetNameFromKey: presetNameFromKey,
    assetIsFont: assetIsFont,
    collectProjectFonts: collectProjectFonts,
    fileNameOf: fileNameOf,
    labelFor: labelFor,
    sortProjectFonts: sortProjectFonts,
    buildDescriptors: buildDescriptors,
    descriptorIndexForValue: descriptorIndexForValue,
    stepIndex: stepIndex,
    fileIdentity: fileIdentity,
    SEPARATOR_LABEL: SEPARATOR_LABEL,
  };
})(globalThis);
