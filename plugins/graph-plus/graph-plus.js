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

  const state = {
    active: false,
    installation: null,
    PZ: null,
    editor: null,
    defined: null,
    originals: null,
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
                break;
              }
            }
          }
        } catch (_selectionError) {
          // The rebuilt panel still opens with an empty picker.
        }
        win.setPanel(next);
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

  function uninstall() {
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
      rebuilt = install(PZ, editor);
    } catch (error) {
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
      rebuildOpenPanels,
      gpCssText,
      gpDefineGraphEditor,
      g2doc,
      g2win,
      beginPointerDrag,
    },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GraphPlus;
/* Ported from OpenZoid graph-editor-2.0.js (DaviFX) into the GraphPlus
 * module. Behavior is unchanged except: CM3 theme tokens (--zui-*) replace
 * the private grey-band/dark-tile design, the style id is namespaced per
 * document (popup-safe), curve group ids use a counter (no wall-clock or
 * random data), and the whole definition installs reversibly. */
/* Popup-safe owner handles (module scope so tests and the module
   export can share them). */
/* Popup-safe owner handles: the Graph editor also lives in a separate
   window.open() document, so global `window`/`document` point at the wrong
   window there. Resolve the window/document that owns an element instead. */
function g2doc(el) {
  try {
    if (el && el.ownerDocument) return el.ownerDocument;
  } catch (e) {}
  try {
    if (typeof document !== "undefined") return document;
  } catch (e2) {}
  return null;
}
function g2win(el) {
  var doc = g2doc(el);
  try {
    if (doc && doc.defaultView) return doc.defaultView;
  } catch (e) {}
  try {
    if (typeof window !== "undefined") return window;
  } catch (e2) {}
  return null;
}

/* Pointer-captured drag. ESSENTIAL here: the graph editor runs in a separate
   browser window, so once the cursor leaves it, window-level pointerup never
   fires and the drag sticks forever ("cursor wants to fill something").
   Pointer capture routes all events to the element; blur is a safety net. */
function beginPointerDrag(target, e, onMove, onEnd) {
  var captured = false;
  var pid = e && e.pointerId;
  try {
    if (target.setPointerCapture && pid !== undefined && pid !== null) {
      target.setPointerCapture(pid);
      captured = true;
    }
  } catch (err) { captured = false; }
  // Listeners belong on the window/document that owns the target element:
  // the popup editor lives in a separate window whose events never reach
  // the main window. The main pair is kept as a backup for nodes that are
  // still being adopted between documents.
  function pairsFor(targetEl) {
    var pairs = [];
    var seen = [];
    function push(w, d) {
      if (!w && !d) return;
      for (var i = 0; i < seen.length; i++) {
        if (seen[i][0] === w && seen[i][1] === d) return;
      }
      seen.push([w, d]);
      pairs.push([w, d]);
    }
    var ownerDoc = g2doc(targetEl);
    var ownerWin = g2win(targetEl);
    push(ownerWin, ownerDoc);
    try {
      var mainWin = typeof window !== "undefined" ? window : null;
      var mainDoc = typeof document !== "undefined" ? document : null;
      push(mainWin, mainDoc);
    } catch (e2) {}
    return pairs;
  }
  var pairs = pairsFor(target);
  var finished = false;
  function move(ev) {
    if (finished) return;
    if (pid !== undefined && pid !== null && ev.pointerId !== undefined && ev.pointerId !== pid) return;
    onMove(ev);
  }
  function unlisten(pair, move, finish, onBlur) {
    var w = pair[0], d = pair[1];
    try {
      if (w && w.removeEventListener) {
        w.removeEventListener("pointermove", move);
        w.removeEventListener("pointerup", finish);
        w.removeEventListener("pointercancel", finish);
        w.removeEventListener("blur", onBlur);
      }
    } catch (err3) {}
    try {
      if (d && d.removeEventListener) d.removeEventListener("pointerup", finish);
    } catch (err4) {}
  }
  function finish(ev) {
    if (finished) return;
    finished = true;
    try { if (captured) target.releasePointerCapture(pid); } catch (err) {}
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", finish);
    target.removeEventListener("pointercancel", finish);
    for (var i = 0; i < pairs.length; i++) unlisten(pairs[i], move, finish, onBlur);
    if (onEnd) onEnd(ev || null);
  }
  function onBlur() { finish(null); }
  if (captured) {
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  } else {
    for (var j = 0; j < pairs.length; j++) {
      (function (pair) {
        var w = pair[0], d = pair[1];
        try {
          if (w && w.addEventListener) {
            w.addEventListener("pointermove", move);
            w.addEventListener("pointerup", finish);
            w.addEventListener("pointercancel", finish);
          }
        } catch (err5) {}
        try {
          if (d && d.addEventListener) d.addEventListener("pointerup", finish);
        } catch (err6) {}
      })(pairs[j]);
    }
  }
  for (var k = 0; k < pairs.length; k++) {
    try {
      var w = pairs[k][0];
      if (w && w.addEventListener) w.addEventListener("blur", onBlur);
    } catch (err7) {}
  }
  return { finish: finish };
}

var gpNextGroupId = 1;
function gpDefineGraphEditor(PZ) {
if (!PZ || !PZ.ui) throw new Error("Graph Editor 2 needs the CM3 user interface (PZ.ui).");
var SVGNS = "http://www.w3.org/2000/svg";

/* ---------------- DESIGN SYSTEM (rebuilt) ----------------
   Injected per-document: the Graph editor also lives in a popup window,
   and styles from the main document do NOT reach it. */



function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function curveColor(name) {
  var h = 0;
  try { h = (47 * PZ.stringHash(name || "")) % 360; } catch (e) { h = 200; }
  if (h < 0) h += 360;
  return "hsl(" + h + ",70%,62%)";
}
/* ---- toolbar icons: white strokes + blue-ring keys on dark (user designs)
   NOTE: every shape carries inline style fill/stroke because CSS rules
   (e.g. `.elevator svg{fill:...}`) override SVG presentation attributes. ---- */
var G2_BLUE = "#8ab4ff", G2_LINE = "#ffffff", G2_DARK = "#16181d";
function g2key(x, y, r) {
  return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + G2_DARK + '" stroke="' + G2_BLUE +
    '" stroke-width="1.8" style="fill:' + G2_DARK + ';stroke:' + G2_BLUE + '"/>';
}
function g2wrap(inner, vb) {
  return '<svg viewBox="' + (vb || "0 0 28 16") + '" width="28" height="16" style="display:block;fill:none;stroke:' + G2_LINE + '">' + inner + "</svg>";
}
/* interpolation icons matching the 5 user designs */
function interpIcon(kind) {
  var L = 'stroke="' + G2_LINE + '" stroke-width="2" stroke-linecap="round" fill="none" style="fill:none;stroke:' + G2_LINE + ';stroke-width:2;stroke-linecap:round"';
  if (kind === "linear") return g2wrap('<line x1="6" y1="12" x2="22" y2="4" ' + L + "/>" + g2key(5, 13, 3) + g2key(23, 3, 3));
  if (kind === "hold") return g2wrap('<line x1="7" y1="8" x2="21" y2="8" ' + L + "/>" + g2key(5, 8, 3) + g2key(14, 8, 3) + g2key(23, 8, 3));
  if (kind === "out") return g2wrap('<polyline points="6,12 14,5 22,5" ' + L + ' stroke-linejoin="round"/>' + g2key(5, 13, 3) + g2key(14, 5, 3) + g2key(23, 5, 3));
  if (kind === "in") return g2wrap('<path d="M6 13 C 13 13, 17 10, 22 4" ' + L + "/>" + g2key(5, 13, 3) + g2key(23, 3, 3));
  if (kind === "step") return g2wrap('<polyline points="6,11 18,11 18,4 22,4" ' + L + ' stroke-linejoin="round"/>' + g2key(5, 11, 3) + g2key(23, 3, 3));
  return "";
}
/* big toolbar tile artwork (user design): white curve + open circle ends on dark tile */
function tileIcon(kind) {
  var L = 'stroke="#ffffff" stroke-width="2" fill="none" style="fill:none;stroke:#ffffff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"';
  function dot(x, y) {
    return '<circle cx="' + x + '" cy="' + y + '" r="2.7" fill="#1c1c1c" stroke="#ffffff" stroke-width="1.7" style="fill:#1c1c1c;stroke:#ffffff;stroke-width:1.7"/>';
  }
  var inner = "";
  if (kind === "linear") inner = '<line x1="8" y1="24" x2="36" y2="8" ' + L + "/>" + dot(6, 26) + dot(38, 6);
  else if (kind === "step") inner = '<polyline points="6,25 24,25 24,7 30,7" ' + L + "/>" + dot(6, 25) + dot(30, 7);
  else if (kind === "ease") inner = '<path d="M6 25 C 17 25, 24 21, 38 7" ' + L + "/>" + dot(6, 26) + dot(38, 6);
  else if (kind === "break") inner = '<polyline points="6,25 19,12 27,17 38,7" ' + L + "/>" + dot(6, 25) + dot(19, 12) + dot(38, 7);
  else if (kind === "auto") inner = '<line x1="8" y1="16" x2="36" y2="16" ' + L + "/>" + dot(6, 16) + dot(22, 16) + dot(38, 16);
  else if (kind === "custom") inner = '<line x1="8" y1="24" x2="36" y2="8" ' + L + "/>" + dot(6, 26) + dot(38, 6);
  return '<svg viewBox="0 0 44 32" width="50" height="36" style="display:block;fill:none;stroke:#ffffff">' + inner + "</svg>";
}
/* small diagonal thumbnail artwork for the "Custom easings" item (user design) */
function customEaseIcon() {
  var L = 'stroke="#e8e8e8" stroke-width="2.4" fill="none" style="fill:none;stroke:#e8e8e8;stroke-width:2.4;stroke-linecap:round"';
  return '<svg viewBox="0 0 44 26" width="44" height="26" style="display:block;fill:none;stroke:#e8e8e8">' +
    '<line x1="9" y1="21" x2="35" y2="5" ' + L + "/>" +
    '<circle cx="7" cy="23" r="2.2" fill="#1b1b1b" stroke="#e8e8e8" stroke-width="1.5" style="fill:#1b1b1b;stroke:#e8e8e8"/>' +
    '<circle cx="37" cy="3" r="2.2" fill="#1b1b1b" stroke="#e8e8e8" stroke-width="1.5" style="fill:#1b1b1b;stroke:#e8e8e8"/>' +
    "</svg>";
}
/* small 14px tool glyphs, white strokes */
function toolIcon(name) {
  var s = 'fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="fill:none;stroke:#ffffff;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"';
  var inner = "";
  if (name === "pan") inner = '<path d="M8 1.5v13M1.5 8h13" ' + s + "/>";
  else if (name === "fit") inner = '<path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" ' + s + "/>";
  else if (name === "sel") inner = '<rect x="2" y="2" width="12" height="12" rx="1" ' + s + ' stroke-dasharray="2.5 2"/>';
  else if (name === "marquee") inner = '<rect x="2" y="2.5" width="10.5" height="10.5" rx="1" ' + s + ' stroke-dasharray="3 2"/><circle cx="12.5" cy="13" r="1.5" fill="#ffffff" style="fill:#ffffff"/>';
  else if (name === "frame") inner = '<rect x="3" y="3" width="10" height="10" rx="1" ' + s + '/><circle cx="8" cy="8" r="1.3" fill="#ffffff" style="fill:#ffffff"/>';
  else if (name === "norm") inner = '<path d="M2 12.5h12M2 8h8M2 3.5h12" ' + s + "/>";
  else if (name === "snap") inner = '<path d="M4.5 1.5v5.5a3.5 3.5 0 0 0 7 0V1.5M4.5 1.5h2.6v4.6H4.5zM8.9 1.5h2.6v4.6H8.9zM8 10.5v3.5" ' + s + "/>";
  else if (name === "key") inner = '<rect x="4.8" y="4.8" width="6.4" height="6.4" transform="rotate(45 8 8)" ' + s + "/>";
  else if (name === "del") inner = '<path d="M2.5 4.5h11M6 4.5V2.5h4v2M4.5 4.5l.8 9h5.4l.8-9" ' + s + "/>";
  else if (name === "bez") inner = '<path d="M2 12.5C6 12.5 6 3.5 14 3.5" ' + s + '/><circle cx="2" cy="12.5" r="1.6" fill="#fff" style="fill:#ffffff"/><circle cx="14" cy="3.5" r="1.6" fill="#fff" style="fill:#ffffff"/>';
  else if (name === "link") inner = '<path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1" ' + s + "/>";
  else if (name === "flat") inner = '<path d="M2 8h12" ' + s + "/>";
  else if (name === "copy") inner = '<rect x="5" y="5" width="9" height="9" rx="1" ' + s + '/><path d="M11 5V2.5H2.5V11H5" ' + s + "/>";
  else if (name === "paste") inner = '<rect x="3" y="3.5" width="10" height="10.5" rx="1" ' + s + '/><path d="M6 3.5V1.8h4v1.7" ' + s + "/>";
  else if (name === "tag") inner = '<path d="M2.5 2.5H8l5.5 5.5-5.5 5.5L2.5 8z" ' + s + '/><circle cx="6" cy="6" r="1.2" fill="#fff" style="fill:#ffffff"/>';
  return '<svg viewBox="0 0 16 16" width="14" height="14" style="display:block;fill:none;stroke:#ffffff;padding:0">' + inner + "</svg>";
}
/* focus for keyboard shortcuts WITHOUT scrolling the panel (scroll-jump hid the toolbar) */
function focusNoScroll(el) {
  try {
    if (el && el.focus) {
      var doc = g2doc(el);
      try {
        if (doc && doc.activeElement === el) return;
      } catch (e0) {}
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
  } catch (e) {}
}
function displayName(prop) {
  try {
    if (prop.properties && prop.properties.name) return prop.properties.name.get();
  } catch (e) {}
  try {
    if (prop.definition && prop.definition.name) return prop.definition.name;
  } catch (e) {}
  return "Property";
}
function scaleFactorOf(prop) {
  try {
    if (prop.definition && prop.definition.scaleFactor) return prop.definition.scaleFactor;
  } catch (e) {}
  return 1;
}
function addrString(prop) {
  try { return JSON.stringify(prop.getAddress()); } catch (e) { return displayName(prop); }
}
function currentFrame(editor) {
  try { return editor.playback.currentFrame | 0; } catch (e) { return 0; }
}
function totalFrames(editor) {
  try {
    if (editor.playback && editor.playback.totalFrames) return editor.playback.totalFrames;
    if (editor.sequence && editor.sequence.length) return editor.sequence.length;
  } catch (e) {}
  return 180;
}

/* ================= GRID (rebuilt) ================= */
var GraphGrid = function (graph, opts) {
  this.graph = graph;
  this.numGridLines = 0;
  this.numTexts = 0;
  this.options = { gridUnit: 20, lineWidth: 1, dimension: 0, textSize: 10 };
  if (opts) Object.assign(this.options, opts);
  this.create();
};
GraphGrid.prototype._doc = function () {
  try {
    if (this.graph && this.graph._doc) {
      var d = this.graph._doc();
      if (d) return d;
    }
  } catch (e) {}
  return g2doc(this.el) || g2doc(this.graph && this.graph.svg);
};
GraphGrid.prototype.create = function () {
  this.el = this._doc().createElementNS(SVGNS, "g");
  this.el.setAttributeNS(null, "stroke-width", this.options.lineWidth + "px");
  this.graph.svg.appendChild(this.el);
};
GraphGrid.prototype.createGridLine = function () {
  var e = this._doc().createElementNS(SVGNS, "line");
  e.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  return e;
};
GraphGrid.prototype.createText = function () {
  var e = this._doc().createElementNS(SVGNS, "text");
  e.setAttributeNS(null, "fill", "#cccccc");
  e.setAttributeNS(null, "font-family", "'Source Code Pro',monospace");
  e.setAttributeNS(null, "font-size", "10");
  e.setAttributeNS(null, "letter-spacing", "0");
  e.style.pointerEvents = "none";
  return e;
};
GraphGrid.prototype.ensure = function (lines, texts) {
  var need = lines + texts;
  while (this.el.children.length < need) {
    if (this.el.querySelectorAll("line").length < lines) this.el.appendChild(this.createGridLine());
    else this.el.appendChild(this.createText());
  }
};
GraphGrid.prototype.update = function () {
  var g = this.graph;
  if (!g.width || !g.height) return;
  var dim = this.options.dimension;
  var zoom = dim === 0 ? g.zoomX : g.zoomY;
  if (!(zoom > 0)) return;
  var step = this.options.gridUnit * Math.pow(2, Math.ceil(Math.log2(zoom)));
  var sizePx = dim === 0 ? g.width : g.height;
  var center = dim === 0 ? g.centerX : g.centerY;
  var viewSize = sizePx * zoom;
  var start = Math.floor((center - 0.5 * viewSize) / step);
  var end = Math.ceil((center + 0.5 * viewSize) / step);
  var count = end - start + 1;
  if (count < 1 || count > 500) count = Math.min(Math.max(count, 1), 500);
  var majors = Math.ceil(count / 2) + 1;
  this.ensure(count, majors);
  var lines = this.el.querySelectorAll("line");
  var texts = this.el.querySelectorAll("text");
  var ti = 0;
  var halfH = 0.5 * g.height * g.zoomY;
  var halfW = 0.5 * g.width * g.zoomX;
  for (var s = 0; s < count; s++) {
    var idx = start + s;
    var a = idx * step;
    var line = lines[s];
    if (!line) break;
    var isMajor = (idx % 2) === 0;
    var isZero = idx === 0;
    var col = isZero ? "#5a5a5c" : isMajor ? "#383839" : "#2a2a2b";
    line.setAttributeNS(null, "stroke", col);
    if (dim === 0) {
      line.setAttributeNS(null, "x1", a);
      line.setAttributeNS(null, "x2", a);
      line.setAttributeNS(null, "y1", g.centerY - halfH);
      line.setAttributeNS(null, "y2", g.centerY + halfH);
      // C4D-style: frame numbers live in the top ruler — no in-grid x labels
      if (isMajor && ti < texts.length) {
        var tx = texts[ti++];
        tx.textContent = "";
      }
    } else {
      line.setAttributeNS(null, "y1", a);
      line.setAttributeNS(null, "y2", a);
      line.setAttributeNS(null, "x1", g.centerX - halfW);
      line.setAttributeNS(null, "x2", g.centerX + halfW);
      if (isMajor && ti < texts.length) {
        var ty = texts[ti++];
        var xL = g.centerX - halfW;
        ty.setAttributeNS(null, "transform", "translate(" + xL + " " + a + ") scale(" + g.zoomX + " " + g.zoomY + ")");
        ty.setAttributeNS(null, "x", 5);
        ty.setAttributeNS(null, "y", -5);
        ty.setAttributeNS(null, "font-size", "10");
        ty.setAttributeNS(null, "fill", "#ffffff");
        var v = -a;
        ty.textContent = Math.abs(v) >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString();
      }
    }
  }
  // hide unused
  for (var q = count; q < lines.length; q++) lines[q].setAttributeNS(null, "stroke", "transparent");
  for (var w = ti; w < texts.length; w++) texts[w].textContent = "";
};
GraphGrid.prototype.resize = function () {
  var n = this.options.dimension === 0
    ? Math.ceil(this.graph.width / this.options.gridUnit) + 6
    : Math.ceil(this.graph.height / this.options.gridUnit) + 6;
  n = clamp(n, 8, 400);
  this.numGridLines = n;
  this.numTexts = Math.ceil(n / 2) + 1;
  while (this.el.firstChild) this.el.firstChild.remove();
  for (var e = 0; e < this.numGridLines; e++) this.el.appendChild(this.createGridLine());
  for (var t = 0; t < this.numTexts; t++) this.el.appendChild(this.createText());
};

/* ================= GRAPH (rebuilt) ================= */
PZ.ui.graph = function (editor, opts) {
  PZ.ui.panel.call(this, editor);
  this.title = "Graph";
  this.icon = "project";
  this.propertyOps = new PZ.ui.properties(this.editor);
  PZ.observable.defineObservableProp(this, "objects", "onObjectsChanged");
  this.objects = null;
  var self = this;
  this.objectAdded_bound = function (e) { self.objectAdded(e); };
  this.objectRemoved_bound = function (e) { self.objectRemoved(e); };
  this.onObjectsChanged.watch(function (old) {
    if (old) {
      try { old.onObjectAdded.unwatch(self.objectAdded_bound); } catch (e) {}
      try { old.onObjectRemoved.unwatch(self.objectRemoved_bound); } catch (e) {}
    }
    if (self.objects) {
      try { self.objects.onObjectAdded.watch(self.objectAdded_bound); } catch (e) {}
      try { self.objects.onObjectRemoved.watch(self.objectRemoved_bound); } catch (e) {}
    }
    self.objectsChanged();
  });
  this.selection = new PZ.objectList();
  this.properties = new PZ.objectList(null, Object);
  this.options = {
    curveLineWidth: 2.5, keyframeSize: 11, handleSize: 9,
    cursorLineWidth: 1, shapeRendering: "auto",
    normalize: false, snap: true, showLabels: true
  };
  this.width = 1; this.height = 1;
  this.centerX = 0; this.centerY = 0;
  this.zoomX = 1; this.zoomY = 1;
  if (opts) Object.assign(this.options, opts);
  this._updateFn = this.update.bind(this);
  this.onEnabledChanged.watch(function () {
    if (self.enabled) self.animFrameReq = requestAnimationFrame(self._updateFn);
    else cancelAnimationFrame(self.animFrameReq);
  });
  this.selectNewKeyframes = false;
  this._didInitView = false;
  this._hidden = {};   // addr -> true
  this._legendTick = 0;
  this.tool = "pan";      // C4D-like tool modes: "pan" (default) | "sel" (marquee)
  this._spaceDown = false;
  this.create();
};
PZ.ui.graph.prototype = Object.create(PZ.ui.panel.prototype);
PZ.ui.graph.prototype.constructor = PZ.ui.graph;

/* ---------- helpers ---------- */
PZ.ui.graph.prototype._doc = function () {
  return g2doc(this.canvasEl) || g2doc(this.el) || g2doc(this.svg) || null;
};
PZ.ui.graph.prototype._win = function () {
  var doc = this._doc();
  try {
    if (doc && doc.defaultView) return doc.defaultView;
  } catch (e) {}
  return g2win(this.el);
};
/* Global Space pans the view without needing focus. The listener must live
   on the window that owns this panel: the Ctrl+G popup is a separate
   window whose key events never reach the main window. Rebind whenever the
   panel is adopted into another document. */
PZ.ui.graph.prototype._ensureSpaceListeners = function () {
  var self = this;
  var w = null;
  try {
    w = this._win();
  } catch (e) {
    return;
  }
  if (!w || typeof w.addEventListener !== "function") return;
  if (this._spaceWin === w) return;
  try {
    if (this._spaceWin && this._spaceHandlers) {
      this._spaceWin.removeEventListener("keydown", this._spaceHandlers.down);
      this._spaceWin.removeEventListener("keyup", this._spaceHandlers.up);
      this._spaceWin.removeEventListener("blur", this._spaceHandlers.blur);
    }
  } catch (e2) {}
  var handlers = {
    down: function (e) {
      if (e.code === "Space" && !e.repeat) self._spaceDown = true;
    },
    up: function (e) {
      if (e.code === "Space") self._spaceDown = false;
    },
    blur: function () { self._spaceDown = false; },
  };
  try {
    w.addEventListener("keydown", handlers.down);
    w.addEventListener("keyup", handlers.up);
    w.addEventListener("blur", handlers.blur);
  } catch (e3) {
    return;
  }
  this._spaceWin = w;
  this._spaceHandlers = handlers;
};
/* Re-run resize() whenever the canvas box changes. The popup panel is first
   constructed while its stylesheets are still loading, so the initial
   resize() can measure a pre-layout box; the observer corrects that as soon
   as the real layout lands. resize() never changes layout itself, so this
   cannot loop. */
PZ.ui.graph.prototype._installResizeObserver = function () {
  var self = this;
  var doc = null;
  try {
    doc = this._doc();
    if (!this.canvasEl || !doc) return;
    if (this._ro && this._roDoc === doc) return;
    if (this._ro) {
      try { this._ro.disconnect(); } catch (e) {}
      this._ro = null;
      this._roDoc = null;
    }
    var w = this._win();
    var RO = (w && w.ResizeObserver) || null;
    if (!RO) {
      try {
        RO = typeof ResizeObserver !== "undefined" ? ResizeObserver : null;
      } catch (e2) {
        RO = null;
      }
    }
    if (!RO) return;
    var ro = new RO(function () {
      try {
        self.resize();
      } catch (e3) {}
    });
    ro.observe(this.canvasEl);
    this._ro = ro;
    this._roDoc = doc;
  } catch (e4) {}
};
PZ.ui.graph.prototype.unload = function () {
  try {
    if (this._ro) this._ro.disconnect();
  } catch (e) {}
  this._ro = null;
  this._roDoc = null;
  try {
    if (this._spaceWin && this._spaceHandlers) {
      this._spaceWin.removeEventListener("keydown", this._spaceHandlers.down);
      this._spaceWin.removeEventListener("keyup", this._spaceHandlers.up);
      this._spaceWin.removeEventListener("blur", this._spaceHandlers.blur);
    }
  } catch (e2) {}
  this._spaceWin = null;
  this._spaceHandlers = null;
};
PZ.ui.graph.prototype.viewX = function () { return this.centerX - 0.5 * this.width * this.zoomX; };
PZ.ui.graph.prototype.viewY = function () { return this.centerY - 0.5 * this.height * this.zoomY; };
PZ.ui.graph.prototype.viewW = function () { return this.width * this.zoomX; };
PZ.ui.graph.prototype.viewH = function () { return this.height * this.zoomY; };
PZ.ui.graph.prototype.scrubRuler = function (clientX) {
  if (!this.rulerEl) return;
  var r = this.rulerEl.getBoundingClientRect();
  if (r.width < 1) return;
  var f = this.viewX() + ((clientX - r.left) / r.width) * this.viewW();
  try {
    this.editor.playback.speed = 0;
    this.editor.playback.currentFrame = clamp(Math.round(f), 0, Math.max(totalFrames(this.editor) - 1, 0));
  } catch (e) {}
  try { this.drawRuler(); } catch (e2) {}
};
PZ.ui.graph.prototype.screenToGraph = function (px, py) {
  var r = this.svg.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { x: this.centerX, y: this.centerY };
  return {
    x: this.viewX() + (px / r.width) * this.viewW(),
    y: this.viewY() + (py / r.height) * this.viewH()
  };
};
PZ.ui.graph.prototype.absToRel = function (propGroup, absFrame) {
  return Math.round(absFrame - (propGroup.pz_frameOffset || 0));
};
PZ.ui.graph.prototype.relToAbs = function (propGroup, relFrame) {
  return relFrame + (propGroup.pz_frameOffset || 0);
};
PZ.ui.graph.prototype.propGroups = function () {
  if (!this.curveLayer) return [];
  return Array.prototype.slice.call(this.curveLayer.children);
};
PZ.ui.graph.prototype.selectedKeys = function () {
  if (!this.svg) return [];
  return Array.prototype.slice.call(this.svg.querySelectorAll(".g2-kf.selected"));
};
PZ.ui.graph.prototype.graphColor = function (prop) {
  return curveColor(displayName(prop));
};
PZ.ui.graph.prototype.isHidden = function (prop) {
  return !!this._hidden[addrString(prop)];
};
PZ.ui.graph.prototype.refreshScaleFor = function (gEl) {
  var prop = gEl.pz_object;
  if (!prop) return;
  if (!this.options.normalize) {
    gEl.pz_valueScale = 1 / (scaleFactorOf(prop) || 1);
    return;
  }
  var maxAbs = 0, mn = Infinity, mx = -Infinity;
  for (var i = 0; i < prop.keyframes.length; i++) {
    var v = prop.keyframes[i].value;
    if (typeof v !== "number") continue;
    if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  if (!(maxAbs > 1e-9)) maxAbs = 1;
  gEl.pz_valueScale = 80 / maxAbs;
  gEl.pz_dataMin = mn; gEl.pz_dataMax = mx;
};
PZ.ui.graph.prototype.refreshAllScales = function () {
  var groups = this.propGroups();
  for (var i = 0; i < groups.length; i++) this.refreshScaleFor(groups[i]);
};

/* ---------- view ---------- */
PZ.ui.graph.prototype.updateViewBox = function () {
  if (!this.svg) return;
  // BUGFIX: click made grid disappear — NaN center/zoom (e.g. non-numeric
  // values in fitAll) poisoned the viewBox. Self-heal here.
  if (!isFinite(this.centerX) || !isFinite(this.centerY) || !isFinite(this.zoomX) || !isFinite(this.zoomY) ||
      !(this.zoomX > 0) || !(this.zoomY > 0) || !(this.width > 0) || !(this.height > 0)) {
    this.centerX = isFinite(this.centerX) ? this.centerX : 90;
    this.centerY = isFinite(this.centerY) ? this.centerY : 0;
    this.zoomX = isFinite(this.zoomX) && this.zoomX > 0 ? this.zoomX : 1;
    this.zoomY = isFinite(this.zoomY) && this.zoomY > 0 ? this.zoomY : 1;
    this.width = isFinite(this.width) && this.width > 0 ? this.width : 800;
    this.height = isFinite(this.height) && this.height > 0 ? this.height : 600;
  }
  this.svg.setAttributeNS(null, "viewBox", this.viewX() + " " + this.viewY() + " " + this.viewW() + " " + this.viewH());
  if (this.cursor) {
    this.cursor.setAttributeNS(null, "y1", this.centerY - 0.5 * this.height * this.zoomY);
    this.cursor.setAttributeNS(null, "y2", this.centerY + 0.5 * this.height * this.zoomY);
  }
  if (this.zeroH) {
    this.zeroH.setAttributeNS(null, "x1", this.centerX - 0.5 * this.width * this.zoomX);
    this.zeroH.setAttributeNS(null, "x2", this.centerX + 0.5 * this.width * this.zoomX);
    this.zeroH.setAttributeNS(null, "y1", 0);
    this.zeroH.setAttributeNS(null, "y2", 0);
  }
  if (this.rangeRect) {
    var tf = totalFrames(this.editor);
    this.rangeRect.setAttributeNS(null, "x", 0);
    this.rangeRect.setAttributeNS(null, "y", this.centerY - 0.5 * this.height * this.zoomY);
    this.rangeRect.setAttributeNS(null, "width", Math.max(tf, 1));
    this.rangeRect.setAttributeNS(null, "height", this.height * this.zoomY);
  }
  if (this.xGrid) this.xGrid.update();
  if (this.yGrid) this.yGrid.update();
  var groups = this.propGroups();
  for (var g = 0; g < groups.length; g++) {
    var gel = groups[g];
    var keys = gel._keys ? Array.prototype.slice.call(gel._keys.children) : [];
    for (var k = 0; k < keys.length; k++) {
      this.updateKeyframe(keys[k]);
      if (keys[k].pz_handles) this.updateHandles(keys[k].pz_handles);
    }
    var paths = gel._curves ? Array.prototype.slice.call(gel._curves.children) : [];
    for (var p = 0; p < paths.length; p++) {
      var ph = paths[p];
      this.updateCurve(ph, ph.pz_left || null, ph.pz_right || null);
    }
    if (gel._label) this.positionLabel(gel);
  }
  try { this.drawRuler(); } catch (e) {}
};
PZ.ui.graph.prototype.fitAll = function (onlySelected) {
  var groups = this.propGroups();
  var t = Infinity, b = -Infinity, l = Infinity, r = -Infinity;
  var tf = totalFrames(this.editor);
  var found = false;
  for (var gi = 0; gi < groups.length; gi++) {
    var gel = groups[gi];
    if (gel.style.display === "none") continue;
    var scale = gel.pz_valueScale || 1;
    var off = gel.pz_frameOffset || 0;
    var keys = onlySelected
      ? Array.prototype.slice.call(gel._keys.querySelectorAll(".selected"))
      : Array.prototype.slice.call(gel._keys.children);
    for (var k = 0; k < keys.length; k++) {
      var kf = keys[k].pz_object;
      if (!kf || typeof kf.value !== "number" || !isFinite(kf.value) || !isFinite(kf.frame)) continue;
      var ax = kf.frame + off;
      var gy = -kf.value * scale;
      var cp = kf.controlPoints;
      if (cp && cp[0] && cp[1] && isFinite(cp[0][1]) && isFinite(cp[1][1])) {
        gy = Math.min(gy, -(kf.value + cp[0][1]) * scale, -(kf.value + cp[1][1]) * scale);
      }
      if (ax < l) l = ax; if (ax > r) r = ax;
      if (gy < t) t = gy; if (gy > b) b = gy;
      found = true;
    }
  }
  if (!found) { l = 0; r = tf; t = -100; b = 100; }
  if (!(r > l)) { r = l + 10; }
  if (!(b > t)) { b = t + 10; }
  // frame the keys with comfortable padding (C4D-like), not the whole timeline
  var padX = 0.06 * (r - l) + (1 / Math.max(this.width, 1)) * (r - l);
  var padY = 0.09 * (b - t) + (1 / Math.max(this.height, 1)) * (b - t);
  l -= padX; r += padX; t -= padY; b += padY;
  this.centerX = 0.5 * (l + r);
  this.centerY = 0.5 * (t + b);
  if (this.width > 1) this.zoomX = clamp((r - l) / this.width, 0.02, 200);
  if (this.height > 1) this.zoomY = clamp((b - t) / this.height, 0.001, 5000);
  this.updateViewBox();
};
PZ.ui.graph.prototype.frameSelected = function () {
  if (!this.selectedKeys().length) { this.fitAll(false); return; }
  this.fitAll(true);
};

/* ---------- creation ---------- */
PZ.ui.graph.prototype.createGraph = function () {
  this.svg = this._doc().createElementNS(SVGNS, "svg");
  this.svg.setAttributeNS(null, "preserveAspectRatio", "none");
  this.svg.setAttributeNS(null, "width", "100%");
  this.svg.setAttributeNS(null, "height", "100%");
  this.svg.setAttributeNS(null, "shape-rendering", this.options.shapeRendering);
  this.svg.style.background = "#1e1e1f";
  this.bodyEl.appendChild(this.svg);
};
PZ.ui.graph.prototype.createCursor = function () {
  var doc = this._doc();
  var g = doc.createElementNS(SVGNS, "g");
  g.setAttributeNS(null, "fill", "none");
  g.setAttributeNS(null, "stroke", "#ff0000aa");
  g.setAttributeNS(null, "stroke-width", this.options.cursorLineWidth + "px");
  g.style.pointerEvents = "none";
  this.cursorLayer = g;
  this.svg.appendChild(g);
  this.cursor = doc.createElementNS(SVGNS, "line");
  this.cursor.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  g.appendChild(this.cursor);
  // zero line
  this.zeroH = doc.createElementNS(SVGNS, "line");
  this.zeroH.setAttributeNS(null, "stroke", "#4c4c4e");
  this.zeroH.setAttributeNS(null, "stroke-width", "1px");
  this.zeroH.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  this.zeroH.style.pointerEvents = "none";
  this.svg.insertBefore(this.zeroH, this.cursorLayer);
};
/* C4D-style frame ruler: numbers + scrub (like Cinema 4D timeline ruler) */
PZ.ui.graph.prototype.drawRuler = function () {
  var c = this.rulerCanvas;
  if (!c || !this.bodyEl) return;
  var w = Math.max(this.bodyEl.clientWidth, 1);
  var h = 30;
  var dpr = 1;
  try { dpr = (this._win && this._win().devicePixelRatio) || dpr || 1; } catch (e) {}
  if (!(dpr > 0)) dpr = 1;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  var ctx = null;
  try { ctx = c.getContext("2d"); } catch (e) { return; }
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#262627";
  ctx.fillRect(0, 0, w, h);
  var vx = this.viewX(), vw = Math.max(this.viewW(), 1e-6);
  var pxPerF = w / vw;
  var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000];
  var step = steps[steps.length - 1];
  for (var si = 0; si < steps.length; si++) {
    if (steps[si] * pxPerF >= 64) { step = steps[si]; break; }
  }
  var minor = step >= 5 ? step / 5 : step;
  // playback range shade
  var tf = totalFrames(this.editor);
  var rx0 = (0 - vx) / vw * w, rx1 = (tf - vx) / vw * w;
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  ctx.fillRect(Math.max(rx0, 0), 0, Math.min(rx1, w) - Math.max(rx0, 0), h);
  ctx.textBaseline = "top";
  // minor ticks
  ctx.strokeStyle = "#4a4a4c";
  ctx.lineWidth = 1;
  ctx.beginPath();
  var m0 = Math.ceil(vx / minor) * minor;
  for (var m = m0; m <= vx + vw; m += minor) {
    var mx = Math.round((m - vx) / vw * w) + 0.5;
    ctx.moveTo(mx, h - 6);
    ctx.lineTo(mx, h);
  }
  ctx.stroke();
  // major ticks + numbers (white, like C4D)
  ctx.fillStyle = "#e8e8e8";
  ctx.font = "10px 'Source Code Pro',monospace";
  ctx.strokeStyle = "#5a5a5c";
  ctx.beginPath();
  var f0 = Math.ceil(vx / step) * step;
  for (var f = f0; f <= vx + vw; f += step) {
    var x = Math.round((f - vx) / vw * w) + 0.5;
    ctx.moveTo(x, h - 12);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
  for (var g = f0; g <= vx + vw; g += step) {
    var gx = (g - vx) / vw * w;
    ctx.fillText(String(Math.round(g)), gx + 4, 3);
  }
  // playhead marker (orange, like C4D keys)
  var pf = currentFrame(this.editor);
  var px = (pf - vx) / vw * w;
  if (px >= -10 && px <= w + 10) {
    ctx.fillStyle = "#e09a3c";
    ctx.fillRect(px - 1, 0, 2, h);
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
  }
};
/* tool modes: pan (left-drag moves the view) | sel (left-drag marquee-selects) */
PZ.ui.graph.prototype.applyToolCursor = function () {
  try {
    var c = this.canvasEl;
    if (!c) return;
    if (this._dragging === "pan") c.style.cursor = "grabbing";
    else if (this.tool === "sel") c.style.cursor = "crosshair";
    else c.style.cursor = "grab";
    if (this.rulerEl) this.rulerEl.style.cursor = "ew-resize";
  } catch (e) {}
};
PZ.ui.graph.prototype.setTool = function (tool) {
  this.tool = (tool === "sel") ? "sel" : "pan";
  if (this.panBtn) this.panBtn.classList.toggle("on", this.tool === "pan");
  if (this.selToolBtn) this.selToolBtn.classList.toggle("on", this.tool === "sel");
  this.applyToolCursor();
  this.updateStatus(this.tool === "sel"
    ? "marquee tool ON — drag to select · H: pan tool"
    : "pan tool ON — drag to move the grid · V: marquee");
};
/* Break / Auto tangents on selected keys */
PZ.ui.graph.prototype.setTangentsOnSelected = function (continuous) {
  var sel = this.selectedKeys();
  if (!sel.length) { this.updateStatus("select keys first"); return; }
  this.editor.history.startOperation();
  for (var i = 0; i < sel.length; i++) {
    var gel = sel[i].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var kf = sel[i].pz_object;
    this.propertyOps.setContinuousTangent({ property: gel.pz_object.getAddress(), frame: kf.frame, continuous: continuous });
  }
  this.editor.history.finishOperation();
  this.updateStatus(continuous ? "auto tangents" : "tangents broken");
};
/* Custom easings popup (user design: tile + dropdown list) */
PZ.ui.graph.prototype.toggleEasePopup = function () {
  var self = this;
  if (this.easePopup) { this.closeEasePopup(); return; }
  var doc = null;
  try { doc = this._doc(); } catch (eDoc) {}
  if (!doc || typeof doc.createElement !== "function") doc = g2doc(this.rootEl);
  function mk(tag) {
    try {
      if (doc && doc.createElement) return doc.createElement(tag);
    } catch (eMk) {}
    return document.createElement(tag);
  }
  var pop = mk("div");
  pop.className = "g2-popup";
  var head = mk("div");
  head.className = "g2-popup-head";
  head.textContent = "CUSTOM EASINGS";
  pop.appendChild(head);
  var names = [];
  try { names = PZ.tween.easingList.map(function (e) { return e.name; }); } catch (e) { names = ["linear"]; }
  names.forEach(function (n, i) {
    var it = mk("div");
    it.className = "g2-popup-item";
    it.textContent = i + ": " + n;
    it.addEventListener("mousedown", function (ev) { ev.preventDefault(); ev.stopPropagation(); });
    it.addEventListener("click", function (ev) {
      ev.stopPropagation();
      self.closeEasePopup();
      self.applyEasingToSelected(i);
    });
    pop.appendChild(it);
  });
  this.easePopup = pop;
  this.rootEl.appendChild(pop);
  try {
    var r = this.customEaseBtn.getBoundingClientRect();
    var rr = this.rootEl.getBoundingClientRect();
    pop.style.left = Math.max(4, r.left - rr.left) + "px";
    pop.style.top = (r.bottom - rr.top + 4) + "px";
  } catch (e) {}
  this._easeOutside = function (ev) {
    if (pop === ev.target || pop.contains(ev.target)) return;
    self.closeEasePopup();
  };
  var to = setTimeout(function () {
    try {
      var w = (self._win && self._win()) || g2win(self.rootEl);
      if (w && w.addEventListener) {
        w.addEventListener("pointerdown", self._easeOutside, true);
        self._easeWin = w;
      }
    } catch (eWin) {}
  }, 0);
  pop._openTO = to;
};
PZ.ui.graph.prototype.closeEasePopup = function () {
  if (!this.easePopup) return;
  try { clearTimeout(this.easePopup._openTO); } catch (e) {}
  if (this._easeOutside) {
    try {
      if (this._easeWin && this._easeWin.removeEventListener) {
        this._easeWin.removeEventListener("pointerdown", this._easeOutside, true);
      }
    } catch (e2) {}
    try {
      var w = (this._win && this._win()) || g2win(this.rootEl);
      if (w && w !== this._easeWin && w.removeEventListener) {
        w.removeEventListener("pointerdown", this._easeOutside, true);
      }
    } catch (e3) {}
    this._easeOutside = null;
    this._easeWin = null;
  }
  try { this.easePopup.remove(); } catch (e) {}
  this.easePopup = null;
};
PZ.ui.graph.prototype.buildToolbar = function () {
  var self = this;
  var tb = this.toolbarEl;
  while (tb.firstChild) tb.firstChild.remove();
  function mk(tag) {
    try {
      var d = self._doc();
      if (d && d.createElement) return d.createElement(tag);
    } catch (e) {}
    return document.createElement(tag);
  }
  function group() {
    var g = mk("div");
    g.className = "g2-group";
    tb.appendChild(g);
    return g;
  }
  function sep() {
    var s = mk("span");
    s.className = "g2-sep";
    tb.appendChild(s);
  }
  function white(el) {
    // bulletproof white text: inline !important beats any stylesheet
    try {
      el.style.setProperty("color", "var(--zui-text-bright,#fff)", "important");
      var kids = el.querySelectorAll("span");
      for (var q = 0; q < kids.length; q++) kids[q].style.setProperty("color", "var(--zui-text-bright,#fff)", "important");
    } catch (e) {}
    return el;
  }
  /* big tile: dark box with artwork + label beneath (user design) */
  function tile(parent, icon, label, title, fn, cls) {
    var b = mk("button");
    b.className = "g2-tile" + (cls ? " " + cls : "");
    b.title = title;
    b.setAttribute("aria-label", label);
    b.innerHTML = '<span class="g2-box">' + icon + '</span><span class="g2-tlabel">' + label + "</span>";
    white(b);
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function (e) { e.stopPropagation(); focusNoScroll(self.bodyEl); fn(); });
    parent.appendChild(b);
    return b;
  }
  function small(parent, icon, label, kbd, title, fn, cls) {
    return tile(parent, icon, label, title + (kbd ? " (" + kbd + ")" : ""), fn, "g2-small" + (cls ? " " + cls : ""));
  }
  /* ---- interpolation presets (big tiles, matching the reference design) ---- */
  var gi = group();
  tile(gi, tileIcon("linear"), "Linear", "Linear interpolation — apply to selected keys", function () { self.applyEasingToSelected(1); });
  tile(gi, tileIcon("step"), "Step", "Step / hold — value jumps at the key", function () { self.applyEasingToSelected(0); });
  tile(gi, tileIcon("ease"), "Ease", "Smooth ease (cubic in-out) — apply to selected keys", function () { self.applyEasingToSelected(7); });
  tile(gi, tileIcon("break"), "Break Tangents", "Break tangents on selected keys", function () { self.setTangentsOnSelected(false); });
  tile(gi, tileIcon("auto"), "Auto Tangents", "Auto (continuous) tangents on selected keys", function () { self.setTangentsOnSelected(true); });
  sep();
  /* ---- custom easings: thumbnail + label to the RIGHT (mockup) ---- */
  var gc = group();
  this.customEaseBtn = (function () {
    var b = mk("button");
    b.className = "g2-custom";
    b.title = "Custom easings — pick any of the 33 easings";
    b.setAttribute("aria-label", "Custom easings");
    b.innerHTML = '<span class="g2-sbox">' + customEaseIcon() + '</span><span class="g2-clabel">Custom easings</span>';
    white(b);
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    b.addEventListener("click", function (e) { e.stopPropagation(); focusNoScroll(self.bodyEl); self.toggleEasePopup(); });
    gc.appendChild(b);
    return b;
  })();
  /* ---- other functions, right-aligned (user placeholder area) ---- */
  var spacer = mk("span");
  spacer.className = "g2-spacer";
  tb.appendChild(spacer);
  var gv = group();
  this.panBtn = small(gv, toolIcon("pan"), "Pan", "H", "Pan tool — left-drag moves the grid (default)", function () { self.setTool("pan"); }, "on");
  this.selToolBtn = small(gv, toolIcon("marquee"), "Marquee", "V", "Marquee tool — left-drag selects keys (Shift+drag in any tool)", function () { self.setTool("sel"); });
  small(gv, toolIcon("fit"), "Fit", "\\", "Fit all curves", function () { self.fitAll(false); });
  small(gv, toolIcon("frame"), "Frame", "F", "Frame selected keys", function () { self.frameSelected(); });
  this.normBtn = small(gv, toolIcon("norm"), "Norm", "N", "Normalize curves to same height", function () {
    self.options.normalize = !self.options.normalize;
    self.normBtn.classList.toggle("on", self.options.normalize);
    self.refreshAllScales(); self.updateViewBox(); self.updateLegend(); self.updateStatus();
  });
  if (this.options.normalize) this.normBtn.classList.add("on");
  this.snapBtn = small(gv, toolIcon("snap"), "Snap", "S", "Snap to playhead + keys", function () {
    self.options.snap = !self.options.snap;
    self.snapBtn.classList.toggle("on", self.options.snap);
    self.updateStatus();
  }, "on");
  if (!this.options.snap) this.snapBtn.classList.remove("on");
  sep();
  var gk = group();
  small(gk, toolIcon("key"), "+Key", "K", "Add keyframe at playhead on all curves", function () { self.addKeyframeAtPlayhead(); }, "g2-acc");
  small(gk, toolIcon("del"), "Del", "Del", "Delete selected", function () {
    self.editor.history.startOperation();
    self.deleteKeyframes(self.selectedKeys());
    self.editor.history.finishOperation();
  });
  sep();
  var ge = group();
  small(ge, toolIcon("bez"), "Bezier", "I", "Toggle bezier / linear", function () {
    self.editor.history.startOperation(); self.toggleInterpolation(self.selectedKeys()); self.editor.history.finishOperation();
  });
  small(ge, toolIcon("link"), "Link", "T", "Toggle continuous tangent", function () {
    self.editor.history.startOperation(); self.toggleContinuousTangents(self.selectedKeys()); self.editor.history.finishOperation();
  });
  small(ge, toolIcon("flat"), "Flat", "R", "Reset handles", function () {
    self.editor.history.startOperation(); self.resetHandles(self.selectedKeys()); self.editor.history.finishOperation();
  });
  sep();
  var gd = group();
  small(gd, toolIcon("copy"), "Copy", "Ctrl+C", "Copy", function () { self.copySelected(); });
  small(gd, toolIcon("paste"), "Paste", "Ctrl+V", "Paste at playhead", function () { self.pasteAtPlayhead(); });
  this.labelsBtn = small(gd, toolIcon("tag"), "Labels", "", "Toggle curve labels", function () {
    self.options.showLabels = !self.options.showLabels;
    self.labelsBtn.classList.toggle("on", self.options.showLabels !== false);
    self.updateViewBox();
  }, "on");
  if (this.options.showLabels === false) this.labelsBtn.classList.remove("on");
};
PZ.ui.graph.prototype.create = function () {
  var self = this;
  // styles must exist in the document that owns this panel (popup window case)
  gpInjectStyle(g2doc(this.el));
  this.el.classList.add("g2-host");
  function mk(tag) {
    try {
      var d = self._doc() || g2doc(self.el);
      if (d && d.createElement) return d.createElement(tag);
    } catch (eMk) {}
    return document.createElement(tag);
  }
  function mkNS(tag) {
    try {
      var d = self._doc() || g2doc(self.el);
      if (d && d.createElementNS) return d.createElementNS(SVGNS, tag);
    } catch (eMkNS) {}
    return document.createElementNS(SVGNS, tag);
  }
  var root = mk("div");
  root.className = "g2-wrap";
  this.el.appendChild(root);
  this.rootEl = root;
  this.toolbarEl = mk("div");
  this.toolbarEl.className = "g2-toolbar";
  root.appendChild(this.toolbarEl);
  // C4D layout: track list column | (frame ruler + canvas)
  this.mainEl = mk("div");
  this.mainEl.className = "g2-main";
  root.appendChild(this.mainEl);
  this.tracksEl = mk("div");
  this.tracksEl.className = "g2-tracks";
  this.mainEl.appendChild(this.tracksEl);
  this.rightEl = mk("div");
  this.rightEl.className = "g2-right";
  this.mainEl.appendChild(this.rightEl);
  // frame ruler (numbers + scrub), aligned with canvas
  this.rulerEl = mk("div");
  this.rulerEl.className = "g2-ruler";
  this.rulerCanvas = mk("canvas");
  this.rulerEl.appendChild(this.rulerCanvas);
  this.rightEl.appendChild(this.rulerEl);
  this.canvasEl = mk("div");
  this.canvasEl.className = "g2-canvas";
  this.canvasEl.setAttribute("tabindex", "0");
  this.rightEl.appendChild(this.canvasEl);
  this.bodyEl = this.canvasEl; // alias: focus/interaction target
  this.statusEl = mk("div");
  this.statusEl.className = "g2-status";
  root.appendChild(this.statusEl);
  this.buildToolbar();
  this.createGraph();
  this.xGrid = new PZ.ui.graph.grid(this);
  this.yGrid = new PZ.ui.graph.grid(this, { dimension: 1 });
  // range shade behind curves (after grids, before curves)
  this.rangeRect = mkNS("rect");
  this.rangeRect.setAttributeNS(null, "fill", "rgba(255,255,255,0.035)");
  this.rangeRect.setAttributeNS(null, "stroke", "rgba(255,255,255,0.08)");
  this.rangeRect.setAttributeNS(null, "stroke-width", "1px");
  this.rangeRect.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  this.rangeRect.style.pointerEvents = "none";
  this.svg.appendChild(this.rangeRect);
  // curve layer
  this.curveLayer = mkNS("g");
  this.svg.appendChild(this.curveLayer);
  this.createCursor();
  // overlay (selection rect) — separate layer, NOT inside cursor
  this.overlayLayer = mkNS("g");
  this.overlayLayer.style.pointerEvents = "none";
  this.svg.appendChild(this.overlayLayer);
  this.selectRect = mkNS("rect");
  this.selectRect.setAttributeNS(null, "fill", "rgba(200,200,200,0.10)");
  this.selectRect.setAttributeNS(null, "stroke", "#ccc");
  this.selectRect.setAttributeNS(null, "stroke-width", "1");
  this.selectRect.setAttributeNS(null, "stroke-dasharray", "4 3");
  this.selectRect.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  this.selectRect.style.display = "none";
  this.overlayLayer.appendChild(this.selectRect);
  // tooltip + empty-state overlay inside the canvas
  this.tipEl = mk("div");
  this.tipEl.className = "g2-tip";
  this.canvasEl.appendChild(this.tipEl);
  // empty-state overlay (design)
  this.emptyEl = mk("div");
  this.emptyEl.className = "g2-empty";
  this.emptyEl.innerHTML = "<div class='g2-empty-card'><h3>NO CURVES</h3><p>Select keyframed properties on the left.<br>Press <b>\\</b> to fit · <b>F</b> to frame · <b>dblclick</b> to add a key.</p></div>";
  this.canvasEl.appendChild(this.emptyEl);

  this.canvasEl.addEventListener("wheel", function (e) { self.mouseWheel(e); }, { passive: false });
  this.svg.addEventListener("pointerdown", function (e) { self.onSvgPointerDown(e); });
  // Windows middle-click autoscroll would hijack MMB marquee — kill it
  this.svg.addEventListener("mousedown", function (e) { if (e.button === 1) e.preventDefault(); });
  this.svg.addEventListener("auxclick", function (e) { if (e.button === 1) e.preventDefault(); });
  this.rulerEl.addEventListener("mousedown", function (e) { if (e.button === 1) e.preventDefault(); });
  this.svg.addEventListener("pointermove", function (e) { self.onSvgPointerMove(e); });
  this.svg.addEventListener("dblclick", function (e) { self.onSvgDoubleClick(e); });
  // ruler scrub (C4D): left-drag the numbers OR the red playhead bar
  this.rulerEl.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    beginPointerDrag(self.rulerEl, e, function (ev) { self.scrubRuler(ev.clientX); }, null);
    self.scrubRuler(e.clientX);
  });
  this.bodyEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  this.bodyEl.addEventListener("keydown", function (e) { self.keydown(e); });
  // Global Space pans the view without needing focus; bound per owner
  // window (rebound when the panel moves documents) so it works in popups.
  try { self._ensureSpaceListeners(); } catch (eSpace) {}
  try { self._installResizeObserver(); } catch (eRO) {}
  this.applyToolCursor();
  this.updateStatus();
};

/* ---------- mouse ---------- */
PZ.ui.graph.prototype.mouseWheel = function (e) {
  var r = this.svg.getBoundingClientRect();
  var mx = e.clientX - r.left, my = e.clientY - r.top;
  var before = this.screenToGraph(mx, my);
  var t = 1;
  if (e.deltaY < 0) t = 0.9; else if (e.deltaY > 0) t = 1.1111;
  if (!e.ctrlKey) this.zoomX = clamp(this.zoomX * t, 0.05, 500);
  if (!e.shiftKey) this.zoomY = clamp(this.zoomY * t, 0.001, 10000);
  // anchor at mouse
  var vx = before.x - (mx / Math.max(r.width, 1)) * this.viewW();
  var vy = before.y - (my / Math.max(r.height, 1)) * this.viewH();
  this.centerX = vx + 0.5 * this.viewW();
  this.centerY = vy + 0.5 * this.viewH();
  this.updateViewBox();
  this.updateStatus();
  e.preventDefault();
};
PZ.ui.graph.prototype.onSvgPointerDown = function (e) {
  var self = this;
  // BUGFIX tools disappeared: plain focus() scrolls the panel and pushes the
  // toolbar out of view — focus without scrolling, and swallow the default.
  try { if (e.button === 0 || e.button === 1) e.preventDefault(); } catch (err) {}
  focusNoScroll(this.bodyEl);
  if (e.button === 2) {
    // RMB: scrub playhead
    e.preventDefault();
    var scrub = function (ev) {
      var rect = self.svg.getBoundingClientRect();
      var g = self.screenToGraph(ev.clientX - rect.left, ev.clientY - rect.top);
      var f = Math.round(g.x);
      try {
        self.editor.playback.speed = 0;
        self.editor.playback.currentFrame = clamp(f, 0, totalFrames(self.editor) - 1);
      } catch (err) {}
    };
    beginPointerDrag(self.svg, e, scrub, null);
    scrub(e);
    return;
  }
  if (e.button !== 0 && e.button !== 1) return;
  if (e.target && e.target.classList && e.target.classList.contains("g2-kf")) return; // handled by key handlers
  if (e.target && e.target.classList && e.target.classList.contains("g2-hdl")) return;
  var self2 = this;
  var rect = this.svg.getBoundingClientRect();
  var startPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  var startG = this.screenToGraph(startPx.x, startPx.y);
  // 1) LMB on the red playhead line (within 7px) -> scrub
  var cfNow = currentFrame(this.editor);
  var pxDist = Math.abs((startG.x - cfNow) / Math.max(this.zoomX, 1e-9));
  if (e.button === 0 && (e.target === this.cursor || pxDist <= 7)) {
    e.preventDefault();
    try { this.canvasEl.style.cursor = "col-resize"; } catch (err) {}
    var scrubTo = function (ev) {
      var r2 = self2.svg.getBoundingClientRect();
      var gg = self2.screenToGraph(ev.clientX - r2.left, ev.clientY - r2.top);
      try {
        self2.editor.playback.speed = 0;
        self2.editor.playback.currentFrame = clamp(Math.round(gg.x), 0, Math.max(totalFrames(self2.editor) - 1, 0));
      } catch (err) {}
      self2.updateStatus("playhead " + currentFrame(self2.editor));
    };
    beginPointerDrag(this.svg, e, scrubTo, function () {
      try { self2.applyToolCursor(); } catch (err) {}
    });
    scrubTo(e);
    return;
  }
  // 2) MMB always marquee-selects; LMB marquees with the marquee tool or
  //    Shift, otherwise LMB-drag pans the view
  var wantMarquee = (e.button === 1) || (this.tool === "sel") || e.shiftKey;
  var isPan = !wantMarquee;
  this._dragging = isPan ? "pan" : "marquee";
  try {
    if (isPan) this.canvasEl.style.cursor = "grabbing";
  } catch (err) {}
  var cur = { x: startPx.x, y: startPx.y };
  var moved = false;
  var startCX = this.centerX, startCY = this.centerY;
  var mv = function (ev) {
    var r2 = self2.svg.getBoundingClientRect();
    cur = { x: ev.clientX - r2.left, y: ev.clientY - r2.top };
    if (Math.abs(cur.x - startPx.x) + Math.abs(cur.y - startPx.y) < 4 && !moved) return;
    moved = true;
    if (isPan) {
      self2.centerX = startCX - (cur.x - startPx.x) / Math.max(r2.width, 1) * self2.viewW();
      self2.centerY = startCY - (cur.y - startPx.y) / Math.max(r2.height, 1) * self2.viewH();
      self2.updateViewBox();
      return;
    }
    var a = self2.screenToGraph(Math.min(startPx.x, cur.x), Math.min(startPx.y, cur.y));
    var b = self2.screenToGraph(Math.max(startPx.x, cur.x), Math.max(startPx.y, cur.y));
    if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) return;
    self2.selectRect.style.display = "";
    self2.selectRect.setAttributeNS(null, "x", a.x);
    self2.selectRect.setAttributeNS(null, "y", a.y);
    self2.selectRect.setAttributeNS(null, "width", Math.max(b.x - a.x, 1e-6));
    self2.selectRect.setAttributeNS(null, "height", Math.max(b.y - a.y, 1e-6));
    var multi = ev.shiftKey;
    var groups = self2.propGroups();
    for (var gi = 0; gi < groups.length; gi++) {
      var gel = groups[gi];
      var off = gel.pz_frameOffset || 0;
      var keys = gel._keys.children;
      for (var k = 0; k < keys.length; k++) {
        var el = keys[k];
        var kf = el.pz_object;
        if (!kf || typeof kf.value !== "number" || !isFinite(kf.value) || !isFinite(kf.frame)) continue;
        var ax = kf.frame + off;
        var scale = gel.pz_valueScale || 1;
        var gy = -kf.value * scale;
        var inside = ax >= a.x && ax <= b.x && gy >= a.y && gy <= b.y;
        if (inside) self2.selectKeyframe(el);
        else if (!multi) self2.deselectKeyframe(el);
      }
    }
    self2.updateStatus();
  };
  beginPointerDrag(this.svg, e, mv, function () {
    self2._dragging = null;
    self2.selectRect.style.display = "none";
    try { self2.applyToolCursor(); } catch (err) {}
    self2.updateStatus();
  });
};
PZ.ui.graph.prototype.onSvgPointerMove = function (e) {
  var rect = this.svg.getBoundingClientRect();
  var px = e.clientX - rect.left, py = e.clientY - rect.top;
  var g = this.screenToGraph(px, py);
  // hover affordance: red playhead line gets a resize cursor
  if (!this._dragging) {
    var cfh = currentFrame(this.editor);
    var nearPlayhead = Math.abs((g.x - cfh) / Math.max(this.zoomX, 1e-9)) <= 7;
    try {
      this.canvasEl.style.cursor = nearPlayhead ? "col-resize" : (this.tool === "sel" ? "crosshair" : "grab");
    } catch (err) {}
  }
  var html = "f " + Math.round(g.x) + " · y " + (Math.round(g.y * 10) / 10);
  // hover keyframe?
  var t = e.target;
  if (t && t.classList && t.classList.contains("g2-kf") && t.pz_object) {
    var kf = t.pz_object;
    var gel = t.parentElement.parentElement;
    var off = (gel && gel.pz_frameOffset) || 0;
    var scale = (gel && gel.pz_valueScale) || 1;
    var nm = gel && gel.pz_object ? displayName(gel.pz_object) : "";
    html = nm + "<br>f " + (kf.frame + off) + " (rel " + kf.frame + ")<br>v " + kf.value +
      "<br>ease " + (kf.tween & 255) + (kf.tween >> 8 ? " · bez" : " · lin") +
      (kf.continuousTangent ? "" : " · broken");
    var r2 = t.getBoundingClientRect();
    this.tipEl.style.left = (r2.left - rect.left + 14) + "px";
    this.tipEl.style.top = (r2.top - rect.top - 10) + "px";
  } else {
    this.tipEl.style.left = (px + 14) + "px";
    this.tipEl.style.top = (py + 12) + "px";
  }
  this.tipEl.innerHTML = html;
  this.tipEl.style.display = "";
  clearTimeout(this._tipTO);
  var self = this;
  this._tipTO = setTimeout(function () { self.tipEl.style.display = "none"; }, 900);
  // status live
  if (!this._statusTick || Date.now() - this._statusTick > 120) {
    this._statusTick = Date.now();
    this._hoverInfo = html.replace(/<br>/g, " | ");
    this.updateStatus(this._hoverInfo);
  }
  void scale;
};
PZ.ui.graph.prototype.onSvgDoubleClick = function (e) {
  if (e.button !== 0) return;
  if (e.target && e.target.classList && (e.target.classList.contains("g2-kf") || e.target.classList.contains("g2-hdl"))) return;
  var rect = this.svg.getBoundingClientRect();
  var g = this.screenToGraph(e.clientX - rect.left, e.clientY - rect.top);
  var absF = Math.round(g.x);
  // find nearest curve within threshold, else use all visible groups
  var groups = this.propGroups().filter(function (gel) {
    if (gel.style.display === "none") return false;
    return gel.pz_object;
  });
  if (!groups.length) return;
  var self = this;
  var best = null, bestD = Infinity;
  var pxPerUnitY = Math.max(this.zoomY, 1e-6);
  groups.forEach(function (gel) {
    var prop = gel.pz_object;
    var scale = gel.pz_valueScale || 1;
    var off = gel.pz_frameOffset || 0;
    var rel = absF - off;
    var v;
    try { v = prop.get(rel); } catch (err) { v = 0; }
    if (typeof v !== "number") return;
    var gy = -v * scale;
    var d = Math.abs(gy - g.y) / pxPerUnitY;
    if (d < bestD) { bestD = d; best = gel; }
  });
  var targets = (best && bestD < 24) ? [best] : groups;
  // if selection exists, prefer curves that have selected keys
  var selGroups = {};
  this.selectedKeys().forEach(function (el) {
    var gel = el.parentElement.parentElement;
    if (gel) selGroups[gel._gid] = gel;
  });
  var selList = Object.keys(selGroups).map(function (k) { return selGroups[k]; });
  if (selList.length) targets = selList;
  this.editor.history.startOperation();
  var added = 0;
  for (var i = 0; i < targets.length; i++) {
    var gel = targets[i];
    var prop = gel.pz_object;
    var off = gel.pz_frameOffset || 0;
    var rel = this.snapFrame(absF, null) - off;
    if (prop.hasKeyframe && prop.hasKeyframe(rel)) continue;
    var scale = gel.pz_valueScale || 1;
    var val = -g.y / scale;
    // clamp to definition min/max if present
    try {
      if (prop.definition && prop.definition.min !== undefined) val = Math.max(val, prop.definition.min);
      if (prop.definition && prop.definition.max !== undefined) val = Math.min(val, prop.definition.max);
    } catch (err) {}
    var tween = 1;
    try {
      if (!prop.interpolated) tween = 0;
      else {
        var idx = prop.getClosestKeyframeIndex(rel);
        var nk = prop.keyframes[idx];
        if (nk) tween = nk.tween;
      }
    } catch (err) {}
    var data;
    try { data = new PZ.keyframe(val, rel, tween); }
    catch (err) { data = { value: val, frame: rel, tween: tween }; }
    try { this.propertyOps.createKeyframe({ property: prop.getAddress(), data: data }); added++; }
    catch (err) {}
  }
  this.editor.history.finishOperation();
  if (!added) this.updateStatus("keyframe already exists at f " + absF);
};

/* ---------- snapping ---------- */
PZ.ui.graph.prototype.snapFrame = function (absFrame, excludeEls) {
  var f = Math.round(absFrame);
  if (!this.options.snap) return f;
  var threshPx = 8;
  var thresh = threshPx * this.zoomX;
  var best = f, bestD = thresh;
  var pf = currentFrame(this.editor);
  if (Math.abs(pf - f) < bestD) { best = pf; bestD = Math.abs(pf - f); }
  // exclude by keyframe identity so keys being dragged never snap to each other
  var excluded = null;
  try { excluded = new Set(); } catch (e) { excluded = null; }
  (excludeEls || []).forEach(function (el) { if (el.pz_object && excluded) excluded.add(el.pz_object); });
  var groups = this.propGroups();
  for (var gi = 0; gi < groups.length; gi++) {
    var gel = groups[gi];
    var off = gel.pz_frameOffset || 0;
    var keys = gel._keys ? gel._keys.children : [];
    for (var k = 0; k < keys.length; k++) {
      var kf = keys[k].pz_object;
      if (!kf) continue;
      if (excluded && excluded.has(kf)) continue;
      var ax = kf.frame + off;
      var d = Math.abs(ax - f);
      if (d < bestD && d > 0) { best = ax; bestD = d; }
    }
  }
  return best;
};

/* ---------- keyframe drag (pointer based) ---------- */
PZ.ui.graph.prototype.attachKeyframeHandlers = function (el) {
  var self = this;
  el.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    try { e.preventDefault(); } catch (err) {}
    focusNoScroll(self.bodyEl);
    var wasSelected = el.classList.contains("selected");
    if (!wasSelected) {
      if (!e.shiftKey) self.deselectAllKeyframes();
      self.selectKeyframe(el);
    }
    var rect = self.svg.getBoundingClientRect();
    var startPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    var startG = self.screenToGraph(startPx.x, startPx.y);
    var sel = self.selectedKeys();
    // snapshot
    var snap = sel.map(function (s) {
      var gel = s.parentElement.parentElement;
      return {
        el: s, gel: gel, kf: s.pz_object,
        oldFrame: s.pz_object.frame,
        oldValue: s.pz_object.value,
        scale: (gel && gel.pz_valueScale) || 1,
        off: (gel && gel.pz_frameOffset) || 0
      };
    });
    var curG = startG;
    var moved = false;
    self.editor.history.startOperation();
    var mv = function (ev) {
      var r2 = self.svg.getBoundingClientRect();
      curG = self.screenToGraph(ev.clientX - r2.left, ev.clientY - r2.top);
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      moved = true;
      var updateFrame = !ev.ctrlKey;
      var updateValue = !ev.shiftKey;
      var dAbs = curG.x - startG.x;
      var dGraphY = curG.y - startG.y;
      for (var i = 0; i < snap.length; i++) {
        var s = snap[i];
        if (updateFrame) {
          var want = s.oldFrame + dAbs; // relative delta == absolute delta
          var absWant = want + s.off;
          var snapped = self.snapFrame(absWant, sel);
          s.kf.frame = Math.round(snapped - s.off);
        }
        if (updateValue) {
          s.kf.value = s.oldValue + (-dGraphY) / s.scale;
          try {
            if (s.gel.pz_object.definition && s.gel.pz_object.definition.min !== undefined)
              s.kf.value = Math.max(s.kf.value, s.gel.pz_object.definition.min);
            if (s.gel.pz_object.definition && s.gel.pz_object.definition.max !== undefined)
              s.kf.value = Math.min(s.kf.value, s.gel.pz_object.definition.max);
          } catch (err) {}
        }
        self.updateKeyframe(s.el);
        if (s.el.pz_handles) self.updateHandles(s.el.pz_handles);
        self.refreshAdjacentCurves(s.el);
      }
      self.updateStatus();
    };
    var up = function (ev) {
      if (ev && ev.shiftKey && !moved && wasSelected) self.deselectKeyframe(el);
      if (moved) {
        for (var q = 0; q < snap.length; q++) {
          snap[q].el.pz_oldFrame = snap[q].oldFrame;
          snap[q].el.pz_oldValue = snap[q].oldValue;
        }
        self.selectNewKeyframes = true;
        self.finishMovingKeyframes(sel);
        self.selectNewKeyframes = false;
        // push value undo commands
        for (var i = 0; i < snap.length; i++) {
          var s = snap[i];
          var prop = s.gel.pz_object;
          self.editor.history.pushCommand(
            PZ.ui.properties.prototype.setValue.bind(self),
            { property: prop.getAddress(), value: s.oldValue, frame: s.kf.frame }
          );
        }
      }
      self.editor.history.finishOperation();
      self.updateStatus();
    };
    beginPointerDrag(el, e, mv, up);
  });
};
/* legacy shims: keep method names so old callers don't break */
PZ.ui.graph.prototype.keyframeDragStart = function () {};
PZ.ui.graph.prototype.keyframeDrag = function () {};
PZ.ui.graph.prototype.keyframeDragUpdate = function () {};
PZ.ui.graph.prototype.keyframeDragEnd = function () {};
PZ.ui.graph.prototype.finishMovingKeyframes = function (selEls) {
  var els = selEls || this.selectedKeys();
  // group by curve layer
  var byLayer = {};
  for (var i = 0; i < els.length; i++) {
    var gel = els[i].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var id = gel._gid;
    (byLayer[id] = byLayer[id] || { gel: gel, els: [] }).els.push(els[i]);
  }
  var self = this;
  Object.keys(byLayer).forEach(function (id) {
    var entry = byLayer[id];
    var prop = entry.gel.pz_object;
    var list = entry.els;
    // direction for stable collision handling
    list.sort(function (a, b) { return a.pz_object.frame - b.pz_object.frame; });
    var moves = self.propertyOps.startMove(prop, list.length);
    var map = new Map();
    for (var e = 0; e < list.length; e++) {
      var oldF = list[e].pz_oldFrame !== undefined ? list[e].pz_oldFrame : list[e].pz_object.frame;
      // pz_oldFrame was set in old code; in new code snapshot old from drag — fallback to current
      moves[e].oldFrame = list[e].pz_object.frame;
      moves[e].newFrame = oldF;
      map.set(moves[e], list[e].pz_object);
      delete list[e].pz_oldFrame;
      delete list[e].pz_oldValue;
    }
    // NOTE: startMove returns [{oldFrame:0,newFrame:0}]; we store undo = move back.
    // Our live mutation already applied; finishMove sorts, resolves collisions,
    // pushes undo commands and fires onKeyframeMoved for re-layout.
    try { self.propertyOps.finishMove(prop, new Set(list.map(function (x) { return x.pz_object; })), moves, map); }
    catch (err) {}
  });
  this.updateViewBox();
  this.updateLegend();
};

/* ---------- handle drag ---------- */
PZ.ui.graph.prototype.attachHandleHandlers = function (el, cpIdx, kfEl) {
  var self = this;
  el.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    try { e.preventDefault(); } catch (err) {}
    focusNoScroll(self.bodyEl);
    var gel = kfEl.parentElement.parentElement;
    var kf = kfEl.pz_object;
    var scale = (gel && gel.pz_valueScale) || 1;
    var rect = self.svg.getBoundingClientRect();
    var startPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    var startG = self.screenToGraph(startPx.x, startPx.y);
    var startAbsF = kf.frame + ((gel && gel.pz_frameOffset) || 0) + kf.controlPoints[cpIdx][0];
    var startVal = kf.value + kf.controlPoints[cpIdx][1];
    var sel = self.selectedKeys();
    if (!kfEl.classList.contains("selected")) sel = [kfEl];
    var snaps = sel.map(function (s) {
      return { el: s, kf: s.pz_object, gel: s.parentElement.parentElement, oldCP: JSON.parse(JSON.stringify(s.pz_object.controlPoints)) };
    });
    snaps.forEach(function (sn) { sn.el.pz_oldControlPoints = JSON.parse(JSON.stringify(sn.oldCP)); });
    var moved = false;
    self.editor.history.startOperation();
    var mv = function (ev) {
      var r2 = self.svg.getBoundingClientRect();
      var curG = self.screenToGraph(ev.clientX - r2.left, ev.clientY - r2.top);
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      moved = true;
      var dF = curG.x - startG.x;
      var dV = -(curG.y - startG.y);
      var breakT = ev.shiftKey;
      for (var i = 0; i < snaps.length; i++) {
        var sn = snaps[i];
        var sc = (sn.gel && sn.gel.pz_valueScale) || 1;
        var cp = sn.kf.controlPoints[cpIdx];
        var wantF = sn.oldCP[cpIdx][0] + dF;
        if (cpIdx === 0) cp[0] = Math.min(wantF, 0);
        else cp[0] = Math.max(wantF, 0);
        cp[1] = sn.oldCP[cpIdx][1] + dV / sc;
        if (sn.kf.continuousTangent && !breakT) {
          var other = sn.kf.controlPoints[1 - cpIdx];
          // mirror: keep length of other? old code mirrors dragged length onto other
          var len = Math.sqrt(cp[0] * cp[0] + cp[1] * cp[1]);
          var ang = Math.atan2(cp[1], cp[0]) + Math.PI;
          // preserve other length? old code overwrote other with same length — keep that behavior
          other[0] = len * Math.cos(ang);
          other[1] = len * Math.sin(ang);
        }
        self.updateHandles(sn.el.pz_handles);
        self.refreshAdjacentCurves(sn.el);
      }
    };
    var up = function (ev) {
      if (moved) self.finishMovingHandles(ev && ev.shiftKey);
      self.editor.history.finishOperation();
    };
    beginPointerDrag(el, e, mv, up);
    void startAbsF; void startVal; void scale;
  });
};
PZ.ui.graph.prototype.handleDragStart = function () {};
PZ.ui.graph.prototype.handleDrag = function () {};
PZ.ui.graph.prototype.handleDragUpdate = function () {};
PZ.ui.graph.prototype.handleDragEnd = function () {};
PZ.ui.graph.prototype.finishMovingHandles = function (brokeTangent) {
  var sel = this.selectedKeys();
  var byLayer = {};
  for (var i = 0; i < sel.length; i++) {
    var gel = sel[i].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    (byLayer[gel._gid] = byLayer[gel._gid] || { gel: gel, els: [] }).els.push(sel[i]);
  }
  var self = this;
  Object.keys(byLayer).forEach(function (id) {
    var entry = byLayer[id];
    var addr = entry.gel.pz_object.getAddress();
    entry.els.forEach(function (kfel) {
      var kf = kfel.pz_object;
      var oldCP = kfel.pz_oldControlPoints;
      if (!oldCP) {
        // fallback: push current as undo (no-op) — still need to fire changed
        try { entry.gel.pz_object.onKeyframeChanged.update(kf); } catch (e) {}
        return;
      }
      if (brokeTangent && kf.continuousTangent) {
        try { self.propertyOps.setContinuousTangent({ property: addr, frame: kf.frame, continuous: false }); } catch (e) {}
      }
      self.editor.history.pushCommand(
        PZ.ui.properties.prototype.setControlPoints.bind(self),
        { property: addr, frame: kf.frame, controlPoints: oldCP }
      );
      delete kfel.pz_oldControlPoints;
    });
  });
  // snapshot oldCP for next drag
  this.updateViewBox();
};
// store oldCP on selection for undo of handles
PZ.ui.graph.prototype.snapshotHandleUndo = function () {
  var sel = this.selectedKeys();
  sel.forEach(function (el) {
    el.pz_oldControlPoints = JSON.parse(JSON.stringify(el.pz_object.controlPoints));
  });
};

/* ---------- keyframes / curves ---------- */
PZ.ui.graph.prototype.refreshAdjacentCurves = function (kfEl) {
  var prev = kfEl.previousElementSibling ? kfEl.previousElementSibling.pz_object : null;
  var cur = kfEl.pz_object;
  var next = kfEl.nextElementSibling ? kfEl.nextElementSibling.pz_object : null;
  this.updateKeyframe(kfEl);
  if (kfEl.pz_handles) this.updateHandles(kfEl.pz_handles);
  this.updateCurve(kfEl.pz_curveLeft, prev, cur);
  this.updateCurve(kfEl.pz_curveRight, cur, next);
  // neighbor curves that share path
  if (kfEl.previousElementSibling && kfEl.previousElementSibling.pz_curveRight)
    this.updateCurve(kfEl.previousElementSibling.pz_curveRight, prev, cur);
  if (kfEl.nextElementSibling && kfEl.nextElementSibling.pz_curveLeft)
    this.updateCurve(kfEl.nextElementSibling.pz_curveLeft, cur, next);
};
PZ.ui.graph.prototype.onKeyframeCreated = function (gel, kfObj) {
  var kfEl = this.createKeyframe(kfObj);
  var keys = gel._keys;
  var rel = kfObj.frame;
  var at = keys.firstElementChild;
  while (at && at.pz_object.frame < rel) at = at.nextElementSibling;
  // if exact frame exists (from live mutation + event), replace visuals
  if (at && at.pz_object.frame === rel && at.pz_object !== kfObj) {
    // swap object reference to live one
    at.pz_object = kfObj;
    this.updateKeyframe(at);
    if (at.classList.contains("selected")) {
      if (!at.pz_handles) { at.pz_handles = this.createHandles(kfObj); gel._handles.appendChild(at.pz_handles); }
      this.updateHandles(at.pz_handles);
    }
    this.refreshAdjacentCurves(at);
    return;
  }
  keys.insertBefore(kfEl, at);
  this.updateKeyframe(kfEl);
  var curves = gel._curves;
  var prev = kfEl.previousElementSibling, next = kfEl.nextElementSibling;
  if (prev && next) {
    kfEl.pz_curveLeft = this.createCurve();
    kfEl.pz_curveRight = next.pz_curveLeft;
    prev.pz_curveRight = kfEl.pz_curveLeft;
    curves.insertBefore(kfEl.pz_curveLeft, kfEl.pz_curveRight);
    this.updateCurve(kfEl.pz_curveLeft, prev.pz_object, kfEl.pz_object);
    this.updateCurve(kfEl.pz_curveRight, kfEl.pz_object, next.pz_object);
  } else if (prev && !next) {
    kfEl.pz_curveLeft = prev.pz_curveRight;
    kfEl.pz_curveRight = this.createCurve();
    curves.appendChild(kfEl.pz_curveRight);
    this.updateCurve(kfEl.pz_curveLeft, prev.pz_object, kfEl.pz_object);
    this.updateCurve(kfEl.pz_curveRight, kfEl.pz_object, null);
  } else if (!prev && next) {
    kfEl.pz_curveLeft = this.createCurve();
    kfEl.pz_curveRight = next.pz_curveLeft;
    curves.insertBefore(kfEl.pz_curveLeft, kfEl.pz_curveRight);
    this.updateCurve(kfEl.pz_curveLeft, null, kfEl.pz_object);
    this.updateCurve(kfEl.pz_curveRight, kfEl.pz_object, next.pz_object);
  } else {
    kfEl.pz_curveLeft = this.createCurve();
    kfEl.pz_curveRight = this.createCurve();
    curves.appendChild(kfEl.pz_curveLeft);
    curves.appendChild(kfEl.pz_curveRight);
    this.updateCurve(kfEl.pz_curveLeft, null, kfEl.pz_object);
    this.updateCurve(kfEl.pz_curveRight, kfEl.pz_object, null);
  }
  if (this.selectNewKeyframes) this.selectKeyframe(kfEl);
  this.updateLegend();
  this.positionLabel(gel);
};
PZ.ui.graph.prototype.onKeyframeDeleted = function (gel, kfObj) {
  var at = gel._keys.firstElementChild;
  while (at && at.pz_object !== kfObj) at = at.nextElementSibling;
  if (!at) return;
  this.deselectKeyframe(at);
  var prev = at.previousElementSibling, next = at.nextElementSibling;
  if (prev) {
    at.pz_curveRight.remove();
    if (next) {
      next.pz_curveLeft = prev.pz_curveRight;
      this.updateCurve(at.pz_curveLeft, prev.pz_object, next.pz_object);
    } else {
      this.updateCurve(at.pz_curveLeft, prev.pz_object, null);
    }
  } else {
    at.pz_curveLeft.remove();
    if (next) this.updateCurve(at.pz_curveRight, null, next.pz_object);
    else at.pz_curveRight.remove();
  }
  if (at.pz_handles) { at.pz_handles.remove(); at.pz_handles = null; }
  at.remove();
  this.updateLegend();
};
PZ.ui.graph.prototype.onKeyframeMoved = function (gel, evt, kfObj) {
  // simplest robust: full redraw of that curve
  this.redrawAllKeyframes(gel);
  this.updateLegend();
};
PZ.ui.graph.prototype.onKeyframeChanged = function (gel, kfObj) {
  var at = gel._keys.firstElementChild;
  while (at && at.pz_object !== kfObj) at = at.nextElementSibling;
  if (!at) return;
  this.refreshScaleFor(gel);
  this.refreshAdjacentCurves(at);
  this.positionLabel(gel);
};
PZ.ui.graph.prototype.createHandles = function (kfObj) {
  var g = this._doc().createElementNS(SVGNS, "g");
  g.pz_object = kfObj;
  var mk = function () {
    var e = g.ownerDocument.createElementNS(SVGNS, "ellipse");
    e.setAttributeNS(null, "fill", "#8ab4ff");
    e.setAttributeNS(null, "stroke", "#0f1115");
    e.setAttributeNS(null, "stroke-width", "1.5px");
    e.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
    e.classList.add("g2-hdl");
    return e;
  };
  var h0 = mk(), h1 = mk();
  var l0 = g.ownerDocument.createElementNS(SVGNS, "line");
  var l1 = g.ownerDocument.createElementNS(SVGNS, "line");
  [l0, l1].forEach(function (l) {
    l.setAttributeNS(null, "stroke", "#aaa");
    l.setAttributeNS(null, "stroke-width", "1px");
    l.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
    l.style.pointerEvents = "none";
  });
  g.appendChild(h0); g.appendChild(h1); g.appendChild(l0); g.appendChild(l1);
  return g;
};
PZ.ui.graph.prototype.updateHandles = function (hEl) {
  var kf = hEl.pz_object;
  if (!kf || typeof kf.value !== "number" || !isFinite(kf.value) || !isFinite(kf.frame)) { hEl.style.display = "none"; return; }
  var gel = hEl.parentElement.parentElement;
  var scale = (gel && gel.pz_valueScale) || 1;
  var s = this.options.handleSize;
  hEl.style.transform = "translate(" + kf.frame + "px," + (-kf.value * scale) + "px)";
  // SVG g transform via attribute for reliability
  hEl.setAttributeNS(null, "transform", "translate(" + kf.frame + " " + (-kf.value * scale) + ")");
  var h0 = hEl.children[0], h1 = hEl.children[1], l0 = hEl.children[2], l1 = hEl.children[3];
  var bez = kf.tween >> 8;
  hEl.style.display = bez ? "" : "none";
  if (!bez) return;
  h0.setAttributeNS(null, "rx", 0.5 * s * this.zoomX);
  h0.setAttributeNS(null, "ry", 0.5 * s * this.zoomY);
  h0.setAttributeNS(null, "cx", kf.controlPoints[0][0]);
  h0.setAttributeNS(null, "cy", -kf.controlPoints[0][1] * scale);
  h1.setAttributeNS(null, "rx", 0.5 * s * this.zoomX);
  h1.setAttributeNS(null, "ry", 0.5 * s * this.zoomY);
  h1.setAttributeNS(null, "cx", kf.controlPoints[1][0]);
  h1.setAttributeNS(null, "cy", -kf.controlPoints[1][1] * scale);
  l0.setAttributeNS(null, "x1", 0); l0.setAttributeNS(null, "y1", 0);
  l0.setAttributeNS(null, "x2", kf.controlPoints[0][0]); l0.setAttributeNS(null, "y2", -kf.controlPoints[0][1] * scale);
  l1.setAttributeNS(null, "x1", 0); l1.setAttributeNS(null, "y1", 0);
  l1.setAttributeNS(null, "x2", kf.controlPoints[1][0]); l1.setAttributeNS(null, "y2", -kf.controlPoints[1][1] * scale);
};
PZ.ui.graph.prototype.createKeyframe = function (kfObj) {
  var gelColor = "#fff";
  var r = this._doc().createElementNS(SVGNS, "rect");
  r.classList.add("g2-kf");
  r.setAttributeNS(null, "stroke", "transparent");
  r.setAttributeNS(null, "stroke-width", (2 * this.options.keyframeSize) + "px");
  r.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  r.pz_object = kfObj;
  r.pz_curveLeft = null; r.pz_curveRight = null; r.pz_handles = null;
  r.style.fill = gelColor;
  this.attachKeyframeHandlers(r);
  return r;
};
PZ.ui.graph.prototype.updateKeyframe = function (kfEl) {
  var kf = kfEl.pz_object;
  if (!kf || typeof kf.value !== "number" || !isFinite(kf.value) || !isFinite(kf.frame)) { kfEl.style.display = "none"; return; }
  kfEl.style.display = "";
  var gel = kfEl.parentElement.parentElement;
  var scale = (gel && gel.pz_valueScale) || 1;
  var s = this.options.keyframeSize;
  var sel = kfEl.classList.contains("selected");
  var isHold = false, isBez = false;
  try { isHold = (PZ.tween.easingList[255 & kf.tween].fn === null); isBez = (kf.tween >> 8) !== 0; } catch (e) {}
  kfEl.setAttributeNS(null, "width", s * this.zoomX);
  kfEl.setAttributeNS(null, "height", s * this.zoomY);
  kfEl.setAttributeNS(null, "x", kf.frame - 0.5 * s * this.zoomX);
  kfEl.setAttributeNS(null, "y", -kf.value * scale - 0.5 * s * this.zoomY);
  // user design: blue-ring keys — dark center, blue ring; selected = filled blue
  kfEl.setAttributeNS(null, "rx", 0.5 * s * this.zoomX);
  if (sel) {
    kfEl.setAttributeNS(null, "fill", "#8ab4ff");
    kfEl.setAttributeNS(null, "stroke", "#ffffff");
  } else if (isHold) {
    kfEl.setAttributeNS(null, "fill", "#16181d");
    kfEl.setAttributeNS(null, "stroke", "#6b7280");
  } else {
    kfEl.setAttributeNS(null, "fill", "#16181d");
    kfEl.setAttributeNS(null, "stroke", "#8ab4ff");
  }
  kfEl.setAttributeNS(null, "stroke-width", (sel ? 3 : 2.5) + "px");
  if (!kf.continuousTangent && isBez) kfEl.setAttributeNS(null, "stroke-dasharray", "2 1");
  else kfEl.removeAttribute("stroke-dasharray");
};
PZ.ui.graph.prototype.selectKeyframe = function (kfEl) {
  if (kfEl.classList.contains("selected")) return;
  var gel = kfEl.parentElement.parentElement;
  kfEl.pz_handles = this.createHandles(kfEl.pz_object);
  gel._handles.appendChild(kfEl.pz_handles);
  // wire handles
  var h0 = kfEl.pz_handles.children[0], h1 = kfEl.pz_handles.children[1];
  this.attachHandleHandlers(h0, 0, kfEl);
  this.attachHandleHandlers(h1, 1, kfEl);
  kfEl.pz_oldControlPoints = JSON.parse(JSON.stringify(kfEl.pz_object.controlPoints));
  this.updateHandles(kfEl.pz_handles);
  kfEl.classList.add("selected");
  this.updateKeyframe(kfEl);
};
PZ.ui.graph.prototype.deselectKeyframe = function (kfEl) {
  if (!kfEl.classList.contains("selected")) return;
  if (kfEl.pz_handles) { kfEl.pz_handles.remove(); kfEl.pz_handles = null; }
  kfEl.classList.remove("selected");
  try { this.updateKeyframe(kfEl); } catch (e) {}
};
PZ.ui.graph.prototype.deselectAllKeyframes = function () {
  var sel = this.selectedKeys();
  for (var i = 0; i < sel.length; i++) this.deselectKeyframe(sel[i]);
  this.updateStatus();
};
PZ.ui.graph.prototype.createCurve = function () {
  var p = this._doc().createElementNS(SVGNS, "path");
  p.setAttributeNS(null, "vector-effect", "non-scaling-stroke");
  p.setAttributeNS(null, "fill", "none");
  p.classList.add("g2-cv");
  p.pz_left = null; p.pz_right = null;
  return p;
};
PZ.ui.graph.prototype.updateCurve = function (path, leftKf, rightKf) {
  if (!path) return;
  // skip curves with non-numeric values (e.g. option/text props) instead of poisoning with NaN
  if (leftKf && (typeof leftKf.value !== "number" || !isFinite(leftKf.value) || !isFinite(leftKf.frame))) leftKf = null;
  if (rightKf && (typeof rightKf.value !== "number" || !isFinite(rightKf.value) || !isFinite(rightKf.frame))) rightKf = null;
  if (!leftKf && !rightKf) { path.setAttributeNS(null, "d", "M 0 0"); return; }
  path.pz_left = leftKf || null; path.pz_right = rightKf || null;
  var gel = path.parentElement.parentElement;
  var scale = (gel && gel.pz_valueScale) || 1;
  var off = (gel && gel.pz_frameOffset) || 0;
  var col = (gel && gel.pz_color) || "#888";
  path.setAttributeNS(null, "stroke", col);
  path.setAttributeNS(null, "stroke-width", this.options.curveLineWidth + "px");
  path.setAttributeNS(null, "opacity", gel && gel.style.display === "none" ? "0.15" : "1");
  var sX, sY, eX, eY;
  if (leftKf) { sX = leftKf.frame; sY = -leftKf.value * scale; }
  else {
    var endR = rightKf ? rightKf.frame : 0;
    sX = Math.min(this.centerX - off - 0.5 * this.width * this.zoomX, endR);
    sY = rightKf ? -rightKf.value * scale : 0;
  }
  if (rightKf) { eX = rightKf.frame; eY = -rightKf.value * scale; }
  else {
    eX = Math.max(this.centerX - off + 0.5 * this.width * this.zoomX, leftKf.frame);
    eY = -leftKf.value * scale;
  }
  var d;
  if (leftKf && rightKf && (rightKf.tween >> 8)) {
    var corr = 1;
    try { corr = PZ.tween.correctCurve(leftKf, rightKf); } catch (e) {}
    var c1x = leftKf.controlPoints[1][0] * corr + leftKf.frame;
    var c1y = -leftKf.controlPoints[1][1] * scale * corr - leftKf.value * scale;
    var c2x = rightKf.controlPoints[0][0] * corr + rightKf.frame;
    var c2y = -rightKf.controlPoints[0][1] * scale * corr - rightKf.value * scale;
    d = "M " + sX + " " + sY + " C " + c1x + " " + c1y + ", " + c2x + " " + c2y + ", " + eX + " " + eY;
  } else if (leftKf && rightKf) {
    var easeIdx = rightKf.tween & 255;
    var fn = null;
    try { fn = PZ.tween.easingList[easeIdx].fn; } catch (e) {}
    if (!fn) {
      // hold/step (user design 5): flat run then sharp vertical jump at key
      d = "M " + sX + " " + sY + " L " + eX + " " + sY + " L " + eX + " " + eY;
    } else if (easeIdx === 1) {
      d = "M " + sX + " " + sY + " L " + eX + " " + eY;
    } else {
      // sample easing (16 segs) — shows TRUE f-curve
      d = "M " + sX + " " + sY;
      var N = 20;
      for (var k = 1; k <= N; k++) {
        var u = k / N;
        var fx = leftKf.frame + (rightKf.frame - leftKf.frame) * u;
        var ev = fn(u);
        var vv = (rightKf.value - leftKf.value) * ev + leftKf.value;
        d += " L " + fx + " " + (-vv * scale);
      }
    }
  } else {
    d = "M " + sX + " " + sY + " L " + eX + " " + eY;
  }
  path.setAttributeNS(null, "d", d);
};
PZ.ui.graph.prototype.redrawAllKeyframes = function (gel) {
  // BUGFIX: preserve selection across redraw (was losing sel on move)
  var keep = {};
  try {
    var cur = gel._keys ? Array.prototype.slice.call(gel._keys.querySelectorAll(".selected")) : [];
    for (var q = 0; q < cur.length; q++) if (cur[q].pz_object) keep[cur[q].pz_object.frame] = true;
  } catch (e) {}
  while (gel._keys.firstChild) gel._keys.firstChild.remove();
  while (gel._curves.firstChild) gel._curves.firstChild.remove();
  while (gel._handles.firstChild) gel._handles.firstChild.remove();
  var prop = gel.pz_object;
  this.refreshScaleFor(gel);
  for (var i = 0; i < prop.keyframes.length; i++) {
    this.onKeyframeCreated(gel, prop.keyframes[i]);
  }
  try {
    var keys = gel._keys.children;
    for (var k = 0; k < keys.length; k++) {
      if (keep[keys[k].pz_object.frame]) this.selectKeyframe(keys[k]);
    }
  } catch (e) {}
  this.positionLabel(gel);
};
PZ.ui.graph.prototype.positionLabel = function (gel) {
  if (!gel._label) return;
  gel._label.setAttributeNS(null, "class", "g2-curve-label");
  var show = this.options.showLabels !== false;
  gel._label.style.display = show ? "" : "none";
  if (!show) return;
  var prop = gel.pz_object;
  if (!prop || !prop.keyframes.length) { gel._label.textContent = ""; return; }
  var last = prop.keyframes[prop.keyframes.length - 1];
  if (typeof last.value !== "number" || !isFinite(last.value)) { gel._label.textContent = ""; return; }
  var scale = gel.pz_valueScale || 1;
  var x = last.frame;
  var y = -last.value * scale;
  // counter-scale like grid text so "Position.Z" isn't stretched
  gel._label.setAttributeNS(null, "transform", "translate(" + x + " " + y + ") scale(" + this.zoomX + " " + this.zoomY + ")");
  gel._label.setAttributeNS(null, "x", 8);
  gel._label.setAttributeNS(null, "y", -7);
  gel._label.setAttributeNS(null, "font-size", "11");
  gel._label.setAttributeNS(null, "fill", "#ffffff");
  gel._label.textContent = displayName(prop);
};
PZ.ui.graph.prototype.createProperty = function (prop) {
  var doc = this._doc();
  var g = doc.createElementNS(SVGNS, "g");
  g.pz_object = prop;
  g.pz_frameOffset = 0;
  g._gid = "g" + (gpNextGroupId++);
  g.pz_color = this.graphColor(prop);
  g.pz_valueScale = 1 / (scaleFactorOf(prop) || 1);
  var curves = doc.createElementNS(SVGNS, "g");
  curves.setAttributeNS(null, "fill", "none");
  curves.setAttributeNS(null, "stroke-width", this.options.curveLineWidth + "px");
  curves.setAttributeNS(null, "stroke", g.pz_color);
  g.appendChild(curves);
  g._curves = curves;
  var keys = doc.createElementNS(SVGNS, "g");
  g.appendChild(keys);
  g._keys = keys;
  var handles = doc.createElementNS(SVGNS, "g");
  g.appendChild(handles);
  g._handles = handles;
  var label = doc.createElementNS(SVGNS, "text");
  label.setAttributeNS(null, "fill", g.pz_color);
  label.setAttributeNS(null, "font-family", "'Source Code Pro',monospace");
  label.style.pointerEvents = "none";
  g.appendChild(label);
  g._label = label;
  var self = this;
  g.pz_keyframeCreated = function (kf, idx) { self.onKeyframeCreated(g, kf); };
  prop.onKeyframeCreated.watch(g.pz_keyframeCreated);
  g.el_keyframeDeleted = function (kf) { self.onKeyframeDeleted(g, kf); };
  prop.onKeyframeDeleted.watch(g.el_keyframeDeleted);
  g.pz_keyframeMoved = function (a, b) { self.onKeyframeMoved(g, a, b); };
  prop.onKeyframeMoved.watch(g.pz_keyframeMoved);
  g.pz_keyframeChanged = function (kf) { self.onKeyframeChanged(g, kf); };
  prop.onKeyframeChanged.watch(g.pz_keyframeChanged);
  try {
    var clip = prop.tryGetParentOfType(PZ.clip);
    if (clip) {
      g.pz_sequence = clip.getParentOfType(PZ.sequence);
      g.pz_clipMoved = function () {
        g.pz_frameOffset = clip.start;
        g.setAttributeNS(null, "transform", "translate(" + clip.start + " 0)");
        self.updateViewBox();
      };
      g.pz_sequence.ui.onClipMoved.watch(g.pz_clipMoved, true);
    }
  } catch (e) {}
  this.refreshScaleFor(g);
  this.redrawAllKeyframes(g);
  if (this.isHidden(prop)) g.style.display = "none";
  return g;
};
PZ.ui.graph.prototype.unloadProperty = function (g) {
  var prop = g.pz_object;
  try {
    if (g.pz_nameChanged && prop.properties && prop.properties.name) prop.properties.name.onChanged.unwatch(g.pz_nameChanged);
    prop.onKeyframeCreated.unwatch(g.pz_keyframeCreated);
    prop.onKeyframeDeleted.unwatch(g.el_keyframeDeleted);
    prop.onKeyframeMoved.unwatch(g.pz_keyframeMoved);
    prop.onKeyframeChanged.unwatch(g.pz_keyframeChanged);
    if (g.pz_clipMoved && g.pz_sequence) g.pz_sequence.ui.onClipMoved.unwatch(g.pz_clipMoved);
  } catch (e) {}
};
PZ.ui.graph.prototype.objectAdded = function (prop) {
  if (!(prop instanceof PZ.property.dynamic.keyframes)) return;
  var g = this.createProperty(prop);
  this.curveLayer.appendChild(g);
  this.updateViewBox();
  this.updateLegend();
  if (!this._didInitView) { this._didInitView = true; this.fitAll(false); }
};
PZ.ui.graph.prototype.objectRemoved = function (prop) {
  var groups = this.propGroups();
  for (var i = 0; i < groups.length; i++) {
    if (groups[i].pz_object === prop) {
      this.unloadProperty(groups[i]);
      groups[i].remove();
      break;
    }
  }
  this.updateLegend();
  this.updateViewBox();
};
PZ.ui.graph.prototype.objectsChanged = function () {
  if (!this.curveLayer) return;
  // clear all
  var groups = this.propGroups();
  for (var i = 0; i < groups.length; i++) this.unloadProperty(groups[i]);
  while (this.curveLayer.firstChild) this.curveLayer.firstChild.remove();
  this.deselectAllKeyframes();
  if (this.objects) {
    for (var k = 0; k < this.objects.length; k++) {
      var prop = this.objects[k];
      if (prop instanceof PZ.property.dynamic.keyframes) {
        var g = this.createProperty(prop);
        this.curveLayer.appendChild(g);
      } else if (prop instanceof PZ.property.dynamic.group) {
        // expand group children (X/Y/Z, R/G/B) as separate curves
        for (var j = 0; j < prop.objects.length; j++) {
          var sub = prop.objects[j];
          if (sub instanceof PZ.property.dynamic.keyframes) {
            var g2 = this.createProperty(sub);
            this.curveLayer.appendChild(g2);
          }
        }
      }
    }
  }
  this.refreshAllScales();
  this.updateLegend();
  this.updateViewBox();
  if (!this._didInitView && this.propGroups().length) { this._didInitView = true; this.fitAll(false); }
};

/* ---------- ops ---------- */
PZ.ui.graph.prototype.update = function () {
  this.animFrameReq = requestAnimationFrame(this._updateFn);
  try {
    var ownerDoc = this.el && this.el.ownerDocument;
    if (ownerDoc && ownerDoc !== this._styledDoc) {
      gpInjectStyle(ownerDoc);
      this._styledDoc = ownerDoc;
    }
    // The panel may have been adopted into another document (Ctrl+G popup)
    // after construction: rebind the per-window listeners, re-observe the
    // canvas in the new document, and re-measure once stylesheets land.
    if (ownerDoc && ownerDoc !== this._adoptedDoc) {
      this._adoptedDoc = ownerDoc;
      try {
        if (this._ensureSpaceListeners) this._ensureSpaceListeners();
      } catch (_spaceError) {}
      try {
        if (this._installResizeObserver) this._installResizeObserver();
      } catch (_roError) {}
      try {
        if (this.resize) this.resize();
      } catch (_resizeError) {}
    }
  } catch (_ownerStyleError) {}
  try {
    var cf = currentFrame(this.editor);
    if (this.cursor) {
      this.cursor.setAttributeNS(null, "x1", cf);
      this.cursor.setAttributeNS(null, "x2", cf);
    }
    if (cf !== this._lastRulerFrame) {
      this._lastRulerFrame = cf;
      try { this.drawRuler(); } catch (e2) {}
    }
    if ((this._legendTick = (this._legendTick + 1) % 20) === 0) this.updateLegendValues();
  } catch (e) {}
};
PZ.ui.graph.prototype.resize = function () {
  if (!this.canvasEl) return;
  try {
    if (this._ensureSpaceListeners) this._ensureSpaceListeners();
  } catch (_spaceError) {}
  try {
    if (this._installResizeObserver) this._installResizeObserver();
  } catch (_roError) {}
  this.width = Math.max(this.canvasEl.clientWidth, 1);
  this.height = Math.max(this.canvasEl.clientHeight, 1);
  // Narrow hosts (the 600px Ctrl+G popup) get compact toolbar tiles so
  // more actions stay visible; toggling is idempotent so the resize
  // observer cannot loop on it.
  try {
    if (this.rootEl && this.rootEl.classList) {
      var wrapW = this.rootEl.clientWidth || 0;
      this.rootEl.classList.toggle("g2-narrow", wrapW > 0 && wrapW < 700);
    }
  } catch (_narrowError) {}
  if (this.xGrid) this.xGrid.resize();
  if (this.yGrid) this.yGrid.resize();
  this.updateViewBox();
  // BUGFIX: keep panels pinned — clear any programmatic scroll (focus can
  // scroll overflow:hidden ancestors, which used to push the toolbar away)
  try {
    if (this.rootEl) { this.rootEl.scrollTop = 0; this.rootEl.scrollLeft = 0; }
    if (this.toolbarEl) { this.toolbarEl.scrollTop = 0; }
    if (this.canvasEl) { this.canvasEl.scrollTop = 0; this.canvasEl.scrollLeft = 0; }
  } catch (e) {}
  // BUGFIX: don't lock init view while panel still has zero size (hidden tab)
  if (!this._didInitView && this.width > 50 && this.height > 50) {
    this._didInitView = true;
    if (this.propGroups().length) this.fitAll(false);
    else {
      var tf = totalFrames(this.editor);
      this.centerX = tf / 2; this.centerY = 0;
      this.updateViewBox();
    }
  }
};
PZ.ui.graph.prototype.deleteKeyframes = function (els) {
  for (var t = 0; t < els.length; t++) {
    var gel = els[t].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var prop = gel.pz_object;
    if (prop.keyframes.length === 1 && !prop.definition.allowEmpty) continue;
    var kf = els[t].pz_object;
    this.propertyOps.deleteKeyframe({ property: prop.getAddress(), frame: kf.frame });
  }
  this.updateLegend();
};
PZ.ui.graph.prototype.toggleContinuousTangents = function (els) {
  for (var t = 0; t < els.length; t++) {
    var gel = els[t].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var prop = gel.pz_object;
    var kf = els[t].pz_object;
    this.propertyOps.setContinuousTangent({ property: prop.getAddress(), frame: kf.frame, continuous: !kf.continuousTangent });
  }
};
PZ.ui.graph.prototype.toggleInterpolation = function (els) {
  for (var t = 0; t < els.length; t++) {
    var gel = els[t].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var prop = gel.pz_object;
    var kf = els[t].pz_object;
    var n = kf.tween;
    n = (255 & n) | ((1 & ~(n >> 8)) << 8);
    this.propertyOps.setTween({ property: prop.getAddress(), frame: kf.frame, tween: n });
  }
};
PZ.ui.graph.prototype.resetHandles = function (els) {
  var flat = [[-10, 0], [10, 0]];
  for (var i = 0; i < els.length; i++) {
    var gel = els[i].parentElement.parentElement;
    if (!gel || !gel.pz_object) continue;
    var prop = gel.pz_object;
    var kf = els[i].pz_object;
    this.propertyOps.setControlPoints({ property: prop.getAddress(), frame: kf.frame, controlPoints: flat });
  }
};
PZ.ui.graph.prototype.applyEasingToSelected = function (easeIdx) {
  var sel = this.selectedKeys();
  if (!sel.length) { this.updateStatus("select keys first"); return; }
  this.editor.history.startOperation();
  for (var i = 0; i < sel.length; i++) {
    var gel = sel[i].parentElement.parentElement;
    var kf = sel[i].pz_object;
    // pure easing preset: clear bezier flag so the sampled ease curve shows
    var next = (easeIdx & 255);
    this.propertyOps.setTween({ property: gel.pz_object.getAddress(), frame: kf.frame, tween: next });
  }
  this.editor.history.finishOperation();
  var nm = "";
  try { nm = PZ.tween.easingList[easeIdx & 255].name; } catch (e) {}
  this.updateStatus("applied " + (nm || ("ease " + easeIdx)));
};
PZ.ui.graph.prototype.addKeyframeAtPlayhead = function () {
  var groups = this.propGroups().filter(function (g) { return g.style.display !== "none"; });
  if (!groups.length) return;
  var cf = currentFrame(this.editor);
  this.editor.history.startOperation();
  for (var i = 0; i < groups.length; i++) {
    var prop = groups[i].pz_object;
    var off = groups[i].pz_frameOffset || 0;
    var rel = cf - off;
    if (prop.hasKeyframe && prop.hasKeyframe(rel)) continue;
    var val;
    try { val = prop.get(rel); } catch (e) { val = 0; }
    if (typeof val !== "number") continue;
    var tween = prop.interpolated ? 1 : 0;
    var data;
    try { data = new PZ.keyframe(val, rel, tween); }
    catch (e) { data = { value: val, frame: rel, tween: tween }; }
    try { this.propertyOps.createKeyframe({ property: prop.getAddress(), data: data }); } catch (e) {}
  }
  this.editor.history.finishOperation();
};
PZ.ui.graph.prototype.copySelected = function () {
  var map = {};
  var groups = this.propGroups();
  for (var gi = 0; gi < groups.length; gi++) {
    var gel = groups[gi];
    var sel = Array.prototype.slice.call(gel._keys.getElementsByClassName("selected"));
    if (sel.length) map[gel.pz_object.definition.name] = sel.map(function (e) { return e.pz_object; });
  }
  // The popup editor lives in a separate window: clipboard access goes
  // through its own navigator (permissions follow the focused document).
  var nav = null;
  try { nav = (this._win && this._win().navigator) || null; } catch (eNav) {}
  try {
    if (!nav && typeof navigator !== "undefined") nav = navigator;
  } catch (eNav2) {}
  try {
    var pack = new PZ.package(map, "propertyList");
    var str = JSON.stringify([pack]);
    if (nav && nav.clipboard && nav.clipboard.writeText) nav.clipboard.writeText(str);
    this._clipCache = str;
    this.updateStatus("copied " + Object.keys(map).length + " curve(s)");
  } catch (e) { this.updateStatus("copy failed"); }
};
PZ.ui.graph.prototype.pasteAtPlayhead = function () {
  var self = this;
  var doPaste = function (str) {
    var arr = [];
    try { arr = JSON.parse(str); } catch (e) { return; }
    for (var e = 0; e < arr.length; e++) {
      if (arr[e].baseType !== "propertyList") return;
      arr[e].minFrame = Infinity;
      var keys = Object.keys(arr[e].data);
      for (var s = 0; s < keys.length; s++) {
        var n = arr[e].data[keys[s]];
        if (!n.length) continue;
        arr[e].minFrame = Math.min(arr[e].minFrame, n[0].frame);
      }
    }
    var cf = currentFrame(self.editor);
    self.editor.history.startOperation();
    var groups = self.propGroups();
    for (var gi = 0; gi < groups.length; gi++) {
      var prop = groups[gi].pz_object;
      var off = groups[gi].pz_frameOffset || 0;
      for (var e = 0; e < arr.length; e++) {
        var data = arr[e].data;
        var shift = cf - arr[e].minFrame - off;
        var list = data[prop.definition.name];
        if (list) {
          try { self.propertyOps.pasteKeyframes(prop, JSON.parse(JSON.stringify(list)), shift); } catch (err) {}
          delete data[prop.definition.name];
        }
      }
    }
    self.editor.history.finishOperation();
    self.updateStatus("pasted at f " + cf);
  };
  var nav = null;
  try { nav = (self._win && self._win().navigator) || null; } catch (eNav) {}
  try {
    if (!nav && typeof navigator !== "undefined") nav = navigator;
  } catch (eNav2) {}
  if (nav && nav.clipboard && nav.clipboard.readText) {
    nav.clipboard.readText().then(doPaste, function () { if (self._clipCache) doPaste(self._clipCache); });
  } else if (this._clipCache) doPaste(this._clipCache);
};

/* ---------- legend + status ---------- */
/* C4D-style docked track list (left column) — replaces floating legend */
PZ.ui.graph.prototype.updateLegend = function () {
  if (!this.tracksEl) return;
  var self = this;
  function mk(tag) {
    try {
      var d = self._doc();
      if (d && d.createElement) return d.createElement(tag);
    } catch (e) {}
    return document.createElement(tag);
  }
  while (this.tracksEl.firstChild) this.tracksEl.firstChild.remove();
  var groups = this.propGroups();
  if (this.emptyEl) this.emptyEl.style.display = groups.length ? "none" : "";
  var head = mk("div");
  head.className = "g2-tracks-head";
  head.textContent = groups.length ? "TRACKS · " + groups.length : "TRACKS · none";
  this.tracksEl.appendChild(head);
  if (!groups.length) {
    var h = mk("div");
    h.style.cssText = "padding:6px 8px;color:#cccccc;opacity:.6;font-size:11px;line-height:1.5";
    h.textContent = "select keyframed properties on the left";
    this.tracksEl.appendChild(h);
    return;
  }
  groups.forEach(function (gel) {
    var prop = gel.pz_object;
    var row = mk("div");
    row.className = "g2-track-row";
    row.title = addrString(prop) + " — click to select all its keys";
    var dot = mk("span");
    dot.className = "g2-swatch";
    dot.style.background = gel.pz_color || "#fff";
    row.appendChild(dot);
    var nm = mk("span");
    nm.className = "g2-track-name";
    nm.textContent = displayName(prop);
    row.appendChild(nm);
    var val = mk("span");
    val.className = "g2-track-val";
    val.textContent = "";
    val._prop = prop; val._gel = gel;
    row.appendChild(val);
    var eye = mk("button");
    eye.className = "g2-eye" + (gel.style.display === "none" ? " off" : "");
    eye.textContent = gel.style.display === "none" ? "◌" : "◉";
    eye.title = "show/hide curve";
    eye.addEventListener("mousedown", function (ev) { ev.preventDefault(); ev.stopPropagation(); });
    eye.addEventListener("click", function (ev) {
      ev.stopPropagation();
      gel.style.display = gel.style.display === "none" ? "" : "none";
      self.updateViewBox(); self.updateLegend();
    });
    row.appendChild(eye);
    row.addEventListener("click", function () {
      // click row = select all keys of that curve
      var keys = gel._keys.children;
      var anyUnsel = false;
      for (var i = 0; i < keys.length; i++) if (!keys[i].classList.contains("selected")) { anyUnsel = true; break; }
      for (var j = 0; j < keys.length; j++) {
        if (anyUnsel) self.selectKeyframe(keys[j]);
        else self.deselectKeyframe(keys[j]);
      }
      self.updateStatus();
    });
    self.tracksEl.appendChild(row);
  });
  this.updateLegendValues();
};
PZ.ui.graph.prototype.updateLegendValues = function () {
  if (!this.tracksEl) return;
  var cf = currentFrame(this.editor);
  var rows = this.tracksEl.querySelectorAll(".g2-track-val");
  for (var i = 0; i < rows.length; i++) {
    var prop = rows[i]._prop, gel = rows[i]._gel;
    try {
      var off = (gel && gel.pz_frameOffset) || 0;
      var v = prop.get(cf - off);
      rows[i].textContent = typeof v === "number" ? (Math.round(v * 100) / 100).toString() : "";
    } catch (e) { rows[i].textContent = ""; }
  }
};
PZ.ui.graph.prototype.updateStatus = function (extra) {
  if (!this.statusEl) return;
  var cf = currentFrame(this.editor);
  var sel = this.selectedKeys().length;
  var n = this.propGroups().length;
  this.statusEl.innerHTML = "";
  var self = this;
  var statusDoc = null;
  try { statusDoc = this._doc(); } catch (eDoc) {}
  if (!statusDoc || typeof statusDoc.createElement !== "function") statusDoc = g2doc(this.statusEl);
  function pill(html, live) {
    var s = (statusDoc && statusDoc.createElement ? statusDoc : document).createElement("span");
    s.className = "g2-pill" + (live ? " live" : "");
    s.innerHTML = html;
    self.statusEl.appendChild(s);
  }
  pill("frame <b>" + cf + "</b>");
  pill("curves <b>" + n + "</b>");
  pill("sel <b>" + sel + "</b>", sel > 0);
  pill("zoom <b>" + (Math.round(this.zoomX * 100) / 100) + " / " + (Math.round(this.zoomY * 1000) / 1000) + "</b>");
  pill((this.options.snap ? "snap ON" : "snap OFF") + " · " + (this.options.normalize ? "norm ON" : "norm OFF"), this.options.snap);
  if (extra) pill(String(extra));
  else pill("LMB:pan · MMB:select · RMB:scrub · dblclick:add · F:frame · \\:fit");
  // sync track-row highlight with selection
  try {
    if (this.tracksEl) {
      var rows = this.tracksEl.querySelectorAll(".g2-track-row");
      for (var i = 0; i < rows.length; i++) {
        var gel = rows[i]._gel;
        var any = false;
        if (gel && gel._keys) {
          var keys = gel._keys.children;
          for (var k = 0; k < keys.length; k++) if (keys[k].classList.contains("selected")) { any = true; break; }
        }
        rows[i].classList.toggle("selected", any);
      }
    }
  } catch (e) {}
};

/* ---------- keyboard ---------- */
PZ.ui.graph.prototype.keydown = function (e) {
  var self = this;
  if (e.key === "=" || e.key === "+") {
    e.stopPropagation();
    var t = 0.9;
    if (!e.ctrlKey) this.zoomX = clamp(this.zoomX * t, 0.05, 500);
    if (!e.shiftKey) this.zoomY = clamp(this.zoomY * t, 0.001, 10000);
    this.updateViewBox(); this.updateStatus();
  } else if (e.key === "-" || e.key === "_") {
    e.stopPropagation();
    var t2 = 1.1111;
    if (!e.ctrlKey) this.zoomX = clamp(this.zoomX * t2, 0.05, 500);
    if (!e.shiftKey) this.zoomY = clamp(this.zoomY * t2, 0.001, 10000);
    this.updateViewBox(); this.updateStatus();
  } else if (e.key === "\\") {
    e.stopPropagation(); this.fitAll(false);
  } else if (e.key === "f" || e.key === "F") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation(); this.frameSelected();
  } else if (e.key === "n" || e.key === "N") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    this.options.normalize = !this.options.normalize;
    if (this.normBtn) this.normBtn.classList.toggle("on", this.options.normalize);
    this.refreshAllScales(); this.updateViewBox(); this.updateLegend(); this.updateStatus();
  } else if (e.key === "s" || e.key === "S") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    this.options.snap = !this.options.snap;
    if (this.snapBtn) this.snapBtn.classList.toggle("on", this.options.snap);
    this.updateStatus();
  } else if (e.key === "k" || e.key === "K") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation(); this.addKeyframeAtPlayhead();
  } else if (e.key === "Delete" || e.key === "Del" || e.key === "Backspace") {
    e.stopPropagation();
    var sel = this.selectedKeys();
    this.editor.history.startOperation();
    this.deleteKeyframes(sel);
    this.editor.history.finishOperation();
  } else if (e.key === "t" || e.key === "T") {
    e.stopPropagation();
    var s2 = this.selectedKeys();
    this.editor.history.startOperation();
    this.toggleContinuousTangents(s2);
    this.editor.history.finishOperation();
  } else if (e.key === "i" || e.key === "I") {
    e.stopPropagation();
    var s3 = this.selectedKeys();
    this.editor.history.startOperation();
    this.toggleInterpolation(s3);
    this.editor.history.finishOperation();
  } else if (e.key === "r" || e.key === "R") {
    e.stopPropagation();
    var s4 = this.selectedKeys();
    this.editor.history.startOperation();
    this.resetHandles(s4);
    this.editor.history.finishOperation();
  } else if (e.key === "Escape") {
    e.stopPropagation();
    if (this.easePopup) { this.closeEasePopup(); return; }
    this.deselectAllKeyframes();
  } else if (e.key && e.key.indexOf("Arrow") === 0) {
    var sel5 = this.selectedKeys();
    if (!sel5.length) return;
    e.stopPropagation(); e.preventDefault();
    var df = 0, dvPx = 0;
    if (e.key === "ArrowLeft") df = e.shiftKey ? -10 : -1;
    if (e.key === "ArrowRight") df = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp") dvPx = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowDown") dvPx = e.shiftKey ? -10 : -1;
    this.editor.history.startOperation();
    // snapshot old values for undo
    var snap = sel5.map(function (el) {
      var gel = el.parentElement.parentElement;
      return { el: el, gel: gel, kf: el.pz_object, oldF: el.pz_object.frame, oldV: el.pz_object.value, scale: (gel && gel.pz_valueScale) || 1 };
    });
    for (var i = 0; i < snap.length; i++) {
      var sn = snap[i];
      if (df) sn.kf.frame = Math.round(sn.oldF + df);
      if (dvPx) sn.kf.value = sn.oldV + (dvPx * this.zoomY) / sn.scale;
      this.refreshAdjacentCurves(sn.el);
    }
    this.finishMovingKeyframes(sel5);
    for (var j = 0; j < snap.length; j++) {
      var s = snap[j];
      this.editor.history.pushCommand(
        PZ.ui.properties.prototype.setValue.bind(this),
        { property: s.gel.pz_object.getAddress(), value: s.oldV, frame: s.kf.frame }
      );
    }
    this.editor.history.finishOperation();
    this.updateStatus();
  } else if ((e.key === "c" || e.key === "x") && (e.ctrlKey || e.metaKey)) {
    e.stopPropagation();
    this.copySelected();
    if (e.key === "x") {
      var sx = this.selectedKeys();
      this.editor.history.startOperation();
      this.deleteKeyframes(sx);
      this.editor.history.finishOperation();
    }
  } else if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
    e.stopPropagation();
    this.pasteAtPlayhead();
  } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
    e.stopPropagation(); e.preventDefault();
    var groups = this.propGroups();
    for (var gi = 0; gi < groups.length; gi++) {
      var keys = groups[gi]._keys.children;
      for (var k = 0; k < keys.length; k++) this.selectKeyframe(keys[k]);
    }
    this.updateStatus();
  } else if (e.key === "h" || e.key === "H") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    this.setTool("pan");
  } else if (e.key === "v" || e.key === "V") {
    if (e.ctrlKey || e.metaKey) return;
    e.stopPropagation();
    this.setTool("sel");
  } else if (e.key === " ") {
    e.preventDefault();
    this._spaceDown = true;
  }
};

/* ================= EDITOR (rebuilt, same API) ================= */
PZ.ui.graph.grid = GraphGrid;
PZ.ui.graphEditor = function (editor, opts) {
  var left = new PZ.ui.edit(editor, {
    columnLayout: 2, showPropertyControls: false, hideAllListItemButtons: true,
    selectionFilter: function (e) { return e instanceof PZ.property.dynamic.keyframes; }
  });
  var right = new PZ.ui.graph(editor);
  if (editor.sequence) {
    var list = new PZ.objectList();
    list.push(editor.sequence);
    left.enabled = true;
    left.objects = list;
  }
  right.objects = left.selection;
  var split = PZ.ui.splitPanel.call(this, editor, left, right, 0.33, 1);
  var self = (split && split.el) ? split : this;
  try {
    if (Object.getPrototypeOf(self) !== PZ.ui.graphEditor.prototype) {
      Object.setPrototypeOf(self, PZ.ui.graphEditor.prototype);
    }
  } catch (_protoError) {
    // The panel still mounts; only the instanceof shape is affected.
  }
  self.title = "Graph editor";
  self.icon = "project";
  PZ.observable.defineObservableProp(self, "objects", "onObjectsChanged");
  self.objects = null;
  self.onObjectsChanged.watch(function () { left.objects = self.objects; });
  self._left = left; self._right = right;
  void opts;
  return self;
};
PZ.ui.graphEditor.prototype = Object.create(PZ.ui.splitPanel.prototype);
PZ.ui.graphEditor.prototype.constructor = PZ.ui.graphEditor;

return { graph: PZ.ui.graph, grid: PZ.ui.graph.grid, graphEditor: PZ.ui.graphEditor };
}

var GP_STYLE_ID = "zoidium-graph-plus-css";
function gpInjectStyle(doc) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !doc.head) return;
    if (doc.getElementById && doc.getElementById(GP_STYLE_ID)) return;
    var element = doc.createElement("style");
    element.id = GP_STYLE_ID;
    element.textContent = gpCssText();
    doc.head.appendChild(element);
  } catch (_styleError) {
    // Styling must never break the editor.
  }
}
function gpRemoveStyle(doc) {
  try {
    var existing = doc && doc.getElementById ? doc.getElementById(GP_STYLE_ID) : null;
    if (existing && typeof existing.remove === "function") existing.remove();
  } catch (_removeError) {
    // A closed popup needs no cleanup.
  }
}
function gpCssText() {
return [
    ".g2-wrap{display:flex;flex-direction:column;width:100%;height:100%;background:var(--zui-bg-sunken,#1e1e1f);color:var(--zui-text-bright,#ffffff) !important;font-family:var(--zui-font,'Source Code Pro',ui-monospace,monospace);overflow:hidden;user-select:none;-webkit-user-select:none;position:relative}",
    ".g2-wrap svg,.g2-wrap canvas{-webkit-user-drag:none;user-drag:none}",
    ".g2-canvas{touch-action:none}",
    ".g2-canvas svg{touch-action:none}",
    ".g2-toolbar,.g2-status,.g2-ruler{display:flex !important;visibility:visible !important;opacity:1 !important}",
    /* ==== toolbar: CM3 title-row chrome, same tile layout ==== */
    /* Narrow popup windows (Ctrl+G is 600x400 with a 197px picker column)
       must never squeeze the canvas to zero: the toolbar wraps but is
       capped so the canvas always keeps room; narrow screens get smaller
       tiles so more actions stay visible without scrolling. */
    ".g2-toolbar{flex:0 1 auto;flex-shrink:1;display:flex;align-items:flex-start;gap:6px;padding:15px 26px 10px;background:var(--zui-bg-title,#222222);border-bottom:1px solid var(--zui-border,#1b1b1b);font-size:12px;flex-wrap:wrap;overflow-y:auto;overflow-x:hidden;min-height:104px;max-height:46%;z-index:5;position:relative;scrollbar-width:thin}",
    ".g2-wrap.g2-narrow .g2-toolbar{gap:4px;padding:10px 12px 8px;min-height:0}",
    ".g2-wrap.g2-narrow .g2-tile .g2-box{width:44px;height:38px}",
    ".g2-wrap.g2-narrow .g2-tile .g2-tlabel{font-size:10px;max-width:60px}",
    ".g2-wrap.g2-narrow .g2-group{gap:8px}",
    ".g2-wrap.g2-narrow .g2-sep{width:12px}",
    ".g2-wrap.g2-narrow .g2-tile.g2-small .g2-box{width:32px;height:28px}",
    ".g2-wrap.g2-narrow .g2-custom .g2-sbox{width:40px;height:26px}",
    ".g2-wrap.g2-narrow .g2-custom .g2-clabel{font-size:10px}",
    ".g2-group{display:flex;align-items:flex-start;gap:13px;background:transparent;border:0;border-radius:0;padding:0;flex-shrink:0}",
    ".g2-sep{width:40px;align-self:stretch;background:transparent;flex-shrink:0}",
    ".g2-spacer{flex:1 1 auto}",
    ".g2-wrap .g2-toolbar button.g2-tile{display:flex;flex-direction:column;align-items:center;gap:8px;background:transparent !important;border:0 !important;padding:0 !important;cursor:pointer;width:auto;height:auto;flex-shrink:0}",
    ".g2-tile .g2-box{width:68px;height:54px;background:var(--zui-bg-input,#1a1a1a);border:1px solid var(--zui-border,#1b1b1b);border-radius:2px;display:flex;align-items:center;justify-content:center;box-sizing:border-box}",
    ".g2-tile:hover .g2-box{background:var(--zui-hover,#333333)}",
    ".g2-tile:active .g2-box{background:var(--zui-bg-sunken,#0f0f0f)}",
    ".g2-tile.on .g2-box{outline:2px solid var(--zui-accent,#f5f5f5);outline-offset:0}",
    ".g2-tile .g2-tlabel{font-size:12.5px;line-height:1.2;color:var(--zui-text-bright,#ffffff) !important;text-align:center;max-width:90px;white-space:normal}",
    /* custom easings: thumbnail + label to the RIGHT */
    ".g2-wrap .g2-toolbar button.g2-custom{display:flex;align-items:center;gap:14px;background:transparent !important;border:0 !important;padding:0 !important;cursor:pointer;flex-shrink:0;min-height:54px}",
    ".g2-custom .g2-sbox{width:50px;height:30px;background:var(--zui-bg-input,#1a1a1a);border:1px solid var(--zui-border,#1b1b1b);border-radius:2px;display:flex;align-items:center;justify-content:center}",
    ".g2-custom:hover .g2-sbox{background:var(--zui-hover,#333333)}",
    ".g2-custom .g2-clabel{font-size:12.5px;color:var(--zui-text-bright,#ffffff) !important;white-space:nowrap}",
    /* others: right-aligned small tiles */
    ".g2-tile.g2-small .g2-box{width:38px;height:32px}",
    ".g2-tile.g2-small{gap:3px}",
    ".g2-tile.g2-small .g2-tlabel{font-size:9px;max-width:56px}",
    ".g2-tile.g2-acc .g2-box{background:rgb(var(--zui-accent-rgb,110 68 16) / 0.55)}",
    ".g2-ico{display:inline-flex;flex:0 0 auto}",
    ".g2-ico svg{display:block}",
    /* custom easings popup */
    ".g2-popup{position:absolute;z-index:30;min-width:200px;max-height:330px;overflow-y:auto;background:var(--zui-bg,#2a2a2c);border:1px solid var(--zui-border,#111111);border-radius:4px;box-shadow:0 12px 32px rgba(0,0,0,.55);padding:4px 0}",
    ".g2-popup-head{padding:5px 10px;font-size:10px;letter-spacing:1px;color:var(--zui-text-muted,#c9ced8) !important;border-bottom:1px solid var(--zui-border-soft,#3a3a3c)}",
    ".g2-popup-item{padding:5px 10px;font-size:11px;color:var(--zui-text-bright,#ffffff) !important;cursor:pointer;white-space:nowrap}",
    ".g2-popup-item:hover{background:var(--zui-accent,#4a6da7)}",
    ".g2-wrap .g2-toolbar select{display:none}",
    ".g2-ruler{flex:0 0 auto;flex-shrink:0;height:30px;background:var(--zui-bg,#262627);border-bottom:1px solid var(--zui-border,#141415);cursor:ew-resize;position:relative;overflow:hidden}",
    ".g2-ruler canvas{position:absolute;inset:0;width:100%;height:100%;display:block}",
    ".g2-body{flex:1;position:relative;min-height:0;overflow:hidden;background:var(--zui-bg-sunken,#1e1e1f)}",
    ".g2-main{display:flex;flex:1;min-height:0;min-width:0}",
    ".g2-tracks{flex:0 0 188px;width:188px;min-height:0;background:var(--zui-bg,#2a2a2b);border-right:1px solid var(--zui-border,#141415);overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column}",
    ".g2-tracks-head{flex:0 0 auto;padding:5px 8px;background:var(--zui-bg-title,#242425);border-bottom:1px solid var(--zui-border,#141415);font-size:10px;color:var(--zui-text-bright,#ffffff) !important;letter-spacing:1px}",
    ".g2-track-row{display:flex;align-items:center;gap:7px;padding:5px 8px;border-bottom:1px solid var(--zui-border-soft,#232324);white-space:nowrap;cursor:pointer;flex:0 0 auto}",
    ".g2-track-row:hover{background:var(--zui-hover,rgba(255,255,255,.06))}",
    ".g2-track-row.selected{background:var(--zui-accent,#4a6da7)}",
    ".g2-swatch{width:12px;height:4px;flex:0 0 12px;border-radius:1px}",
    ".g2-track-name{flex:1;overflow:hidden;text-overflow:ellipsis;color:var(--zui-text-bright,#ffffff) !important;font-size:11px}",
    ".g2-track-val{color:var(--zui-value,#ffffff) !important;font-size:11px;font-variant-numeric:tabular-nums;background:rgba(0,0,0,.28);border-radius:3px;padding:1px 5px}",
    ".g2-wrap .g2-eye{cursor:pointer;border:1px solid var(--zui-border,#141415);background:var(--zui-hover,rgba(255,255,255,.07));color:var(--zui-text-bright,#ffffff) !important;font-size:10px;padding:1px 6px;border-radius:3px;line-height:1.4}",
    ".g2-wrap .g2-eye.off{opacity:.35}",
    ".g2-right{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}",
    ".g2-canvas{flex:1;position:relative;min-height:48px;min-width:48px;overflow:hidden;background:var(--zui-bg-sunken,#1e1e1f)}",
    ".g2-canvas svg{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}",
    ".g2-cv{stroke-linecap:round;stroke-linejoin:round}",
    ".g2-kf{cursor:move;transition:filter .12s}",
    ".g2-kf:hover{filter:brightness(1.35)}",
    ".g2-hdl{cursor:move}",
    ".g2-legend{display:none}",
    ".g2-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}",
    ".g2-empty-card{pointer-events:auto;text-align:center;background:var(--zui-bg,rgba(58,58,60,.95));border:1px solid var(--zui-border-soft,#222224);border-radius:4px;padding:20px 26px;max-width:360px}",
    ".g2-empty-card h3{margin:0 0 6px;font-size:13px;letter-spacing:1.5px;color:var(--zui-text-bright,#ffffff) !important}",
    ".g2-empty-card p{margin:0;font-size:11px;line-height:1.6;color:var(--zui-text,#ffffff) !important}",
    ".g2-empty-card b{color:var(--zui-value,#8ab4ff);font-weight:400}",
    ".g2-tip{position:absolute;pointer-events:none;background:var(--zui-bg-input,rgba(20,20,22,.96));border:1px solid var(--zui-border-soft,#555555);border-radius:4px;padding:6px 9px;font-size:11px;line-height:1.5;display:none;z-index:5;box-shadow:0 6px 18px rgba(0,0,0,.5);color:var(--zui-text,#ffffff) !important}",
    ".g2-status{flex:0 0 auto;flex-shrink:0;display:flex;align-items:center;gap:8px;padding:4px 10px;background:var(--zui-bg-title,#3a3a3c);border-top:1px solid var(--zui-border,#222224);font-size:11px;color:var(--zui-text,#ffffff) !important;flex-wrap:nowrap;overflow:hidden;white-space:nowrap}",
    ".g2-pill{background:rgba(255,255,255,.06);border:1px solid var(--zui-border-soft,#222224);border-radius:3px;padding:2px 10px;color:var(--zui-text-muted,#ffffff) !important;font-variant-numeric:tabular-nums;flex:0 0 auto;max-width:100%}",
    ".g2-status .g2-pill:last-child{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".g2-pill b{color:var(--zui-text-bright,#ffffff);font-weight:400}",
    ".g2-pill.live{border-color:var(--zui-accent,#4a6da7);color:var(--zui-value,#cfe0ff)}",
    ".g2-curve-label{font-weight:700;paint-order:stroke;stroke:var(--zui-bg-sunken,#1e1e1f);stroke-width:3px}",
  ].join("\n");
}

