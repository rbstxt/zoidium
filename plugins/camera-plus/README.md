# Camera+

An external Zoidium extension layer that adds Camera layers and separate camera objects for scenes. It does not
replace or patch the CM3 camera. Turning the plugin on or off leaves projects
that do not use Camera+ rendering exactly as CM3 renders them.

## Adding a Camera+

Add a Camera+ to a Scene from the 3D picker: **Camera > Camera+**.

- **Active Camera** (`off`/`on`): a scene renders through the first active
  Camera+ in depth-first child list order, including ordinary nested groups. Inactive Camera+ objects
  are ignored. When a scene has no active Camera+, it uses its CM3 camera
  unchanged.
- Film controls: position, rotation and rotation order, focal length, sensor
  size (film gate), zoom, and film offsets. Perspective and orthographic projection.
- **Depth of Field**: on/off, focus distance, aperture, focus area width, and
  near/far blur levels. The blur is a per-scene post pass that reads the scene's
  depth. It runs only while a Camera+ enables it.
- **Camera Motion Blur**: deterministic scene renders at fixed offsets across
  a centered shutter interval of up to two frames, averaged with one to eight
  samples. Every sample is evaluated afresh; no prior rendered frames are used.
  This can be combined with DOF, and restores the output-frame pose afterward.
  CM3 sequence multisampling remains available for the whole composition.
- **Vibrate**: seeded camera shake for position and rotation. Each offset is a
  pure function of the seed, the amplitude and frequency settings, and the
  current time. The shake does not accumulate between frames.
- **Focus Tools...** (under Depth of Field) opens a floating window. Pick an
  object in the same scene, then:
  - **Link** keeps the focus distance following the target. It writes the
    expression `focusDistanceTo([camera address], [target address])`.
  - **Set Once** writes the current distance as a keyframe at the playhead.
  - **Unlink** removes the expression.

Targets are limited to the camera's own scene. This keeps every link reading
transforms that were updated for the same time. Links store object addresses, so
moving the camera or target to another track or group breaks the link until it
is relinked.

## Camera layers and shared tracking

Drag the **Camera** Media tile into the timeline. It creates its own track and a
Camera layer with a Camera+ object. Animate the camera object's properties;
the Camera layer draws nothing and hides its unused layer transforms. Ordinary
CM3 cameras and nested camera groups can also be placed in the layer.

Enable **3D** in a video track header to follow the shared camera. One undo step
changes the flag and adds Transform effects to flat clips that need them. The
`track3d` flag survives saving, reopening, and loading with Camera+ disabled.
Scenes without 3D retain their own camera. Flat image, video, text, shape and
composite layers use the camera's current world pose, with Depth, Rotation X
and Rotation Y properties. A composite with a Transform follows as one card;
its child scenes keep their own cameras.

Master selection follows Davidium: Camera layers first, then Camera-named
Scenes, then shallower nesting, then the lowest track index. Cameras inside a
card cannot lead. Candidates are evaluated at the requested time before
selection, and tracking is applied again immediately before drawing.

A Camera layer's DOF enables a sequence depth pass, including scene depth and
flat-layer depth. Without shared DOF, Scenes use their own Camera+ DOF.
Sequence multisample blur adds **Track Frame** (`auto`, `previous`, `next`) and
**Motion Sensitivity**. Layer **Motion Blur** scales its shutter offset. These
use freshly evaluated subframes; rendering order and prior seeks do not supply
samples. Camera+ fixed-shutter scene sampling remains available.

Camera+ cannot be disabled while the project uses a Camera layer, a Camera+
object, or a 3D track. Start a project without those features to disable it.
Re-enabling restores the tile, buttons and factory without reopening the app.

## Migrating Davidium projects

Davidium Camera layers keep layer type 9 and their shared-camera role. Type-6
cameras carrying film, DOF or vibrate fields become Camera+ objects, preserving
animated values, projection and nested groups. Ordinary CM3 cameras stay type
6. Legacy DOF fields migrate into the `depthOfField` property group. Layer
Depth, Rotation X/Y and `track3d` keep their original field names.

## Deliberate omissions

Davidium's render-history texture ring and blend/warp video blur modes are not
ported. Their results depend on previously rendered frames. Use deterministic
sequence multisampling or Camera+ fixed-shutter sampling instead. Cameras in
Repeater clones are excluded because they have no single authored world pose.
Focus Tools currently targets objects in the camera's own layer.
