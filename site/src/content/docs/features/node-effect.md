---
title: Build a filter with Node Effect
sidebar:
  label: Node Effect
---
Create an image filter through a node graph.

1. Select a clip.
2. Add **Node Effect** under **NATIVE FX** in the Effects picker.
3. Click **Open Node Editor**.
4. Connect **Layer Color** to **Output** Color.
5. Connect Layer Color's Alpha to Output's Alpha.
6. Turn off the editing camera to inspect the output.

To expose an animated value, add a Parameter node and choose Float, Color, or
Vector2. Animate that channel in Effects. To animate a pattern, connect Time
to the pattern's Time input.

For a starter filter, choose Glow, Chromatic aberration, Displacement by noise,
or Duotone from **Recipes**. Undo restores the previous graph and channels.

Stack separate Node Effects when Blur or Edge Detect must read an earlier
graph's output. These nodes sample the current effect's input image.

[Node Effect source contract](https://github.com/rbstxt/zoidium/blob/dev/plugins/node-effect/README.md)
describes sampling, alpha, parameters, and limits.
[Node Effect compatibility](/docs/development/project-compatibility/#node-effect)
describes saved GLSL and graph metadata.

[Native FX reference](/docs/reference/native-fx/) lists ready-made filters in the same **NATIVE FX** category.
