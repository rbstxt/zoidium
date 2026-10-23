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

### Processing

The solver builds a Gaussian pyramid with up to six levels.
A coarse patch search initializes flow refinement through quarter resolution.
Raw-source constraints use a soft census cost for textured patches and region membership for uniform patches.
The matcher classifies source texels before interpolation to reduce edge bias at slow speeds.

Four directional fields retain the positions of sparse constraints.
A spatially weighted affine fit fills flat regions.
A similarity fit or translation handles insufficient spatial support.
Color checks along propagation paths reject observed boundaries, but do not guarantee connectivity across thin gaps.

A coarse image-moment fit proposes a coherent rotation, scale, or affine transform.
A source-flow search also proposes a whole-image translation.
The effect accepts a proposal only when it reduces the raw-source warped residual.
This validation retains the source texture detail, including stationary noise.

The reconstruction forward-warps a mesh for each shutter sample.
A triangle is removed when its vertex motions differ by more than 16 processing pixels.
Color-guided vertex sampling limits flow interpolation across foreground boundaries.
At overlapping triangles, the faster sheet writes the nearer depth.
Empty premultiplied fragments do not write depth.
This speed rule is an occlusion heuristic, not a depth estimate.

Each sample draws a background estimate before the mesh.
A validated transparent scene uses the border observation as its uncovered base.
A validated opaque scene uses the neighboring image, warped toward the sample time.
For local motion, the base prefers the lower-energy observation where motion is present.
This rule can fail when a bright background becomes visible behind a dark foreground.

Four independently normalized batches accumulate premultiplied RGBA.
Half-float batches use half-float render targets.
RGBA8 batches reduce accumulation error but still leave measurable background errors.
The reconstruction never divides RGB by alpha.
When fewer than four vertex texture units are available, the effect uses the gather fallback.
One reduction combines static, cut, confidence, and speed statistics into one four-byte GPU readback.
Reverse fields use one warp and two refinement iterations for consistency checks.
Forward fields retain two warps and four refinement iterations.

Flow fields store project pixels, so preview resolution changes scale the processing distances.
Scratch allocations follow the actual input size and active UV region.
No output from a previous render becomes an input to the next render.
Frame order, playback direction, and render time do not change the iteration count or shutter samples.

The effect probes half-float texture filtering and framebuffer completeness.
When that probe fails, it stores signed vectors as two 16-bit fixed-point components in RGBA8.
The RGBA8 representation preserves exact zero and decodes before bilinear interpolation.
The storage path can change constraint validity and output quality, particularly on rotating text.

For GPU testing, `PZ.zoidium.debugForceSmartMotionBlurRGBA8 = true` forces RGBA8 storage.
Forcing `PZ.zoidium.debugForceSmartMotionBlurGather = true` selects the gather fallback.
These switches apply to the current session and are not saved in projects.
The effect instance's `_smartMotionBlur.diagnostics` reports storage, reconstruction path, maximum speed, bypass status, and sample count.

Validation measurements appear in [Smart Motion Blur validation](smart-motion-blur/VALIDATION.md).

### Limits

This version remains experimental.
Round 3 still fails the 2.5-pixel fixed-noise accuracy gate and some stationary-background checks.
The native 3D Text Y-rotation PSNR gate also remains unmet.
Translation, Z rotation, and scale improve with validated coherent motion.
The complete quality and performance results appear in the validation report.

Motion beyond the search limit cannot be tracked correctly.
Disoccluded content, repeating patterns, thin features, and multiple motions with similar colors can produce incorrect trajectories.
The current and neighboring frames supply the reconstruction. Background detail hidden in all of those frames is unavailable.
The effect does not provide a separate motion-vector input.

Native FX version 25 remains outside the finished-preview cache allowlist.
Version 17 is the last version approved by that cache's output oracle.
Version 25 renders live and retains the core frame sampler's input-cache behavior.
