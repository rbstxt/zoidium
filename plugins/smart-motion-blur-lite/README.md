# ZSMB reference

ZSMB (beta 1.0) adds optical-flow motion blur as a native effect in the Zoidium
external extension layer around CM3. Its stable effect ID is
`smart-motion-blur-lite`.

The effect tracks one adjacent frame through the shared frame sampler and
reconstructs trails from the current image and the estimated motion field.
Exports use native media decoding. Preview can use a bounded decoder that is
enabled only after a per-source pixel comparison with the native path.

## Properties

| Property | Default | Range or options | Meaning |
| --- | --- | --- | --- |
| Quality | 1/2 | Full, 1/2, 1/4, 1/8 | Motion analysis detail. Full analyses every pixel. The reduced levels analyse one eighth, one sixteenth, and one thirty-second of the frame width. |
| Enabled | on | off, on | Off passes the current image through without changing source timing. |
| Track Frame | Previous | Previous, Next | Adjacent frame used for tracking. At frame 0 only, Previous uses the next frame. |
| Blur Amount | 0.5 | 0 to 10 | Trail length. 0 adds no blur. 0.5 approximates a 180-degree shutter. |
| Motion Sensitivity | 70 | 0 to 100 | Motion estimation threshold. 0 bypasses the blur. |

The effect analyses the smaller of the project frame and the rendered frame.
The Quality level then divides that input, so a reduced preview caps the
analysis size without changing the level. In the preview, Player+ sets the
rendered frame. **Full** at 1/8 preview quality analyses the whole 1/8 frame.
**1/2** at Full preview quality analyses one eighth of the frame.
The blur length stays proportional to the frame, so the look matches the
full-size frame at a lower resolution.

Exports use the same Quality level as the preview. A 1/2 export analyses the
same fraction of its output frame, which is what makes it much faster than a
Full export.

Projects store the Quality value with the effect. `qualityPresetVersion` is 2
for projects saved by this build. Projects saved before it store 0 (Full) or 1
(1/2) and keep that meaning. The older migration, which mapped Quarter and
Eighth values to 1/2, now applies only to projects below version 2.

## Modules

| File | Role |
| --- | --- |
| `effect.js` | Property definitions, frame-sampler request, lifecycle, reconstruction draw. |
| `estimator.js` | Motion estimation and the reduced-level interpolation. |
| `fast-filter.js`, `fast-score.js` | Acceleration helpers used by the estimator. |
| `async-analysis.js` | Worker analysis for the reduced Quality levels. |
| `video-decoder.js` | Preview sample decoding with bounded caching and a native parity check. |
| `shaders/reconstruct.glsl` | Reconstruction pass from the current image and the motion field. |
| `analysis-mode.js` | Chooses the analysis size from the Quality level, the project frame, and the rendered frame. |
| `native-particles.js`, `tooltips.js` | Host integration for particle sizing and hover text. |

The preview decoder embeds Mediabunny 1.62.0 from `plugins/mp4-export/vendor/`
in this plugin's bundle, so ZSMB works when the MP4 Export plugin is disabled.

Contributed by Zoidium contributors.
