---
title: Fix common problems
sidebar:
  label: Troubleshooting
---
Each entry names a symptom, its cause, and the fix.

## Material panel shows "undefined" or blank values

**Cause:** the material panel failed while loading under the Zoidium gradient editor. The current beta falls back to the standard control instead of stopping the panel.

**Fix:** reload the editor and reopen the panel. If the panel still fails, switch the gradient editor:

1. Open **Settings**.
2. Set **Gradient editor** to **Classic**.
3. Reload the editor.

## Smart Motion Blur looks like it does nothing on particles

**Cause:** the effect found no motion between neighboring frames. Identical neighbors copy the input exactly, as does a zero **Blur Amount** or **Motion Sensitivity**. An effect on an **Adjustment** layer above a 3D Scene also misses the shutter path, which only runs on the Scene layer itself.

**Fix:**

1. Put **Smart Motion Blur** on the **3D Scene** layer with **Reconstruction** at **Automatic**.
2. Keyframe the particle **Time** property so the simulation advances between adjacent frames.
3. Step one frame forward and back to confirm the particles move.
4. Check that **Blur Amount** and **Motion Sensitivity** are above zero.

[Blur particles and scenes](/docs/how-to/motion-blur-particles-scenes/) describes the full setup.

## Preview cache shows 0 frames

**Cause:** nothing eligible has been cached yet, caching is off, or the project cannot be cached. **Settings** reports the counted memory and retained frame count below the **Preview cache** control. When the project cannot be cached, the same line ends with **Not caching:** and the reason.

**Fix:**

1. Read the reason after **Not caching:** in **Settings**. A larger **Preview cache** value does not change it.
2. Open **Settings** and set **Preview cache** above 0. The default is 512 MiB.
3. Draw the frame normally first. Returning to the same frame and project state reuses it.
4. Avoid edits, resource loads, and resolution or plugin changes between visits. Each invalidates the cached state.
5. Expect no background caching for video projects and slow scenes. They skip pre-rendering. While video is visible, only the paused frame is cached, after the editor is idle for about 0.8 seconds.
6. If allocation failed earlier, the session ceiling stays lowered even after raising the preference. After a second GPU context loss, reload the editor to re-enable captures.

## An export refuses because of missing or failed plugins

**Cause:** the project uses community effects, and community effect export is unavailable in the developer preview.

**Fix:** approve the one-export bypass when the editor offers **Export with missing or failed plugins**. The export skips every community effect at every frame, including effects in closed compositions. Project records stay unchanged, and the choice applies to one export only. Install or repair the missing package for a complete export.

## A project opens with missing plugins or assets

**Cause:** a plugin that the project needs is disabled, or an asset file is gone.

**Fix:**

1. If the editor names a required plugin, enable it in **Plugins**. Saved effect, material, and object settings return with the plugin.
2. For missing or failed files, follow [Repair assets](/docs/how-to/repair-assets/). Reconnect the files before exporting or saving a new archive.
3. Save the repaired project under a new archive and keep the earlier one until the copy checks out.

## The editor is slow or runs out of GPU memory

**Cause:** the viewport redraws a heavy scene at full size on every change.

**Fix:**

1. In the player toolbar, click **Pause drawing** and select **1/8 quality**.
2. Use **Render once** after each change you need to inspect.
3. Raise the **Preview cache** limit in **Settings** so revisited frames redraw from memory.
4. If the GPU reports exhausted memory or context loss during export, close other projects and reduce the output size before retrying.

[Preview a heavy project](/docs/how-to/preview-heavy-project/) describes the full workflow.

## Attach the debug log to a bug report

**Cause:** a report without environment detail is hard to reproduce.

**Fix:**

1. Open **Settings**.
2. In the **Debug information** section, click **Download debug log**.
3. Review the file, then attach it to the report. It records the OS, browser, enabled plugins, and recent crash evidence. Project content is not included.
