(function installZoidiumSettings(global) {
  "use strict";

  var STORAGE_KEY = "zoidium.editor-settings";
  var DEFAULT_FRAME_RATE = 30;
  var MIN_FRAME_RATE = 1;
  var MAX_FRAME_RATE = 240;
  var DEFAULTS = {
    layout: "clipmaker",
    font: "source-code-pro",
    theme: "panzoid",
    themeId: null,
    hue: 0,
    saturation: 100,
    defaultFrameRate: DEFAULT_FRAME_RATE,
    previewCacheMiB: 512,
    gradientEditor: "zoidium",
  };

  var LAYOUT_OPTIONS = [
    { value: "clipmaker", label: "Clipmaker 3" },
    { value: "clipmaker-centered", label: "Clipmaker 3 Centered" },
    { value: "videoeditor", label: "Video Editor 2" },
    { value: "videoeditor-centered", label: "Video Editor 2 Centered" },
    { value: "videoeditor-centered2", label: "Video Editor 2 Centered 2" },
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
      value: "paper-mono",
      label: "Paper Mono",
      family: '"Paper Mono", monospace',
    },
    {
      value: "inter",
      label: "Inter",
      family: '"Inter", sans-serif',
    },
    {
      value: "source-sans-3",
      label: "Source Sans 3",
      family: '"Source Sans 3", sans-serif',
    },
    {
      value: "atkinson-hyperlegible-next",
      label: "Atkinson Hyperlegible Next",
      family: '"Atkinson Hyperlegible Next", sans-serif',
    },
    {
      value: "system",
      label: "System monospace",
      family: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    },
  ];

  var themeEditor = global.ZoidiumUIBuilder.themeEditor;
  var themeModel = global.ZoidiumUIBuilder.themeModel;
  var THEME_OPTIONS = themeModel.PRESETS;

  var state = {
    settings: null,
    panel: null,
    controls: null,
    cacheUsage: null,
    cacheCaution: null,
    cacheTimer: null,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampSaturation(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return 100;
    return clamp(number, 0, 200);
  }

  function normalizeDecimalText(value) {
    return String(value)
      .trim()
      .replace(/[０-９]/g, function (digit) {
        return String.fromCharCode(digit.charCodeAt(0) - 0xfee0);
      })
      .replace(/[．，,]/g, ".");
  }

  function readFrameRate(value, fallback) {
    var text = normalizeDecimalText(value);
    if (!text) return fallback;
    var number = Number(text);
    if (!Number.isFinite(number)) return fallback;
    return clamp(number, MIN_FRAME_RATE, MAX_FRAME_RATE);
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
      // Storage may be blocked; settings still apply for this session.
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
    // Prototype-safe merge of the parsed payload over the defaults
    // (zoidium/shared/json.js, loaded just before this script). Pinned by
    // test/shared-helpers.test.js.
    var settings = global.ZoidiumSharedJson.safeAssign({}, DEFAULTS, parsed && typeof parsed === "object" ? parsed : {});
    if (!hasValue(LAYOUT_OPTIONS, settings.layout)) settings.layout = DEFAULTS.layout;
    if (!hasValue(FONT_OPTIONS, settings.font)) settings.font = DEFAULTS.font;
    if (!hasValue(THEME_OPTIONS, settings.theme)) settings.theme = DEFAULTS.theme;
    settings.hue = clamp(Number.isFinite(Number(settings.hue)) ? Number(settings.hue) : 0, -180, 180);
    settings.saturation = clampSaturation(settings.saturation);
    settings.defaultFrameRate = readFrameRate(settings.defaultFrameRate, DEFAULT_FRAME_RATE);
    settings.previewCacheMiB = global.ZoidiumOutputFrameStore?.sizeMiB(settings.previewCacheMiB) ?? 512;
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
    if (value === "inter" || value === "source-sans-3" || value === "atkinson-hyperlegible-next") {
      return FONT_OPTIONS[0].family;
    }
    return findFont(value).family;
  }

  function findEditorWindow() {
    if (!global.document) return null;
    return global.document.getElementById("panecontainer")
      || global.document.querySelector(".editorwindow");
  }

  function colorToRgbString(color) {
    return [color >> 16 & 255, color >> 8 & 255, color & 255].join(" ");
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
    var palette = themeEditor.palette();
    var chrome = themeModel.uiTokens(palette);
    hosts.forEach(function (host) {
      Object.keys(chrome).forEach(function (key) { host.style.setProperty("--zui-" + key, chrome[key]); });
    });
    var properties = { focus: "focus", link: "link", clip: "clip", clipSelected: "clip-selected", clipSelection: "clip-selection" };
    Object.keys(properties).forEach(function (key) {
      hosts.forEach(function (host) { host.style.setProperty("--zoidium-theme-" + properties[key], palette[key]); });
    });
    hosts.forEach(function (host) {
      host.style.setProperty("--zoidium-theme-focus-rgb", colorToRgbString(parseInt(palette.focus.slice(1), 16)));
    });
    if (themeEditor.selected()) {
      var main = themeModel.hsl(palette.focus), classic = themeModel.hsl(themeModel.PALETTE.focus);
      hue = (main[0] - classic[0]) * 360;
      saturation = main[1] / classic[1];
    }

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
    global.ZoidiumGradientEditor?.setClassic(state.settings.gradientEditor === "classic");
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
    global.ZoidiumUIBuilder.themeClips?.refresh();
    refreshControls();
  }

  function persistAndApply() {
    state.settings.hue = clamp(Number(state.settings.hue) || 0, -180, 180);
    state.settings.saturation = clampSaturation(state.settings.saturation);
    state.settings.defaultFrameRate = readFrameRate(
      state.settings.defaultFrameRate,
      DEFAULT_FRAME_RATE,
    );
    writeStorage(state.settings);
    global.ZoidiumFrameCache?.setSizeMiB(state.settings.previewCacheMiB);
    var defaultProjectSettings = global.ZoidiumDefaultProjectSettings;
    if (defaultProjectSettings && typeof defaultProjectSettings.setFrameRate === "function") {
      defaultProjectSettings.setFrameRate(state.settings.defaultFrameRate);
    }
    applySettings();
    global.dispatchEvent(new CustomEvent("zoidium:theme-changed"));
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
    var summary = state.controls?.themeRow?.querySelector("select")?.lastElementChild;
    if (summary) {
      summary.disabled = true;
      summary.hidden = !themeEditor.selected();
      summary.textContent = themeEditor.selected() ? themeEditor.name() : "My theme";
    }
    updateCustomRowsVisibility();
    updateCacheUsage();
  }

  function updateCacheUsage() {
    if (!state.cacheUsage) return;
    var usage = global.ZoidiumFrameCache?.usage();
    var text = "Using " + Math.round((usage?.bytes || 0) / 1048576).toLocaleString("en-US") + " MiB";
    if (usage?.width && usage?.height) {
      var frames = Math.floor(usage.bytes / (usage.width * usage.height * 4));
      text += " · about " + frames.toLocaleString("en-US") + (frames === 1 ? " frame at " : " frames at ") + usage.width + "×" + usage.height;
    }
    if (usage && usage.limit < state.settings.previewCacheMiB * 1048576) {
      text += " · session limit " + Math.floor(usage.limit / 1048576).toLocaleString("en-US") + " MiB";
    }
    state.cacheUsage.textContent = text;
    state.cacheCaution.hidden = state.settings.previewCacheMiB <= 4096;
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
    var row = legacy.generateDropdown(
      {
        title: "Color profile",
        items: THEME_OPTIONS.map(function (theme) { return theme.label; }).join(";") + ";My theme",
        // The editor owns the named-theme picker; this summary keeps the legacy row stable.
        get: function () {
          if (themeEditor.selected()) return THEME_OPTIONS.length;
          return Math.max(0, THEME_OPTIONS.findIndex(function (theme) {
            return theme.value === state.settings.theme;
          }));
        },
        set: function (index) {
          if (!THEME_OPTIONS[index]) return;
          state.settings.themeId = null;
          state.settings.theme = THEME_OPTIONS[index].value;
          if (state.settings.theme !== "custom") state.settings.hue = THEME_OPTIONS[index].hue;
          persistAndApply();
        },
      },
      state,
    );
    var edit = global.document.createElement("button");
    edit.type = "button"; edit.textContent = "Edit…"; edit.className = "zoidium-theme-edit";
    edit.setAttribute("aria-label", "Edit color profile");
    edit.addEventListener("click", function () { themeEditor.open(); });
    row.classList.add("zoidium-theme-settings-row");
    row.children[1].appendChild(edit);
    return row;
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
          state.settings.themeId = null;
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
          state.settings.themeId = null;
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

  function createDefaultFrameRateRow(legacy) {
    var row = legacy.generateTextInput(
      {
        title: "Default frame rate",
        get: function () {
          return String(state.settings.defaultFrameRate);
        },
        set: function (value) {
          var frameRate = readFrameRate(value, NaN);
          if (!Number.isFinite(frameRate)) return;
          state.settings.defaultFrameRate = frameRate;
          persistAndApply();
        },
      },
      state,
    );
    var frameRateInput = row && row.querySelector ? row.querySelector("input") : null;
    if (frameRateInput) {
      frameRateInput.style.width = "90px";
      frameRateInput.inputMode = "decimal";
      frameRateInput.setAttribute("aria-label", "Default frame rate (FPS)");
    }
    return row;
  }

  function updateCustomRowsVisibility() {
    if (!state.controls) return;
    // Hue and saturation only apply to the Custom profile. Preset and Gray
    // profiles fix both values, so their rows stay hidden.
    var display = state.settings.theme === "custom" && !themeEditor.selected() ? "" : "none";
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
    var defaultFrameRateRow = createDefaultFrameRateRow(legacy);
    var cacheControl = global.ZoidiumUI.controls.number({
      label: "Preview cache", value: state.settings.previewCacheMiB,
      min: 0, max: global.ZoidiumOutputFrameStore.MAX_MIB, step: 1, dragSpeed: 64, unit: "MiB",
      onChange: function (value) {
        state.settings.previewCacheMiB = global.ZoidiumOutputFrameStore.sizeMiB(value);
        persistAndApply();
      },
    });
    cacheControl.input.setAttribute("aria-label", "Preview cache (MiB)");
    var cacheUsage = global.ZoidiumUI.controls.note("Using 0 MiB").element;
    cacheUsage.setAttribute("data-preview-cache-usage", "");
    var cacheCaution = global.ZoidiumUI.controls.note(
      "The GPU needs this much free memory. Macs share GPU memory with system RAM.", "warning"
    ).element;
    var gradientRow = legacy.generateDropdown({
      title: "Gradient editor", items: "Zoidium;Classic",
      get: function () { return state.settings.gradientEditor === "classic" ? 1 : 0; },
      set: function (index) { state.settings.gradientEditor = index === 1 ? "classic" : "zoidium"; persistAndApply(); },
    }, state);
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
    panel.appendChild(defaultFrameRateRow);
    panel.appendChild(cacheControl.element);
    panel.appendChild(cacheUsage);
    panel.appendChild(cacheCaution);
    panel.appendChild(global.ZoidiumUI.controls.note(
      "Finished preview frames use up to this much GPU memory. Set 0 to turn off caching. Temporal input textures use up to another 256 MiB, plus active samples and rendering buffers."
    ).element);
    panel.appendChild(gradientRow);
    panel.appendChild(fontRow);
    panel.appendChild(themeRow);
    panel.appendChild(hueRow);
    panel.appendChild(saturationRow);

    state.panel = panel;
    state.cacheUsage = cacheUsage;
    state.cacheCaution = cacheCaution;
    state.controls = {
      layoutRow: layoutRow,
      defaultFrameRateRow: defaultFrameRateRow,
      cacheRow: { pz_update: function () { cacheControl.set(state.settings.previewCacheMiB); } },
      gradientRow: gradientRow,
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
    state.cacheTimer = global.setInterval(function () {
      if (state.panel?.isConnected && state.panel.style.display !== "none") updateCacheUsage();
    }, 500);
    return true;
  }

  var installTimer = null;
  var installStopped = false;
  var installDeadline = 0;
  var installEditor = null;

  function stopInstall() {
    installStopped = true;
    if (installTimer !== null) global.clearTimeout(installTimer);
    installTimer = null;
    if (state.cacheTimer !== null) global.clearInterval(state.cacheTimer);
    state.cacheTimer = null;
  }

  function retryInstall() {
    installTimer = null;
    if (installStopped || installEditor && (global.CM !== installEditor || installEditor.destroyed || installEditor._destroyed)) return;
    if (!installEditor && global.CM) installEditor = global.CM;
    if (install()) return;
    var remaining = installDeadline - Date.now();
    if (remaining <= 0) {
      try {
        global.dispatchEvent(new CustomEvent("zoidium:extension-script-error", {
          detail: { script: "zoidium/settings.js", phase: "post-init", message: "Settings panel could not attach within 30 seconds." },
        }));
      } catch (_error) {
        // Diagnostics must not prevent startup.
      }
      return;
    }
    installTimer = global.setTimeout(retryInstall, Math.min(250, remaining));
  }

  function start() {
    state.settings = readSettings();
    themeEditor.configure({ get: function () { return state.settings; }, apply: persistAndApply });
    applySettings();
    installDeadline = Date.now() + 30000;
    installEditor = global.CM || null;
    if (typeof global.addEventListener === "function") global.addEventListener("pagehide", stopInstall, { once: true });
    retryInstall();
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})(window);
