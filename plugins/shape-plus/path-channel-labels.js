"use strict";
// CM3 uses definition.name as a keyframe clipboard key. Keep it intact and
// replace only the text and tooltip on the native property and timeline rows.
function install(PZ) {
  const edit = PZ.ui.edit.prototype, timeline = PZ.ui.timeline.keyframes.prototype;
  const originalEdit = edit.generateListItem, originalTrack = timeline.createKeyframeTrack;
  function display(label, object) {
    const text = object?.definition?.zoidiumPathLabel;
    if (label && text) { label.textContent = text; label.title = text; }
  }
  function generateListItem(parent, object, index) {
    const row = originalEdit.call(this, parent, object, index);
    const label = Array.from(row?.firstElementChild?.children || []).find(child => child.tagName === "SPAN");
    display(label, object);
    return row;
  }
  function createKeyframeTrack(parent, object) {
    const track = originalTrack.call(this, parent, object);
    display(track?.pz_label, object);
    return track;
  }
  edit.generateListItem = generateListItem;
  timeline.createKeyframeTrack = createKeyframeTrack;
  return () => {
    if (edit.generateListItem === generateListItem) edit.generateListItem = originalEdit;
    if (timeline.createKeyframeTrack === createKeyframeTrack) timeline.createKeyframeTrack = originalTrack;
  };
}
module.exports = { install };
