(function (global) {
  "use strict";
  const playback = global.PZ?.ui?.playback?.prototype;
  if (playback?.scheduleCreated && playback.scheduleUnloaded && !playback.__zoidiumMediaCleanup) {
    const idleByContext = new WeakMap();
    const created = playback.scheduleCreated, unloaded = playback.scheduleUnloaded;
    function idle(context) {
      let entries = idleByContext.get(context);
      if (!entries) {
        entries = []; idleByContext.set(context, entries);
        context.addEventListener?.("statechange", () => { if (context.state === "closed") entries.length = 0; });
      }
      return entries;
    }
    playback.scheduleCreated = function (schedule) {
      const entry = schedule.type === 1 && idle(this.audioCtx).pop();
      if (!entry) return created.apply(this, arguments);
      // Web Audio keeps media-element source nodes alive until context close.
      // Reuse their empty elements instead of allocating on every clip edit.
      schedule.el = entry.el;
      const context = this.audioCtx, descriptor = Object.getOwnPropertyDescriptor(context, "createMediaElementSource");
      const factory = context.createMediaElementSource;
      context.createMediaElementSource = function (element) {
        return element === entry.el ? entry.source : factory.apply(this, arguments);
      };
      try { return created.apply(this, arguments); }
      catch (error) { idle(context).push(entry); throw error; }
      finally {
        if (descriptor) Object.defineProperty(context, "createMediaElementSource", descriptor);
        else delete context.createMediaElementSource;
      }
    };
    playback.scheduleUnloaded = function (schedule) {
      const result = unloaded.apply(this, arguments);
      if (schedule.type === 1 && schedule.sourceNode) {
        idle(this.audioCtx).push({ el: schedule.el, source: schedule.sourceNode });
        schedule.sourceNode = schedule.gainNode = schedule.panNode = null;
      }
      return result;
    };
    playback.__zoidiumMediaCleanup = true;
  }
  const schedule = global.PZ?.schedule?.prototype;
  if (schedule?.unload && !schedule.__zoidiumMediaCleanup) {
    const unload = schedule.unload;
    schedule.unload = function () {
      const result = unload.apply(this, arguments);
      if (this.type === 1 && this.el) {
        // Disconnecting an audio graph leaves its media decoder active.
        // Reset the retired element without revoking the shared asset URL.
        this.el.pause();
        this.el.removeAttribute("src");
        this.el.load();
        this.playing = false;
      }
      return result;
    };
    schedule.__zoidiumMediaCleanup = true;
  }
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
