const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function host() {
  class Track { load(data) { this.clips = data.clips; } toJSON() { return { type: 0, clips: this.clips }; } }
  const context = { PZ: { track: Track }, console };
  vm.runInNewContext(fs.readFileSync('zoidium/plugin-apis.js', 'utf8'), context);
  return { Track, apis: context.ZoidiumPluginApis, context };
}
test('unknown track fields survive disabled-plugin load and save', () => {
  const { Track } = host(); const track = new Track();
  track.load({ type: 0, clips: [], track3d: true, extension: { value: 3 } });
  assert.equal(track.toJSON().track3d, true);
  assert.equal(track.toJSON().extension.value, 3);
  track.load({ type: 0, clips: [] }); assert.equal(track.toJSON().track3d, undefined);
});
test('declared fields save live values and support disposal and reactivation', () => {
  const { Track, apis } = host(); const track = new Track();
  const dispose = apis.timeline.registerTrackField('track3d', { default: false });
  track.load({ clips: [] }); assert.equal(track.track3d, false);
  track.track3d = true; assert.equal(track.toJSON().track3d, true);
  dispose(); apis.timeline.registerTrackField('track3d', { default: false });
  assert.equal(track.toJSON().track3d, true);
  assert.throws(() => apis.timeline.registerTrackField('__proto__', { default: false }));
});
test('legacy layer type claims reject collisions and release their factory', () => {
  const { apis } = host();
  // Layer registration is tested with the same host globals used by the API.
  const context = { PZ: { layer: { create: type => ({ vanilla: type }) } }, console };
  vm.runInNewContext(fs.readFileSync('zoidium/plugin-apis.js', 'utf8'), context);
  const layers = context.ZoidiumPluginApis.layers;
  const original = context.PZ.layer.create;
  const dispose = layers.registerType({ id: 'camera-plus/camera', type: 9, legacyType: 9, factory: () => ({ camera: true }) });
  assert.equal(context.PZ.layer.create(9).camera, true);
  assert.throws(() => layers.registerType({ id: 'collision', type: 9, legacyType: 9, factory() {} }), /collision/);
  dispose(); assert.equal(context.PZ.layer.create, original);
});
function element() {
  return { children: [], dataset: {}, style: { gridTemplateColumns: '1fr auto auto' }, isConnected: true,
    setAttribute(key, value) { this[key] = value; },
    insertBefore(child, before) { child.parentElement = this; const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); },
    querySelectorAll() { return this.children.filter(child => child.dataset.zoidiumTrackButton); },
    querySelector() { return this.querySelectorAll()[0]; },
    remove() { const list = this.parentElement.children; list.splice(list.indexOf(this), 1); },
  };
}
test('track buttons support existing labels, multiple registrations, refresh and complete cleanup', () => {
  const label = element(); label.children = [element(), element(), element()];
  const track = { active: false }; const eye = { parentElement: label };
  const tracks = { prototype: { createTrackLabel() { const label = element(); label.children = [element(), element(), element()]; return label; } } };
  const original = tracks.prototype.createTrackLabel;
  const editor = { project: { sequence: { videoTracks: [track] } } };
  const context = { console, CM: editor, PZ: { ui: { timeline: { tracks } } }, document: { createElement: element, querySelectorAll: () => [eye] } };
  vm.runInNewContext(fs.readFileSync('zoidium/plugin-apis.js', 'utf8'), context);
  const timeline = context.ZoidiumPluginApis.timeline;
  const spec = id => ({ id, label: '3D', kinds: ['video'], isActive: t => t.active, onToggle(t, e) { assert.equal(e, editor); t.active = !t.active; } });
  const first = timeline.registerTrackButton(spec('first'));
  const second = timeline.registerTrackButton(spec('second'));
  assert.equal(label.querySelectorAll().length, 2);
  label.querySelectorAll()[0].onclick({ stopPropagation() {} });
  timeline.refreshTrackButtons();
  assert.equal(label.querySelectorAll()[1]['aria-pressed'], 'true');
  const future = tracks.prototype.createTrackLabel.call({ timeline: { editor } }, track, 0);
  assert.equal(future.querySelectorAll().length, 2);
  first(); assert.equal(label.querySelectorAll().length, 1);
  second(); assert.equal(label.querySelectorAll().length, 0);
  assert.equal(label.style.gridTemplateColumns, '1fr auto auto');
  assert.equal(tracks.prototype.createTrackLabel, original);
});
test('media presets follow project load and are removed on disposal', async () => {
  class Project { constructor() { this.media = []; } load() {} toJSON() { return { media: this.media.filter(m => !m.preset) }; } }
  class Media { async load(data) { Object.assign(this, data); } unload() {} }
  const project = new Project(); const editor = { project };
  const context = { console, PZ: { project: Project, media: Media }, CM: editor };
  vm.runInNewContext(fs.readFileSync('zoidium/plugin-apis.js', 'utf8'), context);
  const dispose = context.ZoidiumPluginApis.media.registerPreset({ id: 'camera-plus/camera', name: 'Camera', icon: 'camera', json: { assets: [], baseType: 'track', data: [] } });
  await project.media[0].loading;
  assert.equal(project.media[0].properties.name, 'Camera');
  assert.equal(project.toJSON().media.length, 0);
  editor.project = new Project(); editor.project.load();
  assert.equal(editor.project.media.length, 1);
  dispose(); assert.equal(editor.project.media.length, 0);
});

test('enabling a field after a disabled-plugin load revives the retained live value', () => {
  const { Track, apis, context } = host(); const track = new Track();
  track.load({ clips: [], track3d: true });
  context.CM = { project: { forEachItemOfType(type, fn) { assert.equal(type, Track); fn(track); } } };
  apis.timeline.registerTrackField('track3d', { default: false });
  assert.equal(track.track3d, true);
  assert.equal(track.toJSON().track3d, true);
});
