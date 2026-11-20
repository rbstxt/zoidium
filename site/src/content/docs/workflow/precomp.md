---
title: Precomp+ compositions
description: Group timeline clips into reusable nested compositions, edit 3D scenes inside them, and export from Main.
---
Use **Precomp+** to move selected clips into a reusable composition stored as project media. Each composition keeps its own video and audio tracks, and composition clips reference that shared source.

## Pre-compose selected clips

1. In **Plugins**, enable **Precomp+**.
2. Select the video clips, audio clips, or both on the timeline.
3. Open **Comps** in the sidebar.
4. Click **Pre-compose selection**.
5. Enter a unique **Name** (up to 60 characters, case-insensitive, and not **Main**).
6. Click **Pre-compose**.

- If your selection includes video, one composition clip replaces the selection across its full time span on a track with free space. If an unselected clip blocks that span, move the blocking clip first.
- If your selection is audio-only, Precomp+ creates the source composition without placing a replacement clip on the current timeline. Include at least one video clip if you want that audio to play and export inside **Main**.

Pre-compose keeps the selected clips' relative timing, source-track order, and track switches. The earliest selected start becomes source frame `0`. Moved clip links are cleared. A source's length matches its latest clip end (minimum `1` frame).

## Open and edit a composition

1. In **Comps**, click **Open Compositions**.
2. Select a composition and click **Open** (or double-click it).
3. Edit its clips on the timeline.
4. When you finish, click **Back to Main** in **Compositions**.

You can also right-click a composition clip on the timeline and choose **Open source composition**.

### Undo across composition switches

Opening a composition or returning to **Main** adds one **Undo** step.

- To undo an edit inside a composition after returning to **Main**, press **Undo** once to reopen the composition, then press **Undo** again to reverse the edit.
- **Redo** replays edits and composition switches in their original order.
- Opening the already-open timeline adds no undo step. Closing the **Compositions** window does not switch timelines.

## Edit a 3D Scene inside a composition

1. Right-click a composition clip that contains a Scene clip.
2. Choose **Edit 3D in comp**. If the composition has multiple Scene clips, pick the Scene from the menu.
3. Edit the Scene using the grid, view controls, and object properties.
4. Open **Comps** and click **Back from 3D edit** to return to the previous composition.

Because the switch is one undo step, press **Undo** twice to reverse a 3D edit after returning.

## Reuse, nest, and delete compositions

| Control | Behavior |
| --- | --- |
| **Open** | Switches the editable timeline to the source composition. Double-click does the same. |
| **Back to Main** | Keeps source edits and returns to the main timeline. |
| **Name** | Renames the source (unique without case distinctions, max 60 characters, not **Main**). |
| **Duplicate** | Creates an independent composition source with its own identity. |
| **Delete** | Refuses deletion while **Main** or another composition still references the source. |
| **New composition** | Creates an empty composition source without placing a clip on **Main**. |

- **Shared edits:** Multiple timeline clips pointing to the same composition share all edits to that source. Use **Duplicate** in **Compositions** when you want an independent copy. Duplicating a timeline clip still points to the original source.
- **Nesting:** Compositions can contain other composition clips up to `16` levels deep. Pre-compose rejects moves that would create a recursive loop, and rendering stops recursive paths.
- **Audio and tracks:** Nested video preserves source track order and skips disabled video tracks. Nested audio uses Main's audio pipeline (including clip timing, volume, and pan) clipped to the containing composition clip's time span. An audio-only composition with no composition clip has no path into Main's playback or export.
- **Deletion and disabling:** **Delete** reports any remaining references in **Main** or other compositions. Remove those references first. You cannot disable **Precomp+** while the project contains compositions.

## Save and export

- **Export requires Main:** Video export and single frame capture are blocked while a source composition is open. If **Export Main** appears, close the export page, click **Back to Main**, and retry. See [Exporting video and frames](/docs/workflow/export/).
- **Saving:** Saving while a composition is open saves both **Main** and your current composition edits, and records the Precomp+ dependency. Without the plugin enabled, composition data stays preserved for re-saving but does not render. See [Saved rendering compatibility](/docs/development/project-compatibility/).
