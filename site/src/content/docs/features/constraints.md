---
title: Aim an object with Track To
sidebar:
  label: Constraints and Track To
---
Aim a 3D object at a target in the same native 3D Scene.

1. Select the object in **Objects**.
2. Set **Track to** below the Rotation rows.
3. Choose the target.
4. Choose a **Track axis**.
5. Choose a different **Up axis**.
6. Set or animate **Influence**.

At 100 percent, the track axis points at the target. At zero, the object's own
rotation wins. To remove the constraint, set Track to None.

For a spot or directional light, set Track to and Influence. Those lights aim
through their native Target position and do not expose track-axis controls.
For a Track To camera shot, use the native scene camera. Camera+ sequence camera
layers are outside the same-scene target contract.

[Constraints source contract](https://github.com/rbstxt/zoidium/blob/dev/plugins/constraints/README.md)
describes missing targets, cycles, and supported lights.
[Track To compatibility](/docs/development/project-compatibility/#track-to-constraints)
describes saved UUIDs and constraint properties.

Control reference: [constraints](/docs/reference/constraints/).
