(function (global) {
  "use strict";
  var builder = global.ZoidiumUIBuilder = global.ZoidiumUIBuilder || {};
  var hosts = new WeakMap();

  // Listeners and animation requests follow a live DOM tree between documents.
  // No global event forwarding: a popup must never drive another editor's drag.
  function environment(root) {
    var listeners = [], frames = new Map(), changes = new Set(), nextFrame = 0;
    var doc = root.ownerDocument || global.document;
    var view = doc.defaultView || global;
    function target(kind) { return kind === "document" ? doc : view; }
    function schedule(record) {
      record.view = view;
      record.request = view.requestAnimationFrame(function (time) {
        frames.delete(record.id);
        record.callback(time);
      });
    }
    var env = {
      get document() { return doc; },
      get window() { return view; },
      listen: function (kind, type, callback, options) {
        var entry = { kind: kind, type: type, callback: callback, options: options };
        listeners.push(entry);
        target(kind).addEventListener(type, callback, options);
        return function () {
          var index = listeners.indexOf(entry);
          if (index < 0) return;
          listeners.splice(index, 1);
          target(kind).removeEventListener(type, callback, options);
        };
      },
      onHostChange: function (callback) {
        changes.add(callback);
        return function () { changes.delete(callback); };
      },
      requestAnimationFrame: function (callback) {
        var record = { id: ++nextFrame, callback: callback };
        frames.set(record.id, record); schedule(record); return record.id;
      },
      cancelAnimationFrame: function (id) {
        var record = frames.get(id);
        if (!record) return;
        record.view.cancelAnimationFrame(record.request); frames.delete(id);
      },
      refresh: function () {
        var nextDoc = root.ownerDocument || global.document;
        if (nextDoc === doc) return;
        listeners.forEach(function (entry) { target(entry.kind).removeEventListener(entry.type, entry.callback, entry.options); });
        frames.forEach(function (record) { record.view.cancelAnimationFrame(record.request); });
        var previous = view;
        doc = nextDoc; view = doc.defaultView || global;
        listeners.forEach(function (entry) { target(entry.kind).addEventListener(entry.type, entry.callback, entry.options); });
        frames.forEach(schedule);
        changes.forEach(function (callback) { callback(view, previous); });
      },
      dispose: function () {
        listeners.splice(0).forEach(function (entry) { target(entry.kind).removeEventListener(entry.type, entry.callback, entry.options); });
        frames.forEach(function (record) { record.view.cancelAnimationFrame(record.request); });
        frames.clear(); changes.clear(); hosts.delete(root);
      },
    };
    hosts.set(root, env);
    return env;
  }

  function refreshTree(root) {
    [root].concat(Array.from(root.querySelectorAll("*"))).forEach(function (node) {
      var env = hosts.get(node);
      if (env) env.refresh();
    });
  }

  // Retain source order and resolved URLs. Update copies in place so changing
  // a theme never briefly removes a popup's stylesheets.
  function mirrorStyles(popup) {
    var source = global.document, doc = popup.document, copies = new Map();
    var base = doc.createElement("base"); base.href = source.baseURI; doc.head.appendChild(base);
    function sync() {
      var sources = Array.from(source.head.querySelectorAll('link[rel="stylesheet"],style'));
      copies.forEach(function (copy, node) { if (!sources.includes(node)) { copy.remove(); copies.delete(node); } });
      sources.forEach(function (node) {
        var copy = copies.get(node);
        if (!copy) { copy = doc.createElement(node.tagName.toLowerCase()); copies.set(node, copy); }
        if (node.tagName === "LINK") {
          copy.rel = "stylesheet";
          if (copy.href !== node.href) copy.href = node.href;
          copy.media = node.media; copy.disabled = node.disabled;
        } else if (copy.textContent !== node.textContent) copy.textContent = node.textContent;
        // Moving existing nodes preserves their sheet and the exact cascade.
        doc.head.appendChild(copy);
      });
      ["style", "class", "data-zoidium-theme", "data-zoidium-font", "dir", "lang"].forEach(function (name) {
        var value = source.documentElement.getAttribute(name);
        if (value == null) doc.documentElement.removeAttribute(name);
        else doc.documentElement.setAttribute(name, value);
      });
    }
    sync();
    var observer = new global.MutationObserver(sync);
    observer.observe(source.head, { childList: true, subtree: true, characterData: true, attributes: true });
    observer.observe(source.documentElement, { attributes: true });
    function theme() { sync(); popup.dispatchEvent(new popup.CustomEvent("zoidium:theme-changed")); }
    global.addEventListener("zoidium:theme-changed", theme);
    return function () { observer.disconnect(); global.removeEventListener("zoidium:theme-changed", theme); copies.clear(); };
  }

  function attach(win, config, layer, button) {
    var root = win.element, env = environment(root), popup = null, disposeStyles = null;
    var returning = false, geometry = null, popupBounds = null;
    ["document", "window"].forEach(function (key) {
      Object.defineProperty(win, key, { get: function () { return env[key]; } });
    });
    ["listen", "onHostChange", "requestAnimationFrame", "cancelAnimationFrame"].forEach(function (key) { win[key] = env[key]; });
    win.isPoppedOut = function () { return !!popup; };
    function rememberBounds() {
      if (!popup || popup.closed) return;
      popupBounds = { width: popup.innerWidth, height: popup.innerHeight, left: popup.screenX, top: popup.screenY };
      if (config.persistKey) try { global.localStorage.setItem("zoidium.ui.popup." + config.persistKey, JSON.stringify(popupBounds)); } catch (_error) { /* optional storage */ }
    }
    function beforeMove() {
      var active = env.document.activeElement;
      if (active && root.contains(active) && active.blur) active.blur();
      if (builder.menus) { var release = builder.menus.claim(function () {}); release(); }
      root.dispatchEvent(new global.CustomEvent("zoidium:before-host-change"));
      if (builder.popupControls) builder.popupControls.settle(root);
    }
    function refresh() {
      refreshTree(root);
      root.dispatchEvent(new global.CustomEvent("zoidium:host-changed"));
      env.window.dispatchEvent(new env.window.Event("resize"));
      win.focus();
    }
    win.returnToMain = function () {
      if (!popup || returning) return;
      returning = true;
      var old = popup;
      rememberBounds(); beforeMove();
      old.removeEventListener("pagehide", win.returnToMain);
      old.removeEventListener("resize", rememberBounds);
      if (disposeStyles) disposeStyles(); disposeStyles = null;
      popup = null;
      layer.appendChild(root);
      root.classList.remove("zoidium-window-popped-out");
      root.style.cssText = geometry;
      button.title = "Pop out"; button.setAttribute("aria-label", button.title);
      win._clamp(); refresh();
      if (!old.closed) old.close();
      returning = false;
    };
    win.popOut = function () {
      if (!win.isOpen() || config.popout === false) return false;
      if (popup) { popup.focus(); return true; }
      if (!popupBounds && config.persistKey) try { popupBounds = JSON.parse(global.localStorage.getItem("zoidium.ui.popup." + config.persistKey)); } catch (_error) { /* defaults */ }
      var rect = root.getBoundingClientRect(), bounds = popupBounds || { width: rect.width, height: rect.height };
      var features = ["popup=yes", "width=" + Math.max(240, Math.round(bounds.width) || 600), "height=" + Math.max(120, Math.round(bounds.height) || 400)];
      if (Number.isFinite(bounds.left) && Number.isFinite(bounds.top)) features.push("left=" + Math.round(bounds.left), "top=" + Math.round(bounds.top));
      // A named, empty document inherits the opener's origin and no scripts.
      var opened = global.open("about:blank", "zoidium-popout-" + encodeURIComponent(win.id), features.join(","));
      if (!opened) {
        builder.notify({ title: "Popup blocked", message: "Allow popups for this site, then click Pop out again." });
        return false;
      }
      beforeMove();
      popup = opened;
      var doc = popup.document;
      doc.title = root.getAttribute("aria-label") || "Zoidium";
      doc.body.className = "zoidium-popout-body";
      disposeStyles = mirrorStyles(popup);
      geometry = root.style.cssText;
      doc.body.appendChild(root);
      root.classList.add("zoidium-window-popped-out");
      button.title = "Return to editor"; button.setAttribute("aria-label", button.title);
      popup.addEventListener("pagehide", win.returnToMain);
      popup.addEventListener("resize", rememberBounds);
      win._clamp(); refresh();
      popup.focus();
      return true;
    };
    var focus = win.focus;
    win.focus = function () { if (popup && !popup.closed) popup.focus(); focus(); };
    var setTitle = win.setTitle;
    win.setTitle = function (title) { setTitle(title); if (popup && !popup.closed) popup.document.title = title || "Zoidium"; };
    function unload() { win.close(); }
    global.addEventListener("pagehide", unload);
    win.addCleanup(function () {
      global.removeEventListener("pagehide", unload);
      beforeMove();
      if (popup) {
        var old = popup; rememberBounds();
        old.removeEventListener("pagehide", win.returnToMain);
        old.removeEventListener("resize", rememberBounds);
        if (disposeStyles) disposeStyles();
        // Plugin cleanup runs in its current document before this disposer.
        popup = null; root.remove(); if (!old.closed) old.close();
      }
      env.dispose();
    });
  }
  builder.popouts = { environment: environment, refreshTree: refreshTree, attach: attach };
})(window);
