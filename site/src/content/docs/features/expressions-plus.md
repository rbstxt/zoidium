---
title: Link properties with Expressions+
sidebar:
  label: Expressions+
---
Add expression source to a native dynamic property.

1. Enable **Expressions+** in Plugins.
2. Alt-click the property's animation button.
3. Enter the expression in the editor.
4. Apply the expression.
5. Move the playhead to inspect the evaluated value.

Use the [expression reference](/docs/development/expressions/) to choose syntax,
property navigation, Sequence Controls, or camera links. Use a generated control
link when the link must survive control renames and reordering.

For shader noise, hash, color, or signed-distance helpers, enable Expressions+
before using its [shader includes](/docs/reference/shader/#includes).

Control reference: [sequence-controls](/docs/reference/sequence-controls/).

## Frame rate

`fps` returns the owning sequence frame rate, including at frame zero.
`uniform float zFps;` exposes the same value to shaders when declared.
Export frame rate overrides change frame sampling without changing `fps`, `zFps`, or clip time.
