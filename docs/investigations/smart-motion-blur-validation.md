# Smart Motion Blur validation

This reference records Native FX version 27 on Apple M2.
The final measurements replace earlier implementation-round reports.
The preceding implementation passed the image gates but took about 2.2 seconds for perspective motion at 768 by 512.

## Gate summary

| Gate | Result | Measurement |
| --- | --- | --- |
| 1 px/frame translation | Pass | 0.091085 px worst foreground median |
| 2.5 px/frame translation | Pass | 0.033093 px worst foreground median |
| 16 px/frame translation | Pass | 0.124760 px worst foreground median |
| 64 px/frame translation | Pass | 0.115634 px worst foreground median |
| 128 px/frame translation | Pass | 0.113285 px worst foreground median |
| Stationary background | Pass | 0 codes worst change |
| Square rotation, scale, and text-mask rotation | Pass | Error ≤0.529678 px; IoU ≥0.952912; alpha error ≤0.718433% |
| Shutter trail and fringe | Pass | Trail error ≤2 px; fringe 0 codes |
| Exact bypasses | Pass | Static, amount zero, cut, and duplicate-only boundary: 0 changed bytes |
| Synthetic frame-order determinism | Pass | 0 differing bytes across 28 reordered renders |
| Native CM3 PSNR | Pass | 32/32 modes; full ≥35.534095 dB; region ≥24.732331 dB |
| Native rotating-text coverage | Pass | IoU ≥0.970364; alpha error ≤0.756109% |
| Y-rotation region PSNR and coverage | Pass | Region ≥24.732331 dB; IoU ≥0.972980 |
| Comparison crops | Pass | All eight final crops inspected; no streak bands, broken strokes, notches, or isolated speckles |
| False cuts | Pass | 0 across all 32 native modes |
| 1080p translating-square Balanced median | Pass | Half-float Balanced 71.900000 ms; RGBA8 Balanced 70.200000 ms |
| 1080p perspective Balanced median | Pass | Half-float Balanced 137.600000 ms; RGBA8 Balanced 133.800000 ms |
| Gather fallback equivalence | Pass | 0 differing bytes on both storage paths |
| Native frame-order determinism | Pass | 0 differing bytes after mode and case changes, and across each warmed benchmark |
| Projective trigger exclusion | Pass | 0/28 non-perspective native modes, including footage pan |
| Editor workflows and moving half preview | Pass | Eight workflows; moving Player+ half preview; console errors 0; GL error 0 |
| Console and shader errors | Pass | 0 across all final harnesses |
| GPU error state | Pass | GL error zero in all final modes and benchmark batches |
| Repository verification | Pass | 2,669 tests; 31 manifests and bundles; syntax, file length, ESLint no-undef |
| Documentation site and deployment | Pass | 67 documentation pages; deployment bundle, bootstrap, and Source Code Pro inspected; dist/web removed |

## Method and environment

The GPU is Apple M2 through ANGLE Metal on an 8 GB Mac.
The Chromium harness uses `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.
The final suite runs one harness browser at a time.
Whole-effect timing includes readbacks and a GPU completion wait.
Timing excludes scene capture, texture creation, and shader compilation.
The perspective benchmark uses native CM3 captures at each measured resolution, without resizing 768-pixel captures.
Each perspective mode has 10 warm-up frames followed by 30 measured frames.
The translating-square benchmark has 20 warm-up frames followed by 300 measured frames.

The synthetic suite contains 148 cases across both qualities and storage paths.
Endpoint error measures the whole foreground in project pixels.
The 1 and 2.5-pixel cases use box-filtered square coverage over black, transparent, and fixed-noise backgrounds.
Native comparisons use 64 fractional CM3 taps across the centered shutter interval `[-0.25, +0.25]`.
Native settings are Blur Amount 0.5, Motion Sensitivity 100, Vector Smoothness 50, Max Displacement 256, and Analysis Frames Both.
Native quality cases render at 768 by 512.
PSNR measures premultiplied RGB. The region is the union of reference silhouettes, dilated by four pixels.
The native gates are full-frame PSNR ≥30 dB, region PSNR ≥24 dB, silhouette IoU ≥0.95, and alpha-mass error ≤2%.

Reproducibility artifacts remain Git-ignored in `dist/round5/` of the implementation worktree.
`final-suite.cjs` runs the acceptance, fallback, reconstruction diagnostics, native-content, UI, half-preview, perspective-performance, native-determinism, and translation-performance harnesses.
`acceptance-results.json`, `real-content-results.json`, `native-performance-results.json`, and `performance-results.json` retain unrounded measurements.
`offline-results.json` records projective triggers for all native cases.
`native-determinism-results.json` records byte comparisons after case, quality, and storage changes.
The source CM3 cache remains in `.zoidium-resources/`.
The harnesses and source captures do not ship in plugin bundles.

## Projective fitting and bounded work

The fit retains coordinate search over eight homography coefficients.
It uses four iterations at each of eight fixed radii, with a fixed coefficient order.
Each coefficient update evaluates the unchanged, negative, and positive candidates in parallel.
Each candidate owns an 8 by 8 grid of tiles for each neighboring direction.
A tile evaluates at most 16 by 16 guide pixels.
A separate pass reduces the 64 normalized tile costs before selecting a coefficient.
This preserves the tested image-residual objective without a CPU solve or additional readbacks.
The fit has 769 bounded draws.
The prior search used 256 whole-image cost draws plus an initialization draw.

Registration and projective reduction targets use nearest-filtered RGBA8 with a normalized 24-bit fixed-point value.
The half-float path uses this same representation for reductions and homography coefficients.
Each reduction averages bounded values rather than adding half-float totals.
The byte codec has 16,777,216 levels between zero and one.
Tile values and their averages stay in that range before moment normalization.
Float32 arithmetic and guide-area normalization add rounding error.
Moment normalization accounts for guide area after reduction.
The integer encoder clamps the rounded upper endpoint before byte extraction, so a full tile remains exactly one.
Strict comparisons break ties in a fixed order.
No previous output initializes a later frame.
The byte comparisons in the gate table establish determinism on the measured environment, not cross-GPU bit identity.

| Pass | Maximum texture reads per fragment | Bound |
| --- | --- | --- |
| Projective candidate tile | 520 | 256 image pairs plus eight coefficients |
| Statistic reduction | 64 | 8 by 8 partial values |
| Moment tile | 257 | 256 guide texels plus border observation |
| Raw registration tile | <420 | 192 image pairs plus transform statistics |
| Translation candidate | 385 | 192 image pairs plus one source vector |
| Local constraint search | 3189 | 18 costs of 177 reads plus source, state, and vector |
| Coarse seed | <2500 | Cached current features; 83 candidates with 29 other-image reads |
| Tile maximum | 2816 | 256 pixels with at most 11 reads each |
| Gather reconstruction | <3500 | 64 samples with cached destination velocities |

The bounds count `texture2D` calls, including calls inside helpers.
Hardware filtering can read several texels for one sample.

Local constraints cache patch classification before search.
The coarse search evaluates one 17-candidate row per draw.
Eight raw refinement stages and seven Gaussian refinement stages follow.
Separate targets retain the original seed and prevent framebuffer feedback, including at 1 by 1 input sizes.
The seed matcher caches the current patch and gradient once per fragment.
Gather reconstruction reuses destination velocities across shutter samples.

## Projective trigger rate

A projective fit requires a rejected coherent registration in at least one direction.
The affine horizontal and vertical scales must differ by more than 0.03.
Vertical scale must remain within 0.2 of one.
The normalized border residual must be below 0.002.
The border check excludes occupied, changing frame boundaries typical of full-frame footage.
Accepted translation, rotation, and scale proposals bypass the fit.
A final raw-source residual check validates the projective proposal.

| Native case | Triggered modes | Measured modes |
| --- | --- | --- |
| scene-translation | 0 | 4 |
| scene-rotation-z | 0 | 4 |
| scene-rotation-y | 4 | 4 |
| scene-scaling | 0 | 4 |
| adjustment-translation | 0 | 4 |
| adjustment-rotation | 0 | 4 |
| adjustment-scaling | 0 | 4 |
| footage-pan | 0 | 4 |

These rates describe the eight native fixtures and both storage paths and qualities.
They do not establish a trigger rate for arbitrary handheld video.
An isolated foreground with a stable border can still require a fit on every eligible frame.
The algorithm bounds that cost per frame instead of using history-dependent throttling.

## Native-content quality

| Case | Mode | Full PSNR, dB | Region PSNR, dB | Silhouette IoU | Alpha error, % |
| --- | --- | --- | --- | --- | --- |
| scene-translation | Half-float Balanced | 45.465332 | 35.418851 | 0.997035 | 0.490229 |
| scene-translation | Half-float High | 45.465332 | 35.418851 | 0.997035 | 0.490229 |
| scene-translation | RGBA8 Balanced | 45.301968 | 35.255487 | 0.993771 | 0.450483 |
| scene-translation | RGBA8 High | 45.316110 | 35.269629 | 0.993771 | 0.450234 |
| scene-rotation-z | Half-float Balanced | 39.914027 | 29.447676 | 0.970400 | 0.704213 |
| scene-rotation-z | Half-float High | 39.915212 | 29.448862 | 0.970502 | 0.752074 |
| scene-rotation-z | RGBA8 Balanced | 39.923159 | 29.456808 | 0.970364 | 0.699212 |
| scene-rotation-z | RGBA8 High | 39.915033 | 29.448682 | 0.970430 | 0.747630 |
| scene-rotation-y | Half-float Balanced | 35.534321 | 24.732557 | 0.973249 | 0.719868 |
| scene-rotation-y | Half-float High | 35.534095 | 24.732331 | 0.973481 | 0.721098 |
| scene-rotation-y | RGBA8 Balanced | 35.541366 | 24.739602 | 0.972980 | 0.703513 |
| scene-rotation-y | RGBA8 High | 35.541299 | 24.739535 | 0.973020 | 0.706346 |
| scene-scaling | Half-float Balanced | 40.176409 | 29.340638 | 0.976173 | 0.133266 |
| scene-scaling | Half-float High | 40.212054 | 29.376283 | 0.977857 | 0.203008 |
| scene-scaling | RGBA8 Balanced | 40.173425 | 29.337654 | 0.975610 | 0.106499 |
| scene-scaling | RGBA8 High | 40.209388 | 29.373617 | 0.973084 | 0.178794 |
| adjustment-translation | Half-float Balanced | 55.193512 | 48.151523 | 0.992932 | 0.003501 |
| adjustment-translation | Half-float High | 47.209203 | 40.167213 | 0.992932 | 0.197808 |
| adjustment-translation | RGBA8 Balanced | 55.202896 | 48.160906 | 0.993436 | 0.044695 |
| adjustment-translation | RGBA8 High | 47.249768 | 40.207778 | 0.993436 | 0.149220 |
| adjustment-rotation | Half-float Balanced | 38.143187 | 30.527645 | 0.972061 | 0.756109 |
| adjustment-rotation | Half-float High | 38.167667 | 30.552125 | 0.971915 | 0.733541 |
| adjustment-rotation | RGBA8 Balanced | 38.160850 | 30.545308 | 0.972000 | 0.722256 |
| adjustment-rotation | RGBA8 High | 38.182721 | 30.567179 | 0.971855 | 0.700473 |
| adjustment-scaling | Half-float Balanced | 51.073958 | 42.999984 | 0.992148 | 0.102713 |
| adjustment-scaling | Half-float High | 51.224276 | 43.150301 | 0.993977 | 0.125315 |
| adjustment-scaling | RGBA8 Balanced | 50.862851 | 42.788877 | 0.991883 | 0.066279 |
| adjustment-scaling | RGBA8 High | 51.124776 | 43.050801 | 0.991286 | 0.079080 |
| footage-pan | Half-float Balanced | 48.221067 | 47.854596 | 1.000000 | 0.025184 |
| footage-pan | Half-float High | 48.221214 | 47.854744 | 1.000000 | 0.025184 |
| footage-pan | RGBA8 Balanced | 48.137875 | 47.771403 | 1.000000 | 0.024670 |
| footage-pan | RGBA8 High | 48.137839 | 47.771368 | 1.000000 | 0.024670 |

## Performance

The earlier 768 by 512 perspective measurements were 2265.4 ms for half-float Balanced, 2235.1 ms for half-float High, 2261.7 ms for RGBA8 Balanced, and 2238.2 ms for RGBA8 High.
Those measurements were individual renders, not warmed medians.
No earlier native 1080p perspective measurement is available.

| Perspective resolution | Mode | Measured frames | Median, ms | p95, ms | Projective fits |
| --- | --- | --- | --- | --- | --- |
| 768 by 512 | Half-float Balanced | 30 | 91.000000 | 91.800000 | 30 |
| 768 by 512 | Half-float High | 30 | 94.900000 | 96.300000 | 30 |
| 768 by 512 | RGBA8 Balanced | 30 | 90.300000 | 95.300000 | 30 |
| 768 by 512 | RGBA8 High | 30 | 93.800000 | 95.200000 | 30 |
| 1920 by 1080 | Half-float Balanced | 30 | 137.600000 | 146.400000 | 30 |
| 1920 by 1080 | Half-float High | 30 | 175.800000 | 197.500000 | 30 |
| 1920 by 1080 | RGBA8 Balanced | 30 | 133.800000 | 142.200000 | 30 |
| 1920 by 1080 | RGBA8 High | 30 | 180.000000 | 182.800000 | 30 |

| 1080p translating square | Measured frames | Median, ms | p95, ms |
| --- | --- | --- | --- |
| Half-float Balanced | 300 | 71.900000 | 75.900000 |
| Half-float High | 300 | 115.400000 | 127.900000 |
| RGBA8 Balanced | 300 | 70.200000 | 81.500000 |
| RGBA8 High | 300 | 117.700000 | 128.800000 |

## Crops and editor workflows

The eight `*-crops.png` comparisons contain the sharp source, the 64-tap reference, and both qualities on both storage paths.
The comparisons cover scene translation, Z rotation, Y rotation, scale, adjustment translation, rotation, scale, and footage pan.
The final crops were inspected for streaks, broken strokes, notches, and isolated speckles.
Small raster edge steps remain at this resolution.

| Editor workflow | Result |
| --- | --- |
| 3D scene moving Text | Pass |
| change every property | Pass |
| scrub play half preview | Pass |
| adjustment above moving Text layer | Pass |
| video footage effect | Pass |
| save and reopen project | Pass |
| normal export | Pass |
| delete effect cleanly | Pass |
| GL error | Pass |

The separate Player+ check verifies moving content at half preview resolution.
The gather test forces zero vertex texture units and compares that result with the explicit gather override.
Both storage paths produce identical bytes in that comparison.

## Repository verification

`pnpm run verify` passes 2,669 tests, all 31 plugin manifests and bundles, syntax, file length, and ESLint no-undef.
`pnpm run docs:build` builds 67 documentation pages, including the English and Japanese feature guides and property references.
The existing sitemap warning reports a missing `site` configuration value.
`pnpm run build:web` produces the deployment tree.
Native FX version 27, the current bundle assets, the injected bootstrap, and local Source Code Pro were inspected there.
The deployment tree was removed after inspection.
No fetched CM3 runtime file, source page, or generated deployment stage is tracked in Git.

## Limits

A single projective transform cannot describe independent extrusion faces or recover content hidden in every supplied image.
Disocclusion, repeated textures, similar colors across separate motions, and motion beyond the search limit can produce tracking errors.
Thin features retain less detail on the Balanced mesh. High increases mesh density and shutter sampling.
Transform-only motion requires an Adjustment layer above the moving content.
The speed-based overlap rule is an occlusion heuristic.
The gather fallback has separate reconstruction limits.
The fit remains more expensive than accepted coherent motion.
The measurements cover Apple M2 with ANGLE Metal. Windows watchdog behavior and other GPU drivers were not tested.
Native FX version 27 remains outside the finished-preview cache allowlist.
