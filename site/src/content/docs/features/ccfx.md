---
title: Add CCFX effects and groups
description: Enable the CCFX Shader Pack and use standalone shaders or editable group presets.
sidebar:
  label: CCFX Shader Pack
---
Use the CCFX Shader Pack for backgrounds, distortion, transitions, and light effects. The pack contains 12 standalone shaders and 7 group presets.

## Add a standalone effect

1. In **Plugins**, enable **CCFX Shader Pack**.
2. Select the layer that needs the effect.
3. Open the effect picker.
4. Under **CCFX SHADER PACK**, open **BACKGROUNDS**.
5. Add **Sunburst V2**.
6. Adjust **rotation**, **speed**, **scale**, and **center** in the effect's custom properties.

Use the [CCFX catalogue](/docs/reference/ccfx/) to choose another effect. Property names belong to each preset. Their capitalization is not uniform across the pack.

## Add a group preset

1. Open the effect picker on the target layer.
2. Under **CCFX SHADER PACK**, choose **CC Bend It**.
3. Adjust the group's **Start**, **End**, and **Bend** controls.
4. To inspect the implementation inside a group, expand its child effects.

Group presets insert an effect group with saved child effects and properties. Some groups expose controls on the group itself. Others also need edits to child properties.

For a preset with an existing time expression, preserve that expression unless you intend to change its timing. For example, Sunburst V2 drives **uTime** with `time`.
