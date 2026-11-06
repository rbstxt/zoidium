(function installTreeDropTarget() {
  "use strict";

  if (typeof PZ === "undefined" || !PZ.ui?.edit?.prototype) return;
  const prototype = PZ.ui.edit.prototype;
  if (prototype.itemDragUpdate.__zoidiumTreeDropTarget) return;
  const update = prototype.itemDragUpdate;
  const end = prototype.itemDragEnd;
  const move = prototype.itemDrag;

  // CM3 moves only the grabbed row, even with several rows selected, so only
  // that row decides whether a before or after drop would change the order.
  function keepsOrder(drag) {
    const { target, item, operation } = drag;
    const siblings = Array.from(target.parentElement.pz_object);
    const itemIndex = siblings.indexOf(item.pz_object);
    const targetIndex = siblings.indexOf(target.pz_object);
    if (itemIndex < 0 || targetIndex < 0) return false;
    return itemIndex === targetIndex + (operation === 1 ? -1 : 1);
  }

  function shouldMoveInside(drag) {
    const { target, item, operation, indicatorEl } = drag;
    if ((operation !== 1 && operation !== 2) || drag.zoidiumCopy) return false;
    // The native after indicator sits between the row and its child list.
    const next = target.nextElementSibling;
    const destination = (next === indicatorEl ? next.nextElementSibling : next)?.pz_object;
    if (!(destination instanceof PZ.objectList)) return false;
    if (!(item.pz_object instanceof destination.type)) return false;
    if (destination instanceof PZ.objectSingleton && destination.length) return false;
    return keepsOrder(drag);
  }

  prototype.itemDrag = function (event) {
    this.zoidiumCopy = event.altKey;
    return move.call(this, event);
  };
  function itemDragUpdate() {
    this.zoidiumNativeOperation = 0;
    const result = update.apply(this, arguments);
    if (!shouldMoveInside(this)) return result;
    this.zoidiumNativeOperation = this.operation;
    this.target.parentElement.insertBefore(this.indicatorEl, this.target);
    const height = this.target.offsetHeight;
    this.indicatorEl.style.height = height + "px";
    this.indicatorEl.style.marginTop = -height + "px";
    this.indicatorEl.style.top = height + "px";
    this.operation = 3;
    return result;
  }
  itemDragUpdate.__zoidiumTreeDropTarget = true;
  prototype.itemDragUpdate = itemDragUpdate;
  prototype.itemDragEnd = function (event) {
    // Alt copies, and a copy beside the row is a real change. Alt can go down
    // after the last pointer move, so undo the redirect at release too.
    if (event.altKey && this.zoidiumNativeOperation) this.operation = this.zoidiumNativeOperation;
    return end.call(this, event);
  };
})();
