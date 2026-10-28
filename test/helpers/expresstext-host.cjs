'use strict';
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const {host} = require(path.join(ROOT, 'test/helpers/editor-identity-host.cjs'));
const plugin = require(path.join(ROOT, 'plugins/expresstext-plus/expresstext.js'));
const T = plugin._test;
function fixture() {
  const {PZ, THREE} = host();
  PZ.material.fnList.singlecolor = Promise.resolve(function () {
    this.load = function () { this.threeObj = new THREE.MeshBasicMaterial(); };
    this.update = function () {};
    this.prepare = async function () {};
    this.unload = function () { this.threeObj.dispose(); };
  });
  const project = new PZ.project();
  project.threeObj = new THREE.Object3D();
  project.objects = new PZ.objectList(project, PZ.object3d);
  project.children.push(project.objects);
  plugin.activate({PZ, window: {THREE}, object3d: {registerClass: () => () => {}}});
  const Container = T.createExpressObjectClass(PZ, T.getExpressDefinitions()[0]);
  const container = new Container();
  project.objects.push(container);
  container.load({objects: [], properties: {}});
  // A synthetic font, unrelated to the cached CM3 font resources.
  const font = new THREE.Font({resolution: 1000, boundingBox: {yMin: 0, yMax: 1000}, underlineThickness: 0,
    glyphs: {A: {ha: 600, o: 'm 0 0 l 500 0 l 500 700 l 0 700 l 0 0'},
      B: {ha: 800, o: 'm 0 0 l 700 0 l 700 700 l 0 700 l 0 0'}}});
  function group(parent = container) {
    const object = new PZ.object3d.group(); parent.objects.push(object); object.load({objects: [], properties: {}});
    return object;
  }
  function text(parent = container, value = 'AB') {
    const object = new PZ.object3d.text(); parent.objects.push(object);
    object.load({properties: {font: '', text: value}});
    object.font = {font3d: font, loading3d: Promise.resolve()};
    object.fontNeedsUpdate = false;
    object.geometryNeedsUpdate = true;
    return object;
  }
  function section(kind, values) {
    const def = T.effectorEntryDefs(PZ).find(entry => entry.name.toLowerCase() === kind.toLowerCase());
    const section = PZ.property.create(def.type);
    container.customProperties.push(section);
    section.load();
    for (const [key, value] of Object.entries(values)) {
      const row = section.objects.find(row => row.definition.effectorKey === key);
      row.set(value, 0);
    }
    return section;
  }
  function close() { plugin.deactivate(); }
  return {PZ, THREE, project, container, text, group, section, close, T};
}
module.exports = {fixture, ROOT};
