# MP4 export

Adds H.264 MP4 to the native Device render format selector. The implementation
uses the existing deterministic frame renderer, project frame-rate conversion,
aspect settings and native offline audio mixer. MKV and WebM keep their existing
export path.

The MP4 writer uses WebCodecs and the pinned Mediabunny release in `vendor/`.
Codec support is checked when rendering starts. Export options belong to the
current export page and add no saved project fields.

## Encoding and timing

- H.264 High is preferred, then Main and Baseline. The exact output dimensions,
  frame rate and bitrate are checked with `VideoEncoder.isConfigSupported` at
  export time. Video keyframes are requested every two seconds.
  MP4 uses the Bitrate control for quality. The native VP8 Quality presets
  are disabled while MP4 is selected and restored for MKV/WebM.
- Every frame goes through `PZ.export.getVideoFrame`, including sequence
  preparation, temporal rendering and aspect handling. Output frame times use
  rounded absolute microsecond boundaries, without accumulating rounding error.
  Odd dimensions receive one black padding pixel on the right or bottom.
- Audio uses CM3's `analyzeSegment` and `renderAudioSegment`, preserving source
  offsets, playback speed, volume and stereo pan. Web Audio decodes source assets
  at 48 kHz; formats it cannot read use a private instance of CM3's existing
  libav audio decoder. Mixed blocks are at most one second long.
- AAC-LC stereo at 128 kbit/s is preferred. Its selected encoder is calibrated
  locally with an impulse encode/decode round trip before rendering. Silent
  preroll protects the beginning of the track, negative packet times produce
  the MP4 edit list, and the final packet's duration trims codec padding.
  This avoids guessing encoder delay from a browser name. AAC priming is not
  reliably exposed by WebCodecs; see the
  [AAC registration](https://w3c.github.io/webcodecs/aac_codec_registration.html#priming-samples).
- If AAC encoding is unavailable, the plugin uses Opus with its codec metadata.
  A project without scheduled audio creates no audio track.

## Storage and cleanup

Mediabunny's `StreamTarget` writes to a unique OPFS temporary file where
available. A Blob-chunk target supports browsers without writable OPFS. Both
targets allow header rewrites. Ordinary MP4 with metadata at the end gives
priming edits their final duration without buffering the movie for fast start.
The movie becomes a stable Blob once, then uses `ZoidiumDownloads` and its
existing in-place download button. Electron receives the same download.

Encoded output is never accumulated in one JavaScript ArrayBuffer. The OPFS
path avoids retaining it in page memory. The fallback retains Blob chunks;
browser-managed Blob storage and the download may still consume memory or
disk. Source audio is decoded in full for each currently active asset and
released when that asset leaves the next mix block. A long source can therefore
require substantial PCM memory even for a short export.

Cancel closes encoding and calibration resources immediately, then releases
the compositor after pending native frame preparation settles. The private
audio fallback worker terminates on cancel. Temporary files are removed on
success, cancel and failure. Existing MKV/WebM methods receive their original
receiver and arguments, and never enter this pipeline.

## Limits

WebCodecs codec support depends on the browser, operating system, size and rate.
An unsupported H.264 configuration produces one error page and restores the
editor. AAC also needs a working decoder for timing calibration. Opus in MP4
requires a compatible player. Hardware encoder failures, memory exhaustion and
temporary storage exhaustion can still prevent an export.

MP4 stores opaque H.264 video. Use existing image or video formats when another
pixel format is needed. Fast-start playback before a download completes is not
provided. This plugin changes no renderer, project data, object properties or
undo entries. See `docs/project-compatibility.md`.
