'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Module = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const cache = path.join(ROOT, '.zoidium-resources');
const nativeTest = (name, run) => test(name, {skip: !fs.existsSync(path.join(cache, 'ui-1.0.72.js'))}, run);
const req = Module.createRequire(ROOT + '/package.json');
req('./test/migrate-test-apis.js').ensureMainRealmApis();
function nativeHost() {
  const c = vm.createContext({PZ:{},ISNODE:true,console,setTimeout,clearTimeout,TextEncoder,TextDecoder,performance,URL,
    Image:class {},CSS:{supports:()=>true},window:{addEventListener(){}},navigator:{},document:{}});
  for (const name of ['three.r91.min.js','core-1.0.102.js','ui-1.0.72.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT,'.zoidium-resources',name),'utf8'),c);
  return c;
}
function repeaterFixture(native, mode) {
  const {PZ,THREE}=native;
  const api = req('./plugins/scene-plus/scene-repeaters.js');
  const Repeater=api.createRepeaterClass(PZ,THREE,mode,'test:repeater');
  const owner=new Repeater(); owner.threeObj=new THREE.Object3D(); owner.properties.load(); owner.repeaterProperties.load();
  owner.repeaterProperties.count.set(2);
  const light=new PZ.object3d.light(); light.type=0; light.load({objectType:2});
  owner.objects.push(light);
  return {owner,light};
}
for(const mode of ['step','linear','random']) nativeTest(`${mode}: retained light clones match a fresh build after an edit`,async()=>{
  const native=nativeHost();
  {
    const {owner,light}=repeaterFixture(native,mode);
    owner.update(0); await owner.prepare(0); owner.update(0);
    const initial=owner._instanceRoots[0].clones[0].clone;
    assert.equal(initial.intensity,1);
    light.properties.intensity.set(4,0); light.properties.color.set([1,0,0],0);
    owner.update(0); await owner.prepare(0); owner.update(0);
    const clone=owner._instanceRoots[0].clones[0].clone;
    assert.equal(light.threeObj.intensity,4);
    assert.equal(clone.intensity,4);
    assert.deepEqual(Array.from(clone.color.toArray()),[1,0,0]);
    {
      assert.equal(clone,initial);
      owner.markRepeaterDirty(); owner.update(0);
      assert.equal(owner._instanceRoots[0].clones[0].clone.intensity,4,'forced rebuild repairs output at the same frame');
    }
    owner.unload();
  }
});
const helper = require('./openzoid-windows-harness.js');
function projectWithEffect(PZ,defs,type='ascii') {
  const project=new PZ.project(); project.sequence.properties.load();
  const track=new PZ.track.video(); project.sequence.videoTracks.push(track);
  const clip=new PZ.clip.video(4); clip.start=0; clip.length=100; track.clips.push(clip);
  const effect=new PZ.effect();effect.type=type;effect.propertyDefinitions=defs;effect.properties.addAll(defs);effect.properties.load();
  clip.object.effects.push(effect);
  return {project,track,clip,effect};
}
for(const [kind,label,key,before] of [['ascii','Contrast','contrast',1],['tracery','Threshold','threshold',50]])
nativeTest(`${kind} setup rejects edits after project replacement and enclosing clip removal`,()=>{
  const defs=helper.effectDefinitions(kind+'.js'); const {PZ}=nativeHost();
  const a=projectWithEffect(PZ,defs,kind),b=projectWithEffect(PZ,defs,kind);
  const h=helper.makeHarness(defs,a.effect);
  h.context.PZ=PZ;
  const editor=h.context.editor;
  PZ.observable.defineObservableProp(editor,'project','onProjectChanged');
  editor.history=new PZ.ui.history(editor);editor.project=a.project;
  b.effect.properties[key].set(2,7);
  const api=helper.loadWindows(); api.activate(h.context);helper.openFromEditor(h,kind==='ascii'?'ASCII Setup':'Tracery Setup',a.effect);
  const savedInterval=global.setInterval;const savedClear=global.clearInterval;
  global.setInterval=()=>1;global.clearInterval=()=>{};
  let mount;
  try {
    mount={cleanup:h.windows[0].options.mount({appendChild(){}},h.windows[0])};
    const opts=h.windows[0].options;
    assert.equal(opts.isValid(),true);
    h.context.editor.project=b.project;
    assert.equal(a.effect.parentProject,a.project);
    const contrast=h.made.find(item=>item.opts?.label===label);
    assert.equal(b.effect.properties[key].get(7),2);
    contrast.opts.onChange(3);
    assert.equal(a.effect.properties[key].get(7),before,'old object was not the write target');
    assert.equal(b.effect.properties[key].get(7),2,'stale control cannot write through the new editor');
    assert.equal(opts.isValid(),false,'project replacement invalidates the old window');
    assert.equal(editor.history.undoStack.length,0,'stale edit creates no undo step');
    editor.project=a.project;
    assert.equal(opts.isValid(),true);
    a.track.clips.splice(0,1);
    assert.equal(opts.isValid(),false,'removing an ancestor invalidates descendants');
    contrast.opts.onInput(4);
    contrast.opts.onChange(4);
    assert.equal(a.effect.properties[key].get(7),before);
    assert.equal(h.windows[0].closed,true);
  } finally {mount?.cleanup();api.deactivate();for(const fn of h.disposers)fn();global.setInterval=savedInterval;global.clearInterval=savedClear;}
});
function realLooksEffect(native) {
  const {PZ,THREE}=native;
  const project=new PZ.project();project.sequence.properties.load();
  const track=new PZ.track.video();project.sequence.videoTracks.push(track);
  const clip=new PZ.clip.video(4);clip.start=0;clip.length=100;track.clips.push(clip);
  const effect=new PZ.effect();effect.type='looks';clip.object.effects.push(effect);
  effect._zoidiumGetAsset=(_kind,name)=> {
    const file=path.basename(name);
    return fs.readFileSync(path.join(ROOT,'plugins/magic-looks',file),'utf8');
  };
  new Function('PZ','THREE',fs.readFileSync(ROOT+'/plugins/magic-looks/looks-fx.js','utf8')).call(effect,PZ,THREE);
  return effect;
}
nativeTest('disabled Magic Looks creates the selected LUT import manager without evaluating grading stages', async () => {
  const effect=realLooksEffect(nativeHost());
  try {
    await effect.load({looksInstances:{version:1,nextId:2,order:[{id:'i1',tool:'lut'}]},properties:{enabled:0}});
    effect.properties.enabled.set(0,0);
    effect.update(0); await effect.prepare(0);
    const stage=effect._looksPipeline.editorStage('i1');
    assert.equal(typeof stage._looksLutAssets.importFile,'function');
    assert.equal(effect.pass.enabled,false);
    assert.equal(effect._looksPipeline.editorStage('missing'),undefined);
    const project = effect.parentProject;
    const cube = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
    const file = {name:'identity.cube', size:cube.length, text:async () => cube};
    const asset = {key:'test-lut', file};
    project.assets.createFromFile = async () => asset;
    project.assets.load = () => asset;
    project.assets.unload = () => {};
    let picker, writes;
    const Looks = effect.looksTest.Looks;
    new Function('Looks','document',fs.readFileSync(path.join(ROOT,'plugins/magic-looks/looks-lut-ui.js'),'utf8'))(Looks, {
      createElement() { return picker = {style:{}, files:[file], addEventListener(name, fn) {this[name]=fn;}}; }
    });
    const record = () => ({element:{}}), view = {};
    Looks.lutUI.buildLut({Looks, ctl:{select:record,note:record,buttonRow:record},
      effect:{_looksLutAssets:stage._looksLutAssets, prepare:() => stage.prepare(0)},
      session:{commit(value) {writes=value;for (const write of value) effect.properties["ml_i1_"+write.key].set(write.value,0);}}, view, afterCommit(){}, readProp:() => null,
      nativeParameters:true, body:{appendChild(){},insertBefore(){}}});
    await picker.change();
    assert.equal(view.lutError,null);
    assert.deepEqual(writes.map(write => write.value),['Custom','test-lut']);
    assert.equal(stage._looksCubeAtlas.size,2,'editor preparation makes the imported LUT available while disabled');
    assert.equal(effect.pass.enabled,false);
  } finally { effect.unload(); }
});

nativeTest('retained Three.js rendering state matches clone() for lights, cameras, meshes, sprites, and LODs', () => {
  const {THREE} = nativeHost();
  const {copyObjectState} = req('./plugins/scene-plus/scene-clone.js');
  const types = ['Object3D', 'AmbientLight', 'HemisphereLight', 'PointLight', 'DirectionalLight', 'SpotLight',
    'RectAreaLight', 'PerspectiveCamera', 'OrthographicCamera', 'Mesh', 'SkinnedMesh', 'Sprite', 'Line', 'Points', 'LOD'];
  for (const type of types) {
    const source = type === 'SkinnedMesh' ? new THREE.SkinnedMesh(new THREE.Geometry(), new THREE.MeshBasicMaterial()) : new THREE[type]();
    if (type === 'LOD') source.addLevel(new THREE.Mesh(), 10);
    const retained = source.clone(true), geometry = retained.geometry, material = retained.material;
    source.name = 'Edited'; source.position.set(1, 2, 3); source.up.set(0, 0, 1);
    source.castShadow = true; source.receiveShadow = true; source.frustumCulled = false; source.renderOrder = 5;
    source.matrixAutoUpdate = false; source.matrix.makeTranslation(1, 2, 3);
    source.updateMatrixWorld(true);
    if (source.isLight) {
      source.color.setRGB(.2, .4, .6); source.intensity = 4;
      for (const [key, value] of Object.entries({distance: 12, decay: 3, angle: .4, penumbra: .3, width: 8, height: 7})) {
        if (key in source) source[key] = value;
      }
      source.groundColor?.setRGB(.7, .1, .2);
      if (source.target) { source.target.position.set(3, 2, 1); source.target.updateMatrixWorld(true); }
      if (source.shadow) {
        source.shadow.bias = .03; source.shadow.radius = 2; source.shadow.mapSize.set(1024, 512);
        source.shadow.camera.near = 2; source.shadow.camera.far = 200;
        source.shadow.camera.updateProjectionMatrix();
      }
    }
    if (source.isCamera) {
      source.zoom = 2; source.near = 3; source.far = 1000;
      if (source.isPerspectiveCamera) { source.fov = 70; source.focus = 12; source.filmOffset = 4; }
      else source.left = -7;
      source.setViewOffset(200, 100, 10, 20, 100, 50);
      source.updateProjectionMatrix();
    }
    if (source.isMesh) {
      source.drawMode = THREE.TriangleStripDrawMode;
      source.morphTargetInfluences = [.2, .8]; source.morphTargetDictionary = {a: 0, b: 1};
    }
    if (source.isSprite) source.center.set(.2, .7);
    if (source.isLOD) source.levels[0].distance = 30;
    copyObjectState(source, retained);
    const fresh = source.clone(true);
    function serialized(node) {
      const value = JSON.parse(JSON.stringify(node.toJSON().object));
      function strip(item) {
        delete item.uuid;
        if (item.levels) item.levels = item.levels.map(level => ({distance: level.distance}));
        if (item.shadow?.camera) strip(item.shadow.camera);
        for (const child of item.children || []) strip(child);
      }
      strip(value); return value;
    }
    assert.deepEqual(serialized(retained), serialized(fresh), type);
    for (const key of ['projectionMatrix', 'matrixWorldInverse', 'morphTargetInfluences', 'morphTargetDictionary']) {
      if (fresh[key]) assert.deepEqual(JSON.parse(JSON.stringify(retained[key])), JSON.parse(JSON.stringify(fresh[key])), type + '.' + key);
    }
    if (source.target) assert.deepEqual(serialized(retained.target), serialized(fresh.target), type + '.target');
    assert.equal(retained.geometry, geometry, type + ' retains geometry');
    assert.equal(retained.material, material, type + ' retains material');
  }
});
