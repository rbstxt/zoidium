---
title: Export an MP4
sidebar:
  label: MP4 export
---
Render an opaque H.264 movie from the current project.

1. Enable **MP4 Export** in Plugins.
2. Open the native **Device** render page.
3. Choose **H.264 MP4** in the format selector.
4. Set the output size and frame rate.
5. Set **Bitrate** for MP4 quality.
6. Start rendering.
7. Download the finished movie through the in-place download button.

If the browser cannot encode the requested H.264 configuration, change the size,
rate, or browser. If the output needs transparency, choose a format that preserves
alpha. H.264 MP4 is opaque.

[MP4 export source contract](https://github.com/rbstxt/zoidium/blob/dev/plugins/mp4-export/README.md)
describes codec support, audio, padding, temporary storage, and cancellation.
[Saving and restore points](/docs/development/project-saving/) describes editable archives.
