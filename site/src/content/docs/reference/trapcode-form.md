---
title: Trapcode Form properties
description: Trapcode Form controls, ranges, defaults, audio behavior, and evaluation limits.
sidebar:
  label: Trapcode Form
---
Trapcode Form is a suite object with native properties in its designer and property panel. Tables list defaults for new controls; presets and picker entries can override them.


## Base Form

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Base Form** | Choice | **box-grid**, **sphere**, **sphere-grid**, **cylinder**, **circle**, **plane**, **3D model**, **text/mask** | **box-grid** | Geometry used for the particle lattice. |
| **Base Form Size** | 3D vector | ≥ 0 | `[500, 500, 500]` | Extent of the base form on each axis. |
| **Base Size Mode** | Choice | **Per axis**, **Uniform (legacy)** | **Per axis** | Per-axis dimensions or the legacy uniform-size mode. |
| **Particles in X** | Number | ≥ 1 | `70` | Particle count along X. |
| **Particles in Y** | Number | ≥ 1 | `70` | Particle count along Y. |
| **Particles in Z** | Number | ≥ 1 | `3` | Particle count along Z. |
| **Position** | 3D vector | No declared bounds | `[0, 0, 0]` | Position in scene units. |
| **Rotation** | 3D vector | No declared bounds | `[0, 0, 0]` | Rotation in degrees. |
| **Strings** | Choice | **off**, **on** | **off** | Connects lattice neighbors with strings. |
| **String size** | Number | ≥ 0 | `0` | Increases string opacity, not width. |
| **String density** | Number | ≥ 0 | `15` | Density of neighbor connections. |
| **String size random** | Number | ≥ 0 | `0` | Variation of string brightness. |
| **String position distribution** | Number | ≥ 0 | `0` | Changes which neighboring pairs connect. |
| **3D model** | Asset | .json,application/json | None | JSON geometry used by the 3D model base form. |
| **Model scale** | Number | ≥ 0 | `100` | Scale of the model base form. |
| **Text/mask image** | Asset | image/* | None | Image used by the text/mask base form. |


## Particle

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Texture** | Asset | image/* | Default sprite | Image used for the particle sprite. |
| **Size** | Number | ≥ 0 | `2` | Base particle size. |
| **Size Random** | Number | 0 to 100 | `0` | Size variation in percent. |
| **Size Over** | Choice | **off**, **on** | **off** | Enables Size Curve. |
| **Size Curve** | Curve | Editable stops | White | Size multiplier across the form. |
| **Opacity** | Number | 0 to 100 | `100` | Particle opacity in percent. |
| **Opacity Over** | Choice | **off**, **on** | **off** | Enables Opacity Curve. |
| **Opacity Curve** | Curve | Editable stops | White | Opacity multiplier across the form. |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Base RGB color. |
| **Color Over** | Gradient | Editable stops | White | Color gradient across the form. |
| **Blend Mode** | Choice | **normal**, **add** | **normal** | Particle blend operation. |


## Shading

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Shading** | Choice | **off**, **on** | **off** | Enables lighting of the particles. |
| **Light Falloff** | Choice | **natural (lux)**, **inverse square**, **inverse cube**, **none** | **natural (lux)** | Distance attenuation model for shading. |
| **Nominal Distance** | Number | No declared bounds | `250` | Reference distance for lighting attenuation. |
| **Ambient** | Number | 0 to 100 | `20` | Ambient shading contribution in percent. |
| **Diffuse** | Number | 0 to 100 | `80` | Diffuse shading contribution in percent. |
| **Specular Amount** | Number | 0 to 100 | `0` | Specular highlight amount. |
| **Specular Sharpness** | Number | 0 to 100 | `100` | Sharpness of specular highlights. |
| **Reflection Strength** | Number | ≥ 0 | `100` | Reflection contribution. |
| **Shadowlet** | Choice | **off**, **on** | **off** | Enables the particle shadowlet approximation. |


## Disperse

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Disperse** | Number | No declared bounds | `0` | Seeded outward displacement. |
| **Twist** | Number | No declared bounds | `0` | Angular twist contribution. |


## Fluid

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Fluid Motion** | Choice | **off**, **on** | **off** | Enables fluid deformation of the lattice. |
| **Buoyancy** | Number | No declared bounds | `5` | Buoyancy force. |
| **Random Swirl** | Choice | **off**, **on** | **off** | Enables random swirl. |
| **Swirl Scale** | Number | No declared bounds | `10` | Spatial scale of swirl. |
| **Random Seed** | Number | No declared bounds | `0` | Seed for repeatable random values. |
| **Vortex Strength** | Number | No declared bounds | `100` | Strength of the vortex. |
| **Vortex Core Size** | Number | 0 to 100 | `50` | Size of the vortex core in percent. |
| **Vortex Tilt** | Number | No declared bounds | `0` | Vortex-axis tilt in degrees. |
| **Vortex Rotate** | Number | No declared bounds | `0` | Vortex orientation in degrees. |


## Fractal Field

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Affect Size** | Number | ≥ 0 | `0` | Noise modulation of particle size. |
| **Affect Opacity** | Number | ≥ 0 | `0` | Noise modulation of particle opacity. |
| **Displacement Mode** | Choice | **XYZ linked**, **independent XYZ**, **spherical**, **scale** | **XYZ linked** | Axes or radial mode used for displacement. |
| **Displace** | Number | No declared bounds | `0` | Primary fractal displacement amount. |
| **Y Displace** | Number | No declared bounds | `0` | Independent Y displacement amount. |
| **Z Displace** | Number | No declared bounds | `0` | Independent Z displacement amount. |
| **Flow X** | Number | No declared bounds | `0` | Fractal flow on X. |
| **Flow Y** | Number | No declared bounds | `0` | Fractal flow on Y. |
| **Flow Z** | Number | No declared bounds | `0` | Fractal flow on Z. |
| **Flow Evolution** | Number | No declared bounds | `50` | Speed of fractal evolution. |
| **Fractal Sum** | Choice | **noise**, **abs**, **sin**, **cos** | **noise** | Transfer function applied to fractal noise. |
| **Gamma** | Number | No declared bounds | `1` | Gamma of the fractal field. |
| **Add/Subtract** | Number | No declared bounds | `0` | Offset of the fractal field. |
| **Min** | Number | No declared bounds | `-1` | Lower bound of the fractal field. |
| **Max** | Number | No declared bounds | `1` | Upper bound of the fractal field. |
| **F Scale** | Number | No declared bounds | `10` | Spatial scale of the fractal field. |
| **Complexity** | Number | 1 to 8 | `3` | Number of fractal octaves. |
| **Octave Multiplier** | Number | No declared bounds | `0.5` | Amplitude multiplier for successive octaves. |
| **Octave Scale** | Number | No declared bounds | `1.5` | Frequency multiplier for successive octaves. |
| **Random Seed** | Number | No declared bounds | `0` | Seed for repeatable random values. |


## Spherical Field

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Strength[%]** | Number | No declared bounds | `0` | Strength of the spherical field in percent. |
| **Sphere Position** | 3D vector | No declared bounds | `[720, 540, 0]` | Center of the spherical field. |
| **Radius** | Number | ≥ 0 | `100` | Radius of the spherical field. |
| **Scale X** | Number | No declared bounds | `100` | Spherical field axis scale in percent. |
| **Scale Y** | Number | No declared bounds | `100` | Spherical field axis scale in percent. |
| **Scale Z** | Number | No declared bounds | `100` | Spherical field axis scale in percent. |
| **X Rotation** | Number | No declared bounds | `0` | Transform rotation about X in degrees. |
| **Y Rotation** | Number | No declared bounds | `0` | Transform rotation about Y in degrees. |
| **Z Rotation** | Number | No declared bounds | `0` | Transform rotation about Z in degrees. |
| **Feather** | Number | 0 to 100 | `50` | Softness of the field boundary. |
| **Sphere 2** | Choice | **off**, **on** | **off** | Enables the second spherical field. |
| **Sphere 2 Strength[%]** | Number | No declared bounds | `0` | Strength of the second spherical field. |
| **Sphere 2 Position** | 3D vector | No declared bounds | `[720, 540, 0]` | Position of the second spherical field. |
| **Sphere 2 Radius** | Number | ≥ 0 | `100` | Radius of the second spherical field. |


## Kaleidospace

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mirror On X** | Choice | **off**, **on** | **off** | Mirrors coordinates across the X center plane. |
| **Mirror On Y** | Choice | **off**, **on** | **off** | Mirrors coordinates across the Y center plane. |
| **Mirror On Z** | Choice | **off**, **on** | **off** | Mirrors coordinates across the Z center plane. |
| **Behaviour** | Choice | **mirror and remove**, **mirror and keep** | **mirror and remove** | Controls retention of mirrored source points. |
| **Center Position** | 3D vector | No declared bounds | `[720, 540, 0]` | Center of the mirror planes. |


## Layer Maps

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color and Alpha** | Choice | **off**, **on** | **off** | Enables image-based color and alpha modulation. |
| **Color and Alpha Layer** | Asset | image/* | None | Image source for color and alpha. |
| **Displacement** | Choice | **off**, **on** | **off** | Enables displacement from an image. |
| **Displacement Layer** | Asset | image/* | None | Image used for displacement. |
| **Size** | Choice | **off**, **on** | **off** | Enables image-based size modulation. |
| **Size Layer** | Asset | image/* | None | Image source for size. |
| **Fractal Strength** | Choice | **off**, **on** | **off** | Enables image-based fractal strength. |
| **Fractal Strength Layer** | Asset | image/* | None | Image used for fractal strength. |
| **Disperse** | Choice | **off**, **on** | **off** | Enables image-based Disperse strength. |
| **Disperse Layer** | Asset | image/* | None | Image used for Disperse. |
| **Rotate** | Choice | **off**, **on** | **off** | Enables image-based rotation. |
| **Rotate Layer** | Asset | image/* | None | Image used for rotation. |


## Audio React

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Audio Layer** | Asset | audio/*,video/* | None | Audio or video asset for offline audio analysis. |
| **Reactor 1 (size)** | Choice | **off**, **on** | **off** | Enables audio modulation of size. |
| **Reactor 2 (opacity)** | Choice | **off**, **on** | **off** | Enables audio modulation of opacity. |
| **Reactor 3 (disperse)** | Choice | **off**, **on** | **off** | Enables audio modulation of disperse. |
| **Reactor 4 (fractal)** | Choice | **off**, **on** | **off** | Enables audio modulation of fractal displacement. |
| **Reactor 5 (twist)** | Choice | **off**, **on** | **off** | Enables audio modulation of twist. |


## Transform

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Scale** | Number | ≥ 0 | `100` | Uniform scale in percent. |
| **X Offset** | Number | No declared bounds | `0` | Transform translation on X. |
| **Y Offset** | Number | No declared bounds | `0` | Transform translation on Y. |
| **Z Offset** | Number | No declared bounds | `0` | Transform translation on Z. |
| **Rotation Order** | Choice | **XYZ**, **YZX**, **ZXY**, **XZY**, **YXZ**, **ZYX** | **XYZ** | Order of transform rotations. |
| **X Rotation** | Number | No declared bounds | `0` | Transform rotation about X in degrees. |
| **Y Rotation** | Number | No declared bounds | `0` | Transform rotation about Y in degrees. |
| **Z Rotation** | Number | No declared bounds | `0` | Transform rotation about Z in degrees. |


## Evaluation and limits

The lattice is capped at 200,000 points. Strings draw as one-pixel lines; String size changes opacity rather than width. Form audio reactors have fixed targets and no offset or trim controls.

Form audio follows project-frame time. An active reactor scales its target with the audio level; with no active reactor, targets stay unchanged.

[Add suite objects and lights](/docs/features/trapcode-suite/)
