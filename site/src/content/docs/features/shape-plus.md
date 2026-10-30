---
title: Create paths with Shape+
sidebar:
  label: Shape+
---
Create a Shape+ layer with editable paths and native animation.

## Add a shape

1. Add the **Shape+** Media preset to the timeline.
2. Select the clip.
3. Open **Objects**.
4. Open the Contents **+** menu.
5. Choose Rectangle, Ellipse, Polystar, or Path.
6. Edit the item's properties.

## Edit the contents

1. Select a path in Contents.
2. Use the selection or pen tool in the main preview to edit the path.
3. To animate a path, enable its native **Path** animation control.
4. Move the playhead.
5. Edit the path to create the next keyed pose.

To paint several paths together, place a Fill or Stroke below those paths in the
same group. Drag contents to change their order or group. Use the eye button to
hide an item.

Control reference: [shape-plus](/docs/reference/shape-plus/).

## Add and edit text

1. Select a Shape+ layer.
2. Open **Objects**, then the Contents **+** menu.
3. Choose **Text**.
4. Select the Text item and choose **Font Family**.
5. Edit **Source Text** in the native properties panel.
6. To edit in the preview, double-click the text.
7. Press Enter to add a newline.
8. Press Escape or click outside the editor to commit one undo step.

For Japanese text, choose a font with Japanese glyphs. To use a second font
for missing glyphs, set **Fallback Font**.

To use paragraph text, set **Text Mode** to **box** and edit **Box Size**.
To animate variable fonts, choose a **Style**, then animate the individual axis
properties. See [Text](/reference/shape-plus/#text) for the supported formats
and layout controls.

## Create shapes from text

1. Select a Text contents item.
2. In the preview context menu, choose **Convert to Path**.
3. To use the Objects row instead, click **Create Shapes from Text**.
4. Expand the character groups to edit each contour as a Path.

Conversion captures the current frame and creates one undo step. To restore
the live text and its animation, use Undo.
