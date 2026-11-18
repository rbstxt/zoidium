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
| Quality | 1/2 quality | Full quality, 1/2 quality | Resolution of the motion analysis. Full analyses at source resolution. 1/2 analyses at one eighth of the input width and height and reconstructs at image resolution. |
| Enabled | on | off, on | Off passes the current image through without changing source timing. |
| Track Frame | Previous | Previous, Next | Adjacent frame used for tracking. At frame 0 only, Previous uses the next frame. |
| Blur Amount | 0.5 | 0 to 10 | Trail length. 0 adds no blur. 0.5 approximates a 180-degree shutter. |
| Motion Sensitivity | 70 | 0 to 100 | Motion estimation threshold. 0 bypasses the blur. |

Older projects that stored Quarter or Eighth quality load as 1/2 quality.

## Modules

| File | Role |
| --- | --- |
| `effect.js` | Property definitions, frame-sampler request, lifecycle, reconstruction draw. |
| `estimator.js` | Motion estimation and the 1/2-quality interpolation. |
| `fast-filter.js`, `fast-score.js` | Acceleration helpers used by the estimator. |
| `async-analysis.js` | Worker analysis for 1/2 quality. |
| `video-decoder.js` | Preview sample decoding with bounded caching and a native parity check. |
| `shaders/reconstruct.glsl` | Reconstruction pass from the current image and the motion field. |
| `native-resolution.js`, `native-particles.js`, `tooltips.js` | Host integration for processing size, particle sizing and hover text. |

The preview decoder embeds Mediabunny 1.62.0 from `plugins/mp4-export/vendor/`
in this plugin's bundle, so ZSMB works when the MP4 Export plugin is disabled.

Contributed by Zoidium contributors.
