# Constraints

Constraints is a Zoidium extension plugin, enabled by default. Track To aims a
3D object at another object in the same native 3D Scene without changing its
Rotation keyframes.

## Use Track To

1. Select an object in the Objects panel.
2. Set **Track to** below the rotation rows. Targets show their group paths.
3. Choose a **Track axis**, the local axis that points at the target, and a
   different **Up axis**, the local axis kept closest to world +Y.
4. Set or animate **Influence** from 0 to 100 percent. At 0 the object's own
   evaluated rotation wins; at 100 the track axis points at the target.

The default track axis is +Z for ordinary objects and -Z for the native scene
camera. Up defaults to Y. Changing the track axis automatically fixes a
conflicting up axis in the same undo step. The extra controls hide when Track
to is None. Renaming, reordering and grouping the target retain the link.
A missing target leaves the object's own pose unchanged.

Spot and directional lights use CM3's native Target position instead of Euler
rotation. Track To blends that aim toward the selected object. They show only
Track to and Influence because local track/up axes do not control their beam.
Point and hemisphere lights have no directional aim, so they have no Track To
controls, but can be targets. Unknown object classes without a Three object
cannot be aimed. The current CM3 factory does not provide a native type 99
dummy class.

A selected constrained object has a dashed relationship line in the main 3D
editing viewport, beside the native selection helpers. Output preview and
export exclude that helper layer. Constraints cannot be disabled while a
project still has a nonempty Track to field, including a missing target.

## Evaluation

The plugin runs after all native objects and enabled object extensions have
updated for the requested frame. It reads world positions, solves a local
quaternion through the full parent transform, then blends from the object's
evaluated quaternion. Negative and nonuniform parent scale are supported;
a singular parent transform or coincident target leaves the own pose intact.
World-up alignment has a fixed fallback when the direction is parallel to +Y.
No orientation carries over from a previous frame. Preview, playback, seeking,
export and native motion-blur half-frame sampling share this evaluation.

Constrained parents and target dependencies evaluate first. Descendant
tracking and reciprocal or longer target cycles are skipped and reported once
per affected live object in the console. Other constraints still evaluate.
Effector+ and Text+ object3d subclasses use the same native scene pass.

Camera+ is a sequence camera layer, not an object owned by a 3D Scene. Its
camera can drive several tracks, each with its own scene and local time.
There is no single same-scene target space or evaluation clock for that layer,
so cross-layer Camera+ tracking is not supported. Use the native scene camera
for a Track To shot.

## Saved data and compatibility

The object property record holds `zoidiumTrackTo`, `zoidiumTrackAxis`,
`zoidiumUpAxis` and the native animatable `zoidiumInfluence` property. A target
gets a hidden UUID in `properties.zoidiumId` only when it is first targeted.
Copies get a fresh UUID if the saved one already belongs to another object in
the project. Duplicating a group or scene remaps links within that copied tree.
The original keeps its references. IDs may remain as inert metadata after
undoing an edit. Each committed control edit has one history entry.

Untouched objects omit default constraint fields. Previously saved fields
write explicit defaults when cleared so the host's unknown-field preservation
cannot restore an old setting. A nonempty target records the Constraints
plugin dependency, including in nested compositions. Earlier builds and vanilla
CM3 ignore these property keys and show the object's unconstrained animation.
They cannot reproduce the constrained shot. See
[project compatibility](../../docs/project-compatibility.md#track-to-constraints).

## Files

`constraints.js` owns plugin lifecycle and native hooks. `constraint-properties.js`
owns storage and identities; `constraint-ui.js` supplies native property controls;
`constraint-graph.js` orders dependencies; `track-to-evaluate.js` runs the scene
pass; `track-to-math.js` contains the pure quaternion math;
`constraint-overlay.js` owns the editor helper. Additional constraint types can
share the storage, scene pass and dependency graph.

Rebuild with `node tools/build-plugin-bundles.js` after changing the manifest
version or sources, then run `pnpm run verify`.
