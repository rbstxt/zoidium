# Graph Editor 2 (graph-plus)

A theme-aware port of OpenZoid's rebuilt F-curve editor (DaviFX) as a
reversible Zoidium extension.

When enabled, it replaces `PZ.ui.graph`, `PZ.ui.graph.grid` and
`PZ.ui.graphEditor` with the Graph Editor 2 implementation:

- Toolbar: Linear / Step / Ease / break / auto tangents, custom-easings
  popup with all 33 `PZ.tween.easingList` presets, Pan / Marquee, Fit (`\`),
  Frame (`F`), Normalize (`N`), Snap (`S`), +Key (`K`), Delete, Bezier (`I`),
  Link (`T`), Flat (`R`), Copy / Paste, Labels, Follow selection.
- Eased-segment rendering through the real easing functions, hold-step
  display, canvas ruler with scrub-to-playhead, mouse-anchored wheel zoom,
  space-drag pan, double-click keyframe add, snap-to-playhead/keys drag,
  Bezier handle drag with tangent-break detection.
- Track list with live values and eye toggles, hover tooltips, status bar,
  full keyboard set (arrows nudge, Ctrl+C/X/V/A, Esc).
- Every edit is one CM3 history step via `editor.history`, exactly like the
  stock editor.

Look: the original grey band and dark tiles follow CM3 chrome through the
`--zui-*` theme tokens (panel/title backgrounds, theme accent for selection
and active tools, theme value color for numbers, `var(--zui-font)`). All
rules stay scoped under `.g2-*`. Existing native popup panels still receive
styles through per-document injection.

Stock CM3 already provides the marker prev/next shortcuts and the Ctrl+G
floating graph window. This plugin upgrades every graph panel the native
wiring opens. While enabled, the graph button
and Ctrl+G open one centered, resizable Zoidium window with standard chrome,
maximize and remembered geometry. Reopening focuses that window and keeps
its curves and view. Graph shortcuts stay inside the window; the native
popup's Ctrl+N/M/O/S/Z/Y editor commands still work. Closing releases the
panel, observers and listeners. Disabling closes the Zoidium graph window,
restores native popup opening and rebuilds other open graph panels in place;
no reload is required.

Right-click an animatable property row in Edit, Objects, Effects, Sequence,
or the corresponding timeline label/track and choose **Show in Graph Editor**.
All components of a vector or color open together in the existing graph window
and fit to its canvas. Focus a row or one of its fields and press **Alt+Shift+G**
for the same action. This modifier combination is unused by the native CM3
and Zoidium shortcuts; Ctrl+G keeps its existing window-opening behavior.

**Follow selection** starts on. Click a property to replace the shown curves,
or Ctrl/Shift-click to add properties. Selecting timeline keys follows their
properties. Selecting an object or layer shows its animated properties,
including nested material, geometry and plugin properties. Turn Follow
selection off to pin the current curves. This preference persists locally;
explicit Show in Graph Editor still works while pinned. Manual picker choices
remain until the next property, keyframe or object selection change. Following
never focuses the graph or fits on playback ticks. Opening and following do
not write project data or add history entries.

Disabling removes the property menus, selection marks, row focus attributes,
shortcut and native selection hooks, as well as the graph window. The property
menu and shortcut are available only while Graph Editor 2 is enabled.

Coexists with Easing+: Easing+ patches the property-row controls and the
keyframe move/scale paths, while Graph Editor 2 only replaces the graph
panel classes. Both read and write the same Bezier handles through
`PZ.tween.correctCurve` and the native `propertyOps` hooks.

The bundle loads its source modules with the shared `modules.createRequire`
loader. `graph-plus.js` owns installation and window cleanup; `pointer.js`
tracks owner documents and active drags; `theme.js` owns theme and CSS.
`editor.js` assembles the editor from `editor-helpers.js`, `editor-core.js`,
`toolbar.js`, `canvas.js`, `interaction.js`, `curves.js`, and `operations.js`.
`selection.js` maps property identities and owns the UI selection model;
`selection-host.js` binds property rows, timeline keys and native selection events.
These files are declared text resources inside the same plugin bundle.
