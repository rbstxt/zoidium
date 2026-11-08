---
title: Precompose timeline clips
sidebar:
  label: Precompose clips
---
Move selected clips into a reusable composition with Precomp+.

Use **Undo** to reverse a composition switch. Use **Undo** again to reverse the preceding edit on that timeline.

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

To undo an edit inside the composition after returning to Main, use **Undo** to reopen the composition. Use **Undo** again to reverse the edit. Use **Redo** to restore the edit and return to Main.

To open a composition from a timeline clip, right-click that clip and select **Open source composition**.

## Export the result

1. In **Compositions**, return to **Main**.
2. Open **Export**.
3. Select [video export](/docs/features/mp4-export/) or [frame capture](/docs/how-to/export-frame/).

If **Export Main** appears, close the export page and use **Back to Main** before retrying. Export is blocked while a source composition is open.

[Precomp+ reference](/docs/reference/precomp/) covers nesting, audio, reuse, and deletion.
