---
title: Material node properties
description: Node sockets, parameter types, ranges, defaults, and graph limits.
sidebar:
  label: Material nodes
---
The catalogue below lists visible Material+ nodes. Hidden compatibility nodes remain available to saved graphs. A node with no path to **Output** does not contribute to the material.

Numeric and color fields also have input sockets. A connected socket replaces the stored field value. Texture links use luminance for numbers and RGB for colors.

Pattern seeds, lattice dimensions, animation speeds, whole-image transforms, Random Color, and Fresnel settings use a connected texture's average value. Other supported pattern and color fields evaluate the texture per pixel.


## Output

Receives the material's baked surface channels.

Inputs: **Color**, **Luminance**, **Emission**, **Normal**, **Roughness**, **Metalness**, **Bump**, **Opacity**, **Fresnel**, **Normal strength**

Outputs: None

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Normal input** | Choice | **Tangent-space color**, **Height** | **Tangent-space color** | Interpret Normal as tangent-space color or a height field. |
| **Normal strength** | Number | 0 to 8 | `1` | Strength of the baked normal detail. |


## Noise

Produces seeded value noise and decorrelated RGB noise.

Inputs: **UV**, **Scale**, **Ratio Y**, **Octaves**, **Seed**, **Brightness**, **Contrast**, **Speed X**, **Speed Y**

Outputs: **Value**, **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | 1 to 64 | `4` | Pattern frequency or lattice scale. |
| **Ratio Y** | Number | 0.02 to 64 | `1` | Y scale relative to X. |
| **Octaves** | Number | 1 to 8 | `4` | Number of noise layers. |
| **Seed** | Number | 0 to 9999 | `1` | Seed for deterministic random values. |
| **Brightness** | Number | 0 to 2 | `1` | Brightness multiplier or offset for the node's operation. |
| **Contrast** | Number | 0 to 4 | `1` | Contrast of the result. |
| **Speed X** | Number | -4 to 4 | `0` | Horizontal pattern motion per second. |
| **Speed Y** | Number | -4 to 4 | `0` | Vertical pattern motion per second. |


## Gradient

Maps an input factor or coordinates to two colors.

Inputs: **Input**, **Base**, **Offset X**, **Offset Y**, **Scale X**, **Scale Y**, **Rotation**, **Opacity**, **Midpoint**, **Color 1**, **Color 2**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Choice | **linear**, **circular**, **angular**, **diamond** | **linear** | Pattern geometry. |
| **Offset X** | Number | -1 to 1 | `0` | Horizontal coordinate offset. |
| **Offset Y** | Number | -1 to 1 | `0` | Vertical coordinate offset. |
| **Scale X** | Number | 0.05 to 8 | `1` | Horizontal coordinate scale. |
| **Scale Y** | Number | 0.05 to 8 | `1` | Vertical coordinate scale. |
| **Rotation** | Number | -180 to 180 | `0` | Coordinate rotation in degrees. |
| **Opacity** | Number | 0 to 1 | `1` | Mix amount over the Base input. |
| **Blending mode** | Choice | **normal**, **add**, **subtract**, **multiply**, **screen**, **overlay**, **darken**, **lighten**, **difference**, **soft light**, **dodge**, **burn**, **linear light**, **divide**, **exclusion**, **hue**, **saturation**, **color**, **value** | **normal** | Operation used to blend with Base. |
| **Midpoint** | Number | 0.01 to 0.99 | `0.5` | Position of the midpoint between gradient colors. |
| **Color 1** | RGB color | No declared bounds | `[0.1, 0.1, 0.12]` | First color in the pattern or ramp. |
| **Color 2** | RGB color | No declared bounds | `[1, 1, 1]` | Second color in the pattern or ramp. |


## Color

Produces a constant color.

Inputs: **Color**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | No declared bounds | `[0.8, 0.8, 0.8]` | Constant RGB value. |


## Checker

Alternates two colors in a checker pattern.

Inputs: **UV**, **Scale**, **Color 1**, **Color 2**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | 1 to 64 | `8` | Pattern frequency or lattice scale. |
| **Color 1** | RGB color | No declared bounds | `[0, 0, 0]` | First color in the pattern or ramp. |
| **Color 2** | RGB color | No declared bounds | `[1, 1, 1]` | Second color in the pattern or ramp. |


## Image

Samples a project image in UV space.

Inputs: **UV**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Image** | Asset | Project asset | Empty | Project image selected through Selected node image. |


## Texture

Samples a project image with coordinate projection and transforms.

Inputs: **Offset X**, **Offset Y**, **Scale X**, **Scale Y**, **Rotation**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Image** | Asset | Project asset | Empty | Project image selected through Selected node image. |
| **Projection** | Choice | **planar**, **polar**, **cylindrical**, **spherical** | **planar** | Image coordinate projection. |
| **Offset X** | Number | -1 to 1 | `0` | Horizontal coordinate offset. |
| **Offset Y** | Number | -1 to 1 | `0` | Vertical coordinate offset. |
| **Scale X** | Number | 0.05 to 8 | `1` | Horizontal coordinate scale. |
| **Scale Y** | Number | 0.05 to 8 | `1` | Vertical coordinate scale. |
| **Rotation** | Number | -180 to 180 | `0` | Coordinate rotation in degrees. |


## Fresnel

Controls view-angle tint through Output Fresnel.

Inputs: **Color**, **Power**, **Mix**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | No declared bounds | `[1, 1, 1]` | Constant RGB value. |
| **Power** | Number | 0.1 to 8 | `4` | Exponent of view-angle tint. |
| **Mix** | Number | 0 to 1 | `1` | Mix factor. |


## Mix

Blends A and B.

Inputs: **A**, **B**, **Opacity**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mode** | Choice | **normal**, **add**, **subtract**, **multiply**, **screen**, **overlay**, **darken**, **lighten**, **difference**, **soft light**, **dodge**, **burn**, **linear light**, **divide**, **exclusion**, **hue**, **saturation**, **color**, **value** | **normal** | Operation selected for this node. |
| **Opacity** | Number | 0 to 1 | `1` | Mix amount over the Base input. |


## Math

Calculates signed scalar or per-pixel arithmetic.

Inputs: **A**, **B**, **C / Smoothness**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Operation** | Choice | **Add**, **Subtract**, **Multiply**, **Divide**, **Minimum**, **Maximum**, **Power**, **Modulo**, **Absolute**, **Invert**, **Clamp**, **Compare**, **Sine**, **Round**, **Square Root**, **Logarithm**, **Exponent**, **Floor**, **Ceiling**, **Fraction**, **Sign**, **Smooth Minimum**, **Smooth Maximum**, **Snap**, **Wrap**, **Ping-Pong**, **Cosine**, **Tangent**, **Arctan2**, **Greater Than**, **Less Than** | **Add** | Arithmetic or comparison operation. |
| **A** | Number | No declared bounds | `0` | First operand. |
| **B** | Number | No declared bounds | `1` | Second operand. |
| **C / Smoothness** | Number | No declared bounds | `0.5` | Third operand. For Math, smoothness or the lower Wrap bound. |


## Value (Float)

Produces an unbounded signed scalar.

Inputs: **Value**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Value** | Number | No declared bounds | `1` | Numeric value used by the node. |


## Sine Wave

Produces a sine pattern.

Inputs: **UV**, **Scale**, **Phase**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | 0.25 to 64 | `6` | Pattern frequency or lattice scale. |
| **Phase** | Number | 0 to 1 | `0` | Phase offset of the pattern. |
| **Axis** | Choice | **U**, **V** | **U** | Direction of the wave. |


## Marble

Produces distorted marble bands.

Inputs: **UV**, **Bands**, **Veins**, **Noise Scale**, **Octaves**, **Seed**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Bands** | Number | 0.25 to 32 | `5` | Pattern frequency or lattice scale. |
| **Veins** | Number | 0 to 12 | `3` | Strength of marble veins. |
| **Noise Scale** | Number | 1 to 32 | `6` | Scale of marble distortion noise. |
| **Octaves** | Number | 1 to 8 | `4` | Number of noise layers. |
| **Seed** | Number | 0 to 9999 | `1` | Seed for deterministic random values. |


## Ridged Fractal

Produces ridged fractal noise.

Inputs: **UV**, **Scale**, **Ratio Y**, **Octaves**, **Seed**, **Brightness**, **Contrast**, **Speed X**, **Speed Y**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | 1 to 64 | `6` | Pattern frequency or lattice scale. |
| **Ratio Y** | Number | 0.02 to 64 | `1` | Y scale relative to X. |
| **Octaves** | Number | 1 to 8 | `4` | Number of noise layers. |
| **Seed** | Number | 0 to 9999 | `1` | Seed for deterministic random values. |
| **Brightness** | Number | 0 to 2 | `1` | Brightness multiplier or offset for the node's operation. |
| **Contrast** | Number | 0 to 4 | `1` | Contrast of the result. |
| **Speed X** | Number | -4 to 4 | `0` | Horizontal pattern motion per second. |
| **Speed Y** | Number | -4 to 4 | `0` | Vertical pattern motion per second. |


## Turbulence

Produces turbulence noise.

Inputs: **UV**, **Scale**, **Ratio Y**, **Octaves**, **Seed**, **Brightness**, **Contrast**, **Speed X**, **Speed Y**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | 1 to 64 | `6` | Pattern frequency or lattice scale. |
| **Ratio Y** | Number | 0.02 to 64 | `1` | Y scale relative to X. |
| **Octaves** | Number | 1 to 8 | `4` | Number of noise layers. |
| **Seed** | Number | 0 to 9999 | `1` | Seed for deterministic random values. |
| **Brightness** | Number | 0 to 2 | `1` | Brightness multiplier or offset for the node's operation. |
| **Contrast** | Number | 0 to 4 | `1` | Contrast of the result. |
| **Speed X** | Number | -4 to 4 | `0` | Horizontal pattern motion per second. |
| **Speed Y** | Number | -4 to 4 | `0` | Vertical pattern motion per second. |


## Dirt (approx)

Produces procedural dirt detail.

Inputs: **UV**, **Scale**, **Ratio Y**, **Octaves**, **Seed**, **Radius**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | 1 to 64 | `4` | Pattern frequency or lattice scale. |
| **Ratio Y** | Number | 0.02 to 64 | `1` | Y scale relative to X. |
| **Octaves** | Number | 1 to 8 | `4` | Number of noise layers. |
| **Seed** | Number | 0 to 9999 | `1` | Seed for deterministic random values. |
| **Radius** | Number | 0.1 to 4 | `1.4` | Radius of local sampling or dirt detail. |


## RGB Spectrum

Maps wavelength to RGB.

Inputs: **Input**, **Wavelength**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Wavelength** | Number | 380 to 780 | `550` | Absolute wavelength without Input, or shift relative to 550 nm with Input. |


## Gaussian Spectrum

Maps a Gaussian spectrum to RGB.

Inputs: **Input**, **Center nm**, **Width nm**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Center nm** | Number | 380 to 780 | `550` | Spectral center without Input, or shift relative to 550 nm with Input. |
| **Width nm** | Number | 5 to 200 | `60` | Width of the Gaussian spectrum. |


## Blackbody

Maps blackbody temperature to RGB.

Inputs: **Input**, **Kelvin**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Kelvin** | Number | 1000 to 40000 | `4000` | Absolute temperature without Input, or shift relative to 4000 K with Input. |


## Random Color

Produces a seeded uniform random color.

Inputs: **Seed**, **Brightness**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Seed** | Number | 0 to 9999 | `1` | Seed for deterministic random values. |
| **Brightness** | Number | 0 to 2 | `1` | Brightness multiplier or offset for the node's operation. |


## Color Correction

Adjusts input color.

Inputs: **Input**, **Brightness**, **Contrast**, **Gamma**, **Hue Shift**, **Saturation**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Brightness** | Number | 0 to 2 | `1` | Brightness multiplier or offset for the node's operation. |
| **Contrast** | Number | 0 to 2 | `1` | Contrast of the result. |
| **Gamma** | Number | 0.1 to 4 | `1` | Midtone gamma adjustment. |
| **Hue Shift** | Number | -180 to 180 | `0` | Hue shift or hue component. |
| **Saturation** | Number | 0 to 2 | `1` | Saturation multiplier or component. |


## Colorizer

Maps the input to a five-color ramp.

Inputs: **Input**, **Color 1**, **Color 2**, **Color 3**, **Color 4**, **Color 5**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color 1** | RGB color | No declared bounds | `[0, 0, 0]` | First color in the pattern or ramp. |
| **Color 2** | RGB color | No declared bounds | `[0.25, 0.25, 0.3]` | Second color in the pattern or ramp. |
| **Color 3** | RGB color | No declared bounds | `[0.7, 0.7, 0.75]` | Middle ramp color. |
| **Color 4** | RGB color | No declared bounds | `[1, 1, 1]` | Fourth ramp color. |
| **Color 5** | RGB color | No declared bounds | `[1, 1, 1]` | Last ramp color. |


## Cosine Mix

Blends A and B with cosine interpolation.

Inputs: **A**, **B**, **Mix**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mix** | Number | 0 to 1 | `0.5` | Mix factor. |


## Projection

Produces projected UV coordinates.

Inputs: **Offset X**, **Offset Y**, **Scale X**, **Scale Y**, **Rotation**

Outputs: **Projection**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Texture Projection** | Choice | **planar**, **polar**, **cylindrical**, **spherical** | **planar** | Operation selected for this node. |
| **Offset X** | Number | -1 to 1 | `0` | Horizontal coordinate offset. |
| **Offset Y** | Number | -1 to 1 | `0` | Vertical coordinate offset. |
| **Scale X** | Number | 0.05 to 8 | `1` | Horizontal coordinate scale. |
| **Scale Y** | Number | 0.05 to 8 | `1` | Vertical coordinate scale. |
| **Rotation** | Number | -180 to 180 | `0` | Coordinate rotation in degrees. |


## UvW Transform

Transforms the coordinates used to sample Input.

Inputs: **Input**, **Offset X**, **Offset Y**, **Scale X**, **Scale Y**, **Rotation**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Offset X** | Number | -1 to 1 | `0` | Horizontal coordinate offset. |
| **Offset Y** | Number | -1 to 1 | `0` | Vertical coordinate offset. |
| **Scale X** | Number | 0.05 to 8 | `1` | Horizontal coordinate scale. |
| **Scale Y** | Number | 0.05 to 8 | `1` | Vertical coordinate scale. |
| **Rotation** | Number | -180 to 180 | `0` | Coordinate rotation in degrees. |


## Color Ramp

Maps Factor to independently available Color and Alpha.

Inputs: **Factor**

Outputs: **Color**, **Alpha**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Factor** | Number | 0 to 1 | `0.5` | Mix or lookup factor. |
| **Interpolation** | Choice | **Constant**, **Linear**, **Ease**, **Cardinal** | **Linear** | Interpolation between values or stops. |
| **Stops** | Ramp | Editable stops | `Black to white` | Positioned RGBA color stops. |


## Map Range

Remaps a number between ranges.

Inputs: **Value**, **From min**, **From max**, **To min**, **To max**, **Steps**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Value** | Number | No declared bounds | `0.5` | Numeric value used by the node. |
| **From min** | Number | No declared bounds | `0` | Lower source range bound. |
| **From max** | Number | No declared bounds | `1` | Upper source range bound. |
| **To min** | Number | No declared bounds | `0` | Lower destination range bound. |
| **To max** | Number | No declared bounds | `1` | Upper destination range bound. |
| **Interpolation** | Choice | **Linear**, **Stepped**, **Smoothstep**, **Smootherstep** | **Linear** | Interpolation between values or stops. |
| **Steps** | Number | 1 to 1000 | `4` | Number of steps for Stepped interpolation. |
| **Clamp** | Choice | **Off**, **On** | **On** | Restricts the result to the destination range. |


## RGB Curves

Applies combined RGB and per-channel curves.

Inputs: **Color**, **Factor**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Factor** | Number | 0 to 1 | `1` | Mix or lookup factor. |
| **Curves** | Curve | Editable stops | `Identity` | RGB and per-channel tone curves. |


## Separate RGB

Extracts Red, Green, and Blue.

Inputs: **Color**

Outputs: **Red**, **Green**, **Blue**


## Combine RGB

Combines Red, Green, and Blue.

Inputs: **Red**, **Green**, **Blue**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Red** | Number | 0 to 1 | `0` | Red component. |
| **Green** | Number | 0 to 1 | `0` | Green component. |
| **Blue** | Number | 0 to 1 | `0` | Blue component. |


## Separate HSV

Extracts Hue, Saturation, and Value.

Inputs: **Color**

Outputs: **Hue**, **Saturation**, **Value**


## Combine HSV

Combines Hue, Saturation, and Value into RGB.

Inputs: **Hue**, **Saturation**, **Value**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Hue** | Number | 0 to 1 | `0` | Hue component. |
| **Saturation** | Number | 0 to 1 | `0` | Saturation component. |
| **Value** | Number | 0 to 1 | `0` | Value component. |


## Voronoi

Produces cell distance, color, and position.

Inputs: **UV**, **Exponent**, **Smoothness**, **Scale**, **Randomness**, **Seed**, **Speed X**, **Speed Y**

Outputs: **Distance**, **Color**, **Position**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Feature** | Choice | **F1**, **F2**, **Smooth F1**, **Distance to Edge** | **F1** | Voronoi feature to calculate. |
| **Distance** | Choice | **Euclidean**, **Manhattan**, **Chebyshev**, **Minkowski** | **Euclidean** | Distance metric for Voronoi. |
| **Exponent** | Number | 0.1 to 16 | `2` | Minkowski distance exponent. |
| **Smoothness** | Number | 0.001 to 1 | `0.5` | Smooth F1 blend amount. |
| **Scale** | Number | 0.01 to 64 | `5` | Pattern frequency or lattice scale. |
| **Randomness** | Number | 0 to 1 | `1` | Amount of cell-position variation. |
| **Seed** | Number | 0 to 9999 | `1` | Seed for deterministic random values. |
| **Speed X** | Number | -4 to 4 | `0` | Horizontal pattern motion per second. |
| **Speed Y** | Number | -4 to 4 | `0` | Vertical pattern motion per second. |


## Wave

Produces directional bands or rings.

Inputs: **UV**, **Scale**, **Distortion**, **Detail**, **Seed**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Choice | **Bands**, **Rings** | **Bands** | Pattern geometry. |
| **Direction** | Choice | **X**, **Y**, **Diagonal** | **X** | Direction of the wave pattern. |
| **Profile** | Choice | **Sine**, **Saw**, **Triangle** | **Sine** | Wave profile. |
| **Scale** | Number | 0.01 to 64 | `5` | Pattern frequency or lattice scale. |
| **Distortion** | Number | 0 to 20 | `0` | Pattern distortion amount. |
| **Detail** | Number | 0 to 8 | `2` | Detail level of the pattern. |
| **Seed** | Number | 0 to 9999 | `1` | Seed for deterministic random values. |


## Brick

Produces colored bricks and mortar.

Inputs: **UV**, **Scale**, **Width**, **Height**, **Mortar size**, **Row offset**, **Seed**, **Brick 1**, **Brick 2**, **Mortar**

Outputs: **Color**, **Mortar**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | 0.01 to 64 | `5` | Pattern frequency or lattice scale. |
| **Width** | Number | 0.01 to 4 | `1` | Brick width. |
| **Height** | Number | 0.01 to 4 | `0.5` | Brick height. |
| **Mortar size** | Number | 0 to 0.5 | `0.04` | Mortar width. |
| **Row offset** | Number | 0 to 1 | `0.5` | U and V texture translation. |
| **Seed** | Number | 0 to 9999 | `1` | Seed for deterministic random values. |
| **Brick 1** | RGB color | No declared bounds | `[0.6, 0.17, 0.08]` | First color in the pattern or ramp. |
| **Brick 2** | RGB color | No declared bounds | `[0.3, 0.06, 0.03]` | Second color in the pattern or ramp. |
| **Mortar** | RGB color | No declared bounds | `[0.08, 0.08, 0.08]` | Mortar color. |


## Magic

Produces an iterative color pattern.

Inputs: **UV**, **Scale**, **Depth**, **Distortion**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | 0.01 to 64 | `5` | Pattern frequency or lattice scale. |
| **Depth** | Number | 0 to 10 | `2` | Number of Magic iterations. |
| **Distortion** | Number | 0 to 10 | `1` | Pattern distortion amount. |


## White Noise

Produces seeded white noise.

Inputs: **UV**, **Scale**, **Seed**

Outputs: **Value**, **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | 1 to 4096 | `256` | Pattern frequency or lattice scale. |
| **Seed** | Number | 0 to 9999 | `1` | Seed for deterministic random values. |


## Graph limits

Graphs accept at most 200 nodes and 400 links. Cycles and duplicate destination connections are rejected. Bake Resolution offers 128, 256, 512, 1024, and 2048. Export waits for the requested bake.

[Material+ properties](/docs/reference/material-plus/)
