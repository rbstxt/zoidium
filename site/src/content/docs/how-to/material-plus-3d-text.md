---
title: Use Material+ on 3D Text
sidebar:
  label: Material+ on 3D Text
---
Shade native 3D Text with a **PBR+** material, and give the caps and the extrusion walls different materials with a Text+ **Character Material** parent.

## Shade the whole text with PBR+

1. In **Plugins**, enable **Material+**.
2. Select the 3D Text object in the native property panel.
3. Change its material to **PBR+ Material**.
4. Set **Color**, **Roughness**, and **Metalness**.
5. If the surface needs a texture, choose an image in the matching map property.
6. Adjust the shared **Wrap**, **Repeat**, **Offset**, **Center**, and **Rotation** controls.

Material+ maps textures with its own UV layout, so the texture keeps one density across caps and walls instead of tiling once per object unit. Enable **Reflection** to light the material with the scene environment map.

## Add a Color Ramp

1. Set **Color Ramp** to **on**.
2. Edit the **Color Ramp Curve** gradient.
3. Choose the ramp input in **Color Ramp Source**.
4. Set **Color Ramp Interpolation** and **Color Ramp Factor** to blend the ramp into the base color.

## Give caps and walls different materials

1. In **Plugins**, enable **Text+**.
2. Open the 3D Scene's **Objects** panel.
3. Add **Character Material** from Text+.
4. Put the native 3D Text object inside the parent.
5. Open **Front material** and use its change button to choose a material for both caps.
6. Open **Side material** and choose a material for the extrusion walls and bevels.
7. Edit or keyframe each material's native properties.

To affect specific characters, enter one-based numbers such as `1,3,4` in **Characters**. To affect every character, leave **Characters** empty. To keep the source Text material on one face, delete the material from that slot. The innermost selecting parent controls both slots. To animate the same text, nest the material parent with a Text+ animation parent.

[Material+ properties](/docs/reference/material-plus/) and [Text+ character properties](/docs/reference/text-plus/) list the material and slot controls.
