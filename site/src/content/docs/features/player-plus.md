---
title: Player+ preview controls
description: How Player+ separates viewport drawing from playback and export.
sidebar:
  label: Player+
---
Player+ adds drawing controls to the player toolbar. You can edit a project while viewport drawing is paused.

## Drawing and playback

**Pause drawing** stops viewport redraws. It does not stop the playhead or audio. The normal playback controls manage playback separately.

**Render once** draws the current frame, including changes made while drawing is paused. **Resume drawing** restores automatic viewport updates.

The [heavy-project preview guide](/docs/how-to/preview-heavy-project/) describes the editing workflow.

## Playback speed

**Playback speed** selects **Paused**, **0.25x**, **0.5x**, **0.75x**, **1x**, **1.25x**, **1.5x**, or **2x**.
The selection follows speed changes from **J**, **K**, and **L**, including reverse and faster shuttle speeds.
Native audio playback follows the selected positive speed.
The speed applies to editor playback only. Saved projects and exports keep their original timing.

## Preview size and export size

**Preview quality** offers **Full quality**, **1/2 quality**, **1/4 quality**, and **1/8 quality**. Each fraction scales both viewport pixel dimensions. The choice persists locally.

Player+ changes the editor viewport size. Project resolution and export settings remain separate. The [preview cache](/docs/features/preview-cache/) has its own memory budget.

Control reference: [editor-controls](/docs/reference/editor-controls/).
