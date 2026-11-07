"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { host } = require("./helpers/editor-identity-host.cjs");
const patch = fs.readFileSync(require.resolve("../plugins/core/waveform-samples.js"), "utf8");
function buffer(sampleRate, signal, numberOfChannels = 1) {
  const length = sampleRate;
  const channels = Array.from({length:numberOfChannels}, (_, c) => Float32Array.from({length}, (_, i) => signal(i, c)));
  return {sampleRate,length,numberOfChannels,getChannelData:c=>channels[c],
    copyFromChannel(target,c,start){target.set(channels[c].subarray(Math.floor(start),Math.floor(start)+target.length));}};
}
const record = () => ({pointsPerSec:200,minBuf:new Int8Array(0),maxBuf:new Int8Array(0)});

test("44.1 kHz peaks survive fractional sample boundaries; integer rates keep native peaks", () => {
  const context = host(), prototype = context.PZ.ui.waveform.prototype, native = prototype.analyzeBuffer;
  const input = buffer(44100, () => .5), broken = record();
  native.call({},input,{},broken);
  assert.equal(broken.maxBuf.filter(value=>value!==0).length,0,"native fractional bins lose non-silent peaks");
  vm.runInContext(patch,context);
  const fixed = record(); prototype.analyzeBuffer(input,{},fixed);
  assert.equal(fixed.maxBuf.length,200);
  assert.ok(fixed.maxBuf.every(value=>value===63));
  for (const sampleRate of [32000,48000,96000]) {
    const audio = buffer(sampleRate, i => Math.sin(i*.3)*.75), before = record(), after = record();
    native.call({},audio,{},before); prototype.analyzeBuffer(audio,{},after);
    assert.deepEqual([...after.minBuf],[...before.minBuf]);
    assert.deepEqual([...after.maxBuf],[...before.maxBuf]);
  }
});

test("fractional bins cover exact channel ranges and append without changing audio data", () => {
  const context=host();vm.runInContext(patch,context);
  const analyze=context.PZ.ui.waveform.prototype.analyzeBuffer;
  const audio=buffer(44100,(i,c)=>Math.sin(i*.17+c)*.6,2), before=audio.getChannelData(0).slice();
  const peaks=record();analyze(audio,{},peaks);
  for(let point=0;point<200;point++){
    const values=[0];
    for(let i=Math.floor(point*220.5);i<Math.floor((point+1)*220.5);i++)values.push((audio.getChannelData(0)[i]+audio.getChannelData(1)[i])*.5);
    assert.equal(peaks.minBuf[point],Math.trunc(Math.min(...values)*127));
    assert.equal(peaks.maxBuf[point],Math.trunc(Math.max(...values)*127));
  }
  const first=[...peaks.maxBuf];analyze(audio,{},peaks);
  assert.deepEqual([...peaks.maxBuf],[...first,...first]);
  assert.deepEqual(audio.getChannelData(0),before);
  const cancellation=record();analyze(buffer(44100,(_i,c)=>c?.5:-.5,2),{},cancellation);
  assert.ok(cancellation.minBuf.every(value=>value===0));assert.ok(cancellation.maxBuf.every(value=>value===0));
});

test("five-minute segmented peaks use source time and exclude remux padding", () => {
  const context=host();vm.runInContext(patch,context);
  const analyze=context.PZ.ui.waveform.prototype.analyzeBuffer;
  for(const sampleRate of [44100,48000]){
    const peaks=record();
    const times=Array.from({length:30},(_,i)=>1.002+i*10).concat([15.002,150.002,285.002]);
    for(let startTime=0;startTime<300;startTime+=15){
      const startOffset=.02+(startTime%5)*.001;
      const samples=new Float32Array(Math.ceil((15+startOffset+.05)*sampleRate));
      samples.fill(.9,0,Math.floor(startOffset*sampleRate)-1);
      samples.fill(.9,Math.ceil((startOffset+15)*sampleRate)+1);
      for(const time of times)if(time>=startTime&&time<startTime+15)
        samples[Math.round((startOffset+time-startTime)*sampleRate)]=.5;
      analyze({sampleRate,length:samples.length,numberOfChannels:1,getChannelData:()=>samples},
        {startTime,startOffset,duration:15},peaks);
    }
    assert.equal(peaks.maxBuf.length,60000);
    assert.equal(peaks.maxBuf.filter(value=>value!==0).length,times.length);
    assert.ok(peaks.maxBuf.every(value=>value===0||value===63),"padding must not become a peak");
    for(const time of times)assert.equal(peaks.maxBuf[Math.floor(time*200)],63);
  }
});

test("partial bins, missing intervals and repeated segments retain absolute placement", () => {
  const context=host();vm.runInContext(patch,context);
  const analyze=context.PZ.ui.waveform.prototype.analyzeBuffer,peaks=record();
  const input=buffer(48000,()=>.5);
  analyze(input,{startTime:1.003,startOffset:0,duration:.003},peaks);
  assert.equal(peaks.maxBuf.length,202);
  assert.ok(peaks.maxBuf.subarray(0,200).every(value=>value===0));
  assert.deepEqual([...peaks.maxBuf.subarray(200)],[63,63]);
  const before=[...peaks.maxBuf];
  analyze(input,{startTime:1.003,startOffset:0,duration:.003},peaks);
  assert.deepEqual([...peaks.maxBuf],before);
  analyze(input,{startTime:2,startOffset:.999,duration:15},peaks);
  assert.equal(peaks.maxBuf.length,401,"a short final buffer keeps its partial bin");
  assert.equal(peaks.maxBuf[400],63);
  assert.ok(peaks.maxBuf.subarray(202,400).every(value=>value===0));
});

test("only later remuxed MP3 segments discard encoder delay and always close the decoder", async () => {
  const context=host();vm.runInContext(patch,context);
  const decode=context.PZ.ui.waveform.prototype.decodeSegment;
  function mp3(){
    const bytes=new Uint8Array(512);
    bytes.set([73,68,51,4,0,0,0,0,0,0]);
    bytes.set([255,251,144,192],10);
    const tag=31,encoder=tag+120;
    bytes.set(Buffer.from("Info"),tag);bytes[tag+7]=15;
    bytes.set(Buffer.from("Lavf"),encoder);
    bytes.set([0xde,0xf5,0x10],encoder+21);
    return{bytes,delay:encoder+21};
  }
  let closed=0,decoded;
  context.AudioContext=class{
    async decodeAudioData(bytes){decoded=new Uint8Array(bytes).slice();return "decoded";}
    async close(){closed++;}
  };
  for(const startTime of [0,285]){
    const {bytes,delay}=mp3(),before=bytes.slice();
    context.PZ.av.remux=async()=>({buffer:bytes.buffer,offset:startTime-.02});
    const segment={startTime,duration:15};
    assert.equal(await decode(segment),"decoded");
    assert.ok(Math.abs(segment.startOffset-.02)<1e-10);
    if(startTime>0){before[delay]=0;before[delay+1]&=15;}
    assert.deepEqual(decoded,before,"keep the first segment's delay and all end padding");
  }
  for(const bytes of [new Uint8Array(2),new Uint8Array(100),Uint8Array.from(Buffer.from("RIFF....WAVE"))]){
    const before=bytes.slice();context.PZ.av.remux=async()=>({buffer:bytes.buffer,offset:15});
    await decode({startTime:15,duration:15});assert.deepEqual(decoded,before);
  }
  assert.equal(closed,5);
  context.AudioContext.prototype.decodeAudioData=async()=>{throw new Error("Invalid audio");};
  assert.equal(await decode({startTime:15,duration:15}),undefined);
  assert.equal(closed,6);
  context.PZ.av.remux=async()=>({buffer:null,offset:30});
  assert.equal(await decode({startTime:30,duration:15}),null);assert.equal(closed,6);
});

test("timeline windows share one analysis per asset and serialize different assets", async () => {
  const context=host(), prototype=context.PZ.ui.waveform.prototype;
  const asset={}, other={};
  function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return{resolve,promise};}
  const nativeJobs=[];
  const nativeWindow=()=>Object.assign(Object.create(prototype),{bufferCache:new WeakMap(),analyze(){const job=deferred();nativeJobs.push(job);return job.promise;}});
  const a=nativeWindow(),b=nativeWindow();
  const before=[a.analyzeMedia(asset),b.analyzeMedia(asset)];
  assert.equal(nativeJobs.length,2,"native per-window queues start two jobs on the shared decoder");
  nativeJobs.forEach(job=>job.resolve());await Promise.all(before);
  vm.runInContext(patch,context);
  let active=0,maximum=0;const jobs=[];
  const window=()=>Object.assign(Object.create(prototype),{bufferCache:new WeakMap(),analyze(media){
    active++;maximum=Math.max(maximum,active);const job=deferred();jobs.push({media,...job});
    return job.promise.then(()=>{active--;this.bufferCache.get(media).maxBuf=new Int8Array([42]);});
  }});
  const first=window(),second=window();
  const one=first.analyzeMedia(asset),shared=second.analyzeMedia(asset),two=second.analyzeMedia(other);
  assert.equal(first.bufferCache.get(asset),second.bufferCache.get(asset));
  await Promise.resolve();assert.equal(jobs.length,1);
  jobs[0].resolve();await one;await shared;await Promise.resolve();
  assert.equal(jobs.length,2);assert.equal(jobs[1].media,other);
  assert.equal(second.bufferCache.get(asset).maxBuf[0],42);
  jobs[1].resolve();await two;
  assert.equal(maximum,1);assert.equal(first.analyzeLoading,null);assert.equal(second.analyzeLoading,null);
});
