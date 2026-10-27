---
title: Preview a heavy project
sidebar:
  label: Preview a heavy project
---
Use Player+ to edit without redrawing the viewport after every change.

## Pause drawing and inspect one frame

1. In **Plugins**, enable **Player+**.
2. In the player toolbar, click **Pause drawing**.
3. In **Preview quality**, select **1/8 quality**.
4. Load the project or make your edits.
5. Move the playhead to the frame you need.
6. Click **Render once**.
7. To restore continuous viewport updates, click **Resume drawing**.

**Pause drawing** stops viewport drawing. Use the normal playback controls when you also need to stop the playhead or audio. While drawing is paused, use **Render once** after each change you need to inspect.

## Increase preview detail

For a closer inspection, select **1/4 quality**, **1/2 quality**, or **Full quality**. Click **Render once** again. Return to **1/8 quality** before further edits if the detailed frame is expensive to draw.

These choices scale viewport pixel dimensions. They do not change project resolution or the export settings. Set the output size separately on the export page.

## Reuse frames with the preview cache

The preview cache keeps finished editor frames in GPU memory. Returning to a cached frame and project state redraws without recomputation.

1. Open **Settings**.
2. Set **Preview cache** above 0. The default is 512 MiB. A value of 0 disables caching.
3. Read the usage line below the control. It reports the counted memory and the retained frame count.

Edits, resource loads, and resolution or plugin changes invalidate the cached state. Video projects and scenes with a slow synchronous draw skip background pre-rendering, so their frames may never enter the cache. While video is visible, only the paused frame enters the cache, after the editor is idle for about 0.8 seconds. Export and eyedropper draws use separate paths and do not fill the cache. Counted memory covers RGBA8 frame bytes; allocation failure lowers a session ceiling that raising the preference cannot override. After a second GPU context loss, captures stay disabled until reload.

Cache memory and Player+ preview quality are separate controls. A larger cache does not speed up the first draw of a new frame.
