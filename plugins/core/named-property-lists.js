(function installNamedPropertyLists() {
  "use strict";

  if (
    typeof PZ === "undefined" ||
    !PZ.propertyList ||
    !PZ.ui ||
    !PZ.ui.edit ||
    !PZ.ui.edit.prototype ||
    typeof PZ.ui.edit.prototype.generateListItem !== "function"
  ) {
    return;
  }

  var prototype = PZ.ui.edit.prototype;
  if (prototype.generateListItem.__zoidiumNamedPropertyLists) {
    return;
  }

  var originalGenerateListItem = prototype.generateListItem;

  function generateListItem(parent, object, index) {
    var item = originalGenerateListItem.call(this, parent, object, index);
    var categoryName =
      object instanceof PZ.propertyList && object._zoidiumCategoryName;
    if (!item || typeof categoryName !== "string" || !categoryName) {
      return item;
    }

    var labelContainer = item.firstElementChild;
    var label =
      labelContainer && typeof labelContainer.querySelector === "function"
        ? labelContainer.querySelector("span")
        : null;
    if (label) {
      label.innerText = categoryName;
      label.title = categoryName;
    }
    return item;
  }

  generateListItem.__zoidiumNamedPropertyLists = true;
  generateListItem.__zoidiumOriginal = originalGenerateListItem;
  prototype.generateListItem = generateListItem;
})();
