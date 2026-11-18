"use strict";

// Motion analysis follows the pixels CM3 actually renders. Player+ owns the
// preview size, so ZSMB must not choose a size of its own. An export renders
// at its output size, which can differ from the project resolution, and must
// not depend on the preview quality: every export uses full analysis.
//
// A one-pixel tolerance absorbs the independent rounding of the fitted
// viewport and the device pixel ratio, so a frame that fills the project is
// not treated as reduced.
const FULL_SIZE_TOLERANCE = 1;

function chooseAnalysisMode({ width, height, projectWidth, projectHeight, exporting } = {}) {
  if (exporting) return "full";
  if (!(width > 0) || !(height > 0)) return "full";
  if (!(projectWidth > 0) || !(projectHeight > 0)) return "full";
  return width + FULL_SIZE_TOLERANCE >= projectWidth &&
    height + FULL_SIZE_TOLERANCE >= projectHeight ? "full" : "half";
}

module.exports = { chooseAnalysisMode };
