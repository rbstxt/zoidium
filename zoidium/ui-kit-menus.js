(function (global) {
  "use strict";

  // The shared transient menu coordinator also lets the searchable node menu
  // keep its own contents while participating in the one-menu-at-a-time rule.
  var builder = global.ZoidiumUIBuilder = global.ZoidiumUIBuilder || {};
  var current = null;
  var extensions = new Map();
  var styled = new WeakSet();
  var CSS = `
.zui-menu{position:fixed;z-index:10000;box-sizing:border-box;min-width:min(210px,calc(100vw - 8px));max-width:calc(100vw - 8px);max-height:calc(100vh - 8px);overflow:auto;scrollbar-color:var(--zui-text-faint) var(--zui-bg-title);padding:var(--zui-menu-padding,4px 0);background:var(--zui-bg);border:1px solid var(--zui-border);box-shadow:0 6px 18px color-mix(in srgb,var(--zui-shadow) 55%,transparent);color:var(--zui-text);font-family:var(--zui-font);font-size:var(--zui-menu-font-size,13px);outline:none;user-select:none}
.zui-menu-item{display:flex;align-items:center;gap:18px;padding:var(--zui-menu-item-padding,5px 14px);cursor:default;white-space:nowrap;outline:none}
.zui-menu-label{flex:1;overflow:hidden;text-overflow:ellipsis}
.zui-menu-key,.zui-menu-title{color:var(--zui-text-muted)}
.zui-menu-item.active{background:var(--zui-menu-active);color:var(--zui-text-bright)}
.zui-menu-item.muted:not(.active),.zui-menu-item.disabled,.zui-menu-item.disabled .zui-menu-key{color:var(--zui-text-faint)}
.zui-menu-title{padding:var(--zui-menu-title-padding,4px 14px 5px);font-size:var(--zui-menu-title-font-size,12px);white-space:nowrap}
.zui-menu-separator{height:1px;margin:4px 0;background:var(--zui-border-soft)}
.zui-menu-swatch{flex:none;box-sizing:border-box;width:12px;height:12px;border:1px solid var(--zui-border);background:var(--zui-bg-input)}
.zui-menu-check{flex:none;width:12px;text-align:center}
`;

  function claim(close) {
    if (current) current();
    current = close;
    return function () { if (current === close) current = null; };
  }

  function installStyle(doc) {
    if (styled.has(doc)) return;
    var style = doc.createElement("style");
    style.textContent = CSS;
    doc.head.appendChild(style);
    styled.add(doc);
  }

  // All coordinates are CSS pixels in the owner document's viewport.
  function openMenu(options) {
    var config = options || {};
    var items = Array.from(config.items || []);
    extensions.forEach(function (extension) {
      try {
        var added = extension.items(Object.assign({}, config, { items: items.slice() }));
        if (Array.isArray(added)) items.push.apply(items, added);
      } catch (error) { console.warn("[Zoidium] Menu extension failed: " + extension.id, error); }
    });
    config = Object.assign({}, config, { items: items });
    var owner = config.owner && (config.owner.element || config.owner);
    var anchor = config.anchor;
    var doc = config.document || (anchor && anchor.ownerDocument) || (owner && owner.ownerDocument) || global.document;
    var view = doc.defaultView || global;
    var restoreFocus = config.focusReturn || anchor || doc.activeElement;
    var element = doc.createElement("div");
    var entries = [], rows = [], active = -1, closed = false, cleanups = [];
    var release = claim(function () { close(false); });
    installStyle(doc);
    element.className = "zui-menu";
    element.setAttribute("role", "menu");
    element.setAttribute("aria-label", config.title || config.label || "Menu");
    element.tabIndex = -1;

    function listen(target, type, fn, capture) {
      target.addEventListener(type, fn, capture);
      cleanups.push(function () { target.removeEventListener(type, fn, capture); });
    }
    function close(focus) {
      if (closed) return;
      closed = true;
      release();
      cleanups.splice(0).reverse().forEach(function (cleanup) { cleanup(); });
      element.remove();
      if (focus !== false && restoreFocus && restoreFocus.isConnected !== false && typeof restoreFocus.focus === "function") {
        restoreFocus.focus({ preventScroll: true });
      }
      if (typeof config.onClose === "function") config.onClose();
    }
    function highlight(index, focus) {
      active = index;
      rows.forEach(function (row, i) {
        row.classList.toggle("active", i === index);
        row.tabIndex = i === index ? 0 : -1;
      });
      if (!rows[index]) return;
      if (focus !== false) rows[index].focus({ preventScroll: true });
      // Avoid scrolling the host; scroll only this menu's own overflow.
      var row = rows[index], top = row.offsetTop, bottom = top + row.offsetHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight;
    }
    function step(direction) {
      for (var i = 1; i <= rows.length; i += 1) {
        var next = (active + direction * i + rows.length * 2) % rows.length;
        if (!entries[next].disabled) { highlight(next); return; }
      }
    }
    function run(entry) {
      if (!entry || entry.disabled) return;
      close();
      if (typeof entry.action === "function") entry.action();
    }
    function keydown(event) {
      var key = event.key;
      if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape", "Tab"].includes(key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === "ArrowDown" || key === "Tab" && !event.shiftKey) step(1);
      else if (key === "ArrowUp" || key === "Tab") step(-1);
      else if (key === "Home") { active = -1; step(1); }
      else if (key === "End") { active = rows.length; step(-1); }
      else if (key === "Escape") close();
      else run(entries[active]);
    }
    function title(text) {
      var heading = doc.createElement("div");
      heading.className = "zui-menu-title";
      heading.textContent = text;
      heading.setAttribute("role", "presentation");
      element.appendChild(heading);
    }
    if (config.title) title(config.title);
    var previousSeparator = true;
    var hasChecks = (config.items || []).some(function (item) { return typeof item.checked === "boolean"; });
    (config.items || []).forEach(function (entry) {
      if (entry.title) { title(entry.title); previousSeparator = true; return; }
      if (entry.separator) {
        if (previousSeparator) return;
        var line = doc.createElement("div");
        line.className = "zui-menu-separator";
        line.setAttribute("role", "separator");
        element.appendChild(line);
        previousSeparator = true;
        return;
      }
      var row = doc.createElement("div");
      row.className = "zui-menu-item" + (entry.disabled ? " disabled" : "") + (entry.muted ? " muted" : "");
      row.tabIndex = -1;
      row.setAttribute("role", typeof entry.checked === "boolean" ? "menuitemcheckbox" : "menuitem");
      if (typeof entry.checked === "boolean") row.setAttribute("aria-checked", String(entry.checked));
      row.setAttribute("aria-disabled", String(Boolean(entry.disabled)));
      if (entry.hint) row.title = entry.hint;
      function span(className, text) {
        var child = doc.createElement("span");
        child.className = className;
        child.textContent = text || "";
        row.appendChild(child);
        return child;
      }
      if (hasChecks) span("zui-menu-check", entry.checked ? "\u2713" : "").setAttribute("aria-hidden", "true");
      if (entry.color !== undefined) {
        var swatch = span("zui-menu-swatch");
        if (entry.color) swatch.style.background = entry.color;
        swatch.setAttribute("aria-hidden", "true");
      }
      span("zui-menu-label", entry.label);
      if (entry.shortcut) span("zui-menu-key", entry.shortcut);
      var index = entries.length;
      row.addEventListener("pointermove", function () { if (!entry.disabled && active !== index) highlight(index); });
      row.addEventListener("focus", function () { if (!entry.disabled && active !== index) highlight(index, false); });
      row.addEventListener("pointerdown", function (event) { event.preventDefault(); event.stopPropagation(); });
      row.addEventListener("click", function (event) { event.stopPropagation(); run(entry); });
      element.appendChild(row);
      rows.push(row); entries.push(entry); previousSeparator = false;
    });
    var last = element.lastElementChild;
    if (last && last.classList.contains("zui-menu-separator")) last.remove();
    element.addEventListener("keydown", keydown);
    element.addEventListener("contextmenu", function (event) { event.preventDefault(); event.stopPropagation(); });
    doc.body.appendChild(element);
    var at = anchor ? anchor.getBoundingClientRect() : null;
    var x = at ? (config.align === "end" ? at.right : at.left) : Number(config.x) || 0;
    var y = at ? at.bottom + 2 : Number(config.y) || 0;
    var rect = element.getBoundingClientRect(), margin = 4;
    var left = at && config.align === "end" ? x - rect.width : x;
    if (left + rect.width > view.innerWidth - margin) left = at ? at.right - rect.width : x - rect.width;
    var top = y;
    if (top + rect.height > view.innerHeight - margin) top = (at ? at.top - 2 : y) - rect.height;
    element.style.left = Math.max(margin, Math.min(left, view.innerWidth - rect.width - margin)) + "px";
    element.style.top = Math.max(margin, Math.min(top, view.innerHeight - rect.height - margin)) + "px";
    listen(doc, "pointerdown", function (event) {
      // An anchor's click handler can toggle its existing menu closed.
      if (!element.contains(event.target) && !(anchor && anchor.contains(event.target))) close(false);
    }, true);
    listen(view, "blur", function () { close(false); });
    listen(view, "pagehide", function () { close(false); });
    listen(view, "resize", function () { close(false); });
    listen(doc, "scroll", function (event) { if (!element.contains(event.target)) close(false); }, true);
    if (config.signal) {
      if (config.signal.aborted) close(false);
      else listen(config.signal, "abort", function () { close(false); });
    }
    if (!closed && owner && view.MutationObserver) {
      var observer = new view.MutationObserver(function () { if (!owner.isConnected) close(false); });
      observer.observe(doc.documentElement, { childList: true, subtree: true });
      cleanups.push(function () { observer.disconnect(); });
    }
    var host = owner && owner.closest && owner.closest(".zoidium-window, .editorpanel");
    if (!closed && host && view.ResizeObserver) {
      var size = host.getBoundingClientRect();
      var resizer = new view.ResizeObserver(function () {
        var next = host.getBoundingClientRect();
        if (next.width !== size.width || next.height !== size.height) close(false);
      });
      resizer.observe(host);
      cleanups.push(function () { resizer.disconnect(); });
    }
    if (!closed) { element.focus({ preventScroll: true }); step(1); }
    return { close: close, element: element, isOpen: function () { return !closed; } };
  }
  function registerExtension(extension) {
    if (!extension || typeof extension.id !== "string" || !extension.id || typeof extension.items !== "function") throw new Error("Menu extension needs an id and items function");
    if (extensions.has(extension.id)) throw new Error("Menu extension is already registered: " + extension.id);
    extensions.set(extension.id, extension);
    return function () { if (extensions.get(extension.id) === extension) extensions.delete(extension.id); };
  }
  builder.menus = { openMenu: openMenu, claim: claim, registerExtension: registerExtension };
})(window);
