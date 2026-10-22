---
title: Shade objects with Material+
sidebar:
  label: Material+ and Node Material
---
Assign a Material+ material to a 3D object.

## Choose a material

1. Select the object's material in the native property panel.
2. Choose PBR+ for scene lighting and separate texture maps.
3. Set Color, Roughness, and Metalness.
4. If the surface needs a texture, choose an image in the matching map property.
5. Adjust the shared Wrap, Repeat, Offset, Center, and Rotation controls.

For a view-dependent image that supplies the shading, choose Matcap. For an
unlit image, choose Image+. To keep native Custom Material controls with the
Material+ UV layout, choose UV Custom.

## Build a node material

1. Choose **Node Material**.
2. Click **Open Node Editor**.
3. Add nodes from the searchable menu.
4. Connect the nodes to **Output**.
5. Choose **Bake Resolution**.
6. Inspect the material in the main viewport.

For a PBR+ graph, enable **Use node graph** before opening the editor. For image
nodes, use **Selected node image** to choose the asset. To try a starter material,
choose a recipe. Undo restores the previous graph.

[Material+ source contract](https://github.com/rbstxt/zoidium/blob/dev/plugins/material-plus/README.md)
describes node operations, baking, UV layout, and surface controls.
[PBR+ compatibility](/docs/development/project-compatibility/#pbr-uv-layout)
describes legacy UVs.
