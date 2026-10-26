---
title: Camera+ properties
description: Film, projection, focus, shake, shutter, and tracked-layer controls.
sidebar:
  label: Camera+ reference
---
A scene uses the first eligible active Camera+ in depth-first object order. Without one, the scene uses its native camera. Shared Camera layers apply to tracks with **3D** enabled.


## Camera

Field of view depends on focal length, sensor, zoom, and sequence aspect ratio. Field of view reads 0 for Orthographic. Its editable range is in degrees. Equivalent focal length is read-only.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Active Camera** | Choice | **off**, **on** | **on** | Selects this camera for scene rendering when it is the first eligible Camera+. |
| **Position** | 3D vector | No declared bounds | `[0, 0, 80]` | Camera position in scene units. |
| **Rotation** | 3D vector | No declared bounds | `[0, 0, 0]` | Rotation in degrees. |
| **Rotation order** | Choice | **XYZ**, **YZX**, **ZXY**, **XZY**, **YXZ**, **ZYX** | **XYZ** | Order of the three rotation axes. |
| **Projection** | Choice | **Perspective**, **Orthographic** | **Perspective** | Perspective changes size with distance. Orthographic keeps apparent size independent of distance. |
| **Focal Length** | Number | 1 to 10000 | `35` | Focal length in millimeters. Longer lenses narrow the perspective view. |
| **Sensor** | Choice | **Classic 35 (36mm)**, **Photo 35 (36mm)**, **Full 35 (36mm)**, **Academy (21.95mm)**, **Super 35 (24.89mm)**, **APS-C (23.6mm)**, **APS-C C (22.3mm)**, **MFT (17.3mm)**, **1 inch (13.2mm)**, **2/3 inch (8.8mm)**, **Super 16 (12.52mm)**, **16 mm (10.26mm)** | **Classic 35 (36mm)** | Sensor gate in millimeters. |
| **35mm Equiv. Focal Length** | Number | No declared bounds | `35` | Read-only focal length multiplied by 36 divided by the sensor gate. |
| **Field of View (Horizontal)** | Number | 0.01 to 179.99 | `Derived` | Horizontal view angle in degrees. Edits write Focal Length. |
| **Field of View (Vertical)** | Number | 0.01 to 179.99 | `Derived` | Vertical view angle in degrees. Edits write Focal Length. |
| **Zoom** | Number | 0.01 to 1000 | `1` | Projection magnification. Larger values narrow the view. |
| **Film Offset X** | Number | -1000 to 1000 | `0` | Horizontal lens shift as a percentage of the gate or orthographic span. |
| **Film Offset Y** | Number | -1000 to 1000 | `0` | Vertical projection shift in percent. |


## Depth of Field

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Depth of Field** | Choice | **off**, **on** | **off** | Enables depth-based scene blur. |
| **Focus Distance** | Number | 0 to 5000 | `80` | Distance to the plane in focus, in scene units. |
| **Aperture** | Number | 0 to 40 | `3` | Blur amount outside the focus region. Zero removes this blur. |
| **Focus Width** | Number | 0 to 4000 | `0` | Width of the region kept in focus, in scene units. |
| **Near Blur Level** | Number | 0 to 400 | `100` | Near-side blur multiplier in percent. |
| **Far Blur Level** | Number | 0 to 400 | `100` | Far-side blur multiplier in percent. |
| **Focus** | Text | Text | Empty | Link sets a distance expression. Set copies one distance. Unlink removes the expression. |


## Motion Blur

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Camera Motion Blur** | Choice | **off**, **on** | **off** | Enables camera shutter sampling. One sample or a zero shutter removes this blur. |
| **Samples** | Number | 1 to 8 | `4` | Number of temporal camera samples. |
| **Shutter (frames)** | Number | 0 to 2 | `0.5` | Exposure interval in sequence frames. |


## Vibrate

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Choice | **off**, **on** | **on** | Enables seeded camera shake. Position and rotation still require their own switches. |
| **Regular Pulse** | Choice | **off**, **on** | **off** | Uses stepped noise instead of smooth noise. |
| **Relative** | Choice | **off**, **on** | **off** | Scales each amplitude by one percent of the corresponding base transform's absolute value. |
| **Seed** | Number | 0 to 100000 | `0` | Seed for repeatable random values. |
| **Enable Position** | Choice | **off**, **on** | **off** | Enables positional shake. |
| **Position Amplitude** | 3D vector | ≥ 0 | `[0, 0, 0]` | Maximum shake displacement on each axis. |
| **Position Frequency** | Number | ≥ 0 | `2` | Position noise frequency per second. |
| **Enable Rotation** | Choice | **off**, **on** | **off** | Enables rotational shake. |
| **Rotation Amplitude** | 3D vector | ≥ 0 | `[0, 0, 0]` | Maximum shake angle on each axis, in degrees. |
| **Rotation Frequency** | Number | ≥ 0 | `2` | Rotation noise frequency per second. |


## Tracking

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Motion Blur** | Number | 0 to 1 | `1` | Mix amount for shared-camera blur on a tracked layer. |
| **Depth** | Number | -1000 to 1000 | `0` | Layer depth for shared-camera projection. |
| **Rotation X (3D)** | Number | No declared bounds | `0` | Layer rotation about X in degrees. |
| **Rotation Y (3D)** | Number | No declared bounds | `0` | Layer rotation about Y in degrees. |


## Projection and sampling limits

Orthographic uses a base span of 0.1 scene units per sequence pixel, divided by Zoom. Focal Length and Sensor do not set that span.

Vibrate reads time in seconds and uses seeded noise. A direct seek to the same time produces the same shake. Relative shake is zero on an axis whose base value is zero.

[Use Camera+](/docs/features/camera-plus/)
