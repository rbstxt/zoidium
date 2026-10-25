"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createJob } = require("../plugins/mp4-export/render.js");

function decoderHost(quantum = 0.001, offset = 0) {
  const PZ = {schedule:class {},export:class {}};
  vm.runInNewContext(fs.readFileSync("plugins/core/video-frame-export.js","utf8"), {PZ,setTimeout,clearTimeout,AbortController});
  const video = new EventTarget(); let observed = 0;
  Object.assign(video,{readyState:2,duration:10,seeking:false,src:"fixture.mp4",error:null});
  Object.defineProperty(video,"currentTime",{get:()=>observed,set(time){
    observed = Math.floor(time/quantum)*quantum+offset;
    queueMicrotask(()=>video.dispatchEvent(new Event("seeked")));
  }});
  const schedule = Object.assign(new PZ.schedule(),{el:video,texture:{}});
  return {PZ,video,schedule};
}
for (const quantum of [0.001,0.002]) test(`${quantum}s media clocks accept exact seeks without broadening frame reuse`, async () => {
  const {PZ,schedule,video} = decoderHost(quantum);
  PZ.videoFrameExportDiagnostics.enabled = true;
  await schedule.decodeFrame(0.1239);
  assert.equal(video.currentTime,Math.floor(0.1239/quantum)*quantum);
  assert.equal(schedule.__zoidiumVideoExportState.requestedTime,0.1239);
  await schedule.decodeFrame(0.1238);
  assert.equal(schedule.__zoidiumVideoExportState.requestedTime,0.1238);
  assert.deepEqual(Array.from(PZ.videoFrameExportDiagnostics.records,r=>r.reused),[false,false]);
});

for (const stage of ["prepare","encode"]) test(`MP4 Cancel during ${stage} preserves the editor decoder and its current preview frame`, async () => {
  const {PZ,schedule,video} = decoderHost();
  const currentItem = schedule.currentItem = {media:{url:video.src}};
  let releases=0,disposals=0,finishPrepare,beginPrepare,beginEncoding,rejectEncoding;
  video.pause=()=>{}; video.removeAttribute=()=>{releases++;video.src="";}; video.load=()=>{releases++;video.readyState=0;};
  const preparing=new Promise(resolve=>{beginPrepare=resolve;});
  const encoding=new Promise(resolve=>{beginEncoding=resolve;});
  const exporter=Object.assign(new PZ.export(),{frame:0,frameAdvance:1,framesRendered:0,totalFrames:1,
    params:{width:2,height:2,rate:30,quality:2,start:0,length:1},
    sequence:{properties:{rate:{get:()=>30}},videoSchedules:[schedule],prepare(){beginPrepare();return stage==="encode" ? Promise.resolve() : new Promise(resolve=>{finishPrepare=resolve;});}},
    compositor:{renderSequence(){},unload(){disposals++;}},
    renderer:{domElement:{width:2,height:2},context:{isContextLost:()=>false},dispose(){disposals++;}}});
  const bunny={StreamTarget:class {},Mp4OutputFormat:class {},Quality:class {},CanvasSource:class {add(){beginEncoding();return new Promise((_resolve,reject)=>{rejectEncoding=reject;});}},
    Output:class {addVideoTrack(){} async start(){} async cancel(){this.state="canceled";rejectEncoding?.(new Error("Writer canceled"));}}};
  const job=createJob({navigator:{},VideoEncoder:{async isConfigSupported(){return {supported:true};}}},
    {av:{profiles:Array.from({length:5},()=>({bitrate:1}))}},exporter,()=>bunny);
  const result=job.run();await (stage==="prepare" ? preparing : encoding);job.cancel();finishPrepare?.();
  await assert.rejects(result,{name:"AbortError"});
  assert.equal(releases,0);assert.equal(schedule.currentItem,currentItem);assert.equal(video.src,"fixture.mp4");
  assert.equal(disposals,2);await schedule.decodeFrame(0);assert.equal(schedule.texture.needsUpdate,true);
});


test("seek completion still rejects a different media time outside the precision allowance", async () => {
  const {schedule}=decoderHost(0.001,0.005);
  await assert.rejects(schedule.decodeFrame(0.1239),/different requested time/);
  assert.notEqual(schedule.texture.needsUpdate,true);
});


