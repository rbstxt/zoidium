(function installAboutAttributionPatch(global) {
  "use strict";

  var PZ = global.PZ;
  var legacyControls = PZ && PZ.ui && PZ.ui.controls && PZ.ui.controls.legacy;
  if (!legacyControls || typeof legacyControls.generateDescription !== "function") return;
  if (legacyControls.generateDescription.__zoidiumAboutAttributionPatch) return;

  var originalContent =
    'Copyright 2019 Panzoid<br><a target="_blank" href="/about/terms">Terms</a> · ' +
    '<a target="_blank" href="/about/privacy">Privacy</a>';
  var updatedContent =
    'Copyright 2019 Panzoid · Zoidium Extension Tools<br>' +
    '<a target="_blank" href="/about/terms">Terms</a> · ' +
    '<a target="_blank" href="/about/privacy">Privacy</a> · ' +
    '<a target="_blank" href="/about/copyright">Copyright</a> · ' +
    '<a target="_blank" href="/about/acknowledgements">Acknowledgements</a>';
  var originalGenerateDescription = legacyControls.generateDescription;

  function generateDescription(options, context) {
    if (options && options.content === originalContent) {
      options = Object.assign({}, options, { content: updatedContent });
    }
    return originalGenerateDescription.call(this, options, context);
  }

  generateDescription.__zoidiumAboutAttributionPatch = true;
  legacyControls.generateDescription = generateDescription;
})(window);
