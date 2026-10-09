# Camera+

A Zoidium extension that adds a separate camera object for scenes. It does not
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

## Not included in this beta

- Dedicated Camera layers and shared-camera 3D tracking. They required replacing
  CM3's compositor and sequence methods, which this plugin no longer does.
- Shared-camera tracking of 2D layers. Camera Motion Blur applies to the
  Camera+ scene, including its geometry, rather than unrelated video clips.
- Cameras inside Repeater clones. A repeated camera has no single authored
  world pose; ordinary nested groups are supported.

## Migrating Davidium projects

- Vanilla CM3 camera objects that carry Davidium depth-of-field or vibrate
  fields load normally. The extra fields are ignored. Re-create the settings as a
  Camera+ if you need them.
- Davidium Camera layers (layer type 9) become normal Scene layers with
  Camera+ objects. Nested groups, animated transforms, perspective/orthographic
  projection, film settings, DOF and vibrate data are recovered. The resulting
  cameras can be moved into the scene they should render. The donor's global
  shared-camera tracking across separate layers is not restored.
- Davidium 3D track flags and the layer depth and motion-blur properties are not
  read. They are dropped on the next save.
