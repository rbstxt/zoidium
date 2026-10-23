# Smart Motion Blur validation

Status: experimental. Round 2 fails acceptance.

The implementation is not fully working. Rotating text, real-content reconstruction, slow-motion accuracy, and performance still fail required gates.
Algorithm measurements cover implementation commit `40d4c0d` on `feat/smart-motion-blur`.
Later identifier cleanup preserves the algorithm and adds a flow-scheduling regression test. The final source passes the GPU smoke check and repository verification.

## Measurement protocol

The GPU run uses Chromium with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.
The renderer reports `ANGLE Metal Renderer: Apple M2`. Only one Chromium instance runs at a time.

The acceptance matrix contains 148 cases at 768 × 512 pixels.
A separate 72-case run records the median endpoint error over the entire foreground.
The square measures 256 × 256 project pixels. Synthetic shutter references average 512 geometric samples.
The rotating-text fixture uses the alpha mask of rendered CM3 3D Text.

Endpoint errors below include the foreground boundary. Earlier interior-only measurements underestimate the error at 2.5 pixels per frame.
The binary square rasterizer changes the sampled width at a half-pixel shift. The reported error still uses the requested 2.5-pixel displacement.
The gate remains 0.25 pixels. Values above that gate are failures.

The machine-local harness, complete JSON records, screenshots, and crops are outside the repository at:

`/Users/dia/Projects/GitHub/zoidium-beta-work/rsmb/round2/`

The records retain full floating-point values. Tables display nine decimal places. Pass and fail results use the unrounded values.

## Algorithm changes

The solver retains source positions for sparse constraints in four quadrants.
A spatially weighted affine fit fills flat regions. A similarity fit or a translation handles constraints with insufficient spatial support.
Four color checks along each propagation path reject observed boundaries. These checks do not guarantee connectivity across thin gaps.

Raw-source matching uses a soft census cost for textured patches and region membership for uniform patches.
The matcher classifies source texels before bilinear interpolation to reduce the slow-motion bias at an edge.
A stationary patch covers the full corner-detection neighborhood.
The matcher searches the configured displacement range before its local refinement.

Reconstruction uses nearby reachable motion tiles and corrects donor positions for nonconstant motion.
A texture test preserves exposed stationary backgrounds without freezing solid foreground edges.
These changes reduce artifacts but do not remove the broken strokes and notches in real Text.

Both quality modes use two warps and four refinement iterations through quarter resolution, followed by full-source constraints.
The removed fine Jacobi stage produced a 47.685855738-pixel interior error on a rotating square in the earlier High half-float trial.
High now raises the shutter-sample cap from 32 to 64. Effect IDs and serialized property names remain unchanged.

The difference, confidence, consistency, and speed statistics share one reduction and one four-byte GPU readback per processed frame.
The earlier moving-frame path used three readbacks. Amount-zero and missing-sample bypasses use none.
The packed score pass validates the stored vector without repeating the displacement search.

## Translation endpoint accuracy

Each cell is the median endpoint error over the entire foreground, in project pixels per frame.
The 1- and 2.5-pixel cases use the 0.25-pixel gate on every background.

### Black background

| Speed | Half Balanced | Half High | RGBA8 Balanced | RGBA8 High | Gate | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.050002107 | 0.050002107 | 0.044173948 | 0.044173948 | ≤0.25 | Pass |
| 2.5 | 0.258369590 | 0.258369590 | 0.258807566 | 0.258807566 | ≤0.25 | Fail |
| 16 | 0.054900211 | 0.054900211 | 0.027764263 | 0.027764263 | ≤1 | Pass |
| 64 | 0.008053186 | 0.008053186 | 0.029297769 | 0.029297769 | ≤1 | Pass |
| 128 | 0.059114093 | 0.059114093 | 0.011719108 | 0.011719108 | ≤2 | Pass |

### Transparent background

| Speed | Half Balanced | Half High | RGBA8 Balanced | RGBA8 High | Gate | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.034925991 | 0.034925991 | 0.042044550 | 0.042044550 | ≤0.25 | Pass |
| 2.5 | 0.251179856 | 0.251179856 | 0.257862454 | 0.257862454 | ≤0.25 | Fail |
| 16 | 0.027901329 | 0.027901329 | 0.028442989 | 0.028442989 | ≤1 | Pass |
| 64 | 0.037519451 | 0.037519451 | 0.015747078 | 0.015747078 | ≤1 | Pass |
| 128 | 0.058595538 | 0.058595538 | 0.021036442 | 0.021036442 | ≤2 | Pass |

### Fixed-noise background

| Speed | Half Balanced | Half High | RGBA8 Balanced | RGBA8 High | Gate | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.164036988 | 0.164036988 | 0.164036988 | 0.164036988 | ≤0.25 | Pass |
| 2.5 | 0.273968095 | 0.273968095 | 0.265824238 | 0.265824238 | ≤0.25 | Fail |
| 16 | 0.049645577 | 0.049645577 | 0.056745391 | 0.056745391 | ≤2 | Pass |
| 64 | 0.115634467 | 0.115634467 | 0.098068541 | 0.098068541 | ≤2 | Pass |
| 128 | 0.003906369 | 0.003906369 | 0.003906369 | 0.003906369 | ≤3 | Pass |

### Stationary background output

Outside the shutter swept area, the maximum change on fixed noise is zero RGBA8 codes in all 20 translation cases.
The gate allows one code. The output-preservation gate passes.
This measurement does not assert that every estimated background vector is exactly zero.

## Rotation and scale

The square rotates 0.25 radians per frame or scales by 1.1 per frame.
The flow gate is a median endpoint error of at most two pixels. The silhouette IoU gate is at least 0.95.

| Fixture | Storage and quality | Foreground error, px | Silhouette IoU | Alpha-mass error, % | Flow and silhouette |
| --- | --- | --- | --- | --- | --- |
| Rotating square | Half-float Balanced | 0.491368602 | 0.953666566 | 1.847817447 | Pass |
| Rotating square | Half-float High | 0.491368602 | 0.953666566 | 1.847817447 | Pass |
| Rotating square | RGBA8 Balanced | 0.497158842 | 0.953436552 | 1.392134521 | Pass |
| Rotating square | RGBA8 High | 0.497158842 | 0.953436552 | 1.392134521 | Pass |
| Scaling square | Half-float Balanced | 0.218742962 | 0.977434299 | 0.807665152 | Pass |
| Scaling square | Half-float High | 0.218742962 | 0.977434299 | 0.807665152 | Pass |
| Scaling square | RGBA8 Balanced | 0.245792799 | 0.997319504 | 0.160748101 | Pass |
| Scaling square | RGBA8 High | 0.245792799 | 0.997319504 | 0.160748101 | Pass |
| Rotating text | Half-float Balanced | 2.172007674 | 0.804765332 | 9.716667004 | Fail |
| Rotating text | Half-float High | 2.172007674 | 0.805180052 | 9.726309413 | Fail |
| Rotating text | RGBA8 Balanced | 6.949858699 | 0.796795697 | 12.164760955 | Fail |
| Rotating text | RGBA8 High | 6.949858699 | 0.796795697 | 12.164760955 | Fail |

The white-composite fringe error is zero codes in these transparent fixtures.
Rotating text loses approximately 9.7% to 12.2% of the reference alpha mass. Its silhouette and mass gates fail.

## Shutter, alpha, and bypasses

The square translates 64 pixels per frame. The trail tolerance is two pixels. The alpha-mass tolerance is 2%.

| Storage and quality | Amount | Expected trail, px | Measured trail, px | Alpha-mass error, % | Fringe, codes | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Half-float Balanced | 0.25 | 16 | 16 | 0.000167547 | 0 | Pass |
| Half-float Balanced | 0.5 | 32 | 30 | 0.000047871 | 0 | Pass |
| Half-float Balanced | 1 | 64 | 62 | 0.001101026 | 0 | Pass |
| Half-float High | 0.25 | 16 | 16 | 0.000167547 | 0 | Pass |
| Half-float High | 0.5 | 32 | 30 | 0.000047871 | 0 | Pass |
| Half-float High | 1 | 64 | 62 | 0.001202752 | 0 | Pass |
| RGBA8 Balanced | 0.25 | 16 | 16 | 0.000418869 | 0 | Pass |
| RGBA8 Balanced | 0.5 | 32 | 30 | 0.002806420 | 0 | Pass |
| RGBA8 Balanced | 1 | 64 | 62 | 0.000837737 | 0 | Pass |
| RGBA8 High | 0.25 | 16 | 16 | 0.000418869 | 0 | Pass |
| RGBA8 High | 0.5 | 32 | 30 | 0.002806420 | 0 | Pass |
| RGBA8 High | 1 | 64 | 62 | 0.006779689 | 0 | Pass |

| Check | Maximum differing bytes | Result |
| --- | --- | --- |
| Static black and static noise | 0 | Pass |
| Blur Amount zero | 0 | Pass |
| Hard cut | 0 | Pass |
| Duplicate-only clip-boundary samples | 0 | Pass |
| Forward, reverse, and shuffled translation frames | 0 | Pass |

The frame-order run contains 28 renders across both qualities and storage paths.
All 148 acceptance cases and 72 endpoint cases report GL error zero. Both runs record zero console and shader errors.

## Real CM3 content

The native frame sampler supplies 64 fractional taps over the centered shutter interval `[-0.25, +0.25]`.
The reference is their average before Smart Motion Blur. The reference code runs only in the external harness.
No reference effect or fractional-tap averaging implementation ships in the plugin.

Each test uses a 768 × 512 output and Blur Amount 0.5.
Motion Sensitivity is 100, Vector Smoothness is 50, Max Displacement is 256, and Analysis Frames is Both.
PSNR uses premultiplied RGB. The motion region is the union of the 64 reference silhouettes, dilated by four pixels.
The full-frame gate is 30 dB. The motion-region gate is 24 dB.
Native-content measurements cover both half-float and forced RGBA8 storage.

| CM3 case | Storage | Balanced full, dB | Balanced region, dB | High full, dB | High region, dB | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 3D Text translation, ≥40 px/frame | Half-float | 28.259871090 | 18.223362269 | 28.259871090 | 18.223362269 | Fail |
| 3D Text translation, ≥40 px/frame | RGBA8 | 27.790141282 | 17.751864154 | 27.790141282 | 17.751864154 | Fail |
| 3D Text Z rotation, 0.25 rad/frame | Half-float | 27.213884821 | 16.747562649 | 27.221499745 | 16.755171891 | Fail |
| 3D Text Z rotation, 0.25 rad/frame | RGBA8 | 25.907619777 | 15.441268989 | 25.907619777 | 15.441268989 | Fail |
| 3D Text Y rotation, 0.25 rad/frame | Half-float | 29.786731194 | 18.984967129 | 29.786731194 | 18.984967129 | Fail |
| 3D Text Y rotation, 0.25 rad/frame | RGBA8 | 29.991896354 | 19.190132289 | 29.991896354 | 19.190132289 | Fail |
| 3D Text scale, ×1.1/frame | Half-float | 33.064191429 | 22.228420314 | 33.064191429 | 22.228420314 | Fail |
| 3D Text scale, ×1.1/frame | RGBA8 | 34.217271659 | 23.381500543 | 34.217271659 | 23.381500543 | Fail |
| 2D Text under Adjustment, 60 px/frame | Half-float | 30.709951104 | 23.667961268 | 30.717572959 | 23.675583123 | Fail |
| 2D Text under Adjustment, 60 px/frame | RGBA8 | 31.340390423 | 24.298446841 | 31.342750230 | 24.300771964 | Pass |
| 2D Text under Adjustment, 0.25 rad/frame | Half-float | 25.416132894 | 17.800590643 | 25.416132894 | 17.800590643 | Fail |
| 2D Text under Adjustment, 0.25 rad/frame | RGBA8 | 30.597732527 | 22.982190276 | 30.597622676 | 22.982087441 | Fail |
| 2D Text under Adjustment, ×1.1/frame | Half-float | 45.008899357 | 36.934924583 | 45.008899357 | 36.934924583 | Pass |
| 2D Text under Adjustment, ×1.1/frame | RGBA8 | 44.707926059 | 36.633951286 | 44.707926059 | 36.633951286 | Pass |
| Generated testsrc footage under Adjustment, 40 px/frame | Half-float | 29.375836595 | 29.009404491 | 29.375836595 | 29.009404491 | Fail |
| Generated testsrc footage under Adjustment, 40 px/frame | RGBA8 | 29.335930827 | 28.969454034 | 29.335930827 | 28.969454034 | Fail |

The cut detector incorrectly bypasses these moving fixtures:

- 2D Text under Adjustment, 0.25 rad/frame in half-float.
- 3D Text Z rotation, 0.25 rad/frame in RGBA8.

The measured 3D Text centroid speed is 40.646319985 pixels per frame.
The generated H.264 footage repeats a testsrc image. An animated layer transform supplies its continuous pan under an Adjustment layer.

Visual inspection confirms broken strokes, streaks, and notches in the translating and rotating Text crops.
The no-hole and no-notch gate fails. The footage crop also contains incorrect edge reconstruction.

Comparison crops contain the current frame, reference, Balanced result, and High result:

- `scene-translation-crops.png`
- `scene-rotation-z-crops.png`
- `scene-rotation-y-crops.png`
- `scene-scaling-crops.png`
- `adjustment-translation-crops.png`
- `adjustment-rotation-crops.png`
- `adjustment-scaling-crops.png`
- `footage-pan-crops.png`

The quality harness records 1 media preparation error during teardown after the final footage measurement:
`[Zoidium] frame sampler preparation failed: Error: Timed out while loading video metadata.`
The saved result file includes that error. Every measured native-content render reports GL error zero.

## Performance

Each whole-effect measurement uses 20 warm-up frames and 300 measured frames at 1920 × 1080 pixels.
The input is a 256 × 256 white square translating 64 pixels per frame over transparency.
Textures are already uploaded. Timings include effect readbacks and a GPU completion wait. They exclude scene capture.

| Storage and quality | Frames | Median, ms | p95, ms | Balanced ≤100 ms gate |
| --- | --- | --- | --- | --- |
| Half-float Balanced | 300 | 135.899999976 | 190.000000000 | Fail |
| Half-float High | 300 | 109.299999952 | 144.299999952 | Not specified |
| RGBA8 Balanced | 300 | 120.399999976 | 206.099999905 | Fail |
| RGBA8 High | 300 | 147.900000095 | 167.500000000 | Not specified |

The Round 1 Balanced medians were 66.2 ms for half-float and 77.0 ms for RGBA8.
The readback count decreased from three to one, but the full effect became slower.
The new cost includes four directional constraint fields and the wider source matching search.
These are whole-pipeline measurements. They do not isolate the timing contribution of the readback change.

The separate 1080p CM3 3D Text capture test captures two neighboring source frames per iteration.
After 5 warm-up iterations, 20 measurements give a 0.600000024 ms median and 1.900000095 ms p95.
That test clears the sampler cache between iterations and excludes optical-flow processing. It reports GL error zero.

## Editor workflow checks

The editor uses a copied resource cache through `ZOIDIUM_RESOURCE_DIR` on port 8157.
The independent UI suite uses the same Metal flags and one Chromium instance.

| UI operation | Result |
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

The UI suite records 0 console errors. Its GL result is 0.
The Adjustment fixture uses explicit 60-pixel-per-frame keyframes and advances to frame 10.
The exported Matroska contains 60 VP8 frames at 640 × 360 pixels and lasts 2.008 seconds.
Passing workflow checks does not satisfy the failed image-quality gates.

## Repository checks

- `pnpm run build:plugin-bundles`: Pass. 31 bundles checked; Native FX includes all 19 supporting Smart Motion Blur assets.
- `pnpm run check:plugin-manifests`: Pass. 31 manifests.
- `pnpm run check:plugin-bundles`: Pass. 31 bundles.
- `pnpm run verify`: Pass. 2,667 tests; zero failures. File length, ESLint, syntax, manifests, and bundles pass.
- `pnpm run build:web`: Pass. Native FX version 24, all 19 supporting assets, matching bundle, bootstrap, and local fonts verified. dist/web removed after inspection.
- `Resource boundary`: Pass. No CM3 runtime files or generated deployment stage are tracked. Only the ignored resource cache remains in the worktree.

## Exploratory results

The truncated color-cost trial gave an 11.144344409-pixel rotating-square interior error in Balanced half-float. It was replaced by the current matching cost.
A quarter-frame analysis-interval experiment before final motion calibration gave 30.155508386 dB full-frame and 20.000398773 dB motion-region PSNR on 3D Text in Balanced.
High gave 29.999410958 dB full-frame and 19.844301345 dB in the motion region. That experiment failed its quality target and was not shipped.

## Remaining limitations

The local affine fit does not resolve incorrect matches on repeated or thin Text features.
RGBA8 constraint validation changes some constraint priorities and produces a larger rotating-text error than half-float.
Four sampled path checks do not provide a strict geodesic boundary guarantee.

The 2.5-pixel whole-foreground accuracy gate remains unmet. The binary input rasterization and the inferred small scale change contribute to this error.
No gate was relaxed to classify the interior-only result as a pass.

The current-frame reconstruction still loses coverage at disocclusions and thin strokes.
It fails the native Text PSNR and artifact gates. The broader matching and interpolation also exceed the Balanced performance limit.

Round 2 is not accepted. The experimental label remains.
