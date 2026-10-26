---
title: Frame a scene with Camera+
sidebar:
  label: Camera+
---
Choose a Camera+ object for a 3D Scene.

1. Open the scene's 3D picker.
2. Add **Camera > Camera+**.
3. Enable **Active Camera**.
4. Set the camera's Position and Rotation.
5. Set the film or field-of-view controls.
6. Inspect the output with the editing camera off.

## Set focus

1. Enable **Depth of Field**.
2. Set **Focus distance**.
3. To follow an object, click **Link** in the depth-of-field rows.
4. Choose a target in the same scene.

Use **Set** for a focus-distance key at the playhead. Use **Unlink** to remove
the expression. Relink after moving the camera or target to another group or track.

## Share a camera

1. Drag the **Camera** Media tile into the timeline.
2. Enable **3D** in each video track that must follow the camera.
3. Animate the camera object's properties.

[Camera+ source contract](https://github.com/rbstxt/zoidium/blob/dev/plugins/camera-plus/README.md)
describes camera selection, motion blur, focus links, and saved formats.

Control reference: [camera-plus](/docs/reference/camera-plus/).
