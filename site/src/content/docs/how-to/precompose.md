---
title: Precompose timeline clips
sidebar:
  label: Precompose clips
---
Move selected clips into a reusable composition with Precomp+.

Switching between **Main** and a composition clears Undo and Redo. Save a project archive before switching if you need a recovery copy.

## Create a composition from clips

1. In **Plugins**, enable **Precomp+**.
2. Select the video clips, audio clips, or both on the timeline.
3. Open **Comps**.
4. Click **Pre-compose selection**.
5. Enter a unique **Name**. Do not use **Main**.
6. Click **Pre-compose**.

If the selection includes video, the current timeline receives one composition clip across the selection's full time span. If an unselected clip blocks that span, move the blocking clip before retrying.

For audio-only selections, no replacement clip remains on the current timeline. To keep the audio in Main's playback and export, include a video clip in the selection. Otherwise, open the new composition to edit its audio.

## Edit the source composition

1. In **Comps**, click **Open Compositions**.
2. Select the composition.
3. Click **Open**, or double-click the composition.
4. Edit its clips on the timeline.
5. When you have finished, in **Compositions**, click **Back to Main**.

Before step 3 or step 5, finish any Undo or Redo work that you need. Each switch clears both histories. Changes stay in the composition when you return to Main.

To open a composition from a timeline clip, right-click that clip and select **Open source composition**.

## Export the result

1. In **Compositions**, return to **Main**.
2. Open **Export**.
3. Select [video export](/docs/features/mp4-export/) or [frame capture](/docs/how-to/export-frame/).

If **Export Main** appears, close the export page and use **Back to Main** before retrying. Export is blocked while a source composition is open.

[Precomp+ reference](/docs/reference/precomp/) covers nesting, audio, reuse, deletion, and saved data.
