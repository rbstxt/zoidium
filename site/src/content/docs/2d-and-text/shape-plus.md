---
title: Shape+ and layer masks
description: Build animated vector layers, draw and edit paths and layer masks on Scene and Adjustment clips, and animate 2D vector text with Shape+.
---
Use **Shape+** (enabled by default) to build vector shape layers with editable paths and modifiers, draw and animate layer masks on **Scene** and **Adjustment** clips, and lay out or animate 2D vector text.
Shape+ coordinates use composition pixels centered at `(0, 0)` with positive Y upward. Native layer transforms apply to the rendered layer.

## Create a vector shape layer

1. Drag the **Shape+** Media preset onto the timeline and select the clip.
2. Open **Objects**, then click **+** on **Contents**.
3. Choose **Rectangle**, **Ellipse**, **Polystar**, or **Path**, and edit its properties.
4. Click a **Path** item in **Contents** (or click its outline in the preview) to edit vertices and Bezier handles with the Selection (`V`) or Pen (`Q` or `P`) tool.
5. To animate a path, enable its path animation stopwatch (`⏱`) or click its keyframe diamond, move the playhead, and reshape the path at the new frame.

You can also create a Shape+ layer straight from the preview. With no compatible clip selected, press `Q` (or `P`) and click in the preview. Zoidium creates a new **Shape+** clip on a new video track at the playhead with your first path, a default fill, a `2` px stroke, and the default `180`-frame duration in one **Undo** step.

A paint item (**Fill**, **Stroke**, **Gradient Fill**, **Gradient Stroke**) paints every enabled path above it in the same group (including paths inside earlier nested groups). Modifiers act on earlier paths in their scope.
Drag items in **Contents** to reorder or group them, and click an item's eye button to hide it.
Every item has an **Enabled** choice (default **on**). Numbers, vectors, colors, and gradients can be animated. Choice dropdowns stay static.

## Mask a Scene or Adjustment layer

1. Select a **Scene** or **Adjustment** clip on the timeline. If the preview shows a 3D perspective camera, press `C` to switch to the composited view.
2. Press `Q` (or `P`), or click the **Mask pen (q)** toolbar button, to arm the Pen tool. Pressing `Q` alone creates nothing.
3. Click in the preview to place mask vertices. Click the first vertex to close the mask, or press `Escape` or `V` to stop drawing. You do not need to press `Enter`.
4. To edit an existing mask, click its name in **Properties** under **Masks**, click **Edit**, or click its outline in the preview.
5. Adjust combine mode, **Feather**, **Opacity**, **Expansion**, keyframes, lock state, and combine order in the mask row under **Masks**.

Masks multiply layer alpha by their coverage after all effects run. On a **Scene** layer they cut the layer to transparent, and on an **Adjustment** layer they limit the effects to the masked region. An open path closes for coverage and stays open for shader sampling. Masks save with the layer without altering older projects.

### Mask row controls

Each mask appears as an expandable row under **Masks** in **Properties** (expanded by default). Click `▾` or `▸` to collapse or expand its settings, and click **+ Add mask** at the bottom of the list to add a new mask.

| Control | Range or options | Default | Behavior |
| --- | --- | --- | --- |
| Enable (`●` or `○`) | On or off | On | Includes or excludes the mask from layer coverage. |
| Mask name | Click or `Shift`-click | `Mask 1`, `Mask 2`, ... | Click to activate the mask in the preview. `Shift`-click to select multiple masks. The active mask shows `●`. |
| Combine mode | **Add**, **Subtract**, **Intersect** | **Add** | Combines masks from top to bottom in list order. |
| **INV** | On or off | Off | Inverts the mask coverage. |
| Keyframe diamond | `◇`, `◈`, `◆` | Off (`◇`) | Hollow means animation is off. Outlined (`◈`) means animation is on with no key at the playhead. Filled (`◆`) means a key exists at the playhead. Click to enable animation or add and remove a key. |
| Stopwatch (`⏱`) | On or off | Off | Turns path animation on or off. Turning it off keeps the sampled shape at the playhead. |
| **Edit** | Button | — | Selects the mask and focuses point editing in the preview. |
| Delete (`×`) | Button | — | Deletes the mask. |
| Previous (`‹`) and Next (`›`) | Buttons | — | Jumps the playhead to the previous or next path keyframe in project time. |
| **Feather** | `0` to `500` px | `0` | Softens the mask edge in pixels. |
| **Opacity** | `0` to `100`% | `100`% | Scales mask alpha (`0` to `1` in saved data). |
| **Expansion** | `-128` to `128` px | `0` | Expands (positive) or contracts (negative) coverage in layer pixels before feather, opacity, invert, and combination. At `0`, rendering uses the original path unchanged. Out-of-range values are rejected visibly rather than clamped. |
| **Outline color** | `#rrggbb` | Palette starting at `#58a6ff` | Sets the preview outline color for this mask. |
| **Name** | Text | `Mask 1`, ... | Renames the mask in place without changing its internal ID or references. |
| Lock (`🔓` or `🔒`) | On or off | Unlocked | Blocks geometry, topology, keyframe, property, and delete changes. You can still select, unlock, and reorder a locked mask. |
| **Duplicate** | Button | — | Creates a copy after the original with fresh mask and vertex IDs, keeping geometry, keyframes, properties, and combine mode. |
| Move up (`▲`) and Move down (`▼`) | Buttons | — | Changes combine order. Works on locked masks too. |

### Edit multiple masks together

- `Shift`-click mask names in **Properties** under **Masks** to select more than one mask on the same layer.
- One mask stays active (marked with `●`) for Pen drawing and timeline focus.
- In Selection mode (`V`), moving, scaling, or rotating transforms the stored vertex selections across every selected unlocked mask in one **Undo** step. Pressing `Escape` cancels the drag across all of them.
- Locked masks in the selection keep their geometry, keyframes, and settings untouched.
- Clicking **Move up** (`▲`) or **Move down** (`▼`) moves all selected masks one step in combine order while preserving their relative order.
- Active path and multi-mask selections survive panel switches and clear when the project closes.

## Draw and edit paths in the preview

Masks and Shape+ paths share one preview editor. Switching between `Q` and `V` or switching panels keeps your active path and vertex selection.

### Pen tool (`Q` or `P`)

Press `Q` (or `P`) to arm the Pen tool. `Q` always selects Pen and never cycles modes. Pressing `Q` alone changes nothing until you click the canvas.

What the first canvas click creates depends on your timeline selection:

- **Selected Scene or Adjustment clip:** starts a new mask on that layer.
- **Selected Shape+ clip:** continues the active open path, or starts a new path inside the selected or enclosing group.
- **No clip, multiple clips, or another layer type:** creates a new **Shape+** clip on a new video track at the playhead with its first path, a fill, and a `2` px stroke in one **Undo** step.

While drawing with Pen:

- Click empty space to add a corner vertex. Drag to pull symmetric Bezier handles.
- Hold `Shift` while placing a vertex or dragging a handle to constrain the angle to 45° steps.
- Hold `Alt` (`Option` on macOS) while dragging a new handle to break the outgoing handle independently.
- Click the first vertex of an open path to close it. You do not need to press `Enter`, though `Enter` still works as an optional way to finish drawing.
- Click an open path's endpoint to continue drawing from that end. Continuing from the first vertex of an idle open path reverses the path first.
- Click an existing vertex to delete it, or click a path segment to insert a vertex.
- Hold `Ctrl` (`Cmd` on macOS) to switch to Selection (`V`) temporarily. Release the key to return to Pen without ending your path.

### Pen cursors, markers, and display settings

In Pen mode, hover feedback follows a fixed priority order:

1. **Close endpoint** (`o` badge, enlarged ring): hovering the first vertex of an open path with at least two vertices while drawing.
2. **Continue endpoint** (`/` badge, enlarged ring): hovering an open path endpoint to resume drawing.
3. **Delete vertex** (`-` badge, red vertex highlight): hovering an existing vertex.
4. **Add vertex** (`+` badge, highlighted curve segment): hovering a curve segment.
5. **Start or append** (crosshair, no badge): hovering empty space.

Hovering a locked path with Pen shows a not-allowed cursor.

Path overlays encode state by shape first, with color as reinforcement:

- **First vertex:** double ring (filled when selected).
- **Selected vertex:** filled square.
- **Unselected vertex:** hollow square.
- **Bezier handle:** circle (filled when selected).
- **Open-path direction:** subtle chevron arrow near the end of the last segment.

To resize markers, right-click the preview overlay and choose **Path Display Settings…**. Set **Vertex size (px)** (default `8` px) and **Handle size (px)** (default `6` px) anywhere from `2` to `32` px. These sizes save in local browser storage and do not change the fixed `9` CSS px pick radius.

### Selection (`V`), outlines, and overlap cycling

Press `V` (or click **Shape+ selection (v)**) to edit vertices and handles. When no path is active, `V` yields to native layer selection and transforms.

- **Click a path to activate it:** click a mask name in **Properties**, click a **Path** in **Objects**, or click any visible outline in the preview. Clicking a mask name selects its clip and moves the playhead to clip start if needed.
- **Cycle overlapping paths:** picking uses a fixed `9` CSS px radius regardless of zoom, resolving ties in order: handle, anchor, segment, then frontmost path in draw order. Click repeatedly at the same spot (within `9` px) to cycle through overlapping paths from front to back, including the active path. Moving outside `9` px, changing frames, leaving the preview, or selecting from a panel resets the cycle.
- **Select vertices:** click a vertex to select it, or `Shift`-click to toggle it. Press `Ctrl+A` (`Cmd+A` on macOS) to select all vertices of the active path.
- **Marquee selection:** drag in empty space while a path is active to draw a marquee. A plain marquee replaces the selection. A `Shift`-marquee toggles vertices inside the rectangle against the selection captured at drag start.
- **Break or convert handles:** hold `Alt` (`Option` on macOS) and click an anchor to toggle between Corner and Smooth (double-clicking in `V` also toggles Corner and Smooth). Hold `Alt` while dragging a handle to break linked handles and move that handle independently. Right-click a path for **Corner Points**, **Smooth Points**, **Symmetric Points**, **Independent Points**, **Open Path** or **Close Path**, and **Reverse Path Direction**.
- **Nudge vertices:** press arrow keys to move selected vertices by `1` px, or hold `Shift` for `10` px, in one **Undo** step.

### Free transform, segment drag, and snapping

- **Free transform:** select two or more vertices on an unlocked active path (or across selected unlocked masks) in `V` to show a screen-space bounding box. Drag inside the box to move, drag a corner handle to scale, or drag the rotation handle to rotate. Both vertices and their Bezier handles transform around the selection bounds center and map back through nested group and layer transforms. Hold `Shift` to constrain moves to 45° steps, scale uniformly, or rotate in 15° steps.
- **Segment drag:** in `V`, drag directly on a curve segment to move both of its endpoints together while keeping their handle vectors intact.
- **Snapping:** moving or placing points snaps within `9` CSS px in priority order: unselected vertices first (including vertices on locked paths), then visible composition-frame edges, then horizontal and vertical axes through the gesture origin. `Shift` constraints apply before snapping. A dashed guide appears while snapped.

### Set First Vertex

Right-click an anchor or handle in the preview and choose **Set First Vertex**.

- On a closed path, Zoidium rotates the vertex order and all six-channel keyframe blocks so that vertex becomes the first vertex without changing the curve shape.
- On an open path, only the other endpoint can become first. Choosing it reverses the vertex order and swaps incoming and outgoing handles. Interior vertices are refused.
- Locked paths disable **Set First Vertex**.

### Pan, zoom, and perspective view

- **Pan and zoom:** hold `Space` and drag in the preview overlay to pan the composited view. Releasing `Space` or losing window focus restores your previous tool without disturbing an active Pen path. Scroll the mouse wheel over the overlay to zoom from `0.25x` to `16x` around the pointer. Closing the overlay restores the preview canvas position and size.
- **Perspective view (`C`):** path editing and path transfer require the 2D composited view. In a 3D **Scene** perspective camera view, Zoidium blocks path edits without changing data and prompts you to press `C` to return to the composited view.

### Shortcuts, Escape stages, and Delete scope

Path shortcuts run only when the preview or a path control has focus, no text field is active, and IME composition is off. **Graph Editor 2** keeps priority for `V` when focused.

| Input | Behavior |
| --- | --- |
| `Q`, `P` | Arm the Pen tool without cycling. |
| `V` | Switch to Selection (`V`) on an active path, or yield to native layer selection otherwise. |
| `Ctrl` or `Cmd` (held in Pen) | Temporarily switch to Selection (`V`) while held. Modified shortcuts (`C`, `X`, `V`, `Z`, `Y`, `A`, `D`, `G`, `[`, `]`) still pass through. |
| `Alt` or `Option` | Click an anchor to toggle Corner and Smooth, or drag a handle to break linked handles. |
| `Escape` | First press during a drag or nudge cancels it and restores the snapshot. Otherwise, while drawing with Pen, finishes drawing and keeps the path active. Next press clears the vertex selection. |
| `Enter` | Optional alias to finish Pen drawing (never required). |
| `Delete`, `Backspace` | Delete selected vertices only while the preview or a path control owns focus and vertices are selected on an unlocked path. On a locked path, shows an unlock message. Otherwise defers to the focused native panel. Deleting all vertices removes the path. |
| `Space` + drag, wheel | Pan and zoom the composited preview while editing. |
| `T`, `C`, `M` | Stay native. Pressing `T` (or clicking the layer transform button) suspends Pen and hands pointer input to layer transforms without erasing path selection. |

## Animate paths and use the timeline

A path keyframe is one logical key across all six channels (`x`, `y`, `inX`, `inY`, `outX`, `outY`) of every vertex.

### Path keyframe controls

Path keyframe controls appear in three places: each mask row in **Properties**, the **Path** property row in **Objects** on a **Shape+** layer, and the bottom-right corner of the preview overlay.

- **Diamond states:** hollow (`◇`) means animation is off. Outlined active (`◈` in mask rows, accent-colored `◇` in **Objects** and the overlay) means animation is on with no key at the playhead. Filled (`◆`) means a keyframe exists at the playhead.
- **Add or remove a key:** click the diamond to enable animation (when off) or to add or remove a logical key at the current frame. At least one key per channel must remain.
- **Animation stopwatch (`⏱`):** toggles path animation on or off. Turning animation off keeps the sampled shape at the current playhead frame.
- **Auto-key:** while animation is on, editing vertices at an unkeyed frame samples every channel using its existing interpolation, inserts one logical key, and commits one **Undo** step. A drag that changes nothing creates neither a key nor an **Undo** step.
- **Jump between keys:** click Previous (`‹`) or Next (`›`) to jump to the nearest logical keyframe in project time, accounting for clip start and trim offset.

### Timeline rows

When you select a single **Scene**, **Adjustment**, or **Shape+** clip, the timeline keyframes panel shows logical path rows:

- Masks appear as **Masks > `<mask name>` > Mask Path**.
- Shape+ paths appear as **Shape+ > `<path name>` > Path** (native per-channel rows stay hidden).

On a path timeline row:

- Click a diamond to move the playhead to that frame and activate the path.
- `Shift`-click diamonds on the same row to select more than one key.
- Drag selected diamonds left or right to retime them in one **Undo** step. Hold `Shift` while dragging to disable frame snapping, or press `Escape` to cancel.
- Press `Delete` or `Backspace` to remove selected diamonds (at least one key per channel must remain).
- Trimming the left edge of a masked clip shifts its clip-local mask keyframes together with the clip start so the keyframes stay at the same project frames, with full **Undo** and **Redo** support.

### Editing vertices on animated paths

Adding a vertex on a segment, appending an endpoint, deleting vertices, reversing, and **Set First Vertex** apply globally across every keyframe in one **Undo** step.

- Inserting a vertex splits every keyed cubic at the same segment and curve parameter with de Casteljau subdivision so each keyed curve keeps its exact shape.
- Deleting vertices removes those vertices and their channels at every keyframe.
- Before writing a topology edit to an animated path, Zoidium verifies that interpolation across all frames stays exact. If exact preservation cannot be established, Zoidium refuses the edit with an explanation and leaves the path unchanged.

## Copy, paste, and convert paths

### Copy, cut, and paste paths

While the preview overlay, a mask row, or a single **Path** item in **Objects** has focus, press `Ctrl+C`, `Ctrl+X`, or `Ctrl+V` (`Cmd` on macOS) to copy, cut, or paste a path between masks and **Shape+** layers, or within the same layer.

- Copied path data includes geometry, vertex order and modes, closed state, and all channel keyframes and tweens. Mask combine settings (mode, **Feather**, **Opacity**, **Expansion**, and **INV**) are not copied.
- Pasting creates fresh IDs and maps coordinates from the source layer space to the destination layer space at the playhead using an affine transform. Handle vectors transform without translation, and keyframe timings stay in clip-local frames.
- Pasting into a **Shape+** layer adds a group with a default **Fill**. Pasting into a **Scene** or **Adjustment** layer adds a mask with default combine settings.
- Pasting plain SVG or Shape+ contents text still works as before, and unrecognized clipboard text falls back to native paste.

### Convert between Mask and Shape+

- **Mask to Shape+:** right-click a mask row in **Properties** under **Masks** and choose **Convert to Shape+**.
- **Shape+ to Mask:** right-click a **Path** item in **Objects** under **Contents** and choose **Convert to Mask**.

A compatible target clip must exist at the playhead. If more than one compatible clip is at the playhead, a **Choose destination clip** menu lets you pick one. Conversion creates the destination path before removing the source, preserving animation in one **Undo** step. **Mask to Shape+** creates a painted group, and **Shape+ to Mask** uses default mask settings. If conversion fails, the original path stays untouched.

## Limits and refused edits

When an edit cannot run safely without altering data or animation, Zoidium refuses it and shows an explanation instead of guessing or clamping silently.

| Case | Behavior and reason |
| --- | --- |
| **3D perspective view** | Path editing, copy, paste, and conversion are refused. Press `C` to switch to the composited view. |
| **Locked mask** | Geometry, topology, keyframe, property, cut, convert, and delete edits are blocked. Unlock the mask first. Selecting, unlocking, and reordering (`▲` and `▼`) remain allowed. |
| **Singular transform** | A layer or parent group with a non-invertible transform (such as zero scale on an axis) blocks pointer editing and path transfer because screen coordinates cannot map back to local path space. |
| **Expression-driven path** | Paths or path channels driven by an expression cannot be edited, re-topologized, or transferred. |
| **Animated topology refusals** | Vertex insert, append, delete, reverse, and **Set First Vertex** are refused on animated paths that use curve-controlled or unsupported tweens. They are also refused when unsynchronized keys would change an eased segment, or (for insert and append) when channels use different keyframe schedules or tweens. |
| **Path transfer and conversion refusals** | Refused when a nontrivial affine transform (rotation, shear, or scale) meets curve-controlled or unsupported tweens, or when mixed channel schedules cannot be synchronized under rotation or shear. Conversion also fails when no compatible clip exists at the playhead, and clipboard payloads over `262,144` characters (`256` KiB) are refused. |
| **Open-path Set First Vertex** | Choosing an interior vertex on an open path is refused. Choose the other endpoint instead. |
| **Final keyframe deletion** | You cannot delete the last remaining keyframe on a path channel. Turn off animation with the stopwatch (`⏱`) instead. |
| **Timeline diamond collisions and copy** | Dragging timeline path diamonds onto a frame already occupied by an unselected keyframe is refused. Copying or cutting individual path diamonds in the timeline with `Ctrl+C` or `Ctrl+X` is not supported. Copy the path from the preview, mask row, or **Objects** instead. |
| **Animated primitives** | **Convert to Path** works only on static **Rectangle**, **Ellipse**, and **Polystar** items so animated procedural parameters are not flattened. |
| **Count and range bounds** | A path supports up to `256` vertices. A layer supports up to `32` masks. **Feather** accepts `0` to `500` px. **Expansion** accepts `-128` to `128` layer px. |

## Add, edit, and animate 2D vector text

1. Select a **Shape+** clip, open **Objects**, click the **Contents +** menu, and choose **Text**.
2. Choose **Font Family** and edit **Source Text** in Properties (the multiline field follows the theme and grows as you type).
3. To edit directly in the preview, double-click the text. The rendered text stays visible with a caret and selection highlight. Type to replace text, press Enter for a new line, use arrow keys, Home, and End to move, double-click to select a word, and press Escape or click outside to commit one undo step.

- **Fonts:** Pickers list built-in fonts first, then imported fonts under **Project fonts** sorted by family name, then **custom...**. For Japanese text, pick a font with Japanese glyphs, or set **Fallback Font** for missing glyphs.
- **Variable fonts:** Most built-in fonts are static and display `"Static font: no variable axes"` beside the item in **Objects**. The built-in **Geist**, **Geist Mono**, and **Inter** fonts expose a weight axis, and **Geist Serif** exposes an `ELSH` shape axis. To use other variable axes, import a variable TTF, OTF, or WOFF1 font in [Assets](/docs/workflow/assets/) and choose it in **Font Family**. Its axes appear as named rows (such as **Weight (wght)**) directly below **Style**.
- **Paragraph text:** Set **Text Mode** to **box** and adjust **Box Size**.
- **Text Animators:** Select a **Text** item, open the preview context menu, and choose **Add Text Animator** and a property. Animate the property and **Range Selector** bounds, use **Add Property** on the animator for additional channels, or choose **Add Wiggly Selector** for noise-driven variation. Each animator affects every **Text** item above it in the same group, and stacked animators combine top to bottom.
- **Convert text to outlines:** Select a **Text** item and choose **Convert to Path** from the preview context menu (or **Create Shapes from Text** on the Objects row). Conversion bakes the current frame (including active Text Animators) into editable character **Group** and **Path** items in one undo step.

## Contents reference

A dash (`—`) in the range column means no declared minimum or maximum.

### Group

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Anchor** | 2D vector | — | `[0, 0]` | Pivot for the group or repeated transform. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |
| **Scale** | 2D vector | — | `[1, 1]` | Axis scale factors (`1` preserves size). |
| **Rotation** | Number | — | `0` | Rotation in degrees. |
| **Opacity** | Number | `0` to `1` | `1` | Opacity multiplier. |

### Rectangle

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | 2D vector | — | `[200, 200]` | Width and height in composition pixels. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |
| **Roundness** | Number | ≥ 0 | `0` | Corner radius, capped at half the smaller dimension. |

### Ellipse

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Size** | 2D vector | — | `[200, 200]` | Width and height in composition pixels. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |

### Polystar

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Choice | **star**, **polygon** | **star** | Star or regular polygon. |
| **Points** | Number | `3` to `128` | `5` | Point count. |
| **Position** | 2D vector | — | `[0, 0]` | Translation in the containing coordinate space. |
| **Inner radius** | Number | ≥ 0 | `50` | Radius of the star's inner vertices. |
| **Outer radius** | Number | ≥ 0 | `100` | Radius of the outer vertices. |
| **Inner roundness** | Number | `0` to `100` | `0` | Rounding of the inner corners. |
| **Outer roundness** | Number | `0` to `100` | `0` | Rounding of the outer corners. |
| **Rotation** | Number | — | `0` | Rotation in degrees. |

### Path

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Closed** | Choice | **off**, **on** | **on** | Connects the last vertex to the first. |
| **Path** | Number | — | Four-vertex rectangle | Tangents are relative to each vertex. Pen paths start open with one vertex. |

### Fill

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | — | `[1, 1, 1]` | Paint RGB color. |
| **Opacity** | Number | `0` to `1` | `1` | Opacity multiplier. |
| **Fill rule** | Choice | **nonzero**, **even-odd** | **nonzero** | Winding rule for overlapping contours. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint order relative to earlier items in the same group. |

### Stroke

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Color** | RGB color | — | `[1, 1, 1]` | Paint RGB color. |
| **Opacity** | Number | `0` to `1` | `1` | Opacity multiplier. |
| **Width** | Number | ≥ 0 | `10` | Stroke width in composition pixels. |
| **Cap** | Choice | **butt**, **round**, **square** | **butt** | Shape at an open stroke's ends. |
| **Join** | Choice | **miter**, **round**, **bevel** | **miter** | Shape where stroke segments meet. |
| **Miter limit** | Number | ≥ 1 | `4` | Max miter extension relative to width before falling back to bevel. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Paint order relative to earlier items in the same group. |
| **Dash / gap pairs** | Choice | **0**, **1**, **2**, **3** | **0** | Number of active dash and gap pairs. |
| **Dash 1** – **Dash 3** | Number | ≥ 0 | `20` | Length of each dash in pixels. |
| **Gap 1** – **Gap 3** | Number | ≥ 0 | `10` | Length of each gap in pixels. |
| **Dash offset** | Number | — | `0` | Shifts the dash pattern along the path. |
| **Start length (%)**, **End length (%)** | Number | `0` to `100` | `0` | Percentage of the path covered by start or end taper. |
| **Start width (%)**, **End width (%)** | Number | ≥ 0 | `0` | Width at start or end as a percentage of **Width**. |
| **Start ease**, **End ease** | Number | `-100` to `100` | `0` | Shape of start or end taper transition. |
| **Wave amount (%)** | Number | `0` to `100` | `0` | Amount of width modulation along the stroke. |
| **Wave units** | Choice | **cycles**, **length** | **cycles** | Uses a cycle count or a pixel wavelength. |
| **Wavelength** | Number | ≥ 0.01 | `100` | Distance per wave when **Wave units** is **length**. |
| **Cycles** | Number | ≥ 0 | `3` | Number of waves when **Wave units** is **cycles**. |
| **Wave phase (degrees)** | Number | — | `0` | Phase of width modulation in degrees. |

### Gradient Fill and Gradient Stroke

**Gradient Fill** uses **Opacity** (`0` to `1`, default `1`), **Fill rule** (**nonzero** or **even-odd**), **Composite**, plus the gradient geometry controls below.
**Gradient Stroke** shares every **Stroke** control except solid **Color**, plus the gradient geometry controls below.

| Gradient control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Type** | Choice | **linear**, **radial** | **linear** | Linear or radial gradient geometry. |
| **Start point** | 2D vector | — | `[-100, 0]` | Gradient start or radial center. |
| **End point** | 2D vector | — | `[100, 0]` | Gradient endpoint or radial radius handle. |
| **Highlight length (%)** | Number | `-99` to `99` | `0` | Radial focal-point offset as a percentage of radius. |
| **Highlight angle** | Number | — | `0` | Direction of radial focal-point offset in degrees. |
| **Colors** | Gradient | Editable stops | Orange to blue | Color and opacity stops along the gradient. |

### Modifiers

#### Trim Paths

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Start (%)** | Number | `0` to `100` | `0` | Start of the retained path interval. |
| **End (%)** | Number | `0` to `100` | `100` | End of the retained path interval. |
| **Offset (degrees)** | Number | — | `0` | Shifts the retained interval around the path. |
| **Trim multiple shapes** | Choice | **Simultaneously**, **Individually** | **Simultaneously** | Trims each path together or distributes the trim across combined path length. |

#### Repeater

| Control | Type | Range or options | Default | Effect on output |
| --- | --- | --- | --- | --- |
| **Copies** | Number | `0` to `128` | `3` | Copy count (fractional values fade the last copy's opacity). |
| **Offset** | Number | — | `0` | Shifts the transform index for repeated copies. |
| **Composite** | Choice | **Below previous in same group**, **Above previous in same group** | **Below previous in same group** | Copy stacking order. |
| **Anchor** | 2D vector | — | `[0, 0]` | Pivot for repeated transforms. |
| **Position** | 2D vector | — | `[100, 0]` | Translation added per copy. |
| **Scale** | 2D vector | — | `[1, 1]` | Scale multiplied per copy. |
| **Rotation** | Number | — | `0` | Rotation added per copy in degrees. |
| **Start opacity**, **End opacity** | Number | `0` to `1` | `1` | Opacity of the first and last copies. |

#### Round Corners, Twist, Zig Zag, and Pucker & Bloat

- **Round Corners:** **Radius** (≥ 0, default `10` px).
- **Twist:** **Angle** (degrees, default `0`), **Center** (2D vector, default `[0, 0]`).
- **Zig Zag:** **Size** (≥ 0, default `10` px), **Points** (**corner** or **smooth**, default **corner**), **Ridges per segment** (`1` to `64`, default `3`).
- **Pucker & Bloat:** **Amount (%)** (`-100` to `100`, default `0`) pulls vertices inward or pushes them outward relative to the path center.

#### Wiggle Paths and Wiggle Transform

Both share **Wiggles / second** (`0` to `100`, default `1`), **Correlation (%)** (`0` to `100`, default `50`), **Temporal phase (degrees)** (default `0`), **Spatial phase (degrees)** (default `0`), and **Random seed** (default `1`).

- **Wiggle Paths** adds **Size** (≥ 0, default `10` px), **Points** (**corner** or **smooth**, default **corner**), and **Detail** (`1` to `100`, default `5`).
- **Wiggle Transform** adds **Anchor offset** (`[0, 0]`), **Position offset** (`[20, 20]`), **Scale offset (%)** (`[0, 0]`), and **Rotation offset** (`0` degrees).

#### Offset Paths and Merge Paths

- **Offset Paths:** **Amount** (default `10`), **Join** (**miter**, **round**, or **bevel**, default **miter**), **Miter limit** (`1` to `100`, default `4`). Open paths offset on both sides into a closed outline (**round** gives round ends, other joins give flat ends, and negative **Amount** matches positive).
- **Merge Paths:** **Mode** (**merge**, **add**, **subtract**, **intersect**, **exclude**; default **add**). **merge** keeps contours separate; the other four perform Boolean path operations.

SVG import and native conversion produce editable vector contents. Native Text+ character animation does not transfer when converting a Text layer to Shape+.

## Text and Text Animator reference

### Text

**Text** supplies glyph contours to modifiers and paints below it in the same group. Discrete text properties use hold keys and support expressions.

| Control | Type | Default | Effect |
| --- | --- | --- | --- |
| **Source Text** | Dynamic text | `Text` | Multiline string; supports hold keys and expressions. |
| **Font Family** | Dynamic font asset | Native default | Primary font reference. |
| **Fallback Font** | Dynamic font asset | None | Explicit fallback for unmapped grapheme clusters (no implicit fallback). |
| **Style** | Dynamic choice | Default | Writes a named instance's axis values (leaves expression-driven axes unchanged and shows a notice). |
| Variable axes (e.g. **Weight (wght)**) | Dynamic number | Font default | One row per axis directly below **Style**, bounded by the font. |
| **Size** | Dynamic number | `100` | Composition pixels per em. |
| **Tracking** | Dynamic number | `0` | Thousandths of **Size** between glyphs. |
| **Leading** | Dynamic number | `120` | Baseline distance in composition pixels. |
| **Baseline Shift** | Dynamic number | `0` | Positive values move glyphs upward. |
| **Horizontal Scale (%)**, **Vertical Scale (%)** | Dynamic number | `100` | Glyph scale. |
| **Caps** | Dynamic choice | `normal` | `normal`, `all`, or `small` (uppercase at 75% size). |
| **Position** | Dynamic vector | `[0, 0]` | Baseline origin. |
| **Alignment** | Dynamic choice | `left` | `left`, `center`, `right`, `justifyLeft`, `justifyCenter`, `justifyRight`, `justifyAll`. |
| **Text Mode** | Dynamic choice | `point` | `point` (no wrap) or `box`. |
| **Box Size** | Dynamic vector | `[600, 400]` | Wrap width and visible height (overflow lines are hidden). |
| **First-Line Indent** | Dynamic number | `0` | Indent on the first line of each paragraph. |
| **Space Before**, **Space After** | Dynamic number | `0` | Paragraph spacing in composition pixels. |

- **Formats:** TTF, OTF, variable TrueType, CFF2, and WOFF1 are supported. WOFF2 shows an unsupported-format status while retaining the asset reference. Missing fonts show a status beside the item.
- **Wrapping:** Box text wraps Latin words (breaking oversized words per grapheme) and breaks CJK per grapheme. Newlines start paragraphs. Justification expands spaces, or distributes width between grapheme clusters on space-free CJK lines.
- **Variable axes:** Animated **Style** sets axes that have no animation of their own; animated axis channels keep their own values. Inactive axes stay in `axisStore` and return if you switch back to a font with that axis tag. The optional text engine bundle loads on first text use (Electron is untested).

### Text Animator

A **Text Animator** affects every **Text** item above it in the same group (including earlier nested groups) and stacks top to bottom. An animator with no text above it displays `"No text above this animator"`.
Each enabled property applies `neutral + (value - neutral) * s`, where `s` is the combined selector weight for each unit. Toggle properties with **Add Property** and **Remove Property** in the animator's context menu. Per-character Opacity, Fill Color, Stroke Color, and Stroke Width are not yet supported.

| Property | Type | Default | Effect |
| --- | --- | --- | --- |
| **Anchor Point** | Dynamic vector | `[0, 0]` | Pivot offset for scale, rotation, and skew. |
| **Position** | Dynamic vector | `[0, 0]` | Added to glyph position (positive Y is up). |
| **Scale (%)** | Dynamic vector | `[100, 100]` | Neutral is `100`. |
| **Skew**, **Skew Axis** | Dynamic number | `0` | Degrees. Applied after scale and before rotation. |
| **Rotation** | Dynamic number | `0` | Degrees. |
| **Tracking Amount** | Dynamic number | `0` | Adds `value * s * Size / 1000` after each affected character (alignment runs before this shift). |
| **Character Offset** | Dynamic number | `0` | Integer wraparound shift within `a–z`, `A–Z`, or `0–9`. Ligatures shift every letter of their cluster and reshape as one unit using the first character's weight. The new advance replaces the old one, and kerning stays from the base shaping. |
| **Grouping Alignment (%)** | Dynamic vector | `[0, 0]` | Shifts pivot as a percentage of the group box (advance span horizontally, ascent to descent vertically). |
| Variable axis (tag) | Dynamic number | `0` | Offset added to the glyph's axis coordinate, clamped to axis bounds. |
| **Anchor Point Grouping** | Static choice | `Character` | Pivot unit: `Character`, `Word`, `Line`, or `All` (centered horizontally on the unit's advance span on the first baseline). |

#### Range Selector

| Control | Type | Default | Effect |
| --- | --- | --- | --- |
| **Units** | Static choice | `Percentage` | `Percentage` or `Index` across the whole item. |
| **Range Start**, **Range End**, **Range Offset** | Dynamic number | `0`, `100`, `0` | Under `Index`, an unkeyed, expression-free default `End` of `100` selects through the last unit; otherwise `End` counts literally. Equal bounds select nothing. |
| **Based On** | Static choice | `Characters` | `Characters`, `Characters Excluding Spaces`, `Words`, or `Lines`. Spaces get `0` except under `Characters` and `Lines`. |
| **Mode** | Static choice | `Add` | `Add`, `Subtract`, `Intersect`, `Min`, `Max`, or `Difference`, clamped to `[-1, 1]`. |
| **Amount (%)** | Dynamic number | `100` | `-100` to `100`; multiplies selector weight. |
| **Shape** | Static choice | `Square` | `Square` covers unit span fractionally; `Ramp Up`, `Ramp Down`, `Triangle`, `Round`, and `Smooth` sample unit centers. |
| **Ease High (%)**, **Ease Low (%)** | Dynamic number | `0` | Reshapes weights toward `1` or `0` (`0` is unchanged). |
| **Randomize Order**, **Random Seed** | Static switch, dynamic number | `Off`, `0` | Deterministic seeded unit permutation. |

#### Wiggly Selector

| Control | Type | Default | Effect |
| --- | --- | --- | --- |
| **Wiggly Mode** | Static choice | `Add` | Same combination modes as **Range Selector**. |
| **Maximum Amount (%)**, **Minimum Amount (%)** | Dynamic number | `100`, `-100` | Smooth noise scaled into this range. |
| **Wiggly Based On** | Static choice | `Characters` | Independent unit counting for noise. |
| **Wiggles / Second** | Dynamic number | `2` | Noise rate in cycles per second. |
| **Correlation (%)** | Dynamic number | `50` | `100` shares one value across units; `0` is independent. |
| **Temporal Phase (degrees)**, **Spatial Phase (degrees)** | Dynamic number | `0` | Offsets in time and per unit. |
| **Lock Dimensions** | Static switch | `Off` | Shares one noise value across vector components. |
| **Wiggly Random Seed** | Dynamic number | `0` | Deterministic frame-based noise seed. |

### Conversion and text cache limits

- **Create Shapes from Text:** Replaces **Text** with character groups at the current frame (each contour as a separate **Path**; spaces make no group; ligature outlines go to the first character with empty named groups for the rest; combining marks stay with their base character). Winding, parent paint order, and existing animator rows are preserved, and one Undo restores live text.
- **Cache budgets:** Text layout caches key on font identities, evaluated text and paragraph properties, and variation coordinates. Replacing a font file invalidates the old result. A layer transform reuses layout and geometry unless it changes the flattening tolerance. Accounting limits are `8` MiB each for layouts, glyph geometry, and glyph paint; `2` MiB each for parsed contours and shaped runs; `512` KiB for fallback coverage; `1` MiB for engine shaping results; and `4` MiB for outlines. These limits do not measure the full browser heap. Touching or overlapping glyphs use compound fills, and sloped and curved contours also keep the compound slab arrangement to preserve subpixel rasterization. Individual-mode **Trim Paths** and transformed **Repeater** views bypass per-glyph fill reuse.
