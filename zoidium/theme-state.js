(function (global) {
  "use strict";
  var builder = global.ZoidiumUIBuilder;
  var model = builder.themeModel;
  var host = null, themes = [], undo = [], redo = [], baseline = null, pending = null;
  var status = "";
  try { themes = model.parseStorage(global.localStorage.getItem("zoidium.themes")); } catch (_error) { /* Session storage only. */ }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function selected() { return themes.find(function (theme) { return theme.id === host.get().themeId; }) || null; }
  function palette() {
    var theme = selected(), settings = host.get();
    return theme ? model.derive(theme.main, theme.overrides) : model.presetPalette(settings.theme, settings.hue, settings.saturation);
  }
  function snapshot() {
    var settings = host.get();
    return clone({ themes: themes, themeId: settings.themeId || null, theme: settings.theme, hue: settings.hue, saturation: settings.saturation });
  }
  function restore(value) {
    themes = clone(value.themes);
    Object.assign(host.get(), { themeId: value.themeId, theme: value.theme, hue: value.hue, saturation: value.saturation });
  }
  function changed() {
    try { global.localStorage.setItem("zoidium.themes", JSON.stringify({ version: 1, themes: themes })); } catch (_error) { /* Session storage only. */ }
    // Settings applies the palette and notifies every open editor once.
    host.apply();
  }
  function transact(fn, message) {
    var before = snapshot();
    status = message || "";
    fn();
    if (JSON.stringify(before) !== JSON.stringify(snapshot())) { undo.push(before); redo = []; }
    changed();
  }
  function newId() { return "user:" + global.crypto.randomUUID(); }
  function name() {
    var theme = selected();
    return theme ? theme.name : (model.PRESETS.find(function (preset) { return preset.value === host.get().theme; }) || model.PRESETS[0]).label;
  }
  function editable() {
    var theme = selected();
    if (theme) return theme;
    var original = name();
    theme = Object.assign({ id: newId(), name: model.uniqueName(original + " copy", themes) }, model.copyPalette(palette()));
    themes.push(theme); host.get().themeId = theme.id;
    status = 'Created "' + theme.name + '" in My themes.';
    return theme;
  }
  var api = {
    configure: function (adapter) {
      host = adapter;
      if (host.get().themeId && !selected()) { host.get().themeId = null; host.get().theme = "panzoid"; host.get().hue = 0; }
    },
    themes: function () { return clone(themes); },
    selected: selected, palette: palette, name: name,
    selection: function () { return host.get().themeId || host.get().theme; },
    status: function () { return status; },
    openSession: function () { baseline = snapshot(); undo = []; redo = []; status = ""; },
    isDirty: function () { return baseline && JSON.stringify(baseline) !== JSON.stringify(snapshot()); },
    canUndo: function () { return undo.length > 0; },
    canRedo: function () { return redo.length > 0; },
    undo: function () { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); status = "Theme edit undone."; changed(); },
    redo: function () { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); status = "Theme edit redone."; changed(); },
    revert: function () { if (baseline) transact(function () { restore(baseline); }, "Restored the themes from when this window opened."); },
    select: function (id) {
      transact(function () {
        var preset = model.PRESETS.find(function (entry) { return entry.value === id; });
        host.get().themeId = preset ? null : id;
        if (preset) { host.get().theme = id; if (id !== "custom") host.get().hue = preset.hue; }
      });
    },
    edit: function (section, key, value) {
      transact(function () {
        var theme = editable();
        if (section === "main") theme.main = value;
        else if (value === null) delete theme[section][key];
        else theme[section][key] = value;
      });
    },
    resetClips: function () { transact(function () { editable().clips = {}; }); },
    duplicate: function () {
      transact(function () {
        var source = selected() ? clone(selected()) : model.copyPalette(palette());
        source.id = newId(); source.name = model.uniqueName(name() + " copy", themes);
        themes.push(source); host.get().themeId = source.id;
      }, "Theme duplicated.");
    },
    rename: function (value) {
      if (!selected() || !value.trim()) return;
      transact(function () { selected().name = model.uniqueName(value, themes.filter(function (theme) { return theme !== selected(); })); }, "Theme renamed.");
    },
    remove: function () {
      if (!selected()) return;
      transact(function () {
        themes = themes.filter(function (theme) { return theme !== selected(); });
        host.get().themeId = null; host.get().theme = "panzoid"; host.get().hue = 0;
      }, "Theme deleted. Undo restores it.");
    },
    import: function (text) {
      var theme = model.parseImport(text);
      transact(function () {
        theme.id = newId(); theme.name = model.uniqueName(theme.name, themes);
        themes.push(theme); host.get().themeId = theme.id;
      }, "Theme imported.");
    },
    export: function () {
      var theme = selected() ? clone(selected()) : Object.assign({ id: newId(), name: name() }, model.copyPalette(palette()));
      return JSON.stringify({ version: 1, theme: theme }, null, 2) + "\n";
    },
    beginPreview: function () { pending = snapshot(); },
    preview: function (section, key, value) {
      var theme = editable();
      if (section === "main") theme.main = value;
      else theme[section][key] = value;
      changed();
    },
    finishPreview: function (cancelled) {
      if (!pending) return;
      if (cancelled) { restore(pending); status = "Color change cancelled."; }
      else if (JSON.stringify(pending) !== JSON.stringify(snapshot())) { undo.push(pending); redo = []; }
      pending = null; changed();
    },
  };
  builder.themeEditor = api;
})(window);
