---
title: Animate characters with Text+
sidebar:
  label: Text+
---
Animate native 2D Text in its **Character** category, or animate 3D Text through a Text+ parent.

## Animate a native Text layer

1. Enable **Text+** in **Plugins**.
2. Add **Text** from **LAYERS**.
3. Select the Text layer.
4. Open its **Character** category in the native properties panel.
5. Choose a **Mode**, such as **Character Transform**.
6. Set **Position**, **Scale**, or **Rotation**.
7. Set **Delay** to offset the animation between characters.
8. Choose **Delay order**.
9. Keyframe the character properties.

To affect specific characters, choose **Selected Character Transform** and enter
one-based numbers such as `1,4,5` in **Characters**. Spaces count as character slots.
To blend transforms across the text, choose **Gradient Transform** and set the
**First** and **Last** controls. To scatter characters, choose **Random Scatter**
and animate **Amount**. To animate either Shake mode, animate **Phase**.

For native Text, use X and Y for Position and Scale. Rotation turns in the layer's
plane. Keep the native **Text**, **Font**, **Size**, **Fill**, and **Stroke** controls.
To move the whole text, edit the native **Position**, **Rotation**, and **Scale**
controls above **Character**.

To disable character animation, set **Mode** to **None**. To render native Text
without Text+, disable **Text+** in **Plugins**. Save the project to retain its
character settings. To restore the animation, enable **Text+** again.

Before converting the layer to Shape+, set **Character** > **Mode** to **None**.
The converted Shape+ layer has editable outlines and no Text+ character controls.

## Animate 3D Text through a parent

1. Open a 3D Scene's **Objects** panel.
2. Add **Character Transform** from Text+.
3. Put a native 3D Text object inside the parent.
4. Open the parent's **Character** category.
5. Set Position, Scale, or Rotation.
6. Set **Delay** to offset the animation between characters.
7. Choose **Delay order**.
8. Keyframe the character properties.

To affect specific characters, use Selected Character Transform and enter
one-based numbers such as `1,4,5` in **Characters**. To scatter text, use Random
Scatter and animate **Amount**. To animate Character Shake, animate **Phase**.

[Text+ source contract](https://github.com/rbstxt/zoidium/blob/dev/plugins/text-plus/README.md)
describes pivots, delay, shake, and nested parents.
[Text+ compatibility](/docs/development/project-compatibility/#text-scale-composition)
describes saved scale modes.
