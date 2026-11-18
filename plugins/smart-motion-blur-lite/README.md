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
| Enabled | on | off, on | Off passes the current image through without changing source timing. |
| Track Frame | Previous | Previous, Next | Adjacent frame used for tracking. At frame 0 only, Previous uses the next frame. |
| Blur Amount | 0.5 | 0 to 10 | Trail length. 0 adds no blur. 0.5 approximates a 180-degree shutter. |
| Motion Sensitivity | 70 | 0 to 100 | Motion estimation threshold. 0 bypasses the blur. |

Motion analysis follows the frame size that the renderer produces.
At, or above, the project resolution the effect analyses every pixel.
A smaller preview uses a reduced motion field, and the blur length stays
proportional to the frame, so the look matches the full-size frame at a lower
resolution.
Exports always use full analysis, whatever the Player+ preview quality is.

The hidden **Quality** property is retained so that older projects load and save
with the same property set. Its value does not change the result.
Older projects that stored Quarter or Eighth values still load.

## Modules

| File | Role |
| --- | --- |
| `effect.js` | Property definitions, frame-sampler request, lifecycle, reconstruction draw. |
| `estimator.js` | Motion estimation and the 1/2-quality interpolation. |
| `fast-filter.js`, `fast-score.js` | Acceleration helpers used by the estimator. |
| `async-analysis.js` | Worker analysis for 1/2 quality. |
| `video-decoder.js` | Preview sample decoding with bounded caching and a native parity check. |
| `shaders/reconstruct.glsl` | Reconstruction pass from the current image and the motion field. |
| `analysis-mode.js` | Chooses full or reduced motion analysis from the render size and the export flag. |
| `native-particles.js`, `tooltips.js` | Host integration for particle sizing and hover text. |

The preview decoder embeds Mediabunny 1.62.0 from `plugins/mp4-export/vendor/`
in this plugin's bundle, so ZSMB works when the MP4 Export plugin is disabled.

Contributed by Zoidium contributors.
