---
title: Animate characters with Text+
sidebar:
  label: Text+
---
Animate native 3D Text through a Text+ parent.

## Add character animation

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
