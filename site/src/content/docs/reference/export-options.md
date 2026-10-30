---
title: Export options
---
The **Device** page exports video. **Single frame capture** exports the playhead frame. Precomp+ blocks both paths while a composition is open.

## Formats and alpha

The current local format choices are listed below.

| Output | Video or image encoding | Audio | Alpha |
| --- | --- | --- | --- |
| **.mp4 (H.264 / AAC or Opus)** | H.264 through MP4 Export | AAC preferred, Opus fallback | No |
| **.mkv (vp8/opus)** | Native VP8 path | Opus | No Zoidium alpha guarantee |
| **.webm (vp8/opus)** | Native VP8 path | Opus | No Zoidium alpha guarantee |
| **.png** | Browser PNG image | None | Yes, for transparent rendered pixels |
| **.jpg** | Browser JPEG image | None | No |
| **.webp** | Browser WebP image | None | Yes, when the browser supports WebP encoding |

The **.jpg** path saves JPEG bytes as `image.jpg`. The **.webp** path depends on browser encoder support.

**black fill** adds opaque black bars, including for PNG and WebP. A format's alpha support does not make an opaque project background transparent.

## Frame rate

**Frame rate** accepts decimal values from 1 to 240 FPS. Values outside this range are clamped. An invalid value retains the previous rate.

The export rate changes the number and sampling times of output frames. It preserves the sequence duration and does not change the project frame rate.

## Quality and bitrate

**Bitrate** offers **1x (default)**, **2x**, **4x**, and **8x**. These values multiply the encoder's target video bitrate. **1x (default)** leaves the native target unchanged.

The base bitrate depends on output area and frame rate. **Quality** changes native encoding settings. For MP4, the **Quality** selector is disabled and the initial profile remains the bitrate base.

For still images, **Quality** has **very low**, **low**, **good**, **very good**, and **best** choices. PNG encoding does not use lossy quality.

## Resolution and aspect ratio

**Resolution** offers 426×240, 640×360, 854×480, 1280×720, 1920×1080, 2560×1440, and 3840×2160 presets. Frame capture also retains the project resolution as a choice when it differs from these presets.

**Aspect ratio** sets the output width-to-height ratio. The sizing path retains the selected resolution's longer edge and derives the other edge from the ratio. Each dimension rounds to an even value, except at the one-pixel minimum. A portrait ratio therefore makes the longer edge vertical.

**Device** starts at 16:9. Frame capture starts at the project aspect ratio.

| **Aspect ratio mode** | Result |
| --- | --- |
| **crop** | Fills the output. Content outside the output bounds is cropped. This is the default. |
| **black fill** | Fits the whole project image inside the output. Remaining space is opaque black. |

## MP4 audio and storage

Both use 48 kHz stereo at 128 kbit/s. With no scheduled audio, MP4 writes no audio track.

If the AAC check fails, the export stops instead of switching to Opus. Opus in MP4 requires a compatible player.

Browser memory or disk limits can stop the export.

## Failure diagnostics

If the graphics context is lost, export stops with a diagnostic. Video decode failures name the clip and frame. The failed export does not resume.

For **Single frame capture**, a rejected render opens **Render error** with the diagnostic.

[Export an MP4](/docs/features/mp4-export/) contains recovery steps. [Export a frame](/docs/how-to/export-frame/) covers still capture. [True datamosh export](/docs/how-to/export-true-datamosh/) covers the optional WebM pass.
