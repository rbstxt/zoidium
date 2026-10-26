---
title: Add native lights with Light+
description: Choose native light variants and check whether a material responds to lighting.
sidebar:
  label: Light+
---
Use Light+ to choose native CM3 light variants from the 3D object picker.

## Add a light

Single Color and Matcap materials do not respond to lights. For a visible lighting change, use a material that responds to lighting.

1. In **Plugins**, enable **Light+**.
2. Open the scene's 3D object picker.
3. Open **Light+**.
4. Choose **Spot light**, **Point light**, **Directional light**, or **Hemisphere light**.
5. For a positional light, adjust **Position** in the native property panel.
6. Inspect the result on an object in the same scene.

## Adjust the light

1. For Spot, Point, or Directional lights, set **Color** and **Intensity**.
2. For Spot or Directional lights, adjust **Target** to aim the light.
3. For a Spot light, adjust **Angle** to change the cone width.
4. For a Hemisphere light, set **Sky color**, **Ground color**, and **Intensity**.

Intensity accepts 0 to 100. Spot Angle accepts 0 to 90 degrees. Hemisphere lights have no Position or Target rows.

## Choose the light provider

Light+ uses native light properties. For the suite's additional light types and controls, use [Rowbyte & Red Giant Suite](/docs/features/trapcode-suite/).

Keep one light provider enabled when choosing lights. Light+ and the suite both add light picker entries, and their menus and controls differ.

Control reference: [light-plus](/docs/reference/light-plus/).
