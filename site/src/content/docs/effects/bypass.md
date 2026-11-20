---
title: Bypassing effects
description: Turn any effect or effect group off in preview, preview cache, and export without deleting it or changing its settings.
---
Turn an effect off with the eye button in its header to compare results or skip heavy processing without deleting the effect.

## Turn an effect off or on

1. Select a clip and open its **Effects** list.
2. Click the eye button (`◉`) in an effect's header. Its tooltip reads **Bypass effect** when on.
3. Click the dimmed, struck-through eye button (**Enable effect**) to turn the effect back on.

Each click is one **Undo** and **Redo** step.
Zoidium saves the eye state with the project.
Existing projects saved before this feature open with every effect on.

## What a bypassed effect skips

A turned-off effect does nothing in preview, preview cache, or export.
When you toggle the eye button, Zoidium invalidates affected frames in the [preview cache](/docs/workflow/preview-and-cache/).

The following paths also skip turned-off effects:

- **Time effects:** **Time Offset**, **Time Remap**, and **Posterize Time** stop remapping layer time when turned off. See [Native FX time effects](/docs/effects/native-fx/time/).
- **Frame samplers:** Effects that capture other frames, such as **Echo**, **Smart Motion Blur**, **ZSMB (beta 1.0)**, and **Time Remap** with **Frame blending** set to **frame mix**, stop sampling and preparing input frames when turned off.
- **Effect groups:** When you turn off an effect group, every effect and nested group inside it turns off. When you turn off a single child inside an active group, Zoidium skips that child while its active siblings still run.
- **Layer Input:** Source layers read by [Layer Input](/docs/workflow/layer-input/) skip turned-off effects and groups.
- **S_Glow:** A turned-off [S_Glow](/docs/effects/s-glow/) skips **Expand Borders** padding and project-resolution sequence sizing.
- **Third-party effects:** A turned-off third-party effect does not run in preview or export. It also does not block export when third-party export is unavailable.

## Interaction with Enabled and keyframes

When you toggle the eye button, all effect properties, keyframes, expressions, and the effect's own **Enabled** value stay unchanged.
An effect runs only when its header eye button is on and its **Enabled** property is **on**.

You cannot keyframe the header eye button or control it with an expression.
To turn an effect on or off over time, keyframe its **Enabled** property instead.
