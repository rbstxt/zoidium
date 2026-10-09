# Optical Flares

An object plugin that adds a 3D lens flare (numeric type 13, the same type
Davidium saves) to 3D scene layers.

## How the flare is placed

The flare has a 3D source, chosen with **Source** in the Source section:

- **Object 3D** (default): the flare object's own world position, so it moves
  with its parent transform and keyframes.
- **Light**: the light object at **Light index** in the same layer.
- **Screen (2D)**: a fixed screen offset. Kept so older projects render the
  same; new flares should use a 3D source.

Each frame the source is projected through the camera that draws the layer
(position, rotation, FOV, aspect and camera overrides all apply). The elements
are laid out on the line from the projected source through the screen centre
(**Center**). A source behind the camera, or past the **Edge Margin**, fades
out.

**Occlude** uses the depth buffer: the flare is drawn at the source depth, so
scene geometry in front of the source hides it. This is per pixel and needs no
raycasts.

The flare quad is excluded from velocity and environment-map passes. Its
projection callback is preserved during CM3's velocity updates.

**Distance Falloff** (with **Reference Distance**) scales element size by
`(reference / distance) ^ falloff`.

Rendering is a pure function of the scene state at the frame being drawn.
Flicker and shimmer use only time and seeds, never random numbers or clocks.

## Editing

The options window opens from the gear on the flare's header row in the
Properties panel (title "Optical Flares options"), or `PZ.opticalflares.open(root)`.
The 3D Objects list hides row buttons, so the gear does not appear there. The
window title is "Optical Flares" and the flare's name is the subtitle. It has:

- **Presets**: replace the whole element stack with a preset.
- **Elements**: rows read "1. Glow", "2. Multi Iris" in stack order. Add,
  Duplicate and Remove form one row of buttons; Move Up and Move Down the next.
- **Selected element**: type, enabled, color, size, brightness, position along
  the axis, rotation, aspect, blend, scale with distance, animation, seed, and a
  collapsed **Shape** section (texture, illumination, falloff, matte).
- **Source**, **Global**, **Advanced**: source settings, brightness, scale,
  color, rotation, evolution, flicker, quality, and the settings shared by all
  elements.

Property panel labels are unique: "2D Position" (only used by the 2D source),
"Flare Scale", "Flare Color", "Flare Brightness", "Element Scale", "Element
Color", "Seed" (shared) and "Element Seed" (per element).

Every change goes through the flare's own properties and CM3's history, so undo
and redo work. Dragging previews live and records one undo step on release.

## Files

- `optflares-math.js`: pure projection and layout math (no globals).
- `optflares.js`: the flare object, element catalogue, presets and shader.
- `optflares-window.js`: the options window.
- `optical-flares-runtime.js`: installs type 13, the Properties header gear
  (the options entry point). Disabling restores every host change, and a failed activation
  rolls back.

## Compatibility

Saved properties and element records keep their names, so projects saved with
Davidium load. Changes in version 4:

- A new flare is placed at (-50.9, 28.6, 0), about 62% of the way from the
  centre to the upper-left corner of the default CM3 camera, so its elements
  run across the frame. New flares start at Flare Brightness 70 and Flare Scale
  75. Saved values are unchanged.
- When the source and the centre coincide, the non-glow elements fade out
  instead of stacking into a white blob.
- A saved empty element stack loads empty. Presets only fill a new object.
- Display names changed; stored property keys did not.

Changes in version 3:

- The default **Center Position** is now the screen centre (0, 0). Stored
  values keep their meaning: they are offsets from the centre.
- The **Preview BG Layer**, the element solo state, and the **Occlusion Fade**
  setting were removed. Stored values are ignored. Occlusion is now a depth
  test, so it hides the flare fully instead of fading it.
- The fullscreen Options window and the Inter font were removed.
- Custom Layers 1-3 keep working. Elements that referenced Custom 1-3 still
  read the same layer slots.

```bash
pnpm run build:plugin-bundles
pnpm run verify
```
