(function (global) {
  "use strict";

  var prototype = global.PZ?.ui?.timeline?.keyframes?.prototype;
  if (!prototype || typeof prototype.initProxies !== "function") return;
  var original = prototype.initProxies;
  prototype.initProxies = function () {
    var seen = new Set();
    var selected = this.ctx.container.querySelectorAll(".kfobject.selected");
    for (var node of selected) {
      if (seen.has(node.pz_object)) node.classList.remove("selected");
      else seen.add(node.pz_object);
    }
    return original.apply(this, arguments);
  };
})(window);
