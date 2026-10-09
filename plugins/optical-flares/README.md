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

**Distance Falloff** (with **Reference Distance**) scales element size by
`(reference / distance) ^ falloff`.

Rendering is a pure function of the scene state at the frame being drawn.
Flicker and shimmer use only time and seeds, never random numbers or clocks.

## Editing

The options window opens from the gear on the flare's row in the object list
(or `PZ.opticalflares.open(root)`). It is one floating window with:

- **Presets**: replace the whole element stack with a preset.
- **Elements**: add, duplicate, remove, and move elements.
- **Selected element**: type, enabled, color, size, brightness, position along
  the axis, rotation, aspect, blend, scale with distance, animation, seed, and a
  collapsed **Shape** section (texture, illumination, falloff, matte).
- **Source**, **Global**, **Advanced**: source settings, brightness, scale,
  color, rotation, evolution, flicker, quality, and the per-object common
  parameters.

Every change goes through the flare's own properties and CM3's history, so undo
and redo work. Dragging previews live and records one undo step on release.

## Files

- `optflares-math.js`: pure projection and layout math (no globals).
- `optflares.js`: the flare object, element catalogue, presets and shader.
- `optflares-window.js`: the options window.
- `optical-flares-runtime.js`: installs type 13, the gear, and the options
  entry point. Disabling restores every host change, and a failed activation
  rolls back.

## Compatibility

Saved properties and element records keep their names, so projects saved with
Davidium load. Changes in version 3:

- The default **Center Position** is now the screen centre (0, 0). Stored
  values keep their meaning: they are offsets from the centre.
- The **Preview BG Layer**, the element solo state, and the **Occlusion Fade**
  setting were removed. Stored values are ignored. Occlusion is now a depth
  test, so it hides the flare fully instead of fading it.
- The fullscreen Options window and the Inter font were removed.
- Custom Layers 1-3 keep working. Elements that referenced Custom 1-3 still
  read the same layer slots.

The Rowbyte & Red Giant Suite pack also registers a Trapcode designer gear for
this object when that pack is enabled. The flare's own gear and the designer
gear never render on the same row.

```bash
pnpm run build:plugin-bundles
pnpm run verify
```
