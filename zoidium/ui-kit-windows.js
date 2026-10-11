(function (global) {
  "use strict";

  // Floating window manager for the Zoidium UI kit: every plugin editor opens
  // as a floating window above the editor instead of a fullscreen overlay.
  // Loaded before zoidium/ui-kit.js, which publishes openWindow, getWindow
  // and closeWindows on the frozen ZoidiumUI surface (see postInitScripts in
  // zoidium/runtime-config.js). Footer buttons and failure notifications go
  // through the controls and notify members the assembler provides on
  // global.ZoidiumUIBuilder, so this file has no load-order requirements
  // beyond the assembler running last.

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
    installWindowColorPicker();
    if (windowLayer && windowLayer.isConnected) return windowLayer;
    windowLayer = global.document.createElement("div");
    windowLayer.className = "zoidium-window-layer";
    global.document.body.appendChild(windowLayer);
    if (!resizeListening) {
      resizeListening = true;
      global.addEventListener("resize", function () {
        openWindows.forEach(function (win) { win._clamp(); });
      });
      listenForOutsidePointerDown();
    }
    return windowLayer;
  }

  // CM3 appends its unclassified color popup directly to body. Tag popups
  // opened from our windows so they can sit above the window stacking context,
  // just like native dropdowns. Keep CM3's editing and focus lifecycle intact.
  function installWindowColorPicker() {
    var PZ = global.PZ;
    var prototype = PZ && PZ.ui && PZ.ui.colorPicker && PZ.ui.colorPicker.prototype;
    if (!prototype || typeof prototype.open !== "function" || prototype.open.__zoidiumWindowPopup) return;
    var original = prototype.open;
    var open = function () {
      var inWindow = isInsideWindow(this.el);
      var result = original.apply(this, arguments);
      if (inWindow && this.picker) this.picker.classList.add("zoidium-window-color-picker");
      return result;
    };
    open.__zoidiumWindowPopup = true;
    prototype.open = open;
  }

  // Focusing a window moves DOM focus into it. Clicking the editor does not
  // move focus back (CM3 keeps focus on its own elements), so editor shortcuts
  // such as undo, Space, and Delete would stay blocked by the window's key
  // isolation. A pointer-down outside every window releases that focus and the
  // window's focused state.
  function isInsideWindow(node) {
    return !!(node && typeof node.closest === "function" && node.closest(".zoidium-window"));
  }

  function listenForOutsidePointerDown() {
    global.document.addEventListener("pointerdown", function (event) {
      if (isInsideWindow(event.target)) return;
      var active = global.document.activeElement;
      if (!isInsideWindow(active)) return;
      if (typeof active.blur === "function") active.blur();
      openWindows.forEach(function (win) { win.element.classList.remove("focused"); });
    }, true);
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
    // placement: "right" (default, beside the property panels), "center" or
    // "left". Saved geometry always wins.
    var defaultX = viewportWidth - width - 380 - cascade * 36;
    var defaultY = 70 + cascade * 36;
    if (config.placement === "center") {
      defaultX = (viewportWidth - width) / 2 + cascade * 24;
      defaultY = Math.max(WINDOW_MARGIN, (viewportHeight - height) / 2) + cascade * 24;
    } else if (config.placement === "left") {
      defaultX = 70 + cascade * 36;
    }
    cascade = (cascade + 1) % 6;
    function pick(key, fallback) {
      if (saved && Number.isFinite(saved[key])) return saved[key];
      if (config[key] != null && Number.isFinite(Number(config[key]))) return Number(config[key]);
      return fallback;
    }
    var x = pick("x", defaultX);
    var y = pick("y", defaultY);
    var collapsed = Boolean(saved && saved.collapsed);
    var maximizable = config.maximizable != null ? Boolean(config.maximizable) : config.resizable !== false;
    var maximized = maximizable && Boolean(saved && saved.maximized);
    var customChrome = config.chrome === "custom";

    var root = doc.createElement("section");
    root.className = "zoidium-window" + (config.className ? " " + config.className : "");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", config.title || "Window");
    root.tabIndex = -1;
    root.dataset.windowId = id;
    if (config.skin) root.dataset.zuiSkin = String(config.skin);
    if (customChrome) root.classList.add("zoidium-window-custom-chrome");

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
          footer.appendChild(builder.controls.button(spec).element);
        });
        footer.hidden = footer.children.length === 0;
      },
      setCollapsed: function (value) {
        collapsed = Boolean(value);
        root.classList.toggle("collapsed", collapsed);
        persist();
      },
      isMaximized: function () { return maximized; },
      // Fills the editor window (minus a margin); the previous geometry is
      // kept and restored.
      setMaximized: function (value) {
        if (!maximizable) return;
        maximized = Boolean(value);
        root.classList.toggle("maximized", maximized);
        if (maximizeButton) {
          maximizeButton.title = maximized ? "Restore" : "Maximize";
          maximizeButton.setAttribute("aria-label", maximizeButton.title);
        }
        win._clamp();
        persist();
      },
      toggleMaximized: function () { win.setMaximized(!maximized); },
      // Makes an element of a custom title bar drag the window. Double-click
      // toggles maximize. Controls inside it (buttons, inputs) keep working.
      makeDragHandle: function (handle) {
        if (!handle || typeof handle.addEventListener !== "function") return;
        handle.classList.add("zoidium-window-draghandle");
        handle.addEventListener("pointerdown", startDrag);
        handle.addEventListener("dblclick", function (event) {
          if (isInteractive(event.target, handle)) return;
          if (maximizable) win.toggleMaximized();
        });
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
        if (maximized) {
          root.style.left = WINDOW_MARGIN + "px";
          root.style.top = WINDOW_MARGIN + "px";
          root.style.width = Math.max(minWidth, vw - WINDOW_MARGIN * 2) + "px";
          root.style.height = Math.max(minHeight, vh - WINDOW_MARGIN * 2) + "px";
          return;
        }
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
      writeGeometry(config.persistKey, {
        x: x, y: y, width: width, height: height, collapsed: collapsed, maximized: maximized,
      });
    }

    var activePointerCleanup = null;
    win.addCleanup(function () {
      if (activePointerCleanup) activePointerCleanup();
    });

    var maximizeButton = null;
    if (config.collapsible !== false) {
      actions.appendChild(titleButton("Collapse", "M3 7h10v2H3z", function () {
        win.setCollapsed(!collapsed);
      }));
    }
    if (maximizable) {
      maximizeButton = titleButton("Maximize", "M3 3h10v10H3zm2 3v5h6V6z", function () {
        win.toggleMaximized();
      });
      actions.appendChild(maximizeButton);
    }
    actions.appendChild(titleButton("Close", "M4.2 3 8 6.8 11.8 3 13 4.2 9.2 8l3.8 3.8-1.2 1.2L8 9.2 4.2 13 3 11.8 6.8 8 3 4.2z", function () {
      win.close();
    }));
    titlebar.addEventListener("dblclick", function () { win.setCollapsed(!collapsed); });

    function isInteractive(target, handle) {
      var node = target;
      while (node && node !== handle) {
        if (/^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(node.tagName || "") || node.isContentEditable) return true;
        node = node.parentElement;
      }
      return false;
    }

    // Dragging by the title bar (or a custom chrome's drag handle).
    function startDrag(event) {
      if (event.button !== 0) return;
      if (event.currentTarget !== titlebar && isInteractive(event.target, event.currentTarget)) return;
      if (maximized) return;
      if (activePointerCleanup) activePointerCleanup();
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
        if (activePointerCleanup === up) activePointerCleanup = null;
        root.classList.remove("dragging");
        global.removeEventListener("pointermove", move);
        global.removeEventListener("pointerup", up);
        global.removeEventListener("pointercancel", up);
        persist();
      }
      global.addEventListener("pointermove", move);
      global.addEventListener("pointerup", up);
      global.addEventListener("pointercancel", up);
      activePointerCleanup = up;
    }
    titlebar.addEventListener("pointerdown", startDrag);
    // Custom chrome: the plugin draws its own title bar inside the body and
    // calls win.makeDragHandle() on it. The host title bar stays in the DOM
    // (hidden) so setTitle() and the accessible name keep working.
    if (customChrome) titlebar.hidden = true;

    // Resizing from the left, right and bottom edges and both bottom corners.
    // The top edge belongs to the title bar, which moves the window.
    if (config.resizable !== false) {
      ["e", "w", "s", "se", "sw"].forEach(function (edge) {
        var grip = doc.createElement("div");
        grip.className = "zoidium-window-grip zoidium-window-grip-" + edge;
        grip.addEventListener("pointerdown", function (event) {
          if (event.button !== 0 || maximized) return;
          if (activePointerCleanup) activePointerCleanup();
          event.preventDefault();
          event.stopPropagation();
          win.focus();
          var startX = event.clientX;
          var startY = event.clientY;
          var originWidth = width;
          var originHeight = height;
          var originX = x;
          var fromLeft = edge === "w" || edge === "sw";
          var fromRight = edge === "e" || edge === "se";
          var vertical = edge !== "e" && edge !== "w";
          function move(moveEvent) {
            var dx = moveEvent.clientX - startX;
            if (fromRight) width = Math.max(minWidth, originWidth + dx);
            if (fromLeft) {
              // Keep the right edge fixed while the left edge follows the pointer.
              var maxWidth = Math.max(minWidth, originX + originWidth - WINDOW_MARGIN);
              width = clampNumber(originWidth - dx, minWidth, maxWidth);
              x = originX + originWidth - width;
            }
            if (vertical) height = Math.max(minHeight, originHeight + moveEvent.clientY - startY);
            win._clamp();
          }
          function up() {
            if (activePointerCleanup === up) activePointerCleanup = null;
            global.removeEventListener("pointermove", move);
            global.removeEventListener("pointerup", up);
            global.removeEventListener("pointercancel", up);
            persist();
          }
          global.addEventListener("pointermove", move);
          global.addEventListener("pointerup", up);
          global.addEventListener("pointercancel", up);
          activePointerCleanup = up;
        });
        root.appendChild(grip);
      });
    }

    root.addEventListener("pointerdown", function () { win.focus(); }, true);
    // Keep editor shortcuts (play, delete, frame keys) from firing while a
    // window has focus. Escape closes the window unless a control consumed it.
    // Ctrl+Z, Ctrl+Y and Ctrl+S still reach CM3's editor handler, which skips
    // them itself while the focus is in a text field, so undo, redo and save
    // work right after an edit made in a window.
    var EDITOR_COMMAND_KEYS = { z: true, y: true, s: true };
    ["keydown", "keyup", "keypress"].forEach(function (type) {
      root.addEventListener(type, function (event) {
        if (type === "keydown" && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          win.close();
        }
        if (type === "keydown" && event.ctrlKey && !event.altKey
            && EDITOR_COMMAND_KEYS[String(event.key || "").toLowerCase()]) {
          return;
        }
        event.stopPropagation();
      });
    });
    root.addEventListener("wheel", function (event) { event.stopPropagation(); }, { passive: true });
    root.addEventListener("contextmenu", function (event) { event.stopPropagation(); });

    openWindows.set(id, win);
    layer.appendChild(root);
    if (maximized) root.classList.add("maximized");
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
        builder.notify({ title: "Could not open " + (config.title || "window") + ".", message: String(error && error.message || error) });
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

  var builder = global.ZoidiumUIBuilder = global.ZoidiumUIBuilder || {};
  builder.windows = {
    openWindow: openWindow,
    getWindow: getWindow,
    closeWindows: closeWindows,
  };
})(window);
