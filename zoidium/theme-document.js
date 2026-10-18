(function (global) {
  "use strict";
  // Standalone help/legal pages share stored extension colors. They never
  // bootstrap CM3, load project data or change the source editor's UI.
  var model = global.ZoidiumUIBuilder.themeModel;
  function apply() {
    var settings = {}, themes = [];
    try {
      settings = JSON.parse(global.localStorage.getItem("zoidium.editor-settings") || "{}") || {};
      themes = model.parseStorage(global.localStorage.getItem("zoidium.themes"));
    } catch (_error) { /* Use the default palette when storage is unavailable. */ }
    var selected = themes.find(function (theme) { return theme.id === settings.themeId; });
    var palette = selected ? model.derive(selected.main, selected.overrides) : model.presetPalette(settings.theme, settings.hue, settings.saturation);
    var style = global.document.documentElement.style;
    var tokens = model.uiTokens(palette);
    Object.keys(tokens).forEach(function (key) { style.setProperty("--zui-" + key, tokens[key]); });
    style.setProperty("--zoidium-theme-focus", palette.focus);
    style.setProperty("--zoidium-theme-link", palette.link);
    style.setProperty("--zoidium-theme-focus-rgb", [1, 3, 5].map(function (i) { return parseInt(palette.focus.slice(i, i + 2), 16); }).join(" "));
  }
  apply();
  global.addEventListener("storage", apply);
})(window);
