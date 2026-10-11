(function (global) {
  "use strict";

  // Menus and clipboard for the Zoidium node editor: the searchable add
  // menu, copy/paste/duplicate of node fragments, and the context-menu
  // entry points. Installed on the editor scope by nodeEditor() in
  // zoidium/ui-node-editor.js (see postInitScripts in
  // zoidium/runtime-config.js); it owns no public surface itself.

  var parts = global.ZoidiumNodeEditorParts = global.ZoidiumNodeEditorParts || {};

  // Defines the menu and clipboard helpers on cx. Graph mutations commit
  // through cx.commit and cx.setSelection, which nodeEditor() provides.
  parts.createMenu = function (cx) {
    function el(tag, className, text) {
      var node = cx.doc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    var C = parts.consts;
    var PASTE_OFFSET = C.PASTE_OFFSET;
    var DUPLICATE_OFFSET = C.DUPLICATE_OFFSET;
    var graphTools = parts.graphTools;
    var addNode = graphTools.addNode;
    var connectLinks = graphTools.connectLinks;
    var copyFragment = graphTools.copyFragment;
    var insertFragment = graphTools.insertFragment;
    var base = parts.base;
    var typeSpec = base.typeSpec;
    var typesCompatible = base.typesCompatible;
    var countType = base.countType;
    var cloneValue = base.cloneValue;
    var menu = null;
    var clipboard = null;

      // ---- add menu ------------------------------------------------------

      function menuAccepts(spec, ctx) {
        var ports = ctx.fixed.dir === "out" ? spec.inputs : spec.outputs;
        return ports.some(function (port) {
          return ctx.fixed.dir === "out"
            ? typesCompatible(cx.canConnect, ctx.type, port.type)
            : typesCompatible(cx.canConnect, port.type, ctx.type);
        });
      }

      function pickPort(spec, ctx) {
        var ports = ctx.fixed.dir === "out" ? spec.inputs : spec.outputs;
        var exact = ports.find(function (port) { return port.type === ctx.type; });
        if (exact) return exact;
        return ports.find(function (port) {
          return ctx.fixed.dir === "out"
            ? typesCompatible(cx.canConnect, ctx.type, port.type)
            : typesCompatible(cx.canConnect, port.type, ctx.type);
        }) || null;
      }

      function openMenu(clientX, clientY, point, ctx) {
        if (cx.destroyed || cx.readOnly) return;
        closeMenu(false);
        var rootRect = cx.root.getBoundingClientRect();
        var element = el("div", "zoidium-node-editor-menu");
        var search = el("input", "zoidium-node-editor-search");
        search.type = "text";
        search.spellcheck = false;
        search.autocomplete = "off";
        search.placeholder = ctx ? "Connect a node..." : "Add a node...";
        var list = el("div", "zoidium-node-editor-menu-list");
        element.appendChild(search);
        element.appendChild(list);
        cx.root.appendChild(element);
        menu = {
          element: element,
          search: search,
          list: list,
          point: point,
          ctx: ctx,
          items: [],
          index: -1,
          left: Math.max(0, clientX - rootRect.left),
          top: Math.max(0, clientY - rootRect.top),
        };
        search.addEventListener("input", function () { renderMenuItems(search.value); });
        search.addEventListener("keydown", onMenuKey);
        renderMenuItems("");
        search.focus();
      }

      function renderMenuItems(query) {
        if (!menu) return;
        var tokens = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
        var list = menu.list;
        list.textContent = "";
        menu.items = [];
        var groups = new Map();
        Object.keys(cx.types).forEach(function (typeId) {
          var spec = cx.types[typeId];
          if (spec.hidden) return;
          if (menu.ctx && !menuAccepts(spec, menu.ctx)) return;
          var haystack = (spec.title + " " + spec.category + " " + typeId).toLowerCase();
          if (!tokens.every(function (token) { return haystack.indexOf(token) >= 0; })) return;
          if (!groups.has(spec.category)) groups.set(spec.category, []);
          groups.get(spec.category).push(spec);
        });
        if (!groups.size) list.appendChild(el("div", "zoidium-node-editor-menu-empty", "No matching nodes."));
        groups.forEach(function (specs, category) {
          list.appendChild(el("div", "zoidium-node-editor-menu-group", category));
          specs.forEach(function (spec) {
            var full = countType(cx.graph, spec.id) >= spec.maxInstances;
            var item = el("div", "zoidium-node-editor-menu-item" + (full ? " disabled" : ""), spec.title);
            if (full) item.title = "Only " + spec.maxInstances + " allowed in this graph";
            var index = menu.items.length;
            menu.items.push({ id: spec.id, element: item, disabled: full });
            item.addEventListener("pointerdown", function (event) { event.preventDefault(); });
            item.addEventListener("pointerenter", function () { setMenuIndex(index); });
            item.addEventListener("click", function () { activateMenuItem(index); });
            list.appendChild(item);
          });
        });
        setMenuIndex(menu.items.findIndex(function (item) { return !item.disabled; }));
        clampMenu();
      }

      function clampMenu() {
        var rootRect = cx.root.getBoundingClientRect();
        var element = menu.element;
        var left = Math.min(menu.left, Math.max(0, rootRect.width - element.offsetWidth));
        var top = Math.min(menu.top, Math.max(0, rootRect.height - element.offsetHeight));
        element.style.left = left + "px";
        element.style.top = top + "px";
      }

      function setMenuIndex(index) {
        if (!menu) return;
        menu.index = index;
        menu.items.forEach(function (item, position) {
          item.element.classList.toggle("active", position === index);
        });
        var active = menu.items[index];
        if (active && typeof active.element.scrollIntoView === "function") {
          active.element.scrollIntoView({ block: "nearest" });
        }
      }

      function moveMenu(step) {
        if (!menu || !menu.items.length) return;
        var count = menu.items.length;
        var index = menu.index;
        for (var i = 0; i < count; i += 1) {
          index = (index + step + count) % count;
          if (!menu.items[index].disabled) {
            setMenuIndex(index);
            return;
          }
        }
      }

      function onMenuKey(event) {
        event.stopPropagation();
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveMenu(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveMenu(-1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          activateMenuItem(menu ? menu.index : -1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeMenu(true);
        }
      }

      function activateMenuItem(index) {
        if (!menu) return;
        var item = menu.items[index];
        if (!item || item.disabled) return;
        var opened = menu;
        closeMenu(true);
        addNodeOfType(item.id, opened.point, opened.ctx);
      }

      function addNodeOfType(typeId, point, ctx) {
        var spec = typeSpec(cx.types, typeId);
        if (!spec) return;
        var maker = cx.makerFor(cx.graph);
        var added = addNode(cx.graph, cx.types, typeId, point.x, point.y, maker);
        if (added.error) return;
        var next = added.graph;
        var label = "Add " + spec.title;
        if (ctx) {
          var port = pickPort(spec, ctx);
          if (port) {
            var fixed = ctx.fixed;
            var from = fixed.dir === "out" ? { node: fixed.node, port: fixed.port } : { node: added.node.id, port: port.id };
            var to = fixed.dir === "out" ? { node: added.node.id, port: port.id } : { node: fixed.node, port: fixed.port };
            var connected = connectLinks(next, cx.types, from, to, { makeId: maker, canConnect: cx.canConnect });
            if (!connected.error) {
              next = connected.graph;
              label += " and connect";
            }
          }
        }
        cx.graph = next;
        cx.setSelection([added.node.id], true);
        cx.commit("add", label);
      }

      function closeMenu(refocus) {
        if (!menu) return;
        var closing = menu;
        menu = null;
        closing.element.remove();
        if (refocus && !cx.destroyed) cx.root.focus({ preventScroll: true });
      }

      function openMenuAtPointer() {
        var rect = cx.viewport.getBoundingClientRect();
        var screen = cx.pointerScreen || { x: rect.width / 2, y: rect.height / 2 };
        openMenu(rect.left + screen.x, rect.top + screen.y, cx.worldAt(screen), null);
      }

      // ---- clipboard ------------------------------------------------------

      function finishInsert(result, verb) {
        if (!result.nodeIds.length) return;
        cx.graph = result.graph;
        cx.setSelection(result.nodeIds, true);
        cx.commit(verb.toLowerCase(), verb + " " + result.nodeIds.length + " " + cx.plural(result.nodeIds.length));
      }
      function duplicateSelected() {
        var ids = cx.selectedIds();
        if (!ids.length) return;
        var fragment = copyFragment(cx.graph, new Set(ids));
        finishInsert(insertFragment(cx.graph, cx.types, fragment, DUPLICATE_OFFSET, DUPLICATE_OFFSET, cx.makerFor(cx.graph)), "Duplicate");
      }

      function copySelected() {
        var ids = cx.selectedIds();
        if (!ids.length) return;
        clipboard = copyFragment(cx.graph, new Set(ids));
      }

      function pasteClipboard() {
        if (!clipboard || !clipboard.nodes.length) return;
        var minX = clipboard.nodes.reduce(function (min, node) { return Math.min(min, node.x); }, Infinity);
        var minY = clipboard.nodes.reduce(function (min, node) { return Math.min(min, node.y); }, Infinity);
        var target = cx.pointerScreen ? cx.worldAt(cx.pointerScreen) : { x: minX + PASTE_OFFSET, y: minY + PASTE_OFFSET };
        var fragment = cloneValue(clipboard);
        finishInsert(insertFragment(cx.graph, cx.types, fragment, Math.round(target.x - minX), Math.round(target.y - minY), cx.makerFor(cx.graph)), "Paste");
      }
    function isMenuOpen() {
      return Boolean(menu);
    }

    function closeMenuIfOutside(target) {
      if (menu && !menu.element.contains(target)) closeMenu(false);
    }
    cx.openMenu = openMenu;
    cx.closeMenu = closeMenu;
    cx.openMenuAtPointer = openMenuAtPointer;
    cx.isMenuOpen = isMenuOpen;
    cx.closeMenuIfOutside = closeMenuIfOutside;
    cx.copySelected = copySelected;
    cx.pasteClipboard = pasteClipboard;
    cx.duplicateSelected = duplicateSelected;
  };
})(window);
