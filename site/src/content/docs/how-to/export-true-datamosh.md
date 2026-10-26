---
title: Export with True datamosh
sidebar:
  label: True datamosh export
---
Remove keyframes from a rendered WebM file to smear motion across cuts. This pass is separate from the **Datamosh** preview effect.

Use WebM with VP8 or VP9. The current **Device** selector offers VP8. True datamosh does not process H.264 MP4. Seeking in a moshed file is imprecise, so keep a clean export when you need accurate seeking.

## Enable the export pass

1. In **Plugins**, enable **OpenZoid Legacy**.
2. If a composition is open, return to **Main**.
3. Open **Export**, then **Device**.
4. In **Format**, select **.webm (vp8/opus)**.
5. Set the other [export options](/docs/reference/export-options/).
6. In **True datamosh**, select **full video** or **at clip cuts**. To keep the clean export path, leave **off** selected.
7. Click **Start**.
8. Wait for the render and the **True datamosh...** pass to finish.
9. Read the result note before clicking **Download your video**.

With **full video**, the pass keeps the first video keyframe and removes later keyframes. With **at clip cuts**, it removes later keyframes within 300 ms of video-clip starts and ends.

## Check the result

On success, the filename is `video-moshed.webm`. The note starts with `TRUE MOSH: dropped` and reports the number of removed keyframes. If that count is zero, try **full video** or change the clip boundaries.

If **at clip cuts** finds no clip boundaries, the pass delivers the original file and filename. The note reads `True mosh: no clip cuts to mosh. Clean render delivered.`

If the pass fails, the finished page offers the clean render with its original filename. Read the failure note before downloading. To obtain a clean file deliberately, export again with **True datamosh** set to **off**.

To cancel during the pass, click **Cancel**. After cancellation, no moshed file and no finished page are delivered. Start a new export when you are ready.

## Use the preview effect separately

To design a repeatable effect in the viewport, add **Datamosh** to a layer. Use [OpenZoid Legacy](/docs/how-to/use-legacy-effects/) for its setup window. That effect does not enable **True datamosh**, and the export pass does not add a preview effect.
