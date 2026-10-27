// Exact paused video preparation for a private preview-cache graph.
(function outputFrameVideoModule(global) {
  "use strict";

  const AHEAD = 30, BEHIND = 4;

  function windowBounds(fits) {
    return { ahead: Math.min(AHEAD, Math.max(0, fits - BEHIND)), behind: Math.min(BEHIND, Math.max(0, fits)) };
  }

  function inputs(sequence, frame, sampler) {
    return sampler.frameSamplerMediaInputs(sequence, null, frame, true);
  }

  function eligible(sequence, temporal) {
    // Temporal taps and shutter samples have separate preparation contracts.
    return temporal.usesSingleEvaluation(sequence) === false && !sequence.properties.motionBlur?.get?.();
  }

  function job(valid) {
    let timer;
    const controller = new AbortController();
    const check = () => {
      if (!valid() && !controller.signal.aborted) controller.abort(new Error("Preview cache preparation cancelled."));
      if (controller.signal.aborted) throw controller.signal.reason;
    };
    const poll = () => {
      try { check(); timer = setTimeout(poll, 25); } catch (_error) { /* Cancellation stops polling. */ }
    };
    timer = setTimeout(poll, 25);
    return { signal: controller.signal, check, dispose() { clearTimeout(timer); },
      cancel() { clearTimeout(timer); controller.abort(new Error("Preview cache preparation cancelled.")); } };
  }

  async function prepare(snapshot, frame, policy, temporal, sampler, awaitResources) {
    const sequence = snapshot.project.sequence;
    const compositor = snapshot.compositor;
    policy.check();
    await awaitResources(sequence);
    policy.check();
    // Updating tracks selects layers without starting padded or hidden decoders.
    sequence.update(frame);
    const runtime = sampler.getFrameSamplerRuntime(temporal, compositor);
    const context = { sequence, compositor, frameSamplerRoot: compositor,
      previewFrameCacheStrict: true, exportPolicy: policy };
    const samples = await sampler.prepareLowerSchedules(sequence, { layer: null }, frame, context, runtime, true);
    policy.check();
    const wanted = inputs(sequence, frame, sampler);
    if (!wanted.length || wanted.some(({ item }) => !samples.some(sample => sample.item === item))) {
      throw new Error("Required preview cache video sample is unavailable.");
    }
    for (const track of sequence.videoTracks) {
      if (track.enabled === false) continue;
      const clip = track.getCurrentClip?.(frame);
      if (!clip?.object) continue;
      policy.check();
      await clip.object.prepare?.(frame - clip.start, context);
      policy.check();
    }
    return { samples, runtime, context };
  }

  const api = { inputs, eligible, job, prepare, windowBounds };
  global.ZoidiumOutputFrameVideo = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
