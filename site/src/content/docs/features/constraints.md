---
title: Aim and follow objects with Constraints
sidebar:
  label: Constraints
---
Aim a 3D object with Track To, or copy transforms with Follow.

## Aim an object with Track To

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

## Copy transforms with Follow

1. Select a Group or object in **Objects**.
2. Set **Follow** to the target path, which includes its video track, scene, and object names.
3. Choose **World** or **Local** in **Follow space**.
4. Set **Copy position**, **Copy rotation**, and **Copy scale** to **On** or **Off**.
5. Set or animate **Position offset**, **Rotation offset**, and **Scale multiplier**.

The default settings match the target's world transform. The target can belong to another scene layer in the same sequence.
To remove Follow, set **Follow** to **None**. To aim the follower after it copies the target, also set **Track to**.

If the target is deleted, the follower keeps its current local pose and displays **(Missing target)**.
Undo restores the target and its link. Reopening the project keeps the saved pose.

Control reference: [constraints](/docs/reference/constraints/).
