(function (global) {
  "use strict";

  var prototype = global.PZ?.ui?.timeline?.prototype;
  if (!prototype || typeof prototype.create !== "function") return;
  var originalCreate = prototype.create;
  prototype.create = function () {
    var result = originalCreate.apply(this, arguments);
    var timeline = this;
    if (timeline.timerule_drag) {
      timeline.timerule_drag.move = function (event) {
        var ruler = timeline.timerule;
        var rect = ruler.getBoundingClientRect();
        var scale = rect.width / ruler.clientWidth;
        this.currentPt = (event.clientX - rect.left) / (scale || 1);
      };
    }
    return result;
  };
})(window);
