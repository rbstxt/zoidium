(function (global) {
  "use strict";

  // Shared helpers for extending the CM3 editor chrome. New panels, tabs,
  // headers, and notifications should go through this module instead of
  // copying the elevator/legacy boilerplate into each feature file.
  //
  // This module is a required dependency: zoidium/runtime-config.js loads it
  // before every consumer (project-restore, settings, plugin-manager), so
  // callers use ZoidiumUI directly and must not reimplement its builders as
  // a fallback. A missing UI kit is a fatal startup error, not a silent skip.
  //
  // Usage:
  //   var header = global.ZoidiumUI.createPageHeader("My Panel");
  //   panel.appendChild(header);
  //
  //   global.ZoidiumUI.createMenubarTab({
  //     title: "My Panel",
  //     icon: "settings",
  //     panel: panel,
  //     tabClass: "zoidium-my-panel-tab",
  //   });
  //
  //   global.ZoidiumUI.notify({ title: "Saved.", message: "Done." });
  //
  //   var search = global.ZoidiumUI.createSearchBox({ placeholder: "type to filter" });
  //   panel.appendChild(search.wrap);
  //   global.ZoidiumUI.attachSearchFilter(search.input, list);
  //
  //   var button = global.ZoidiumUI.createButton({ title: "Download", onClick: onDownload });

  function getElevator() {
    if (!global.document) return null;
    var tabs = global.document.querySelector(".elevatortabs");
    var controls = global.document.querySelector(".elevatorcontrols");
    if (!tabs || !controls) return null;
    var elevator = tabs.parentElement && tabs.parentElement.parentElement
      ? tabs.parentElement.parentElement.pz_panel
      : null;
    if (!elevator || typeof elevator.changeTab !== "function") return null;
    return { tabs: tabs, controls: controls, elevator: elevator };
  }

  function legacyControls() {
    var PZ = global.PZ;
    return (PZ && PZ.ui && PZ.ui.controls && PZ.ui.controls.legacy) || null;
  }

  function findAboutTab(tabs) {
    return Array.from(tabs.children).find(function (item) {
      return item.title === "About";
    }) || null;
  }

  // Creates an elevator menubar tab for a full-area panel. Returns the tab
  // element, or null when the sidebar is unavailable. When a tab with the
  // same tabClass already exists, the existing tab is returned so repeated
  // installs stay idempotent.
  function createMenubarTab(options) {
    var config = options || {};
    if (!config.title || !config.panel) return null;
    if (!global.document) return null;
    if (config.tabClass && global.document.querySelector("." + config.tabClass)) {
      return global.document.querySelector("." + config.tabClass);
    }
    var PZ = global.PZ;
    if (!PZ || !PZ.ui || typeof PZ.ui.generateIcon !== "function") return null;
    var hosts = getElevator();
    if (!hosts) return null;

    var panel = config.panel;
    panel.style.top = "0";
    panel.style.left = "0";
    panel.style.width = "100%";
    panel.style.height = "100%";

    var descriptor = {
      title: config.title,
      icon: config.icon || "settings",
      el: panel,
      editor: config.editor || hosts.elevator.editor,
      enabled: false,
      needsResize: false,
      resize: function () {},
    };
    var tab = global.document.createElement("a");
    if (config.tabClass) tab.className = config.tabClass;
    tab.title = config.title;
    tab.pz_tab = descriptor;
    tab.pz_elevator = hosts.elevator;
    tab.pz_container = panel;
    tab.appendChild(PZ.ui.generateIcon(descriptor.icon));
    var label = global.document.createElement("span");
    label.textContent = config.title;
    tab.appendChild(label);

    var aboutTab = findAboutTab(hosts.tabs);
    if (config.position === "afterAbout") {
      if (aboutTab && aboutTab.nextElementSibling) hosts.tabs.insertBefore(tab, aboutTab.nextElementSibling);
      else hosts.tabs.appendChild(tab);
    } else if (aboutTab) {
      hosts.tabs.insertBefore(tab, aboutTab);
    } else {
      hosts.tabs.appendChild(tab);
    }
    hosts.controls.appendChild(panel);
    hosts.elevator.panels.push(descriptor);
    tab.onclick = hosts.elevator.buttonClick.bind(hosts.elevator);
    tab.onkeydown = hosts.elevator.buttonKeyDown;
    return tab;
  }

  var previewOwners = new WeakMap();
  // One custom editor may borrow a viewport at a time.
  function acquirePreview(viewport, close) {
    if (!viewport) return function () {};
    var previous = previewOwners.get(viewport);
    if (previous) previous.close();
    var owner = { close: close };
    previewOwners.set(viewport, owner);
    return function () {
      if (previewOwners.get(viewport) === owner) previewOwners.delete(viewport);
    };
  }

  // Removes a tab returned by createMenubarTab and releases its panel.
  function removeMenubarTab(tab) {
    if (!tab || !tab.pz_tab) return false;
    var descriptor = tab.pz_tab;
    var elevator = tab.pz_elevator;
    var tabs = tab.parentElement;
    if (elevator && elevator.activePanel === descriptor) {
      var replacement = tabs && Array.from(tabs.children).find(function (candidate) {
        return candidate !== tab && candidate.pz_tab && !candidate.disabled;
      });
      if (replacement) elevator.changeTab(replacement);
      else elevator.activePanel = null;
    }
    descriptor.enabled = false;
    if (elevator && Array.isArray(elevator.panels)) {
      var index = elevator.panels.indexOf(descriptor);
      if (index >= 0) elevator.panels.splice(index, 1);
    }
    tab.onclick = null;
    tab.onkeydown = null;
    if (tab.pz_container) tab.pz_container.remove();
    tab.remove();
    tab.pz_tab = null;
    tab.pz_container = null;
    tab.pz_elevator = null;
    return true;
  }

  // Builds the standard page header used at the top of sidebar panels such
  // as Plugins and Restore. The returned element carries the CM3
  // proprow/proptitle chrome; callers may add their own layout class.
  function createPageHeader(title) {
    var header = global.document.createElement("div");
    header.className = "proprow proptitle noselect";
    header.style.textOverflow = "ellipsis";
    header.style.overflow = "hidden";
    header.style.whiteSpace = "nowrap";
    header.style.paddingRight = "5px";
    var label = global.document.createElement("span");
    label.className = "proplabel";
    label.title = title || "";
    label.textContent = title || "";
    label.style.fontSize = "18px";
    label.style.fontWeight = "bold";
    header.appendChild(label);
    return header;
  }

  // Sends a toast notification through the shared renderer in
  // project-restore.js. Keeps feature files free of direct CustomEvent
  // construction for the common case.
  function notify(detail) {
    global.dispatchEvent(new CustomEvent("zoidium:notification", {
      detail: detail || {},
    }));
  }

  // Builds the filter search row used above panel lists (Plugins panel,
  // CM3 pickers). Returns { wrap, input }; wire it with
  // attachSearchFilter. Falls back to plain CM3 classes when document
  // is unavailable is not a case callers need to handle.
  function createSearchBox(options) {
    var config = options || {};
    var placeholder = config.placeholder || "type to filter";
    var wrap = global.document.createElement("div");
    wrap.className = "zoidium-plugin-search";
    var input = global.document.createElement("input");
    input.className = "pz-filterbox";
    input.type = "text";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", config.ariaLabel || placeholder);
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  // Filters list children as the user types. Entries match against
  // dataset.searchText when present, otherwise their text content.
  // Escape clears the query. onUpdate runs after every pass so callers can
  // react to the visible set (for example hiding empty group headers).
  // Returns the update function so callers can re-run it after the list
  // changes.
  function attachSearchFilter(input, list, options) {
    var config = options || {};
    var entrySelector = config.entrySelector || ".zoidium-plugin-entry";
    function entryText(entry) {
      if (typeof config.getText === "function") return config.getText(entry);
      if (entry.dataset && entry.dataset.searchText) return entry.dataset.searchText;
      return String(entry.textContent || "").toLowerCase();
    }
    function update() {
      var query = String(input.value || "").replace(/\s+/g, " ").trim().toLowerCase();
      Array.from(list.querySelectorAll(entrySelector)).forEach(function (entry) {
        entry.hidden = Boolean(query) && entryText(entry).indexOf(query) === -1;
      });
      if (typeof config.onUpdate === "function") config.onUpdate();
    }
    input.addEventListener("input", update);
    input.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      input.value = "";
      update();
    });
    return update;
  }

  // Creates a CM3 chrome button (same builder behind Settings rows and
  // the debug-log download button). Falls back to a plain proprow
  // button when the legacy controls are unavailable.
  function createButton(options) {
    var config = options || {};
    var legacy = legacyControls();
    if (legacy && typeof legacy.generateButton === "function") {
      return legacy.generateButton({
        title: config.title || "",
        clickfn: typeof config.onClick === "function" ? config.onClick : function () {},
      });
    }
    var button = global.document.createElement("button");
    button.type = "button";
    button.className = "proprow propbutton";
    button.textContent = config.title || "";
    if (typeof config.onClick === "function") button.addEventListener("click", config.onClick);
    return button;
  }

  // ---------------------------------------------------------------------
  // Floating windows
  //
  // Every plugin editor (setup dialogs, designers, composition lists) opens
  // as a floating window above the editor instead of a fullscreen overlay.
  // The editor stays usable behind it, so edits preview live in the normal
  // viewport. Windows share CM3 panel chrome (zoidium/ui-window.css):
  //
  //   var win = global.ZoidiumUI.openWindow({
  //     id: "vhs-setup:" + effectId,   // reopening the same id focuses it
  //     title: "VHS Setup",
  //     persistKey: "vhs-setup",       // remembers position and size
  //     width: 340, height: 460,
  //     mount: function (body, win) {
  //       body.appendChild(global.ZoidiumUI.controls.slider({ ... }).element);
  //       return function cleanup() {};
  //     },
  //     isValid: function () { return effect.parent != null; },
  //   });
  //   win.close();
  //
  // Plugins should prefer context.ui.openWindow, which closes the window
  // automatically when the plugin is disabled.

  var GEOMETRY_KEY = "zoidium.ui.windows.v1";
  var WINDOW_MARGIN = 8;
  var openWindows = new Map();
  var windowLayer = null;
  var zCounter = 1;
  var cascade = 0;
  var validityTimer = 0;
  var resizeListening = false;

  function readGeometry() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(GEOMETRY_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function writeGeometry(key, geometry) {
    if (!key) return;
    try {
      var all = readGeometry();
      all[key] = geometry;
      global.localStorage.setItem(GEOMETRY_KEY, JSON.stringify(all));
    } catch (_error) { /* storage is optional */ }
  }

  function getWindowLayer() {
    if (windowLayer && windowLayer.isConnected) return windowLayer;
    windowLayer = global.document.createElement("div");
    windowLayer.className = "zoidium-window-layer";
    global.document.body.appendChild(windowLayer);
    if (!resizeListening) {
      resizeListening = true;
      global.addEventListener("resize", function () {
        openWindows.forEach(function (win) { win._clamp(); });
      });
    }
    return windowLayer;
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function svgIcon(path) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = global.document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    var shape = global.document.createElementNS(ns, "path");
    shape.setAttribute("d", path);
    svg.appendChild(shape);
    return svg;
  }

  function titleButton(label, iconPath, onClick) {
    var button = global.document.createElement("button");
    button.type = "button";
    button.className = "zoidium-window-titlebutton";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.appendChild(svgIcon(iconPath));
    button.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function scheduleValidityChecks() {
    if (validityTimer || !global.setInterval) return;
    validityTimer = global.setInterval(function () {
      openWindows.forEach(function (win) {
        if (typeof win._isValid !== "function") return;
        var valid = true;
        try { valid = win._isValid() !== false; } catch (_error) { valid = false; }
        if (!valid) win.close();
      });
      if (openWindows.size === 0) {
        global.clearInterval(validityTimer);
        validityTimer = 0;
      }
    }, 500);
  }

  function focusTopWindow() {
    var top = null;
    openWindows.forEach(function (win) {
      if (!top || Number(win.element.style.zIndex) > Number(top.element.style.zIndex)) top = win;
    });
    if (top) top.focus();
  }

  function openWindow(options) {
    var config = options || {};
    if (!global.document || !global.document.body) return null;
    var id = String(config.id || ("window-" + Date.now() + "-" + Math.random().toString(36).slice(2)));
    var existing = openWindows.get(id);
    if (existing) {
      existing.focus();
      return existing;
    }

    var doc = global.document;
    var layer = getWindowLayer();
    var viewportWidth = global.innerWidth || 1280;
    var viewportHeight = global.innerHeight || 720;
    var minWidth = Math.max(180, Number(config.minWidth) || 240);
    var minHeight = Math.max(80, Number(config.minHeight) || 120);
    var saved = config.persistKey ? readGeometry()[config.persistKey] : null;
    var width = Number(saved && saved.width) || Number(config.width) || 340;
    var height = Number(saved && saved.height) || Number(config.height) || 420;
    var defaultX = viewportWidth - width - 380 - cascade * 24;
    var defaultY = 70 + cascade * 24;
    cascade = (cascade + 1) % 6;
    var x = Number.isFinite(Number(saved && saved.x)) ? Number(saved.x)
      : Number.isFinite(Number(config.x)) ? Number(config.x) : defaultX;
    var y = Number.isFinite(Number(saved && saved.y)) ? Number(saved.y)
      : Number.isFinite(Number(config.y)) ? Number(config.y) : defaultY;
    var collapsed = Boolean(saved && saved.collapsed);

    var root = doc.createElement("section");
    root.className = "zoidium-window" + (config.className ? " " + config.className : "");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", config.title || "Window");
    root.tabIndex = -1;
    root.dataset.windowId = id;

    var titlebar = doc.createElement("header");
    titlebar.className = "zoidium-window-titlebar noselect";
    var titleText = doc.createElement("span");
    titleText.className = "zoidium-window-title";
    titleText.textContent = config.title || "";
    var subtitleText = doc.createElement("span");
    subtitleText.className = "zoidium-window-subtitle";
    subtitleText.textContent = config.subtitle || "";
    var actions = doc.createElement("span");
    actions.className = "zoidium-window-titleactions";
    titlebar.appendChild(titleText);
    titlebar.appendChild(subtitleText);
    titlebar.appendChild(actions);

    var body = doc.createElement("div");
    body.className = "zoidium-window-body";
    var footer = doc.createElement("footer");
    footer.className = "zoidium-window-footer";
    footer.hidden = true;

    root.appendChild(titlebar);
    root.appendChild(body);
    root.appendChild(footer);

    var cleanups = [];
    var closeCallbacks = [];
    var closed = false;

    var win = {
      id: id,
      element: root,
      body: body,
      footer: footer,
      titlebar: titlebar,
      _isValid: typeof config.isValid === "function" ? config.isValid : null,
      setTitle: function (title) {
        titleText.textContent = title || "";
        root.setAttribute("aria-label", title || "Window");
      },
      setSubtitle: function (subtitle) { subtitleText.textContent = subtitle || ""; },
      isOpen: function () { return !closed; },
      onClose: function (callback) {
        if (typeof callback === "function") closeCallbacks.push(callback);
        return win;
      },
      addCleanup: function (callback) {
        if (typeof callback === "function") cleanups.push(callback);
        return win;
      },
      setFooter: function (buttons) {
        footer.textContent = "";
        (buttons || []).forEach(function (spec) {
          if (!spec) return;
          footer.appendChild(controls.button(spec).element);
        });
        footer.hidden = footer.children.length === 0;
      },
      setCollapsed: function (value) {
        collapsed = Boolean(value);
        root.classList.toggle("collapsed", collapsed);
        persist();
      },
      focus: function () {
        if (closed) return;
        zCounter += 1;
        root.style.zIndex = String(zCounter);
        openWindows.forEach(function (other) {
          other.element.classList.toggle("focused", other === win);
        });
        if (!root.contains(doc.activeElement)) {
          try { root.focus({ preventScroll: true }); } catch (_error) { root.focus(); }
        }
      },
      close: function () {
        if (closed) return;
        closed = true;
        openWindows.delete(id);
        cleanups.splice(0).reverse().forEach(function (cleanup) {
          try { cleanup(); } catch (error) { console.error("[Zoidium] window cleanup failed:", error); }
        });
        closeCallbacks.splice(0).forEach(function (callback) {
          try { callback(); } catch (error) { console.error("[Zoidium] window close handler failed:", error); }
        });
        root.remove();
        focusTopWindow();
      },
      _clamp: function () {
        var vw = global.innerWidth || viewportWidth;
        var vh = global.innerHeight || viewportHeight;
        width = clampNumber(width, minWidth, Math.max(minWidth, vw - WINDOW_MARGIN * 2));
        height = clampNumber(height, minHeight, Math.max(minHeight, vh - WINDOW_MARGIN * 2));
        // Keep at least the title bar reachable.
        x = clampNumber(x, WINDOW_MARGIN - width + 80, vw - 80);
        y = clampNumber(y, WINDOW_MARGIN, vh - 32);
        root.style.left = Math.round(x) + "px";
        root.style.top = Math.round(y) + "px";
        root.style.width = Math.round(width) + "px";
        root.style.height = Math.round(height) + "px";
      },
    };

    function persist() {
      writeGeometry(config.persistKey, { x: x, y: y, width: width, height: height, collapsed: collapsed });
    }

    if (config.collapsible !== false) {
      actions.appendChild(titleButton("Collapse", "M3 7h10v2H3z", function () {
        win.setCollapsed(!collapsed);
      }));
    }
    actions.appendChild(titleButton("Close", "M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z", function () {
      win.close();
    }));
    titlebar.addEventListener("dblclick", function () { win.setCollapsed(!collapsed); });

    // Dragging by the title bar.
    titlebar.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      win.focus();
      var startX = event.clientX;
      var startY = event.clientY;
      var originX = x;
      var originY = y;
      root.classList.add("dragging");
      function move(moveEvent) {
        x = originX + moveEvent.clientX - startX;
        y = originY + moveEvent.clientY - startY;
        win._clamp();
      }
      function up() {
        root.classList.remove("dragging");
        global.removeEventListener("pointermove", move);
        global.removeEventListener("pointerup", up);
        global.removeEventListener("pointercancel", up);
        persist();
      }
      global.addEventListener("pointermove", move);
      global.addEventListener("pointerup", up);
      global.addEventListener("pointercancel", up);
    });

    // Resizing from the right edge, bottom edge and corner.
    if (config.resizable !== false) {
      ["e", "s", "se"].forEach(function (edge) {
        var grip = doc.createElement("div");
        grip.className = "zoidium-window-grip zoidium-window-grip-" + edge;
        grip.addEventListener("pointerdown", function (event) {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          win.focus();
          var startX = event.clientX;
          var startY = event.clientY;
          var originWidth = width;
          var originHeight = height;
          function move(moveEvent) {
            if (edge !== "s") width = Math.max(minWidth, originWidth + moveEvent.clientX - startX);
            if (edge !== "e") height = Math.max(minHeight, originHeight + moveEvent.clientY - startY);
            win._clamp();
          }
          function up() {
            global.removeEventListener("pointermove", move);
            global.removeEventListener("pointerup", up);
            global.removeEventListener("pointercancel", up);
            persist();
          }
          global.addEventListener("pointermove", move);
          global.addEventListener("pointerup", up);
          global.addEventListener("pointercancel", up);
        });
        root.appendChild(grip);
      });
    }

    root.addEventListener("pointerdown", function () { win.focus(); }, true);
    // Keep editor shortcuts (play, delete, undo) from firing while typing in
    // a window. Escape closes the window unless a control consumed it.
    ["keydown", "keyup", "keypress"].forEach(function (type) {
      root.addEventListener(type, function (event) {
        if (type === "keydown" && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          win.close();
        }
        event.stopPropagation();
      });
    });
    root.addEventListener("wheel", function (event) { event.stopPropagation(); }, { passive: true });
    root.addEventListener("contextmenu", function (event) { event.stopPropagation(); });

    openWindows.set(id, win);
    layer.appendChild(root);
    win._clamp();
    if (collapsed) root.classList.add("collapsed");
    if (config.footer) win.setFooter(config.footer);
    if (typeof config.onClose === "function") win.onClose(config.onClose);
    win.focus();

    if (typeof config.mount === "function") {
      try {
        var cleanup = config.mount(body, win);
        if (typeof cleanup === "function") cleanups.push(cleanup);
      } catch (error) {
        console.error("[Zoidium] failed to open window " + id + ":", error);
        win.close();
        notify({ title: "Could not open " + (config.title || "window") + ".", message: String(error && error.message || error) });
        throw error;
      }
    }
    if (win._isValid) scheduleValidityChecks();
    return win;
  }

  function getWindow(id) {
    return openWindows.get(String(id)) || null;
  }

  // Closes every window whose id starts with prefix (or all windows).
  function closeWindows(prefix) {
    Array.from(openWindows.values()).forEach(function (win) {
      if (!prefix || win.id.indexOf(prefix) === 0) win.close();
    });
  }

  // ---------------------------------------------------------------------
  // Form controls
  //
  // Builders for window contents that look and behave like CM3 property
  // rows. Each returns { element, get(), set(value), setDisabled(bool) }.
  // onInput fires continuously while the user drags; onChange fires once
  // when an edit is committed, which is where callers record undo history.

  function el(tag, className, text) {
    var node = global.document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function call(fn, value) {
    if (typeof fn === "function") fn(value);
  }

  function labeledRow(label, hint) {
    var row = el("div", "zoidium-field");
    var name = el("span", "zoidium-field-label", label || "");
    if (hint) name.title = hint;
    row.appendChild(name);
    var slot = el("div", "zoidium-field-control");
    row.appendChild(slot);
    return { row: row, slot: slot };
  }

  function roundTo(value, step) {
    if (!step || !Number.isFinite(step)) return value;
    var decimals = (String(step).split(".")[1] || "").length;
    return Number((Math.round(value / step) * step).toFixed(Math.min(6, decimals)));
  }

  function formatNumber(value, step) {
    if (!Number.isFinite(value)) return "0";
    var decimals = step ? (String(step).split(".")[1] || "").length : 3;
    return String(Number(value.toFixed(Math.min(6, decimals))));
  }

  // CM3-style scrubbable number: drag horizontally to change, click to type.
  function number(options) {
    var config = options || {};
    var min = Number.isFinite(config.min) ? config.min : -Infinity;
    var max = Number.isFinite(config.max) ? config.max : Infinity;
    var step = Number(config.step) || 0.01;
    var value = clampNumber(Number(config.value) || 0, min, max);
    var parts = labeledRow(config.label, config.hint);
    var input = el("input", "pzinput zoidium-number");
    input.type = "text";
    input.inputMode = "decimal";
    input.spellcheck = false;
    input.value = formatNumber(value, step);
    if (config.unit) parts.slot.appendChild(el("span", "zoidium-field-unit", config.unit));
    parts.slot.insertBefore(input, parts.slot.firstChild);
    var editing = false;

    function apply(next, commit) {
      next = roundTo(clampNumber(Number(next), min, max), step);
      if (!Number.isFinite(next)) next = value;
      var changed = next !== value;
      value = next;
      input.value = formatNumber(value, step);
      if (changed || commit) call(commit ? config.onChange : config.onInput, value);
    }
    function stopEdit(commit) {
      if (!editing) return;
      editing = false;
      input.classList.remove("edit");
      if (commit) {
        var parsed = Number(String(input.value).replace(",", "."));
        if (Number.isFinite(parsed)) apply(parsed, true);
        else input.value = formatNumber(value, step);
      } else {
        input.value = formatNumber(value, step);
      }
    }
    input.readOnly = true;
    input.addEventListener("pointerdown", function (event) {
      if (editing || input.disabled || event.button !== 0) return;
      event.preventDefault();
      var startX = event.clientX;
      var startValue = value;
      var moved = false;
      var speed = Number(config.dragSpeed) || step;
      try { input.setPointerCapture(event.pointerId); } catch (_error) { /* optional */ }
      function move(moveEvent) {
        var delta = moveEvent.clientX - startX;
        if (!moved && Math.abs(delta) < 3) return;
        moved = true;
        var scale = moveEvent.shiftKey ? 10 : moveEvent.altKey ? 0.1 : 1;
        apply(startValue + delta * speed * scale, false);
      }
      function up() {
        input.removeEventListener("pointermove", move);
        input.removeEventListener("pointerup", up);
        input.removeEventListener("pointercancel", up);
        if (moved) {
          call(config.onChange, value);
          return;
        }
        editing = true;
        input.readOnly = false;
        input.classList.add("edit");
        input.focus();
        input.select();
      }
      input.addEventListener("pointermove", move);
      input.addEventListener("pointerup", up);
      input.addEventListener("pointercancel", up);
    });
    input.addEventListener("keydown", function (event) {
      if (!editing) return;
      if (event.key === "Enter") { stopEdit(true); input.readOnly = true; input.blur(); }
      if (event.key === "Escape") { event.preventDefault(); stopEdit(false); input.readOnly = true; input.blur(); }
    });
    input.addEventListener("blur", function () { stopEdit(true); input.readOnly = true; });

    return {
      element: parts.row,
      input: input,
      get: function () { return value; },
      set: function (next) {
        value = clampNumber(Number(next) || 0, min, max);
        if (!editing) input.value = formatNumber(value, step);
      },
      setDisabled: function (disabled) {
        input.disabled = Boolean(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  // Range slider with an attached scrubbable number.
  function slider(options) {
    var config = options || {};
    var min = Number.isFinite(config.min) ? config.min : 0;
    var max = Number.isFinite(config.max) ? config.max : 1;
    var step = Number(config.step) || (max - min) / 100;
    var parts = labeledRow(config.label, config.hint);
    parts.row.classList.add("zoidium-field-slider");
    var range = el("input", "zoidium-range");
    range.type = "range";
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    var numberControl = number({
      min: config.softLimit ? -Infinity : min,
      max: config.softLimit ? Infinity : max,
      step: step,
      value: config.value,
      unit: config.unit,
      dragSpeed: config.dragSpeed || (max - min) / 200,
      onInput: function (value) { range.value = String(value); call(config.onInput, value); },
      onChange: function (value) { range.value = String(value); call(config.onChange, value); },
    });
    var numberInput = numberControl.element.querySelector(".zoidium-field-control");
    range.value = String(numberControl.get());
    range.addEventListener("input", function () {
      numberControl.set(Number(range.value));
      call(config.onInput, numberControl.get());
    });
    range.addEventListener("change", function () {
      numberControl.set(Number(range.value));
      call(config.onChange, numberControl.get());
    });
    parts.slot.appendChild(range);
    parts.slot.appendChild(numberInput);
    return {
      element: parts.row,
      get: numberControl.get,
      set: function (value) { numberControl.set(value); range.value = String(numberControl.get()); },
      setDisabled: function (disabled) {
        range.disabled = Boolean(disabled);
        numberControl.setDisabled(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  function checkbox(options) {
    var config = options || {};
    var parts = labeledRow(config.label, config.hint);
    var box = el("input", "zoidium-checkbox");
    box.type = "checkbox";
    box.checked = Boolean(config.value);
    box.setAttribute("aria-label", config.label || "");
    box.addEventListener("change", function () { call(config.onChange, box.checked); });
    parts.slot.appendChild(box);
    parts.row.querySelector(".zoidium-field-label").addEventListener("click", function () {
      if (box.disabled) return;
      box.checked = !box.checked;
      call(config.onChange, box.checked);
    });
    return {
      element: parts.row,
      get: function () { return box.checked; },
      set: function (value) { box.checked = Boolean(value); },
      setDisabled: function (disabled) {
        box.disabled = Boolean(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  // options: [{ value, label }] or plain strings.
  function select(options) {
    var config = options || {};
    var parts = labeledRow(config.label, config.hint);
    var node = el("select", "pz-inputbox zoidium-select");
    node.setAttribute("aria-label", config.label || "");
    function fill(list) {
      node.textContent = "";
      (list || []).forEach(function (item) {
        var option = el("option");
        var value = item && typeof item === "object" ? item.value : item;
        option.value = String(value);
        option.textContent = item && typeof item === "object" ? String(item.label != null ? item.label : value) : String(item);
        node.appendChild(option);
      });
    }
    fill(config.options);
    if (config.value != null) node.value = String(config.value);
    node.addEventListener("change", function () { call(config.onChange, node.value); });
    parts.slot.appendChild(node);
    return {
      element: parts.row,
      get: function () { return node.value; },
      set: function (value) { node.value = String(value); },
      setOptions: function (list, value) { fill(list); if (value != null) node.value = String(value); },
      setDisabled: function (disabled) {
        node.disabled = Boolean(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  function color(options) {
    var config = options || {};
    var parts = labeledRow(config.label, config.hint);
    var node = el("input", "zoidium-color");
    node.type = "color";
    node.value = /^#[0-9a-f]{6}$/i.test(config.value || "") ? config.value : "#ffffff";
    var hex = el("span", "zoidium-color-hex", node.value);
    node.addEventListener("input", function () { hex.textContent = node.value; call(config.onInput, node.value); });
    node.addEventListener("change", function () { hex.textContent = node.value; call(config.onChange, node.value); });
    parts.slot.appendChild(hex);
    parts.slot.appendChild(node);
    return {
      element: parts.row,
      get: function () { return node.value; },
      set: function (value) {
        if (/^#[0-9a-f]{6}$/i.test(value || "")) { node.value = value; hex.textContent = value; }
      },
      setDisabled: function (disabled) {
        node.disabled = Boolean(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  function text(options) {
    var config = options || {};
    var parts = labeledRow(config.label, config.hint);
    var node = el(config.multiline ? "textarea" : "input", "pz-inputbox zoidium-text");
    if (!config.multiline) node.type = "text";
    else node.rows = config.rows || 4;
    node.value = config.value != null ? String(config.value) : "";
    if (config.placeholder) node.placeholder = config.placeholder;
    node.spellcheck = false;
    node.addEventListener("input", function () { call(config.onInput, node.value); });
    node.addEventListener("change", function () { call(config.onChange, node.value); });
    if (config.multiline) parts.row.classList.add("zoidium-field-stacked");
    parts.slot.appendChild(node);
    return {
      element: parts.row,
      get: function () { return node.value; },
      set: function (value) { node.value = value != null ? String(value) : ""; },
      setDisabled: function (disabled) {
        node.disabled = Boolean(disabled);
        parts.row.classList.toggle("disabled", Boolean(disabled));
      },
    };
  }

  // variant: "primary" | "danger" | undefined
  function button(options) {
    var config = options || {};
    var node = el("button", "proprow propbutton zoidium-button" + (config.variant ? " " + config.variant : ""), config.title || "");
    node.type = "button";
    if (config.hint) node.title = config.hint;
    node.addEventListener("click", function (event) {
      if (typeof config.onClick === "function") config.onClick(event);
    });
    return {
      element: node,
      get: function () { return node.textContent; },
      set: function (title) { node.textContent = title; },
      setDisabled: function (disabled) { node.disabled = Boolean(disabled); },
    };
  }

  function buttonRow(buttons) {
    var row = el("div", "zoidium-button-row");
    (buttons || []).forEach(function (spec) {
      if (spec) row.appendChild((spec.element ? spec : button(spec)).element);
    });
    return { element: row };
  }

  // Collapsible group with a CM3 section title.
  function section(options) {
    var config = typeof options === "string" ? { title: options } : (options || {});
    var wrap = el("div", "zoidium-section");
    var head = el("button", "zoidium-section-title noselect");
    head.type = "button";
    var caret = el("span", "zoidium-section-caret", "▾");
    head.appendChild(caret);
    head.appendChild(el("span", "", config.title || ""));
    var content = el("div", "zoidium-section-body");
    wrap.appendChild(head);
    wrap.appendChild(content);
    function setCollapsed(value) {
      wrap.classList.toggle("collapsed", Boolean(value));
      head.setAttribute("aria-expanded", value ? "false" : "true");
    }
    setCollapsed(config.collapsed);
    head.addEventListener("click", function () {
      setCollapsed(!wrap.classList.contains("collapsed"));
    });
    return { element: wrap, body: content, setCollapsed: setCollapsed };
  }

  // tabs: [{ id, title, render(body) }]. Panels render lazily on first show.
  function tabs(options) {
    var config = Array.isArray(options) ? { tabs: options } : (options || {});
    var wrap = el("div", "zoidium-tabs");
    var strip = el("div", "zoidium-tabstrip noselect");
    strip.setAttribute("role", "tablist");
    var panels = el("div", "zoidium-tabpanels");
    wrap.appendChild(strip);
    wrap.appendChild(panels);
    var entries = [];
    function show(id) {
      entries.forEach(function (entry) {
        var active = entry.spec.id === id;
        entry.tab.classList.toggle("selected", active);
        entry.tab.setAttribute("aria-selected", active ? "true" : "false");
        entry.panel.hidden = !active;
        if (active && !entry.rendered && typeof entry.spec.render === "function") {
          entry.rendered = true;
          entry.spec.render(entry.panel);
        }
      });
      call(config.onChange, id);
    }
    (config.tabs || []).forEach(function (spec) {
      var tab = el("button", "zoidium-tab", spec.title || spec.id);
      tab.type = "button";
      tab.setAttribute("role", "tab");
      var panel = el("div", "zoidium-tabpanel");
      panel.hidden = true;
      tab.addEventListener("click", function () { show(spec.id); });
      strip.appendChild(tab);
      panels.appendChild(panel);
      entries.push({ spec: spec, tab: tab, panel: panel, rendered: false });
    });
    if (entries.length) show(config.value || entries[0].spec.id);
    return { element: wrap, show: show };
  }

  // Selectable list in CM3 option style. items: [{ id, title, detail }].
  function list(options) {
    var config = options || {};
    var node = el("ul", "pz-options zoidium-list");
    node.setAttribute("role", "listbox");
    var selected = config.value != null ? config.value : null;
    function render(items) {
      node.textContent = "";
      if (!items || !items.length) {
        node.appendChild(el("li", "zoidium-list-empty", config.emptyText || "Nothing here yet."));
        return;
      }
      items.forEach(function (item) {
        var row = el("li", item.id === selected ? "active" : "");
        row.tabIndex = 0;
        row.setAttribute("role", "option");
        row.dataset.id = String(item.id);
        row.appendChild(el("b", "", item.title || String(item.id)));
        if (item.detail) row.appendChild(el("span", "", item.detail));
        row.addEventListener("click", function () {
          selected = item.id;
          Array.from(node.children).forEach(function (child) {
            child.classList.toggle("active", child === row);
          });
          call(config.onSelect, item.id);
        });
        row.addEventListener("dblclick", function () { call(config.onActivate, item.id); });
        row.addEventListener("keydown", function (event) {
          if (event.key === "Enter") { row.click(); call(config.onActivate, item.id); }
        });
        node.appendChild(row);
      });
    }
    render(config.items);
    return {
      element: node,
      get: function () { return selected; },
      set: function (id) {
        selected = id;
        Array.from(node.children).forEach(function (child) {
          child.classList.toggle("active", child.dataset.id === String(id));
        });
      },
      setItems: render,
    };
  }

  function note(message, variant) {
    return { element: el("p", "zoidium-note" + (variant ? " " + variant : ""), message || "") };
  }

  var controls = Object.freeze({
    number: number,
    slider: slider,
    checkbox: checkbox,
    select: select,
    color: color,
    text: text,
    button: button,
    buttonRow: buttonRow,
    section: section,
    tabs: tabs,
    list: list,
    note: note,
  });

  global.ZoidiumUI = Object.freeze({
    getElevator: getElevator,
    createMenubarTab: createMenubarTab,
    removeMenubarTab: removeMenubarTab,
    acquirePreview: acquirePreview,
    createPageHeader: createPageHeader,
    notify: notify,
    createSearchBox: createSearchBox,
    attachSearchFilter: attachSearchFilter,
    createButton: createButton,
    openWindow: openWindow,
    getWindow: getWindow,
    closeWindows: closeWindows,
    controls: controls,
  });
})(window);
