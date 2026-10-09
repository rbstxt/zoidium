# Effector

Effector is the Zoidium 3D object plugin for procedural copies and mesh
deformation. It owns every Effector object: the Repeater family and the
Twist, Warp, and Voronoi Fracture effectors. They appear under one `Effector`
menu and use the published `zoidium:repeater/*` namespace.

- Repeater, Linear Repeater, Random Repeater, and Echo Repeater copy source
  objects.
- Twist rotates descendant meshes around an axis.
- Warp bends descendant meshes, optionally weighted by a linear, box, or sphere
  field.
- Voronoi Fracture splits descendant meshes into seeded Voronoi pieces with
  optional cap faces.

## Evaluation model

Every frame each affected mesh is rebuilt from its pristine source geometry.
The source geometry is never written, so repeated and reversed playback give
identical results. Per-mesh working copies live in a WeakMap, not in
`userData`, because three r91 JSON-clones `userData` when objects are cloned.

Deformers run in their own local space. Each deformer's transform (position,
rotation, scale of its group, plus any parent transforms) defines the frame, so
moving or rotating an effector moves its axis, pivot, field, and fracture
centre. Deformers whose transform is singular, such as a zero scale, are skipped
instead of producing NaN.

Smooth curve quality refines triangles before a nonlinear deformer runs. The
total output is capped at 400,000 triangles, so a dense mesh falls back to fewer
polygons per triangle. The budget counts indexed source triangles as well.

Voronoi Fracture topology is cached by source geometry, seed, cell count, and
the input positions. Animating distance, scatter, spin, offset, or the field
only updates vertices. Meshes above 40,000 source triangles, or output above
400,000 triangles, are left unfractured and a console warning explains why.

Fracture builds run in a persistent Blob Worker, using source text supplied by
the plugin bundle asset API. Large Twist/Warp meshes, subdivision, normal
averaging, and bounds also run there. Interactive preview shows the pristine
source or a completed result of the same topology while work is pending and
redraws after completion. Motion changes keep an active topology build alive
and replace obsolete queued motion frames. Object
and scene `prepare()` await that work before CM3 exports a frame.

Identical input keys share a job. Changed inputs cancel work with no remaining
consumer, and unloading objects or disabling the plugin disposes their jobs.
Only one build runs at a time. The worker retains at most four topology stages
within 64 MiB; the main thread retains at most four unused frame results within
96 MiB. Pending inputs refer to source buffers until dispatch, and completed
meshes keep their normal render geometry. Source buffers are never transferred
out of the editor. Material clones remain alive during pending builds so
editing inputs does not discard their compiled shader programs.

## Voronoi Fracture

Cells are convex regions around seeded sites, built exactly from bisector
planes. Each source triangle is clipped against them, so fragments tile the
original surface without holes or overlaps. Pieces are capped along their cut
planes. Each planar cut is capped before the next cell bisector is applied,
so neighboring caps meet along cell ridges. Convex caps retain every boundary
subdivision, while concave cuts use planar ear clipping. Interior cells are
retained even when they do not touch the original surface.
Open mesh borders (for example a flat plane) are never capped.

Fragments are flat-shaded. With `Fragment colors` set to random, each piece has
a seeded colour and the material is cloned for double-sided rendering. Custom
shader uniforms are copied from the original material each frame.

## Legacy projects

Projects saved by Davidium Effector+ store Twist, Warp, and Voronoi Fracture as
numeric types 7, 8, and 9. They load as the namespaced classes, and saving
writes the namespaced types. The Effector+ compatibility plugin maps the numeric
types; this plugin also registers a migration for each class.

The implementation is an external Zoidium extension layer around CM3. It does
not replace or copy the CM3 runtime.
