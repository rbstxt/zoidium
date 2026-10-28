"use strict";
const { clone } = require("./model.js");
// A contents snapshot includes native key/tween metadata and unknown fields.
// Commands resolve the layer address afresh, so tree replacement never leaves
// undo closures pointing at dead Content/property instances.
function exchange(p) {
  if (p.currentProject() !== p.project) return;
  const current = p.read(true);
  if (!current) return;
  p.write(clone(p.data), true);
  p.history.pushCommand(exchange, { ...p, data: current });
}
function createGesture(history, read, write, notify = () => {}, currentProject = () => undefined) {
  let active = null;
  function begin() {
    if (active || history.operation !== null) return false;
    const before = read();
    if (!before) return false;
    history.startOperation();
    active = { before, operation: history.operation, project: currentProject() };
    return true;
  }
  function finish(cancel = false) {
    const state = active;
    active = null;
    if (!state || currentProject() !== state.project) return;
    const after = read(),
      changed = after && JSON.stringify(after) !== JSON.stringify(state.before);
    // CM3's history does not nest: other code may have replaced or closed this
    // transaction mid-gesture. Never finish or discard another operation; keep
    // the edit, recorded as its own entry when the history is free again.
    if (history.operation !== state.operation) {
      if (changed && cancel) write(clone(state.before));
      else if (changed && history.operation === null) {
        history.startOperation();
        history.pushCommand(exchange, { history, read, write, data: state.before, project: state.project, currentProject });
        history.finishOperation();
      }
      notify();
      return;
    }
    if (cancel || !after || !changed) {
      if (changed) write(clone(state.before));
      history.discardOperation();
    } else {
      history.pushCommand(exchange, {
        history,
        read,
        write,
        data: state.before,
        project: state.project,
        currentProject,
      });
      history.finishOperation();
    }
    notify();
  }
  return {
    begin,
    finish,
    get active() {
      return !!active;
    },
    run(work) {
      if (!begin()) return false;
      try {
        work();
        finish();
        return true;
      } catch (error) {
        finish(true);
        throw error;
      }
    },
  };
}
module.exports = { createGesture };
