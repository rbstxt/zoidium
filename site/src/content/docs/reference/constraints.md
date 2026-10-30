---
title: Track To properties
description: Axes, influence, targets, light behavior, and invalid-target rules.
sidebar:
  label: Constraints reference
---
Track To aims a 3D object toward another object in the same scene. It changes the object's orientation and keeps the existing Rotation keys.


## Properties

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Track to** | Text | Text | Empty | Target picker. Empty means None. |
| **Track axis** | Choice | **+X**, **+Y**, **+Z**, **-X**, **-Y**, **-Z** | **+Z** | Local axis aimed toward the target. Cameras default to -Z. |
| **Up axis** | Choice | **X**, **Y**, **Z** | **Y** | Local axis kept closest to world +Y. A conflicting track axis selects a different up axis. |
| **Influence** | Number | 0 to 100 | `100` | Animated blend from the source pose at 0 to the constrained pose at 100. |


## Light and target behavior

Spot and Directional lights expose **Track to** and **Influence**, but their track and up axes do not steer the beam. Point and Hemisphere lights can be targets but have no direction rows.

A missing, overlapping, descendant, or circular target leaves the pose unchanged. Renaming and reordering keep the target link.

The dashed relationship line is viewport-only. Targets do not cross scene boundaries or shared Camera layers.

[Aim objects with Constraints](/docs/features/constraints/)
