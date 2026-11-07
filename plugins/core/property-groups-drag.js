(function (global) {
  "use strict";
  const PZ = global.PZ, api = PZ?.zoidium?.propertyGroups, prototype = PZ?.ui?.edit?.prototype;
  if (!api || !prototype) return;
  const start = prototype.itemDragStart, update = prototype.itemDragUpdate, end = prototype.itemDragEnd;
  function listOf(row) { return row?.zpg?.list || row?.pz_object?.parent; }
  function targetOf(node) {
    for (let count = 0; node && count < 6; node = node.parentElement, count++) {
      if (node.zpg || node.tagName === "LI") return node;
    }
    return null;
  }
  function destination(drag) {
    if (drag.operation === 3) {
      let next = drag.target?.nextElementSibling;
      if (next === drag.indicatorEl) next = next.nextElementSibling;
      return next?.pz_object;
    }
    return drag.target?.parentElement?.pz_object;
  }
  function nativeBlocked(drag) {
    return api.nativeLocked(drag.item?.pz_object) || api.nativeLocked(destination(drag)) ||
      api.propertyLocked(drag.item?.pz_object) || api.propertyLocked(destination(drag));
  }
  function cancel(drag) { drag.operation = 0; drag.indicatorEl?.remove(); }
  prototype.itemDragStart = function (event) {
    this.zpgHandled = false; this.zpgDrop = null;
    if (event.currentTarget.zpg) {
      if (event.target.closest(".zpg-settings-button")) return false;
      this.item = event.currentTarget;
      if (api.locked(this.item.zpg.list, this.item.zpg.name)) return false;
      this.startPt = event.pageY; this.moved = false;
      this.indicatorEl = event.currentTarget.ownerDocument.createElement("div");
      this.operation = 0; return;
    }
    return start.apply(this, arguments);
  };
  prototype.itemDragUpdate = function () {
    const list = listOf(this.item), target = targetOf(this.target);
    const ownList = target?.pz_object === list || target?.nextElementSibling?.pz_object === list;
    const organized = api.isList(list) && Array.from(list).some(p => api.name(p) || Number.isFinite(api.meta(p).order));
    const custom = organized && (this.item.zpg || target?.zpg || listOf(target) === list || ownList);
    if (!custom) {
      const result = update.apply(this, arguments);
      if (nativeBlocked(this) || api.isList(list) && api.locked(list, api.name(this.item.pz_object)) ||
          api.isList(destination(this)) && api.locked(destination(this), api.name(this.target?.pz_object))) cancel(this);
      return result;
    }
    this.zpgHandled = true; cancel(this); this.zpgDrop = null;
    if (!this.moved && Math.abs(this.currentPt - this.startPt) < 5) return;
    this.moved = true;
    if (!target || !ownList && listOf(target) !== list || target === this.item) return;
    const moving = this.item.zpg?.name || this.item.pz_object, destinationGroup = ownList ? "" : target.zpg?.name || api.name(target.pz_object);
    if (api.locked(list, typeof moving === "string" ? moving : api.name(moving)) || api.locked(list, destinationGroup)) return;
    const rect = target.getBoundingClientRect(), after = this.currentPt > rect.top + target.ownerDocument.defaultView.scrollY + rect.height / 2;
    this.zpgDrop = { list, moving, target: ownList ? null : target.zpg?.name || target.pz_object, after };
    this.indicatorEl.style.cssText = "height:2px;margin-top:-2px;position:relative;pointer-events:none;background:var(--zui-value)";
    target.parentElement.insertBefore(this.indicatorEl, after ? target.nextElementSibling : target);
  };
  prototype.itemDragEnd = function (event) {
    if (this.zpgHandled || this.item?.zpg) {
      this.indicatorEl?.remove(); this.operation = 0;
      if (this.ctx.columnAdjust) this.ctx.columnAdjust.style.pointerEvents = "";
      this.ctx.selectItems();
      if (this.moved && this.zpgDrop && event.type !== "keydown") {
        const { list, moving, target, after } = this.zpgDrop;
        if (event.altKey && typeof moving !== "string") api.duplicate(this.ctx.editor, this.ctx, list, moving, target, after);
        else if (!event.altKey) api.move(this.ctx.editor, list, moving, target, after);
      }
      if (!this.item.zpg && !this.moved) return end.apply(this, arguments);
      if (this.item.zpg && this.moved) this.item.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true, once: true });
      this.zpgDrop = null; return;
    }
    if (nativeBlocked(this)) cancel(this);
    const list = destination(this), target = this.target?.pz_object;
    if (api.isList(list) && this.item?.pz_object?.parent !== list && target?.parent === list &&
        (this.operation === 1 || this.operation === 2)) {
      const view = this.ctx, move = view.moveObject, create = view.createObject, after = this.operation === 2;
      const index = list.indexOf(target) + (after ? 1 : 0);
      view.moveObject = function (command) { return move.call(this, { ...command, newIdx: index }); };
      view.createObject = function (command) { return create.call(this, { ...command, newIdx: index }); };
      try { return end.apply(this, arguments); }
      finally { view.moveObject = move; view.createObject = create; }
    }
    return end.apply(this, arguments);
  };
})(window);
