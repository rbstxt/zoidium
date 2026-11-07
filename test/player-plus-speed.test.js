"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const PlayerPlus = require("../plugins/player-plus/player-plus.js");
const { makeDocument, FakeElement } = require("./fake-dom.js");
const { host, editorFor } = require("./helpers/editor-identity-host.cjs");

test("playback speed follows native shuttle changes and never enters project history or saved data", async () => {
  const c = host(), {PZ} = c, project = new PZ.project();
  project.load({assets:{},media:[],sequence:{properties:{},length:100,videoTracks:[],audioTracks:[],clipLinks:{links:{},seed:0}}});
  const editor = editorFor(PZ, project);
  const playback = editor.playback;
  PZ.observable.defineObservableProp(playback, "speed", "onSpeedChanged"); playback.speed=0;
  const document = makeDocument(), toolbar = new FakeElement("div");
  toolbar.querySelector = selector => selector === 'button[title="play (space)"]' ? true : null;
  document.getElementById=()=>null; document.querySelectorAll=s=>s===".toolbarpanel"?[toolbar]:[];
  const window = {requestAnimationFrame(){return 1;},cancelAnimationFrame(){}};
  const context = {editor,window,document,PZ:{ui:{generateIcon:()=>new FakeElement("svg"),switchIcon(){}}}};
  const before = JSON.stringify(project), history = editor.history.undoStack.length;
  await PlayerPlus.activate(context);
  const select=toolbar.children.find(e=>e.classList.contains("zoidium-player-plus-speed"));
  try {
    for (const speed of [.25,.5,.75,1,1.25,1.5,2,0]) {
      select.value=String(speed);select.dispatch("change");assert.equal(playback.speed,speed);
    }
    for (const speed of [-1,-2,4,8,0]) {
      playback.speed=speed;assert.equal(select.value,String(speed));
      assert.equal(select.children.length, speed<0||speed>2 ? 9 : 8);
    }
    assert.equal(JSON.stringify(project),before); assert.equal(editor.history.undoStack.length,history);
    const clone = new PZ.project();clone.load(JSON.parse(before));
    assert.equal(JSON.stringify(clone),before,"save, reopen, and duplicate retain project content");
    const ops = new PZ.ui.properties(editor), rate = project.sequence.properties.rate;
    editor.history.startOperation();
    ops.setValue({property:rate.getAddress(),value:24});
    editor.history.finishOperation();
    assert.equal(rate.get(),24);
    editor.history.undo(); assert.equal(rate.get(),30);
    editor.history.redo(); assert.equal(rate.get(),24);
    assert.equal(playback.speed,0);
  } finally { PlayerPlus.deactivate(); }
  playback.speed=1;assert.equal(select.removed,true);
});
