# CM3 bug analysis: audio position desync

Runtime inspected: the Git-ignored CM3 cache (`.zoidium-resources/`), specifically

- `ui-1.0.72.js` (single-line minified) — editor playback engine and schedules
- `core-1.0.102.js` — export/render pipeline (`PZ.export`)
- `worker/av.js` and `worker/av_init.js` — remux/encode worker bridge

The user-visible report is two-part:

1. an exported render drops roughly one audio frame somewhere near the end;
2. in the editor, starting playback near the end of an audio clip plays
   something that does not match the playhead.

Part 2 is diagnosed and fixed in the extension layer
(`plugins/core/playback-seek-sync.js`). Part 1 is narrowed to the export audio
feed, with a shipped recorder for the remaining step
(`plugins/core/export-audio-trace.js`); see "Export path" below.

Both come back to the same subsystem: CM3 drives the editor playhead from an
`HTMLMediaElement` (`el.currentTime`) and only ever repositions that element
when the *schedule item changes*.

## How the editor clock works

`PZ.ui.playback.prototype.update` (`ui-1.0.72.js`) does not advance the playhead
from wall time. When a schedule is the sync source it recomputes the frame
straight from the media element:

```js
// PZ.ui.playback.prototype.update
if (this.syncSchedule && this.syncSchedule.currentItem &&
    !this.syncSchedule.currentItem.clip.properties.time.animated) {
  let e = this.syncSchedule.currentItem.clip,
      t = e.properties.time.keyframes[0].value,
      i = e.length / (e.properties.time.keyframes[1].value - t) / this.frameRate;
  this._exactFrame = e.start + (this.syncSchedule.el.currentTime - t) * this.frameRate * i;
} else {
  this._exactFrame += t;   // wall-clock advance
}
```

`syncSchedule` is claimed by the first schedule that starts playing
(`updateSchedule`: `null === this.syncSchedule && (this.syncSchedule = e)`), so
with an audio track present the **audible media element is the master clock**.
The playhead is correct if and only if `el.currentTime` corresponds to the
requested timeline frame.

CM3 even ships an overlay that measures exactly this (`PZ.ui.playbackDebug`):

```js
PZ.ui.playbackDebug.prototype.calculateDesync = function (e) {
  var t = e.currentItem.offset / this.editor.playback.frameRate;
  return e.el.currentTime - t - this.editor.playback.currentTime;
};
```

## Bug — the media element is never repositioned on seek

### Root cause

`PZ.schedule.prototype.update` (core-1.0.102.js) only assigns `el.src` and
`el.currentTime` **when the current item changes**:

```js
PZ.schedule.prototype.update = function (e, t) {
  var r = this.currentItem;
  if (!r || r.start + r.length <= e || r.start - this.padding > e) {
    ... // pick this.index, then:
    (i = this.items[this.index]).start - this.padding <= e && i.start + i.length > e
      ? (this.currentItem = i,
         this.el && (this.el.src = this.currentItem.media.url,
                     this.el.currentTime = this.currentItem.clip.properties.time.get(0)),
         ...)
      : this.currentItem = null;
  }
};
```

Seeking inside a clip leaves `currentItem` unchanged, so the branch is skipped
and `el.currentTime` is never set to the scrubbed position.

`updateSchedule` (ui-1.0.72.js) then starts playback from wherever the element
happens to be:

```js
if (e.playing) {
  let r = e.el.currentTime - n,                                  // drift vs. expected
      a = e.currentItem.clip.properties.time.get(s + t),         // resync target
      o = .5;
  if (Math.abs(r) < o) {
    let s = (a - n) / t * i * this.speed,
        o = r - e.oldTimeDiff,
        l = (Math.max(40 * o, 1), s);                            // dead computation
    Math.abs(e.el.playbackRate - l) > .01 && (e.el.playbackRate = l), ...
  } else e.el.currentTime = a, ...                               // hard resync
  e.oldTimeDiff = r;
} else e.el.play(), e.playing = !0, ...                          // start from current position
```

Two concrete defects live here:

- The drift term is computed and **discarded**. `l` takes only `s`. The
  `Math.max(40 * o, 1)` expression must have been a rate correction; as shipped
  it is unreachable dead code, so small drift is never corrected.
- The hard-resync target `a` is `time.get(s + t)`, where `s` is a **frame**
  offset (`this._exactFrame - currentItem.start`) and `t` is the per-tick frame
  delta (~`frameRate/60`, so ~0.5 at 30fps). `t` is therefore added in *frames*,
  not media time. `s + t` overshoots the intended frame by roughly one media
  second at 30fps, and near the end of a clip it clamps to the last media
  position — the very edge where an element reports `ended`.

### Reproduction

`PZ.ui.timeline.prototype.setFrame` is the scrub path:

```js
this.editor.playback.speed = 0,
this.editor.playback.currentFrame = Math.max(Math.min(t, i - 1), 0);
```

Script: place a 10 s song at frame 0 of a 30 fps timeline (300 frames), let the
element load at frame 0, scrub to frame 285 (t = 9.5 s), then play. Running the
extracted `PZ.schedule.prototype.update`, `PZ.ui.playback.prototype.update` and
`updateSchedule` against an instrumented media element gives:

| step | timeline | `el.currentTime` | element seeks |
| --- | --- | --- | --- |
| load at frame 0 | 0.000 s | 0.000 s | — |
| scrub to frame 285 | 9.500 s | 0.000 s | none |
| play, 1 tick | 9.500 s | 0.000 s | none |
| play, 8 ticks | 9.500 s | 0.233 s | none |

The element is never seeked, so the playhead parks at 9.5 s while the song
audibly plays from 0 s — 9.27 s of separation by the eighth tick, exactly the
`playbackDebug` "desync" readout. The playhead only moves again when the element
itself ends, which is why the defect is most visible when starting from the end
of a clip. A second, related path reaches the same state: an item is
"current" from `start - padding` (padding is 60 frames = 2 s at 30 fps), and
while `this._exactFrame - e.currentItem.start < 0` `updateSchedule` returns
early and never plays; playback then begins from the element's stale position.

### Why it is easy to miss

Watching the audio waveform is misleading here: the preview *sounds* consistent
because the audible element is internally continuous. Only the relationship
between the element and the playhead (what `playbackDebug` plots) is wrong.
Seeking *outside* the audio clip and letting playback reach it does reposition
the element, so a project whose audio clips are short relative to the audible
range hides the bug.

## Export path: no equivalent media-element clock

`PZ.export` renders audio offline rather than from media elements, and the
timeline arithmetic there is unit-consistent. The relevant contracts, verified
against the bundled worker glue:

- `_remux(name_ptr, startTime, duration, typeMask)`; `startTime` and `duration`
  are **media seconds**, and the returned `offset` is the actual output start.
  `PZ.export.prototype.remuxAudio` compensates with
  `e.startOffset = Math.max(e.offset - r.offset, 0)`.
- `analyzeSegment` sets `length` to the media span of the clip inside the render
  window (`t - e`, seconds) and `playbackRate` to frames per media second
  (`(time(length) - time(0)) / length * rate`).
- `renderAudioSegment` uses `l.length / l.playbackRate` as the wall-clock
  duration, which equals that same media span, so it matches the decoded buffer
  length. Confirmed against a real Web Audio implementation
  (`node-web-audio-api`): `AudioBufferSourceNode.start(when, offset, duration)`
  takes `duration` in buffer seconds and plays at most to the end of the buffer;
  a 10 s `duration` on a 1 s buffer plays exactly 1 s, and `offset` past the
  buffer end yields silence.

Two real but narrower export-path defects were found while checking this:

- `ISNODE` override of `renderAudioSegment` (core-1.0.102.js) ignores
  `startOffset` entirely — its sample index is
  `Math.floor((r - segmentOffsetSamples) * playbackRate)` with no
  `+ startOffset * sampleRate`. Whenever the remuxer's output offset is
  non-zero (keyframe seek), the node/server render plays the wrong samples.
  The browser path does compensate.
- In the encoder audio-feed callback, the transfer-buffer views are built with
  the clamped count (`new Float32Array(buf, ptr, r)` with
  `r = min(bufferRemaining, t.num)`) but the worker copies the **full** per-channel
  region back into the wasm heap (`worker/av.js` `gotCallback` loops
  `_xfer_ptrs[t+1] - _xfer_ptrs[t]`). A short chunk therefore re-sends whatever
  the ring buffer held from the previous round trip instead of silence.
  Instrumenting `getAudioSamples` shows the normal path always returns a full
  segment (`r = min(250 * num, totalSamples - sample)`), so this only triggers
  when the final segment is shorter than one requested frame — the tail case.

### Measured with the real worker and the real encoder

The bundled worker and encoder can both be driven outside the browser, which
turned assumptions into measurements:

- **`_remux` offset (real `av.wasm` in Node).** For every window tried
  (0 s whole file, 0.5 s and 1 s windows from several starts, and a one-frame
  window), the returned `offset` is *exactly* the requested `startTime`, and the
  returned PCM is sample-exact from that position — verified against a source
  whose sample values encode the absolute frame index
  (`firstMismatchAt=-1` for every case). The remuxer also returns **trailing
  padding**: `+1600` frames for a 0.5 s/30 fps request, `+1472` for a one-frame
  request, `+1152` for a 1 s request, and none when the window reaches the end of
  the file. The renderer consumes `duration` seconds, so this padding is inert
  for content, but it is why the returned buffer is not a dependable length.
- **End-to-end sample check.** Concatenating the output of the real
  `analyzeSegment` / `renderAudioSegment` / `getAudioSamples` for a 10 s clip
  gives **0 mismatched samples** out of 480 000 against the ideal timeline. The
  browser export path builds exact audio; it cannot drop or repeat a frame.
- **Encoder request accounting.** Modelling the feed across sequence rates of
  24, 25, 29.97, 30, 50, 60 and 120 fps against both render rates shows the
  encoder always receives exactly the samples it asked for (`drift=0`) and the
  sequence clock always lands on `totalSamples`. No drift mechanism exists in
  `PZ.export` or `PZ.av.encode`.
- **Encoder timestamps (real `av.wasm`).** Driving `ffmpeg_run` with the real
  options and a synthetic source produces a matroska file whose audio packets
  carry PTS `-7`, `14`, `14`, `14, ...` — the second packet and everything after
  it repeat the same timestamp while `libopus` logs `Queue input is backward in
  time`. A 20 ms Opus frame should step 960 units in the 1/48000 time base. This
  is the only measured anomaly that can compress beat spacing, but the harness
  feeds the encoder through deferred callbacks rather than the worker's
  transfer-buffer handshake, so it must be confirmed in a real browser export
  before being called the cause. The recorder below reports the inputs that
  decide it.

### Shipped recorder for the remaining step

`plugins/core/export-audio-trace.js` (hidden core script, off unless
`localStorage["zoidium:export-audio-trace"] === "1"`) records the two seams that
a one-frame tail defect has to pass through:

- every `PZ.export.getAudioSamples` call: requested frames, segment start,
  samples remaining in the sequence, and the length actually rendered;
- every encoder `"audio"` message: frames requested, samples still available in
  the rendered segment, how many were filled, and the leftover count that the
  worker will take from the ring buffer instead.

`ZoidiumExportAudioTrace.report()` prints both, plus a `SHORT FEEDS` section.
A short feed is the fingerprint of the one defect that can drop exactly the last
few samples: `PZ.av.encode` builds the transfer views with the clamped count
(`new Float32Array(buf, ptr, r)` where `r = min(bufferRemaining, t.num)`) while
`worker/av.js` `gotCallback` copies the **full** per-channel region
(`_xfer_ptrs[ch+1] - _xfer_ptrs[ch]`) into the wasm heap, so the unwritten tail
is whatever the previous round trip left there rather than silence.

Instrumenting `getAudioSamples` in a model of the feed shows the normal path
always renders a full segment (`r = min(250 * num, totalSamples - sample)`), so
that tail is only reachable when `totalSamples - sample < num` at the very end.
The recorder exists to confirm whether any real export reaches it, and with what
segment arithmetic.

### What is ruled out

- **Remux duration and position**: measured above — offset equals the requested
  start, content is sample-exact, and any extra frames are trailing padding.
- **The offline renderer's units**: `l.length / l.playbackRate` is a wall-clock
  duration that matches the rendered buffer exactly, verified against a real Web
  Audio implementation. An earlier reading of this line as a sample-count-vs-
  seconds mismatch was wrong; `length` is the window's media span, not the
  clip length.
- **Sample-count rounding**: both export frame rates (30/60) divide 48 kHz
  exactly, and the request accounting above shows zero drift for non-matching
  sequence rates too.
- **Segment concatenation**: the end-to-end check above is sample-exact, so the
  export cannot lose the one frame the report describes inside `PZ.export`.

### Suggested next probe

The audio CM3 hands to the encoder is provably exact, so the remaining candidates
are the encoder's own timestamps and the muxer. With the recorder enabled, export
a project that reproduces the click and check `report()`:

1. `SHORT FEEDS` present → stale ring-buffer data reached the encoder; the fix is
   to zero-fill the transfer region beyond `r` (or copy only `ret` samples in
   `worker/av.js` `gotCallback`).
2. `SHORT FEEDS` absent and every segment `rendered` equals its request → the
   defect is downstream of `PZ.export`. Export the same project to `.mkv` and run
   `ffprobe -select_streams a -show_entries packet=pts_time,size` on it: audio
   packet timestamps that step by anything other than 0.02 s confirm the encoder
   timestamp anomaly measured above.
3. Segments whose `rendered` is smaller than the request → the renderer ran out
   of sequence; the tail belongs to the encoder draining its queue.

## Fix (extension layer)

`plugins/core/playback-seek-sync.js` keeps the native clock and adds only the
missing reposition:

- `PZ.ui.playback.prototype.currentFrame` is wrapped to mark a schedule when the
  editor requests a frame. A whole-frame request further than 2.5 frames from
  the engine's stored position is a seek; the fractional per-tick clock writes
  are not.
- `PZ.schedule.prototype.update` is wrapped to call the native update, record the
  position it moved to, and then move `el.currentTime` to
  `clip.properties.time.get(exactFrame - item.start)` when a seek is pending.
  The padding window (playhead before `item.start`) keeps the seek pending, so
  the element is repositioned exactly when playback reaches the item.
- Writes within half a frame of the target are skipped so normal playback never
  thrashes the element, and `currentItem.offset` is kept in step for the benefit
  of `PZ.ui.playbackDebug` and `updateSchedule`.

Verified by `test/playback-seek-sync.test.js` (fixture) and
`test/playback-seek-sync-cm3.test.js`, which extracts the real
`PZ.schedule.prototype.update` from the cached bundle and shows both that the
native function leaves the element behind on a scrub and that the patched one
does not.

## Affected bundles

- `ui-1.0.72.js` — `PZ.schedule.prototype.update`,
  `PZ.ui.playback.prototype.updateSchedule`, `PZ.ui.playback.prototype.update`,
  `PZ.ui.playbackDebug.prototype.calculateDesync`
- `core-1.0.102.js` — `PZ.export.prototype.analyzeSegment` /
  `renderAudioSegment` / `getAudioSamples` / `remuxAudio`,
  `PZ.av.encode` audio-feed callback
- `worker/av.js` — `gotCallback`

All of it is CM3 core, not Zoidium. The seek fix ships as a prototype patch of
the kind `plugins/core/composite-video-materials.js` and
`plugins/core/project-media-fps.js` already install; the export feed remains
unpatched pending the recorder's evidence.

Note that the 30 fps import assumption in `PZ.ui.media.prototype.loadAudio` /
`loadVideo` (`Math.floor(30 * t.duration)`) is **already** corrected by
`plugins/core/project-media-fps.js`, so it is not a candidate for either report.
