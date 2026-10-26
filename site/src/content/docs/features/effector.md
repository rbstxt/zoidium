---
title: Repeat and deform objects with Effector
description: Set up source children, repeaters, deformation fields, fracture, and Delay. Also known as Scene+.
sidebar:
  label: Effector
---
Use **Effector** to make procedural copies or deform a group of 3D objects. The plugin's source directory is Scene+.

## Add source children

1. In **Plugins**, enable **Effector**.
2. Open the scene's 3D object picker.
3. Choose **Effector > Repeater**.
4. On the repeater's own row, click **+** to add a source object.
5. In the **Repeater** property section, set **Count**.
6. Adjust **Position**, **Rotation**, and **Scale** to separate the copies.

Objects added at the top level are siblings. To affect an object, place it inside the effector's hierarchy.

To distribute copies between endpoint transforms, choose **Linear Repeater**. To scatter copies within ranges, choose **Random Repeater** and set **Seed**. For copies evaluated at earlier frames, choose **Echo Repeater** and set **Offset**.

## Deform a mesh with a field

1. Add **Effector > Twist** or **Effector > Warp**.
2. Add the mesh as a child of that effector.
3. For Twist, adjust **Axis** and **Angle**. For Warp, adjust **Axis** and **Strength**.
4. To limit the affected region, change **Field** from **infinite** to **box** or **sphere**.
5. Adjust **Field position**, **Field rotation**, **Field scale**, and **Falloff**.
6. If the bend needs more geometry, increase **Subdivision** within the [mesh limits](/docs/reference/effector/).

The effector's transform defines its local axis and field frame.

## Edit a field in the viewport

1. Select one effector while the editing camera is active.
2. Beside **Field position**, enable **Edit field in viewport**.
3. Drag to move the field on the camera plane.
4. To rotate the field, Shift-drag around its center.
5. To resize the field uniformly, Alt-drag right or up.
6. Press Escape to leave the mode, or to cancel an active drag.

## Break a mesh into fragments

For a dense mesh, check the [fracture limits](/docs/reference/effector/) before increasing the cell count.

1. Add **Effector > Voronoi Fracture**.
2. Add a closed mesh as its child.
3. Set **Cells**, **Seed**, and **Distribution**.
4. For capped cuts, set **Inner faces** to **closed**.
5. Animate **Distance**, **Scatter**, or **Spin** to separate the fragments.
6. To reveal motion across the mesh, choose **Field > linear** and animate **Sweep**.

For text selection, enable **Text+** first. In **Characters**, enter one-based ranges such as `1,3-5`. Use **Invert selection** to affect the other characters.

## Delay piece motion

1. Add **Effector > Plain**.
2. Add **Delay** as a child of Plain.
3. Add the source object inside Delay.
4. Animate Plain's **Position offset**, **Rotation offset**, or **Scale offset**.
5. On Delay, choose **Mode** and adjust **Strength** and **History frames**.

This hierarchy lets Delay sample the upstream Plain motion. For exact controls, budgets, and legacy project behavior, see the [Effector reference](/docs/reference/effector/).
