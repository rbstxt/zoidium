(function (global) {
  "use strict";

  // Property-based editors for Zoidium windows, installed into ZoidiumUI by
  // ui-kit.js (this file is loaded before it and queues an installer).
  //
  //   ZoidiumUI.properties(options)
  //     Embeds CM3's own property editor (PZ.ui.edit) for a property list, a
  //     property group, or a chosen subset of an object's properties. Rows are
  //     the native CM3 rows: keyframe toggles, expressions, scrubbing, easing,
  //     playback updates and undo history all behave exactly as in the
  //     Objects and Effects panels.
  //
  //   ZoidiumUI.registerEditor(spec)
  //     Declares that an editor window exists for some objects (3D objects,
  //     effects, materials). CM3 lists then show a gear button on matching
  //     rows and an "Open ..." button at the top of their properties, the same
  //     way the VHS effect shows its Setup button.
  //
  //   ZoidiumUI.openAttributePanel(target, spec)
  //     Opens a tabbed attribute window (the Cinema 4D / After Effects /
  //     Blender convention: one tab per topic, native rows inside) for an
  //     object. registerAttributePanel(spec) combines it with registerEditor.

  var queue = global.ZoidiumUIModules = global.ZoidiumUIModules || [];

  queue.push({
    name: "panels",
    install: function (kit) {
      var editors = [];
      var patch = null;

      function PZ() {
        return global.PZ || null;
      }

      function el(tag, className, text) {
        var node = global.document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
      }

      function lookup(list, path) {
        var node = list;
        String(path).split(".").forEach(function (key) {
          if (!node) return;
          node = node.properties && !(node instanceof PZ().property) && !(node instanceof PZ().propertyList)
            ? node.properties[key]
            : node[key];
        });
        return node || null;
      }

      // A read-only view of some properties of one list. It is a
      // PZ.propertyList for CM3's editor, but owns nothing: the properties keep
      // their real parents, so addresses, history and serialization are
      // unaffected.
      function subsetList(properties, source) {
        var view = Object.create(PZ().propertyList.prototype);
        Object.defineProperty(view, Symbol.iterator, {
          value: function () { return properties[Symbol.iterator](); },
        });
        Object.defineProperty(view, "length", { value: properties.length });
        view.onListChanged = new (PZ().observable)();
        view.parent = source ? source.parent : null;
        view.zoidiumSubset = true;
        return view;
      }

      function resolveList(target, keys) {
        var P = PZ();
        var resolved = typeof target === "function" ? target() : target;
        if (!resolved || !P) return null;
        var list = resolved;
        if (!(resolved instanceof P.property) && !(resolved instanceof P.propertyList) && resolved.properties) {
          list = resolved.properties;
        }
        if (!keys) return list;
        var chosen = [];
        if (Array.isArray(keys)) {
          keys.forEach(function (key) {
            var property = lookup(list, key);
            if (property && property instanceof P.property && chosen.indexOf(property) < 0) chosen.push(property);
          });
        } else if (typeof keys === "function") {
          Object.keys(list).forEach(function (key) {
            var property = list[key];
            if (property instanceof P.property && keys(key, property)) chosen.push(property);
          });
        }
        return subsetList(chosen, list);
      }

      // options: {
      //   target: object | property list | group | () => one of those,
      //   keys: ["text", "size", "emitter.position"] | (key, property) => bool,
      //   editor: CM (default), emptyText, labelWidth: 0..1 (default 0.45)
      // }
      // Returns { element, refresh(), setTarget(target), dispose(), edit }.
      function properties(options) {
        var config = options || {};
        var P = PZ();
        var editor = config.editor || global.CM;
        if (!P || !P.ui || typeof P.ui.edit !== "function" || !editor) {
          return {
            element: el("div", "zoidium-properties-empty", "The CM3 property editor is unavailable."),
            refresh: function () {}, setTarget: function () {}, dispose: function () {}, edit: null,
          };
        }
        var target = config.target;
        var labelWidth = Number(config.labelWidth) > 0 && Number(config.labelWidth) < 1 ? Number(config.labelWidth) : 0.45;
        var edit = new P.ui.edit(editor, {
          skipSingleChildren: false,
          showListItemButtons: false,
          alwaysShowListItemButtons: false,
          emptyMessage: config.emptyText || "no properties",
        });
        var element = edit.el;
        element.classList.add("zoidium-properties");
        element.removeAttribute("tabindex");

        function markRoot() {
          var top = edit.list && edit.list.firstElementChild;
          if (top && top.pz_object instanceof P.propertyList) top.classList.add("zoidium-properties-root");
        }

        function render() {
          var list = resolveList(target, config.keys);
          var holder = list ? [list] : [];
          holder.onListChanged = new P.observable();
          edit.objects = holder;
          markRoot();
        }

        var lastWidth = 0;
        function layout() {
          var width = element.clientWidth;
          if (!width || Math.abs(width - lastWidth) < 1) return;
          lastWidth = width;
          var column = Math.round(width * labelWidth) + "px";
          if (edit.columnAdjust) edit.columnAdjust.style.left = column;
          edit.setColumnTemplate(column + " auto");
        }

        var observer = null;
        if (typeof global.ResizeObserver === "function") {
          observer = new global.ResizeObserver(layout);
          observer.observe(element);
        }
        render();
        edit.enabled = true;
        markRoot();
        if (global.requestAnimationFrame) global.requestAnimationFrame(layout);

        var disposed = false;
        return {
          element: element,
          edit: edit,
          refresh: function () {
            if (disposed) return;
            render();
            lastWidth = 0;
            layout();
          },
          setTarget: function (next) {
            if (disposed) return;
            target = next;
            render();
            lastWidth = 0;
            layout();
          },
          dispose: function () {
            if (disposed) return;
            disposed = true;
            if (observer) observer.disconnect();
            edit.enabled = false;
            // Unloading the rows releases CM3's property watchers.
            var empty = [];
            empty.onListChanged = new P.observable();
            edit.objects = empty;
            edit.objectsChanged();
            element.remove();
          },
        };
      }

      // -------------------------------------------------------------------
      // Editor launchers

      function matchingEditors(target) {
        if (!target) return [];
        return editors.filter(function (spec) {
          try { return Boolean(spec.match(target)); } catch (_error) { return false; }
        });
      }

      function openEditor(spec, target) {
        try {
          spec.open(target);
        } catch (error) {
          console.error("[Zoidium] failed to open " + spec.title + ":", error);
          kit.notify({ title: "Could not open " + spec.title + ".", message: String(error && error.message || error) });
        }
      }

      function launchRow(target) {
        var specs = matchingEditors(target);
        if (!specs.length) return null;
        var row = el("div", "zoidium-editor-launch noselect");
        specs.forEach(function (spec) {
          var button = kit.controls.button({
            title: spec.label || ("Open " + spec.title),
            hint: spec.hint || ("Open the " + spec.title + " window"),
            onClick: function (event) {
              event.preventDefault();
              event.stopPropagation();
              openEditor(spec, target);
            },
          }).element;
          button.addEventListener("mousedown", function (event) { event.stopPropagation(); });
          row.appendChild(button);
        });
        return row;
      }

      // Inserts the launch row as the first child of `list` (a <ul> generated
      // for `target`). The row is a <div>: CM3 indexes list rows by their <li>
      // elements, so the row never shifts its add/remove bookkeeping.
      function insertLaunchRow(list, target) {
        if (!list || list.querySelector(":scope > .zoidium-editor-launch")) return;
        var row = launchRow(target);
        if (row) list.insertBefore(row, list.firstChild);
      }

      function isObjectTarget(value) {
        var P = PZ();
        return Boolean(P && value instanceof P.object && !(value instanceof P.propertyList));
      }

      function installPatch() {
        var P = PZ();
        var proto = P && P.ui && P.ui.edit && P.ui.edit.prototype;
        if (!proto || patch) return;
        var original = {
          generateItemCommands: proto.generateItemCommands,
          generateChildrenList: proto.generateChildrenList,
          generatePropertyList: proto.generatePropertyList,
          unloadListItem: proto.unloadListItem,
        };

        proto.generateItemCommands = function (item, target) {
          var result = original.generateItemCommands.apply(this, arguments);
          if (!editors.length || !isObjectTarget(target) || !item || !item.children[1]) return result;
          var specs = matchingEditors(target);
          if (!specs.length) return result;
          var commands = item.children[1];
          commands.classList.add("actions");
          specs.slice().reverse().forEach(function (spec) {
            var gear = this.generateButton(spec.icon || "settings");
            gear.title = spec.label || ("Open " + spec.title);
            gear.classList.add("zoidium-editor-gear");
            gear.onclick = function (event) {
              event.stopPropagation();
              openEditor(spec, target);
            };
            commands.insertBefore(gear, commands.firstChild);
          }, this);
          return result;
        };

        proto.generateChildrenList = function (item) {
          var result = original.generateChildrenList.apply(this, arguments);
          if (editors.length && this.options.showListItemButtons && item && isObjectTarget(item.pz_object)) {
            insertLaunchRow(item.nextElementSibling, item.pz_object);
          }
          return result;
        };

        // An effect with one property list shows the list directly under its
        // row. CM3 rebuilds that list on every list change, so the launch row
        // is re-inserted after each rebuild and the watcher is released when
        // the list is unloaded.
        proto.generatePropertyList = function (item, list) {
          var result = original.generatePropertyList.apply(this, arguments);
          if (!editors.length || !this.options.showListItemButtons || !item || !isObjectTarget(item.pz_object)) return result;
          var owner = item.pz_object;
          var ul = item.nextElementSibling;
          if (!ul || ul.tagName !== "UL") return result;
          var refresh = function () { insertLaunchRow(ul, owner); };
          refresh();
          if (list && list.onListChanged && typeof list.onListChanged.watch === "function") {
            list.onListChanged.watch(refresh);
            ul.zoidiumLaunchRelease = function () { list.onListChanged.unwatch(refresh); };
          }
          return result;
        };

        proto.unloadListItem = function (item) {
          var next = item && item.nextElementSibling;
          if (next && typeof next.zoidiumLaunchRelease === "function") {
            next.zoidiumLaunchRelease();
            next.zoidiumLaunchRelease = null;
          }
          return original.unloadListItem.apply(this, arguments);
        };

        patch = { proto: proto, original: original };
      }

      function uninstallPatch() {
        if (!patch) return;
        var proto = patch.proto;
        Object.keys(patch.original).forEach(function (name) {
          proto[name] = patch.original[name];
        });
        patch = null;
      }

      // Re-renders open CM3 object/effect panels so launch buttons appear or
      // disappear right away.
      function refreshPanels() {
        var P = PZ();
        if (!P || !global.document) return;
        Array.from(global.document.querySelectorAll(".editorpanel")).forEach(function (node) {
          var panel = node.pz_panel;
          if (!panel || !(panel instanceof P.ui.edit) || node.classList.contains("zoidium-properties")) return;
          if (!panel.options || !panel.options.showListItemButtons) return;
          try {
            if (panel.enabled) panel.objectsChanged();
            else panel.objectsNeedUpdate = true;
          } catch (_error) { /* a panel without objects */ }
        });
      }

      // spec: { id, title, label?, hint?, icon?, match(target), open(target) }
      // Returns a function that unregisters the editor.
      function registerEditor(spec) {
        if (!spec || typeof spec.match !== "function" || typeof spec.open !== "function" || !spec.title) {
          throw new Error("ZoidiumUI.registerEditor requires title, match(target) and open(target)");
        }
        var entry = Object.assign({}, spec);
        editors.push(entry);
        installPatch();
        refreshPanels();
        return function unregisterEditor() {
          var index = editors.indexOf(entry);
          if (index < 0) return;
          editors.splice(index, 1);
          if (!editors.length) uninstallPatch();
          refreshPanels();
        };
      }

      // -------------------------------------------------------------------
      // Attribute panels

      function targetName(target) {
        try {
          return target.properties && target.properties.name ? String(target.properties.name.get()) : "";
        } catch (_error) {
          return "";
        }
      }

      // spec: {
      //   id, title, width, height, persistKey, open?: (win) => void,
      //   tabs: [{ id, title, keys?, build?(container, target, ui) }],
      //   header?(container, target, ui), footer?: buttons
      // }
      // `target` is the object being edited. Tabs with `keys` show native
      // property rows for those keys (dotted paths reach nested lists); tabs
      // with `build` add custom content. Panels render lazily per tab.
      function openAttributePanel(target, spec, openWindow) {
        var config = spec || {};
        var tabSpecs = (config.tabs || []).filter(Boolean);
        var open = openWindow || kit.openWindow;
        var id = (config.id || "attributes") + ":" + (target && target.getAddress ? target.getAddress().join(".") : "target");
        return open({
          id: id,
          title: config.title || "Attributes",
          subtitle: targetName(target),
          persistKey: config.persistKey || config.id || "attributes",
          width: config.width || 380,
          height: config.height || 520,
          minWidth: 300,
          skin: config.skin,
          className: "zoidium-attribute-panel",
          isValid: function () {
            return Boolean(target && target.parent);
          },
          footer: config.footer,
          mount: function (body, win) {
            var cleanups = [];
            var editorsByTab = [];
            body.classList.add("zoidium-attribute-body");
            if (typeof config.header === "function") {
              var head = el("div", "zoidium-attribute-header");
              body.appendChild(head);
              var headCleanup = config.header(head, target, global.ZoidiumUI);
              if (typeof headCleanup === "function") cleanups.push(headCleanup);
            }
            function renderTab(tab, panel) {
              if (tab.keys) {
                var view = properties({ target: target, keys: tab.keys, emptyText: tab.emptyText });
                panel.appendChild(view.element);
                editorsByTab.push(view);
              }
              if (typeof tab.build === "function") {
                var custom = el("div", "zoidium-attribute-custom");
                panel.appendChild(custom);
                var cleanup = tab.build(custom, target, global.ZoidiumUI);
                if (typeof cleanup === "function") cleanups.push(cleanup);
              }
            }
            if (tabSpecs.length === 1) {
              var only = el("div", "zoidium-tabpanel");
              body.appendChild(only);
              renderTab(tabSpecs[0], only);
            } else if (tabSpecs.length) {
              var tabs = kit.controls.tabs({
                tabs: tabSpecs.map(function (tab) {
                  return { id: tab.id, title: tab.title, render: function (panel) { renderTab(tab, panel); } };
                }),
                value: config.initialTab,
              });
              body.appendChild(tabs.element);
            }
            if (typeof config.open === "function") config.open(win);
            var nameWatch = null;
            if (target && target.properties && target.properties.name && target.properties.name.onChanged) {
              nameWatch = function () { win.setSubtitle(targetName(target)); };
              target.properties.name.onChanged.watch(nameWatch);
            }
            return function () {
              if (nameWatch) target.properties.name.onChanged.unwatch(nameWatch);
              editorsByTab.forEach(function (view) { view.dispose(); });
              cleanups.reverse().forEach(function (cleanup) {
                try { cleanup(); } catch (error) { console.error("[Zoidium] attribute panel cleanup failed:", error); }
              });
            };
          },
        });
      }

      // spec: registerEditor fields + openAttributePanel fields.
      function registerAttributePanel(spec, openWindow) {
        return registerEditor({
          id: spec.id,
          title: spec.title,
          label: spec.label,
          hint: spec.hint,
          icon: spec.icon,
          match: spec.match,
          open: function (target) { return openAttributePanel(target, spec, openWindow); },
        });
      }

      var api = {
        properties: properties,
        registerEditor: registerEditor,
        openAttributePanel: openAttributePanel,
        registerAttributePanel: registerAttributePanel,
      };
      return api;
    },
  });
})(window);
