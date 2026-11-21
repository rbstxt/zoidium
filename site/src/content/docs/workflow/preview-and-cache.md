---
title: Preview and cache
description: Control viewport redraws, preview resolution, playback speed, and GPU frame caching with Player+ and the preview cache.
---
Use **Player+** and the **Preview cache** to keep the viewport responsive on complex scenes without changing your project or export resolution.

## Control viewport drawing with Player+

**Player+** is enabled by default and adds drawing, quality, and speed controls to the player toolbar.

| Control | Behavior |
| --- | --- |
| **Pause drawing** | Suspends automatic viewport redraws while you edit. Does not stop the playhead or audio. |
| **Render once** | Draws the current frame on demand, including edits made while drawing is paused. |
| **Resume drawing** | Restores automatic viewport updates. Drawing starts enabled. |
| **Show transparency grid** | Shows a checkerboard behind transparent parts of the preview instead of black. Off by default. Saved locally. |
| **Preview quality** | Scales both viewport pixel dimensions to **Full quality** (default), **1/2 quality**, **1/4 quality**, or **1/8 quality**. Saved locally. |
| **Adaptive** | While playing, lowers **Preview quality** one step at a time when frames take too long, and raises it again when there is headroom. Pausing returns to the quality you chose. Off by default. Saved locally. |
| **Lowest** | Available in the quality menu when **Adaptive** is on. The lowest quality **Adaptive** may use: **Auto** (1/8), **1/2**, **1/4**, or **1/8**. Saved locally. |
| **Playback speed** | Selects **Paused**, **0.25x**, **0.5x**, **0.75x**, **1x**, **1.25x**, **1.5x**, or **2x**. Follows **J**, **K**, and **L** shuttle shortcuts, including reverse and faster shuttle speeds. |

Native audio playback follows the selected positive speed.
Click the quality button to set **Preview quality**, **Adaptive**, and **Lowest**. When the toolbar is narrow, some controls move to the **⋯** menu.

**Playback speed**, **Preview quality**, and **Adaptive** affect editor playback only. While **Adaptive** has lowered the quality, the quality menu shows it (for example **Auto · 1/4**) and the frame cache does not store those frames. Saved projects, project resolution, and export settings stay separate.

## Check transparency

Click **Show transparency grid** to see which parts of the frame are transparent. The grid appears only in the live preview: **Render once**, the eyedropper, the preview cache, and exports keep the usual black backdrop. While the grid is on, blend modes and adjustment layers see transparent black below the lowest layer instead of opaque black, so a mode that depends on the backdrop can look different from the export.

A Scene layer is transparent where nothing is drawn. To fill it, open the Scene's properties and set **Scene Backdrop** to **Solid Color**, then choose **Backdrop Color** and **Backdrop Opacity**. The backdrop is saved with the project and is drawn behind the Scene's objects, before the Scene is composited with its blend mode. **Transparent** (the default) keeps the previous output.

## Work smoothly on a heavy project

1. Confirm **Player+** is enabled in **Plugins**.
2. In the player toolbar, click **Pause drawing**.
3. Set **Preview quality** to **1/8 quality**.
4. Load the project or make your edits.
5. Move the playhead to the frame you want to check and click **Render once**.
6. For a closer look, raise **Preview quality** to **1/4 quality**, **1/2 quality**, or **Full quality**, then click **Render once** again.
7. Return to **1/8 quality** before making further expensive edits, or click **Resume drawing** when you want live updates again.

## Check playback speed with the FPS meter

Turn on **FPS meter** in the Player+ quality menu to show the playback frame rate in the top-left corner of the viewer while playing, for example `29.8 / 30 fps · cached 36 of 180`. The text turns red with **not realtime** when playback falls below the project frame rate, and returns to normal once it recovers. **cached** counts the frames that came from the preview cache. The meter is off by default and does no work while off.

## Reuse frames with the preview cache

The preview cache stores finished editor frames in GPU memory so returning to the same frame and project state redraws immediately.

A green bar along the top of the timeline ruler marks the frames that are currently cached. It shrinks when an edit, a quality change, or eviction removes frames.

1. Open **Settings**.
2. Set **Preview cache** to the maximum memory budget you want. The default is `512` MiB, and `0` disables caching.
3. Read the usage line below the control to see counted memory, retained frame count, and any active status message.

The accepted range is `0` to `16384` MiB, capped at `8192` retained frames. This setting is an upper limit, not reserved memory.
Cache memory and **Player+** preview quality are independent controls. A larger cache does not speed up the first draw of a new frame.

### What enters the cache

- Complete viewport frames are copied on the GPU and reused when the frame and project state match. A cache miss draws live.
- Project edits, [effect bypass](/docs/effects/bypass/) toggles, resource loads, resolution changes, and plugin changes invalidate the affected cached frames.
- Export and eyedropper draws use separate paths and never fill the cache.
- When paused and idle, eligible scenes pre-render a bounded window of nearby frames. Frames inside a video item's decode window, video projects with time-based effects, and slow-drawing scenes skip idle pre-rendering, though frames drawn normally can still be retained.
- While video is visible, live playback is not frame-exact, so live frames are not retained. After playback pauses and the editor stays idle for about 0.8 seconds, Zoidium decodes and retains the current frame, plus up to 30 frames ahead and 4 frames behind. **Settings** reports **Video frames are not cached in this preview.** or **Preparing video frames for the preview cache.** during these states.

### When nothing is cached

When frames cannot be retained or reused, the status line in **Settings** shows **Not caching:** followed by the reason. Raising the memory limit does not bypass these checks.

- **Unverified plugins or third-party items:** Every required plugin must be enabled at a version approved in this build's preview-cache verification list. Third-party plugin items and unapproved plugin versions render live instead of caching. When a plugin version fails verification, the status note names the plugin and version.
- **Uncacheable time effects:** Time effects that cannot cache frames render live. Smart Motion Blur does not disable caching on its own, provided its plugin version passes verification.
- **Stateful expressions:** Expressions that can retain values across frames stay on live preview. Live rendering and export are unchanged.
- **Loading or failed plugins:** Any plugin currently loading blocks caching. A bundle-load failure in an unused plugin still allows caching only if activation never started. Once activation starts, or for any enabled, required, or Core plugin, an error blocks caching for all projects until you disable or repair that plugin.
- **Pending loads or slow validation:** Resource loading, frame preparation, and exact video decoding must finish before retention. If project validation is slow, caching waits until playback stops and editing is idle.
- **3D editing camera or tiny budget:** Using the 3D editing camera, or setting a memory limit smaller than one frame, prevents new captures.

The status line updates after the next preview draw. **Pause drawing** reports its state immediately, and **Render once** can still capture a complete frame while drawing is paused.

### GPU memory limits

Above `4096` MiB, **Settings** warns that your GPU needs that much free memory. Integrated GPUs share memory with system RAM on every operating system.

If a GPU allocation fails or the WebGL context is lost, Zoidium lowers an internal session ceiling that raising the preference cannot override. After a second context loss, captures stay disabled until you reload the editor. See [Preview cache memory](/docs/development/project-compatibility/#preview-cache-memory) for technical details.
