# Graph Editor 2 (graph-plus)

A theme-aware port of OpenZoid's rebuilt F-curve editor (DaviFX) as a
reversible Zoidium extension.

When enabled, it replaces `PZ.ui.graph`, `PZ.ui.graph.grid` and
`PZ.ui.graphEditor` with the Graph Editor 2 implementation:

- Toolbar: Linear / Step / Ease / break / auto tangents, custom-easings
  popup with all 33 `PZ.tween.easingList` presets, Pan / Marquee, Fit (`\`),
  Frame (`F`), Normalize (`N`), Snap (`S`), +Key (`K`), Delete, Bezier (`I`),
  Link (`T`), Flat (`R`), Copy / Paste, Labels.
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
rules stay scoped under `.g2-*`; popup graph windows get the same styles
through per-document injection.

Stock CM3 already provides the marker prev/next shortcuts and the Ctrl+G
floating graph window, so this plugin adds no toolbar items: it upgrades
every graph panel the native wiring opens. Disabling restores the native
classes and rebuilds open graph panels in place; no reload is required.

Coexists with Easing+: Easing+ patches the property-row controls and the
keyframe move/scale paths, while Graph Editor 2 only replaces the graph
panel classes. Both read and write the same Bezier handles through
`PZ.tween.correctCurve` and the native `propertyOps` hooks.
