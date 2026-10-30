"use strict";

const pointer = require("./pointer.js");
const theme = require("./theme.js");
const { controllers } = require("./selection.js");

module.exports = function gpDefineGraphEditor(PZ) {
if (!PZ || !PZ.ui) throw new Error("Graph Editor 2 needs the CM3 user interface (PZ.ui).");
const environment = Object.assign({ PZ, SVGNS: "http://www.w3.org/2000/svg" },
  require("./editor-helpers.js")(PZ), pointer, theme);
const GraphGrid = require("./editor-core.js")(environment);
require("./toolbar.js")(environment);
require("./canvas.js")(environment);
require("./interaction.js")(environment);
require("./curves.js")(environment);
require("./operations.js")(environment);
require("./axes.js")(environment);
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
  if (self.el && self.el.classList) {
    self.el.classList.add("zoidium-editor-window");
    self.el.classList.add("g2-editor");
  }
  self.title = "Graph editor";
  self.icon = "project";
  PZ.observable.defineObservableProp(self, "objects", "onObjectsChanged");
  self.objects = null;
  self.onObjectsChanged.watch(function () { left.objects = self.objects; });
  self._left = left; self._right = right;
  right._selectionPanel = self;
  controllers.get(editor)?.attach(self);
  void opts;
  return self;
};
PZ.ui.graphEditor.prototype = Object.create(PZ.ui.splitPanel.prototype);
PZ.ui.graphEditor.prototype.constructor = PZ.ui.graphEditor;

return { graph: PZ.ui.graph, grid: PZ.ui.graph.grid, graphEditor: PZ.ui.graphEditor };
}
;
