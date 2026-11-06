(function installTreeDropTarget() {
  "use strict";

  if (typeof PZ === "undefined" || !PZ.ui?.edit?.prototype) return;
  const prototype = PZ.ui.edit.prototype;
  if (prototype.itemDragUpdate.__zoidiumTreeDropTarget) return;
  const update = prototype.itemDragUpdate;
  const end = prototype.itemDragEnd;
  const move = prototype.itemDrag;

  // Compare the whole sibling order after removing and reinserting the
  // selected block. Adjacency of the grabbed row alone is insufficient.
  function unchangedOrder(order, items, target, operation) {
    if (!items.length || items.includes(target) || items.some(item => !order.includes(item))) return false;
    const remaining = order.filter(item => !items.includes(item));
    const index = remaining.indexOf(target);
    if (index < 0) return false;
    remaining.splice(index + (operation === 2 ? 1 : 0), 0, ...items);
    return order.length === remaining.length && order.every((item, index) => item === remaining[index]);
  }

  function insideItems(drag) {
    const { target, item, operation, ctx } = drag;
    if ((operation !== 1 && operation !== 2) || !target || target === item || drag.zoidiumCopy) return null;
    const destination = target.nextElementSibling?.pz_object;
    if (!(destination instanceof PZ.objectList)) return null;
    const rows = Array.from(ctx.list.querySelectorAll("li.selected"));
    const items = rows.length ? rows.map(row => row.pz_object) : [item.pz_object];
    const parent = target.parentElement.pz_object;
    if (!(parent instanceof PZ.objectList) || !items.includes(item.pz_object)) return null;
    if (destination instanceof PZ.objectSingleton && (destination.length || items.length !== 1)) return null;
    if (items.some(object => !(object instanceof destination.type) || object.parent !== parent)) return null;
    // Follow ownership rather than DOM nesting, which differs for collapsed rows.
    for (let owner = destination; owner; owner = owner.parent) {
      if (items.includes(owner)) return null;
    }
    return unchangedOrder(Array.from(parent), items, target.pz_object, operation) ? items : null;
  }

  prototype.itemDrag = function (event) {
    this.zoidiumCopy = event.altKey;
    return move.call(this, event);
  };
  function itemDragUpdate() {
    this.zoidiumInsideItems = null;
    const result = update.apply(this, arguments);
    const items = insideItems(this);
    if (!items) return result;
    this.zoidiumInsideItems = items;
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
    const items = this.zoidiumInsideItems;
    if (!items || items.length < 2 || event.altKey) return end.call(this, event);
    // Let CM3 own selection, cleanup and the single history operation. Only
    // expand its move command for the block whose no-op became an inside drop.
    const panel = this.ctx;
    const original = panel.moveObject;
    const descriptor = Object.getOwnPropertyDescriptor(panel, "moveObject");
    const destination = this.target.nextElementSibling.pz_object;
    panel.moveObject = function () {
      for (const object of items) {
        const address = object.getAddress();
        const index = address.pop();
        original.call(this, {
          oldParentAddress: address, oldIdx: index,
          newParentAddress: destination.getAddress(),
        });
      }
    };
    try { return end.call(this, event); }
    finally {
      if (descriptor) Object.defineProperty(panel, "moveObject", descriptor);
      else delete panel.moveObject;
    }
  };
})();
