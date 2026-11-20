---
title: Camera+
description: Frame 3D scenes with Camera+ lenses, Depth of Field, camera motion blur, seeded Vibrate shake, and shared Camera layers.
---
Use **Camera+** to add a physical lens camera with depth of field, motion blur, and seeded shake to a 3D Scene, or drive multiple tracks from a single shared **Camera** layer.
A 3D Scene renders through its first active **Camera+** object; without one, it uses the native CM3 camera.

## Add a Camera+ to a 3D Scene

1. In **Plugins**, enable **Camera+**.
2. Open the scene's 3D object picker and add **Camera > Camera+**.
3. Keep **Active Camera** turned **on**.
4. Set **Position**, **Rotation**, and your lens settings (**Focal Length**, **Sensor**, or **Field of View**).
5. Turn off the 3D editing camera to inspect the rendered framing.

## Focus and Depth of Field

1. Enable **Depth of Field** and adjust **Focus Distance** and **Aperture**.
2. To track a 3D object automatically, click **Link** in the **Focus** row and pick a target in the same scene.
3. Click **Set** to copy a one-time distance key at the playhead, or **Unlink** to remove the expression.

Relink the target if you move the camera or target to a different group or track.

## Share a Camera layer across tracks

1. Drag the **Camera** tile from **Media** onto the timeline.
2. Turn on the **3D** switch on every video track that should follow the shared camera.
3. Animate the camera's properties on the Camera clip.

## Property reference

A dash (`—`) accepts any value.

### Camera

Field of view depends on **Focal Length**, **Sensor**, **Zoom**, and the sequence aspect ratio. It reads `0` in **Orthographic** mode. Editing either field-of-view field writes **Focal Length**. Only **Zoom** sets the **Orthographic** span.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Active Camera** | Choice | **off**, **on** | **on** | Uses this camera for scene rendering when it is the first eligible Camera+. |
| **Position** | 3D vector | — | `[0, 0, 80]` | Camera position in scene units. |
| **Rotation** | 3D vector | — | `[0, 0, 0]` | Rotation in degrees. |
| **Rotation order** | Choice | **XYZ**, **YZX**, **ZXY**, **XZY**, **YXZ**, **ZYX** | **XYZ** | Order of the three rotation axes. |
| **Projection** | Choice | **Perspective**, **Orthographic** | **Perspective** | Perspective scales with distance; Orthographic keeps apparent size constant. |
| **Focal Length** | Number | `1` to `10000` | `35` | Focal length in mm. Longer lenses narrow the perspective view. |
| **Sensor** | Choice | **Classic 35 (36mm)**, **Photo 35 (36mm)**, **Full 35 (36mm)**, **Academy (21.95mm)**, **Super 35 (24.89mm)**, **APS-C (23.6mm)**, **APS-C C (22.3mm)**, **MFT (17.3mm)**, **1 inch (13.2mm)**, **2/3 inch (8.8mm)**, **Super 16 (12.52mm)**, **16 mm (10.26mm)** | **Classic 35 (36mm)** | Sensor gate width in millimeters. |
| **35mm Equiv. Focal Length** | Number | — | `35` | Read-only focal length scaled to a 36 mm gate. |
| **Field of View (Horizontal)** | Number | `0.01` to `179.99` | `Derived` | Horizontal view angle in degrees. |
| **Field of View (Vertical)** | Number | `0.01` to `179.99` | `Derived` | Vertical view angle in degrees. |
| **Zoom** | Number | `0.01` to `1000` | `1` | Projection magnification. Larger values narrow the view. |
| **Film Offset X** | Number | `-1000` to `1000` | `0` | Horizontal lens shift as a percentage of gate or orthographic span. |
| **Film Offset Y** | Number | `-1000` to `1000` | `0` | Vertical projection shift in percent. |

### Depth of Field

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Depth of Field** | Choice | **off**, **on** | **off** | Enables depth-based blur. |
| **Focus Distance** | Number | `0` to `5000` | `80` | Distance to the plane in focus (scene units). |
| **Aperture** | Number | `0` to `40` | `3` | Blur amount outside the focus region (`0` disables blur). Blur reaches its maximum at 2.5, so higher values look the same. |
| **Focus Width** | Number | `0` to `4000` | `0` | Width of the sharp focus band (scene units). |
| **Near Blur Level** | Number | `0` to `400` | `100` | Near-side blur multiplier in percent. |
| **Far Blur Level** | Number | `0` to `400` | `100` | Far-side blur multiplier in percent. |
| **Focus** | Text | Text | Empty | **Link** sets a distance expression; **Set** copies one distance; **Unlink** removes it. |

### Motion Blur

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Camera Motion Blur** | Choice | **off**, **on** | **off** | Enables camera shutter sampling (`1` sample or `0` shutter disables blur). |
| **Samples** | Number | `1` to `8` | `4` | Number of temporal camera samples. |
| **Shutter (frames)** | Number | `0` to `2` | `0.5` | Exposure interval in sequence frames. |

### Vibrate

Shake is deterministic: returning to the same frame always produces the same shake.

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Enabled** | Choice | **off**, **on** | **on** | Master shake switch (position and rotation also require their own switches). |
| **Regular Pulse** | Choice | **off**, **on** | **off** | Uses stepped noise instead of smooth noise. |
| **Relative** | Choice | **off**, **on** | **off** | Scales amplitude by the base value (zero where base is zero). |
| **Seed** | Number | `0` to `100000` | `0` | Seed for repeatable random values. |
| **Enable Position** | Choice | **off**, **on** | **off** | Enables positional shake. |
| **Position Amplitude** | 3D vector | ≥ 0 | `[0, 0, 0]` | Maximum displacement per axis. |
| **Position Frequency** | Number | ≥ 0 | `2` | Position noise frequency per local frame. |
| **Enable Rotation** | Choice | **off**, **on** | **off** | Enables rotational shake. |
| **Rotation Amplitude** | 3D vector | ≥ 0 | `[0, 0, 0]` | Maximum shake angle per axis in degrees. |
| **Rotation Frequency** | Number | ≥ 0 | `2` | Rotation noise frequency per local frame. |

### Shared-camera tracking and sequence multisampling

On tracks with **3D** enabled, **Tracking** adds:

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Motion Blur** | Number | `0` to `1` | `1` | Mix amount for shared-camera blur on the tracked layer. |
| **Depth** | Number | `-1000` to `1000` | `0` | Layer depth for shared-camera projection. |
| **Rotation X (3D)** | Number | — | `0` | Layer rotation about X in degrees. |
| **Rotation Y (3D)** | Number | — | `0` | Layer rotation about Y in degrees. |

Sequence multisampling controls (separate from **Camera Motion Blur**):
- **Track Frame** (**auto**, **previous**, **next**; default **auto**): centers (**auto**), ends (**previous**), or starts (**next**) the shared-camera shutter interval at the current frame.
- **Motion Sensitivity** (`0` to `200`, default `100`).
