# Camera+

A Zoidium extension that adds a separate camera object for scenes. It does not
replace or patch the CM3 camera. Turning the plugin on or off leaves projects
that do not use Camera+ rendering exactly as CM3 renders them.

## Adding a Camera+

Add a Camera+ to a Scene from the 3D picker: **Camera > Camera+**.

- **Active Camera** (`off`/`on`): a scene renders through the first active
  Camera+ among its direct child objects, in list order. Inactive Camera+ objects
  are ignored. When a scene has no active Camera+, it uses its CM3 camera
  unchanged.
- Film controls: position, rotation and rotation order, focal length, sensor
  size (film gate), zoom, and film offsets. Perspective projection only.
- **Depth of Field**: on/off, focus distance, aperture, focus area width, and
  near/far blur levels. The blur is a per-scene post pass that reads the scene's
  depth. It runs only while a Camera+ enables it.
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
- Video motion blur. It mixed a ring of previously rendered frames, so the output
  depended on render history. Use CM3 motion blur or the core temporal APIs.
- Camera+ objects nested inside groups. Only direct scene children are active.

## Migrating Davidium projects

- Vanilla CM3 camera objects that carry Davidium depth-of-field or vibrate
  fields load normally. The extra fields are ignored. Re-create the settings as a
  Camera+ if you need them.
- Davidium Camera layers (layer type 9) load as inert placeholders while Camera+
  is enabled. They draw nothing and do not change any scene camera. Their saved
  camera data is not migrated. Camera+ stays in use while such a layer exists in
  the project, so the plugin cannot be disabled until the layer is removed.
- Davidium 3D track flags and the layer depth and motion-blur properties are not
  read. They are dropped on the next save.
