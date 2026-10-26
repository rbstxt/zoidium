---
title: Preview cache
---
Settings > Preview cache sets the maximum counted memory for finished editor
frames. The default is 512 MiB; 0 disables caching. The accepted setting is up to
16384 MiB, with at most 8192 retained frames. This is a limit, not reserved memory.

## What is cached

A complete frame can be copied on the GPU and shown again at the same frame and
project state. A cache miss draws live. Resource loading, project edits, resolution
and plugin changes invalidate the relevant state. Export and eyedropper draws
keep their own paths; caching does not change saved project content.

When paused and idle, eligible scenes pre-render a bounded window through a
private project copy. Video projects and scenes taking over 50 ms for a synchronous
draw skip that work. Frames shown normally can still be retained.

## When nothing is cached

The usage note shows **Not caching:** and the current reason when preview frames
cannot be retained or reused. A larger memory limit does not remove these checks.

- Community content and plugin versions without cache verification use live previews.
  The note identifies the required plugin and its version when available.
- Time operators without frame samplers use live evaluation. Smart Motion Blur
  does not disable caching by itself, but its plugin version must pass verification.
- Resource loading, frame preparation, and exact video decoding must finish before
  a frame can be retained.
- If project validation takes over 8 ms, caching waits until playback stops and
  editing is idle before it validates a changed state.
- **Pause drawing**, the 3D editing camera, and a memory limit smaller than one
  frame also prevent new captures.

The note updates after the next preview draw. **Pause drawing** reports its state
without a draw. **Render once** can capture a complete frame while drawing is paused.

## Memory limits

Counted RGBA8 bytes exclude driver overhead and other render targets. Allocation
failure or context loss lowers a session ceiling that raising the preference
cannot override. A second context loss disables captures until reload. Read
[preview cache memory](/docs/development/project-compatibility/#preview-cache-memory)
for the exact behavior.

Above 4096 MiB, Settings warns that the GPU needs the selected amount of free
memory. Integrated GPUs share memory with system RAM on any operating system.
