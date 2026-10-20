# Node Effect

Node Effect adds a graph authoring tool around CM3's native Custom Shader.
Add it from NATIVE FX in the Effects picker, then select it and choose Open
Node Editor. Connect color and alpha to Output. Use the normal viewport for
the result, with the editing camera switched off.

The shared node editor provides search, aliases, socket connections, node
copy/paste, dimming for nodes outside the Output path, and one history step
per completed edit. Undo and redo use the main project history. A rejected
graph shows an English error above the graph and retains the last valid
shader. Closing the editor discards rejected changes.

## Parameters and time

Parameter supports Float, Color, and Vector2 point. Its Name is a display
label. The uniform identity comes from the node ID, so renaming preserves
native keyframes, interpolation, tangents, and expressions. The native
Effects panel and Graph Editor can animate these properties. Changing the
parameter's type creates a new channel because scalar and vector keyframes
are incompatible. Editing its default changes an unanimated channel; it does
not rewrite animation. Minimum and Maximum set the native property range.

Time reads the owning clip's native Time expression in seconds, including
clip time remapping. It does not read the wall clock or previous frames.
Connect Time to a pattern's Time input to animate that pattern. Dynamic
parameter edits update native uniforms without compiling a graph or shader.

## Color and sampling

Layer Color samples the effect input. Source textures use premultiplied
alpha. The graph exposes straight RGB and a separate Alpha output; Output
premultiplies its color using its Alpha input. Connect Layer Color's Alpha
to Output's Alpha to preserve the input silhouette. UV uses normalized 0–1
coordinates, Pixel Coordinate multiplies UV by Resolution, and every source
sample applies CM3's uvScale.

Numeric sockets read the luminance of a connected color using weights
0.3, 0.59, 0.11. Float values remain signed and unclipped until the final
render target. Math operation names and Mix blend mode names match Material+.
Angles are radians. Color Ramp supports Constant, Linear, Ease, and Cardinal
interpolation with 2–32 stops.

## Saved format and limits

The effect remains type 1. `properties.fragShader` contains the executable
GLSL followed by one `// @zoidium-node-effect` JSON comment. Version 1 stores
nodes with stable IDs, types, positions and parameters, plus socket links.
The native `customProperties` array stores all exposed channels. Its custom
property definitions retain display labels and defaults as optional
`zoidiumLabel` and `zoidiumDefault` metadata.

No render-time plugin code is required. Disabling Node Effect removes the
picker entry and graph editor; saved shaders and native animation continue
rendering. Bare CM3 may display generated uniform names instead of friendly
labels. Editing the native fragment shader manually can make the graph
metadata describe a different shader; reopening the graph and committing a
change recompiles it.

Graphs allow at most 128 nodes, 256 connections, 32 stops per Color Ramp,
and 192 KiB of compiled shader code. Cycles, duplicate destinations, unknown
types, invalid values and unsupported versions are rejected. GPU shader and
link validation runs before a graph replaces the working shader. Uniform
limits depend on the GPU and are checked during linking. Noise uses a fixed
2D value-noise lattice. Voronoi searches nine neighboring cells for F1/F2
and 25 cells around the nearest cell for edges. These patterns do not use
feedback or accumulated state.

## Sampling and recipes

Sample Layer at UV reads the effect's input image at a connected coordinate.
Blur and Edge Detect also read that input, not an upstream graph color.
Connect UV to move their sample center. Place separate Node Effects in the
native stack when a neighborhood operation must read an earlier graph result.
Blur accumulates premultiplied samples, so transparent edges do not acquire
a dark fringe. Its separate Alpha output can drive Output's Alpha input.

Box and Gaussian Blur use a square grid. Samples selects the largest square
not exceeding the requested count, with at most 5 x 5 taps. Directional and
Radial Blur use 1–32 taps. Radius is in pixels; radial blur moves toward and
away from Center X/Y by Radius divided by the longer image dimension.
Directional Angle is in radians. Edge Detect uses a fixed nine-tap Sobel
kernel on premultiplied luminance. Every graph is limited to 256 source
samples per output pixel, counting only nodes reachable from Output.
The limit is checked before shader replacement.

The shared editor's Recipes menu replaces the graph in one undo step:
Glow adds a Gaussian-blurred source; Chromatic aberration offsets red and
blue sampling with an exposed Vector2 Channel offset; Displacement by noise
animates input UVs using native clip time; Duotone maps source luminance
through an editable Color Ramp. Loading a recipe replaces the previous graph
and its parameter channels; Undo restores them.

Version 2 adds sampling nodes and recipes without changing graph version 1.
An older Node Effect editor can reject the new node types while the native
saved shader continues to render. Keep the saved shader intact when moving
between builds.
