# CM3 bug analysis: text texture UVs and nested video materials

Runtime inspected: the Git-ignored CM3 cache (`.zoidium-resources/`), specifically

- `core-1.0.102.js` (single-line minified)
- `three.r91.min.js` (the three.js build CM3 ships)
- `material/texture.js`, `material/custom.js`, `material/video.js`
- `ui-1.0.72.js`

Both bugs are in CM3 core, not in Zoidium. Zoidium can work around either one
by patching the same prototypes Text+ already patches.

## Bug 1 — a texture on 3D Text is stretched / tiled wrongly, worst on the side faces

### Root cause

CM3 builds text from three.js `TextGeometry`, which is an `ExtrudeGeometry`,
and never supplies a `uvGenerator`:

- `PZ.object3d.text.updateGeometry` (core-1.0.102.js, ~offset 430,600):

  ```js
  this.threeObj.geometry = new THREE.TextGeometry(text, {
    size, height, curveSegments, font,
    bevelEnabled, bevelThickness, bevelSize,
    material: 0, extrudeMaterial: 1,
  });
  ```

  There is no `uvGenerator` key. A repository-wide search for `UVGenerator` /
  `generateTopUV` finds zero hits in `core`, `ui`, `clipmaker`, `videoeditor`,
  or any Zoidium plugin.

- three.js r91 `ExtrudeGeometry` therefore falls back to its default
  (`three.r91.min.js`, ~offset 378,437):

  ```js
  E = void 0 !== b.UVGenerator ? b.UVGenerator : fb.WorldUVGenerator;
  ```

- `WorldUVGenerator` (`three.r91.min.js`, ~offset 380,705) is a **planar,
  object-space projection**, not an unwrap:

  ```js
  generateTopUV:     (x, y) => new Vector2(x, y)          // caps: raw object x,y
  generateSideWallUV:(...)  => new Vector2(x | y, 1 - z)  // walls: raw x|y, 1-z
  ```

The material layer passes those UVs straight to the shader. `PZ.material.texture`
(`material/texture.js`) and `PZ.material.custom` (`material/custom.js`) only set
`threeObj.map`, `wrap`, and `repeat`/`offset`/`center`/`rotation`; nothing
normalizes or rewrites the UV attribute.

### Measured consequence

Reproduced by running the bundled `three.r91.min.js` in Node (shape outline
12 x 14, extrusion depth 3, the CM3 Text defaults `size = [20, 3]`):

| face | U range | V range | span |
| --- | --- | --- | --- |
| front / back cap (`normal z`) | 0 … 12 | 0 … 13 | 12 x 13 |
| side wall (`normal x`) | 0 … 13 | -2 … 1 | 13 x 3 |
| side wall (`normal y`) | 0 … 12 | -2 … 1 | 12 x 3 |

Consequences:

1. **The texture is scaled in object units, not per face.** One tile covers
   1 x 1 object units, so a 20pt glyph shows roughly 12 x 13 tiles on the cap
   even though `Repeat` is `(1, 1)`. The image looks zoomed/tiled instead of
   mapped once.
2. **Side-wall V is negative.** `V = 1 - z` with `z` in `[0, thickness]`, so for
   the default thickness 3 the wall spans `V = -2 … 1`.
   - `Wrap = none` (`ClampToEdgeWrapping`) clamps every negative V to the last
     texel row, stretching one row of the image across the entire side face.
   - `Wrap = tile` (`RepeatWrapping`, the default) tiles it instead, which is
     the streaky, repeated look on the lateral faces.
3. **Side-wall U is a planar projection, not a perimeter unwrap.** For walls
   that are not axis-aligned the texture is sheared. Measured
   `3D edge length / UV edge length` on side walls:
   - axis-aligned rectangle: constant `1.000` (no distortion)
   - triangle with one diagonal wall: `1.000 … 1.317` (1.32x spread)
   - circular outline (an "O"-like glyph wall): `1.000 … 7.661` (7.66x spread)

   That spread is the "abnormally stretched lateral face" in the screenshot:
   curved and diagonal glyph walls compress/stretch the texture against the
   straight stems.
4. `PZ.object3d.text.center()` re-centers the geometry with
   `geometry.applyMatrix(...)`. `applyMatrix` transforms vertices and normals
   only — `faceVertexUvs` is untouched. So moving/re-centering text does not
   move the UV origin; the mapping stays anchored to the raw glyph coordinate
   space.

### Additional aggravation in Text+ / geometry-plus

- `plugins/text-plus/text-plus.js` `buildCharacterRendering` rebuilds text as
  one `new THREE.TextGeometry(unit.character, options)` per character with the
  same default UV generator. Every character geometry restarts at its own glyph
  coordinates, so the texture origin and tiling restart per character (visible
  seams/duplication) and the side-wall projection distortion applies per glyph.
- `plugins/geometry-plus/geometry-plus.js` likewise constructs
  `THREE.ExtrudeGeometry` with no `uvGenerator`.

### Fix direction (Zoidium-side)

Patch `PZ.object3d.text.prototype.updateGeometry` (and the Text+ / geometry-plus
geometry builders) to pass a `uvGenerator` that:

- normalizes cap UVs to the shape bounding box (0…1),
- unwraps side walls along the perimeter with V in 0…1 across the extrusion
  depth, and
- optionally applies a per-object UV transform so `Repeat`/`Offset` keep
  meaning the same thing they do on primitive shapes.

Alternatively post-process the UV attribute after construction, which is
simpler to keep in sync with the three r91 legacy `Geometry` face-vertex UVs
that `TextGeometry` returns.

## Bug 2 — a Video material on a Shape inside a Composite > Scene never renders

### Symptom

- Shape + Video material directly in a top-level Scene layer: works.
- Shape + Video material in a Scene layer that is a child of a Composite
  layer: the video never appears (surface stays on the empty placeholder
  texture).

### Root cause

Video playback is driven purely by the sequence scheduler. A `PZ.material.video`
only receives decoded frames when a `PZ.schedule` item sets its `texture`:

- `PZ.schedule.prototype.update` (core-1.0.102.js, ~offset 326,627) is the only
  place a live video texture reaches a material:

  ```js
  this.texture && (this.currentItem.texture = this.texture)
  ```

  and for a video material that setter is defined by
  `PZ.schedule.scheduleVideoMaterials` (~offset 331,970) as
  `obj.threeObj.map = e`.

- Schedule items are built only from the **top-level sequence tracks**:

  ```js
  PZ.schedule.updateSchedules = function (e, t, r, i) {
    ...
    s.object.videoMaterials && this.scheduleVideoMaterials(e, t, s)
  }
  PZ.schedule.analyzeSequence = function (e) {
    this.updateSchedules(e, e.videoSchedules, this.combineTracks(e.videoTracks), VIDEO)
    ...
  }
  ```

  `combineTracks(e.videoTracks)` walks `sequence.videoTracks` only. For each
  clip it looks at `clip.object.videoMaterials` — exactly one level deep.

- `videoMaterials` is declared only by `PZ.layer.scene`
  (`this.videoMaterials = []`, ~offset 375,347). `PZ.layer.composite`
  (~offset 374,075) stores its children as an ordinary `PZ.objectList(this,
  PZ.layer)` and has **no** `videoMaterials` and no aggregation of its child
  layers' arrays.

- `PZ.material.video` registers itself on the nearest layer ancestor
  (`material/video.js`, `videoParentChanged`):

  ```js
  this.parent && this.parentLayer.videoMaterials.push(this)
  ```

  For a Shape inside a Scene inside a Composite, `parentLayer` is the **inner
  Scene**, so the material lands in the inner Scene's `videoMaterials`.

So:

1. The inner Scene's `videoMaterials` contains the material, but the scheduler
   never visits that Scene: the top-level clip's object is the **Composite**,
   whose `videoMaterials` is `undefined`, and `combineTracks`/`updateSchedules`
   do not recurse into `composite.objects`.
2. No `scheduleItem` is created, so `schedule.update` never assigns the real
   video texture.
3. `PZ.material.video.load` left `this.threeObj.map = new THREE.Texture` (an
   empty placeholder). The mesh renders with that empty texture, so no video
   appears. `PZ.sequence.prepare` also never prepares/decodes the material
   because there is no schedule for it.
4. Re-selecting the video does not help: the asset `changed` handler calls
   `PZ.schedule.analyzeSequence(this.parentProject.sequence)`, which is the
   top-level sequence — again the nested Scene is not reachable from it.

This also means the bug cannot be fixed by changing the material: the missing
piece is the recursive scheduling walk.

### Fix direction (Zoidium-side)

Patch the scheduling walk (or the layer tree) so nested layers are visited:

- give `PZ.layer.composite` a `videoMaterials` getter that concatenates the
  arrays of its descendant `PZ.layer.scene` children (and recurse through nested
  composites), and/or
- patch `PZ.schedule.updateSchedules` to recurse into
  `clip.object.objects` for `PZ.layer.composite` clips when collecting video
  materials, then re-run `PZ.schedule.analyzeSequence` when a Video material's
  parent changes inside a composite.

A getter on `PZ.layer.composite` is the smallest change: `scheduleVideoMaterials`
already expects `clip.object.videoMaterials` and builds correct items for any
material with a `media`.

## Verification

Bug 1 numbers were produced by loading `three.r91.min.js` in Node and reading
the `uv` attribute (BufferGeometry path) and `faceVertexUvs` (legacy Geometry
path, which is what `TextGeometry` returns in r91) for
`ExtrudeGeometry`/`TextGeometry` built with the CM3 defaults. Bug 2 is a direct
reading of the `videoMaterials` data flow above; the key check is that
`videoMaterials` appears exactly three times in `core-1.0.102.js` — the two
scheduler reads (`scheduleVideoMaterials`, `updateSchedules`) and the
`PZ.layer.scene` initializer — while the material's `push` lives in
`material/video.js` and the composite layer never mentions it at all.

## Implemented fixes

The composite video fix ships as a hidden, always-on Zoidium Core script (the
invisible `core` plugin), so it runs before `initTool()` and is never stored in
projects. The text UV fix lives in Material+ as a new material type, because
rewriting geometry UVs would change how existing native Custom Material projects
look.

- `plugins/material-plus/uv-custom.js` adds the **UV Custom Material** type. It
  copies the native Custom Material property surface and, while it is on an
  object, rewrites that object's `TextGeometry` / `ExtrudeGeometry` UVs with one
  texel density on every face. The scale is the geometry's front height
  (`sizeY`), so caps map `(x - minX) / scale`, `(y - minY) / scale` and walls
  map `arc / scale` along the outline and `(z - minZ) / scale` across the
  extrusion depth. Normalizing U to the perimeter and V to the depth separately
  (an earlier attempt) still stretched the walls, because the two axes used
  different object-units-per-texel.
  - The outline is rebuilt from the geometry alone: the two lowest vertices of
    each side-wall triangle are consecutive outline points, so a contour graph
    can be walked into closed loops. No font or source-shape access is needed,
    which also covers Text+ character meshes.
  - `extrudePath` extrusions and non-extruded primitives (Box, Cylinder, models)
    are skipped, so only the geometries with the broken world-space UVs change.
  - The original `faceVertexUvs` are stored per geometry and restored on unload,
    so removing the material returns the object to the native CM3 look.
- `plugins/core/composite-video-materials.js` defines a `videoMaterials`
  getter on `PZ.layer.composite.prototype` that aggregates descendant Scene
  arrays (recursing through nested composites with a depth guard), so the
  existing `PZ.schedule` walk finds nested Video materials through the
  composite clip.

Covered by `test/material-plus-uv-custom.test.js` and
`test/core-composite-video-materials.test.js`, and verified against the bundled
`three.r91.min.js`: the UV Custom Material path reports a single
object-units-per-texture-unit ratio for caps and walls (for example `dx/du`,
`dy/dv`, `ds/du` and `dz/dv` are all exactly `20.000` for a 20-unit tall glyph
with a hole), instead of the 7.66x shear measured before the fix. The native
Custom Material and `THREE.TextGeometry` / `THREE.ExtrudeGeometry` are no longer
patched.



