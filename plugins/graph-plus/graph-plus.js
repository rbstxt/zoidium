"use strict";

// Graph Editor 2 (graph-plus): a theme-aware port of OpenZoid's rebuilt
// F-curve editor as a reversible Zoidium extension. When enabled it replaces
// PZ.ui.graph, PZ.ui.graph.grid and PZ.ui.graphEditor with the Graph Editor 2
// implementation (toolbar, easing presets, tangents, ruler scrub, zoom/pan,
// track list, tooltips, status bar, full keyboard set); when disabled the
// stock CM3 classes are restored and every open graph panel is rebuilt, so no
// reload is required.
//
// Stock CM3 already ships the marker prev/next shortcuts and the Ctrl+G
// floating graph window, so this plugin adds no toolbar items: it upgrades
// every graph panel the native wiring opens.

const GraphPlus = (() => {
  const STYLE_ID = "zoidium-graph-plus-css";
  const MODULE = "GraphPlus";

  let gpDefineGraphEditor, gpCssText, gpInjectStyle, gpRemoveStyle, installSelection;
  let g2doc, g2win, beginPointerDrag, gpPointerDrags, sharedEmptyNote;

  function loadDependencies(context) {
    if (gpDefineGraphEditor) return;
    const apis = context.apis || globalThis.ZoidiumPluginApis;
    const require = apis.modules.createRequire(context.getAsset, { root: "./plugins/graph-plus/" });
    ({ g2doc, g2win, beginPointerDrag, gpPointerDrags, sharedEmptyNote } = require("./pointer.js"));
    ({ gpCssText, gpInjectStyle, gpRemoveStyle } = require("./theme.js"));
    gpDefineGraphEditor = require("./editor.js");
    installSelection = require("./selection-host.js");
  }

  const state = {
    active: false,
    installation: null,
    PZ: null,
    editor: null,
    defined: null,
    originals: null,
    floating: null,
    windowPatch: null,
    selectionHost: null,
  };

  function logError(message, error) {
    try {
      console.error(`[${MODULE}] ${message}`, error);
    } catch (_ignored) {
      // Logging must never break activation or cleanup.
    }
  }

  function leftPanel(panel) {
    try {
      if (panel) {
        if (panel._left) return panel._left;
        if (panel.panels && panel.panels[0]) return panel.panels[0];
      }
    } catch (_error) {
      // Unreachable panels simply carry no selection.
    }
    return null;
  }

  // Every open CM window hosting a graph editor panel built from `fromCtor`
  // is rebuilt with `toCtor`. The left picker's selection is carried over so
  // the same curves stay visible; windows that fail to rebuild keep theirs.
  function rebuildOpenPanels(windows, fromCtor, toCtor) {
    if (!Array.isArray(windows) || typeof fromCtor !== "function" || typeof toCtor !== "function") return 0;
    let rebuilt = 0;
    for (const win of windows) {
      let old = null;
      try {
        old = win && win.panel;
      } catch (_error) {
        old = null;
      }
      if (!old || !(old instanceof fromCtor)) continue;
      try {
        try {
          old.enabled = false;
        } catch (_disableError) {
          // Detaching still cleans up the visible panel.
        }
        const next = new toCtor(win.editor);
        if (old.objects !== undefined && old.objects !== null) {
          try {
            next.objects = old.objects;
          } catch (_objectsError) {
            // Fresh panels already follow the default selection.
          }
        }
        // Keep the picked curves: pushing into the new picker's selection
        // notifies the new graph through the standard objectAdded path.
        // (The stock editor exposes the picker as panels[0]; ours as _left.)
        try {
          const from = leftPanel(old);
          const to = leftPanel(next);
          const fromSel = from && from.selection;
          const toSel = to && to.selection;
          if (fromSel && toSel && fromSel !== toSel && typeof fromSel.length === "number") {
            for (let index = 0; index < fromSel.length; index += 1) {
              try {
                toSel.push(fromSel[index]);
              } catch (_pushError) {
                // A read-only selection carries no further keys.
                break;
              }
            }
          }
        } catch (_selectionError) {
          // The rebuilt panel still opens with an empty picker.
        }
        win.setPanel(next);
        try {
          disposePanel(old);
        } catch (error) {
          logError("Could not dispose the replaced graph panel.", error);
        }
        rebuilt += 1;
      } catch (error) {
        logError("Could not rebuild the open graph panel.", error);
      }
    }
    return rebuilt;
  }

  function openGraphWindows() {
    try {
      const windows = state.editor && state.editor.windows;
      return Array.isArray(windows) ? windows : [];
    } catch (_error) {
      // Without host windows there is nothing to rebuild.
      return [];
    }
  }

  function injectStyle(doc) {
    const target = doc || (typeof document !== "undefined" ? document : null);
    try {
      gpInjectStyle(target);
    } catch (error) {
      logError("Could not install the graph styles.", error);
    }
  }

  function removeStyle(doc) {
    try {
      gpRemoveStyle(doc);
    } catch (_error) {
      // A missing document (closed popup) needs no cleanup.
    }
  }

  function forEachPanelDocument(callback) {
    const seen = new Set();
    const visit = (doc) => {
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      try {
        callback(doc);
      } catch (_error) {
        // One closed popup must not block the rest.
      }
    };
    try {
      if (typeof document !== "undefined") visit(document);
    } catch (_error) {
      // No main document (test sandbox); owner documents still apply below.
    }
    for (const win of openGraphWindows()) {
      try {
        if (win && win.panel && win.panel.el && win.panel.el.ownerDocument) visit(win.panel.el.ownerDocument);
      } catch (_error) {
        // Closed popup windows drop out of the sweep silently.
      }
    }
  }

  function install(PZ, editor) {
    if (!PZ || !PZ.ui) throw new Error("Graph Editor 2 needs the CM3 user interface (PZ.ui).");
    if (typeof PZ.ui.graph !== "function" || typeof PZ.ui.graphEditor !== "function") {
      throw new Error("Graph Editor 2 needs the stock CM3 graph editor (PZ.ui.graph).");
    }
    // Capture before defining: defining assigns PZ.ui.* as a side effect.
    const originals = {
      graph: PZ.ui.graph,
      grid: PZ.ui.graph.grid,
      graphEditor: PZ.ui.graphEditor,
    };
    if (!state.defined) state.defined = gpDefineGraphEditor(PZ);
    PZ.ui.graph = state.defined.graph;
    PZ.ui.graph.grid = state.defined.grid;
    PZ.ui.graphEditor = state.defined.graphEditor;
    state.originals = originals;
    forEachPanelDocument(injectStyle);
    return rebuildOpenPanels(openGraphWindows(), originals.graphEditor, state.defined.graphEditor);
  }

  function disposePanel(panel) {
    if (!panel) return;
    const drags = gpPointerDrags.get(panel.el);
    if (drags) for (const finish of Array.from(drags)) finish(null);
    // CM3's split divider uses its own document-level mouse/touch drag.
    if (panel.drag?.dragging && typeof panel.drag.endfn_bound === "function") {
      panel.drag.endfn_bound({ type: "mouseup", currentTarget: panel.el.ownerDocument, preventDefault() {} });
    }
    panel.enabled = false;
    if ("objects" in panel) panel.objects = null;
    // CM3 defers edit-list rebuilding while disabled. Its list rows still
    // watch project properties until objectsChanged explicitly unloads them.
    if (panel.list && typeof panel.unloadListItem === "function") panel.objectsChanged();
    if (panel.panels) for (const child of panel.panels) disposePanel(child);
    if (typeof panel.unload === "function") panel.unload();
    if (panel.el) panel.el.remove();
  }

  function focusGraph(panel) {
    const element = panel?._right?.bodyEl;
    if (!element) return;
    try { element.focus({ preventScroll: true }); } catch (_error) { element.focus(); }
  }

  function restoreFloatingWindow(facade) {
    facade.host.reveal();
    facade.resize();
    focusGraph(facade.panel);
  }

  // Both the native toolbar button and Ctrl+G enter here. Other CM3 windows
  // still use the original factory, including native popup safety patches.
  function installFloatingWindow(context) {
    const editor = state.editor;
    const ui = context.ui;
    if (!editor || typeof editor.createWindow !== "function" || !ui?.openWindow) return;
    const original = editor.createWindow;
    const descriptor = Object.getOwnPropertyDescriptor(editor, "createWindow");
    const replacement = function (options) {
      if (this !== editor || !options || options.title !== "Graph editor") {
        return original.apply(this, arguments);
      }
      if (state.floating?.host.isOpen()) {
        restoreFloatingWindow(state.floating);
        return state.floating;
      }
      let observer = null;
      const facade = {
        editor, secondary: true, panel: null, host: null,
        // CM3 closeAllWindows and project lifecycle use this window handle.
        window: { close: () => facade.host.close(), focus: () => restoreFloatingWindow(facade) },
        resize() { if (facade.panel) facade.panel.resize(); },
        setPanel(panel) {
          // The native caller constructs a fresh panel even when reopening.
          if (facade.panel) { disposePanel(panel); return; }
          facade.panel = panel;
          panel.window = facade;
          Object.assign(panel.el.style, { top: "0", left: "0", width: "100%", height: "100%" });
          facade.el.appendChild(panel.el);
          panel.enabled = facade.enabled;
          facade.resize();
          focusGraph(panel);
        },
      };
      Object.defineProperty(facade, "enabled", {
        get: () => facade.panel ? facade.panel.enabled : false,
        set: (value) => { if (facade.panel) facade.panel.enabled = value; },
      });
      const viewport = typeof window !== "undefined" ? window : {};
      const host = ui.openWindow({
        id: "graph-editor", title: "Graph editor", persistKey: "graph-editor",
        placement: "center", width: Math.round((viewport.innerWidth || 1200) * 0.75),
        height: Math.round((viewport.innerHeight || 800) * 0.75),
        minWidth: 480, minHeight: 300, resizable: true, maximizable: true,
        mount(body) {
          facade.el = body;
          body.classList.add("editorwindow");
          Object.assign(body.style, { padding: "0", overflow: "hidden", position: "relative" });
          // Match the popup's editor.onkeydown forwarding, then stop at the
          // body so host shortcuts cannot run a second time. Graph handlers
          // consume their own keys before they reach this listener.
          const forward = (event) => {
            if (typeof editor.keydown === "function") editor.keydown(event);
            event.stopPropagation();
          };
          const space = (event) => {
            const graph = facade.panel?._right;
            if (event.code === "Space" && graph) graph._spaceDown = event.type === "keydown";
          };
          body.addEventListener("keydown", space, true);
          body.addEventListener("keyup", space, true);
          body.addEventListener("keydown", forward);
          const owner = body.ownerDocument?.defaultView;
          if (owner?.ResizeObserver) {
            observer = new owner.ResizeObserver(() => facade.resize());
            observer.observe(body);
          }
          return () => {
            if (observer) observer.disconnect();
            body.removeEventListener("keydown", space, true);
            body.removeEventListener("keyup", space, true);
            body.removeEventListener("keydown", forward);
            disposePanel(facade.panel);
            facade.panel = null;
            const index = editor.windows?.indexOf(facade);
            if (index >= 0) editor.windows.splice(index, 1);
            if (state.floating === facade) state.floating = null;
          };
        },
      });
      if (!host) throw new Error("Could not open the Graph editor window.");
      facade.host = host;
      // Chrome buttons can hold focus too. The host isolates their events,
      // so forward the same native editor commands from that chrome.
      const graphShortcut = (event) => {
        if (event.ctrlKey && event.key?.toLowerCase() === "g") {
          restoreFloatingWindow(facade);
          event.preventDefault();
          event.stopPropagation();
        }
      };
      host.element.addEventListener("keydown", graphShortcut, true);
      host.addCleanup(() => host.element.removeEventListener("keydown", graphShortcut, true));
      const chromeKeydown = (event) => {
        if (!event.ctrlKey || !/^[nmoszy]$/i.test(event.key || "")) return;
        if (typeof editor.keydown === "function") editor.keydown(event);
        event.stopPropagation();
      };
      host.element.addEventListener("keydown", chromeKeydown);
      host.addCleanup(() => host.element.removeEventListener("keydown", chromeKeydown));
      state.floating = facade;
      editor.windows.push(facade);
      restoreFloatingWindow(facade);
      return facade;
    };
    const projectChanged = () => state.floating?.host.close();
    state.windowPatch = { editor, descriptor, replacement, projectChanged };
    editor.onProjectChanged?.watch(projectChanged);
    editor.createWindow = replacement;
  }

  function uninstall() {
    state.selectionHost?.dispose();
    state.selectionHost = null;
    if (state.floating) state.floating.host.close();
    const patch = state.windowPatch;
    patch?.editor.onProjectChanged?.unwatch(patch.projectChanged);
    if (patch && patch.editor.createWindow === patch.replacement) {
      if (patch.descriptor) Object.defineProperty(patch.editor, "createWindow", patch.descriptor);
      else delete patch.editor.createWindow;
    }
    state.windowPatch = null;
    const PZ = state.PZ;
    const originals = state.originals;
    const defined = state.defined;
    if (PZ && PZ.ui && originals && defined) {
      // Restore only what we still own; a newer replacement (another plugin
      // or a host update) is left untouched.
      try {
        if (PZ.ui.graph === defined.graph) PZ.ui.graph = originals.graph;
        else if (PZ.ui.graph && PZ.ui.graph.grid === defined.grid) PZ.ui.graph.grid = originals.grid;
      } catch (_error) {
        // Leave foreign replacements untouched.
      }
      try {
        if (PZ.ui.graphEditor === defined.graphEditor) PZ.ui.graphEditor = originals.graphEditor;
      } catch (_error) {
        // Leave foreign replacements untouched.
      }
      rebuildOpenPanels(openGraphWindows(), defined.graphEditor, originals.graphEditor);
    }
    forEachPanelDocument(removeStyle);
    state.originals = null;
  }

  async function activate(context) {
    if (state.active) return;
    loadDependencies(context);
    const installation = { active: true };
    state.installation = installation;
    context.lifecycle?.onDispose(() => {
      if (state.installation === installation) deactivate();
    });
    const PZ = context.PZ || (typeof window !== "undefined" ? window.PZ : null);
    const editor = context.editor || null;
    if (!PZ || !PZ.ui) throw new Error("Graph Editor 2 needs the CM3 user interface (PZ.ui).");
    state.PZ = PZ;
    state.editor = editor;
    let rebuilt = 0;
    try {
      state.selectionHost = installSelection({
        PZ, editor, document: typeof document !== "undefined" ? document : null,
        open() {
          const win = editor.createWindow({ title: "Graph editor" });
          if (!win.panel) win.setPanel(new PZ.ui.graphEditor(editor));
          win.enabled = true;
          return win.panel;
        },
      });
      rebuilt = install(PZ, editor);
      installFloatingWindow(context);
    } catch (error) {
      uninstall();
      state.PZ = null;
      state.editor = null;
      state.installation = null;
      throw error;
    }
    state.active = true;
    if (rebuilt > 0) {
      try {
        console.log(`[${MODULE}] upgraded ${rebuilt} open graph panel(s).`);
      } catch (_ignored) {
        // Logging only.
      }
    }
  }

  function deactivate() {
    if (state.installation) state.installation.active = false;
    if (!state.active && !state.originals) {
      state.installation = null;
      return;
    }
    state.active = false;
    try {
      uninstall();
    } catch (error) {
      logError("Could not restore the stock graph editor.", error);
    }
    state.PZ = null;
    state.editor = null;
    state.installation = null;
  }

  return {
    activate,
    deactivate,
    __test: {
      STYLE_ID,
      loadDependencies,
      rebuildOpenPanels,
      gpCssText: (...args) => gpCssText(...args),
      gpDefineGraphEditor: (...args) => gpDefineGraphEditor(...args),
      g2doc: (...args) => g2doc(...args),
      g2win: (...args) => g2win(...args),
      beginPointerDrag: (...args) => beginPointerDrag(...args),
      disposePanel,
      restoreFloatingWindow,
      sharedEmptyNote: (...args) => sharedEmptyNote(...args),
    },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GraphPlus;
