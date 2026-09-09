(function installZoidiumSettings(global) {
  "use strict";

  var STORAGE_KEY = "zoidium.editor-settings";
  var DEFAULTS = {
    layout: "clipmaker",
    font: "source-code-pro",
    theme: "panzoid",
    hue: 0,
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
    { value: "custom", label: "Custom hue", hue: 0 },
  ];

  var state = {
    settings: null,
    panel: null,
    controls: null,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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

  function markColorProfileExemptions(editorWindow) {
    if (!editorWindow) return;

    // CM3 can rebuild panels while this script remains alive. Remove stale
    // marks before identifying the current preview surface.
    Array.from(editorWindow.querySelectorAll(".zoidium-color-profile-exempt"))
      .forEach(function (element) {
        element.classList.remove("zoidium-color-profile-exempt");
      });

    function exempt(element) {
      if (element) element.classList.add("zoidium-color-profile-exempt");
    }

    // Project output is not editor chrome and must retain its original
    // colors. Timeline tracks and selection outlines stay under the root
    // filter so their theme colors remain visible.
    Array.from(editorWindow.querySelectorAll(".editorpanel")).forEach(function (panel) {
      // The timeline also owns a waveform canvas. Keep that panel themed;
      // only the large project-output canvas is a color-profile exemption.
      var canvas = panel.querySelector("canvas");
      if (canvas && !panel.querySelector(".timelabel")) exempt(canvas);
    });
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
      var hue = state.settings.hue + "deg";
      editorWindow.classList.add("zoidium-editor-window");
      editorWindow.style.setProperty("--zoidium-theme-hue", hue);
      editorWindow.style.setProperty("filter", "hue-rotate(" + hue + ")", "important");
      editorWindow.dataset.zoidiumTheme = state.settings.theme;
      markColorProfileExemptions(editorWindow);
    }
    refreshControls();
  }

  function persistAndApply() {
    state.settings.hue = clamp(Number(state.settings.hue) || 0, -180, 180);
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
  }

  function notifyReloadRequired() {
    var option = LAYOUT_OPTIONS.find(function (item) {
      return item.value === state.settings.layout;
    });
    global.dispatchEvent(new CustomEvent("zoidium:notification", {
      detail: {
        title: "Reload required.",
        message: "Reload Zoidium to use " + (option ? option.label : "the selected layout") + ".",
      },
    }));
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
    return legacy.generateTextInput(
      {
        title: "Hue shift (-180 to 180)",
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
    var layoutTitle = createCategoryHeader("LAYOUT");
    var layoutRow = createLayoutRow(legacy);
    var layoutNote = legacy.generateDescription({
      content: "Changing the editor layout takes effect after Zoidium is reloaded.",
    });
    var fontRow = createFontRow(legacy);
    var themeRow = createThemeRow(legacy);
    var hueRow = createHueRow(legacy);
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
    panel.appendChild(layoutTitle);
    panel.appendChild(layoutRow);
    panel.appendChild(layoutNote);
    panel.appendChild(fontRow);
    panel.appendChild(themeRow);
    panel.appendChild(hueRow);

    state.panel = panel;
    state.controls = {
      layoutRow: layoutRow,
      fontRow: fontRow,
      themeRow: themeRow,
      hueRow: hueRow,
    };
    updateGeneratedRows();

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
    var tabs = global.document.querySelector(".elevatortabs");
    var controls = global.document.querySelector(".elevatorcontrols");
    if (!tabs || !controls) return false;
    if (global.document.querySelector(".zoidium-settings-tab")) return true;

    var elevator = tabs.parentElement && tabs.parentElement.parentElement
      ? tabs.parentElement.parentElement.pz_panel
      : null;
    if (!elevator || typeof elevator.changeTab !== "function") return false;

    panel.style.top = "0";
    panel.style.left = "0";
    panel.style.width = "100%";
    panel.style.height = "100%";

    var settingsPanel = {
      title: "Settings",
      icon: "settings",
      el: panel,
      editor: elevator.editor,
      enabled: false,
      needsResize: false,
      resize: function () {},
    };
    var tab = global.document.createElement("a");
    tab.className = "zoidium-settings-tab";
    tab.title = "Settings";
    tab.pz_tab = settingsPanel;
    tab.pz_container = panel;
    tab.appendChild(global.PZ.ui.generateIcon("settings"));
    var label = global.document.createElement("span");
    label.textContent = "Settings";
    tab.appendChild(label);

    var aboutTab = Array.from(tabs.children).find(function (item) {
      return item.title === "About";
    });
    if (aboutTab && aboutTab.nextElementSibling) tabs.insertBefore(tab, aboutTab.nextElementSibling);
    else tabs.appendChild(tab);
    controls.appendChild(panel);
    elevator.panels.push(settingsPanel);
    tab.onclick = elevator.buttonClick.bind(elevator);
    tab.onkeydown = elevator.buttonKeyDown;
    return true;
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
