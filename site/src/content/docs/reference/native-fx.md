---
title: Native FX reference
description: Index and property references for all 22 Native FX effects.
sidebar:
  label: Native FX reference
  order: 70
---
Native FX is an effect pack in Zoidium, an external extension layer around CM3.
When **Plugins** has **Native FX** enabled, its 22 effects appear in the **Effects** picker under **NATIVE FX**.

## Effects

| Effect | Output |
| --- | --- |
| [Radial Blur (Spin)](/docs/reference/native-fx-image/#radial-blur-spin) | Blurs the current image around a center with symmetric rotated samples. |
| [Color Curves](/docs/reference/native-fx-image/#color-curves) | Remaps RGB intensity through a composite curve and separate red, green, and blue curves. |
| [Drop Shadow](/docs/reference/native-fx-image/#drop-shadow) | Composites a colored, offset, blurred copy of the input alpha behind the input. |
| [Radial Shadow](/docs/reference/native-fx-image/#radial-shadow) | Projects the input away from a point light to form a colored shadow. |
| [Echo](/docs/reference/native-fx-time/#echo) | Composites explicitly sampled earlier inputs with decreasing opacity. |
| [Time Offset](/docs/reference/native-fx-time/#time-offset) | Evaluates the layer input at an offset in project frames. |
| [Posterize Time](/docs/reference/native-fx-time/#posterize-time) | Holds the layer input on a lower frame-rate clock. |
| [Time Displacement](/docs/reference/native-fx-time/#time-displacement) | Selects a sampled time for each pixel from a luminance map. |
| [CC Wide Time](/docs/reference/native-fx-time/#cc-wide-time) | Averages or accumulates the current input and neighboring project-frame samples. |
| [Time Difference](/docs/reference/native-fx-time/#time-difference) | Displays the color or alpha difference between the current input and a time-shifted input. |
| [Color Difference Key](/docs/reference/native-fx-keying/#color-difference-key) | Builds a keying matte from two differences against the key color's dominant channel. |
| [Advanced Spill Suppressor](/docs/reference/native-fx-keying/#advanced-spill-suppressor) | Suppresses excess key-color channels while preserving input alpha. |
| [Key Cleaner](/docs/reference/native-fx-keying/#key-cleaner) | Refines keyed edges with spatial alpha filtering, contrast, and color decontamination. |
| [Linear Color Key](/docs/reference/native-fx-keying/#linear-color-key) | Removes or retains pixels according to their color distance from a key color. |
| [Radio Waves](/docs/reference/native-fx-generators/#radio-waves) | Draws expanding polygon or circle waves from a producer point. |
| [Beam](/docs/reference/native-fx-generators/#beam) | Draws a colored beam along a segment between two points. |
| [Numbers](/docs/reference/native-fx-generators/#numbers) | Draws a deterministic number, formatted time, date, or hexadecimal value. |
| [Timecode](/docs/reference/native-fx-generators/#timecode) | Draws the evaluated time as SMPTE timecode, frames, or feet and frames. |
| [CC Page Turn](/docs/reference/native-fx-transitions/#cc-page-turn) | Curls the current input around a cylindrical fold with a shaded back page. |
| [Card Wipe](/docs/reference/native-fx-transitions/#card-wipe) | Flips the current input as a grid of cards in a selected order. |
| [CC Pixel Polly](/docs/reference/native-fx-transitions/#cc-pixel-polly) | Breaks the current input into moving polygon or square pieces. |
| [Smart Motion Blur](/docs/reference/smart-motion-blur/) | Blurs fractional scene captures or reconstructs motion from neighboring frames. |

## Controls and inputs

Each reference table covers every property specific to this pack.
Vector rows include the component labels ending in **.X** and **.Y**.
**Enabled** defaults to **on** in every effect. **off** bypasses processing.
Common layer transforms and effect ordering remain CM3 controls.

[Time effects](/docs/reference/native-fx-time/) defines sample times, clip boundaries, and sample caps.
[Generators](/docs/reference/native-fx-generators/) and [transitions](/docs/reference/native-fx-transitions/) define time-driven animation and rendering caps.

**Echo (Legacy)** and **Posterize Time (Legacy)** in [OpenZoid Legacy](/docs/reference/openzoid-legacy/) are separate effects.
[Layer Input](/docs/how-to/use-layer-input/) covers other tracks as image inputs.
