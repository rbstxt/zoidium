---
title: Plugin index
description: Every Zoidium plugin, its Plugins panel category, default state, and documentation link.
---
Find any plugin from the **Plugins** panel and jump straight to its guide and control reference.

## Utilities

| Plugin | Default | What it adds | Guide |
| --- | --- | --- | --- |
| **Assets** | On | Project panel for files, fonts, models, compositions, and missing-asset repair. | [Assets and project files](/docs/workflow/assets/) |
| **Animated GIF** | Off | Deterministic animated GIF decoding for layers, materials, and effect textures. | [Animated GIF](/docs/workflow/animated-gif/) |
| **Easing+** | Off | Normalized cubic Bezier curve editor with crossing handles, overshoot, and copy/paste. | [Easing+](/docs/animation/easing-plus/) |
| **Expressions+** | On | Deterministic expressions, property links, Sequence Controls, and shader helper includes. | [Expressions+ and controls](/docs/animation/expressions-plus/) |
| **Graph Editor 2** | Off | Rebuilt keyframe curve editor with track list, tangent tools, and shortcuts. | [Graph Editor 2](/docs/animation/graph-editor/) |
| **Motion Paths** | On | Draggable viewport motion paths and Bezier handles for animated Position. | [Motion Paths](/docs/animation/motion-paths/) |
| **MP4 Export** | On | H.264 MP4 export with AAC or Opus audio through WebCodecs. | [Exporting video and frames](/docs/workflow/export/) |
| **Player+** | On | Viewport **Pause drawing**, **Render once**, preview quality fractions, and playback speed. | [Preview and cache](/docs/workflow/preview-and-cache/) |
| **Precomp+** | Off | Reusable nested compositions with a **Compositions** window. | [Precomp+ compositions](/docs/workflow/precomp/) |
| **Shader+** | On | Typed custom shader controls, property groups, code completion, live checks, and templates. | [Property groups and settings](/docs/shaders/property-settings/) |

## Scene extensions

| Plugin | Default | What it adds | Guide |
| --- | --- | --- | --- |
| **Camera+** | Off | Camera+ object with depth of field, motion blur, vibrate, and shared Camera layers. | [Camera+](/docs/3d/camera-plus/) |
| **Constraints** | On | **Track To** aiming and **Follow** transform copying for 3D objects. | [Constraints](/docs/3d/constraints/) |
| **Effector** | On | Repeaters, Twist, Warp, Voronoi Fracture, Plain, and Delay for 3D hierarchies. | [Effector](/docs/3d/effector/) |
| **Effector+** | Off | Compatibility loader for legacy Effector+ projects (uses Effector implementations). | [Effector](/docs/3d/effector/) |
| **ExpressText+** | On | Tracked-letter 3D text container with an 11-effector stack and a **Split into letters** action on 3D Text rows. | [ExpressText+](/docs/2d-and-text/expresstext-plus/) |
| **Geometry+** | Off | Eight procedural 3D meshes: Rounded Box, Polyhedron, Cone, Capsule, Tube, Gear, Helix, Spline. | [Geometry+](/docs/3d/geometry-plus/) |
| **Light+** | Off | Native 3D light chooser for Spot, Point, Directional, and Hemisphere lights. | [Lights](/docs/3d/lights/) |
| **Material+** | Off | PBR+, Node Material, Matcap, UV Custom, and Image+ materials with corrected UVs. | [Material+](/docs/3d/material-plus/) |
| **Optical Flares** | Off | 3D lens flares with a 24-element stack, presets, occlusion, and custom layers. | [Optical Flares](/docs/3d/optical-flares/) |
| **Particles+** | Off | 54 monochrome particle texture sprites added to the native Texture picker. | [Particles+ sprites](/docs/3d/particles-plus/) |
| **Rowbyte & Red Giant Suite** | Off | Trapcode Particular, Trapcode Form, Plexus, and 8 Trapcode Lights. | [Trapcode Suite](/docs/3d/trapcode-suite/), [Particular](/docs/3d/trapcode-particular/), [Form](/docs/3d/trapcode-form/), [Plexus](/docs/3d/plexus/), [Lights](/docs/3d/lights/) |
| **Shape+** | On | Vector shape layers, editable paths, layer masks for Scene and Adjustment clips, and 2D vector text. | [Shape+ and layer masks](/docs/2d-and-text/shape-plus/) |
| **Text+** | On | Per-character animation for 2D and 3D text, 3D Character Material, and 3D bevel controls. | [Text+](/docs/2d-and-text/text-plus/) |

## Adjustment extensions

| Plugin | Default | What it adds | Guide |
| --- | --- | --- | --- |
| **AfterClip** | Off | 32 standalone shaders and 11 group presets (migration pack). | [Shader packs](/docs/effects/shader-packs/) |
| **Afterzoid Shader Pack 5** | Off | 200 shader presets by AlipFX under **ALIPFX · SHADER PACK 5**. | [Shader packs](/docs/effects/shader-packs/) |
| **CCFX Shader Pack** | Off | 12 standalone shaders and 7 group presets. | [Shader packs](/docs/effects/shader-packs/) |
| **Magic Looks** | Off | Reorderable 29-tool color, light, and lens grading chain with presets and LUT support. | [Magic Looks](/docs/effects/magic-looks/) |
| **Native FX** | Off | 23 native image, time, keying, generator, transition, and Smart Motion Blur effects. | [Native FX](/docs/effects/native-fx/), [Motion blur](/docs/effects/motion-blur/) |
| **Node Effect** | On | GPU node graph for building custom layer filters that save as native Custom Shaders. | [Node Effect](/docs/effects/node-effect/) |
| **OpenZoid Legacy** | Off | Echo, Posterize Time, Jpeg Damage, VHS, Datamosh, Tracery, ASCII, and True datamosh WebM export. | [OpenZoid Legacy](/docs/effects/openzoid-legacy/) |
| **S_Glow (beta 1.0)** | Off | High-precision threshold glow with per-channel spread, border expansion, and atmosphere. | [S_Glow](/docs/effects/s-glow/) |
| **ZSMB (beta 1.0)** | Off | Lightweight optical-flow motion blur with selectable analysis quality levels. | [Motion blur](/docs/effects/motion-blur/) |

## Experimental

| Plugin | Default | What it adds | Guide |
| --- | --- | --- | --- |
| **Layer Input** | Off | Uses another video track or image as an effect source, displacement map, material, or shader input. | [Layer Input](/docs/workflow/layer-input/) |

## Built-in core features

**Zoidium Core** always runs and does not appear in the **Plugins** panel.
It provides editor layouts, themes, pop-out windows, preview cache, restore points, [typed timeline seeking](/docs/workflow/timeline/), [per-effect bypass](/docs/effects/bypass/), linked-clip cleanup, multi-clip trimming, frame-rate timing preservation, single frame capture, and custom export resolutions.

## Reading control tables

Defaults in this documentation describe newly created objects, effects, or controls.
A dash (`—`) in a range column means no minimum or maximum is declared.
When you change a sequence's frame rate, Zoidium keeps supported clip boundaries, keyframes, and timing controls in seconds. Expressions based on `frame` keep their per-frame meaning. See [Timeline and frame rate](/docs/workflow/timeline/).
