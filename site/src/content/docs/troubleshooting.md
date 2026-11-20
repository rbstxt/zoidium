---
title: Troubleshooting
description: Causes and fixes for common editor, material, motion blur, cache, asset, and export problems.
---
Each entry lists a symptom, its cause, and how to fix it.

## Material panel shows "undefined" or blank values

**Cause:** The material panel failed while loading under the Zoidium gradient editor.

**Fix:** Reload the editor and reopen the panel. If the panel still fails, switch to the classic gradient editor:

1. Open **Settings**.
2. Set **Gradient editor** to **Classic**.
3. Reload the editor.

## Smart Motion Blur looks like it does nothing on particles

**Cause:** The effect found no motion between neighboring frames. Identical neighbor frames copy the input unchanged, as does a zero **Blur Amount** or **Motion Sensitivity**. Placing **Smart Motion Blur** on an **Adjustment** layer above a 3D Scene also skips the shutter-sample path, which runs automatically only on the **3D Scene** layer itself.

**Fix:**

1. Put **Smart Motion Blur** on the **3D Scene** layer with **Reconstruction** set to **Automatic**.
2. Keyframe the particle **Time** property so the simulation advances between adjacent frames.
3. Step one frame forward and one frame back to confirm the particles move.
4. Check that **Blur Amount** and **Motion Sensitivity** are above zero.

See [Motion blur](/docs/effects/motion-blur/) for the full setup.

## Preview cache shows 0 frames

**Cause:** No eligible frame has been drawn yet, caching is turned off, or the current project cannot be cached.
**Settings** displays the counted memory and retained frame count below the **Preview cache** control. When caching is disabled for the project, that line ends with **Not caching:** and the reason.

**Fix:**

1. Read the reason after **Not caching:** in **Settings**. Raising the **Preview cache** limit does not override these checks.
2. Set **Preview cache** above `0`. The default is `512` MiB.
3. Draw the frame normally first. Returning to the same frame and project state reuses the cached image.
4. Avoid edits, resource loads, resolution changes, or plugin changes between visits. Each invalidates cached frames.
5. Do not expect idle pre-rendering for video projects with time effects or slow scenes. While video is visible, frames are decoded and cached only after playback pauses and the editor is idle for about 0.8 seconds.
6. If a GPU allocation failed earlier, the session ceiling stays lowered even after you raise the preference. After a second GPU context loss, reload the editor to re-enable captures.

See [Preview and cache](/docs/workflow/preview-and-cache/) for all caching rules.

## An export refuses because of missing or failed plugins

**Cause:** The project uses community effects, and community effect export is unavailable in this preview.

**Fix:** Approve the one-export bypass when the editor offers **Export with missing or failed plugins**.
The export skips every community effect on every frame, including inside closed compositions.
Project content stays unchanged, and the choice applies to one export only.
Install or repair the missing package for a complete export.

## A project opens with missing plugins or assets

**Cause:** A plugin the project needs is disabled, or an asset file is missing or failed to load.

**Fix:**

1. If the editor names a required plugin, enable it in **Plugins**. Saved effect, material, and object settings return with the plugin.
2. For missing or failed files, follow the repair steps in [Assets and project files](/docs/workflow/assets/). Reconnect the files before exporting or saving a new archive.
3. Save the repaired project as a new `.pz` archive and keep the earlier archive until you verify the copy.

## The editor is slow or runs out of GPU memory

**Cause:** The viewport redraws a heavy scene at full resolution on every change.

**Fix:**

1. In the player toolbar, click **Pause drawing** and select **1/8 quality**.
2. Click **Render once** after each change you need to inspect.
3. Raise the **Preview cache** limit in **Settings** so revisited frames redraw from memory.
4. If the GPU reports exhausted memory or context loss during export, close other projects and reduce the output size before retrying.

See [Preview and cache](/docs/workflow/preview-and-cache/) for the full heavy-project workflow.

## Attach the debug log to a bug report

**Cause:** A bug report without environment details is hard to reproduce.

**Fix:**

1. Open **Settings**.
2. Under **Debug information**, click **Download debug log**.
3. Review the file, then attach it to your report.

The log records the operating system, browser, enabled plugins, and recent crash evidence. It does not include project content.
