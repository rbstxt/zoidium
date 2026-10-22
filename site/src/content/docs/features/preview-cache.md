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

## Memory limits

Counted RGBA8 bytes exclude driver overhead and other render targets. Allocation
failure or context loss lowers a session ceiling that raising the preference
cannot override. A second context loss disables captures until reload. Read
[preview cache memory](/docs/development/project-compatibility/#preview-cache-memory)
for the exact behavior.
