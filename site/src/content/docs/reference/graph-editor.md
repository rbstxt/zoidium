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

Vector and color properties reveal all components. Object and layer selection follow animated properties, including nested material, geometry, and plugin properties. Expression-driven properties are excluded from automatic animated-property collection.

The follow preference and floating-window geometry persist locally. Opening or following curves does not create a project history entry. Disabling the plugin closes its floating window and restores native graph panels and opening behavior.

## Interpolation and tangent tools

| Toolbar label | Behavior |
| --- | --- |
| **Linear** | Applies linear easing to selected keys. |
| **Step** | Holds the preceding value until the next key. |
| **Ease** | Applies cubic in-out easing. |
| **Custom easings** | Lists the host's easing presets. |
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

The mouse wheel zooms around the pointer. The graph ruler scrubs the playhead. Double-clicking the graph adds a key.

For task steps, see [Edit animation curves with Graph Editor 2](/docs/features/graph-editor-2/).
