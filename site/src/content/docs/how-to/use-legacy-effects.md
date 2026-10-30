---
title: Use OpenZoid Legacy effects
sidebar:
  label: Use OpenZoid Legacy
---
Add OpenZoid Legacy's temporal, compression, tape, callout, or character effects to a layer.

## Add an effect

1. In **Plugins**, enable **OpenZoid Legacy**.
2. Select the destination layer.
3. Open the effect picker.
4. In **SETUP LEGACY**, select **Echo (Legacy)**, **Posterize Time (Legacy)**, **Jpeg Damage**, **VHS**, **Datamosh**, **Tracery**, or **ASCII**.
5. Adjust the effect in the Properties panel.

For lower drawing cost while editing, use [Pause drawing and Render once](/docs/how-to/preview-heavy-project/).

## Open a setup window

For **VHS**, **Datamosh**, **Tracery**, or **ASCII**, use the corresponding launch row above the effect's properties.

1. Click **Open VHS Setup**, **Open Datamosh Setup**, **Open Tracery Setup**, or **Open ASCII Setup**.
2. Choose a preset or adjust the controls.
3. Inspect the result in the main viewport.
4. Click **Done** to close the window.

Edits apply while the window is open. **Done** closes the window rather than applying a deferred batch. To reverse an edit, use Undo.

For a repeatable variation, click **Glitch!** in VHS or **Mosh!** in Datamosh. Each click stores a seed and records one undo operation. **Remove Frame** changes the Datamosh simulation's hold controls. It does not delete a timeline frame or change a video file.

## Place Tracery callouts

To place a marker manually, turn **Detection** off. Enable the required **Point 1** through **Point 6** controls and set their positions. Animate the point properties with keyframes or expressions.

To find regions by color, turn **Detection** on and set **Key Color**. While adjusting **Threshold**, turn **Show Mask** on. Turn **Show Mask** off before exporting the callout result. Color detection is not an automatic motion-tracking analysis that writes point keyframes.

## Export the result

For the viewport effect in a normal export, leave **True datamosh** set to **off** on the Device page. The **Datamosh** effect does not require earlier playback.

To remove keyframes from an encoded file, follow [True datamosh export](/docs/how-to/export-true-datamosh/). [OpenZoid Legacy reference](/docs/reference/openzoid-legacy/) lists the effects, setup groups, timing, and limits.
