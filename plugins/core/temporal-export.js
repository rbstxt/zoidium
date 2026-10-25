// Prepare the asynchronous inputs consumed by CM3's synchronous shutter loop.
(function temporalExportPart(global) {
  "use strict";
  const registry = global.__zoidiumTemporalParts || (global.__zoidiumTemporalParts = {});
  function installPreparationPolicy() {
    const clip = PZ.clip?.prototype;
    if (clip?.prepare && !clip.__zoidiumExportPrepare) {
      const original = clip.prepare;
      clip.prepare = function prepareExportClip(frame, context) {
        if (context?.exportPolicy) return this.object.prepare(frame - this.start, context);
        return original.apply(this, arguments);
      };
      clip.__zoidiumExportPrepare = true;
    }
    const group = PZ.effect?.group?.prototype;
    if (group?.prepare && !group.__zoidiumExportPrepare) {
      const original = group.prepare;
      group.prepare = async function prepareExportEffectGroup(frame, context) {
        if (!context?.exportPolicy) return original.apply(this, arguments);
        for (const effect of this.objects || []) {
          context.exportPolicy.check?.();
          await effect.loading;
          await effect.prepare(frame, context);
        }
      };
      group.__zoidiumExportPrepare = true;
    }
  }
  function hasSampler(layer, seen = new Set()) {
    if (!layer || seen.has(layer)) return false;
    seen.add(layer);
    if (layer._zoidiumFrameSampler || layer.effects?.some(effect => hasSampler(effect, seen))) return true;
    if (layer.objects?.some(child => hasSampler(child, seen))) return true;
    return layer.nestedTracks?.().some(track => track.clips?.some(clip => hasSampler(clip.object, seen))) || false;
  }
  function begin(state, compositor) {
    const runtime = registry.sampler.getFrameSamplerRuntime(state, compositor);
    if (!runtime) return () => {};
    const pins = new Set();
    runtime.exportPins = pins;
    runtime.reservations.add(pins);
    return () => { runtime.reservations.delete(pins); runtime.exportPins = null; };
  }
  async function prepare(state, exporter, frame) {
    const sequence = exporter.sequence;
    const tracks = sequence.videoTracks || [];
    if (!tracks.some(track => hasSampler(track.layer || track.getCurrentClip?.(frame)?.object))) return;
    const properties = sequence.properties;
    const cameraShutter = tracks.some(track => track.track3d || track.layer?.constructor?.name === "CameraLayer");
    const count = properties.motionBlur?.get() === 0 ? 1 :
      Math.max(1, Math.min(cameraShutter ? 128 : Infinity, Math.floor(properties.motionBlurSamples?.get(frame) || 1)));
    if (count <= 1) return;
    const shutter = properties.motionBlurShutter?.get(frame) || 0;
    const sensitivity = cameraShutter ? (properties.motionBlurSensitivity?.get(frame) ?? 100) * 0.01 : 1;
    const direction = cameraShutter ? properties.motionBlurTrackFrame?.get(frame) : 2;
    for (let sample = 0; sample < count; sample++) {
      for (const track of tracks) {
        const clip = track.layer?.parent || track.getCurrentClip?.(frame);
        const layer = track.layer || clip?.object;
        if (!clip || !hasSampler(layer) || cameraShutter && track.enabled === false) continue;
        const local = frame - clip.start;
        const amount = cameraShutter ? layer.properties.motionBlurAmount?.get(local) ?? 1 : 1;
        const span = shutter * sensitivity;
        const offset = ((direction === 1 ? -span : direction === 2 ? 0 : -0.5 * span) + sample / count * span) * amount;
        if (offset === 0) continue; // sequence.prepare already prepared the output time.
        exporter.exportPolicy.check();
        const source = state.mapLayerFrame(layer, local + offset)?.sourceFrame ?? local + offset;
        const requested = clip.start + source;
        // Use the same layer clock and nested prepare traversal as the host.
        clip.update?.(requested);
        if (!clip.update) layer.update(source);
        if (clip.prepare) await clip.prepare(requested, exporter);
        else for (const effect of layer.effects || []) await effect.prepare?.(source, exporter);
        exporter.exportPolicy.check();
      }
    }
    // Isolated sampler media never replaces the output schedule. Restore the
    // output properties before the host starts its unchanged synchronous loop.
    sequence.update?.(frame);
  }
  registry.exportPreparation = { begin, prepare, installPreparationPolicy };
})(typeof globalThis !== "undefined" ? globalThis : this);
