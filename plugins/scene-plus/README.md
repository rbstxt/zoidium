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

Subdivision offers 1, 2, 4, 8, or 16 edge segments, producing 1, 4, 16, 64, or
256 triangles per input triangle. Uniform quadrisection keeps shared edges
coincident after deformation. The 400,000-triangle budget falls back by whole
levels and counts indexed source triangles as well. Legacy polygonCount values
round to the nearest power of four; smoothness levels keep their previous
power-of-four density, and Low polygon migrates to one segment.

Voronoi Fracture topology is cached by source geometry, input positions, seed,
cell count, inner faces, distribution, and cell scale. Animating motion or any
field control only updates vertices. Meshes above 40,000 source triangles, or output above
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

## Shared fields and fragment controls

Twist, Warp, and Voronoi Fracture share animatable field properties. Field
indices 0 through 3 remain infinite, linear, box, and sphere; cylinder and
seeded 3D value noise follow. Rotation uses XYZ Euler degrees. Scale is a
percentage of the pristine input mesh extent in effector space. Box and sphere
use half extents; cylinder points along field Y. Falloff specifies the soft
transition width within the field, with zero giving a hard boundary. Curves
remap the weight before inversion. Noise scale sets the wavelength relative
to field scale; evolution translates the seeded noise continuously.

Linear Sweep projects pristine input positions onto the rotated field X axis.
At zero all weights are zero and at 100 all are one. Between those endpoints
the plane moves from the minimum projection minus the transition width to
the maximum projection. The width is Falloff percent of that projected span.
Field position offsets this plane in effector space. Twist and Warp evaluate
weights per vertex; fracture evaluates once per pristine fragment centroid,
so a partially affected fragment remains rigid.

Fracture site distributions are uniform volume, area-weighted surface, center,
and edges. Center squares each signed normalized coordinate toward the
center; edges uses its square root toward the bounds. Cell scale changes the
Voronoi metric by inverse squared axis scale, producing elongated cells.
All choices use the existing indexed seed hash.

Direction translates fragments in effector space. Rotation applies XYZ Euler
degrees after seeded Spin. Fragment scale acts about each fragment centroid.
Gravity translates along effector -Y by Gravity times field weight squared.
Randomness reduces each fragment's motion strength by a fixed seeded amount,
from no variation at zero to a seeded factor in [0, 1] at 100. Every motion
control, including fragment gap, uses the centroid's field weight.

Legacy projects retain their original absolute field scale and field formulas
when the new controls remain at defaults. The saved legacyField marker keeps
this behavior across save and reload. Editing rotation, falloff, curve, invert,
or sweep selects the new field formulas. Namespaced and numeric object types
continue using the existing migration and compatibility shim.
