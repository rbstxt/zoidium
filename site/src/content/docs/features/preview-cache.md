---
title: Preview cache
---
Settings > Preview cache sets how much memory the preview cache may use for finished editor
frames. The default is 512 MiB; 0 disables caching. The accepted setting is up to
16384 MiB, with at most 8192 retained frames. This is a limit, not reserved memory.

## What is cached

A complete frame can be copied on the GPU and shown again at the same frame and
project state. A cache miss draws live. Resource loading, project edits, resolution
and plugin changes invalidate the relevant state. Export and eyedropper draws
use separate paths and do not fill the cache.

When paused and idle, eligible scenes pre-render a bounded window.
Candidates inside a video item's decode window skip that
work. Video projects with time-based effects skip all idle pre-rendering.
Scenes that draw slowly also skip it. Frames shown normally can still
be retained.

While video is visible, the editor's own video playback is not frame-exact, so
live draws are not retained. Instead, when playback is paused and the editor is
idle for about 0.8 seconds, the current frame and then up to 30 frames ahead
and 4 behind are decoded exactly and retained. Playback and other frames still draw live.
**Settings** shows **Video frames are not cached in this preview.** or
**Preparing video frames for the preview cache.** for these states.

## When nothing is cached

The usage note shows **Not caching:** and the current reason when preview frames
cannot be retained or reused. A larger memory limit does not remove these checks.

- Community content and plugin versions without cache verification use live previews.
  The note identifies the required plugin and its version when available.
- Time effects that cannot cache frames use live evaluation. Smart Motion Blur
  does not disable caching by itself, but its plugin version must pass verification.
- Any loading plugin prevents caching. A required plugin's error also prevents
  caching. Core errors always block caching.
- Resource loading, frame preparation, and exact video decoding must finish before
  a frame can be retained.
- If project validation is slow, caching waits until playback stops and
  editing is idle before it validates a changed state.
- The 3D editing camera and a memory limit smaller than one frame also prevent
  new captures.

The note updates after the next preview draw. **Pause drawing** stops normal
preview draws and reports its state without a draw. **Render once** can capture
a complete frame while drawing is paused. Idle pre-rendering has its own checks.

## Memory limits

Allocation failure or context loss lowers a session ceiling that raising the preference
cannot override. A second context loss disables captures until reload. Read
[preview cache memory](/docs/development/project-compatibility/#preview-cache-memory)
for the exact behavior.

Above 4096 MiB, Settings warns that the GPU needs the selected amount of free
memory. Integrated GPUs share memory with system RAM on any operating system.
