# Changelog

## Unreleased (beta)

New and changed since the last stable release. Entries use plain user language:
each line describes one visible change.

### Added

- Delay has Spring damping and Spring cycles controls for much stronger overshoot.
  Their defaults keep existing projects unchanged.
- Plugin windows can open as separate browser windows, so you can move Graph
  Editor 2, the code editors, the Trapcode designers, and other tools to another
  monitor. Use Pop out in the window's title bar. Closing the separate window
  returns the tool to the editor.
- Shader+ has a Time sample property. A shader can read its input at up to four
  other times, in frames or seconds, with keyframes and expressions. Templates
  and docs show motion vectors and time jitter.
- A small dot on the Save button shows that the project has changes that are
  not saved to disk. It turns to the accent colour after 10 minutes, and the
  Save button's tooltip says how long. Automatic restore points do not count
  as saving. Choose the time or turn it off in the Restore panel.
- Shader+ has a "Velocity from a property" code template, and the docs explain
  how to pass another property's velocity to a shader. Expressions can use
  `thisComp.frameDuration`.
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
  other frames, and project records that survive a missing package. Not yet
  for general use.

### Changed

- Undoing a change to the number of lights no longer recompiles shaders the
  scene already used, so going back and forth between light setups does not
  freeze the editor. The first time a new light setup is drawn still compiles.
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

- Replacing a project now releases more of the old project. Text+ projects, Material+
  graphs and workers, Optical Flares objects, shader passes, and composition clips
  no longer stay in memory for the session.
- Rebuilding the property panel, deleting a Particular designer, and deleting media
  no longer keep their old panels, rows, and thumbnails alive. Rebuilding the panel
  used to add 495 listeners each time.
- Deleting audio clips no longer leaves active decoders behind.
- Switching between compositions no longer multiplies keyframes on sequence
  properties, which could grow a saved project to several megabytes.
- ExpressText+ section header rows no longer have fields. Clicking those blank
  fields used to write NaN and off into the section's first rows. Damaged values
  are repaired when a project loads. Turn the section back on if needed.
- Voronoi's off switch in ExpressText+ now works. Letters with Voronoi off render
  whole in existing projects.
- Delay is much faster: playback with 24 history frames and two Text objects fell
  from 157 ms to 17.5 ms per frame. History frames now go up to 120.
- Video with alpha now keeps it on Video layers and on Video materials with
  Transparency on. It used to render over opaque black. Existing projects using
  such clips will look different.
- A video or audio file that cannot be decoded no longer leaves a tile stuck on
  Loading. It shows a warning and keeps a named entry, and importing it again
  warns again. The Video material file picker checks the file too.
- Turning on a keyframe stopwatch scrolls the keyframe panel to the new row.
- Particular Transform (rotation, scale, offset) now moves the particle cloud, and
  Spherical field Scale X, Y, Z now stretch the field. These values were ignored,
  so existing projects that set them will look different.
- Timecode with Time Source set to Composition now counts from the sequence start.
  Clips that do not start at frame 0 will show a different time.
- Controls that had no effect are hidden or removed from new effects: Particular
  Particle Random seed and five rows in shader effects. Saved values still load.
- Reference pages now state what several controls actually do.
- New and Open no longer rebuild a restore point when the project has not
  changed, and they no longer wait for another tab. A progress message appears
  for slow operations, and a repeated click says the operation is already
  running.
- Restore points made automatically before New and Open now follow the same
  limits as other automatic points, so they no longer fill browser storage.
  Backup now points stay until you delete them.
- Editing no longer stalls while the preview cache checks a captured frame: the
  longest stall in a 20-minute session fell from 400 ms to 186 ms.
- Repeated exports no longer use up graphics contexts. The preview used to be
  lost at the 16th export in a session.
- Undo, redo, New, Open, and Restore are refused during an export, with a
  message. Undo or redo during an export could write a corrupt file.
- Cancelling an export during audio no longer makes the next export fail.
- Time effects now reach video inside a pre-comp. Time Offset and Posterize Time
  on a pre-comp clip or an Adjustment above it now move that video, and samplers
  such as Echo, Time Displacement, and Smart Motion Blur read the correct frame.
  Existing projects with these setups will look different, and preview and
  export now match.
- A time effect running past a trimmed video's end holds its last frame instead
  of showing the frame after the out point. Later effects on a clamped video
  can read a clock up to one frame earlier.
- Asking for a video's last frame twice no longer fails.
- An expression with no usable number now shows a message instead of silently
  giving 0.
- Replacing a project now releases the previous project's media files. They
  used to stay in memory or browser storage until the tab closed, so reopening
  a project with large media kept adding to that use.
- Long Shape+ text and very complex Shape+ paths now draw their fill at Full
  quality. Fills that were skipped at the old limit now appear.
- Form and Particular particles with Add blending and low opacity now show in
  the camera view over an empty scene. Soft Add particles over an empty scene
  can look stronger than before in existing projects.
- Particular's Screen and Multiply blend modes now take effect. Existing
  projects that chose them rendered them as Normal and will now look different.
  Over an empty scene, Multiply draws dark particles.
- Editing text with a Material+ UV layout freezes for less than half as long.
- Deleting or copying a group together with its selected child now works.
  Before, Delete raised an error and could not be undone, and Copy repeated the
  child.
- Undoing a deleted Particular or Form keeps its texture in the project, so a
  later save does not lose it.
- Disabling a plugin after opening another project now works and no longer
  blocks enabling it again. The Text+ switch is no longer locked by text from a
  project that is closed.
- Copies made with an Alt-drag no longer store an internal render counter in the
  project.
- Preview caching no longer keeps old copies of a 3D scene in memory while you
  edit. A scene with eight lights and 64 spheres used to add about 35 MB each
  time its background preview was replaced.
- Deleting a clip that holds a 3D scene no longer keeps that scene in memory.
- Preview cache checks are about ten times faster on large 3D scenes, because
  they read saved project data only. Cached frames are unchanged.
- The Save dot stays on when you edit while the file is being written, and it
  appears when you rename a saved project. Undoing back to the saved state or
  restoring the saved name clears it.
- Graph Editor 2 no longer throws an error when a drag ends because the window
  lost focus or the panel closed. The drag stays one undo step.
- Shape+ now shows a notice when a fill exceeds its geometry limit and cannot be
  drawn, for example long text at Full quality. Before, the fill was missing
  without explanation.
- Exact decoding works for video whose stream starts later than 0, such as a 5
  second start time. Before, it failed with a seek error.
- Opening projects one after another in the same session no longer keeps the
  previous projects in memory, which used to add about 13 MB of heap and 4 MB of
  textures per open. Hidden Restore rows no longer build up either.
- Resizing the sequence after deleting the active camera no longer throws an
  error.
- Deleting 3D objects and lights no longer keeps large amounts of memory. Undo
  history used to hold each deleted object's full geometry, about 13 MB for a
  dense sphere, and each deleted light kept its shadow map on the GPU. Undo and
  redo restore the same result.
- Dragging an object onto the top or bottom edge of a group next to it now puts
  it in the group. Before, that drop left the order unchanged, so nothing
  happened. Drops that really change the order work as before.
- 3D and native Text in an opened project appear on the first frame, also when
  they sit on tracks outside the visible timeline or start later. Before, they
  could stay missing until the next redraw.
- The clip menu of an audio clip names its source type as Audio instead of
  "type undefined".
- Expressions that read the `velocity` or `speed` of another layer's vector
  property (for example `thisComp.layer("Ball").property("Position").velocity`)
  return the real per-second value. They returned `[0, 0]` or `0` before, so
  projects that use them render differently. Scalar properties are unchanged.
- Custom properties can be renamed again from their right-click menu
  (**Rename…**). The Zoidium menus had replaced the native right-click rename.
- Graph Editor 2 draws fast expressions (for example `shake()`) as a clean band
  when zoomed out, after Fit (`\`) and when it opens, instead of a blurry
  streak of dashes.
- Projects saved by Clipmaker 2 open again. They failed with "The project
  data is missing from the archive".
- Projects that use the Glitch effect no longer stop rendering with an
  error.
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
