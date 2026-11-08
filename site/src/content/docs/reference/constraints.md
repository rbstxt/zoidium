---
title: Constraints properties
description: Track To and Follow controls, target links, sequence timing, and missing-target rules.
sidebar:
  label: Constraints reference
---
Track To aims a 3D object toward another object in the same scene. It changes the object's orientation and keeps the existing Rotation keys.


## Track To properties

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Track to** | Text | Text | Empty | Target picker. Empty means None. |
| **Track axis** | Choice | **+X**, **+Y**, **+Z**, **-X**, **-Y**, **-Z** | **+Z** | Local axis aimed toward the target. Cameras default to -Z. |
| **Up axis** | Choice | **X**, **Y**, **Z** | **Y** | Local axis kept closest to world +Y. A conflicting track axis selects a different up axis. |
| **Influence** | Number | 0 to 100 | `100` | Animated blend from the source pose at 0 to the constrained pose at 100. |


## Light and target behavior

Spot and Directional lights expose **Track to** and **Influence**, but their track and up axes do not steer the beam. Point and Hemisphere lights can be targets but have no direction rows.

A missing, overlapping, descendant, or circular target leaves the pose unchanged. Renaming and reordering keep the target link.

The dashed Track To relationship line is viewport-only. Track To targets do not cross scene boundaries or shared Camera layers.

## Follow properties

| Control | Type | Options or default | Effect on output |
| --- | --- | --- | --- |
| **Follow** | Target picker | **None** | Copies a Group or object's transforms in the same sequence. |
| **Follow space** | Choice | **World**, **Local**; default **World** | World copies scene coordinates through the follower's parent. Local copies the target's local coordinates. |
| **Copy position** | Choice | **Off**, **On**; default **On** | Copies position. Off keeps the authored local position. |
| **Copy rotation** | Choice | **Off**, **On**; default **On** | Copies rotation. Off keeps the authored local rotation. |
| **Copy scale** | Choice | **Off**, **On**; default **On** | Copies scale. Off keeps the authored local scale. |
| **Position offset** | Animated vector | `0, 0, 0` | Adds position in the selected space. |
| **Rotation offset** | Animated vector | `0, 0, 0` degrees | Rotates after the target rotation, in the follower's rotation order. |
| **Scale multiplier** | Animated vector | `1, 1, 1` | Multiplies the target scale per axis. |

Follow applies before Track To on an object that uses both. Follow has no relationship-line overlay.
World space means 3D scene coordinates. The scene layer's 2D composition transform does not participate.
Shear uses the native position, rotation, and scale decomposition. A zero-scale parent leaves the authored pose unchanged.
Follow uses authored transform properties and other constraints. Generated Effector copies and per-vertex deformation are outside this transform model.
Directional lights retain their separate Target position; Follow does not copy that aim.

## Follow timing

Follow samples the target at the same sequence time. Each clip's start and temporal operators map that time into its own source frame.
Targets before their clip start use local frame zero. Targets at or after the clip end use local frame `length - 1`, with a minimum of zero.
Temporal operators also apply at these endpoints. Muted tracks and disabled objects remain valid transform drivers.
Preview, Preview cache, exports, and motion-blur half-frame samples use the same calculation. Seeking never holds a previous render's target pose.

## Follow links and missing targets

Target paths display the current track, scene, and object names. Saved UUIDs retain links through renaming and reordering.
A duplicated Group or scene remaps links within the copied tree. Links to targets outside that tree retain the original target.
Targets belong to the same sequence. Cross-composition links and Camera+ sequence camera layers are unavailable.

The native Delete operation saves the follower's current local pose in the same history entry.
A missing target displays **(Missing target)** and uses that saved pose. An unresolved imported link without a saved pose keeps the authored pose.
Undo, redo, save, and reopen retain this behavior. Programmatic removals outside the native Delete operation have no deletion pose to save.
Dependency cycles, including mixed Follow and Track To cycles, skip the affected constraints and report a console warning.
Objects without Follow retain their existing output when their sequence has no Follow constraints.

[Aim and follow objects with Constraints](/docs/features/constraints/)
