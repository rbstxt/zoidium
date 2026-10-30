---
title: Graph Editor 2 toolbar and shortcuts
description: Curve tools, keyboard focus, selection behavior, and graph view controls.
sidebar:
  label: Graph Editor 2 reference
---
Graph Editor 2 replaces native graph panels while enabled. Graph+ is an alternate name for this plugin.

## Opening and selection

| Action or control | Behavior |
| --- | --- |
| Ctrl+G or the editor's graph button | Opens or focuses one floating graph window. |
| **Show in Graph Editor** | Reveals a property's curves and fits them in the graph, including while selection following is off. |
| Alt+Shift+G | Reveals the focused property row. |
| **Follow selection** | Starts on. Property selection replaces curves, and Ctrl-click or Shift-click adds properties. Off pins the displayed curves. |

Vector and color properties reveal all components. Object and layer selection follow animated properties, including nested material, geometry, and plugin properties. Expression-driven properties appear as read-only dashed curves with an Expression label. Fit and Frame include their sampled output.

The follow preference and floating-window geometry persist locally. Opening or following curves does not create a project history entry. Disabling the plugin closes its floating window and restores native graph panels and opening behavior.

## Vector and color tracks

Each property has a parent row and colored axis rows. An axis row selects its keys and shows that axis. Ctrl-click or Shift-click combines rows. The parent row selects all components. Eye buttons toggle visibility, and **S** isolates an axis. Visibility stays outside project data.

Easing, tangent, value, delete, copy, and paste operations use the selected axes. **+Key** uses selected axes, or visible axes when no rows are selected. Axis names map to the same destination axes during paste. A single copied axis can target one selected destination axis.

**Link axes** groups time moves for sibling keys at the same frame. Value drags stay per axis. Each gesture creates one undo step.

Very slow expressions may draw over several redraws. **Fit** and **Frame** wait until the expression curves are ready.

## Interpolation and tangent tools

| Toolbar label | Behavior |
| --- | --- |
| **Linear** | Applies linear easing to selected keys. |
| **Step** | Holds the preceding value until the next key. |
| **Ease** | Applies cubic in-out easing. |
| **Custom easings** | Shows the host's easing presets with curve thumbnails. |
| **Break Tangents** | Makes selected tangent directions independent. |
| **Auto Tangents** | Makes selected tangents continuous. |
| **Bezier** | Toggles Bezier and linear interpolation. |
| **Link** | Toggles tangent continuity. |
| **Flat** | Resets selected handles. |

Key edits use native property operations and undo history. Easing+ and Graph Editor 2 read and write the same Bezier handles.

## View and editing controls

These shortcuts apply while the graph has keyboard focus. Text inputs retain their normal typing behavior.

| Toolbar label | Shortcut | Behavior |
| --- | --- | --- |
| **Pan** | H | Left-drag pans the grid. Space-drag also pans. |
| **Marquee** | V | Left-drag selects keys. Shift-drag selects in either tool. |
| **Fit** | Backslash | Fits all curves. |
| **Frame** | F | Frames selected keys. |
| **Norm** | N | Normalizes curve display heights without changing key values. |
| **Snap** | S | Snaps drags to the playhead and keys. |
| **+Key** | K | Adds a key at the playhead on displayed curves. |
| **Del** | Delete or Backspace | Deletes selected keys. |
| **Bezier** | I | Toggles interpolation on selected keys. |
| **Link** | T | Toggles continuous tangents. |
| **Flat** | R | Resets selected handles. |
| **Copy**, **Paste** | Ctrl+C, Ctrl+V | Copies selected keys and pastes at the playhead. Command+C and Command+V also work. |
| **Labels** | None | Toggles curve labels. |

Ctrl+X cuts keys, and Ctrl+A selects all keys. Command+X and Command+A also work. Arrow keys nudge keys. Shift increases the nudge from 1 to 10 units. Horizontal units are frames. Vertical nudges use graph pixels converted to values.

Double-clicking the graph adds a key.

For task steps, see [Edit animation curves with Graph Editor 2](/docs/features/graph-editor-2/).

## Mouse and trackpad gestures

| Input | Action |
| --- | --- |
| Mouse wheel | Zooms X around the pointer. |
| Alt+wheel | Zooms Y. |
| Shift+wheel | Pans X. |
| Trackpad two-finger scroll | Pans X and Y, including inertia. |
| Pinch or Ctrl+wheel | Zooms X and Y around the pointer. |
| Alt+pinch | Zooms Y. |
| Middle-drag or Space-drag | Pans the view. |
| Left-drag with **Marquee** | Selects keys. This tool starts on. |
| Left-drag on the ruler | Scrubs the playhead. |

Wheel gestures on the ruler affect X only. **?** opens the gesture card.

## Bezier handle gestures

Selected keys show handles. Short handles have a minimum display length without changing their values.

| Input | Action |
| --- | --- |
| Handle drag | Changes the selected keys' handles. Dragging a preset segment converts that segment to Bezier. |
| Alt-drag | Breaks continuous tangents or rejoins broken tangents. |
| Shift while dragging | Constrains the angle to 45-degree increments. |
| Ctrl or Command while dragging | Snaps near a flat tangent or the neighboring key's slope. |
| Double-click a handle | Resets both handles to the default flat ease. |

Each handle gesture creates one undo step. With multiple axes selected, value drags apply the same value delta to every selected key.
