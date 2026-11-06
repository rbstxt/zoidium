(function (global) {
  "use strict";
  var builder = global.ZoidiumUIBuilder = global.ZoidiumUIBuilder || {};
  var activeDrags = new Map(), pickers = new Set();
  function foreign(element) { return element && element.ownerDocument && element.ownerDocument !== global.document; }
  function settle(root) {
    pickers.forEach(function (picker) { if (root.contains(picker.el) && picker.picker) picker.close(); });
    activeDrags.forEach(function (entry, drag) { if (root.contains(entry.element)) entry.finish(); });
  }
  var ui = global.PZ && global.PZ.ui;
  if (ui && ui.drag) {
    var drag = ui.drag.prototype;
    var start = drag.startDragging, update = drag.updatefn, stop = drag.stopDragging;
    drag.startDragging = function (context, event) {
      if (!foreign(event.currentTarget)) return start.apply(this, arguments);
      var self = this, element = event.currentTarget, doc = element.ownerDocument, view = doc.defaultView;
      this.__zoidiumPopupView = view;
      start.apply(this, arguments);
      if (this.reqId) {
        global.cancelAnimationFrame(this.reqId);
        this.reqId = view.requestAnimationFrame(this.updatefn_bound);
      }
      function finish() {
        if (self.dragging && self.endfn_bound) self.endfn_bound({ type: "mouseup", currentTarget: doc, preventDefault: function () {} });
      }
      activeDrags.set(this, { element: element, finish: finish, view: view });
      view.addEventListener("blur", finish);
      this.__zoidiumPopupFinish = finish;
    };
    drag.updatefn = function (context) {
      var view = this.__zoidiumPopupView;
      if (!view) return update.apply(this, arguments);
      this.update.call(context);
      this.reqId = view.requestAnimationFrame(this.updatefn_bound);
    };
    drag.stopDragging = function () {
      var view = this.__zoidiumPopupView;
      if (view) {
        if (this.reqId) view.cancelAnimationFrame(this.reqId);
        this.reqId = 0;
        view.removeEventListener("blur", this.__zoidiumPopupFinish);
        delete this.__zoidiumPopupView; delete this.__zoidiumPopupFinish;
        activeDrags.delete(this);
      }
      return stop.apply(this, arguments);
    };
  }
  if (ui && ui.input) {
    var input = ui.input.prototype, focus = input.focus, blur = input.blur;
    input.focus = function () {
      if (!foreign(this.el)) return focus.apply(this, arguments);
      this.editing = true;
      this.initialValue = parseFloat(this.el.innerText);
      this.el.classList.add("edit"); this.el.classList.remove("noselect");
      var range = this.el.ownerDocument.createRange(); range.selectNodeContents(this.el);
      var selection = this.el.ownerDocument.defaultView.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      this.editStart.call(this.el, this.noLink); delete this.noLink;
    };
    input.blur = function () {
      if (!foreign(this.el)) return blur.apply(this, arguments);
      this.editing = false;
      this.el.classList.remove("edit"); this.el.classList.add("noselect");
      this.el.ownerDocument.defaultView.getSelection().removeAllRanges();
      var value = parseFloat(this.el.innerText);
      this.setValue(Number.isNaN(value) ? this.initialValue : value);
      this.editFinish.call(this.el, this.value === this.initialValue);
    };
  }
  if (ui && ui.colorPicker) {
    var color = ui.colorPicker.prototype, open = color.open, close = color.close;
    color.open = function () {
      var result = open.apply(this, arguments);
      if (!foreign(this.el) || !this.picker) return result;
      var panel = this.picker;
      panel.removeEventListener("focusout", panel.pz_focusout);
      this.el.ownerDocument.body.appendChild(panel);
      panel.addEventListener("focusout", panel.pz_focusout);
      panel.classList.add("zoidium-color-picker", "zoidium-window-color-picker");
      this.positionPicker(); panel.focus(); pickers.add(this);
      return result;
    };
    color.close = function () { pickers.delete(this); return close.apply(this, arguments); };
  }
  builder.popupControls = { settle: settle };
})(window);
