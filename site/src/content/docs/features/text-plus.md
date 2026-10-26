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

To combine animators, set **Character** > **Mode**, then use **Character 2**. It
appears below **Character** when the first **Mode** is not **None**. **Character 3**
appears the same way. Each later category moves the characters as the earlier
categories left them. For example, shake the characters in **Character**, then
scatter them in **Character 2**.

To disable character animation, set every **Mode** to **None**. To render native Text
without Text+, disable **Text+** in **Plugins**. Save the project to retain its
character settings. To restore the animation, enable **Text+** again.

Before converting the layer to Shape+, set **Mode** to **None** in every **Character** category.
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

## Assign materials to selected 3D characters

1. In a 3D Scene's **Objects** panel, add **Character Material** from Text+.
2. Put a native 3D Text object inside the parent.
3. In **Character**, enter one-based numbers such as `1,3,4` in **Characters**.
4. To affect every character, leave **Characters** empty.
5. Open **Front material** and use its change button to choose a material for both caps.
6. Open **Side material** and choose a material for the extrusion walls and bevels.
7. Edit or keyframe each material's native properties.

To keep the source Text material on a face, delete the material from that slot.
To swap the materials on a letter, add a nested **Character Material** parent.
Select that letter in the inner parent's **Characters** field, then reverse the two material choices.
The innermost parent that selects a character controls both slots.
An empty inner slot uses the source Text material.

To animate the same text, nest the material parent with any Text+ animation parent.
Keep other object types in the group if needed. Character Material changes only 3D Text.
When you open the project without Text+, the source Text materials render and the saved slots remain available.

[Text+ source contract](https://github.com/rbstxt/zoidium/blob/dev/plugins/text-plus/README.md)
describes pivots, delay, shake, and nested parents.
[Text+ compatibility](/docs/development/project-compatibility/#text-scale-composition)
describes saved scale modes.
