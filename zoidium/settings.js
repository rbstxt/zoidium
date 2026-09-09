(function installZoidiumSettings(global) {
  "use strict";

  var STORAGE_KEY = "zoidium.editor-settings";
  var DEFAULTS = {
    layout: "clipmaker",
    font: "source-code-pro",
    theme: "panzoid",
    hue: 0,
    saturation: 100,
  };

  var LAYOUT_OPTIONS = [
    { value: "clipmaker", label: "Clipmaker 3" },
    { value: "videoeditor", label: "Video Editor 2" },
  ];

  var FONT_OPTIONS = [
    {
      value: "source-code-pro",
      label: "Source Code Pro",
      family: '"Source Code Pro", monospace',
    },
    {
      value: "geist-mono",
      label: "Geist Mono",
      family: '"Geist Mono", monospace',
    },
    {
      value: "geist",
      label: "Geist",
      family: '"Geist", sans-serif',
    },
    {
      value: "jetbrains-mono",
      label: "JetBrains Mono",
      family: '"JetBrains Mono", monospace',
    },
    {
      value: "ibm-plex-mono",
      label: "IBM Plex Mono",
      family: '"IBM Plex Mono", monospace',
    },
    {
      value: "ibm-plex-sans",
      label: "IBM Plex Sans",
      family: '"IBM Plex Sans", sans-serif',
    },
    {
      value: "cascadia-mono",
      label: "Cascadia Mono",
      family: '"Cascadia Mono", monospace',
    },
    {
      value: "fira-code",
      label: "Fira Code",
      family: '"Fira Code", monospace',
    },
    {
      value: "system",
      label: "System monospace",
      family: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    },
  ];

  var THEME_OPTIONS = [
    { value: "panzoid", label: "Panzoid Classic", hue: 0 },
    { value: "signal", label: "Signal Blue", hue: -18 },
    { value: "ember", label: "Ember Console", hue: 154 },
    { value: "moss", label: "Moss Terminal", hue: 78 },
    { value: "rose", label: "Rose Signal", hue: -72 },
    { value: "gray", label: "Gray", hue: 0 },
    { value: "custom", label: "Custom", hue: 0 },
  ];

  var state = {
    settings: null,
    panel: null,
    controls: null,
  };

  var THEME_PALETTE = {
    focus: 0x384668,
    link: 0x7e8fb9,
    clip: 0x526183,
    clipSelected: 0x7f94c7,
    clipSelection: 0x273465,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampSaturation(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return 100;
    return clamp(number, 0, 200);
  }

  function effectiveSaturation() {
    // Gray mode drops all saturation. Preset profiles keep full saturation;
    // only the Custom profile follows the stored saturation value.
    if (state.settings.theme === "gray") return 0;
    if (state.settings.theme === "custom") return clampSaturation(state.settings.saturation) / 100;
    return 1;
  }

  function readStorage() {
    try {
      return global.localStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      return null;
    }
  }

  function writeStorage(value) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (_error) {
      // The setting still applies for the current session when storage is unavailable.
    }
  }

  function hasValue(list, value) {
    return list.some(function (item) {
      return item.value === value;
    });
  }

  function readSettings() {
    var parsed = null;
    try {
      parsed = JSON.parse(readStorage() || "null");
    } catch (_error) {
      parsed = null;
    }
    var settings = Object.assign({}, DEFAULTS, parsed && typeof parsed === "object" ? parsed : {});
    if (!hasValue(LAYOUT_OPTIONS, settings.layout)) settings.layout = DEFAULTS.layout;
    if (!hasValue(FONT_OPTIONS, settings.font)) settings.font = DEFAULTS.font;
    if (!hasValue(THEME_OPTIONS, settings.theme)) settings.theme = DEFAULTS.theme;
    settings.hue = clamp(Number.isFinite(Number(settings.hue)) ? Number(settings.hue) : 0, -180, 180);
    settings.saturation = clampSaturation(settings.saturation);
    return settings;
  }

  function findFont(value) {
    return FONT_OPTIONS.find(function (font) {
      return font.value === value;
    }) || FONT_OPTIONS[0];
  }

  function findCodeFont(value) {
    if (value === "geist") return '"Geist Mono", monospace';
    if (value === "ibm-plex-sans") return '"IBM Plex Mono", monospace';
    return findFont(value).family;
  }

  function findEditorWindow() {
    if (!global.document) return null;
    return global.document.getElementById("panecontainer")
      || global.document.querySelector(".editorwindow");
  }

  function colorToHex(color) {
    return "#" + color.toString(16).padStart(6, "0");
  }

  function colorToRgbString(color) {
    return [color >> 16 & 255, color >> 8 & 255, color & 255].join(" ");
  }

  function shiftThemeColor(color, degrees, saturationScale) {
    var red = (color >> 16 & 255) / 255;
    var green = (color >> 8 & 255) / 255;
    var blue = (color & 255) / 255;
    var max = Math.max(red, green, blue);
    var min = Math.min(red, green, blue);
    var lightness = (max + min) / 2;
    var saturation = 0;
    var hue = 0;

    if (max !== min) {
      var delta = max - min;
      saturation = lightness > 0.5
        ? delta / (2 - max - min)
        : delta / (max + min);
      if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
      else if (max === green) hue = (blue - red) / delta + 2;
      else hue = (red - green) / delta + 4;
      hue /= 6;
    }

    hue = (hue + degrees / 360) % 1;
    if (hue < 0) hue += 1;

    var scale = Number(saturationScale);
    saturation = clamp(saturation * (Number.isFinite(scale) ? scale : 1), 0, 1);

    function hueToRgb(first, second, value) {
      if (value < 0) value += 1;
      if (value > 1) value -= 1;
      if (value < 1 / 6) return first + (second - first) * 6 * value;
      if (value < 1 / 2) return second;
      if (value < 2 / 3) return first + (second - first) * (2 / 3 - value) * 6;
      return first;
    }

    if (saturation === 0) {
      red = green = blue = lightness;
    } else {
      var second = lightness < 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation;
      var first = 2 * lightness - second;
      red = hueToRgb(first, second, hue + 1 / 3);
      green = hueToRgb(first, second, hue);
      blue = hueToRgb(first, second, hue - 1 / 3);
    }

    return (Math.round(red * 255) << 16)
      | (Math.round(green * 255) << 8)
      | Math.round(blue * 255);
  }

  function applyThemePalette(editorWindow) {
    // Body-level dropdowns (ease/font pickers) inherit from :root, so the
    // palette must reach documentElement even before the editor window
    // exists.
    var hosts = [];
    if (editorWindow) hosts.push(editorWindow);
    if (global.document && global.document.documentElement
        && hosts.indexOf(global.document.documentElement) === -1) {
      hosts.push(global.document.documentElement);
    }
    if (hosts.length === 0) return;
    // Gray mode ignores the hue shift and removes all saturation instead.
    var hue = state.settings.theme === "gray" ? 0 : state.settings.hue;
    var saturation = effectiveSaturation();
    var palette = {
      "--zoidium-theme-focus": THEME_PALETTE.focus,
      "--zoidium-theme-link": THEME_PALETTE.link,
      "--zoidium-theme-clip": THEME_PALETTE.clip,
      "--zoidium-theme-clip-selected": THEME_PALETTE.clipSelected,
      "--zoidium-theme-clip-selection": THEME_PALETTE.clipSelection,
    };

    Object.keys(palette).forEach(function (property) {
      var value = colorToHex(shiftThemeColor(palette[property], hue, saturation));
      hosts.forEach(function (host) {
        host.style.setProperty(property, value);
      });
    });
    hosts.forEach(function (host) {
      host.style.setProperty(
        "--zoidium-theme-focus-rgb",
        colorToRgbString(shiftThemeColor(THEME_PALETTE.focus, hue, saturation)),
      );
    });

    // Font previews are a raster sprite tinted with a CSS filter (see
    // ui-overrides.css). Expose the hue shift so the filter can follow themes.
    hosts.forEach(function (host) {
      host.style.setProperty("--zoidium-theme-hue-shift", hue + "deg");
    });

    // The font sprite filter also follows desaturation (used by Gray mode
    // and low Custom saturation values).
    hosts.forEach(function (host) {
      host.style.setProperty("--zoidium-theme-saturation", String(saturation));
    });

    // Older versions marked broad ancestors for CSS filtering. A child canvas
    // cannot cancel a parent filter, so remove those marks unconditionally.
    if (editorWindow) {
      Array.from(editorWindow.querySelectorAll(
        ".zoidium-color-profile-target, .zoidium-color-profile-exempt"
      )).forEach(function (element) {
        element.classList.remove("zoidium-color-profile-target");
        element.classList.remove("zoidium-color-profile-exempt");
        element.style.removeProperty("filter");
      });
    }
  }

  function applySettings() {
    var font = findFont(state.settings.font);
    var root = global.document && global.document.documentElement;
    var editorWindow = findEditorWindow();
    if (root) {
      root.style.setProperty("--zoidium-font-family", font.family);
      root.style.setProperty("--zoidium-code-font-family", findCodeFont(state.settings.font));
      root.dataset.zoidiumFont = state.settings.font;
      root.dataset.zoidiumTheme = state.settings.theme;
    }
    if (editorWindow) {
      editorWindow.classList.add("zoidium-editor-window");
      editorWindow.style.removeProperty("filter");
      editorWindow.dataset.zoidiumTheme = state.settings.theme;
    }
    applyThemePalette(editorWindow);
    refreshControls();
  }

  function persistAndApply() {
    state.settings.hue = clamp(Number(state.settings.hue) || 0, -180, 180);
    state.settings.saturation = clampSaturation(state.settings.saturation);
    writeStorage(state.settings);
    applySettings();
  }

  function updateGeneratedRows() {
    if (!state.controls) return;
    Object.keys(state.controls).forEach(function (key) {
      var row = state.controls[key];
      if (row && typeof row.pz_update === "function") row.pz_update();
    });
  }

  function refreshControls() {
    updateGeneratedRows();
    updateCustomRowsVisibility();
  }

  function notifyReloadRequired() {
    var option = LAYOUT_OPTIONS.find(function (item) {
      return item.value === state.settings.layout;
    });
    var detail = {
      title: "Reload required.",
      message: "Reload Zoidium to use " + (option ? option.label : "the selected layout") + ".",
      reload: true,
    };
    // Toast delivery goes through the shared UI kit, which always loads
    // before Settings (see postInitScripts in zoidium/runtime-config.js).
    global.ZoidiumUI.notify(detail);
  }

  function createLayoutRow(legacy) {
    return legacy.generateDropdown(
      {
        title: "Editor layout",
        items: LAYOUT_OPTIONS.map(function (layout) { return layout.label; }).join(";"),
        get: function () {
          return Math.max(0, LAYOUT_OPTIONS.findIndex(function (layout) {
            return layout.value === state.settings.layout;
          }));
        },
        set: function (index) {
          if (!LAYOUT_OPTIONS[index]) return;
          var layout = LAYOUT_OPTIONS[index].value;
          if (layout === state.settings.layout) return;
          state.settings.layout = layout;
          writeStorage(state.settings);
          refreshControls();
          notifyReloadRequired();
        },
      },
      state,
    );
  }

  function createFontRow(legacy) {
    return legacy.generateDropdown(
      {
        title: "Editor font",
        items: FONT_OPTIONS.map(function (font) { return font.label; }).join(";"),
        get: function () {
          return Math.max(0, FONT_OPTIONS.findIndex(function (font) {
            return font.value === state.settings.font;
          }));
        },
        set: function (index) {
          if (!FONT_OPTIONS[index]) return;
          state.settings.font = FONT_OPTIONS[index].value;
          persistAndApply();
        },
      },
      state,
    );
  }

  function createThemeRow(legacy) {
    return legacy.generateDropdown(
      {
        title: "Color profile",
        items: THEME_OPTIONS.map(function (theme) { return theme.label; }).join(";"),
        get: function () {
          return Math.max(0, THEME_OPTIONS.findIndex(function (theme) {
            return theme.value === state.settings.theme;
          }));
        },
        set: function (index) {
          if (!THEME_OPTIONS[index]) return;
          state.settings.theme = THEME_OPTIONS[index].value;
          if (state.settings.theme !== "custom") state.settings.hue = THEME_OPTIONS[index].hue;
          persistAndApply();
        },
      },
      state,
    );
  }

  function createHueRow(legacy) {
    var row = legacy.generateTextInput(
      {
        title: "Hue shift",
        get: function () {
          return String(Math.round(state.settings.hue));
        },
        set: function (value) {
          var hue = Number(value);
          if (!Number.isFinite(hue)) return;
          state.settings.theme = "custom";
          state.settings.hue = clamp(hue, -180, 180);
          persistAndApply();
        },
      },
      state,
    );
    // The legacy helper fixes the input at 250px. Keep this numeric field
    // as compact as the Frame rate field on the Device render panel.
    var hueInput = row && row.querySelector ? row.querySelector("input") : null;
    if (hueInput) hueInput.style.width = "80px";
    return row;
  }

  function createSaturationRow(legacy) {
    var row = legacy.generateTextInput(
      {
        title: "Saturation",
        get: function () {
          return String(Math.round(clampSaturation(state.settings.saturation)));
        },
        set: function (value) {
          var saturation = Number(value);
          if (!Number.isFinite(saturation)) return;
          state.settings.theme = "custom";
          state.settings.saturation = clampSaturation(saturation);
          persistAndApply();
        },
      },
      state,
    );
    // Match the compact numeric width of the Hue shift field.
    var saturationInput = row && row.querySelector ? row.querySelector("input") : null;
    if (saturationInput) saturationInput.style.width = "80px";
    return row;
  }

  function updateCustomRowsVisibility() {
    if (!state.controls) return;
    // Hue and saturation only apply to the Custom profile. Preset and Gray
    // profiles fix both values, so their rows stay hidden.
    var display = state.settings.theme === "custom" ? "" : "none";
    ["hueRow", "saturationRow"].forEach(function (key) {
      var row = state.controls[key];
      if (row && row.style) row.style.display = display;
    });
  }

  function createCategoryHeader(title) {
    var header = global.document.createElement("ul");
    header.className = "pz-options noselect";
    var label = global.document.createElement("span");
    label.textContent = title;
    header.appendChild(label);
    return header;
  }

  function createPanel() {
    var PZ = global.PZ;
    var legacy = PZ.ui.controls.legacy;
    var panel = global.document.createElement("section");
    panel.className = "editorpanel zoidium-settings-panel";
    panel.setAttribute("aria-label", "Settings");
    panel.tabIndex = 0;
    panel.style.display = "none";

    var title = legacy.generateTitle({ title: "Settings" });
    var layoutRow = createLayoutRow(legacy);
    var layoutNote = legacy.generateDescription({
      content: "Changing the editor layout takes effect after Zoidium is reloaded.",
    });
    var fontRow = createFontRow(legacy);
    var themeRow = createThemeRow(legacy);
    var hueRow = createHueRow(legacy);
    var saturationRow = createSaturationRow(legacy);
    var resetButton = legacy.generateButton({
      title: "Reset settings",
      clickfn: function () {
        var layoutChanged = state.settings.layout !== DEFAULTS.layout;
        state.settings = Object.assign({}, DEFAULTS);
        persistAndApply();
        if (layoutChanged) notifyReloadRequired();
      },
    }, state);

    panel.appendChild(title);
    panel.appendChild(layoutRow);
    panel.appendChild(layoutNote);
    panel.appendChild(fontRow);
    panel.appendChild(themeRow);
    panel.appendChild(hueRow);
    panel.appendChild(saturationRow);

    state.panel = panel;
    state.controls = {
      layoutRow: layoutRow,
      fontRow: fontRow,
      themeRow: themeRow,
      hueRow: hueRow,
      saturationRow: saturationRow,
    };
    refreshControls();

    var debugHost = global.document.createElement("div");
    debugHost.className = "zoidium-settings-debug-section";
    panel.appendChild(debugHost);
    addDebugControls(debugHost);
    panel.appendChild(legacy.generateSpacer());
    panel.appendChild(resetButton);
    return panel;
  }

  function addDebugControls(host) {
    var debugLog = global.ZOIDIUM_DEBUG_LOG;
    if (!host || !debugLog || typeof debugLog.createControls !== "function") return false;
    if (!debugLog.createControls(host)) return false;
    var debugBlock = host.querySelector("[data-zoidium-debug-log]");
    var debugTitle = debugBlock && debugBlock.querySelector(".zoidium-debug-log-title");
    if (debugTitle) debugTitle.replaceWith(createCategoryHeader("DEBUG INFORMATION"));
    return true;
  }

  function createTab(panel) {
    // Elevator tab chrome lives in the shared UI kit, which always loads
    // before Settings (see postInitScripts in zoidium/runtime-config.js).
    // Settings docks after the About tab while Restore and Plugins dock
    // before it.
    return !!global.ZoidiumUI.createMenubarTab({
      title: "Settings",
      icon: "settings",
      panel: panel,
      tabClass: "zoidium-settings-tab",
      position: "afterAbout",
    });
  }

  function install() {
    if (global.document.querySelector(".zoidium-settings-tab")) return true;
    var PZ = global.PZ;
    if (!PZ || !PZ.ui || typeof PZ.ui.generateIcon !== "function" || !PZ.ui.controls?.legacy) return false;
    state.settings = state.settings || readSettings();
    var panel = createPanel();
    if (!createTab(panel)) {
      state.panel = null;
      state.controls = null;
      return false;
    }
    applySettings();
    return true;
  }

  function retryInstall() {
    if (install()) return;
    global.setTimeout(retryInstall, 50);
  }

  function start() {
    state.settings = readSettings();
    applySettings();
    retryInstall();
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})(window);
