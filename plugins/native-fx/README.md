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
| Quality | Balanced | Balanced, High | Balanced uses 2 warps and 4 refinement iterations per pyramid level. High uses 3 warps and 8 iterations. |
| View | Result | Result, Motion Vectors, Confidence | Result shows the blur. Motion Vectors encodes signed horizontal and vertical velocity in red and green. Blue indicates speed. Confidence shows agreement and residual as grayscale. |

A Blur Amount or Motion Sensitivity value of zero copies the input exactly.
Identical neighboring images also copy the input exactly.
At clip boundaries, the effect ignores duplicate tap times and mirrors the available direction.
When no distinct tap exists, the effect copies the input.
A large image residual, or a residual combined with widespread inconsistent flow, triggers a scene-cut bypass.

### Processing

The solver builds a Gaussian pyramid with up to six levels.
A coarse patch search initializes fixed-count warping and robust flow refinement.
Luma, chroma, and alpha contribute to tracking.
Texture-supported constraints propagate through regions with similar colors.
Tile and neighboring velocity maxima propose foreground trajectories for the shutter reconstruction.
The reconstruction averages premultiplied RGBA without dividing RGB by alpha.

Flow fields store project pixels, so preview resolution changes scale the processing distances.
Scratch allocations follow the actual input size and active UV region.
No output from a previous render becomes an input to the next render.
Frame order, playback direction, and render time do not change the iteration count or shutter samples.

The effect probes half-float texture filtering and framebuffer completeness.
When that probe fails, it stores signed vectors as two 16-bit fixed-point components in RGBA8.
The RGBA8 representation preserves exact zero and decodes before bilinear interpolation.
The capability path can change rounding in the output.

For GPU testing, `PZ.zoidium.debugForceSmartMotionBlurRGBA8 = true` forces RGBA8 storage.
This switch applies to the current session and is not saved in projects.
The effect instance's `_smartMotionBlur.diagnostics` reports storage, maximum speed, bypass status, and sample count.

### Limits

Motion beyond the search limit cannot be tracked correctly.
Disoccluded content, repeating patterns, thin features, and multiple motions with similar colors can produce incorrect trajectories.
The current frame supplies the reconstructed colors, so fully hidden background detail is unavailable.
The effect does not provide a separate motion-vector input.

Native FX version 24 remains outside the finished-preview cache allowlist.
Version 17 is the last version approved by that cache's output oracle.
Version 24 renders live and retains the core frame sampler's input-cache behavior.
