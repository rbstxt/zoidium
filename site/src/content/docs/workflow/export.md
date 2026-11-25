---
title: Exporting video, audio, and frames
description: Export H.264 MP4, WebM, MKV, WAV, M4A, and still images. Set up transparent exports or True datamosh.
---
Use **Export > Device** to render video or audio. Use **Export > Single frame capture** to save the playhead frame as a still image.
If a **Precomp+** composition is currently open, click **Back to Main** before opening **Export**. Both export paths are blocked while a source composition is active.

## Export a video (MP4, WebM, or MKV)

**MP4 Export** is enabled by default and requires WebCodecs encoder support in your browser or the desktop app.

1. Open **Export**, then **Device**.
2. In **Format**, select **.mp4 (H.264 / AAC or Opus)**, **.webm (vp8/opus)**, or **.mkv (vp8/opus)**.
3. Set **Resolution**, **Aspect ratio**, and **Aspect ratio mode**.
4. Set **Frame rate** from `1` to `240` FPS.
5. Set **Bitrate** (**1x (default)**, **2x**, **4x**, or **8x**). Each option shows the target video bitrate for your chosen resolution and frame rate, not a guaranteed rate.
6. Click **Start**.
7. When **Render complete** appears, click **Download your video**.

For MP4, the **Quality** selector is disabled; use **Bitrate** to control video quality.
H.264 MP4 has no alpha channel. If an odd output dimension reaches the MP4 encoder, it pads one black pixel on the right or bottom.

### MP4 progress preview

While an MP4 export runs, the progress page shows the last finished frame above a status line with `percent% (n of N)`, **Elapsed**, and **Remaining**. **Remaining** displays `—` until five frames finish.

Clear **Show preview** to turn the preview off during export. The browser saves this choice locally. The exported MP4 file is identical whether **Show preview** is on or off. This progress preview applies to MP4 exports only.

## Export audio only

**MP4 Export** adds the WAV and M4A formats to **Device**.

1. Open **Export**, then **Device**.
2. In **Format**, select **.wav (16-bit PCM)** or **.m4a (AAC)**.
3. Click **Start**.
4. When **Render complete** appears, click **Download your audio**.

Both formats use 48 kHz stereo. WAV writes uncompressed 16-bit PCM. M4A requires AAC and encodes at 128 kbit/s. If your browser cannot start AAC encoding, select **.wav (16-bit PCM)**.

Audio export uses the same range and mix as MP4, including track mute, audio solo, and Precomp+ audio. If the export range has no audio, the file contains silence for that duration.

## Export a single frame as an image

1. Move the playhead to the frame you want to capture.
2. Open **Export**, then **Single frame capture**.
3. Set **Resolution** (starts at the project resolution) and **Aspect ratio** (starts at the project aspect ratio).
4. Set **Aspect ratio mode** to **crop** (fill output and crop edges) or **black fill** (fit full frame with opaque black bars).
5. In **Format**, choose **.png**, **.jpg**, or **.webp**.
6. For **.jpg** or **.webp**, set **Quality** (**very low**, **low**, **good**, **very good**, or **best**). PNG ignores lossy quality.
7. Click **Start**, then click **Download your image**.

These sizing controls affect the captured image only; they do not change project resolution. Downloads run directly in the current editor tab.

## Export with a transparent background

1. Open **Export**, then choose **Single frame capture** for images or **Device** for video.
2. In **Format**, select **.png** or **.webp** for images. For video, select **.webm (vp8/opus)** or **.mkv (vp8/opus)**.
3. When **Transparent background** appears, select it and click **Start**.

The checkbox starts unchecked each time you open the options. A solid scene backdrop or an opaque layer still covers the pixels behind it. **black fill** adds opaque black bars.

## Formats, alpha, and audio

| Format | Encoding | Audio | Alpha |
| --- | --- | --- | --- |
| **.mp4 (H.264 / AAC or Opus)** | H.264 video | AAC preferred, Opus fallback | No |
| **.mkv (vp8/opus)** | VP8 video | Opus | With **Transparent background**, when VP8 alpha encoding is available |
| **.webm (vp8/opus)** | VP8 video | Opus | With **Transparent background**, when VP8 alpha encoding is available |
| **.wav (16-bit PCM)** | None | 16-bit PCM | No |
| **.m4a (AAC)** | None | AAC | No |
| **.png** | PNG image | None | With **Transparent background** |
| **.jpg** | JPEG image | None | No |
| **.webp** | WebP image | None | With **Transparent background**, when WebP encoding is available |

Enable **MP4 Export** to use transparent MKV and WebM. VP8 compression can change alpha values. Use a player or editor that supports VP8 alpha to view the transparency.
- **MP4 audio:** Encoded at 48 kHz stereo, 128 kbit/s. If the project has no scheduled audio, MP4 writes no audio track. When AAC encoding is unavailable, MP4 falls back to Opus (some players need MKV, WebM, or a player that supports Opus in MP4). If the AAC timing-calibration check fails, export stops rather than silently switching to Opus; try the desktop app, MKV, or WebM. If an audio asset fails to decode, convert it to WAV and replace it in [Assets](/docs/workflow/assets/).

## Resolution, aspect ratio, frame rate, and bitrate

- **Presets:** 426×240, 640×360, 854×480, 1280×720, 1920×1080, 2560×1440, and 3840×2160. Single frame capture also preserves the project resolution if it differs from those presets. **Device** starts at 1920×1080 and 16:9 when no preference is stored.
- **Custom resolution (Device):** Select **Custom** in **Resolution** and enter exact **Output size (px)** values such as `3440×1440` or `2560×1080`. Both dimensions must be even integers from `2` to `8192`, with at most `33,554,432` total pixels. Invalid dimensions show a message and block **Start**. Actual encoder limits still depend on your browser, format, and frame rate.
- **Aspect ratio:** Keeps the longer edge from **Resolution** and calculates the other edge from the ratio, rounded to an even pixel count. A portrait ratio makes the longer edge vertical. In **Custom**, width and height set the ratio, and editing **Aspect ratio** recalculates custom dimensions from the same longer edge.
- **Aspect ratio mode:** **crop** (default) fills the output and crops excess edges. **black fill** fits the whole image inside opaque black bars.
- **Saved preferences:** The browser remembers your Device resolution, custom size, aspect ratio, and aspect ratio mode across sessions without changing saved projects.
- **Frame rate:** Accepts decimal values from `1` to `240` FPS (clamped if out of range; non-numeric input keeps the previous value). Changing export FPS changes output frame count and sampling without changing sequence FPS, duration, `fps`, or `zFps`.
- **Bitrate:** **1x (default)**, **2x**, **4x**, and **8x** multiply the encoder's target video bitrate (for example, **1x (default): 9 Mbps target** at 1920×1080 and 30 fps) and update live as you change resolution or frame rate.

MP4 export uses variable bitrate, so **Bitrate** sets the encoder's target, not a guaranteed rate. Simple, dark, or mostly static footage encodes well below the target, while detailed, fast-motion footage can exceed it. With a 128 Mbps target, slow shapes on a dark background encode at about 6 Mbps, and full-frame moving noise reaches about 233 Mbps. A higher setting still gives detailed frames more room and adds no unneeded data, so expect a media-info tool to report a bitrate below the target for simple footage.

## Export with True datamosh (WebM)

**True datamosh** strips video keyframes from a rendered WebM file to smear motion across cuts. It is separate from the **Datamosh** preview effect in [OpenZoid Legacy](/docs/effects/openzoid-legacy/).
It works on WebM (VP8 or VP9; **Device** outputs VP8) and does not process H.264 MP4. Seeking in a moshed file is imprecise, so keep a clean export if you need accurate scrubbing.

1. In **Plugins**, enable **OpenZoid Legacy**.
2. Return to **Main** if a composition is open.
3. Open **Export**, then **Device**.
4. Set **Format** to **.webm (vp8/opus)** and configure the other export options.
5. Set **True datamosh** to **full video** (keeps only the first video keyframe and strips all later keyframes) or **at clip cuts** (strips later keyframes within 300 ms of video clip starts and ends). Leave it at **off** for a clean render.
6. Click **Start** and wait for both the render and the **True datamosh...** pass to finish.
7. Read the result note before clicking **Download your video**.

- **Success:** Outputs `video-moshed.webm` with a note starting with `TRUE MOSH: dropped` showing the removed keyframe count. If the count is `0`, try **full video** or adjust clip boundaries.
- **No clip cuts found:** With **at clip cuts**, delivers the original file and filename with `True mosh: no clip cuts to mosh. Clean render delivered.`
- **Pass failure:** Offers the clean render under its original filename with a failure note.
- **Cancel:** Clicking **Cancel** during the pass delivers no file and no finished page.

## Cancel, storage, and error recovery

- **Cancelling:** Click **Cancel** and wait for cleanup before starting another render. Cancelled renders produce no output file.
- **Temporary storage:** MP4 renders use temporary memory or disk space during encoding and delete it after completion, cancellation, or failure. Long source audio can use significant memory even for a short export. If storage or memory runs out, close other projects or lower the output resolution.
- **H.264 unavailable:** Lower **Resolution** or **Frame rate**, or switch to Chrome, the desktop app, MKV, or WebM.
- **`WebGL context lost at output index`:** Note the output index, project frame, time, and stage. Save your project before reloading the editor, then start a new export (failed renders cannot resume). If it repeats, lower output size or scene workload.
- **`Video decode failed for clip`:** Note the clip name, requested media time, output frame, and stage. Check that source in [Assets](/docs/workflow/assets/), reload or replace it, and retry.
- **Single frame capture errors:** A rejected capture opens **Render error** with the diagnostic. Repair any named source before retrying.
