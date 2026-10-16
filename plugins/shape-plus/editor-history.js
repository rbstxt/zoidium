"use strict";
const { clone } = require("./model.js");
// A contents snapshot includes native key/tween metadata and unknown fields.
// Commands resolve the layer address afresh, so tree replacement never leaves
// undo closures pointing at dead Content/property instances.
function exchange(p) {
  const current=p.read();
  if (!current) return;
  p.write(clone(p.data));
  p.history.pushCommand(exchange,{...p,data:current});
}
function createGesture(history, read, write, notify = () => {}) {
  let active=null;
  function begin() {
    if (active || history.operation !== null) return false;
    const before=read();if(!before)return false;
    history.startOperation();active={before,operation:history.operation};return true;
  }
  function finish(cancel=false) {
    const state=active;active=null;if(!state)return;
    // Never finish another editor's operation if the target changed mid-drag.
    if(history.operation!==state.operation)return;
    const after=read(), changed=after && JSON.stringify(after)!==JSON.stringify(state.before);
    if(cancel || !after || !changed) {
      if(changed)write(clone(state.before));
      history.discardOperation();
    } else {
      history.pushCommand(exchange,{history,read,write,data:state.before});
      history.finishOperation();
    }
    notify();
  }
  return {begin,finish,get active(){return !!active;},run(work) {
    if(!begin())return false;
    try {work();finish();return true;}catch(error){finish(true);throw error;}
  }};
}
module.exports={createGesture};
