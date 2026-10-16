# Layer Input

Layer Input is a Zoidium-only plugin for using one project video track as an information
source for another layer. The effects and Layer Source material can also use an image.

It currently provides four entry points:

- **Layer Input** effect: selects a source video track and composites its captured output
  over the current layer, with an animated source opacity.
- **Layer Input Displacement Map** effect: follows the native Displacement Map controls,
  but uses a selected video track as the displacement map.
- **Layer Source** material: selects a source video track and uses its captured output as
  a 3D material map, with an animated opacity.
- **Custom Shader Layer Input**: adds a layer selector and an input-mode selector to the
  Custom Shader property picker. The selected layer is exposed to GLSL as a sampler2D
  input, like an image.

For a Custom Shader Layer Input, the mode selector controls which stage of the selected
layer is captured:

- **Source**: the layer before its effects and masks.
- **Masks**: the layer with mask effects only.
- **Effects & Masks**: the final layer output, including effects and masks (the default).

The mode is stored with each Custom Shader Layer Input property, so separate shader
inputs can use different stages. Shader authors only need to declare the input as a
`sampler2D`; the layer picker and capture mode are provided by the external extension
layer.

References are saved as `track:id:<stable-id>` values. Track IDs are serialized with the
track data, so moving tracks does not change what a source points to. The picker disables
the owner track and any selection that would create a dependency cycle. The runtime also
has a depth and in-progress guard so malformed project data cannot recurse indefinitely.

The current MVP selects top-level video tracks. It captures the selected track through a
nested `PZ.compositor` and caches the result per root compositor, frame, and resolution.
The selected track is captured even when its video track is hidden. This keeps the
implementation in an external extension layer around CM3 and also covers preview and
export-style compositor instances. Projects containing the effect, material, or Custom
Shader input record the `layer-input` dependency in root-level project metadata.


Select **Image** in an effect or material's source picker, then choose a file in
**Source Image**. The image uses the native project asset list, appears in Assets,
and is saved in the `.pz` project. Replacing or removing it releases the previous
image and texture. With no image assigned, the effects leave their input unchanged
and the material stays transparent, matching their empty source behavior.

Time Displacement in Native FX also offers Image, even when Layer Input is disabled.
Its empty source remains **The Layer Itself**. Choosing **Other Layer…** asks to
enable Layer Input and displays its experimental warning. Approval refreshes open
property panels to show the track picker. Declining keeps the previous source.
Time Displacement projects using a track map record the Layer Input dependency.
The Custom Shader Layer Input picker is unchanged; Custom Shader already has image inputs.
