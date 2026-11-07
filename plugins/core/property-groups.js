(function (global) {
  "use strict";
  function install(PZ) {
    const FIELD = "zoidiumPropertyGroup", locks = new WeakMap();
    const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const meta = p => p.definition?.[FIELD] || {};
    const name = p => String(meta(p).name ?? p.definition?.zoidiumShader?.group ?? "").trim();
    const isList = list => list instanceof PZ.objectList && list.parent?.customProperties === list;
    const members = (list, group) => Array.from(list).filter(p => name(p) === group);
    const locked = (list, group) => !!group && members(list, group).some(p => meta(p).locked === true);
    function blocks(list) {
      const ordered = Array.from(list).map((p, index) => ({ p, order: Number.isFinite(meta(p).order) ? meta(p).order : index }))
        .sort((a, b) => a.order - b.order).map(entry => entry.p);
      const result = [], groups = new Map();
      for (const p of ordered) {
        const group = name(p);
        if (!group) { result.push({ name: "", items: [p] }); continue; }
        let block = groups.get(group);
        if (!block) { block = { name: group, items: [] }; groups.set(group, block); result.push(block); }
        block.items.push(p);
      }
      return result;
    }
    function snapshot(list) {
      return Array.from(list, p => ({ meta: copy(p.definition[FIELD]),
        shader: copy(p.definition.zoidiumShader) }));
    }
    function apply(list, state) {
      state.forEach((record, index) => {
        const d = list[index].definition;
        for (const [key, value] of [[FIELD, record.meta], ["zoidiumShader", record.shader]]) {
          if (value === undefined) delete d[key]; else d[key] = copy(value);
        }
      });
    }
    function notify(editor) {
      editor.project.ui?.onChanged?.update();
      api.refresh?.();
    }
    function exchange(editor, command) {
      const list = editor.project.addressLookup(command.address), previous = snapshot(list);
      apply(list, command.state);
      editor.history.pushCommand(next => exchange(editor, next), { address: command.address, state: previous });
      notify(editor);
    }
    function edit(editor, list, change) {
      if (editor.history.operation !== null) return false;
      const before = snapshot(list), next = copy(before);
      change(next);
      if (JSON.stringify(before) === JSON.stringify(next)) return false;
      editor.history.startOperation();
      try {
        apply(list, next);
        editor.history.pushCommand(command => exchange(editor, command), { address: list.getAddress(), state: before });
        editor.history.finishOperation();
      } catch (error) { apply(list, before); editor.history.discardOperation(); throw error; }
      notify(editor); return true;
    }
    function assign(record, group) {
      record.meta = { ...record.meta, name: group };
      if (record.shader?.group !== undefined) record.shader.group = group;
    }
    function canAssign(p, group) {
      const list = p.parent;
      return isList(list) && !locked(list, name(p)) && !locked(list, group);
    }
    function setGroup(editor, p, group) {
      group = String(group).trim();
      if (!canAssign(p, group)) return false;
      return edit(editor, p.parent, state => assign(state[p.parent.indexOf(p)], group));
    }
    function settings(editor, list, group, next) {
      const label = String(next.name).trim();
      if (!label || label !== group && members(list, label).length) return false;
      return edit(editor, list, state => {
        for (const p of members(list, group)) {
          const record = state[list.indexOf(p)]; assign(record, label);
          record.meta.locked = !!next.locked;
        }
      });
    }
    function collapse(editor, list, group) {
      const collapsed = !members(list, group).some(p => meta(p).collapsed);
      return edit(editor, list, state => {
        for (const p of members(list, group)) state[list.indexOf(p)].meta = { ...meta(p), collapsed };
      });
    }
    // Only metadata changes. Native list indices remain the addresses used by
    // animation, shader uniforms, saved properties, and history commands.
    function move(editor, list, moving, target, after = false) {
      const sourceGroup = typeof moving === "string" ? moving : name(moving);
      const targetGroup = typeof target === "string" ? target : target ? name(target) : "";
      if (locked(list, sourceGroup) || locked(list, targetGroup)) return false;
      const movingGroup = typeof moving === "string";
      const picked = movingGroup ? members(list, moving) : [moving];
      if (!picked.length || picked.some(p => p.parent !== list) || picked.includes(target) || moving === target) return false;
      const order = blocks(list).flatMap(block => block.items).filter(p => !picked.includes(p));
      const targets = typeof target === "string" ? members(list, target).filter(p => !picked.includes(p)) : target ? [target] : [];
      let index = targets.length ? order.indexOf(after ? targets[targets.length - 1] : targets[0]) : order.length;
      if (index < 0) return false;
      if (after && targets.length) index++;
      // A group drops beside another complete group, never inside its rows.
      if (movingGroup && targetGroup) {
        const peers = members(list, targetGroup).filter(p => !picked.includes(p));
        index = order.indexOf(after ? peers[peers.length - 1] : peers[0]) + (after ? 1 : 0);
      }
      order.splice(index, 0, ...picked);
      return edit(editor, list, state => {
        if (!movingGroup) assign(state[list.indexOf(moving)], targetGroup);
        order.forEach((p, i) => { const record = state[list.indexOf(p)]; record.meta = { ...record.meta, order: i }; });
      });
    }
    const nativeGroup = PZ.object3d?.group?.prototype;
    if (nativeGroup) {
      const load = nativeGroup.load, toJSON = nativeGroup.toJSON;
      nativeGroup.load = function (data) { locks.set(this, data?.zoidiumGroupLocked === true); return load.apply(this, arguments); };
      nativeGroup.toJSON = function () { const data = toJSON.apply(this, arguments); if (locks.get(this)) data.zoidiumGroupLocked = true; return data; };
    }
    function setNativeLock(editor, group, value) {
      if (editor.history.operation !== null || locks.get(group) === !!value) return false;
      const exchangeLock = command => {
        const object = editor.project.addressLookup(command.address), previous = !!locks.get(object);
        locks.set(object, command.value);
        editor.history.pushCommand(exchangeLock, { address: command.address, value: previous }); notify(editor);
      };
      editor.history.startOperation(); exchangeLock({ address: group.getAddress(), value: !!value }); editor.history.finishOperation(); return true;
    }
    function nativeLocked(object) {
      for (let node = object; node; node = node.parent) if (locks.get(node)) return true;
      return false;
    }
    const api = { FIELD, meta, name, isList, members, locked, blocks, snapshot, edit, canAssign, setGroup, settings, collapse, move,
      nativeLocked, setNativeLock, nativeOwnLock: object => !!locks.get(object) };
    return api;
  }
  if (typeof module === "object" && module.exports) module.exports = { install };
  else {
    global.PZ.zoidium = global.PZ.zoidium || {};
    global.PZ.zoidium.propertyGroups = install(global.PZ);
  }
})(typeof window !== "undefined" ? window : globalThis);
