# S_Glow reference

S_Glow (beta 1.0) adds a thresholded, blurred glow as a native effect in the
Zoidium external extension layer around CM3. Its stable effect ID is
`sglow-hq-v2-preview`.

The effect owns its controls, render targets, and blur passes. `support.js`
owns the native-resolution preview processing, the expanded-border
composition, and the property tooltips.

## Properties

| Property | Default | Range or options | Meaning |
| --- | --- | --- | --- |
| Enabled | on | off, on | Turns the effect on or off. |
| Brightness | 2 | 0 and above | Glow intensity. Large values are allowed. |
| Color | white | Color | Tint of the emitted light. |
| Threshold | 0.5 | 0 and above | Excludes dim source pixels. |
| Threshold Add Color | black | Color | Raises the threshold per color channel. |
| Glow Width | 96 | 0 and above | Glow reach in native image pixels. |
| Width X, Width Y | 1 | 0 to 5 | Horizontal and vertical reach scaling. |
| Width Red, Width Green, Width Blue | 1, 1.2, 1.4 | 0 to 5 | Per-channel reach. |
| Subpixel | on | off, on | Smooths fractional width changes during animation. |
| Show | Result | Result, Threshold | Displays the result or the thresholded emitter. |
| Combine | Screen | Mult, Add, Screen, Difference, Overlay | Blend mode between glow and source. |
| Edge Mode | Reflect | Transparent, Reflect | Sampling outside the input edges. |
| Affect Alpha | 1 | 0 and above | Glow contribution to opacity. |
| Glow From Alpha | 0 | 0 to 1 | Blends from RGB emission to alpha emission. |
| Glow Under Source | 0 | 0 to 1 | Places the source over the glow. |
| Light Background | 0 | 0 to 1 | Modulates glow with source brightness. |
| Source Opacity | 1 | 0 to 1 | Fades the source without reducing glow generation. |
| Expand Borders | off | off, on | Adds transparent padding before the glow is generated. |
| Opacity | Normal | All Opaque, Normal, As Premult | How input alpha is interpreted. |
| Quality | High | Fast, Balanced, High, Ultra | Blur sampling precision. |
| Blur Engine | AE Match (3-box) | Performance (legacy), AE Match (3-box) | Blur kernel. |
| Atmosphere Amp | 0 | 0 and above | Dust and shadow structure; zero gives smooth glow. |
| Atmosphere Freq | 1 | 0.1 to 20 | Pattern scale. |
| Atmosphere Detail | 0.6 | 0 to 1 | Fine grain amount. |
| Atmosphere Seed | 0.123 | 0 to 100 | Repeatable noise offset. |
| Atmosphere Speed | 1 | Any | Evolution rate; zero freezes the pattern. |
| Time Mode | Automatic | Automatic, Manual | Automatic follows the timeline. Manual reveals Time. |

The fine and coarse AE kernels use separate render-target pairs. Both pairs
follow the same precision selection and are disposed on unload.

Contributed by MOUSEIIIIII.
