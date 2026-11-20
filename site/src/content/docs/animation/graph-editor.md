---
title: Graph Editor 2
description: Edit native keyframes, Bezier tangents, vector axes, and expression curves in Graph Editor 2 (Graph+).
---
Use **Graph Editor 2** (also called **Graph+**) to inspect and edit native keyframes in the graph panel or a floating graph window.
While enabled, Graph Editor 2 replaces the native graph panels. Disabling the plugin closes its floating window and restores native graph behavior.

## Open and show properties

1. In **Plugins**, enable **Graph Editor 2**.
2. Right-click any animatable property row or its timeline label and choose **Show in Graph Editor** (or press Alt+Shift+G on a focused property row).
3. To open or focus the floating graph window directly, press Ctrl+G or click the editor's graph button.

Vector and color properties open all of their components together.

### Pin or follow selection

**Follow selection** starts enabled and is saved locally.

- With **Follow selection** on, selecting a property replaces the displayed curves. Selecting an object or layer follows its animated properties, including nested material, geometry, and plugin properties. Ctrl-click or Shift-click adds more properties.
- Turn **Follow selection** off to pin the current curves while you select other objects. Use **Show in Graph Editor** to replace pinned curves explicitly.

Opening or following curves creates no undo entry. Floating-window position and size persist locally.

## Edit keys, tangents, and vector axes

1. Choose **Marquee** (or hold Shift while dragging) to select keys.
2. Apply **Linear**, **Step**, **Ease**, or **Custom easings**, or switch to **Bezier** for handle editing.
3. Click **Break Tangents** to make incoming and outgoing handles independent, or **Auto Tangents** to make them continuous again.
4. Click **Frame** (or press `F`) to zoom to the selected keys.

### Vector and color tracks

Each multi-component property has a parent row and colored axis rows.

- Click an axis row to show that axis and select its keys. Ctrl-click or Shift-click to combine axes, or click the parent row to select all components.
- Click the eye button to hide a curve, or **S** to solo an axis. Visibility stays local and is not saved in the project.
- Turn on **Link axes** to keep sibling keys at the same frame moving together horizontally while value drags stay per axis.
- Easing, tangent, value, delete, copy, and paste apply to selected axes. **+Key** uses selected axes (or visible axes when none are selected). Copy and paste preserve axis names. To paste a single copied axis onto another axis, select only the destination axis.

### Inspect expression curves

Expression-driven properties display as read-only dashed curves labeled **Expression**.
Use **Fit** or **Frame** to inspect the evaluated curve. Very slow expressions may draw across several redraws, and **Fit** and **Frame** wait until the sampled curve finishes. Remove the expression to edit keyframes directly.

For single-segment incoming easing curves, see [Easing+](/docs/animation/easing-plus/). Both tools read and write the same native Bezier handles.

## Toolbar and keyboard shortcuts

Shortcuts apply while the graph has keyboard focus. Text inputs keep normal typing behavior. On macOS, use Cmd instead of Ctrl.

| Toolbar button | Shortcut | Behavior |
| --- | --- | --- |
| **Linear** | — | Applies linear easing to selected keys. |
| **Step** | — | Holds the previous value until the next key. |
| **Ease** | — | Applies cubic in-out easing. |
| **Custom easings** | — | Opens host easing presets with curve thumbnails. |
| **Break Tangents** | — | Separates tangent directions on selected keys. |
| **Auto Tangents** | — | Restores continuous tangents. |
| **Bezier** | `I` | Toggles Bezier and linear interpolation. |
| **Link** | `T` | Toggles continuous tangents. |
| **Flat** | `R` | Resets selected handles. |
| **Pan** | `H` | Left-drag pans the grid (Space-drag also pans). |
| **Marquee** | `V` | Left-drag selects keys (starts active; Shift-drag selects in either tool). |
| **Fit** | `\` | Fits all curves into view. |
| **Frame** | `F` | Frames selected keys. |
| **Norm** | `N` | Normalizes displayed curve heights without changing values. |
| **Snap** | `S` | Snaps drags to the playhead and existing keys. |
| **+Key** | `K` | Adds a key at the playhead on displayed curves. Double-clicking the graph also adds a key. |
| **Del** | Delete / Backspace | Deletes selected keys. |
| **Copy**, **Paste** | Ctrl+C, Ctrl+V | Copies selected keys and pastes at the playhead. |
| **Labels** | — | Toggles curve labels. |

Additional shortcuts: Ctrl+X cuts keys, Ctrl+A selects all keys, and arrow keys nudge keys by 1 unit (hold Shift for 10 units). Horizontal nudges move in frames; vertical nudges convert graph pixels to values.

## Mouse, trackpad, and handle gestures

Click **?** in the toolbar to open the in-editor gesture card.

| Input | Action |
| --- | --- |
| Mouse wheel | Zooms X around the pointer. |
| Alt+wheel | Zooms Y. |
| Shift+wheel | Pans X. |
| Trackpad two-finger scroll | Pans X and Y with inertia. |
| Pinch or Ctrl+wheel | Zooms X and Y around the pointer. |
| Alt+pinch | Zooms Y. |
| Middle-drag or Space-drag | Pans the view. |
| Left-drag on ruler or right-drag on graph | Scrubs the playhead. |
| Ctrl during key drag | Locks frame (changes value only). |
| Shift during key drag | Locks value (changes frame only). |

On the ruler, all wheel gestures zoom X only, including Alt+wheel.

### Bezier handle gestures

Selected keys show tangent handles, with a minimum display length for short handles that does not alter their stored values.

| Input | Action |
| --- | --- |
| Handle drag | Moves the handle. Dragging a preset segment converts it to Bezier. |
| Hold or press Alt during handle drag | Breaks the tangent; releasing Alt rejoins it. |
| Hold Shift during handle drag | Constrains handle angle to 45-degree steps. |
| Hold Ctrl or Cmd during handle drag | Snaps near a flat tangent or the neighboring key's slope. |
| Double-click a handle | Resets both handles to the default flat ease. |

Each drag or handle gesture creates one undo step. With multiple axes selected, value drags apply the same delta to every selected key.

## View scale

**Fit** and wheel zoom share the same scale limits: `0.0001` to `500` frames per CSS pixel on X, and `0.000001` to `10000` displayed units per CSS pixel on Y.
The ruler and grid share tick positions, and close zoom preserves fractional frame labels. View scale changes do not alter keyframes or saved project data.
