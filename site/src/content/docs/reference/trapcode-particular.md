---
title: Trapcode Particular properties
description: Trapcode Particular controls, ranges, defaults, audio behavior, and evaluation limits.
sidebar:
  label: Trapcode Particular
---
Trapcode Particular is a suite object with native properties in its designer and property panel. Tables list defaults for new controls; presets and picker entries can override them.


## Emitter

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Emitter type** | Choice | **point**, **box**, **sphere** | **point** | Emits from a point, box, or sphere. |
| **Emitter behavior** | Choice | **continuous**, **explode**, **burst** | **continuous** | Continuous emission, one explosion, or recurring bursts. |
| **Emit from parent** | Choice | **off**, **on** | **off** | Emits from particles in the selected parent system. |
| **Parent system index** | Number | ≥ 0 | `0` | Zero-based parent system index. |
| **Inherit parent velocity[%]** | Number | 0 to 100 | `0` | Percentage of parent velocity inherited at birth. |
| **Particles/sec are % of primary** | Choice | **off**, **on** | **off** | Interprets emission rate relative to the primary system. |
| **Burst interval** | Number | ≥ 0.05 | `1` | Seconds between bursts. |
| **Particles/sec** | Number | ≥ 0 | `100` | Emission rate per second. |
| **Burst count** | Number | ≥ 0 | `0` | Particles emitted in a burst. |
| **Position** | 3D vector | No declared bounds | `[0, 0, 0]` | Position in scene units. |
| **Emitter size** | Number | ≥ 0 | `100` | Extent of the emitter. |
| **Direction** | 3D vector | No declared bounds | `[0, 0, 0]` | Initial velocity direction. |
| **Direction spread** | Number | ≥ 0 | `20` | Spread around the initial direction. |
| **Velocity** | Number | No declared bounds | `100` | Initial particle speed. |
| **Velocity random** | Number | 0 to 100 | `20` | Variation of initial speed in percent. |
| **Velocity distribution** | Number | 0 to 1 | `0.5` | Biases random initial speed toward slower values below 0.5 and faster values above 0.5. Requires Velocity random. At 0.5, the original spread remains unchanged. |
| **Velocity from emitter motion** | Number | 0 to 100 | `0` | Contribution from emitter movement. |
| **Rotation** | Number | No declared bounds | `0` | Rotation in degrees. |
| **Rotation random** | Number | ≥ 0 | `0` | Variation of initial sprite angle. |
| **Rotation speed** | Number | No declared bounds | `0` | Initial sprite spin speed. |
| **Rotation speed random** | Number | ≥ 0 | `0` | Variation of sprite spin speed. |
| **Random seed** | Number | No declared bounds | `100000` | Seed for repeatable random values. |


## Particle

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Life (seconds)** | Number | ≥ 0.01 | `3` | Particle lifetime in seconds. CPU simulation caps this at 30 seconds. |
| **Life random** | Number | 0 to 100 | `0` | Lifetime variation in percent. |
| **Texture** | Asset | image/* | Default sprite | Image used for the particle sprite. |
| **Size** | Number | ≥ 0 | `5` | Base particle size. |
| **Size random** | Number | 0 to 100 | `0` | Size variation in percent. |
| **Size over life** | Choice | **off**, **on** | **off** | Enables the Size curve over normalized particle age. |
| **Size curve** | Curve | Editable stops | White | Size multiplier over normalized particle age. |
| **Aspect ratio** | Number | ≥ 0.01 | `1` | Width divided by height. Compresses the shorter sprite axis within its point footprint. |
| **Orient to motion** | Number | 0 to 100 | `0` | Amount of alignment to motion. |
| **Orient to motion fade-in** | Number | ≥ 0 | `20` | Time over which motion alignment increases. |
| **Rotate X** | Number | No declared bounds | `0` | Initial X rotation in degrees. |
| **Rotate Y** | Number | No declared bounds | `0` | Initial Y rotation in degrees. |
| **Rotate Z** | Number | No declared bounds | `0` | Initial Z rotation in degrees. |
| **Random rotation** | Number | 0 to 100 | `0` | Variation of initial rotation. |
| **Degrees/sec X** | Number | No declared bounds | `0` | X spin speed in degrees per second. |
| **Degrees/sec Y** | Number | No declared bounds | `0` | Y spin speed in degrees per second. |
| **Degrees/sec Z** | Number | No declared bounds | `0` | Z spin speed in degrees per second. |
| **Random speed rotate** | Number | 0 to 100 | `0` | Variation of spin speed. |
| **Random speed distribution** | Number | 0 to 1 | `0.5` | Distribution of spin-speed variation. |
| **Stretch along motion** | Number | 0 to 100 | `0` | Amount of stretching along motion. |
| **Opacity** | Number | 0 to 100 | `100` | Particle opacity in percent. |
| **Opacity random** | Number | 0 to 100 | `0` | Seeded per-particle opacity reduction. At 100, the multiplier ranges from 0 to 1. |
| **Opacity over life** | Choice | **off**, **on** | **off** | Enables the Opacity curve over normalized particle age. |
| **Opacity curve** | Curve | Editable stops | White | Opacity multiplier over normalized particle age. |
| **Color** | RGB color | 0 to 1 | `[1, 1, 1]` | Base RGB color. |
| **Color over life** | Gradient | Editable stops | White | Gradient sampled over normalized particle age. |
| **Color random** | Number | 0 to 100 | `0` | Mixes the tinted gradient color with a seeded random RGB color. Alpha remains unchanged. |
| **Blend mode** | Choice | **normal**, **add**, **screen**, **multiply** | **normal** | Particle blend operation. |
| **Glow** | Number | ≥ 0 | `0` | Particle brightness multiplier contribution. |
| **Random seed** | Number | No declared bounds | `0` | Seed for repeatable random values. |


## Physics

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Choice | **off**, **on** | **off** | Selects CPU simulation for this system. |
| **Gravity** | Number | No declared bounds | `0` | Gravity acceleration along Gravity direction. |
| **Air resistance** | Number | ≥ 0 | `0` | Air drag strength. |
| **Mass** | Number | ≥ 0.01 | `10` | Particle mass for force response. |
| **Mass random** | Number | 0 to 100 | `0` | Mass variation in percent. |
| **Size affects mass** | Number | 0 to 100 | `0` | Coupling between particle size and mass. |
| **Air resistance random** | Number | 0 to 100 | `0` | Air resistance variation. |
| **Size affects air resistance** | Number | 0 to 100 | `0` | Coupling between particle size and drag. |
| **Rotational air resistance** | Number | ≥ 0 | `0` | Damping of particle spin. |
| **Enable bounce** | Choice | **off**, **on** | **off** | Enables the bounce plane. |
| **Bounce boost** | Number | No declared bounds | `500` | Extra rebound velocity. The plane stays at Y = 0. |
| **Bounce strength** | Number | 0 to 100 | `50` | Velocity retained after bounce in percent. |
| **Enable meander** | Choice | **off**, **on** | **off** | Enables meandering motion. |
| **Affect direction** | Number | No declared bounds | `20` | Direction change from meander. |
| **Affect speed** | Number | No declared bounds | `20` | Speed change from meander. |
| **Enable fluid dynamics** | Choice | **off**, **on** | **off** | Enables the fluid force block. |
| **Fluid force** | Choice | **vortex**, **buoyancy and swirl** | **vortex** | Chooses vortex or buoyancy and swirl forces. |
| **Buoyancy** | Number | No declared bounds | `5` | Buoyancy force. |
| **Random swirl** | Choice | **off**, **on** | **off** | Enables random fluid swirl. |
| **Swirl scale** | Number | ≥ 0.01 | `100` | Spatial scale of random swirl. |
| **Swirl strength** | Number | No declared bounds | `100` | Strength of random swirl. |
| **Fluid seed** | Number | No declared bounds | `0` | Seed for fluid motion. |
| **Vortex strength** | Number | No declared bounds | `100` | Strength of the vortex. |
| **Vortex core size** | Number | 0 to 100 | `50` | Size of the vortex core in percent. |
| **Vortex tilt** | Number | No declared bounds | `0` | Vortex-axis tilt in degrees. |
| **Vortex rotate** | Number | No declared bounds | `0` | Vortex orientation in degrees. |
| **Fluid center offset** | 3D vector | No declared bounds | `[0, 0, 0]` | Position offset of the fluid center. |
| **Fluid viscosity** | Number | ≥ 0 | `0` | Fluid damping strength. |
| **Fluid time scale [%]** | Number | ≥ 0 | `100` | Speed of fluid evolution in percent. |
| **Gravity direction** | 3D vector | No declared bounds | `[0, 1, 0]` | Normalized direction of gravity. |


## Environment

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Wind X** | Number | No declared bounds | `0` | Wind velocity on X. |
| **Wind Y** | Number | No declared bounds | `0` | Wind velocity on Y. |
| **Wind Z** | Number | No declared bounds | `0` | Wind velocity on Z. |
| **Air density** | Number | ≥ 0 | `1` | Multiplier for Air resistance. A changed value with nonzero resistance uses CPU simulation. |
| **Air turbulence** | Choice | **off**, **on** | **off** | Enables air turbulence. |
| **Affect position** | Number | ≥ 0 | `0` | Turbulence displacement strength. |
| **Affect orientation/spin** | Number | ≥ 0 | `0` | Turbulence spin contribution. |
| **Scale** | Number | No declared bounds | `10` | Spatial scale of turbulence. |
| **Complexity** | Number | 1 to 8 | `3` | Noise complexity. |
| **Evolution speed** | Number | No declared bounds | `50` | Speed of turbulence evolution. |


## Displace

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Drift X** | Number | No declared bounds | `0` | Adds Drift X times particle age to the X position, independently of mass and resistance. |
| **Drift Y** | Number | No declared bounds | `0` | Adds Drift Y times particle age to the Y position, independently of mass and resistance. |
| **Drift Z** | Number | No declared bounds | `0` | Adds Drift Z times particle age to the Z position, independently of mass and resistance. |
| **Spin amplitude** | Number | No declared bounds | `0` | Amplitude of displacement spin. |
| **Spin frequency** | Number | No declared bounds | `1` | Frequency of displacement spin. |
| **Disperse** | Number | No declared bounds | `0` | Seeded outward displacement. |
| **Disperse strength over** | Choice | **off**, **life** | **off** | Off keeps constant strength. Life multiplies each displacement step by Disperse curve at the normalized particle age. |
| **Disperse curve** | Curve | Editable stops | White | Strength multiplier when Disperse strength over is life. A white curve keeps the original displacement. |
| **Twist** | Number | No declared bounds | `0` | Angular twist contribution. |
| **Turbulence field affect size** | Number | No declared bounds | `0` | Size modulation in percent from the deterministic spatial turbulence field. Uses Environment Scale independently of Air turbulence. |
| **Turbulence field affect opacity** | Number | No declared bounds | `0` | Opacity modulation in percent from the same spatial turbulence field used for size. |


## Spherical field

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Strength[%]** | Number | No declared bounds | `0` | Strength of the spherical field in percent. |
| **Radius** | Number | ≥ 0 | `100` | Radius of the spherical field. |
| **Sphere position** | 3D vector | No declared bounds | `[720, 540, 0]` | Center of the spherical field. |
| **Scale X** | Number | No declared bounds | `100` | Spherical field axis scale in percent. |
| **Scale Y** | Number | No declared bounds | `100` | Spherical field axis scale in percent. |
| **Scale Z** | Number | No declared bounds | `100` | Spherical field axis scale in percent. |
| **Feather** | Number | 0 to 100 | `50` | Softness of the field boundary. |


## Kaleidospace

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Mirror on X** | Choice | **off**, **on** | **off** | Mirrors coordinates across the X center plane. |
| **Mirror on Y** | Choice | **off**, **on** | **off** | Mirrors coordinates across the Y center plane. |
| **Mirror on Z** | Choice | **off**, **on** | **off** | Mirrors coordinates across the Z center plane. |
| **Center position** | 3D vector | No declared bounds | `[720, 540, 0]` | Center of the mirror planes. |


## Transform

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **X rotation** | Number | No declared bounds | `0` | Transform rotation about X in degrees. |
| **Y rotation** | Number | No declared bounds | `0` | Transform rotation about Y in degrees. |
| **Z rotation** | Number | No declared bounds | `0` | Transform rotation about Z in degrees. |
| **Scale** | Number | No declared bounds | `100` | Uniform scale in percent. |
| **X offset** | Number | No declared bounds | `0` | Transform translation on X. |
| **Y offset** | Number | No declared bounds | `0` | Transform translation on Y. |
| **Z offset** | Number | No declared bounds | `0` | Transform translation on Z. |


## Layer maps

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color and alpha** | Choice | **off**, **on** | **off** | Enables image-based color and alpha modulation. |
| **Color layer** | Asset | image/* | None | Image source for color and alpha. |
| **Color mix** | Number | 0 to 100 | `100` | Mix amount of the color image. |
| **Size** | Choice | **off**, **on** | **off** | Enables image-based size modulation. |
| **Size layer** | Asset | image/* | None | Image source for size. |
| **Size strength** | Number | No declared bounds | `100` | Strength of the size map. |


## Audio react

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Audio layer** | Asset | audio/*,video/* | None | Audio or video asset for offline audio analysis. |
| **Audio offset (seconds)** | Number | ≥ 0 | `0` | Delay of the reactor's audio window in seconds. |
| **Audio trim in (seconds)** | Number | ≥ 0 | `0` | First media time in seconds. |
| **Audio trim out (seconds, 0 = end)** | Number | ≥ 0 | `0` | Last media time in seconds. Zero uses the available end. |
| **Reactor 1** | Choice | **off**, **on** | **off** | Enables this audio reactor. |
| **Reactor 1 target** | Choice | **size**, **opacity**, **velocity**, **color** | **size** | Parameter modulated by this reactor. |
| **Reactor 1 strength** | Number | No declared bounds | `100` | Strength of audio modulation. |
| **Reactor 2** | Choice | **off**, **on** | **off** | Enables this audio reactor. |
| **Reactor 2 target** | Choice | **size**, **opacity**, **velocity**, **color** | **size** | Parameter modulated by this reactor. |
| **Reactor 2 strength** | Number | No declared bounds | `100` | Strength of audio modulation. |
| **Reactor 3** | Choice | **off**, **on** | **off** | Enables this audio reactor. |
| **Reactor 3 target** | Choice | **size**, **opacity**, **velocity**, **color** | **size** | Parameter modulated by this reactor. |
| **Reactor 3 strength** | Number | No declared bounds | `100` | Strength of audio modulation. |
| **Reactor 4** | Choice | **off**, **on** | **off** | Enables this audio reactor. |
| **Reactor 4 target** | Choice | **size**, **opacity**, **velocity**, **color** | **size** | Parameter modulated by this reactor. |
| **Reactor 4 strength** | Number | No declared bounds | `100` | Strength of audio modulation. |


## Lighting

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Shading** | Choice | **off**, **on** | **off** | Enables particle lighting. |
| **Light falloff** | Choice | **natural (lux)**, **inverse square**, **inverse cube**, **none** | **natural (lux)** | Distance attenuation model for shading. |
| **Nominal distance** | Number | No declared bounds | `250` | Reference distance for lighting attenuation. |
| **Ambient** | Number | 0 to 100 | `20` | Ambient shading contribution in percent. |
| **Diffuse** | Number | 0 to 100 | `80` | Diffuse shading contribution in percent. |
| **Specular amount** | Number | 0 to 100 | `0` | Specular highlight amount. |
| **Specular sharpness** | Number | 0 to 100 | `100` | Sharpness of specular highlights. |
| **Reflection strength** | Number | ≥ 0 | `100` | Reflection contribution. |
| **Shadowlet** | Choice | **off**, **on** | **off** | Enables the particle shadowlet approximation. |


## Evaluation and limits

CPU simulation clamps time to 600 seconds and particle life to 30 seconds. Each system keeps at most the newest 20,000 live particles. Parent emission depth is capped at two.

Offset and trim values are seconds. Reactors with the same target multiply their modulation. Outside the audio window, the level is 0.

[Add suite objects and lights](/docs/features/trapcode-suite/)
