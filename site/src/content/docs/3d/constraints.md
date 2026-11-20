---
title: Constraints
description: Aim 3D objects toward targets with Track To and copy transforms across scenes with Follow.
---
Use **Constraints** (enabled by default) to aim a 3D object at another object in the same scene (**Track To**), or to copy position, rotation, and scale from a Group or object in the same scene or another scene layer in the same sequence (**Follow**).

## Aim an object with Track To

**Track To** adjusts orientation while keeping your existing Rotation keys intact.

1. Select a 3D object in **Objects**.
2. Below the Rotation rows, set **Track to** to a target in the same scene.
3. Choose the **Track axis** that should point at the target and pick a different **Up axis**.
4. Set or animate **Influence** (`0` uses the object's own rotation; `100` points fully at the target).

To remove the constraint, set **Track to** to **None**.

- **Lights:** Spot and Directional lights expose **Track to** and **Influence**, steering through their native Target position without track-axis rows. Point and Hemisphere lights can be targets but have no direction rows.
- **Cameras:** Use the native scene camera for Track To shots. Camera+ shared Camera layers are outside the same-scene target contract.
- **Viewport guide:** The dashed Track To relationship line is viewport-only and does not render in exports.

### Track To properties

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Track to** | Text | Target picker | Empty (None) | Target object in the same scene. |
| **Track axis** | Choice | **+X**, **+Y**, **+Z**, **-X**, **-Y**, **-Z** | **+Z** (cameras default to **-Z**) | Local axis aimed at the target. |
| **Up axis** | Choice | **X**, **Y**, **Z** | **Y** | Local axis kept closest to world `+Y` (auto-adjusted if conflicting with **Track axis**). |
| **Influence** | Number | `0` to `100` | `100` | Animated blend from authored pose (`0`) to aimed pose (`100`). |

A missing, overlapping, descendant, or circular target leaves the pose unchanged. Renaming or reordering objects preserves the target link.

## Copy transforms with Follow

1. Select a Group or 3D object in **Objects**.
2. Set **Follow** to a target path (shown with its video track, scene, and object names).
3. Choose **World** or **Local** in **Follow space**.
4. Turn **Copy position**, **Copy rotation**, and **Copy scale** **On** or **Off**.
5. Optionally set or animate **Position offset**, **Rotation offset**, and **Scale multiplier**.

Setting **Follow** back to **None** hides the extra Follow rows while preserving their values, keys, and expressions across Undo, Redo, save, reopen, and duplication.

### Follow properties

| Control | Type | Options or default | Effect on output |
| --- | --- | --- | --- |
| **Follow** | Target picker | **None** | Target Group or object in the same sequence. |
| **Follow space** | Choice | **World** (default), **Local** | **World** copies 3D scene coordinates through the follower's parent; **Local** copies the target's local coordinates. |
| **Copy position** | Choice | **Off**, **On** (default) | Copies position; **Off** keeps authored local position. |
| **Copy rotation** | Choice | **Off**, **On** (default) | Copies rotation; **Off** keeps authored local rotation. |
| **Copy scale** | Choice | **Off**, **On** (default) | Copies scale; **Off** keeps authored local scale. |
| **Position offset** | Animated 3D vector | `[0, 0, 0]` | Added in the selected space. |
| **Rotation offset** | Animated 3D vector | `[0, 0, 0]` degrees | Applied after target rotation in the follower's rotation order. |
| **Scale multiplier** | Animated 3D vector | `[1, 1, 1]` | Multiplies target scale per axis. |

## Evaluation, timing, and missing targets

- **Order:** When an object uses both constraints, **Follow** applies before **Track To**. Follow has no viewport line overlay.
- **Coordinate scope:** World space means 3D scene coordinates (2D composition layer transforms are excluded). A zero-scale parent leaves the authored pose unchanged. Follow reads authored transforms and other constraints, not generated Effector copies, per-vertex deformations, or a Directional light's separate Target aim.
- **Timing:** Follow samples the target at the same sequence time, mapped through each clip's start and temporal operators. Before a target clip starts, it samples local frame `0`; at or after its end, it samples `length - 1` (min `0`). Muted tracks and disabled objects still work as drivers. Preview, Preview cache, exports, and motion-blur half-frame samples share the exact same evaluation.
- **Links and duplication:** Target links use saved UUIDs, surviving renames and reordering. Duplicating a Group or scene remaps links within the copied tree while keeping external links pointed at the original target. Cross-composition links and Camera+ sequence camera layers are unsupported.
- **Deleted or missing targets:** Using native Delete stores the follower's current local pose in the same undo step, displays **(Missing target)**, and holds that saved pose across save and reopen. Undo restores the target and link. An unresolved imported link without a saved pose keeps its authored pose. Dependency cycles (including mixed Follow and Track To cycles) skip the affected constraints and log a console warning.
