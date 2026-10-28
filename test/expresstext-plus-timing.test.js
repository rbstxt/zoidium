'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {fixture, ROOT} = require('./helpers/expresstext-host.cjs');
const {editorFor} = require(path.join(ROOT, 'test/helpers/editor-identity-host.cjs'));

test('changing 30 fps to 60 fps preserves ExpressText stagger duration in seconds', () => {
  const h = fixture();
  try {
    const {PZ, project, container} = h;
    project.sequence.properties.load();
    project.sequence.length = 180;
    const track = new PZ.track.video(); project.sequence.videoTracks.push(track);
    const clip = new PZ.clip.video(4); clip.start = 0; clip.length = 180; track.clips.push(clip);
    clip.properties.load(); clip.object.properties.load(); clip.object.threeObj = new h.THREE.Object3D();
    project.objects.splice(0,1); clip.object.objects.push(container);
    const section = h.section('Plain', {plainDelay: 30});
    const delay = section.objects.find(row => row.definition.effectorKey === 'plainDelay');
    const editor = editorFor(PZ, project);
    const realm = vm.createContext({PZ, window: {}, console});
    vm.runInContext(fs.readFileSync(path.join(ROOT,'plugins/core/sequence-timing.js'),'utf8'),realm);
    const operations = new PZ.ui.properties(editor);
    const beforeRate = project.sequence.properties.rate.get();
    const beforeSeconds = delay.get(0) / beforeRate;
    editor.history.startOperation();
    operations.setValue({property:project.sequence.properties.rate.getAddress(), value:60});
    editor.history.finishOperation();
    const afterSeconds = delay.get(0) / project.sequence.properties.rate.get();
    assert.equal(afterSeconds,beforeSeconds);
  } finally {h.close();}
});
