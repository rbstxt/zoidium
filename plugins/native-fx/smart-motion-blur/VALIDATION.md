# Smart Motion Blur round 3 validation

Round 3 is not accepted. The experimental label remains.
The source and generated Native FX bundle are version 25.
All repository changes belong to `feat/smart-motion-blur` in `/Users/dia/.t3/worktrees/Zoidium/t3-b60c3199`.
No changes were pushed or merged.

## Gate summary

| Gate | Result | Measurement |
| --- | --- | --- |
| 1-pixel square flow | Pass | 0.164036988 px worst median; gate ≤0.25 |
| 2.5-pixel square flow | Fail | Noise: 0.269662417 px half-float, 0.268565558 px RGBA8; gate ≤0.25 |
| 16, 64, and 128-pixel square flow | Pass | 0.115634467 px worst median |
| Stationary background | Fail | 6 codes worst change; gate ≤1 |
| Square rotation, square scale, and text-mask rotation | Fail | Rotating-square median endpoint error 17.827628280 px exceeds 2 px. Minimum IoU 0.967672173; maximum alpha error 0.728113932% |
| Shutter trail and white composite | Pass | Maximum trail error 2 px; dark fringe 0 codes |
| Static, amount zero, hard cut, and duplicate-only boundary | Pass | 0 changed bytes in each case |
| Frame-order determinism | Pass | 0 differing bytes across 28 renders |
| Native CM3 PSNR | Fail | 28/32 modes pass; Y rotation fails |
| Native rotating-text silhouette and alpha | Fail | Z rotation passes; Y rotation fails. Detailed values follow. |
| No broken strokes, notches, or speckles | Fail | Y-rotation crops retain stroke defects |
| Both false-cut regression rotations | Pass | 0 false cuts across 8 modes |
| 1080p Balanced median | Pass | 81.799999952 ms half-float; 77.799999952 ms RGBA8; gate ≤100 |
| Vertex-texture fallback | Pass | 0 differing bytes against forced gather on both storage paths |
| Editor workflows and moving Player+ half preview | Pass | 0 console errors and GL error zero |
| Repository checks and resource boundary | Pass | 2,668 tests; 31 bundles; deployment tree inspected and removed |

## Test environment

GPU: Apple M2 through ANGLE Metal. The host has 8 GB RAM.
Each browser harness uses `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.
One harness Chromium runs at a time.
The host's existing applications remain open during measurement.
The copied CM3 resource cache is configured with `ZOIDIUM_RESOURCE_DIR`.
The editor uses port 8157. The isolated GPU harness uses port 8158.
The cache, source captures, references, logs, projects, and crops remain outside Git in:

`/Users/dia/Projects/GitHub/zoidium-beta-work/rsmb/round3/`

## Algorithm

The result path uses forward mesh warping for each centered shutter sample.
Balanced uses one grid vertex every four processing pixels. High uses two.
Vertices read the previous-direction field for negative shutter times and the next-direction field for positive times.
Color-guided field interpolation separates foreground and background motion at mesh boundaries.
A triangle collapses when its vertex vectors differ by more than 16 processing pixels.
A speed-based depth value places faster overlapping sheets in front of slower sheets.
Transparent fragments do not write depth. This rule is an occlusion heuristic.

Each sample draws a background base before its displaced mesh.
Validated transparent scenes use the border observation for uncovered pixels.
Validated opaque scenes use the neighboring image, warped toward the shutter time.
Local-flow scenes prefer a lower-energy neighbor observation where the current foreground moves.
This heuristic can misidentify bright backgrounds behind dark foregrounds.

Four batches accumulate premultiplied RGBA.
Each batch normalizes its own sample count before the final weighted combination.
This preserves total weight when the sample count is not divisible by four.
Half-float batches use half-float targets. RGBA8 batches limit repeated 8-bit additions.
No reconstruction pass divides RGB by accumulated alpha.

A coarse moment fit proposes a similarity or affine transform.
A search over source-flow candidates also proposes a coherent translation.
A proposal must reduce the compensated residual on raw source textures before it replaces local flow.
Validating only blurred pyramid images incorrectly moved stationary noise and was rejected.
The final validation uses a 128 by 96 sample grid.

Fully transparent source texels skip seed, refinement, constraint, propagation, and interpolation searches. Opaque black and noise use the ordinary solver.

Forward flow retains two warps and four iterations through quarter resolution.
Reverse fields use one warp and two iterations. Reverse fields omit source constraints and their four propagation fields.
A synchronized profile confirms that the constraints-and-propagation group falls from 164 to 82 draws per frame.
That profile adds synchronization to every pass and does not represent normal frame time.

Cut detection requires a large residual after motion compensation.
Forward/backward inconsistency alone no longer triggers a cut.
The renderer retains one four-byte statistics readback per analyzed frame.
Amount-zero and duplicate-only boundary frames do not require that readback.

The fallback uses round-2 gather reconstruction when fewer than four vertex texture units are available.
`PZ.zoidium.debugForceSmartMotionBlurGather` forces this path.
The existing RGBA8 debug switch remains available.

The 1 and 2.5 pixel translation inputs use exact box-filtered square coverage.
Each square pixel receives the area of its intersection with the translated rectangle.
The fixed-noise background remains stationary before foreground compositing.

## Translation endpoint error

Distances are project pixels. The gate applies to the median of the whole square foreground.
The interior-only result does not determine a pass.
Each row contains both qualities and both storage paths.

### Black background

| Speed | Half Balanced | Half High | RGBA8 Balanced | RGBA8 High | Gate | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.000030519 | 0.000030519 | 0.007843257 | 0.007843257 | ≤0.25 | Pass |
| 2.5 | 0.023361919 | 0.023361919 | 0.023361919 | 0.023361919 | ≤0.25 | Pass |
| 16 | 0.007324442 | 0.007324442 | 0.000488296 | 0.000488296 | ≤1 | Pass |
| 64 | 0.029297769 | 0.029297769 | 0.005859554 | 0.005859554 | ≤1 | Pass |
| 128 | 0.058595538 | 0.058595538 | 0.003906369 | 0.003906369 | ≤2 | Pass |

### Transparent background

| Speed | Half Balanced | Half High | RGBA8 Balanced | RGBA8 High | Gate | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.000030519 | 0.000030519 | 0.000030519 | 0.000030519 | ≤0.25 | Pass |
| 2.5 | 0.023361919 | 0.023361919 | 0.023361919 | 0.023361919 | ≤0.25 | Pass |
| 16 | 0.000488296 | 0.000488296 | 0.000488296 | 0.000488296 | ≤1 | Pass |
| 64 | 0.029297769 | 0.029297769 | 0.001953185 | 0.001953185 | ≤1 | Pass |
| 128 | 0.058595538 | 0.058595538 | 0.003906369 | 0.003906369 | ≤2 | Pass |

### Fixed-noise background

| Speed | Half Balanced | Half High | RGBA8 Balanced | RGBA8 High | Gate | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.164036988 | 0.164036988 | 0.164036988 | 0.164036988 | ≤0.25 | Pass |
| 2.5 | 0.269662417 | 0.269662417 | 0.268565558 | 0.268565558 | ≤0.25 | Fail |
| 16 | 0.049645577 | 0.049645577 | 0.056745391 | 0.056745391 | ≤2 | Pass |
| 64 | 0.115634467 | 0.115634467 | 0.098068541 | 0.098068541 | ≤2 | Pass |
| 128 | 0.003906369 | 0.003906369 | 0.003906369 | 0.003906369 | ≤3 | Pass |

## Stationary background outside the shutter sweep

The maximum permitted difference is one RGBA8 code. These values include every pixel outside the swept area plus a four-pixel margin.

| Background | Speed | Half Balanced | Half High | RGBA8 Balanced | RGBA8 High | Result |
| --- | --- | --- | --- | --- | --- | --- |
| black | 1 | 0 | 0 | 0 | 0 | Pass |
| black | 2.5 | 0 | 0 | 0 | 0 | Pass |
| black | 16 | 0 | 0 | 0 | 0 | Pass |
| black | 64 | 0 | 0 | 0 | 0 | Pass |
| black | 128 | 0 | 0 | 0 | 1 | Pass |
| transparent | 1 | 0 | 0 | 0 | 0 | Pass |
| transparent | 2.5 | 0 | 0 | 0 | 0 | Pass |
| transparent | 16 | 0 | 0 | 0 | 0 | Pass |
| transparent | 64 | 0 | 0 | 0 | 0 | Pass |
| transparent | 128 | 0 | 0 | 0 | 0 | Pass |
| noise | 1 | 0 | 0 | 0 | 0 | Pass |
| noise | 2.5 | 0 | 0 | 0 | 0 | Pass |
| noise | 16 | 0 | 0 | 1 | 1 | Pass |
| noise | 64 | 0 | 5 | 2 | 6 | Fail |
| noise | 128 | 0 | 1 | 4 | 4 | Fail |

## Rotation, scale, and shutter coverage

| Fixture | Mode | Median error, px | Silhouette IoU | Alpha-mass error, % | Result |
| --- | --- | --- | --- | --- | --- |
| Rotating square | Half-float Balanced | 17.827628280 | 0.984972874 | 0.003298509 | Fail |
| Scaling square | Half-float Balanced | 0.024156573 | 1.000000000 | 0.084716939 | Pass |
| Rotating text mask | Half-float Balanced | 0.074068194 | 0.967715479 | 0.684116835 | Pass |
| Rotating square | Half-float High | 17.827628280 | 0.985849801 | 0.039438220 | Fail |
| Scaling square | Half-float High | 0.024156573 | 1.000000000 | 0.084621234 | Pass |
| Rotating text mask | Half-float High | 0.074068194 | 0.967672173 | 0.728113932 | Pass |
| Rotating square | RGBA8 Balanced | 17.756064015 | 0.984599707 | 0.023260667 | Fail |
| Scaling square | RGBA8 Balanced | 0.019986624 | 1.000000000 | 0.090865977 | Pass |
| Rotating text mask | RGBA8 Balanced | 0.077505510 | 0.967716682 | 0.666929868 | Pass |
| Rotating square | RGBA8 High | 17.756064015 | 0.985404498 | 0.038570561 | Fail |
| Scaling square | RGBA8 High | 0.019986624 | 1.000000000 | 0.090842051 | Pass |
| Rotating text mask | RGBA8 High | 0.077505510 | 0.967709460 | 0.714910954 | Pass |

The text-mask fixture uses the existing CM3 text mask. Native CM3 rotation coverage is also reported below.
The square rotation is 0.25 radians per frame. The scale factor is 1.1 per frame.

| Mode | Amount | Expected trail, px | Measured trail, px | Alpha-mass error, % | Fringe, codes | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Half-float Balanced | 0.25 | 16 | 16 | 0.000000000 | 0 | Pass |
| Half-float Balanced | 0.5 | 32 | 30 | 0.001531863 | 0 | Pass |
| Half-float Balanced | 1 | 64 | 62 | 0.002979952 | 0 | Pass |
| Half-float High | 0.25 | 16 | 16 | 0.000000000 | 0 | Pass |
| Half-float High | 0.5 | 32 | 30 | 0.001531863 | 0 | Pass |
| Half-float High | 1 | 64 | 62 | 0.010794845 | 0 | Pass |
| RGBA8 Balanced | 0.25 | 16 | 16 | 0.000000000 | 0 | Pass |
| RGBA8 Balanced | 0.5 | 32 | 30 | 0.009191176 | 0 | Pass |
| RGBA8 Balanced | 1 | 64 | 62 | 0.003063725 | 0 | Pass |
| RGBA8 High | 0.25 | 16 | 16 | 0.000000000 | 0 | Pass |
| RGBA8 High | 0.5 | 32 | 30 | 0.009191176 | 0 | Pass |
| RGBA8 High | 1 | 64 | 62 | 0.356935987 | 0 | Pass |

## Exact bypasses and frame order

| Check | Differing bytes | Result |
| --- | --- | --- |
| Static black and fixed noise | 0 | Pass |
| Amount zero | 0 | Pass |
| Hard cut | 0 | Pass |
| Duplicate-only boundary | 0 | Pass |
| Forward, reverse, and shuffled frames | 0 | Pass |

All 148 synthetic cases report GL error zero. Console and shader errors: 0.

## Real CM3 content

Each test renders at 768 by 512 with Blur Amount 0.5, Motion Sensitivity 100, Vector Smoothness 50, Max Displacement 256, and Analysis Frames Both.
The reference averages 64 native fractional taps over the centered interval `[-0.25, +0.25]`.
The reference renderer remains in the external harness. It does not ship in the plugin.
PSNR uses premultiplied RGB. The motion region is the union of reference silhouettes, dilated by four pixels.
The full-frame gate is 30 dB. The motion-region gate is 24 dB.

| CM3 case | Storage | Balanced full, dB | Balanced region, dB | High full, dB | High region, dB | Result |
| --- | --- | --- | --- | --- | --- | --- |
| scene-translation | Half-float | 46.250427882 | 36.203947004 | 46.250427882 | 36.203947004 | Pass |
| scene-translation | RGBA8 | 44.663716916 | 34.617236038 | 44.663716916 | 34.617236038 | Pass |
| scene-rotation-z | Half-float | 39.915114939 | 29.448764151 | 39.912092260 | 29.445741472 | Pass |
| scene-rotation-z | RGBA8 | 39.930952693 | 29.464601905 | 39.918707778 | 29.452356990 | Pass |
| scene-rotation-y | Half-float | 29.418792554 | 18.681456692 | 29.952779886 | 19.245683385 | Fail |
| scene-rotation-y | RGBA8 | 29.851295984 | 19.136585134 | 30.401556655 | 19.723718908 | Fail |
| scene-scaling | Half-float | 40.174842171 | 29.339071055 | 40.207791435 | 29.372020320 | Pass |
| scene-scaling | RGBA8 | 40.168229329 | 29.332458214 | 40.204320819 | 29.368549703 | Pass |
| adjustment-translation | Half-float | 55.196523203 | 48.154533367 | 47.207719125 | 40.165729289 | Pass |
| adjustment-translation | RGBA8 | 54.912794628 | 47.870804792 | 47.246362050 | 40.204372214 | Pass |
| adjustment-rotation | Half-float | 38.139704123 | 30.524161871 | 38.165790730 | 30.550248479 | Pass |
| adjustment-rotation | RGBA8 | 38.177863582 | 30.562321331 | 38.197857606 | 30.582315355 | Pass |
| adjustment-scaling | Half-float | 51.054622531 | 42.980647758 | 51.226467208 | 43.152492435 | Pass |
| adjustment-scaling | RGBA8 | 50.752343624 | 42.678368851 | 51.164083058 | 43.090108285 | Pass |
| footage-pan | Half-float | 48.226537925 | 47.860067038 | 48.226495820 | 47.860024933 | Pass |
| footage-pan | RGBA8 | 48.149950072 | 47.783479053 | 48.150107463 | 47.783636445 | Pass |

### Native rotating-text coverage

| CM3 case | Mode | Silhouette IoU | Alpha-mass error, % | Result |
| --- | --- | --- | --- | --- |
| scene-rotation-z | Half-float Balanced | 0.970436538 | 0.713658625 | Pass |
| scene-rotation-z | Half-float High | 0.970502467 | 0.762192546 | Pass |
| scene-rotation-z | RGBA8 Balanced | 0.970400269 | 0.697557598 | Pass |
| scene-rotation-z | RGBA8 High | 0.970467290 | 0.746668617 | Pass |
| scene-rotation-y | Half-float Balanced | 0.922395274 | 2.846856706 | Fail |
| scene-rotation-y | Half-float High | 0.932054753 | 2.124201588 | Fail |
| scene-rotation-y | RGBA8 Balanced | 0.925884701 | 2.509776808 | Fail |
| scene-rotation-y | RGBA8 High | 0.927582008 | 1.819742900 | Fail |
| adjustment-rotation | Half-float Balanced | 0.972045184 | 0.763650408 | Pass |
| adjustment-rotation | Half-float High | 0.971915240 | 0.741492524 | Pass |
| adjustment-rotation | RGBA8 Balanced | 0.971816522 | 0.693981348 | Pass |
| adjustment-rotation | RGBA8 High | 0.971621379 | 0.672672530 | Pass |

### False-cut regressions

| CM3 case | Mode | Scene cut | Changed bytes from sharp source | Result |
| --- | --- | --- | --- | --- |
| scene-rotation-z | Half-float Balanced | False | 49292 | Pass |
| scene-rotation-z | Half-float High | False | 49264 | Pass |
| scene-rotation-z | RGBA8 Balanced | False | 49304 | Pass |
| scene-rotation-z | RGBA8 High | False | 49288 | Pass |
| adjustment-rotation | Half-float Balanced | False | 135603 | Pass |
| adjustment-rotation | Half-float High | False | 135635 | Pass |
| adjustment-rotation | RGBA8 Balanced | False | 134705 | Pass |
| adjustment-rotation | RGBA8 High | False | 134766 | Pass |

All native-content renders report GL error zero.
Native-content console and preparation errors: 0.

## Performance

Each test uses 20 warm-up frames and 300 measured frames at 1920 by 1080.
The whole-effect time includes its readback and a GPU completion wait. Scene capture is excluded.
The input is a 256 by 256 square translating 64 pixels per frame over transparency.
The gate is a Balanced median of at most 100 ms on each storage path.

| Mode | Frames | Median, ms | p95, ms | Balanced gate |
| --- | --- | --- | --- | --- |
| Half-float Balanced | 300 | 81.799999952 | 90.699999928 | Pass |
| Half-float High | 300 | 116.000000000 | 134.300000072 | Not specified |
| RGBA8 Balanced | 300 | 77.799999952 | 87.199999928 | Pass |
| RGBA8 High | 300 | 135.800000072 | 288.700000048 | Not specified |

Performance console and shader errors: 0.
The same host had other applications open during the measurements. The reported values are the measured results; no failure is reclassified.

## Gather fallback

| Storage | Forced zero vertex units path | Forced-gather path | Differing bytes | GL error |
| --- | --- | --- | --- | --- |
| Half-float | gather | gather | 0 | 0 |
| RGBA8 | gather | gather | 0 | 0 |

The test forces `MAX_VERTEX_TEXTURE_IMAGE_UNITS` to zero and compares the output with the explicit gather switch.
Both paths use the same 64-pixel translation fixture.
Fallback console and shader errors: 0.

## Real editor workflow

| Operation | Result |
| --- | --- |
| 3D scene moving Text | Pass |
| change every property | Pass |
| scrub play half preview | Pass |
| adjustment above moving Text layer | Pass |
| video footage effect | Pass |
| save and reopen project | Pass |
| normal export | Pass |
| delete effect cleanly | Pass |
| GL error | 0 |

UI console errors: 0.

The separate moving Player+ half-preview check passes. It records 28 shutter samples, a 274 by 154 flow field, `static = false`, splat reconstruction, GL error zero, and zero console errors.
The normal export contains 60 VP8 frames at 640 by 360 and lasts 2.008 seconds.

## Crops

Each comparison contains the sharp source, the 64-tap reference, and both qualities on both storage paths.
All paths are relative to `/Users/dia/Projects/GitHub/zoidium-beta-work/rsmb/round3/`.

- `scene-translation-crops.png`
- `scene-rotation-z-crops.png`
- `scene-rotation-y-crops.png`
- `scene-scaling-crops.png`
- `adjustment-translation-crops.png`
- `adjustment-rotation-crops.png`
- `adjustment-scaling-crops.png`
- `footage-pan-crops.png`

## Repository checks

- `pnpm run build:plugin-bundles`: Pass. 31 bundles, including 32 Smart Motion Blur supporting assets.
- `pnpm run check:plugin-manifests`: Pass. 31 manifests.
- `pnpm run check:plugin-bundles`: Pass. 31 bundles.
- `pnpm run verify`: Pass. 2,668 tests, zero failures. File length, ESLint, syntax, manifests, and bundles pass.
- `pnpm run build:web`: Pass. Native FX version 25, current bundle, bootstrap, and local Source Code Pro verified. The inspected deployment tree is removed.
- Resource boundary: no CM3 runtime files or generated deployment stage are tracked. The copied CM3 cache stays outside Git.

## Remaining limitations and rejected trials

The local matcher still exceeds the 0.25-pixel gate on the 2.5-pixel fixed-noise fixture.
Replacing its small-motion membership cost with a color residual increased the 1-pixel noise error to 1 pixel.
The same trial increased the 2.5-pixel noise error to 0.637322077 pixels. That trial was rejected.

Torn local meshes and RGBA8 batch rounding still change some stationary pixels by more than one code.
A centered-difference RGBA8 accumulation trial left a four-code background error and introduced an alpha offset.
The final code retains four ordinary normalized batches. The background gate remains unmet.

Y rotation changes the projected widths and occlusions of extruded Text.
The tested similarity and covariance-affine proposals do not pass the raw residual check.
Local flow remains active and retains visible stroke defects in the Y-rotation crops.
The real-content PSNR and no-artifact gates remain unmet for that case.

A 4-pixel mesh also trades boundary coverage for processing cost. A 2-pixel mesh increases GPU work.
RGBA8 storage and the gather fallback retain separate precision and occlusion limitations.
No gate has been relaxed, and failed values are not rounded into passes.
