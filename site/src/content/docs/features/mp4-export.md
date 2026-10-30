---
title: Export an MP4
sidebar:
  label: MP4 export
---
Export an opaque H.264 movie through **Device**. If you are editing a composition, return to **Main** before exporting.

## Set the output

1. In **Plugins**, enable **MP4 Export**.
2. Open **Export**, then **Device**.
3. In **Format**, select **.mp4 (H.264 / AAC or Opus)**.
4. Set **Resolution**, **Aspect ratio**, and **Aspect ratio mode**.
5. Set **Frame rate** between 1 and 240 FPS.
6. Set **Bitrate**. Start with **1x (default)**. For a higher target bitrate, select **2x**, **4x**, or **8x**.
7. Click **Start**.
8. When **Render complete** appears, click **Download your video**.

The **Quality** presets are disabled for MP4. Use **Bitrate** to change MP4 quality. The [export options reference](/docs/reference/export-options/) describes sizing and format limits.

H.264 output has no alpha channel. If you need a transparent still, use [frame capture](/docs/how-to/export-frame/) with PNG or WebP. When an odd output dimension reaches the MP4 encoder, it adds one black pixel on the right or bottom.

## Check audio playback

If the project has scheduled audio, MP4 prefers AAC. When AAC encoding is unavailable, MP4 uses Opus. If your player cannot play Opus in MP4, try another player or export MKV or WebM.

If MP4 reports an AAC timing-calibration error, try the desktop app or MKV or WebM. If an audio asset cannot decode, convert that asset to WAV and replace it before retrying.

## Recover from a failed render

If H.264 is unavailable at the requested size and frame rate, reduce **Resolution** or **Frame rate**. You can also try Google Chrome, the desktop app, MKV, or WebM.

If the message starts with `WebGL context lost at output index`, record the output index, project frame, time, and stage. Save the project before reloading the editor. Start a new export. The failed export cannot resume. If the failure repeats, reduce the output size or the project's render workload.

If the message starts with `Video decode failed for clip`, record the clip name, requested media time, output frame, and stage. Check that clip's source in [Assets](/docs/how-to/repair-assets/). Reload or replace the source, then start a new export.

## Cancel or free storage

To stop a render, click **Cancel**. Wait for cleanup before starting another export. Cancellation produces no completed MP4.

MP4 uses temporary storage during the render, which can consume memory or disk space. Temporary files are removed after success, cancellation, or failure.

If the error reports exhausted memory or temporary storage, close other projects or reduce the output size before retrying. Long source audio can require substantial memory even for a short export.
