---
title: Node Effect properties
description: Graph sockets, local parameter defaults, exposed controls, and sampling limits.
sidebar:
  label: Node Effect reference
---
Node Effect builds an effect from a node graph. Except for Parameter fields, numeric and color fields have per-pixel sockets. Connected inputs replace local fields.

Number fields accept values up to ±100,000,000. UV coordinates are normalized. Pixel Coordinate and Radius use pixels. Angles use radians.


## Layer Color

Inputs: None

Outputs: **Color**, **Alpha**

Samples Color and Alpha from the effect input.


## UV

Inputs: None

Outputs: **UV**


## Pixel Coordinate

Inputs: None

Outputs: **Position**


## Resolution

Inputs: None

Outputs: **Size**


## Time

Inputs: None

Outputs: **Seconds**

Outputs native clip time in seconds. It follows trims and time remapping.


## Parameter

Inputs: None

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Name** | Text | Text | `Amount` | Label of the exposed native property. |
| **Type** | Choice | **Float**, **Color**, **Vector2 point** | **Float** | Float, Color, or Vector2 point parameter. |
| **Default** | Number | No declared bounds | `0.5` | Numeric value used by the node. |
| **Default color** | RGB color | No declared bounds | `#ffffff` | Default RGB parameter color. |
| **Default X** | Number | No declared bounds | `0.5` | Default X component. |
| **Default Y** | Number | No declared bounds | `0.5` | Default Y component. |
| **Minimum** | Number | No declared bounds | `0` | Minimum for the exposed control. |
| **Maximum** | Number | No declared bounds | `1` | Maximum for the exposed control. |

Creates a native animated property. Name is limited to 48 characters.


## Noise

Inputs: **UV**, **Scale**, **Time**, **Seed**

Outputs: **Value**, **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | No declared bounds | `8` | Pattern frequency or lattice scale. |
| **Time** | Number | No declared bounds | `0` | Explicit pattern phase. The Time input node supplies clip seconds. |
| **Seed** | Number | No declared bounds | `0` | Seed for deterministic random values. |


## Voronoi

Inputs: **UV**, **Scale**, **Time**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Distance** | Choice | **F1**, **F2**, **Edge** | **F1** | Operation selected for this node. |
| **Scale** | Number | No declared bounds | `8` | Pattern frequency or lattice scale. |
| **Time** | Number | No declared bounds | `0` | Explicit pattern phase. The Time input node supplies clip seconds. |


## Gradient

Inputs: **UV**, **Angle**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Choice | **Linear**, **Radial**, **Angular** | **Linear** | Operation selected for this node. |
| **Angle** | Number | No declared bounds | `0` | Pattern or sampling direction in radians. |


## Checker

Inputs: **UV**, **Scale**, **Color A**, **Color B**

Outputs: **Color**, **Factor**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | No declared bounds | `8` | Pattern frequency or lattice scale. |
| **Color A** | RGB color | No declared bounds | `#000000` | First operand. |
| **Color B** | RGB color | No declared bounds | `#ffffff` | Second operand or Blue component. |


## Wave

Inputs: **UV**, **Scale**, **Time**, **Angle**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | No declared bounds | `8` | Pattern frequency or lattice scale. |
| **Time** | Number | No declared bounds | `0` | Explicit pattern phase. The Time input node supplies clip seconds. |
| **Angle** | Number | No declared bounds | `0` | Pattern or sampling direction in radians. |


## Math

Inputs: **A**, **B**, **C**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Operation** | Choice | **Add**, **Subtract**, **Multiply**, **Divide**, **Minimum**, **Maximum**, **Power**, **Modulo**, **Absolute**, **Invert**, **Clamp**, **Compare**, **Sine**, **Round**, **Square Root**, **Logarithm**, **Exponent**, **Floor**, **Ceiling**, **Fraction**, **Sign**, **Smooth Minimum**, **Smooth Maximum**, **Snap**, **Wrap**, **Ping-Pong**, **Cosine**, **Tangent**, **Arctan2**, **Greater Than**, **Less Than** | **Add** | Operation selected for this node. |
| **A** | Number | No declared bounds | `0.5` | First operand. |
| **B** | Number | No declared bounds | `0.5` | Second operand or Blue component. |
| **C** | Number | No declared bounds | `0.5` | Third numeric operand. |


## Vector Math

Inputs: **A**, **B**

Outputs: **Vector**, **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Operation** | Choice | **Add**, **Subtract**, **Multiply**, **Divide**, **Normalize**, **Dot Product**, **Length**, **Distance**, **Cross Product** | **Add** | Operation selected for this node. |


## Map Range

Inputs: **Value**, **From min**, **From max**, **To min**, **To max**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Value** | Number | No declared bounds | `0.5` | Numeric value used by the node. |
| **From min** | Number | No declared bounds | `0` | Lower source range bound. |
| **From max** | Number | No declared bounds | `1` | Upper source range bound. |
| **To min** | Number | No declared bounds | `0` | Lower destination range bound. |
| **To max** | Number | No declared bounds | `1` | Upper destination range bound. |
| **Clamp** | Choice | **Off**, **On** | **Off** | Restricts the result to the destination range. |


## Clamp

Inputs: **Value**, **Minimum**, **Maximum**

Outputs: **Value**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Value** | Number | No declared bounds | `0.5` | Numeric value used by the node. |
| **Minimum** | Number | No declared bounds | `0` | Lower clamp bound. |
| **Maximum** | Number | No declared bounds | `1` | Upper clamp bound. |


## Mix

Inputs: **A**, **B**, **Factor**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Blend mode** | Choice | **normal**, **add**, **subtract**, **multiply**, **screen**, **overlay**, **darken**, **lighten**, **difference**, **soft light**, **dodge**, **burn**, **linear light**, **divide**, **exclusion**, **hue**, **saturation**, **color**, **value** | **normal** | Operation selected for this node. |
| **A** | RGB color | No declared bounds | `#000000` | First operand. |
| **B** | RGB color | No declared bounds | `#ffffff` | Second operand or Blue component. |
| **Factor** | Number | 0 to 1 | `0.5` | Mix or lookup factor. |


## Color Ramp

Inputs: **Factor**

Outputs: **Color**, **Alpha**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Factor** | Number | No declared bounds | `0.5` | Mix or lookup factor. |
| **Interpolation** | Choice | **Constant**, **Linear**, **Ease**, **Cardinal** | **Linear** | Interpolation between values or stops. |
| **Stops** | Ramp | Editable stops | `Black to white` | Positioned RGBA color stops. |


## Hue/Saturation

Inputs: **Color**, **Hue**, **Saturation**, **Value**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Hue** | Number | No declared bounds | `0` | Hue shift or hue component. |
| **Saturation** | Number | No declared bounds | `1` | Saturation multiplier or component. |
| **Value** | Number | No declared bounds | `1` | Numeric value used by the node. |


## Brightness/Contrast

Inputs: **Color**, **Brightness**, **Contrast**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Brightness** | Number | No declared bounds | `0` | Brightness multiplier or offset for the node's operation. |
| **Contrast** | Number | No declared bounds | `0` | Contrast of the result. |


## Levels

Inputs: **Color**, **Input black**, **Input white**, **Gamma**, **Output black**, **Output white**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Input black** | Number | No declared bounds | `0` | Input black point. |
| **Input white** | Number | No declared bounds | `1` | Input white point. |
| **Gamma** | Number | No declared bounds | `1` | Midtone gamma adjustment. |
| **Output black** | Number | No declared bounds | `0` | Output black point. |
| **Output white** | Number | No declared bounds | `1` | Output white point. |


## Invert

Inputs: **Color**, **Factor**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Factor** | Number | No declared bounds | `1` | Mix or lookup factor. |


## Output

Inputs: **Color**, **Alpha**

Outputs: None

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Alpha** | Number | 0 to 1 | `1` | Output alpha. |

Exactly one Output is required.


## Separate RGB

Inputs: **Color**

Outputs: **Red**, **Green**, **Blue**


## Combine RGB

Inputs: **Red**, **Green**, **Blue**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Red** | Number | No declared bounds | `0` | Red component. |
| **Green** | Number | No declared bounds | `0` | Green component. |
| **Blue** | Number | No declared bounds | `0` | Blue component. |


## Separate HSV

Inputs: **Color**

Outputs: **Hue**, **Saturation**, **Value**


## Combine HSV

Inputs: **Hue**, **Saturation**, **Value**

Outputs: **Color**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Hue** | Number | No declared bounds | `0` | Hue component. |
| **Saturation** | Number | No declared bounds | `0` | Saturation component. |
| **Value** | Number | No declared bounds | `0` | Value component. |


## Sample Layer at UV

Inputs: **UV**

Outputs: **Color**, **Alpha**


## Blur

Inputs: **UV**, **Radius (px)**, **Angle**, **Center X**, **Center Y**

Outputs: **Color**, **Alpha**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Choice | **Box**, **Gaussian**, **Directional**, **Radial** | **Box** | Operation selected for this node. |
| **Samples** | Number | 1 to 32 | `9` | Requested source sample count. |
| **Radius (px)** | Number | No declared bounds | `8` | Radius of local sampling or dirt detail. |
| **Angle** | Number | No declared bounds | `0` | Pattern or sampling direction in radians. |
| **Center X** | Number | No declared bounds | `0.5` | Horizontal center in normalized UV coordinates. |
| **Center Y** | Number | No declared bounds | `0.5` | Vertical center in normalized UV coordinates. |


## Edge Detect

Inputs: **UV**, **Radius (px)**, **Strength**

Outputs: **Color**, **Value**, **Alpha**

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Radius (px)** | Number | No declared bounds | `1` | Radius of local sampling or dirt detail. |
| **Strength** | Number | No declared bounds | `1` | Amount of the operation. |

Detects edges from image brightness.


## Graph and sampling limits

Graphs accept at most 128 nodes and 256 links. Cycles and double connections to one input are rejected. Nodes may use at most 256 source samples per output pixel.

[Build a Node Effect](/docs/features/node-effect/)
