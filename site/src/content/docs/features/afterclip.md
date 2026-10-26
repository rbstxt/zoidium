---
title: Add AfterClip effects and presets
description: Use AfterClip shape, repeat, warp, and group presets in a layer's effect stack.
sidebar:
  label: AfterClip
---
Use AfterClip for procedural shapes, repeated images, warps, and grouped presets. The pack contains 32 standalone shaders and 11 group presets.

## Add a shape

1. In **Plugins**, enable **AfterClip**.
2. Select the target layer.
3. Open the effect picker.
4. Under **AFTERCLIP**, open **SHADERS · SHAPE**.
5. Add **Polygon**.
6. Adjust **Position**, **Scale**, **Rotation**, and **Opacity**.
7. Set **N**, **Size**, **Width**, and **Color** for the polygon.

For other shapes, repeats, and warps, see the [AfterClip catalogue](/docs/reference/afterclip/). Shared controls appear only on effects that declare them.

## Use a group preset

1. Open the target layer's effect picker.
2. Under **AFTERCLIP**, choose **ChevSync**.
3. Animate the group's **Sync** control.
4. Adjust **Ratio**, **Power**, and **Amount**.
5. To inspect the saved effect chain, expand the group's children.

Group presets contain saved child effects. A group with no custom properties on its root still has editable child properties.

## Choose a timing control

For **Line Wave**, animate **Time** and adjust **Delay**, **Power**, and **Step**. Other presets can use different timing controls or expressions.

Use the names on the chosen effect rather than assuming that every preset shares a time control. Twitch and VHS are not included in this pack.
