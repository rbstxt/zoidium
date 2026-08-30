(function (global) {
  "use strict";

  // Remove the ad panel from Panzoid's split tree instead of only hiding its
  // contents. This keeps the full editor viewport available in offline mode.
  var PZ = global.PZ;
  if (!PZ || !PZ.ui || typeof PZ.ui.ad !== "function" || typeof PZ.ui.splitPanel !== "function") return;

  var Ad = PZ.ui.ad;
  var SplitPanel = PZ.ui.splitPanel;
  var AdFreeSplitPanel = function (editor, first, second, ratio, direction) {
    if (first instanceof Ad) return second;
    if (second instanceof Ad) return first;
    return new SplitPanel(editor, first, second, ratio, direction);
  };
  AdFreeSplitPanel.prototype = SplitPanel.prototype;
  PZ.ui.splitPanel = AdFreeSplitPanel;
})(window);
