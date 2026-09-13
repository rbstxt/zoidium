# Cinema 4D fracture research for Zoidium

Research date: 2026-09-12

## Conclusion

Cinema 4D has a direct reference implementation for the intended effect: **Voronoi Fracture**. It cuts a closed mesh into volumetric cells, creates new interior faces, and exposes the resulting fragments to MoGraph Effectors, Fields, sorting, and Dynamics.

The closest Cinema 4D recipe for text assembling from scattered debris is:

1. Extruded text inside a Voronoi Fracture object.
2. A point distribution biased toward the desired impact or reveal area.
3. A Plain Effector for the main offset, rotation, and scale.
4. A moving Linear Field to sweep the effect across the word.
5. A weak Random Effector for irregularity.
6. Optionally, a Delay Effector in Spring mode for overshoot.
7. A separate material on the generated inside faces.

This means the earlier surface-face clustering idea is useful, but it corresponds more closely to Cinema 4D's PolyFX than to Voronoi Fracture. Matching the reference images closely requires closed fragments with visible cut faces.

## Relevant Cinema 4D features

### Voronoi Fracture

[Voronoi Fracture](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI.html) divides an object into smaller fragments that preserve the original shape when assembled. Its cells are derived from source points, and the generated pieces can be controlled by MoGraph Effectors and Dynamics.

The [Sources settings](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI-ID_SOURCES.html) accept point-based sources, splines, polygon objects, generators, and particles. Dense source points create smaller local fragments, while sparse regions create larger fragments. The [Distribution Source](https://help.maxon.net/c4d/2026/en-us/Content/html/OPOINTCREATOR_PANEL-ID_POINTCREATOR_CREATEPOINTSTAB.html) provides seeded point counts and Uniform, Normal, Inverse Normal, and Exponential distributions.

The [Object Properties](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI-ID_OBJECTPROPERTIES.html) include fragment gaps, cell scaling, hull-only output, thickness, hole closing, and optimization. Cell scaling is especially useful for directional splinters rather than uniformly round cells.

[Selection tags](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI-ID_FRACTURE_SELECTION_TAGS.html) distinguish inside faces, outside faces, and break edges. This is what makes a contrasting interior material practical. The [Detailing settings](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI-ID_FRACTURE_DETAILING_TAB.html) subdivide fragments and add noise to interior break surfaces while preserving the original outside surface.

The [Sorting settings](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI-ID_FRACTURE_SORTTAB.html) order fragments by axis or distance. That order can drive a sequential reveal.

### Fracture Object and PolyFX

The [Fracture Object](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTURE.html) does not cut new Voronoi shards. It treats its child objects as MoGraph clones, which is directly analogous to a new Zoidium parent operating on existing group children. Its [object modes](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTURE-ID_OBJECTPROPERTIES.html) can treat each child as one clone or separate already-disconnected polygon islands and spline segments.

[PolyFX](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_POLYFX.html) treats existing polygons or spline segments as clones. Its fragment fineness depends on the mesh's existing subdivision. It is a good analogy for a surface-only or face-cluster mode, but it does not produce the solid cut cells seen in the close-up reference.

### Effectors and Fields

[MoGraph Effectors](https://help.maxon.net/c4d/en-us/Content/html/7443.html) modify clone position, scale, rotation, and related properties. Their order matters.

- The [Plain Effector](https://help.maxon.net/c4d/2026/en-us/Content/html/OEPLAIN.html) supplies the principal transform and lets Fields control where it applies.
- The [Random Effector](https://help.maxon.net/c4d/2026/en-us/Content/html/OERANDOMIZE.html) adds randomized position, rotation, size, color, or weight.
- The [Step Effector](https://help.maxon.net/c4d/2026/en-us/Content/html/OESTEP.html) interpolates an effect across clone indices.
- The [Delay Effector](https://help.maxon.net/c4d/2026/en-us/Content/html/OEDELAY.html) smooths or delays prior transformations. Spring mode adds overshoot and residual motion, and must follow the Effectors it modifies.

[Fields](https://help.maxon.net/c4d/2026/en-us/Content/html/58091.html) provide spatial values that control effect strength and can be blended. A moving [Linear Field](https://help.maxon.net/c4d/2026/en-us/Content/html/FLINEAR.html) is the most direct way to sweep assembly or disassembly across text. A [Random Field](https://help.maxon.net/c4d/2026/en-us/Content/html/FRANDOM.html) can make the boundary less mechanically uniform.

### Dynamics, glue, and connectors

Voronoi pieces can receive [Rigid Body dynamics](https://help.maxon.net/c4d/2026/en-us/Content/html/42854.html). [Geometry Glue](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI-ID_FRACTURE_GLUE_TAB.html) reconnects adjacent pieces into larger irregular clusters, while [Connectors](https://help.maxon.net/c4d/2026/en-us/Content/html/OMOGRAPH_FRACTUREVORONOI-ID_FRACTURE_AUTOCONNECTOR_TAB.html) can break under force, torque, or Field influence.

Dynamics are useful for physically falling or colliding debris, but a deterministic Effector-and-Field animation is a better first implementation for reproducible timeline scrubbing and export.

## Other DCC references

Houdini's official [Voronoi Fracture SOP](https://www.sidefx.com/docs/houdini/nodes/sop/voronoifracture-.html) follows the same basic model: an input mesh and cell points produce solid pieces with interior surfaces, while denser points create smaller fragments. Its [Voronoi fracture workflow](https://www.sidefx.com/docs/houdini/dyno/voronoifracture.html) also emphasizes point distribution, clustering, and interior detail.

Blender offers the community-maintained [Cell Fracture extension](https://extensions.blender.org/add-ons/cell-fracture/). It supports the same broad cell-fracture idea, but Cinema 4D's MoGraph integration is the stronger interaction model for this Zoidium feature.

## Proposed Zoidium mapping

Use one new parent object, provisionally named `Fracture+`, with a `Fracture Mode` property:

| Mode | Cinema 4D analogue | Behavior |
| --- | --- | --- |
| `Children` | Fracture Object | Treat each direct child or disconnected source part as a piece. |
| `Polygons` | PolyFX | Treat faces or connected face clusters as surface pieces. Fast, but no solid interior. |
| `Voronoi` | Voronoi Fracture | Generate closed cells and inside faces. Best match to the references. |

Recommended property groups:

- **Fracture:** mode, piece count, seed, distribution, per-object behavior, cell scale, and fragment gap.
- **Transform:** amount, position, rotation, scale, and randomness.
- **Field:** Uniform, Linear, Spherical, or Step; position, axis, width, falloff, and invert.
- **Sorting:** axis, distance, or random; direction/invert.
- **Response:** Direct, Smooth, or analytic Spring.
- **Surface:** outside appearance, inside material/color, and later interior noise.

The first release should integrate these controls into the parent object instead of recreating Cinema 4D's entire free-standing Effector and Field object graph. A later generic Effector system could reuse the same evaluation layer.

Generated fragments should stay runtime-only. Project serialization should retain source children and settings, while fragment meshes are cached by source-geometry and fracture-setting signatures.

## Technical reality and recommended scope

The current runtime provides legacy Three.js geometry primitives but not a ready-made convex-fracture implementation. True arbitrary 3D Voronoi fracture therefore requires robust half-space clipping or CSG, cap generation, inside/outside face classification, and careful numerical tolerances.

A text-first implementation is more realistic: intersect a seeded 2D Voronoi diagram with extruded glyph regions, then extrude the resulting cells. This produces closed pieces and interior faces for the most important use case without first solving arbitrary non-convex 3D mesh fracture.

| Scope | Estimate | Feasibility | Visual result |
| --- | ---: | ---: | --- |
| Children + polygon clusters + transform/field controls | 7–10 working days | 85–95% | Similar movement, visibly more like PolyFX than solid fracture. |
| Closed Voronoi for Text and simple extruded Shapes | 3–4 weeks total | 65–75% | Close to the reference for titles and logos. |
| Arbitrary closed models, robust inside faces, detailing, and broader sources | 5–8 weeks total | 40–60% | Broad C4D-like coverage, with much higher geometry risk. |
| Dynamics, glue, and breakable connectors | Additional 2–4 weeks | 40–60% | Physical destruction rather than the controlled reference reveal. |

The recommended target is the second row. Prioritize real closed Voronoi pieces for Text and simple extruded Shapes, a moving Linear Field, seeded Random transform, axis sorting, and an analytic spring response. Fall back to polygon clusters for unsupported arbitrary models. This is substantially more likely to match the supplied images than spending the first milestone on general model support.
