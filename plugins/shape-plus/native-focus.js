"use strict";
function createFocus(PZ, Content) {
  const focused = new Map();
  const contentTarget = object => {
    for(let node=object,depth=0;node&&depth<64;depth++,node=node.parent?node.parentObject:null)if(node instanceof Content)return true;
    return false;
  };
  function snapshot(objects) {
    const result=new PZ.objectList();
    // Native createKeyframeTrack deliberately returns undefined for static
    // properties; its root-list caller assumes every root produces a track.
    result.push(...Array.from(objects||[]).filter(object=>object && !(object instanceof PZ.property.static)));
    return result;
  }
  function refresh(panel) {
    const timeline=panel.options.keyframePanel;
    if(!timeline)return;
    if(panel.selection.some(contentTarget)) {
      if(!focused.has(panel))focused.set(panel,timeline.objects);
      // Never subscribe the timeline to the live selection list. Native drag
      // selection splices can temporarily contain static property rows.
      timeline.objects=snapshot(panel.selection);
    } else if(focused.has(panel)) {
      const previous=focused.get(panel);focused.delete(panel);
      timeline.objects=previous===panel.selection?snapshot(panel.objects):previous;
    }
  }
  function dispose() {
    for(const [panel,previous]of focused)panel.options.keyframePanel.objects=previous;
    focused.clear();
  }
  return {refresh,dispose,contentTarget};
}
module.exports={createFocus};
