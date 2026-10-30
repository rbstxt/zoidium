---
title: Precomp+
---
Precomp+ stores compositions as project media with their own video and audio tracks. Composition clips reference that shared source.

## Composition controls

**Comps** provides **Open Compositions**, **Pre-compose selection**, and **New composition**. The **Compositions** window lists Main, composition lengths, use counts, and the active editing location.

| Control | Behavior |
| --- | --- |
| **Open** | Replaces the editable timeline with the source composition. Double-click has the same action. |
| **Back to Main** | Keeps source edits and restores the main timeline. |
| **Name** | Renames the source. Names are unique without case distinctions, at most 60 characters, and cannot be Main. |
| **Duplicate** | Creates a separate composition source with a new identity. |
| **Delete** | Refuses deletion while Main or another composition still references the source. |
| **New composition** | Creates an empty source. It does not place a clip on Main. |

Opening a different composition or returning to Main clears Undo and Redo. Closing the window alone does not switch the timeline.

## Selection and timing

Pre-compose moves selected clips into a new source. Their relative timing and source-track order remain intact. The earliest selected start becomes source frame zero. The new composition clip covers the earliest start through the latest end.

The moved tracks retain their track switches. Moved clip links are cleared. If the selection includes video, one composition clip replaces the selection on a video track with a free span. An audio-only selection creates the source without a replacement clip.

A source's length follows its latest clip end, with a minimum of one frame.

## Nesting and audio

Compositions can contain composition clips. Pre-compose rejects a move that would make the open composition contain itself through nested references. Rendering also stops recursive paths. Nesting is limited to 16 levels.

Nested video keeps the source track order. Disabled video tracks do not draw. Scheduled nested audio uses Main's normal audio pipeline, including clip timing, volume, and pan. Audio is limited to the containing composition clip's time span.

An audio-only source with no composition clip has no path into Main's playback or export.

## Reuse and deletion

Clips that reference the same composition share source edits. **Duplicate** creates an independent source. A duplicate timeline clip can still reference the original source.

Deletion reports references from Main and other compositions. Removing those references makes the source eligible for deletion. Precomp+ cannot be disabled while the project contains compositions.

## Export and saved projects

Video export and frame capture require Main as the active timeline. An open composition produces **Export Main** instead of starting the render.

Saving while a composition is open saves Main and the current source edits. Saved projects record the Precomp+ dependency.

Without the plugin, composition data is preserved for later saving but does not render.

[Precompose clips](/docs/how-to/precompose/) contains the workflow. [Project compatibility](/docs/development/project-compatibility/) describes preserved extension data.
