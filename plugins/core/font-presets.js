(function (global) {
  "use strict";

  // Zoidium built-in font presets. These names join the host preset list in
  // alphabetical order before the font dropdown is first built, so the row
  // order matches the generated preview sprite (fonts/font-previews.svg).
  // Saved projects store font paths, not row indices, so extending the list
  // is safe. The array is mutated in place because other controls keep a
  // reference to it. Re-running is safe: the indexOf check pushes nothing
  // twice. The marker lives on the list object itself, so a replaced array
  // is patched again instead of skipped. Keep this list synced with
  // fonts/presets.json: tools/build-font-previews.js --check fails when they
  // differ.
  var PRESET_NAMES = ["geist", "geist mono", "geist pixel circle", "geist pixel grid", "geist pixel line", "geist pixel square", "geist pixel triangle", "geist serif", "geist serif heart", "geist serif square", "geist serif triangle", "inter", "paper mono"];

  var PZ = global.PZ;
  var list = PZ && PZ.asset && PZ.asset.font && PZ.asset.font.preset;
  if (!Array.isArray(list) || list.__zoidiumFontPresetsPatched) return;
  for (var i = 0; i < PRESET_NAMES.length; i += 1) {
    if (list.indexOf(PRESET_NAMES[i]) < 0) list.push(PRESET_NAMES[i]);
  }
  list.sort();
  try {
    Object.defineProperty(list, "__zoidiumFontPresetsPatched", { value: true });
  } catch (_error) {
    // The marker is best-effort; the indexOf check above already dedupes.
  }
})(globalThis);
