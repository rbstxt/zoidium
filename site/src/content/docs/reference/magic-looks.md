---
title: Magic Looks tool properties
description: Native labels, defaults, ranges, LUT restrictions, and chain behavior for all 29 tool types.
sidebar:
  label: Magic Looks reference
---
Magic Looks effects use independent tool instances. A chain contains at most 64 instances, including repeated tool types. The chain order is the render order. Each instance keeps its own animation when moved.

Tables show labels for instance `1` in **Parameters**. Other instances replace the numeric prefix with their stable identity. Fractional controls display `1` for 100 percent.

The effect-level **Enabled** choice is **off** or **on**, default **on**. Off bypasses the entire look.


## Chain and presets

**On**, **Off**, **Duplicate**, **Remove**, **Move up**, and **Move down** edit the selected instance. Duplicate copies its channels. **Look** presets reset chain parameters before applying their values. **Clear look** resets parameters while retaining the chain.


## Color Contrast

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Color** | Choice | **off**, **on** | **off** | Enables this tool instance. |
| **1 Pivot** | Number | 0 to 1 | `0.18` | Luminance around which contrast pivots. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |
| **1 Contrast R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Contrast G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Contrast B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## HSL Colors

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 HSL** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 red saturation** | Number | -1 to 1 | `0` | Saturation change in the named hue band. |
| **1 orange saturation** | Number | -1 to 1 | `0` | Saturation change in the named hue band. |
| **1 yellow saturation** | Number | -1 to 1 | `0` | Saturation change in the named hue band. |
| **1 green saturation** | Number | -1 to 1 | `0` | Saturation change in the named hue band. |
| **1 cyan saturation** | Number | -1 to 1 | `0` | Saturation change in the named hue band. |
| **1 blue saturation** | Number | -1 to 1 | `0` | Saturation change in the named hue band. |
| **1 purple saturation** | Number | -1 to 1 | `0` | Saturation change in the named hue band. |
| **1 magenta saturation** | Number | -1 to 1 | `0` | Saturation change in the named hue band. |
| **1 red lightness** | Number | -1 to 1 | `0` | Lightness change in the named hue band. |
| **1 orange lightness** | Number | -1 to 1 | `0` | Lightness change in the named hue band. |
| **1 yellow lightness** | Number | -1 to 1 | `0` | Lightness change in the named hue band. |
| **1 green lightness** | Number | -1 to 1 | `0` | Lightness change in the named hue band. |
| **1 cyan lightness** | Number | -1 to 1 | `0` | Lightness change in the named hue band. |
| **1 blue lightness** | Number | -1 to 1 | `0` | Lightness change in the named hue band. |
| **1 purple lightness** | Number | -1 to 1 | `0` | Lightness change in the named hue band. |
| **1 magenta lightness** | Number | -1 to 1 | `0` | Lightness change in the named hue band. |


## Color Ranges

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Ranges** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Mix** | Number | 0 to 2 | `1` | Mix amount of the tool's result. |
| **1 High** | Number | 0 to 1 | `0.15` | Highlight-range threshold. |
| **1 Mid** | Number | 0 to 1 | `0.2` | Midtone-range threshold. |
| **1 Low** | Number | 0 to 1 | `0.3` | Shadow-range threshold. |
| **1 Show Threshold** | Choice | **off**, **on** | **off** | Displays the threshold mask. |
| **1 High R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 High G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 High B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Mid R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Mid G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Mid B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Low R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Low G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Low B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Crush

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Crush** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Gamma** | Number | 0.1 to 5 | `1` | Gamma adjustment. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |
| **1 Color R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Contrast

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Contrast:On** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Contrast** | Number | -1 to 2 | `0` | Contrast adjustment. |
| **1 Pivot** | Number | 0 to 1 | `0.18` | Luminance around which contrast pivots. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |


## Color Reversal

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Reversal** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Mix** | Number | 0 to 1 | `0` | Mix amount of the tool's result. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |


## 3-Strip Process

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 3-Strip** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Mix** | Number | -1 to 1 | `0` | Mix amount of the tool's result. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |


## Lift-Gamma-Gain

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 LGG** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Gamma Space** | Number | 1 to 3 | `2.2` | Working gamma space for the grade. |
| **1 Mix** | Number | 0 to 1 | `1` | Mix amount of the tool's result. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |
| **1 Lift R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Lift G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Lift B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Gamma R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Gamma G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Gamma B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Gain R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Gain G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Gain B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Ranged Saturation

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Sat** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Sat High** | Number | 0 to 2 | `1` | Highlight saturation multiplier. |
| **1 Sat Mid** | Number | 0 to 2 | `1` | Midtone saturation multiplier. |
| **1 Sat Low** | Number | 0 to 2 | `1` | Shadow saturation multiplier. |
| **1 High limit** | Number | 0 to 1 | `0.15` | Highlight-range limit. |
| **1 Mid limit** | Number | 0 to 1 | `0.05` | Midtone-range limit. |
| **1 Low limit** | Number | 0 to 1 | `0.3` | Shadow-range limit. |
| **1 Show Threshold** | Choice | **off**, **on** | **off** | Displays the threshold mask. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |
| **1 Balance R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Balance G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Balance B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Warm/Cool

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Warm** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Warm/Cool** | Number | -1 to 1 | `0` | Warm-to-cool balance. |
| **1 Tint** | Number | -1 to 1 | `0` | Green-to-magenta tint. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |


## 4-Way Color

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 4-Way** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |
| **1 Contrast** | Number | -1 to 2 | `0` | Contrast adjustment. |
| **1 Mix** | Number | 0 to 1 | `1` | Mix amount of the tool's result. |
| **1 Ranges Preview** | Choice | **off**, **on** | **off** | Displays tonal-range masks. |
| **1 shadows R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 shadows G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 shadows B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 midtones R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 midtones G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 midtones B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 highlights R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 highlights G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 highlights B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 global R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 global G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 global B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Mojo II

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Mojo II** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Mojo** | Number | 0 to 1 | `0` | Amount of the Mojo grade. |
| **1 Punch** | Number | 0 to 1 | `0` | Contrast of the Mojo grade. |
| **1 Bleach** | Number | 0 to 1 | `0` | Bleach treatment amount. |
| **1 Fade** | Number | 0 to 1 | `0` | Fade treatment amount. |
| **1 Blue Squeeze** | Number | 0 to 1 | `0.25` | Compression of blue colors. |
| **1 Skin Squeeze** | Number | 0 to 1 | `0.25` | Compression of skin-color ranges. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |
| **1 Cool/Warm** | Number | -1 to 1 | `0` | Cool-to-warm balance. |
| **1 Green/Magenta** | Number | -1 to 1 | `0` | Green-to-magenta balance or channel displacement. |
| **1 Skin Yellow/Pink** | Number | -1 to 1 | `0` | Yellow-to-pink balance in skin-color ranges. |
| **1 Mix** | Number | 0 to 1 | `1` | Mix amount of the tool's result. |


## Auto Shoulder

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Shoulder** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Mix** | Number | 0 to 1 | `0` | Mix amount of the tool's result. |


## Curves

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Curves** | Choice | **off**, **on** | **on** | Enables this tool instance. |

**Channel** selects **RGB**, **Red**, **Green**, or **Blue**. Curves start as identity diagonals. **Reset curves** restores those diagonals.


## S Curve

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 S Curve** | Choice | **off**, **on** | **on** | Enables this tool instance. |

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Black Point** | Number | 0 to 1 | `0` | Black endpoint of the curve. |
| **White Point** | Number | 0 to 1 | `1` | White endpoint of the curve. |
| **Contrast** | Number | 0.2 to 4 | `1` | Contrast adjustment. |
| **Midpoint** | Number | 0.05 to 0.95 | `0.5` | Pivot of the curve. |
| **Brightness** | Number | 0 to 1 | `0.5` | Vertical position of the curve midpoint. |


## LUT

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 LUT** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Mix** | Number | 0 to 1 | `1` | Mix amount of the tool's result. |
| **1 Gamma** | Choice | **Same As Input**, **Input**, **Output** | **Same As Input** | LUT gamma interpretation. |

**LUT** defaults to **None**. **Import .cube...** stores a 3D LUT in the project. Cube dimensions must be integers from 2 to 128. The parser rejects 1D LUTs, combined LUTs, and text over 80 MiB. **Clear** removes the imported LUT.


## Lightflex

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Lightflex** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Boost** | Number | -10 to 10 | `0` | Brightness boost in stops. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |
| **1 Color R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Deflare

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Deflare** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Mix** | Number | 0 to 1 | `0` | Mix amount of the tool's result. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |


## Vignette

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Vignette** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Center X** | Number | -1 to 1 | `0` | Horizontal center relative to the image. |
| **1 Center Y** | Number | -1 to 1 | `0` | Vertical center relative to the image. |
| **1 Radius** | Number | 0 to 3 | `1` | Radius of the affected region. |
| **1 Aspect** | Number | 0.1 to 3 | `1` | Width-to-height ratio of the affected region. |
| **1 Spread** | Number | 0 to 3 | `1` | Width of the transition region. |
| **1 Falloff** | Number | 0 to 1 | `0.5` | Shape of the fade. |
| **1 Mix** | Number | 0 to 1 | `0` | Mix amount of the tool's result. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |
| **1 Color R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Haze/Flare

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Haze** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Spillage** | Number | 0 to 1 | `0` | Amount of haze spread from the source image. |
| **1 Softness** | Number | 0 to 1 | `0.1` | Softness of the haze. |
| **1 Reach** | Number | 0 to 1 | `0.5` | Extent of the haze. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |
| **1 Reflection Exposure** | Number | -5 to 5 | `0` | Exposure of the reflected flare in stops. |
| **1 Reflection** | Choice | **off**, **on** | **on** | Enables the reflected flare. |
| **1 Matte Box Size** | Number | 0 to 1 | `0.5` | Size of the matte-box region. |
| **1 Matte Box Shade** | Number | 0 to 1 | `0.75` | Shading of the matte-box region. |
| **1 Tint Color R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Tint Color G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Tint Color B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Pop

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Pop:On** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Pop** | Number | -1 to 1 | `0` | Local-contrast amount. |
| **1 Size** | Number | 0 to 3 | `1` | Spatial extent of the filter. |
| **1 Preserve Detail** | Number | 0 to 1 | `0.3` | Amount of detail preservation. |


## Diffusion

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Diffusion** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Size** | Number | 0 to 1 | `0.3` | Spatial extent of the filter. |
| **1 Grade** | Number | 0 to 10 | `3` | Diffusion strength. |
| **1 Glow** | Number | 0 to 1 | `0` | Glow amount. |
| **1 Highs Only** | Number | 0 to 1 | `0.75` | Restricts diffusion toward highlights. |
| **1 High Bias** | Number | -2 to 2 | `0` | Bias of the highlight selection. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |
| **1 Color R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Star Filter

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Star** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Size** | Number | 0 to 1 | `0.1` | Spatial extent of the filter. |
| **1 Boost** | Number | -10 to 10 | `0` | Brightness boost in stops. |
| **1 Threshold** | Number | 0 to 1 | `0.9` | Minimum brightness for the flare. |
| **1 Show Threshold** | Choice | **off**, **on** | **off** | Displays the threshold mask. |
| **1 Angle** | Number | -180 to 180 | `45` | Star-filter rotation in degrees. |
| **1 Color R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Anamorphic Flare

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Flare** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Size** | Number | 0 to 5 | `2` | Spatial extent of the filter. |
| **1 Boost** | Number | -10 to 10 | `0` | Brightness boost in stops. |
| **1 Threshold** | Number | 0 to 1 | `0.9` | Minimum brightness for the flare. |
| **1 Show Threshold** | Choice | **off**, **on** | **off** | Displays the threshold mask. |
| **1 Reflection** | Choice | **off**, **on** | **off** | Enables the reflected flare. |
| **1 Reflection Boost** | Number | -10 to 10 | `-2` | Reflected-flare brightness in stops. |
| **1 Color R** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color G** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |
| **1 Color B** | Number | 0 to 4 | `1` | RGB component of the named tint wheel. |


## Lens Distortion

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Lens** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Distort** | Number | -1 to 1 | `0` | Radial lens distortion. |
| **1 Flatten** | Number | 0 to 1 | `0` | Vertical distortion relative to horizontal distortion. |


## Shutter Streak

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Streak** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Size** | Number | 0 to 2 | `0.75` | Spatial extent of the filter. |
| **1 Boost** | Number | -10 to 10 | `0` | Brightness boost in stops. |
| **1 Falloff** | Number | 0 to 1 | `0` | Shape of the fade. |


## Edge Softness

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Edge** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Blur Size** | Number | 0 to 0.5 | `0` | Edge blur radius. |
| **1 Quality** | Number | 1 to 8 | `3` | Number of blur quality steps. |
| **1 Center X** | Number | -1 to 1 | `0` | Horizontal center relative to the image. |
| **1 Center Y** | Number | -1 to 1 | `0` | Vertical center relative to the image. |
| **1 Radius** | Number | 0 to 3 | `0.35` | Radius of the affected region. |
| **1 Aspect** | Number | 0.1 to 3 | `1` | Width-to-height ratio of the affected region. |
| **1 Spread** | Number | 0 to 1 | `0.5` | Width of the transition region. |


## Chromatic Aberration

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 CA** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Red/Cyan** | Number | -5 to 5 | `0` | Red-versus-cyan channel displacement. |
| **1 Green/Magenta** | Number | -5 to 5 | `0` | Green-to-magenta balance or channel displacement. |
| **1 Blue/Yellow** | Number | -5 to 5 | `0` | Blue-versus-yellow channel displacement. |


## Telecine Net

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **1 Net** | Choice | **off**, **on** | **on** | Enables this tool instance. |
| **1 Size** | Number | 0 to 0.5 | `0.05` | Spatial extent of the filter. |
| **1 Mix** | Number | 0 to 1 | `0` | Mix amount of the tool's result. |
| **1 Exposure** | Number | -5 to 5 | `0` | Exposure compensation in stops. |


## Legacy chains

Looks saved in the old format keep working, with at most one of each of the 29 tool types and Lens Distortion first. The current format allows repeated tools and applies Lens Distortion at its chain position.

[Build a look with Magic Looks](/docs/features/magic-looks/)
