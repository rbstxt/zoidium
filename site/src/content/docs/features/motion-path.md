---
title: Edit motion with Motion Paths
sidebar:
  label: Motion Paths
---
Move native Position keys and tangents in the main preview.

1. Select a layer clip in the timeline.
2. Press **T** to enable layer transform controls.
3. Press **O** or click the viewport's **motion paths** button.
4. Click a key square on the path.
5. Drag the square to move the key.
6. Drag a yellow tangent handle to bend the motion.

For a 3D object, select the object in **Objects** instead of a layer clip.
Position needs at least one animated axis.

Shift-click to change the selection. Hold Shift during a drag to constrain
movement. Alt-drag a tangent to break continuity. Alt-click a key to toggle
adjacent linear and bezier segments. Press Escape to cancel a drag.

[Motion Paths source contract](https://github.com/rbstxt/zoidium/blob/dev/plugins/motion-path/README.md)
describes temporal handles and edit limits.
[Motion Paths compatibility](/docs/development/project-compatibility/#motion-paths)
describes native key storage.
