"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/temporal-sampler-host.cjs");

function shutterHost({ start, count, shutter, remapped = false, camera = false, direction = 0 }) {
  const h = host(false);
  h.ownerClip.start = start; h.ownerClip.length = 300;
  h.owner.parent = h.ownerClip;
  const track = h.sequence.videoTracks[0];
  track.clips = [h.ownerClip]; track.track3d = camera;
  const item = h.sequence.videoSchedules[0].items[0];
  item.start = start; item.length = 300;
  Object.assign(h.sequence.properties, { motionBlur:{get:()=>1}, motionBlurSamples:{get:()=>count},
    motionBlurShutter:{get:()=>shutter}, motionBlurSensitivity:{get:()=>115}, motionBlurTrackFrame:{get:()=>direction} });
  h.owner.properties.motionBlurAmount = { get:()=>0.73 };
  if (remapped) {
    h.owner.effects[0]._zoidiumTemporal = {
      getOperator:()=>({kind:"time-offset",enabled:true,offsetFrames:0.137}),
    };
    h.ownerClip.properties.time.get = frame => (frame*0.75+0.125*Math.sin(frame))/30;
  }
  h.effect._zoidiumFrameSampler.getRequest = () => ({ enabled:true, frames:[-1] });
  const preparedTimes = [];
  h.owner.prepare = async (local, context) => {
    preparedTimes.push(local);
    for (const effect of h.owner.effects) await effect.prepare?.(local, context);
  };
  // Mirror native clip methods, including their project-to-local subtraction.
  h.ownerClip.update = frame => h.owner.update(frame - start);
  h.ownerClip.prepare = (frame, context) => h.owner.prepare(frame - start, context);
  const context = { sequence:h.sequence, compositor:h.root, frameSamplerRoot:h.root, exportPolicy:{check(){}} };
  return { ...h, preparedTimes, context };
}

async function checkShutter(options) {
  const h = shutterHost(options), output = 100;
  const release = h.state.beginExportSamples(h.root);
  try {
    const initial = h.state.mapLayerFrame(h.owner, output-options.start)?.sourceFrame ?? output-options.start;
    await h.ownerClip.prepare(options.start+initial, h.context);
    await h.state.prepareExportSamples(h.context, output);
    const expected = [];
    h.parts.layers.installSingleEvaluation(h.state, h.sequence);
    for (let sample=0; sample<options.count; sample++) {
      // The host evaluates this expression without a project-time round trip.
      let local = output-options.start + sample/options.count*options.shutter;
      if (options.camera) {
        const span = options.shutter*115*0.01;
        const begin = options.direction===1 ? -span : options.direction===2 ? 0 : -0.5*span;
        local = output-options.start + (begin+sample/options.count*span)*0.73;
      }
      const source = h.state.mapLayerFrame(h.owner, local)?.sourceFrame ?? local;
      expected.push(source);
      h.state.contexts.push({ compositor:h.root, rootCompositor:h.root, outputFrame:output,
        renderingSequence:true, singleEvaluation:h.parts.layers.usesSingleEvaluation(h.sequence), exportPolicy:h.context.exportPolicy });
      try {
        h.owner.update(local);
        assert.equal(h.owner.__zoidiumTemporalLastUpdateFrame, source, "draw uses the expected exact local clock");
        const samples = h.state.resolveFrameSamples(h.effect);
        assert.equal(samples.length, 1);
        const frame = options.start+(source-1);
        assert.equal(samples[0].frame,frame,"the prepared tap has the exact requested project time");
        const media = h.ownerClip.properties.time.get(frame-options.start)*30;
        assert.ok(Math.abs(samples[0].target.value-(media+100))<1e-9);
      } finally { h.state.contexts.pop(); }
    }
    // Every shutter offset must prepare exactly the local time used by update().
    for (const source of expected) assert.ok(h.preparedTimes.some(frame=>Object.is(frame,source)),
      `missing bit-identical preparation for ${source}: ${JSON.stringify(options)}`);
  } finally { release(); h.root.unload(); }
}

test("native shutter sampling preserves exact local clocks for 570 nonbinary subframes", async () => {
  for (const start of [0,3,7,12.5,41]) for (const count of [10,12,16]) for (const shutter of [0.3,0.5,0.7]) {
    await checkShutter({start,count,shutter});
  }
});
test("time-remapped shutter samples retain exact local clocks", async () => {
  for (const start of [3,7,12.5,41]) for (const count of [10,12]) for (const shutter of [0.3,0.7]) {
    await checkShutter({start,count,shutter,remapped:true});
  }
});
test("Camera+ direction, sensitivity and layer amount preserve exact shutter clocks", async () => {
  for (const start of [3,12.5,41]) for (const count of [10,12]) for (const shutter of [0.3,0.7]) for (const direction of [0,1,2]) {
    await checkShutter({start,count,shutter,direction,camera:true,remapped:true});
  }
});

function resolveUnprepared(h) {
  h.owner.update(20.03);
  h.state.contexts.push({compositor:h.root,rootCompositor:h.root,outputFrame:30,renderingSequence:true,exportPolicy:{check(){}}});
  try { return h.state.resolveFrameSamples(h.effect); }
  finally { h.state.contexts.pop(); }
}
test("procedural export cache misses retain synchronous capture", () => {
  const h = host(false); h.sequence.videoSchedules = [];
  assert.equal(resolveUnprepared(h).length, 2);
});
test("video on an unrelated upper track does not block procedural fallback", () => {
  const h = host(false), clip = { start:0,length:100,object:{} };
  h.sequence.videoTracks.push({enabled:true,getCurrentClip:()=>clip});
  h.sequence.videoSchedules[0].items[0].clip = clip;
  assert.equal(resolveUnprepared(h).length, 2);
});
test("an uncaptured own video input still rejects an export cache miss", () => {
  const h = host(false);
  assert.throws(()=>resolveUnprepared(h), /Required exact media sample/);
});
test("an uncaptured lower video input still rejects an adjustment export cache miss", () => {
  const h = host(true);
  assert.throws(()=>resolveUnprepared(h), /Required exact media sample/);
});

test("disabled lower video tracks do not block a procedural adjustment fallback", () => {
  const h=host(true);h.sequence.videoTracks[0].enabled=false;
  assert.equal(resolveUnprepared(h).length,2);
});

test("procedural synchronous export captures preserve pinned prepared plans", async () => {
  const h=host(false);h.sequence.videoSchedules=[];
  const release=h.state.beginExportSamples(h.root);
  try {
    await h.state.prepareFrameSamples(h.effect,20,{frameSamplerRoot:h.root,exportPolicy:{check(){}}});
    const prepared=h.state.frameSamplerRuntimes.get(h.root).prepared.get(h.effect).samples;
    const stamps=prepared.map(sample=>sample.target.inputStamp);
    assert.equal(resolveUnprepared(h).length,2);
    prepared.forEach((sample,index)=>assert.equal(sample.target.inputStamp,stamps[index]));
  } finally {release();h.root.unload();}
});

test("16+ native shutter preparations keep fractional media samples outside the timestamp correction", async () => {
  const { target } = require("../plugins/core/video-seek-policy");
  const timing = { period: 1 / 30, quantum: 0.001 };
  let fractional = 0, boundary = 0;
  for (const count of [16, 32, 64, 128]) for (const shutter of [0.3, 0.5, 0.7]) {
    const h = shutterHost({ start: 3, count, shutter });
    await h.state.prepareExportSamples(h.context, 100);
    for (const local of h.preparedTimes) {
      const time = h.ownerClip.properties.time.get(local);
      const corrected = target(time, 10, timing);
      if (Math.abs(time * 30 - Math.round(time * 30)) <= 1e-9) {
        assert.ok(corrected > time); boundary++;
      } else {
        assert.equal(corrected, time); fractional++;
      }
    }
    h.root.unload();
  }
  assert.equal(boundary, 12);
  assert.equal(fractional, 708);
});
