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

To reuse completed preview frames, configure the [preview cache](/docs/features/preview-cache/). Cache memory and Player+ preview quality are separate controls.
