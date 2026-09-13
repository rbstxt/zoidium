# Material+

Material+ is an external extension layer for CM3 that adds material types for
3D objects.

## Matcap Material

Matcap Material uses a view-dependent Matcap image to shade a 3D object. The
Matcap image contains the intended lighting and surface response, so the
material does not use CM3 scene lights, Roughness, Metalness, or Environment
Map reflection.

The material provides:

- Matcap image
- dynamic Color tint
- dynamic Brightness
- dynamic Opacity
- Transparency
- Blending
- Render side

Color and Brightness modify the sampled Matcap result. The material is kept
separate from CM3 Custom Material so existing Standard Material projects retain
their original lighting behavior.

## PBR+ Material

PBR+ Material uses CM3's Three.js MeshStandardMaterial. It keeps the standard
scene-lighting path while adding independent texture maps for base color,
emission, roughness, metalness, normal, and alpha.

The material provides:

- dynamic Color, Emissive, Emissive intensity, Roughness, Metalness, Normal scale,
  Reflection intensity, and Opacity
- Base color, Emissive, Roughness, Metalness, Normal, and Alpha maps
- shared Wrap, Repeat, Offset, Center, and Rotation controls for all maps
- scene Environment Reflection
- Transparency, alpha threshold, Blending, and Render side

Roughness and Metalness maps use the standard grayscale workflow. Packed maps
are not interpreted automatically. PBR+ Material uses the CM3 environment map
when Reflection is enabled.

PBR+ Material is separate from CM3 Custom Material and Matcap Material. Existing
material types and their serialized project data remain unchanged.

## UV Custom Material

UV Custom Material mirrors CM3's native Custom Material: Color, Emissive,
Roughness, Metalness, Texture, Transparency, Opacity, Blending, Render side,
Normal map, Normal scale, Wrap, Repeat, Offset, Center, Rotation, and
Reflection behave the same way and keep the same property names.

The difference is the texture UVs on 3D Text and extruded geometry. CM3 builds
those from Three.js `TextGeometry` / `ExtrudeGeometry`, whose default
`WorldUVGenerator` maps UVs in object units: caps use raw x/y, side walls use
raw x|y and `1 - z`. A texture therefore tiles once per object unit, side walls
run into negative V, and slanted or curved walls shear because the generator
projects instead of unwrapping.

While UV Custom Material is on an object, it rewrites that geometry's UVs so
every face shares one texel density: caps use the text bounds, side walls
unwrap along the outline (arc length in U, depth in V), and the text height sets
the texture unit. The outline is rebuilt from the geometry's own side walls, so
the material needs no font or source-shape access and also covers Text+
character meshes. The original UVs are stored and restored when the material is
removed, so switching back to the native Custom Material gives the original CM3
look.

Native Custom Material is not modified in any way.

## Project compatibility

Projects using Matcap Material require Zoidium. The plugin manager records the
material in project metadata, prevents disabling Material+ while it is in use,
and preserves the material as a Missing Material placeholder when the plugin is
not available.

## Building

```bash
pnpm run build:plugin-bundles
pnpm run check:plugin-manifests
pnpm run check:plugin-bundles
pnpm run verify
```
