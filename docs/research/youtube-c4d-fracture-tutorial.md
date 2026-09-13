# Notes on Fibly's Cinema 4D text-fracture tutorial

Research date: 2026-09-12

Source: [Fibly, "Intro Tutorials - Text Fracture (Voronoi fracture)"](https://www.youtube.com/watch?v=_IiFVQllJfs), uploaded 2023-02-08. The description identifies Cinema 4D R26 as the application used.

## How the video was checked

I downloaded the 6:36 video and its original English automatic captions with `yt-dlp`, then inspected frames at ten-second intervals and at every UI operation listed below. The video stayed in a temporary directory and was not added to the repository. Automatic captions misrecognize a few product terms, so the object names and settings in this note come from the visible Cinema 4D UI.

## What the tutorial actually teaches

The tutorial teaches a procedural fracture setup. It does not demonstrate a complete animation of text breaking over time. The only motion tool created during the lesson is a Random Effector, used briefly to pull pieces apart and confirm that the fracture is working. There is no keyframed fracture strength, moving Field, Delay Effector, rigid-body simulation, or impact propagation in the video.

The useful part for Zoidium is the geometry recipe:

1. Keep the text editable and organize each letter or text section under its own null.
2. Center the text hierarchy before inserting a Voronoi Fracture object.
3. Put a Voronoi Fracture around each letter's geometry.
4. Use a seeded distribution source for irregular chunks.
5. Replace the distribution with the points of a subdivided cube to make aligned strips or blocks.
6. Split or duplicate the text into regions so irregular and block-shaped fracture patterns can coexist.

Cinema 4D's current documentation confirms the underlying model. [Voronoi Fracture](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI.html) clips a volumetric object with Voronoi cells generated from source points and exposes the fragments to MoGraph Effectors. Maxon recommends closed volumetric meshes. Its [Sources](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI-ID_SOURCES.html) can use polygon objects, splines, generators, particles, or built-in point distributions. Uniformly subdivided source objects produce rectangular fragments, which explains the cube method in the video.

## Timestamped walkthrough

| Time | Operation shown | What matters for CM3/Zoidium |
| --- | --- | --- |
| [0:00](https://www.youtube.com/watch?v=_IiFVQllJfs&t=0s) | The author recommends adding fracture while the text setup is still being built. | The fracture parent should retain editable source children. Generated pieces should remain derived runtime geometry, not replace the Text or Shape source. |
| [0:15](https://www.youtube.com/watch?v=_IiFVQllJfs&t=15s) | The text already has separate layers and letter hierarchies. | A `Per Child` input mode is needed. It should fracture each direct child in its own bounds instead of joining the entire group before cutting. |
| [0:25](https://www.youtube.com/watch?v=_IiFVQllJfs&t=25s) | All text components and origins are centered. | Fragment geometry and piece pivots must use a well-defined parent-local coordinate system. The plugin can remove C4D's manual centering requirement by normalizing child transforms internally. |
| [0:38](https://www.youtube.com/watch?v=_IiFVQllJfs&t=38s) | A Voronoi Fracture is placed under each letter's null. The Object Manager shows one generator for B, R, O, K, and E. | `Fracture Scope = Per Child` should derive a stable seed for every child and keep gaps between letters from influencing the cells. |
| [1:05](https://www.youtube.com/watch?v=_IiFVQllJfs&t=65s) | The author continues editing the text after inserting the generators. | Source edits must invalidate and rebuild the cached fragments. Timeline-only changes should not regenerate geometry. |
| [1:12](https://www.youtube.com/watch?v=_IiFVQllJfs&t=72s) | R26 sometimes fails to refresh the fracture preview; toggling the generator fixes it. | Treat this as a C4D refresh quirk, not a feature to reproduce. Zoidium needs explicit dirty flags for source geometry, fracture settings, and transforms. |
| [1:35](https://www.youtube.com/watch?v=_IiFVQllJfs&t=95s) | The generated cells are visible. The author then disables `Colorize Fragments`, finishing around 1:57, to return to the normal material view. | Add a `Colorize Fragments` diagnostic toggle. Maxon describes it as random coloring for distinguishing pieces in the [Voronoi object properties](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI-ID_OBJECTPROPERTIES.html). |
| [1:58](https://www.youtube.com/watch?v=_IiFVQllJfs&t=118s) | The fracture generators are selected and a Random Effector is created. It scatters pieces in position so their shapes can be inspected. | Fracture topology and piece motion are separate stages. Generate closed piece meshes first, then apply seeded per-piece position, rotation, and scale offsets. [Maxon's Effector documentation](https://help.maxon.net/c4d/en-us/Content/html/7443.html) confirms that Effectors transform clone position, size, and angle. |
| [2:06](https://www.youtube.com/watch?v=_IiFVQllJfs&t=126s) | The author warns that hollow-looking pieces come from text that was not generated as a single closed object. The R26-era fix is `Create Single Object`. | CM3 Text and Shape sources must produce closed front, back, side, bevel, and cut surfaces. A surface-only split will not match this tutorial. |
| [2:55](https://www.youtube.com/watch?v=_IiFVQllJfs&t=175s) | `Sources > Viewport Amount` is set to 10 percent on all fracture generators. The viewport displays fewer, larger pieces. | Add a preview-quality control, but always use full quality for export. Maxon's [Sources documentation](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI-ID_SOURCES.html) says this range is 10 to 100 percent and does not reduce final render output. |
| [3:33](https://www.youtube.com/watch?v=_IiFVQllJfs&t=213s) | Increasing the distribution source's point amount creates more, smaller fragments. | `Piece Count` and `Seed` belong to the fracture-source stage. Piece identity must stay deterministic when unrelated animation properties change. |
| [3:49](https://www.youtube.com/watch?v=_IiFVQllJfs&t=229s) | The built-in distribution source is removed to demonstrate another source type. | Source selection needs at least `Distribution` and `Grid` modes. Arbitrary scene-object sources can wait. |
| [4:07](https://www.youtube.com/watch?v=_IiFVQllJfs&t=247s) | The author says any point-bearing object can act as a source. | This matches Maxon's current [Point Source Object documentation](https://help.maxon.net/c4d/2026/en-us/Content/html/TFRACTUREVORONOI.html). A later `Source Child` mode could read vertices from one designated child. |
| [4:10](https://www.youtube.com/watch?v=_IiFVQllJfs&t=250s) | A cube is sized to cover the whole text and hidden from rendering. | CM3 does not need a real helper cube for this common case. A `Grid` source can generate lattice points directly inside the group's bounding box. |
| [4:20](https://www.youtube.com/watch?v=_IiFVQllJfs&t=260s) | The cube is placed in the Sources list for all letter fractures. | Transform grid points into each child's fracture-local space before cutting. One global grid should align cuts across children when `Scope = Combined`; per-child grids should remain independent. |
| [4:40](https://www.youtube.com/watch?v=_IiFVQllJfs&t=280s) | Increasing Cube `Segments X` creates narrow vertical slices. Increasing `Segments Y` creates horizontal bands and block-like cells. | Expose `Grid X`, `Grid Y`, and `Grid Z`. A grid rotation and seeded jitter would cover most useful variants without arbitrary source-object support. |
| [5:00](https://www.youtube.com/watch?v=_IiFVQllJfs&t=300s) | High segment counts freeze the viewport for several seconds. | Cache fracture geometry by input geometry, seed, scope, and source settings. The per-frame path should only update piece transforms and visibility. Add a conservative piece limit and a warning before expensive rebuilds. |
| [5:16](https://www.youtube.com/watch?v=_IiFVQllJfs&t=316s) | The author duplicates the text so one copy can use block cuts and another can use irregular Voronoi cuts. | Users need to stack or duplicate `Fracture+` objects without serialized type conflicts. Do not make the fracture mode global to the scene. |
| [5:40](https://www.youtube.com/watch?v=_IiFVQllJfs&t=340s) | The author proposes combining the differently fractured layers with masks or pre-splitting the text. | Region mixing is composition, not a new cutting algorithm. The first release can rely on separately prepared child regions. A later `Region` control can select pieces by normalized X, Y, or Z. |
| [5:50](https://www.youtube.com/watch?v=_IiFVQllJfs&t=350s) | A separate project uses imported vector letters already split into top, middle, and bottom geometry. | The fracture parent must accept Shape and Model children, not only Text. Closedness checks and a polygon-cluster fallback are needed for arbitrary imports. |
| [6:10](https://www.youtube.com/watch?v=_IiFVQllJfs&t=370s) | The sample shows independent settings per region: irregular pieces in the middle, block cuts on top and bottom. | This mixed pattern is a large part of the look in the user's references. Support it through nested groups or multiple fracture parents before attempting an all-in-one region editor. |

## The missing animation layer

The tutorial ends after constructing the fragments. To make the requested "breaking apart" effect, Zoidium needs a second, deterministic evaluation stage.

For each fragment `i`, store an assembled transform and a seeded broken transform. At frame `t`, evaluate a weight:

```text
weight_i(t) = amount(t) * field(fragmentCenter_i, t)
```

Interpolate position and scale, and slerp rotation, between the assembled and broken transforms. Animate `Amount` from 0 to 1 for destruction and from 1 to 0 for assembly. A moving Linear Field makes the fracture travel across the word instead of affecting every piece at once. Maxon documents the same separation: a [Plain Effector](https://help.maxon.net/c4d/2026/en-us/Content/html/OEPLAIN.html) provides transforms, while a [Linear Field](https://help.maxon.net/c4d/2026/en-us/Content/html/FLINEAR.html) limits the influence along its local X axis.

Recommended motion controls:

- `Amount`, animatable from assembled to broken.
- `Position`, `Rotation`, and `Scale` ranges for the broken transform.
- `Seed`, shared with or separate from the fracture seed.
- `Field Type`: Uniform, Linear, Spherical, or Noise.
- `Field Position`, `Width`, `Feather`, and `Invert`.
- `Direction`: Random, Outward from object center, Along field, or Custom vector.
- `Response`: Direct or analytic Spring. Stateful physics should not be required for normal timeline playback.

The Random Effector shown at [1:58](https://www.youtube.com/watch?v=_IiFVQllJfs&t=118s) maps to the seeded broken transforms. It does not explain progressive timing, so a Field or per-piece delay is an implementation addition rather than a claim about the video.

## Recommended `Fracture+` design after watching the tutorial

### Input

- `Scope = Per Child | Combined`.
- Accept Text, Shape, Model, and nested Group children.
- Preserve source children in project serialization and generate fragments at runtime.
- Normalize source geometry into fracture-parent local space, while retaining each child's material assignment and transform.

`Per Child` should be the default for text. It reproduces the video's per-letter nulls without forcing the user to build five separate generators for a five-letter word.

### Fracture source

- `Distribution`: seeded irregular points, with count and optional bias.
- `Grid`: direct lattice generation with X, Y, Z divisions, rotation, and jitter.
- `Source Child`, later: read vertices or generated points from a designated child.

The Grid mode deserves first-release status. It is not a minor variant. The tutorial uses it for the long bands and block-shaped pieces that distinguish the final sample from a generic pile of Voronoi rubble.

### Geometry strategy

Start the implementation with a geometry spike comparing two paths. The fast fallback clips a seeded 2D Voronoi diagram or grid against each glyph region, preserves holes, and extrudes every clipped region. It produces closed front, back, side, and cut surfaces and covers the tutorial's block pattern when `Grid Z = 1`.

The main production path should intersect the source mesh with convex 3D Voronoi cells. A practical implementation for the legacy Three.js runtime is a small BSP/CSG layer that carries the source face material index through intersections and assigns a new material index to cell faces. This is slower to build than the 2D path, but the result can divide through the text depth like Cinema 4D. It requires robust tolerances, cap generation, and tests for glyph holes and bevels.

Arbitrary imported meshes should use a surface/polygon-cluster fallback until the solid path is stable. Label the fallback clearly because it cannot create the cut faces visible in the tutorial. The 2D path should remain available as a `Fast Extruded` mode. It suits front-facing titles, but rotating its pieces exposes the common full-depth slab shape.

### Performance and determinism

- Cache a fragment build by source-geometry signature, fracture mode, scope, point source, count, and seed.
- Never rebuild fragments because `Amount`, field position, or motion ranges changed.
- Derive stable piece IDs and per-child seeds from serialized IDs, not traversal order.
- Provide `Preview Quality`, but restore full topology for export and final render.
- Preserve the complete deterministic point list. Preview reduction may use a prefix of that list so changing quality does not reshuffle every source point.
- Add `Auto Update` and a manual `Rebuild` button if rebuild cost becomes noticeable. Maxon's object properties expose the same choice because fracture changes can take long enough to interrupt editing.

The current object plugin lifecycle does not tell an object whether `update()` is preparing an editor frame or an export frame. Automatic full-quality export therefore needs a small Zoidium core signal such as `renderPurpose = editor | export`. Without that addition, `Preview Quality` must remain a manual control so an export cannot silently change topology.

### Materials and diagnostics

- `Colorize Fragments` for temporary visual inspection.
- `Inside Material` or at least `Inside Color` for generated cut faces.
- Retain the child's normal material on original outer surfaces.
- Report open or non-manifold inputs and state when the plugin falls back to surface fragments.

## Practical conclusion

The video strengthens the case for one parent object with child-aware fracture. It also changes the priority order. A useful first release needs both irregular and grid source modes, closed Text/Shape fragments, deterministic Random motion, and a moving Field. Arbitrary source objects and general 3D model cutting can follow.

The animation goal cannot be met by copying the tutorial alone. The tutorial supplies the procedural fragment generator. Zoidium must add the progression system that moves stable pieces between assembled and broken transforms. That split is good news: fracture geometry can stay cached while the timeline updates only matrices, which is much cheaper than cutting the mesh every frame.

## Fit with the current Zoidium runtime

Implement this as a new `plugins/fracture-plus/` object plugin with a stable type such as `zoidium:fracture-plus/fracture`. The class can extend `PZ.object3d.group`, following the existing Repeater implementation. It should call the normal child update first, hide or detach source render meshes, and add generated shard roots to its own Three.js object.

The existing implementations already cover most of the surrounding mechanics:

- Repeater demonstrates source-child ownership, runtime-only generated objects, geometry signatures, deterministic random transforms, disposal, and serialization.
- Text+ demonstrates rebuilding editable Text as per-character runtime meshes. Nesting `Fracture+ > Text+ > Text` can supply the per-letter meshes used by the tutorial without making a five-letter word require five manual fracture generators.
- Geometry+ demonstrates procedural `THREE.Geometry` and `THREE.Face3` construction in the bundled Three.js r91 runtime.
- The custom object registry already preserves unavailable `zoidium:` object types as placeholders and restores them after the plugin is enabled.

Structural controls such as source mode, count, seed, scope, grid divisions, and quality should not be keyframeable. They invalidate topology. Motion controls such as Amount, field position, scatter, rotation, and scale should be keyframeable and must never trigger a rebuild.

Each shard should be a mesh under an `Object3D` pivot at its centroid. At Amount 0, the pivots reproduce the source exactly. At Amount 1, they use their seeded broken transforms. The original source material stays on inherited faces, while generated cell faces use an appended inside-material slot.

## Proposed delivery plan

| Phase | Work | Estimate |
| --- | --- | ---: |
| Geometry spike | Test 2D extrusion and 3D BSP/CSG intersection on `B`, `R`, and `O`, including holes and bevels. Set performance thresholds before committing to the solid path. | 3 to 5 days |
| Parent and animation | Add the object class, source capture, serialization, caching, disposal, per-child scope, Amount, seeded motion, and Linear/Spherical progression. | 5 to 8 days |
| Tutorial fracture modes | Add Distribution and Grid sources, debug colors, inside faces, conservative limits, and preview quality. | 5 to 8 days |
| Solid 3D hardening | Handle depth cuts, numerical tolerances, material indices, non-manifold warnings, Text+/Repeater nesting, and export consistency. | 7 to 12 days |
| Region composition | Validate multiple Fracture+ parents and add normalized-axis region selection only if separate child regions are too awkward. | 3 to 5 days |

A usable fast-extruded version is about two to three weeks of full-time work. The recommended version with true depth-dividing cells is about four to six weeks. Robust arbitrary-model support is a separate six-to-ten-week scope and should not block the text effect.

Suggested acceptance targets:

- A 50-piece text fracture builds in under 500 ms on a typical desktop, and a 120-piece build stays under two seconds.
- Cached playback only changes matrices and sustains the normal CM3 preview rate.
- The same project, frame, settings, and seed produce identical geometry and transforms after reload and during export.
- Amount 0 reproduces the intact source without visible gaps; moving the field opens inside faces progressively.
- Open or non-manifold meshes produce an English warning and a documented surface fallback instead of missing or corrupt geometry.
