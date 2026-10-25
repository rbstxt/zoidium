---
title: Export options
---
The **Device** page exports video. **Single frame capture** exports the playhead frame. Precomp+ blocks both paths while a composition is open.

## Formats and alpha

The current local format choices are listed below. VP9 support in the True datamosh parser does not add a VP9 choice to **Device**.

| Output | Video or image encoding | Audio | Alpha |
| --- | --- | --- | --- |
| **.mp4 (H.264 / AAC or Opus)** | H.264 through MP4 Export | AAC preferred, Opus fallback | No |
| **.mkv (vp8/opus)** | Native VP8 path | Opus | No Zoidium alpha guarantee |
| **.webm (vp8/opus)** | Native VP8 path | Opus | No Zoidium alpha guarantee |
| **.png** | Browser PNG image | None | Yes, for transparent rendered pixels |
| **.jpg** | Browser image encoder | None | JPEG has no alpha. See the browser fallback below. |
| **.webp** | Browser WebP image | None | Yes, when the browser supports WebP encoding |

The image encoder passes the selected MIME type to the browser. The **.jpg** path requests `image/jpg`. A browser can fall back to PNG for an unsupported MIME type, while the filename remains `image.jpg`. The **.webp** path also depends on browser encoder support.

**black fill** adds opaque black bars, including for PNG and WebP. A format's alpha support does not make an opaque project background transparent.

## Frame rate

**Frame rate** accepts decimal values from 1 to 240 FPS. Values outside this range are clamped. An invalid value retains the previous rate.

The export rate changes the number and sampling times of output frames. It preserves the sequence duration and does not change the project frame rate.

## Quality and bitrate

**Bitrate** offers **1x (default)**, **2x**, **4x**, and **8x**. These values multiply the encoder's target video bitrate. They are not values in kbit/s. **1x (default)** leaves the native target unchanged.

The native bitrate target depends on output area and uses a further factor of 1.5 above 30 FPS. **Quality** changes native encoding settings. For MP4, the **Quality** selector is disabled and the initial profile remains the bitrate base.

For still images, **Quality** has **very low**, **low**, **good**, **very good**, and **best** choices. The browser receives a quality value from 0 to 1. PNG encoding does not use lossy quality.

## Resolution and aspect ratio

**Resolution** offers 426×240, 640×360, 854×480, 1280×720, 1920×1080, 2560×1440, and 3840×2160 presets. Frame capture also retains the project resolution as a choice when it differs from these presets.

**Aspect ratio** sets the output width-to-height ratio. The sizing path retains the selected resolution's longer edge and derives the other edge from the ratio. It rounds both dimensions to even values. A portrait ratio therefore makes the longer edge vertical.

**Device** starts at 16:9. Frame capture starts at the project aspect ratio.

| **Aspect ratio mode** | Result |
| --- | --- |
| **crop** | Fills the output. Content outside the output bounds is cropped. This is the default. |
| **black fill** | Fits the whole project image inside the output. Remaining space is opaque black. |

If an odd dimension reaches MP4 encoding, MP4 adds one black pixel on the right or bottom. This padding does not scale the rendered image.

## MP4 audio and storage

When scheduled audio is present, MP4 probes AAC-LC first and Opus second. Both use 48 kHz stereo at 128 kbit/s. With no scheduled audio, MP4 writes no audio track.

AAC requires a local encoder and decoder timing check. A calibration failure stops the export. It does not silently select Opus after calibration fails. Opus in MP4 requires a compatible player.

MP4 uses a writable private browser file when available and Blob chunks otherwise. Browser memory or disk limits can stop either path. Source audio is decoded in full per active asset. MP4 removes temporary files after success, cancellation, or failure.

## Failure diagnostics

Graphics-context loss stops export with the output index, project frame, time, and stage in the error. Video decode failures identify the clip, requested media time, output frame, and decode stage. The failed export does not resume.

[Export an MP4](/docs/features/mp4-export/) contains recovery steps. [Export a frame](/docs/how-to/export-frame/) covers still capture. [True datamosh export](/docs/how-to/export-true-datamosh/) covers the optional WebM pass.
