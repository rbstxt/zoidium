# Smart Motion Blur validation

Status: experimental, with failed acceptance gates.
The implementation is not ready for acceptance.

The GPU harness uses Chromium with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`.
The reported renderer is `ANGLE Metal Renderer: Apple M2`.
Only one Chromium instance runs at a time.
The accuracy matrix contains 128 cases at 768 × 512 pixels.
The translating square measures 256 × 256 project pixels.

The machine-local harness and complete JSON results are outside the repository at
`/Users/dia/Projects/GitHub/zoidium-beta-work/rsmb/`.
They contain no resources that the plugin fetches at runtime.

## Translation accuracy

The following errors are the largest median endpoint errors across both backgrounds, qualities, and storage paths.
Interior excludes the outer 16 project pixels of the square.
Boundary covers that outer band.

| Speed, project pixels per frame | Interior error, pixels | Boundary error, pixels | Gate | Result |
| --- | --- | --- | --- | --- |
| 1 | 1.000000 | 1.000000 | ≤1 | Pass |
| 16 | 0.138581 | 0.138581 | ≤1 | Pass |
| 64 | 0.118245 | 0.128035 | ≤1 | Pass |
| 128 | 0.119576 | 0.119576 | ≤2 | Pass |

## Fixed-noise background

Each cell gives the foreground median interior error and boundary error in project pixels.

| Speed | Half-float Balanced | Half-float High | RGBA8 Balanced | RGBA8 High | Gate | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.055309, 1.000000 | 1.000000, 1.000000 | 1.000000, 1.000000 | 1.000000, 1.000000 | ≤2 | Pass |
| 16 | 10.727443, 7.633143 | 9.392794, 8.543316 | 9.258736, 6.120508 | 12.960924, 8.991356 | ≤2 | Fail |
| 64 | 9.781980, 8.570625 | 14.833439, 14.833439 | 13.969226, 13.969226 | 14.751873, 9.812870 | ≤2 | Fail |
| 128 | 14.134003, 14.134003 | 15.609962, 15.500474 | 14.229707, 14.229707 | 14.018214, 14.018214 | ≤3 | Fail |

Outside the union of the three square positions, the largest background change is 26 RGBA8 codes.
The allowed change is one code, so this gate fails.
Outside the shutter's swept area, the largest change is 85 codes.

## Rotation

The square rotates 0.25 radians per frame.
The maximum corner displacement is approximately 45.14 project pixels per frame.
The reference integrates 512 shutter samples.

| Storage and quality | Interior error, pixels | Boundary error, pixels | Silhouette IoU | Result |
| --- | --- | --- | --- | --- |
| Half-float Balanced | 28.877448 | 21.717173 | 0.9853435506 | Flow fails, IoU passes |
| Half-float High | 47.702269 | 51.057180 | 0.9610819608 | Flow fails, IoU passes |
| RGBA8 Balanced | 28.874757 | 21.723260 | 0.9595910078 | Flow fails, IoU passes |
| RGBA8 High | 35.827348 | 29.186732 | 0.9484404927 | Both fail |

The flow gate is a median error of at most two pixels.
The IoU gate is at least 0.95.
Rotating text has no separate GPU accuracy measurement.

## Reconstruction and determinism

At 64 project pixels per frame, Blur Amount values of 0.25, 0.5, and 1 produce trail extensions of 16, 32, and 62 pixels.
The expected extensions are 16, 32, and 64 pixels.
The largest difference is two pixels, which passes the gate.

Across those amounts, qualities, and storage paths, the largest alpha-mass error against the 512-sample reference is 0.035162%.
The limit is 2%.
The white-composite fringe error is zero RGBA8 codes.
Both gates pass.

Static black and noise images, Blur Amount zero, hard cuts, and duplicate-only boundary taps each change zero bytes.
Repeated frames in forward, reverse, and shuffled order change zero bytes.
These gates pass in both storage paths and qualities.
The 128-case run records zero shader, console, or GL errors.

## Performance

Each entry contains 300 measured frames after 20 warm-up frames at 1920 × 1080 pixels.
The source is a translating 256 × 256 white square over transparency at 64 pixels per frame.
The effect receives pre-uploaded textures.
These measurements include effect readbacks and exclude scene capture.
Real CM3 scene-capture timing is not measured separately.

| Storage | Quality | Median, ms | p95, ms | Balanced ≤100 ms gate |
| --- | --- | --- | --- | --- |
| Half-float | Balanced | 66.2 | 73.8 | Pass |
| RGBA8 | Balanced | 77.0 | 86.7 | Pass |
| Half-float | High | 127.4 | 137.0 | No High target specified |
| RGBA8 | High | 162.7 | 289.9 | No High target specified |

The original half-float Balanced baseline measured 175.4 ms median and 241.0 ms p95.
Pass profiling identified patch search, Jacobi refinement, and constraint propagation as the main costs.
Balanced now stops refinement at quarter resolution and retains half-resolution constraints and reconstruction guidance.
Half-float propagation stores confidence and distance in spare flow channels.
Fine patch searches use 3 × 3 patches, while the coarse seed uses 5 × 5 patches.
The translation and reconstruction gates remain passing after these changes.

## Editor verification

The editor runs from a copied resource cache on port 8147.
The successful isolated UI run covers the following operations:

- Add the effect through the Effects picker on a 3D Scene with animated Text.
- Change every control and show Motion Vectors and Confidence.
- Scrub, play, and select Player+ half-quality preview.
- Add the effect to an Adjustment layer above Text animated from −300 to +300 project pixels.
- Add the effect to locally generated video footage.
- Save and reopen the project through the browser download fallback.
- Export through Device render and delete the effect through its property toolbar.

The final run records zero console errors and GL error zero.
The exported Matroska file contains 15 VP8 frames at 640 × 360 pixels and lasts 0.508 seconds.
A prior script edited the project during an asynchronous New operation and triggered the editor's revision guard.
The isolated run awaits that operation before further edits.

The editor proof does not measure pixels on unaffected layers against a separate oracle.
GL state restoration has a unit test, including the exception path.

## Repository checks

`pnpm run build:plugin-bundles`, `pnpm run check:plugin-manifests`, and `pnpm run check:plugin-bundles` pass.
`pnpm run verify` passes all 2,666 tests, including nine Smart Motion Blur tests.
An earlier concurrent run failed an existing Shape+ timing assertion.
The successful run has no Chromium process competing with the tests.

`pnpm run build:web` passes.
The inspected stage contains Native FX version 24, the `smartmotionblur` entry, and all 17 supporting bundle assets.
Its Native FX bundle matches the checked-in bundle byte for byte.
The stage includes the Source Code Pro font and the Zoidium bootstrap.
The generated `dist/web/` tree is removed after inspection.
No CM3 runtime files are tracked or added to repository source directories.
