# Smart Motion Blur round 4 validation

Round 4 passes every requested gate.
The source and generated Native FX bundle are version 26.
The main implementation commits are `d3a1827`, `c4784d0`, and `871b035`.
Formatting is `c96cabd`. The opaque-input guard is `eb5573e`.
All repository changes belong to `feat/smart-motion-blur` in `/Users/dia/.t3/worktrees/Zoidium/t3-b60c3199`.
No changes were pushed or merged. The original checkout was not modified.

## Gate summary

| Gate | Result | Measurement |
| --- | --- | --- |
| 1 px/frame translation | Pass | 0.091085236 px worst foreground median |
| 2.5 px/frame translation | Pass | 0.033092736 px worst foreground median |
| 16 px/frame translation | Pass | 0.056745391 px worst foreground median |
| 64 px/frame translation | Pass | 0.115634467 px worst foreground median |
| 128 px/frame translation | Pass | 0.058595538 px worst foreground median |
| Stationary background | Pass | 0 codes worst change |
| Square rotation, scale, and text-mask rotation | Pass | Error ≤0.529678271 px; IoU ≥0.952912124; alpha error ≤0.718452278% |
| Shutter trail and fringe | Pass | Trail error ≤2 px; fringe 0 codes |
| Static, amount zero, cut, duplicate boundary | Pass | 0 changed bytes in each case |
| Frame-order determinism | Pass | 0 differing bytes across 28 reordered renders |
| Native CM3 PSNR | Pass | 32/32 modes; full ≥35.498879260 dB; region ≥24.697115194 dB |
| Native rotating-text coverage | Pass | IoU ≥0.970364003; alpha error ≤0.756008814% |
| Crops without streaks, notches, or speckles | Pass | All eight final comparison crops inspected; Y-rotation streak bands are absent |
| False cuts | Pass | 0 across all 32 native modes, including 8 Z-rotation regressions |
| 1080p Balanced median | Pass | Half-float 86.700000048 ms; RGBA8 83.399999976 ms |
| Gather fallback equivalence | Pass | 0 differing bytes on both storage paths |
| Real editor workflows and moving half preview | Pass | 0 console errors; GL error zero |
| Repository checks and resource boundary | Pass | 2,668 tests; 31 manifests and bundles; inspected deployment stage removed |

## Test environment

GPU: Apple M2 through ANGLE Metal. The host has 8 GB RAM.
Each harness uses `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.
One harness Chromium runs at a time. Other host applications remain open.
The editor uses port 8157. The isolated GPU harness uses port 8158.
`ZOIDIUM_RESOURCE_DIR` points to the copied CM3 cache in `rsmb/round3/resource-cache`.
All captures, projects, harnesses, logs, flow fields, and crops remain outside Git in:

`/Users/dia/Projects/GitHub/zoidium-beta-work/rsmb/round4/`

## Changes

The seed and refinement passes retain a two-texel halo around transparent silhouettes.
Skipping every transparent texel removed tangential support at square corners. The measured rotating-square field regressed, not its sign convention.
The same next-direction field and project-pixel coordinates measure both rounds.
The round-3 summary incorrectly marked its 17.827628280-pixel detailed failure as a pass.

Below four pixels per frame, opposite local fields supply a symmetric velocity estimate.
This estimate cancels the opposing edge-coverage biases of the neighboring observations.
The fixed-noise 2.5-pixel worst median falls from 0.269662417 to 0.033092736 pixels.

A rejected affine proposal can trigger a projective fit when its horizontal and vertical scale differ by more than 0.03.
Its vertical scale must also remain within 0.2 of one. Accepted coherent registrations bypass this fit.
Eight homography coefficients use 24-bit fixed-point storage on both storage paths.
A coordinate search runs four iterations at each of eight radii. Each iteration visits eight coefficients.
The coarse image guides supply the fitting residual. A separate raw-source check retains the existing acceptance thresholds.

Each shutter batch now uses an incremental mean through two distinct render targets.
Repeated equal samples reproduce the original RGBA8 code exactly. Four final batch weights still reflect their actual sample counts.
For an opaque input, an unchanged textured patch can identify a stationary sheet through either neighboring observation.
The patch check supplements the existing silhouette guard. It does not replace that guard.
A conservative swept-mask prototype was rejected after it retained background rounding errors. The final renderer has no coverage-mask pass.

Balanced retains a four-pixel mesh. High retains a two-pixel mesh.
The triangle tear threshold remains 16 processing pixels. Speed-based depth ordering and the gather fallback remain active.
There is no reconstruction division by alpha. Source and generated bundle assets remain consistent.
The registration decision adds one eight-byte readback. The ordinary statistics readback remains four bytes.
Both-direction analysis therefore reports two readbacks. Amount-zero and duplicate-only bypasses require none.

## Translation endpoint error

Distances are project pixels. The median includes the whole square foreground. Interior-only measurements do not determine a pass.
The 1 and 2.5-pixel fixtures use exact box-filtered square coverage over fixed backgrounds.

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
| 1 | 0.087321776 | 0.087321776 | 0.091085236 | 0.091085236 | ≤0.25 | Pass |
| 2.5 | 0.033092736 | 0.033092736 | 0.033092736 | 0.033092736 | ≤0.25 | Pass |
| 16 | 0.049645577 | 0.049645577 | 0.056745391 | 0.056745391 | ≤2 | Pass |
| 64 | 0.115634467 | 0.115634467 | 0.098068541 | 0.098068541 | ≤2 | Pass |
| 128 | 0.003906369 | 0.003906369 | 0.003906369 | 0.003906369 | ≤3 | Pass |

## Stationary background outside the shutter sweep

The gate is at most one RGBA8 code. Every pixel outside the true shutter sweep plus a four-pixel margin is included.

| Background | Speed | Half Balanced | Half High | RGBA8 Balanced | RGBA8 High | Result |
| --- | --- | --- | --- | --- | --- | --- |
| black | 1 | 0 | 0 | 0 | 0 | Pass |
| black | 2.5 | 0 | 0 | 0 | 0 | Pass |
| black | 16 | 0 | 0 | 0 | 0 | Pass |
| black | 64 | 0 | 0 | 0 | 0 | Pass |
| black | 128 | 0 | 0 | 0 | 0 | Pass |
| transparent | 1 | 0 | 0 | 0 | 0 | Pass |
| transparent | 2.5 | 0 | 0 | 0 | 0 | Pass |
| transparent | 16 | 0 | 0 | 0 | 0 | Pass |
| transparent | 64 | 0 | 0 | 0 | 0 | Pass |
| transparent | 128 | 0 | 0 | 0 | 0 | Pass |
| noise | 1 | 0 | 0 | 0 | 0 | Pass |
| noise | 2.5 | 0 | 0 | 0 | 0 | Pass |
| noise | 16 | 0 | 0 | 0 | 0 | Pass |
| noise | 64 | 0 | 0 | 0 | 0 | Pass |
| noise | 128 | 0 | 0 | 0 | 0 | Pass |

## Rotation, scale, and shutter coverage

The gates are median endpoint error at most 2 pixels, silhouette IoU at least 0.95, and alpha-mass error at most 2%.

| Fixture | Mode | Median error, px | Silhouette IoU | Alpha-mass error, % | Result |
| --- | --- | --- | --- | --- | --- |
| Rotating square | Half-float Balanced | 0.513091488 | 0.953035767 | 0.409207686 | Pass |
| Scaling square | Half-float Balanced | 0.024156573 | 1.000000000 | 0.084716939 | Pass |
| Rotating text mask | Half-float Balanced | 0.074068194 | 0.967715479 | 0.674281964 | Pass |
| Rotating square | Half-float High | 0.513091488 | 0.954837263 | 0.017797403 | Pass |
| Scaling square | Half-float High | 0.024156573 | 1.000000000 | 0.084621234 | Pass |
| Rotating text mask | Half-float High | 0.074068194 | 0.967672173 | 0.718452278 | Pass |
| Rotating square | RGBA8 Balanced | 0.529678271 | 0.952912124 | 0.406209772 | Pass |
| Scaling square | RGBA8 Balanced | 0.019986624 | 1.000000000 | 0.090865977 | Pass |
| Rotating text mask | RGBA8 Balanced | 0.077505510 | 0.967753961 | 0.666949114 | Pass |
| Rotating square | RGBA8 High | 0.529678271 | 0.954808595 | 0.015571407 | Pass |
| Scaling square | RGBA8 High | 0.019986624 | 1.000000000 | 0.090818125 | Pass |
| Rotating text mask | RGBA8 High | 0.077505510 | 0.967710664 | 0.714429796 | Pass |

Square rotation is 0.25 radians per frame. Scale is 1.1 per frame. The text fixture uses the existing CM3 text mask.

| Mode | Amount | Expected trail, px | Measured trail, px | Alpha-mass error, % | Fringe, codes | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Half-float Balanced | 0.25 | 16 | 16 | 0.000000000 | 0 | Pass |
| Half-float Balanced | 0.5 | 32 | 30 | 0.000000000 | 0 | Pass |
| Half-float Balanced | 1 | 64 | 62 | 0.001651540 | 0 | Pass |
| Half-float High | 0.25 | 16 | 16 | 0.000000000 | 0 | Pass |
| Half-float High | 0.5 | 32 | 30 | 0.000000000 | 0 | Pass |
| Half-float High | 1 | 64 | 62 | 0.004679362 | 0 | Pass |
| RGBA8 Balanced | 0.25 | 16 | 16 | 0.000000000 | 0 | Pass |
| RGBA8 Balanced | 0.5 | 32 | 30 | 0.000000000 | 0 | Pass |
| RGBA8 Balanced | 1 | 64 | 62 | 0.002991919 | 0 | Pass |
| RGBA8 High | 0.25 | 16 | 16 | 0.000000000 | 0 | Pass |
| RGBA8 High | 0.5 | 32 | 30 | 0.000000000 | 0 | Pass |
| RGBA8 High | 1 | 64 | 62 | 0.002860275 | 0 | Pass |

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

Each case renders at 768 by 512 with Blur Amount 0.5, Motion Sensitivity 100, Vector Smoothness 50, Max Displacement 256, and Analysis Frames Both.
The reference averages 64 native fractional taps over the centered interval `[-0.25, +0.25]`.
The reference renderer remains in the external harness. It does not ship in the plugin.
PSNR uses premultiplied RGB. The motion region is the union of reference silhouettes, dilated by four pixels.
The full-frame gate is 30 dB. The motion-region gate is 24 dB.

| CM3 case | Storage | Balanced full, dB | Balanced region, dB | High full, dB | High region, dB | Result |
| --- | --- | --- | --- | --- | --- | --- |
| scene-translation | Half-float | 45.314855890 | 35.268375012 | 45.314855890 | 35.268375012 | Pass |
| scene-translation | RGBA8 | 45.301967718 | 35.255486840 | 45.316109625 | 35.269628747 | Pass |
| scene-rotation-z | Half-float | 39.919941452 | 29.453590664 | 39.916985504 | 29.450634716 | Pass |
| scene-rotation-z | RGBA8 | 39.929620053 | 29.463269265 | 39.918605726 | 29.452254938 | Pass |
| scene-rotation-y | Half-float | 35.502838411 | 24.701074346 | 35.498879260 | 24.697115194 | Pass |
| scene-rotation-y | RGBA8 | 35.509490370 | 24.707726305 | 35.506052637 | 24.704288572 | Pass |
| scene-scaling | Half-float | 40.174842171 | 29.339071055 | 40.207791435 | 29.372020320 | Pass |
| scene-scaling | RGBA8 | 40.165461674 | 29.329690558 | 40.205059225 | 29.369288110 | Pass |
| adjustment-translation | Half-float | 55.197380316 | 48.155390480 | 47.209815915 | 40.167826079 | Pass |
| adjustment-translation | RGBA8 | 55.202686584 | 48.160696748 | 47.250070831 | 40.208080995 | Pass |
| adjustment-rotation | Half-float | 38.141757461 | 30.526215210 | 38.166211269 | 30.550669018 | Pass |
| adjustment-rotation | RGBA8 | 38.159326854 | 30.543784603 | 38.180808235 | 30.565265984 | Pass |
| adjustment-scaling | Half-float | 51.054622531 | 42.980647758 | 51.226467208 | 43.152492435 | Pass |
| adjustment-scaling | RGBA8 | 50.784044839 | 42.710070066 | 51.141944828 | 43.067970054 | Pass |
| footage-pan | Half-float | 48.221066958 | 47.854596061 | 48.221214496 | 47.854743600 | Pass |
| footage-pan | RGBA8 | 48.137874521 | 47.771403482 | 48.137838913 | 47.771367874 | Pass |

### Native rotating-text coverage

| CM3 case | Mode | Silhouette IoU | Alpha-mass error, % | Result |
| --- | --- | --- | --- | --- |
| scene-rotation-z | Half-float Balanced | 0.970436538 | 0.703578651 | Pass |
| scene-rotation-z | Half-float High | 0.970502467 | 0.752093336 | Pass |
| scene-rotation-z | RGBA8 Balanced | 0.970364003 | 0.697961566 | Pass |
| scene-rotation-z | RGBA8 High | 0.970467290 | 0.747149532 | Pass |
| scene-rotation-y | Half-float Balanced | 0.974173390 | 0.711245322 | Pass |
| scene-rotation-y | Half-float High | 0.974134863 | 0.712136125 | Pass |
| scene-rotation-y | RGBA8 Balanced | 0.973673808 | 0.695299946 | Pass |
| scene-rotation-y | RGBA8 High | 0.973634279 | 0.694320063 | Pass |
| adjustment-rotation | Half-float Balanced | 0.972045184 | 0.756008814 | Pass |
| adjustment-rotation | Half-float High | 0.971915240 | 0.733741373 | Pass |
| adjustment-rotation | RGBA8 Balanced | 0.972016233 | 0.722794813 | Pass |
| adjustment-rotation | RGBA8 High | 0.971838331 | 0.701257752 | Pass |

### False-cut regressions

| CM3 case | Mode | Scene cut | Changed bytes from sharp source | Result |
| --- | --- | --- | --- | --- |
| scene-rotation-z | Half-float Balanced | False | 49256 | Pass |
| scene-rotation-z | Half-float High | False | 49224 | Pass |
| scene-rotation-z | RGBA8 Balanced | False | 49324 | Pass |
| scene-rotation-z | RGBA8 High | False | 49304 | Pass |
| adjustment-rotation | Half-float Balanced | False | 135278 | Pass |
| adjustment-rotation | Half-float High | False | 135312 | Pass |
| adjustment-rotation | RGBA8 Balanced | False | 134952 | Pass |
| adjustment-rotation | RGBA8 High | False | 134995 | Pass |

All native-content renders report GL error zero. Console and preparation errors: 0.

## Geometric ground-truth experiment

The harness renders the same native Text mesh with the same scene camera. Its ordinary sharp render has zero red-channel error and silhouette IoU 1 against the captured source.
A vertex shader projects each visible source point through the neighboring object transform. Perspective interpolation supplies the per-pixel geometric correspondence.
The shader renders fields at both full resolution and the solver's half resolution.
Endpoint fields use frames 9 and 11. Fractional fields use frames 9.75 and 10.25, multiplied by four.
The diagnostic retains the local-flow background base, without coherent registration, to match the original failing Y-rotation path.
All fields originate at frame 10. The Y-angle sequence is 0.25, 0.5, and 0.75 radians at integer frames.
Only the external diagnostic uses mesh geometry. The plugin estimates its homography from images.

The harness clears uncovered packed texels to the encoded zero-motion value. Transparent WebGL clearing premultiplies RGB to zero, so the capture explicitly repairs those empty texels.
These diagnostics use the rounded 64-tap reference mask, dilated by four pixels. The native acceptance table uses the unrounded tap union.

| Flow width | Geometric interval | Mode | Full PSNR, dB | Region PSNR, dB | IoU | Alpha-mass error, % |
| --- | --- | --- | --- | --- | --- | --- |
| 384 | ±1 frame | Half-float Balanced | 31.946461648 | 21.144697583 | 0.954652792 | 2.417088943 |
| 384 | ±1 frame | Half-float High | 33.796034989 | 22.994270924 | 0.975013056 | 1.621173437 |
| 384 | ±1 frame | RGBA8 Balanced | 31.950293899 | 21.148529834 | 0.954436355 | 2.410318984 |
| 384 | ±1 frame | RGBA8 High | 33.811791353 | 23.010027288 | 0.974080167 | 1.611446076 |
| 384 | ±0.25 frame | Half-float Balanced | 32.864866899 | 22.063102834 | 0.958778565 | 2.722039938 |
| 384 | ±0.25 frame | Half-float High | 35.787591428 | 24.985827363 | 0.978965116 | 1.338367332 |
| 384 | ±0.25 frame | RGBA8 Balanced | 32.870044474 | 22.068280409 | 0.958435012 | 2.711831553 |
| 384 | ±0.25 frame | RGBA8 High | 35.804771020 | 25.003006955 | 0.978103068 | 1.317540802 |
| 768 | ±1 frame | Half-float Balanced | 31.703889280 | 20.902125214 | 0.953314098 | 2.619653225 |
| 768 | ±1 frame | Half-float High | 33.906925262 | 23.105161196 | 0.969695753 | 1.545029220 |
| 768 | ±1 frame | RGBA8 Balanced | 31.707220838 | 20.905456773 | 0.953130633 | 2.611315487 |
| 768 | ±1 frame | RGBA8 High | 33.909628005 | 23.107863939 | 0.969306692 | 1.537582266 |
| 768 | ±0.25 frame | Half-float Balanced | 32.824335801 | 22.022571735 | 0.959692283 | 2.826956478 |
| 768 | ±0.25 frame | Half-float High | 35.789453400 | 24.987689334 | 0.976164680 | 1.283405959 |
| 768 | ±0.25 frame | RGBA8 Balanced | 32.829921468 | 22.028157403 | 0.959464872 | 2.815714784 |
| 768 | ±0.25 frame | RGBA8 High | 35.794758373 | 24.992994307 | 0.975774106 | 1.271255665 |

### Per-pixel field audit

| Field | Storage | Direction | Pixels | Median error, px | p95 error, px | Left-T median, px |
| --- | --- | --- | --- | --- | --- | --- |
| round3 | Half-float | previous | 5382 | 2.940969412 | 11.438054512 | 4.496351413 |
| round3 | Half-float | next | 5382 | 4.365502517 | 67.382507849 | 26.525500471 |
| round3 | RGBA8 | previous | 5382 | 2.538767258 | 10.820304257 | 4.479576851 |
| round3 | RGBA8 | next | 5382 | 3.571292870 | 66.450015696 | 31.673731971 |
| round4 | Half-float | previous | 5382 | 2.911128446 | 3.878684331 | 2.529625646 |
| round4 | Half-float | next | 5382 | 2.769353889 | 5.731856425 | 4.937529698 |
| round4 | RGBA8 | previous | 5382 | 2.910771976 | 3.877669161 | 2.528618747 |
| round4 | RGBA8 | next | 5382 | 2.766272113 | 5.727989512 | 4.935047800 |

This audit compares the measured half-resolution fields with geometric endpoint correspondences on the current visible foreground.
The left-T region is the first quarter of the foreground bounding box. Clear geometric texels are excluded.
The estimates and error images are saved as `field-*.rgba` and `flow-error-*.rgba`.

### Reconstruction controls with fractional geometric flow

| Control | Mode | Region PSNR, dB | IoU | Alpha-mass error, % |
| --- | --- | --- | --- | --- |
| base | Half-float Balanced | 22.063102834 | 0.958778565 | 2.722039938 |
| base | Half-float High | 24.985827363 | 0.978965116 | 1.338367332 |
| base | RGBA8 Balanced | 22.068280409 | 0.958435012 | 2.711831553 |
| base | RGBA8 High | 25.003006955 | 0.978103068 | 1.317540802 |
| pixel | Half-float Balanced | 25.446078151 | 0.981972556 | 1.360797273 |
| pixel | Half-float High | 25.446078151 | 0.981972556 | 1.360797273 |
| pixel | RGBA8 Balanced | 25.452040024 | 0.982013520 | 1.348433191 |
| pixel | RGBA8 High | 25.452040024 | 0.982013520 | 1.348433191 |
| nodepth | Half-float Balanced | 22.057933392 | 0.958778565 | 2.718031410 |
| nodepth | Half-float High | 24.997250703 | 0.978886525 | 1.332042765 |
| nodepth | RGBA8 Balanced | 22.063313747 | 0.958396672 | 2.707823025 |
| nodepth | RGBA8 High | 25.014216368 | 0.978103068 | 1.311251867 |
| relative | Half-float Balanced | 22.063102834 | 0.958778565 | 2.722039938 |
| relative | Half-float High | 24.985827363 | 0.978965116 | 1.338367332 |
| relative | RGBA8 Balanced | 22.068280409 | 0.958435012 | 2.711831553 |
| relative | RGBA8 High | 25.003006955 | 0.978103068 | 1.317540802 |

`base` uses the ordinary mesh. `pixel` uses one-pixel mesh spacing. `nodepth` removes speed-based depth differences.
`relative` replaces the tear limit with the larger of 16 pixels and half the largest vertex speed.
The one-pixel mesh improves the geometric-flow result. Removing depth ordering changes it only slightly. The tested relative threshold leaves it unchanged.
The original 18.7–19.7 dB failure therefore includes a substantial flow-estimation error. Mesh resolution and one-frame motion curvature also contribute.
The projective image fit removes the left-T flow discontinuities without reducing the production mesh spacing.
An independent CPU coordinate-search prototype reaches 24.44 dB with a four-pixel mesh. The GPU implementation and final measurements appear above.
Raw geometric fields are `ground-truth-<width>-<frame>.rgba`. Diagnostic renders are `gt-*.rgba`; control renders are `gt-trial-*.rgba`.
Ground-truth console and shader errors: 0.

## Performance

The benchmark uses 20 warm-up frames and 300 measured frames per mode at 1920 by 1080.
Whole-effect timing includes the readbacks and a GPU completion wait. Scene capture is excluded.
The input is a 256 by 256 square translating 64 pixels per frame over transparency.
The gate is a Balanced median of at most 100 ms on each storage path.

| Mode | Frames | Median, ms | p95, ms | Balanced gate |
| --- | --- | --- | --- | --- |
| Half-float Balanced | 300 | 86.700000048 | 99.799999952 | Pass |
| Half-float High | 300 | 131.099999905 | 148.000000000 | Not specified |
| RGBA8 Balanced | 300 | 83.399999976 | 88.899999976 | Pass |
| RGBA8 High | 300 | 129.699999928 | 136.000000000 | Not specified |

Performance console and shader errors: 0.
The projective search is absent from this accepted-translation benchmark. Its separate 768 by 512 Y-rotation timings are:

| Mode | Whole effect, ms |
| --- | --- |
| Half-float Balanced | 2265.399999976 |
| Half-float High | 2235.100000024 |
| RGBA8 Balanced | 2261.699999928 |
| RGBA8 High | 2238.199999928 |

These Y-rotation measurements include the projective search and are single-case timings, not warmed 300-frame medians.
The projective search is expensive. The benchmark pass does not establish a 100 ms bound for perspective motion.

## Gather fallback

| Storage | Zero vertex units path | Forced-gather path | Differing bytes | GL error |
| --- | --- | --- | --- | --- |
| Half-float | gather | gather | 0 | 0 |
| RGBA8 | gather | gather | 0 | 0 |

The harness forces `MAX_VERTEX_TEXTURE_IMAGE_UNITS` to zero and compares the output with the explicit gather switch.
Both paths use the 64-pixel translation fixture. Console and shader errors: 0.

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
The initial harness used a 10-second click timeout and timed out during later workflows.
The final serial suite uses a 30-second timeout and explicitly pauses playback before a new project. All eight workflows complete.
The initial log remains in `final-ui-full.log`; the final log is `verified-ui-full.log`.

The separate moving Player+ half-preview check records 28 shutter samples, a 274 by 154 flow field, `static = false`, splat reconstruction, and GL error zero.
Player+ console errors: 0.
The normal export frame count, dimensions, codec, and duration appear in `export-probe.json`.

## Crops

Each final comparison contains the sharp source, the 64-tap reference, and both qualities on both storage paths.
All paths are relative to `/Users/dia/Projects/GitHub/zoidium-beta-work/rsmb/round4/`.

- `scene-translation-crops.png`
- `scene-rotation-z-crops.png`
- `scene-rotation-y-crops.png`
- `scene-scaling-crops.png`
- `adjustment-translation-crops.png`
- `adjustment-rotation-crops.png`
- `adjustment-scaling-crops.png`
- `footage-pan-crops.png`

The final crops contain no vertical streak bands, broken strokes, notches, or isolated speckles. Small raster edge steps remain visible at this resolution.

## Repository checks

- `pnpm run build:plugin-bundles`: Pass. 31 bundles, including 36 Smart Motion Blur supporting assets.
- `pnpm run check:plugin-manifests`: Pass. 31 manifests.
- `pnpm run check:plugin-bundles`: Pass. 31 bundles.
- `pnpm run verify`: Pass. 2,668 tests, zero failures. File length, ESLint, syntax, manifests, and bundles pass.
- `pnpm run build:web`: Pass. Native FX version 26, current bundle, bootstrap, and local Source Code Pro inspected. The generated deployment tree is removed.
- Resource boundary: no CM3 runtime files or generated deployment stage are tracked. The copied CM3 cache stays outside Git.

## Remaining limits

A single homography cannot describe independent extrusion faces or reveal content hidden in all supplied images.
The tested perspective text meets the image-quality gates, but its native endpoint-flow median remains about 2.8 to 2.9 pixels.
The projective search takes seconds on this GPU.
Disocclusion, repeated textures, multiple similarly colored motions, and motion beyond the search limit remain difficult.
The speed-based depth rule remains a heuristic. A four-pixel mesh retains less boundary detail than a one-pixel mesh.
The gather fallback retains its separate reconstruction limits.
Native FX version 26 remains outside the finished-preview cache allowlist. Version 17 is the last approved version.
No gate was relaxed. Verdicts use unrounded measurements; displayed values use nine decimal places.
