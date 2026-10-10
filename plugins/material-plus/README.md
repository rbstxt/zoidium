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

PBR+ Material uses CM3's Three.js MeshPhysicalMaterial. It keeps the standard
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

## Node Material and node graphs

Node Material (`nodes`) uses a MeshPhysicalMaterial and bakes a project-owned,
versioned JSON graph into color, luminance, roughness, metalness, bump and opacity
maps. A connected Fresnel node controls the view-angle tint. Open Node Editor
opens the shared Zoidium graph component in a floating window with a color-map
preview. Each completed graph gesture records one native undo operation.
Image and Texture nodes use the native Selected node image property,
which imports images through CM3's project asset picker.

All 31 node types are ported from DaviFX's OpenZoid:
[DaviFX](https://www.youtube.com/@davifxarts). These include noise, ridged
fractal, turbulence, gradients, checker, image, texture, Fresnel, arithmetic,
color correction, colorizer, spectra, blackbody, random color, projection and
UVW transforms. Node IDs and port IDs are validated; graphs accept at most
200 nodes and 400 links. Invalid JSON falls back to the starter graph. Graphs
save `schemaVersion: 1` and also accept the original OpenZoid link layout.

Bakes run in a per-material worker loaded from the plugin bundle. Asset decoding
completes before a bake, and export preparation waits for the requested bake.
The key includes graph content, resolution, project frame and asset revisions.
Noise uses fixed seeds; seeking does not retain previous-frame feedback.
Resolution is limited to 128, 256 or 512. Noise lattice dimensions are capped
at 1024 to keep extreme imported settings within a memory limit.

## Additional PBR+ surface controls

PBR+ keeps its existing type ID and property keys. It shares the Node Material
shader and graph runtime and adds these optional controls:

- Color ramp, with luminance/U/V source, interpolation and factor.
- Fixed-seed procedural bump, scale and MIP falloff.
- Fresnel color, power and mix.
- Ambient occlusion map, tint, intensity and exponent. This is map-based
  shading, not geometric scene occlusion.
- Cel diffuse/specular levels and smoothness.
- UV, spherical, cylindrical or cubic projection, with projection transforms.
- Reflection layer strength, opacity and roughness; specular strength/opacity.
- Use node graph and bake resolution.

Ramp, procedural bump, Fresnel, ambient occlusion, cel, reflection layer and
graphs default off. The physical material has zero clear coat until the
reflection layer is enabled. PBR+ and Node Material also have tabbed attribute
windows containing native property rows. Their normal property lists remain
complete.

## Image+ Material

Image+ (`imageplus`) adds a separate MeshBasicMaterial with a project image,
Transparency and animated Opacity. It retains Wrap, Repeat, Offset, Center,
Rotation and Render side. Enable Transparency to fade the image with Opacity.
The native CM3 Image material is unchanged.

All Material+ types use the plugin manager's normal in-use lock and missing
material behavior. Disabling an unused plugin removes its factories and
windows; unloading materials releases their workers, textures and asset
references.
