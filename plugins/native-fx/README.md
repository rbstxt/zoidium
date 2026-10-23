# Native FX reference

Native FX contains native image effects for the Zoidium external extension layer around CM3.
The plugin bundle contains each effect's source, modules, and shader assets.

## Smart Motion Blur

**Smart Motion Blur** estimates per-pixel motion between neighboring project frames.
Its stable effect ID is `smartmotionblur`.
The effect integrates a centered shutter over the current premultiplied image.

The frame sampler captures a layer before the layer's final composite transform.
Motion from that transform is absent from the captured input.
An **Adjustment** layer above the moving content includes that motion in its input.
Footage, objects inside a **3D Scene** layer, and content inside a precomposition can also supply motion.

### Properties

| Property | Default | Range or options | Meaning |
| --- | --- | --- | --- |
| Blur Amount | 0.5 | 0 to 1 | Shutter duration in project frames. The shutter angle equals this value times 360 degrees. |
| Motion Sensitivity | 70 | 0 to 100 | Tracking search limit as a percentage of Max Displacement. |
| Vector Smoothness | 50 | 0 to 100 | Regularization weight between nearby flow estimates. |
| Max Displacement (px/frame) | 256 | 1 to 256 | Maximum tracked displacement in project pixels per frame. |
| Analysis Frames | Both | Both, Previous, Next | Neighboring project frames used to estimate motion. A single direction supplies a mirrored velocity for the other shutter half. |
| Quality | Balanced | Balanced, High | Both modes refine through quarter resolution and apply source constraints. Balanced uses a 4-pixel mesh and caps the shutter at 32 samples. High uses a 2-pixel mesh and caps it at 64. |
| View | Result | Result, Motion Vectors, Confidence | Result shows the blur. Motion Vectors encodes signed horizontal and vertical velocity in red and green. Blue indicates speed. Confidence shows agreement and residual as grayscale. |

A Blur Amount or Motion Sensitivity value of zero copies the input exactly.
Identical neighboring images also copy the input exactly.
At clip boundaries, the effect ignores duplicate tap times and mirrors the available direction.
When no distinct tap exists, the effect copies the input.
A large residual after motion compensation triggers a scene-cut bypass. Inconsistent flow alone does not trigger the bypass.

### Testing

For GPU testing, `PZ.zoidium.debugForceSmartMotionBlurRGBA8 = true` forces RGBA8 storage.
Forcing `PZ.zoidium.debugForceSmartMotionBlurGather = true` selects the gather fallback.
These switches apply to the current session and are not saved in projects.
The effect instance's `_smartMotionBlur.diagnostics` reports storage, reconstruction path, maximum speed, bypass status, and sample count.

Validation measurements appear in [Smart Motion Blur validation](../../docs/investigations/smart-motion-blur-validation.md).

### Limits

Perspective motion requires additional image registration.
On Apple M2 with ANGLE Metal, measured 1080p Balanced medians are 134 to 138 ms per frame.
High medians are 176 to 180 ms per frame.
The [validation report](../../docs/investigations/smart-motion-blur-validation.md#performance) describes the fixtures and measurements.

Motion beyond the search limit cannot be tracked correctly.
Disoccluded content, repeating patterns, thin features, and multiple motions with similar colors can produce incorrect trajectories.
The current and neighboring frames supply the reconstruction. Background detail hidden in all of those frames is unavailable.
The effect does not provide a separate motion-vector input.

A single projective transform cannot describe independent extrusion faces.
Long, thin trails retain more detail with **Quality** set to **High**.
Transform-only layer motion requires an **Adjustment** layer above the moving content.
