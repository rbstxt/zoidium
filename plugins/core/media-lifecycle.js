(function (global) {
  "use strict";
  const prototype = global.PZ?.ui?.media?.list?.project?.prototype;
  if (!prototype?.createItem || prototype.__zoidiumMediaCleanup) return;
  const owners = new WeakMap();
  function records(panel) {
    let entries = owners.get(panel);
    if (!entries) { entries = new Map(); owners.set(panel, entries); }
    return entries;
  }
  function capture(record, row) {
    for (const image of row.querySelectorAll("img")) {
      if (image.src?.startsWith("blob:")) record.urls.add(image.src);
    }
  }
  function release(panel, row) {
    const record = owners.get(panel)?.get(row);
    if (!record) return;
    owners.get(panel).delete(row);
    for (const callback of record.callbacks) record.media.onLoaded.unwatch(callback);
    for (const url of record.urls) global.URL.revokeObjectURL(url);
    // Native deletion removes the DOM row but leaves its search record alive.
    const list = panel.fuse?.list;
    if (Array.isArray(list)) for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].el === row) list.splice(i, 1);
    }
  }
  const create = prototype.createItem;
  prototype.createItem = function (media) {
    const observable = media.onLoaded, previous = new Set(observable.watchers);
    const thumbnail = media.thumbnail;
    const row = create.apply(this, arguments);
    const record = { media, callbacks: [], urls: new Set() };
    records(this).set(row, record);
    if (thumbnail instanceof global.Blob) capture(record, row);
    for (let i = 0; i < observable.watchers.length; i++) {
      const original = observable.watchers[i];
      if (previous.has(original)) continue;
      const wrapped = function () {
        const thumbnail = media.thumbnail;
        const result = original.apply(this, arguments);
        if (thumbnail instanceof global.Blob) capture(record, row);
        return result;
      };
      observable.watchers[i] = wrapped;
      record.callbacks.push(wrapped);
    }
    return row;
  };
  const deleted = prototype.mediaDeleted;
  prototype.mediaDeleted = function (_media, index) {
    release(this, this.el.children[index]);
    return deleted.apply(this, arguments);
  };
  const redraw = prototype.redrawList;
  prototype.redrawList = function () {
    for (const row of owners.get(this)?.keys() || []) release(this, row);
    return redraw.apply(this, arguments);
  };
  prototype.__zoidiumMediaCleanup = true;
})(globalThis);
