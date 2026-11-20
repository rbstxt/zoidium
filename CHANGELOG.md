# Changelog

## Unreleased (beta)

New and changed since the last stable release. Entries use plain user language:
each line describes one visible change.

### Added

- ExpressText+ has a Letters setting. Per text treats each text under the
  container as its own set of letters, the same as giving each text its own
  copy of the container with the same settings; Across texts numbers letters
  continuously across every text, as before. New containers start on Per text.
  Existing projects open on Across texts and look the same.
- A 3D Text row has Split into letters, which replaces the text with a group of
  one Text per letter in the same places. Position, rotation, and scale
  keyframes and expressions move to the group. One undo restores the original.
- Each effect has an eye button in its header that turns the effect off
  without deleting it. A turned-off effect does nothing in preview or export,
  including time effects, effect groups (and everything inside them), and
  effects read by Layer Input. Its settings, keyframes, and Enabled value stay
  as they are. The state is saved with the project and can be undone. Existing
  projects load with every effect on.
- Click the current time at the top left of the timeline to type a frame number
  or a timecode, then press Enter to jump there. Escape cancels. The value can be
  typed in any of the three time formats that right-click cycles through.
- Smart Motion Blur now has a keyframeable Enabled switch so you can turn
  it off without removing the effect. Existing projects load with it on.
- Ctrl/Cmd+V pastes images, video, and audio from the clipboard into Project
  media; with the timeline focused, the clip is placed at the playhead.
- Native FX has a Time Remap effect for adjustment layers and clips. Speed
  mode retimes with a keyframeable Speed (%) — 0 holds a frame and negative
  values play backwards. Remap mode sets the Source time directly, so a static
  value freezes a frame and Easing+ curves give speed ramps. Frame mix blends
  the two nearest source frames when the time falls between them.
- Two contributed effects, both Zoidium only: ZSMB (beta 1.0), an optical-flow
  motion blur with Full and 1/2 quality, Blur Amount, Motion Sensitivity, and
  Previous or Next frame tracking; and S_Glow (beta 1.0), a glow with
  customizable spread, blend modes, expanded borders, and atmosphere.
  Enable them in the Plugins panel.
- Easing+ can copy and paste a curve: Copy and Paste in the curve window, or
  Ctrl/Cmd+C and Ctrl/Cmd+V while the window has focus. Paste accepts
  `cubic-bezier(x1, y1, x2, y2)`, four plain numbers, or a JSON array.
- Shader+ custom properties have Rename when: rules that show another name for
  a property while a chosen property has a matching value, using the same
  conditions as Visible when. Only the label changes; values, keyframes, and
  the shader do not.
- Lights have a Cast shadows switch in their properties. Turning it off for a
  light that does not need shadows removes its shadow pass, which is the main
  cost of a shadowed point light. Spot, point, directional, and the Trapcode
  Spot, Point, Infinite, and Sun lights start with it on; the Trapcode Area,
  Portal, and IES lights start with it off, so existing projects look the
  same. The switch cannot be keyframed.
- Scene and Adjustment layers can have masks drawn with the Mask pen (Q in
  the toolbar), with Add, Subtract, and Intersect modes, Feather, Opacity,
  Invert, and an animatable path. On an Adjustment layer, its effects apply
  only inside the mask. Masks are listed under Masks in the layer's
  Properties.
- Shader+ custom properties have a Path type that reads a layer mask or a
  Shape+ path: the shader gets its coverage, 256 points along it, its length,
  and the point count, so effects can follow a path.
- 3D objects (shapes, text, lights, particles, models, Particular, Form,
  Plexus, and other pack objects) have an Enabled switch that can be
  keyframed. A disabled object is not drawn, casts no shadow, gives no light,
  and skips its work, so heavy objects stop costing time while off. Cameras
  do not have it yet.
- A composition clip that contains a Scene has Edit 3D in comp in its menu:
  it opens the composition with the Scene selected and the 3D view on.
  Back from 3D edit in Comps returns to the previous composition.
- Shader properties: Slider, Seed, Angle, and Time sample have a Snap
  setting. Dragging, arrow keys, and typed values land on multiples of Snap,
  for example 0.00, 0.50, 1.00. Leave it blank to keep the current behavior.
- Shader properties: a property group has Visible when, under Group
  settings… on a grouped row's menu. A row shows only when its own condition
  and its group's condition both pass.
- Shader properties: Time sample has Minimum, Maximum, Step, and Decimals in
  its settings, and Slider, Seed, and Angle have Decimals.
- Shader properties has a Show hidden button (an eye) on its heading. It
  shows, dimmed, the properties that Visible when currently hides, so you can
  open their settings. A condition that can never match a Toggle or Dropdown
  shows a warning when applied, but is still saved.
- Device render has a Custom resolution with exact width and height, so you
  can export sizes such as 3440×1440 or 2560×1080. Export settings are now
  remembered between exports.
- Constraints has Follow: a group or object can copy the position, rotation,
  and scale of a group or object in another scene layer, with per-channel
  switches, offsets, and World or Local space.
- Shader+ custom properties have a reset button that returns them to their
  Default values, removing keys and expressions, as one undo step.
- The Shader properties "+" list has Group, which moves the selected
  properties into a new group.
- Visible when accepts comparisons such as `> 5.5`, `>= 1`, `!= 3`, and
  ranges such as `1..5`.
- A Toggle can display as a one-click checkbox.
- Custom properties can be organized into named, collapsible groups, using
  Group… on a property's menu. A group's Settings has its name and a Lock that
  stops its rows being dragged. 3D groups have a Lock button in the Objects
  panel. Grouping and locks only affect the panel, never the picture.
- Trapcode Form has particle rotation: Rotate X, Y, Z, Random rotation,
  Degrees/sec X, Y, Z, Random speed rotate, and Random speed distribution, in
  the panel and the Form Designer. Existing Forms look the same.
- ExpressText+ shows each effector's Field as a wire box in the 3D view while
  the text is selected. The box is not in the Preview cache or exports.
- ExpressText+ effectors can be reordered by dragging their rows.
- ExpressText+ Shake has a Mode: Sine, as before, or Noise.
- Player+ has a playback speed menu, from 0.25x to 2x, which follows J, K, and L.
- Expressions can read the project frame rate as `fps`, and shaders as
  `uniform float zFps;`.
- Graph Editor 2 zooms in much further: 200 times closer in time and 1000 times
  closer in value.
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

- ZSMB and S_Glow are now named beta 1.1, so bug reports can name the exact
  version. Effects saved under the old name are renamed when a project opens.
- Material+ Bump Noise Scale goes up to 1024. Values above 64 repeat a seamless
  noise tile at a higher frequency.
- Magic Looks Haze shades the haze spillage toward the frame edges instead of
  darkening the whole scene.
- The documentation is reorganized by topic (workflow and export, animation,
  2D and text, 3D scenes, effects, shaders) with fewer, longer pages. Old links
  redirect to the new pages.
- S_Glow: Atmosphere Amp is now half as strong for the same slider value,
  as the effect's author intended; it was twice too strong. Saved slider
  values do not change, so projects that use atmosphere look softer.
- Expressions+: Checkbox controls now return the numbers 1 and 0 to
  expressions, like After Effects, instead of the text "1" and "0".
  Expressions that compare with the text "1" or "0", or combine the value
  with text, may need updating.
- Existing projects, new look: ASCII now keeps its texture at the full
  render size instead of scaling non-power-of-two frames down. Existing
  ASCII renders look sharper at those sizes and no longer log repeated
  resize warnings.
- ZSMB's Quality setting is back with Full, 1/2, 1/4, and 1/8. It sets how
  finely motion is analysed and also applies to exports, so 1/2 exports render
  much faster than Full. The preview size still follows Player+; the analysis
  never exceeds what the preview frame holds.
- Existing projects, new look: a light whose Enabled switch is off no longer
  lights Trapcode Form and Particular particles.
- Projects that use Camera+, Layer Input, or Expressions+ can now use the
  Preview cache. Cached frames match a fresh render exactly. A project stays
  uncached when an expression may keep values between frames, for example by
  changing Math or an array it did not create; such expressions still render
  as before.
- Undo and redo now work across composition switches. Switching is an undo
  step, so a pre-compose can be undone after opening the composition. Parked
  compositions release their GPU memory and media.
- The reset button on a Shader effect's Properties keeps the shader code.
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

- Shape+ uses far less GPU memory in the preview. Each layer used to keep a
  full-frame supersampled image (about 127 MiB at 1080p and at 4K); now it keeps
  only the finished image, the cache is capped at 256 MiB, and one shared work
  image is reused. With 50 Shape+ layers at 4K this drops from about 6.3 GB to
  about 380 MiB, so large projects no longer exhaust integrated GPUs and turn
  the preview white. The preview looks exactly the same.
- Exports with many Shape+ layers use much less GPU memory: each layer's
  supersampled raster is freed as soon as it has been drawn into the frame.
  At 4K this saved about 380 MiB in a three-frame test, which lowers the chance
  of a lost WebGL context on integrated GPUs. Output pixels are unchanged.
- After the browser loses and restores the WebGL context (for example when a
  heavy export runs out of GPU memory), Shape+ layers draw again in the preview
  instead of staying blank. When an export stops because the context was lost,
  the message now suggests lowering the export resolution or closing other
  GPU-heavy tabs.
- S_Glow no longer darkens particles or other partly transparent content when
  it is on, even with glow Brightness 0.
- S_Glow with Affect Alpha 0 no longer leaves bright fringes at transparent
  edges, and Source Opacity then fades the whole result evenly.
- S_Glow on an adjustment layer with Source Opacity 0 shows only the glow; the
  original image no longer shows through underneath.
- Inside a precomp, changing a Scene layer's values can be undone and redone
  again, and the cursor no longer stays on the move icon after dragging a value.
- A 3D Scene taken out of a precomp now draws its contents right away instead of
  only after switching camera editing.
- Preview no longer stops when a Repeater clones a Geometry+ object whose
  geometry was released.
- Dragging keyframes no longer throws an error and leaves undo stuck when
  the same keyframe is selected in two places in the timeline. The drag
  moves each key once, and one undo restores every key.
- Dragging the playhead along the timeline ruler follows the pointer when
  the page is scrolled sideways or the interface is zoomed. Before, the
  playhead landed away from the pointer.
- Native particles and Trapcode Form, Particular, and Plexus keep the same
  particle size relative to the picture in every preview size, in
  fullscreen, at every preview quality, and in exports. Before, the size
  changed with the preview window, and only adding ZSMB happened to correct
  native particles. Particles in existing projects may look slightly
  different in the preview; they now match the export.
- A disabled S_Glow no longer changes how the rest of the scene renders.
  Before, particles and Form looked different until the effect was deleted.
- ZSMB blurs scenes whose camera comes from a Camera+ layer. Before, it
  passed those frames through unchanged.
- Shader+ custom property rows show their name once. A second copy of the
  name could appear behind the label after Rename when rules or group
  settings refreshed the row.
- Echo, Time Remap, Time Difference, Time Displacement, CC Wide Time, and
  Magic Looks now free their GPU memory when removed.
- Audio track mute and Shader+ Layer Input mode changes can now be undone
  and redone. Replacing multiple fonts in Resolve Fonts now undoes and
  redoes as one step, and undoing an Image or Texture node edit in Node
  Material restores both the graph and the Selected node image field.
- Undo and redo now keep working for layer masks after deleting and
  restoring their layer, and for items added in Trapcode Designer after
  deleting and restoring the parent object or reordering the list.
- Finishing an unfinished project-name edit after opening another project
  no longer renames the newly opened project.
- Native FX and OpenZoid Legacy dropdown and switch settings now take
  effect after selection, undo, or reopening a project. In Native FX, the
  fix covers Enabled and options on Color Difference Key, Advanced Spill
  Suppressor, Key Cleaner, and Linear Color Key, plus Enabled on Time
  Offset, Posterize Time, CC Page Turn, Radial Shadow, Card Wipe, Color
  Curves, Drop Shadow, and CC Pixel Polly. In OpenZoid Legacy, it covers
  Enabled on Posterize Time (Legacy), Jpeg Damage, and VHS, plus Enabled
  and options on ASCII and Tracery.
- Trapcode Form and Plexus dropdown and switch settings now take effect
  after selection, undo, or reopening a project: Trapcode Form (Base Form,
  Fluid Motion, Mirror On X, Y, and Z, Layer Maps, Audio React, Shading,
  and Blend Mode) and Plexus (object Enabled, Geometry type, Primitive,
  Color map by, and Renderer type). Applying the Plexus Terrain preset now
  reuses existing Points and Lines renderers instead of adding duplicates.
- Switches and dropdowns now take effect after selection, undo, or
  reopening a project in Optical Flares (Occlude, High Quality, Scale
  Offset, Scale With Distance, element Enabled, Solo, and Animate, plus
  window checkboxes and row toggles), Magic Looks (master Enabled and Tool
  chain toggles), and Camera+ (camera Enabled, Depth of Field, and
  motion-blur Track Frame). Disabled Shader+ effects no longer request
  Time sample frames.
- Material+ dropdown and switch settings now take effect when selected and
  after reopening a saved project: Transparency on Image+ and Node Material,
  Blending and Render side, and Node Material and PBR+ options such as Use
  node graph, Bump Noise, reflections, Color Ramp, Fresnel, Ambient
  Occlusion, cel shading, and shadow side. Switching a material's Node
  Editor control to open now opens the Node Editor window.
- Saved dropdown and switch settings now take effect after reopening a
  project in Camera+ (Active Camera, Vibrate switches, and sequence motion
  blur), light Cast shadows, export motion-blur shutter sampling, 3D object
  Enabled, S_Glow (Enabled, Time Mode, Expand Borders, and other options),
  Radial Blur (Spin) Enabled, and Shape+ (item Enabled, Text Animator
  options, Wiggly Selector, and closed or open path state while editing).
  Older Effector projects saved with low curve quality also keep
  low-polygon subdivision when opened.
- Shader+ Visible when (on properties and groups) and Rename when rules now
  match static dropdown properties by their option index, and the
  unreachable-condition warning recognizes those choices.
- Radial Blur (Spin) now restores normalized brightness when Overbright is
  turned off, and setting Overbright Weight to 0 with Overbright off no
  longer breaks the rendered image.
- Card Wipe no longer produces broken pixels when a rotating card passes
  through its perspective pole. Those pixels now render transparent.
- More input-method (IME) fixes across windows, menus, and pickers:
  composing keys no longer close shared windows or trigger context menus,
  panel tabs, list rows, picker group headings, the font picker, or Assets
  table navigation, and arrow keys now move through IME candidates in an
  empty picker. Composing Ctrl+Z, Ctrl+Y, and Ctrl+S in plugin windows,
  asset paste, 3D object copy or delete, and Graph Editor 2 shortcuts while
  composing or typing in a field no longer reach the editor.
- Input-method composition and typing in text fields no longer interrupt
  controls or active edits in Theme Editor (rename, color fields, and
  undo), Expressions+ control renames, Shape+ (Source Text, clipboard, and
  Space release), Shader+ angle dial, curve graphs, gradient and Node
  Editor ramp stops, Magic Looks controls, Motion Paths drags, Effector
  field editing, and Tracery point placement.
- Disabling Shader+ now closes any open angle dial, and disabling Assets
  now cancels pending save-problem notices so they do not appear after the
  plugin is turned off.
- Typing Japanese, Chinese, or Korean with an input method no longer
  triggers editor actions: Enter or Escape while composing text no longer
  confirms or closes dialogs, renames, numeric fields, or search, and
  shortcuts no longer fire while you type in a text field.
- A pre-composed selection whose media finish loading later now appears in
  the paused preview without reloading the project. Pre-compose also places
  the composition on a visible track when the top selected track is muted.
- Expressions+: a numeric expression that returns NaN, Infinity, or a
  non-number now uses the keyed value for that frame, as documented.
- GIF import: interlaced GIFs show their rows in the right order, slightly
  truncated GIFs import with the pixels they contain, and a malformed frame
  can no longer request gigabytes of memory.
- Scrubbing a paused preview from one video clip to another no longer waits
  for the first clip's seek, and background preview prefetch pauses while the
  tab is hidden.
- Layer masks drawn without the GPU sample fractional edges at pixel centres
  like the GPU path. Shader+ Path inputs ignore disabled masks, removing one
  Path property no longer breaks another that shares its coverage, and Path
  properties recover when the mask cache drops their texture.
- Optical Flares keeps the underlay's blending after a project reload, and
  the underlay no longer appears in auxiliary passes such as depth of field.
- Card Wipe keeps its random texture when the effect reloads, and Drop Shadow
  and CC Pixel Polly free all their resources when removed.
- Desktop: starting the app by opening a file no longer creates two windows,
  and opening a project while a save is in progress waits for the save.
- Trimming several selected clips together keeps every clip edge on a whole
  frame, also when a clip's media starts between frames.
- Dropping or pasting several files in quick succession gives each import its
  own undo step, and pasted media without a name get distinct names. A slow
  import is never cancelled; after a minute a notice says later drops will
  follow when it finishes.
- Changing a Layer Input source mode from a script now refreshes the cached
  preview frame.
- Opening another project after one with Plexus no longer logs cleanup errors
  or skips releasing the objects below Plexus.
- In the graph editor, arrow-key nudges and vertical value drags keep
  keyframes on fractional frames instead of rounding their time.
- When a Follow target is deleted, channels that were not set to copy keep
  their own animation instead of freezing.
- Geometry+ B-Spline works on open splines with three points, and round start
  caps on spline tubes are no longer twisted.
- Muted audio tracks inside a composition stay silent in Main.
- Assets with equal values in the sorted column are ordered by name.
- Constraints data is kept when a project is opened with Constraints disabled
  and comes back when the plugin is enabled.
- Node Effect keeps values you edited in the Effects panel when the graph's
  default changes; untouched values, including colours and vectors, still
  follow the new default.
- Easing+ Copy keeps the full precision of the curve.
- Particular secondary systems with continuous emission emit at their doubled
  density, like counted and burst emission already did.
- The Particles+ texture picker shows the right texture after undo.
- Echo Repeater updates when Count or Offset change through expressions on the
  same frame.
- Camera layers ignore cameras inside repeaters and use the next camera.
- ZSMB with Previous tracking blurs frames between 0 and 1, and removing ZSMB
  while its video is opening releases the video.
- Projects with ZSMB or other frame-sampling effects play much faster: the
  temporal input key is reused until the next edit instead of re-serializing
  the whole project on every frame.
- Dropping media files anywhere on the Media panel imports them, not only on
  a preset tile. Dropping on the timeline imports and places a clip at the drop
  position, and dropping on the preview places it at the playhead. Text fields
  keep their normal drop behaviour.
- ZSMB no longer overrides the player's Preview quality: preview size follows
  Player+, and ZSMB picks its analysis detail from it (exports always use full
  analysis). ZSMB's own Quality setting is gone.
- Dragging the edge of a clip that is part of a selection now trims every
  selected clip by the same number of frames, in one undo step.
- Clip edges are easier to grab: the trim handle is at least 8 pixels wide,
  and short clips keep their middle third for moving.
- The preview no longer keeps showing a Layer Input source after Layer Input
  clears it on its own, such as when a loaded project's source would form a
  circular reference.
- The play controls under the preview no longer shiver by a pixel while the
  playback toolbar keeps re-centering them.
- Playback does less work per frame in every project: the shader cache only
  scans the program list when three.js adds a program, and Constraints finds
  Follow links from its scene index instead of walking every object each
  frame.
- MP4 exports keep their brightness in After Effects, VLC, and other players
  that read only the H.264 stream. Some hardware encoders wrote full-range
  video tagged only in the MP4 box, so those players showed it darker with
  lost shadow detail. Exports are now limited-range BT.709 with the same
  colour tags in the box and the stream.
- Playback no longer sometimes jumps back to an earlier frame and repeats a
  section when a shape with a video material that has a Start offset begins
  playing.
- The playback toolbar under the preview no longer sometimes shows a
  horizontal scrollbar when it has room for every control.
- Turning a light off with its Enabled switch, or keyframing Enabled, no
  longer freezes playback while every lit material is rebuilt. The light
  stays in the scene with no output, so the first toggle costs about as much
  as an ordinary frame.
- Trapcode Particular no longer refreshes its material on every frame, and
  directional light shadows are recalculated only when the light changes.
- When the Trapcode Area light's sampled fallback is asked for shadows, only
  its centre sample casts one.
- MKV and WebM export no longer fails with "The rendered video could not be
  read back from the browser's temporary file" when the encoder finishes
  writing the file a moment after handing it over. The read is retried from a
  fresh copy of the file.
- MP4 export no longer reports success for a movie that was copied
  incompletely or as an empty file. When a read-back fails, the message now
  says whether the temporary file was changed or locked by another program
  (for example antivirus or a disk indexer) or was removed.
- The Bitrate choice in the render options is kept while the page stays open,
  instead of returning to 1x each time the export dialog opens.
- The debug log now records each export's start, finish, and failure with the
  error and its causes, keeps startup restore-point checks from pushing out
  other entries, and names the scripts behind a freeze of a second or more.
- MP4 export no longer ends with "MP4 export failed. Failed to fetch" when the
  browser briefly cannot read back the finished movie from temporary storage.
  It tries again, and if that still fails it downloads the temporary file
  directly. When the file really is unreadable, the message says so and
  suggests freeing disk space or using MKV/WebM.
- The Bitrate choices in the render options now show the video bitrate each
  one targets at the current size and frame rate, for example "8x: 72 Mbps
  target" at 1080p30, so the highest setting is visible.
- A property whose keyframe list is empty, such as Markers after deleting the
  last marker, no longer stops the preview with "Cannot read properties of
  undefined (reading 'frame')" when something reads it.
- A video file without sound no longer adds an empty audio clip when it is
  placed on the timeline, and MP4 export no longer fails with "MP4 could not
  decode an audio asset" because of such a clip. Projects saved with one
  export as video-only.
- Phone and screen recordings with a variable frame rate now show the right
  frame when the preview or export lands exactly on a frame boundary. Before,
  such videos could repeat one frame and skip the next.
- Projects with many expressions play faster: each expression evaluation
  takes less than half the time it did and leaves far less memory to clean
  up, so playback stalls less often.
- ExpressText+ with a Delay effector no longer slows down as playback moves
  toward the end of the timeline. Each frame now costs about the same at the
  start and at the end, also with several ExpressText+ objects in one scene.
- Projects with many 3D Text objects play faster: Text+ and ExpressText+ no
  longer add work to Text objects that are not inside a Text+ or ExpressText+
  object.
- Playback no longer freezes or crawls at about 1 fps after you switch to
  another window or tab while the preview plays. When the browser pauses a
  video or audio clip in the background, playback keeps its pace and the clip
  resumes in sync.
- The preview no longer stops with "Maximum call stack size exceeded" in
  projects with a camera inside a group on a 3D track (for example after
  copying a Camera+ camera into a group), and such projects export again.
- Selecting a Scene or Adjustment layer no longer turns drags in the preview
  into a mask selection box: the editing camera orbits again, and T shows the
  transform controls again. Mask editing now starts only with the Mask pen
  (Q): press Q to draw, again to edit points, and again to stop. M toggles
  markers as before.
- An export that fails because of a program error no longer says that MP4
  ran out of memory or temporary storage.
- Shape+ SVG import accepts files from Inkscape, Illustrator, Figma, and
  Scratch that include comments, editor metadata, titles, or an empty defs
  section. These parts are ignored; the imported shapes are unchanged.
- While paused, scrubbing or stepping through a video layer no longer shows
  the previous video frame for a moment before the requested one.
- During playback, layers with a Time sample or another effect that reads
  other times update steadily instead of stopping on one frame while the next
  is prepared. Paused frames and exports are unchanged.
- Exports and scrubbing of H.264 MP4 video show the intended source frame.
  At frame boundaries they often showed the previous frame, so exports
  repeated and skipped frames. Exports of affected projects change: each
  output frame now uses the correct video frame.
- Alt-dragging a Scene or Camera clip, or a layer with Track To or Follow,
  makes a working duplicate. It was left as a ghost that could not be
  selected, and duplicates no longer save unused constraint settings.
- Shader+: the Toggle checkbox follows the theme colors instead of a white
  box.
- The play button is back at the center of the playback toolbar on wide
  panels. The quality and speed menus stay at the right edge.
- Shader+: settings of one custom property, such as Visible when or its
  group, no longer spread to other properties or to Numbers added later,
  including in a new Shader. Grouping a property from the "+" list no longer
  makes the group disappear.
- Timeline: after deleting a track with linked video or audio clips, the
  remaining clips can be selected and dragged again, and lasso boxes no longer
  stay on screen. Undo restores the clips and their links. Projects saved in
  this state are repaired when opened.
- After Pre-compose selection, or after switching compositions, clips that no
  longer existed stayed selected. Their panels could not add objects or set
  keys, and a failed add made Ctrl+Z do nothing. The selection now clears.
- Group… with several custom properties selected now puts all of them in the
  group, as one undo step.
- With ExpressText+ on, Shader+ slider, seed, and angle rows repeated their
  slider or button thousands of times, which made selecting a shader slow.
  Each row now has one control again.
- Audio waveforms were blank for 44.1 kHz audio. They now draw.
- Waveforms of long files slowly drifted from the sound, by over a second at
  five minutes. WAV peaks now land on the exact point and MP3 peaks within
  10 ms. Two timeline windows no longer stop each other's waveform.
- Graph Editor 2 grid lines did not line up with the frame ruler or their value
  labels. They now share the same steps.
- A clip's Time expression could fail as if it referred to itself. It now
  evaluates, so projects with a Time expression can look different.
- Shader+ Property settings called a plain number a Toggle, hid Minimum and
  Maximum, and Apply could turn it into a toggle. Numbers now show Slider
  settings, and Apply with no change does nothing.
- ExpressText+ Letters and Formula Expression fields were hidden between
  keyframes. They can now be edited on any frame.
- Delay's tooltip and docs explain that Plain and Random need animated values
  for Delay to show.
- Nested effectors with Delay render about 28% faster in a test scene. The
  picture is unchanged.
- Pasting into another project lost embedded files, such as a material's image.
  The files now come along.
- Undo restored the wrong value after edits between keyframes in Magic Looks,
  Optical Flares, and the Trapcode designers, and a Trapcode preset on animated
  values could hang. Closing Optical Flares options mid-drag now records the
  edit, and Command+Z and Shift+Z work in plugin windows.
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

- Time Offset on a plain layer also retimes the effects after it. The
  reference now says so.
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
