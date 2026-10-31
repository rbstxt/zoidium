---
title: Changelog
sidebar:
  label: Changelog
---
## Unreleased (beta)

New and changed since the last stable release. Entries use plain user language:
each line describes one visible change.

### Added

- Built-in fonts: Geist, Geist Mono, Geist Pixel (Circle, Grid, Line, Square,
  Triangle), Geist Serif (with Square, Triangle, and Heart styles), Inter, and
  Paper Mono, in every font picker. Geist, Geist Mono, and Inter are variable
  fonts, so Shape+ Text can animate their weight without importing a font.
- The font picker's preview image is now generated from the font list, so new
  built-in fonts show their own lettering.
- Shape+ Text: a live text item in Shape+ contents. Fills, strokes, gradients,
  path modifiers, Repeater and Merge Paths act on its letters like on any path.
  Source Text, font, Fallback Font, size, tracking, leading, baseline shift,
  scale, caps, alignment and box text with wrapping are animatable.
  Double-click the text in the preview to edit it.
- Variable fonts in Shape+ Text: each font axis (weight, width and others) is
  an animatable property, and **Style** applies the font's named styles.
  TTF, OTF and WOFF fonts work; WOFF2 shows an unsupported-format notice.
- Shape+ Text Animators: a Text Animator below a text item moves, scales,
  rotates, skews, tracks or offsets selected characters, and shifts each
  variable font axis per character. A Range Selector (shape, ease, mode,
  randomize) and an optional Wiggly Selector choose the characters by
  character, word or line. Add one from the text's right-click menu.
- **Create Shapes from Text** in Shape+ turns a text item into editable paths,
  one group per character, with the same pixels as the text.
- Graph Editor 2 shows expression output as a read-only dashed curve, draws
  every easing preset in its true shape, and previews each preset in
  Custom easings.
- Graph Editor 2 lists vector and colour properties as one row with X, Y, Z
  (or R, G, B, A) rows. Each axis can be shown, soloed, and edited alone.
  **Link axes** moves same-frame keys on the other axes in time.
- ExpressText+ by DaviFX: a container over 3D Text that moves each letter
  with Shake, Plain, Random, Formula, Delay, Spline, Orbit, Repeater, Twist,
  Wrap, and Voronoi effectors.
- Assets panel in the After Effects style: every file, font, image, model, and
  composition in one place, with usage, missing, and failed badges.
- Asset commands: Import, Delete, Remove Unused Items, Replace, Reload,
  Relink, Resolve Fonts, and Export.
- Asset folders and labels with drag and drop, plus Collect Files and
  Consolidate All Footage.
- Dropping an Assets item onto an animated property keys that property.
- Shape+ vector editing: grouped path keys, a Shape Editor with canvas tools,
  gesture history, and lossless topology.
- Shape+ paint and procedural geometry: strokes, deformations, wiggles,
  offsets, clipping, native conversion, and SVG paste.
- Expressions+: modern expressions, Sequence Controls, Graph Editor 2
  authoring, same-frame world sampling, camera helpers, and shader bindings.
- Shader+: texture kinds (ramps, curves, text), editors inside the native
  property sidebar, and font preparation.
- Shader authoring tools: confirmed templates, isolated draft checks,
  completion, help, find, local history, and JSON export.
- Node Effect graphs with validation, native parameter animation, and
  starter recipes.
- Node Material catalogue with ramp and curve editors, surface tracks,
  and recipes.
- Constraints with a Track To constraint and dependency-cycle checks.
- Motion Paths viewport plugin with draggable key editing.
- Theme Editor with palettes, undo, and legacy Custom profile sync.
- Native MP4 export with streaming encoding, quality controls, and
  error recovery.
- Smart Motion Blur with optical-flow and shutter-sample reconstruction
  and motion diagnostics.
- Text+ native 2D character animation, per-face character materials, and
  three stacked character categories.
- Centered editor layouts (Clipmaker 3 Centered, Video Editor 2 Centered,
  Video Editor 2 Centered 2) with a second panel sidebar.
- Right-click a panel tab in a centered layout to move it within or across
  sidebars; the arrangement is remembered with the editor settings.
- Effect picker grouped by category, with counts and recently used effects.
- Editor chrome and popup menus follow the active theme.
- Export Bitrate multiplier in the device render options.
- Effect sources that read frames from another layer as input.
- Particular Displace Spin along seeded circular orbits and a shared
  Twist pivot.
- Developer preview, off by default: local community effect packages with
  validated controls, local package storage, local-only frame sampling of
  other frames, and project records that survive a missing package. On
  desktop, packages persist in the app data folder and each package runs in
  its own isolated session. Not yet for general use.

### Changed

- Shape+ Text edits in place, like After Effects: double-click the text to
  place a caret on the rendered letters, type with live updates (IME
  included), select with Shift or by dragging, and press Escape or click
  outside to finish. One edit session is one undo step. The Source Text and
  Style controls now match the rest of the panel.
- After a sequence frame rate change, the notice offers **Undo**, **Just this
  project**, and **Make 60 fps default**, which also sets the default frame
  rate for new projects.
- Shape+ Text names variable font axes in full, for example "Weight (wght)",
  and lists them directly below **Style**. A static font shows "Static font:
  no variable axes" on its row.
- Shape+ is faster: fills triangulate up to about 10 times faster, the Shape
  Editor skips distant curves when it looks for what is under the pointer, and
  a Text Animator without a Wiggly Selector no longer rebuilds its text every
  frame. Animated shapes reuse their GPU buffers instead of recreating them.
  On large paths the Shape Editor evaluates the scene once per pointer event
  and writes only the changed path values while dragging, so hovering,
  selecting, and dragging points respond several times faster. Output is
  unchanged.
- Graph Editor 2 works with a mouse and a trackpad. The mouse wheel zooms
  time around the pointer. Two-finger scroll pans. Pinch or Ctrl+wheel
  zooms both axes. Middle-drag or Space-drag pans. The **?** button lists
  every gesture.
- Graph Editor 2 Bezier handles are easier to grab, and short handles stay
  visible. Alt breaks or rejoins a tangent, even mid-drag. Shift snaps to
  45°. Ctrl or Cmd snaps to flat or the neighbour's slope. Double-click
  resets a handle. Dragging a preset easing's handle turns it into Bezier.
- Graph Editor 2 groups its toolbar by purpose and fits it on one row in
  wide windows. Buttons that cannot apply are disabled, and the status bar
  shows what is under the pointer. Axes use the viewport gizmo's red,
  green, and blue. Dragging values with several axes selected moves each
  axis by the same amount.
- Smart Motion Blur with Optical Flow skips redundant GPU passes (about
  6–12% less GPU time at 1/8 quality). The output is unchanged.
- Shape+ boolean, offset, and stroke operations run faster (boolean
  intersection about twice as fast). The generated shapes are unchanged.
- Existing projects, new look: effects that read other frames no longer
  darken soft or semi-transparent input (particles, text edges, faded
  layers). This affects Echo, CC Wide Time, Time Difference, Time
  Displacement, Smart Motion Blur with Optical Flow, Echo (Legacy), VHS,
  and Datamosh. Opaque footage renders the same.
- Existing projects, new look: Trapcode Particular now applies Velocity
  distribution, Aspect ratio, Opacity random, Color random, Air density,
  Drift X/Y/Z, Disperse strength over (life) with its curve, and Turbulence
  field affect size and opacity. These controls had no effect before.
  Projects that keep their default values render the same.
- Trapcode Particular hides controls that have no effect: Particle type,
  Set color, the flocking controls, the light/layer/model/text emitter
  types, and the velocity/position modes of Disperse strength over.
  Saved values are kept. Bounce height is now named Bounce boost.
- Existing projects, new look: Smart Motion Blur at Automatic now uses
  Shutter Samples on a 3D Scene layer and Optical Flow elsewhere. Projects
  without a stored Reconstruction value use Automatic. To keep flow-based
  blur on a 3D Scene, select Optical Flow.
- Existing projects, new look: Trapcode Particular and Form shading now
  applies ambient and hemisphere light at half intensity once instead of
  twice, so lit particles render brighter.
- Existing projects, new look: Drop Shadow now renders stored zero values
  instead of replacing them with defaults.
- Timing: changing the sequence frame rate keeps clip and animation timing
  in seconds, with Undo and Redo and a notice for fractional positions.
- Preview cache gains a session memory ceiling, GPU-failure handling, and
  live usage in Settings.
- Magic Looks gains an instance model, a setup window, narrow layouts,
  keyboard controls, and look preservation.
- Lower idle and export-preparation cost across expressions, constraints,
  Motion Paths, Native FX, and the project scanner.

### Fixed

- Hovering a key or handle in Graph Editor 2 no longer wraps the status bar
  to a second row, so the graph no longer shifts under the pointer.
- Time Offset on a video no longer shows black or unrelated frames when
  its offset jumps, for example with a `shake()` expression, and playback
  no longer jumps the playhead backwards.
- WebM clips show the correct frame at every frame boundary in preview and
  export. Before, a frame could show the previous one because WebM stores
  times in whole milliseconds. Exports of constant-frame-rate WebM clips can
  change by one source frame at those points. MP4 clips are unchanged.
- Graph Editor 2 curves stay sharp at extreme zoom. Undo after a key nudge or
  tangent change restores the exact values. Moving many keys no longer slows
  the graph, and deleted layers no longer leave curves behind.
- Voronoi Fracture builds several pieces at once and skips work that cannot
  change the result. The first fractured frame and Cells or Seed changes are
  ready about three to five times sooner, with the same output.
- Collect Files no longer creates a ZIP where a file and a folder share a name,
  which some extractors could not open.
- Deleting a scene while its Effectors are still preparing no longer keeps
  their fracture data in memory.
- Opening another project in the middle of a Shape Editor drag no longer adds
  that drag to the new project's undo history.
- Voronoi Fracture plays back smoothly again. Frames whose pieces are already
  built are computed right away instead of waiting in the background queue, so
  playback no longer stays on one held image.
- Fractured pieces follow Node Material graphs that rebuild their shader, and
  fractured Text+ Character Material text no longer keeps rebuilding its UVs.
  Fractured single-material meshes now use the same Material+ UV layout as the
  unbroken mesh.
- Material+ lays out UVs for deep extrusions much faster, with the same result.
- ExpressText+ Orbit and Spline give the same result on the first render of a
  frame as on later renders.
- ExpressText+ letters inside nested Groups move with the Group once, follow a
  Text moved to another Group, and keep the latest text when ExpressText+ is
  removed or turned off.
- ExpressText+ Formula and Shake count seconds at the sequence frame rate.
  Projects at 30 fps look the same; other rates change speed.
- Changing the sequence frame rate converts ExpressText+ frame delays, so
  staggers keep their length in seconds.
- Voronoi Fracture builds its pieces in the background. The preview keeps the
  last exact image and shows "Fracturing..." until the new frame is ready,
  instead of freezing the editor.
- Fragment scale 0 now shrinks every fully affected piece to nothing, even with
  Randomness. Projects that combine Fragment scale with Randomness change size.
- Fractured pieces keep each face's own material and follow later changes to
  the source material's shader values, textures, and colors.
- Overlapping fractured pieces draw in a fixed order, so the same frame looks
  the same every time. A few pixels on overlap edges can change.
- Leaving or reloading the page while a project is saving now asks first, and
  a "Saving..." notice stays until the save finishes. If a save into a newly
  chosen file fails, the message says the file may now be empty.
- Opening an empty project file explains that a save was probably interrupted
  and points to the Restore points panel.
- Effector preview frames now always show the exact result for that frame, the
  same as export. Playback may slow on heavy fractures instead of showing an
  earlier frame or the unbroken object.
- Voronoi Fracture accepts larger meshes and cap outlines, so bevelled 3D text
  breaks with closed pieces instead of falling back.
- Voronoi Fracture keeps the source material's face sides for closed pieces,
  so resting pieces shade like the unbroken object.
- Text+ characters use their Material+ texture layout from the first frame,
  so textures no longer change after a later update.
- Playback no longer stops the preview with "offset is out of bounds" when an
  Effector with Voronoi Fracture alternates with simpler frames.
- Image textures and Image layers keep more detail. An image whose sides are
  not a power of two now uploads at the nearest power of two with smooth
  resampling, so a 1920-pixel image uses 2048 pixels instead of 1024.
- Redo after undoing an added property group with nested groups no longer
  raises an error.
- Shape+ Offset Paths now works on open paths. It outlines the path on both
  sides. Before, a stroke after it drew nothing.
- The preview cache no longer stops preparing video frames at some frames of
  29.97 fps clips.
- While paused, the preview cache also prepares up to 30 frames ahead and 4
  behind in projects with visible video, using the same exact decoding. Any
  input stops this work at once.
- The preview cache now stores the paused frame in projects with visible
  video. After the editor is idle for a moment, Zoidium decodes that frame
  exactly and caches it. Frames during playback are still drawn live.
  Settings now says when video frames are not cached.
- The preview cache now releases the private copies it uses to prepare
  frames, instead of keeping them in memory.
- Smart Motion Blur on an Adjustment layer with nothing opaque below it now
  blurs. Before, Optical Flow (also used by Automatic on Adjustment layers)
  treated every frame as a scene cut and returned the sharp image. Other
  effects that read other frames on such Adjustment layers now see the same
  opaque black background as the current frame.
- The preview cache keeps working when an unused, disabled plugin failed to
  download, and pre-renders frames in projects with video when no video is
  near those frames.
- Trapcode Particular no longer jumps particles when an animated Air
  resistance reaches 0 while Air density is not 1.
- The preview cache works again for projects that use Native FX, Text+,
  Effector, Trapcode, Optical Flares, or the CCFX pack. Its approval list
  had fallen behind the plugin versions, so these projects were never
  cached. Every approved plugin passed a byte-for-byte check of cached
  frames against live renders.
- Settings shows why the preview cache is not storing frames ("Not caching:"
  followed by the reason). The memory warning no longer mentions only Macs.
- Smart Motion Blur with Shutter Samples no longer darkens soft or
  semi-transparent content such as particles. The sample capture applied
  alpha twice. Opaque content, Optical Flow, and other effects are
  unchanged.
- Material panels no longer go blank with the Zoidium gradient editor. Adding
  a PBR+ material while its panel was open could stop the material from
  loading, which left the header as "undefined" and the values empty. A
  failing custom control now falls back to the standard control instead of
  stopping the panel.
- UV Custom Material keeps **Wrap** set to **none** when a saved project
  is opened again. Before, the texture tiled after reopening.
- Detached temporal effects are skipped safely, and datamosh export cuts
  stay aligned, including clean cut-only exports with no cuts.
- Frame capture encodes JPEG captures and recovers from frame export
  failures.
- Trapcode decoded audio stays available for live consumers, and decoded
  records survive a source reload.
- Shape+ layers stay safe during delete, preview, and cleanup; Shader+
  asynchronous loads and Material+ UV state recover after removal.
- Stale Shader+ font imports and detached Shape+ conversions are rejected
  or rolled back.
- Setup windows close when their project targets leave the live tree.
- Native effects are no longer retained after project replacement, and
  pending filter loads are cancelled.
- Queued encode requests can be cancelled before native encoding starts.
- Effector preparation recovers after object removal, late LUT imports are
  cleaned up with their project, and a failed startup cleans up the web
  stage.
- MP4 export cleanup failures are non-fatal.
- Smart Motion Blur skips fully transparent texels and candidates outside
  the displacement limit.
- Failed exports keep exact shutter clocks with procedural fallbacks, and
  the preview survives cancellation.
- Export context loss fails fast instead of producing corrupt frames.
- Camera+ restores registered track fields and reduces shared-camera
  search updates.

### Docs

- The user guides and reference pages are shorter and keep only what users
  need. Saving and plugin-manager internals moved to the Plugin development
  pages.
- New documentation site served alongside the editor, with a Japanese
  locale.
- Native FX reference: index, image filters, time, keying, generators,
  and transitions.
- Feature guides: Effector, curve editor, Optical Flares, shader packs,
  preview, lights, particles, GIF, and Graph Editor 2.
- Editor workflows and export guides (video options, frame capture,
  datamosh) in both locales.
- Developer references in Japanese, with Japanese links pointing at
  translated anchors.
- Shader authoring reference generated from the Shader+ property model.
- Task guides: precompose, repair assets, layer input, legacy effects,
  and heavy-project preview.
