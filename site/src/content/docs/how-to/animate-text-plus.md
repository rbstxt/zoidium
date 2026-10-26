---
title: Animate native Text with Text+
sidebar:
  label: Animate Text with Text+
---
Animate native 2D Text character by character with the **Character** categories that Text+ adds to the layer.

## Animate one category

1. In **Plugins**, enable **Text+**.
2. Add **Text** from **LAYERS**.
3. Select the Text layer.
4. Open its **Character** category in the native properties panel.
5. Choose a **Mode**. Use **Character Transform** for offsets, **Gradient Transform** for a blend across the text, **Character Shake** for phase-driven shake, a **Selected** variant for specific characters, or **Random Scatter** for seeded variation.
6. Set **Position**, **Scale**, or **Rotation**.
7. Set **Delay** to offset the animation between characters.
8. Choose **Delay order**.
9. Keyframe the character properties.

For 2D Text, use X and Y for Position and Scale. Rotation turns in the layer plane. Keep the native **Text**, **Font**, **Size**, **Fill**, and **Stroke** controls. To move the whole text, edit the native **Position**, **Rotation**, and **Scale** controls above **Character**.

To affect specific characters, choose **Selected Character Transform** or **Selected Character Shake** and enter one-based numbers such as `1,4,5` in **Characters**. Spaces count as character slots. To blend transforms across the text, choose **Gradient Transform** and set the **First** and **Last** controls. To scatter characters, choose **Random Scatter** and animate **Amount**. To animate either Shake mode, animate **Phase**.

## Stack Character 2 and Character 3

Each later category moves the characters as the earlier categories left them.

1. Set **Character** > **Mode** to anything except **None**. **Character 2** appears below **Character**.
2. Set a different **Mode** in **Character 2**. **Character 3** appears the same way.
3. Keyframe each category separately.

For example, shake the characters in **Character**, then scatter them in **Character 2**. To disable character animation, set every **Mode** to **None**. To render native Text without Text+, disable **Text+** in **Plugins**. Save the project to retain the character settings.

Before converting the layer to Shape+, set **Mode** to **None** in every **Character** category. The converted Shape+ layer has editable outlines and no Text+ character controls.

[Text+ character properties](/docs/reference/text-plus/) list every mode, control, default, and range.
