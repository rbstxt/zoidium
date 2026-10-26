---
title: Track To properties
description: Axes, influence, targets, light behavior, and invalid-target rules.
sidebar:
  label: Constraints reference
---
Track To aims a native 3D object toward another object in the same scene. The constraint changes the evaluated pose and retains the source Rotation keys.


## Properties

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Track to** | Text | Text | Empty | Target picker. Empty means None. |
| **Track axis** | Choice | **+X**, **+Y**, **+Z**, **-X**, **-Y**, **-Z** | **+Z** | Local axis aimed toward the target. Cameras default to -Z. |
| **Up axis** | Choice | **X**, **Y**, **Z** | **Y** | Local axis kept closest to world +Y. A conflicting track axis selects a different up axis. |
| **Influence** | Number | 0 to 100 | `100` | Animated blend from the source pose at 0 to the constrained pose at 100. |


## Light and target behavior

Spot and Directional lights expose **Track to** and **Influence**. Their aim uses native Target values, so track and up axes do not affect their beams. Point and Hemisphere lights can be targets but have no directional constraint rows.

Missing targets, coincident positions, singular parent transforms, descendant targets, and target cycles leave the source pose unchanged. Renaming and reordering keep the target link. Duplicated hierarchies remap their internal target links.

The dashed relationship line appears only in the editing viewport. It does not render in exports. Targets do not cross scene boundaries or shared Camera layers.

[Aim objects with Constraints](/docs/features/constraints/)
