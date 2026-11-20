---
title: Shader packs (AfterClip, CCFX, Afterzoid)
description: Enable and use the bundled AfterClip, CCFX Shader Pack, and Afterzoid Shader Pack 5 (AlipFX) effect packs and group presets.
---
Zoidium ships three optional shader preset packs under **Adjustment Extensions** in **Plugins**.
Standalone presets add one shader effect; group presets insert a saved effect group with editable child effects (expand a group's children to inspect or tweak its full chain).

## AfterClip (32 shaders, 11 groups)

Migration pack for AfterClip users. Enable **AfterClip** in **Plugins**, then look under **AFTERCLIP** in the Effects picker.
Property names vary by preset: many shapes expose **Position**, **Rotation**, **Scale**, and **Opacity**, while presets like **Line Wave** use **Time**, **Delay**, **Power**, and **Step**. **Twitch** and **VHS** are not included in this pack.

### Standalone effects

- **SHADERS · REPEAT:** **Circle Dot Wave**, **Dot Wave**, **Duplicate (Extended)**, **Gradient Linear Repeat**, **Hex Dot Wave**, **Linear Repeat**, **Radial Repeat**, **Stroke (Extended)**
- **SHADERS · SHAPE:** **Arrow Shape**, **Chevron**, **CLE**, **Gradient (Easeable)**, **Hex Net**, **Line Wave**, **Line Wave Mask**, **Lines**, **Net**, **PinWheel**, **Plain Wave**, **Plain Wave Mask**, **Polygon**, **Polygon Echo**, **Repeating Dots**, **RoundedStar**, **Shockwave**, **Triangle**
- **SHADERS · WARP:** **Fractal Noise**, **Fractal Warp**, **Mirror (Fixed)**, **Polar Coordinates**, **Stretch**, **Wavy (Extended)**

### Group presets

| Preset | Direct children | Notes |
| --- | --- | --- |
| **Circular DotWave** | 4 | Group preset |
| **Hex DotWave** | 5 | Group preset |
| **Square DotWave** | 5 | Group preset |
| **Arrow Effect** | 11 | Group preset |
| **Burst** | 3 | Group preset |
| **Fractal Burst** | 8 | Group preset |
| **Fireworks** | 4 | Group preset |
| **Line Waves** | 6 | Group preset |
| **Spiral** | 5 | Group preset |
| **ChevSync** | 1 | Animate **Sync**, **Ratio**, **Power**, and **Amount** |
| **SyncTools v2** | 1 | Group preset |

## CCFX Shader Pack (12 shaders, 7 groups)

Enable **CCFX Shader Pack** in **Plugins**, then look under **CCFX SHADER PACK** in the Effects picker.
Property capitalization and timing differ per preset. Presets with an existing time expression (for example, **Sunburst V2** drives `uTime` with `time`) should keep that expression unless you want manual timing.

### Standalone effects

- **BACKGROUNDS:** **Sunburst V2** (`rotation`, `speed`, `scale`, `center`), **Voronoi Cell Pattern**
- **DISTORT:** **Puddle**, **Skew V2**, **Warp Waves**
- **TRANSITIONS:** **Wipe Checker**, **Wipe Dots**, **Wipe Rings**, **Wipe Stripes**
- **PART 2:** **CC Light Sweep**, **Lens Flare Lite**, **Plexus V1**

### Group presets

| Preset | Direct children | Notes |
| --- | --- | --- |
| **MxsterFX Dot BG (By CCFX)** | 2 | Background group |
| **MxsterFX Square BG (By CCFX)** | 2 | Background group |
| **Extrude** | 1 | Group preset |
| **CC Bend It** | 2 | Exposes **Start**, **End**, and **Bend** on the group |
| **Hexagon Array** | 1 | Group preset |
| **Plexus V2** | 2 | Group preset |
| **AE Warp** | 1 | Group preset |

## Afterzoid Shader Pack 5 (AlipFX, 200 shaders)

1. In **Plugins**, enable **Afterzoid Shader Pack 5**.
2. Select a clip, open the Effects picker, and search under **ALIPFX · SHADER PACK 5**.
3. Add the effect and edit its native properties.

To build a customized version or replace numbered AlipFX color properties with a Shader+ Gradient, see [Porting shaders](/docs/shaders/porting/#replace-numbered-alipfx-colors). Keep the original preset whenever exact pixel compatibility is required.
