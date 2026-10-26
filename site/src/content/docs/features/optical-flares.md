---
title: Add and edit an Optical Flares object
description: Place a flare in a 3D scene, edit its element stack, and control source occlusion.
sidebar:
  label: Optical Flares
---
Use Optical Flares to place a lens flare in a 3D scene and edit its component elements in a dedicated window.

## Place the source

1. In **Plugins**, enable **Optical Flares**.
2. Open the scene's 3D object picker.
3. Under **Optical Flares**, choose **Default Lens Flare** or another preset.
4. Select the flare's properties.
5. Click **Open Optical Flares**.
6. In the window's **Source** section, keep **Source** set to **Object 3D**.
7. Move the flare object in the scene to place its source.

For a light source, choose **Light** and set **Light index** to the light's zero-based index in the same layer. **Screen (2D)** retains a fixed screen-offset source for older projects.

## Edit the element stack

The renderer uses at most the first 24 elements. Check the [element catalogue and limits](/docs/reference/optical-flares/) before building a larger stack.

1. In **Browser**, open **Elements**.
2. Click an element tile to add it.
3. In the **Elements** list, select the element to edit.
4. Under **Selected element**, adjust **Size**, **Brightness**, **Position**, and **Color**.
5. To inspect an element alone, enable **Solo**.
6. To restore the full flare, turn off every **Solo** control.
7. Drag rows to reorder the stack, or use **Move Up** and **Move Down**.

Solo is saved in the project and affects export. The window's preview background is a local display preference.

## Hide the flare behind geometry

1. In **Source**, enable **Occlude**.
2. Set **Fade amount** to 100 for full depth occlusion.
3. To retain some flare through foreground geometry, reduce **Fade amount**.
4. Move a scene object in front of the source to inspect the result.

## Use a custom element image

1. Expand **Custom Layers**.
2. Assign an image to **Custom Layer 1**, **Custom Layer 2**, or **Custom Layer 3**.
3. Select an element.
4. Expand its **Shape** section.
5. Set **Texture** to **Custom 1**, **Custom 2**, or **Custom 3**.

For distance scaling, source projection, global controls, and saved state, see the [Optical Flares reference](/docs/reference/optical-flares/).
