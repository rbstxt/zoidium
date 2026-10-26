(function installSequenceTiming(global) {
  "use strict";

  const prototype = PZ.ui?.properties?.prototype;
  if (!prototype || prototype.__zoidiumSequenceTiming) return;
  const originalSetValue = prototype.setValue;
  const clone = value => JSON.parse(JSON.stringify(value));

  // These values are durations in sequence frames. Media Time values are
  // seconds; FPS, shutter fractions, sample counts, and seeds keep their units.
  function isDuration(owner, field) {
    return owner?.type === "echo" && field === "delay" ||
      owner?.type === "timeoffset" && field === "offset" ||
      field === "delayPerCharacter" && (owner?.type === 7 ||
        String(owner?.type).startsWith("zoidium:text-plus/"));
  }

  function walk(node, visit, owner = null, field = null, seen = new Set()) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (node instanceof PZ.propertyList) {
      for (const key of Object.keys(node)) walk(node[key], visit, owner, key, seen);
    } else if (Array.isArray(node)) {
      for (const child of node) walk(child, visit, owner, field, seen);
    } else {
      const property = node instanceof PZ.property;
      if (!property) owner = node;
      visit(node, owner, field);
      for (const child of node.children || []) {
        // Precomp's objects list contains disposable render clones. The
        // authored composition data is handled through its timing adapter.
        if (node.compId && child === node.objects) continue;
        walk(child, visit, owner, field, seen);
      }
    }
  }

  function capture(editor) {
    const sequence = editor.sequence;
    const records = [];
    walk(sequence, (node, owner, field) => {
      if (node instanceof PZ.clip) {
        const values = { start: node.start, length: node.length };
        if (Number.isFinite(node.offset)) values.offset = node.offset;
        records.push({ kind: "clip", address: node.getAddress(), values });
      } else if (node.compId && Number.isFinite(node.offset)) {
        records.push({ kind: "offset", address: node.getAddress(), values: { offset: node.offset } });
      } else if (node instanceof PZ.property.dynamic.keyframes) {
        records.push({ kind: "keys", address: node.getAddress(), duration: isDuration(owner, field),
          keys: Array.from(node.keyframes, key => ({ frame: key.frame,
            controlPoints: clone(key.controlPoints), ...(isDuration(owner, field) ? { value: key.value } : {}) })) });
      } else if (node instanceof PZ.property.static && isDuration(owner, field)) {
        records.push({ kind: "value", address: node.getAddress(), values: { value: node.get() } });
      }
    });
    return { rate: sequence.properties.rate.get(), length: sequence.length, records,
      // Playback rounds its visible frame, but keeps the exact seek internally.
      frame: editor.playback?._exactFrame ?? editor.playback?.currentFrame ?? 0,
      stored: clone(PZ.precomp?.timingState?.(editor.project) || []) };
  }

  function scaleKeys(keys, ratio, duration) {
    for (const key of keys) {
      key.frame *= ratio;
      key.controlPoints ||= [[-10, 0], [10, 0]];
      for (const point of key.controlPoints) {
        point[0] *= ratio;
        if (duration) point[1] *= ratio;
      }
      if (duration && Number.isFinite(key.value)) key.value *= ratio;
    }
  }

  function scaleClip(values, ratio) {
    const start = values.start * ratio;
    // Scale shared boundaries, so adjacent clips keep the same boundary.
    values.length = (values.start + values.length) * ratio - start;
    values.start = start;
    if (Number.isFinite(values.offset)) values.offset *= ratio;
  }

  function scaleStored(node, ratio, owner = null, field = null) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) scaleStored(child, ratio, owner, field);
      return;
    }
    if (typeof node.type === "number" || typeof node.type === "string") owner = node;
    if (node.object && Number.isFinite(node.start) && Number.isFinite(node.length)) scaleClip(node, ratio);
    if (node.compId && Number.isFinite(node.offset)) node.offset *= ratio;
    if (Array.isArray(node.keyframes)) scaleKeys(node.keyframes, ratio, isDuration(owner, field));
    if (isDuration(owner, field) && Number.isFinite(node.value)) node.value *= ratio;
    if (node.videoTracks && node.audioTracks && Number.isFinite(node.length)) {
      node.length *= ratio;
      node.properties.rate *= ratio;
    }
    for (const key of Object.keys(node)) {
      if (key === "keyframes") continue;
      // Property values can hold paths, gradients, or user JSON. Their numbers
      // are not frame positions and must never be interpreted as a timeline.
      if (key === "value") continue;
      const child = node[key];
      // Expressions+ stores its authored sequence controls in a JSON string.
      // Decode only this declared field, never arbitrary text or expressions.
      if (key === "zoidiumControls" && typeof child === "string" && child) {
        try {
          const controls = JSON.parse(child);
          scaleStored(controls, ratio);
          node[key] = JSON.stringify(controls);
        } catch (_error) { /* Invalid plugin metadata stays available for repair. */ }
      } else if (isDuration(owner, key) && Number.isFinite(child)) node[key] *= ratio;
      else scaleStored(child, ratio, owner, key === "properties" ? null : key);
    }
  }

  function scaled(before, newRate) {
    const after = clone(before), ratio = newRate / before.rate;
    after.rate = newRate;
    after.length *= ratio;
    after.frame *= ratio;
    for (const record of after.records) {
      if (record.kind === "keys") scaleKeys(record.keys, ratio, record.duration);
      else if (record.kind === "clip") scaleClip(record.values, ratio);
      else for (const key of Object.keys(record.values)) record.values[key] *= ratio;
    }
    for (const root of after.stored) scaleStored(root.data, ratio);
    return after;
  }

  function apply(editor, state) {
    const sequence = editor.sequence, changed = [];
    sequence.properties.rate.set(state.rate);
    for (const record of state.records) {
      const node = editor.project.addressLookup(record.address);
      if (record.kind === "keys") {
        for (let i = 0; i < record.keys.length; i++) {
          const key = node.keyframes[i], saved = record.keys[i];
          const oldFrame = key.frame;
          key.frame = saved.frame;
          key.controlPoints = clone(saved.controlPoints);
          if (record.duration) key.value = saved.value;
          changed.push(() => {
            node.onKeyframeMoved.update({ property: record.address, oldFrame, newFrame: key.frame }, key);
            node.onKeyframeChanged.update(key);
          });
        }
      } else if (record.kind === "value") node.set(record.values.value);
      else Object.assign(node, record.values);
    }
    PZ.precomp?.restoreTimingState?.(editor.project, clone(state.stored));
    // Rebuild schedules only after all authored times and composition caches
    // agree. Do not reload the sequence or discard selections and history.
    PZ.schedule.analyzeSequence(sequence);
    sequence.length = state.length;
    if (editor.playback) editor.playback.currentFrame = state.frame;
    for (const notify of changed) notify();
    for (const [type, tracks] of [[0, sequence.videoTracks], [1, sequence.audioTracks]]) {
      tracks.forEach((track, index) => track.clips.forEach((_clip, clipIndex) => {
        sequence.ui.onClipMoved.update({ type, oldTrackIdx: index, newTrackIdx: index,
          oldIdx: clipIndex, newIdx: clipIndex });
      }));
    }
  }

  function restore({ editor, state, inverse }) {
    apply(editor, state);
    editor.history.pushCommand(restore, { editor, state: inverse, inverse: state });
  }

  function notify(editor, operation) {
    global.ZoidiumUI?.notify({ title: "Frame rate changed. Timing kept in seconds.",
      message: "Expressions that use frame keep their per-frame meaning.",
      action: { label: "Undo", run() {
        const history = editor.history, stack = history.undoStack;
        const latest = stack.stack[(stack.idx - 1 + stack.stack.length) % stack.stack.length];
        if (editor.project === history.project && stack.length && latest === operation) history.undo();
        else global.ZoidiumUI?.notify({ title: "Use Undo from the editor.",
          message: "Undo later edits before undoing the frame rate change." });
      } } });
  }

  prototype.setValue = function setValueWithTiming(params) {
    const editor = this.editor, sequence = editor.sequence;
    const property = editor.project.addressLookup(params.property);
    if (property !== sequence?.properties.rate) return originalSetValue.apply(this, arguments);
    const oldRate = params.oldValue ?? property.get();
    const newRate = params.value ?? property.get();
    if (!Number.isFinite(oldRate) || oldRate <= 0 || !Number.isFinite(newRate) || newRate <= 0 || oldRate === newRate) {
      return originalSetValue.apply(this, arguments);
    }
    const before = capture(editor);
    before.rate = oldRate;
    const after = scaled(before, newRate);
    const ownsOperation = editor.history.operation === null;
    if (ownsOperation) editor.history.startOperation();
    const operation = editor.history.operation;
    restore({ editor, state: after, inverse: before });
    if (ownsOperation) editor.history.finishOperation();
    // Native controls also call setValue before discarding a cancelled edit.
    // Wait for the operation to commit before showing its notice.
    Promise.resolve().then(() => {
      const stack = editor.history.undoStack;
      if (stack.length && stack.stack[(stack.idx - 1 + stack.stack.length) % stack.stack.length] === operation) {
        notify(editor, operation);
      }
    });
  };
  prototype.__zoidiumSequenceTiming = true;
})(window);
