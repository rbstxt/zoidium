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
