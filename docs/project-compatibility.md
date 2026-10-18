# Saved rendering compatibility

Zoidium is an external extension layer around CM3. It assigns rendering modes
before the host loads a saved project. Any saved object without an explicit
mode loads as `legacy`, regardless of the plugin versions recorded in the file.
Explicit `legacy` and `current` fields always win. New objects use `current`
and serialize that choice. There are no new UI controls.

| Behavior | Serialized field | Owner |
| --- | --- | --- |
| PBR+ UV layout | `zoidiumUvMode` | Each PBR+ material |
| Text+ scale composition | `zoidiumTextScaleMode` | Each native Text object, type 1 |
| Effector subdivision | `zoidiumSubdivisionMode` | Each Twist or Warp object, including old numeric types 7 and 8 |
| Temporal prefix quantizers | `zoidiumTemporalMode` | Each frame sampling effect: Echo, Time Displacement, CC Wide Time and Time Difference |
| Shadow quality | `zoidiumShadowMode` | Each native 3D Scene layer, type 4 |

`zoidium/project-compatibility.js` annotates unmarked saved records before
plugin dependency detection and host deserialization. It also visits embedded
compositions and disabled plugin payloads. The migration does not mutate its
input or copy unchanged asset data. Serializers retain explicit modes through
save/open, copy/paste, duplicate and undo/redo. Resaving with a newer plugin
version cannot change an object's rendering mode.

## PBR+ UV layout

Legacy PBR+ retains CM3's native WorldUVGenerator coordinates, as before
`09b7c04`. It restores those coordinates if another material previously applied
the shared Material+ layout. Current PBR+ uses `plugins/material-plus/uv-layout.js`.
New PBR+ and other UV-reading Material+ materials use the shared layout.

## Text+ scale composition

Legacy Text keeps native scale above the character hierarchy and uses the
character transform order from `a9007ee^`. Current Text uses the corrected
composition for character rotation with nonuniform, negative or zero scale.

The mode belongs to native Text because all ancestor Text+ controllers act on
one character hierarchy. Controllers with different scale orders could not
share it consistently. Every unmarked saved Text gets legacy mode, including
Text currently outside a Text+ controller. Newly added Text is current even
under an old controller. Serialization works while Text+ is disabled.

## Effector subdivision

Legacy Twist/Warp retains hidden `curveQuality` and `polygonCount` values and
serializes `zoidiumLegacySubdivisionLevel`, the original selector level. At
that level it uses the exact arbitrary triangle count and topology from
`be6ea2b^`, including the original two-triangle minimum. Other values in the
existing selector use current uniform subdivision. Returning to the original
level, including through undo, restores the original count. Editing a property
does not rewrite the mode or original count. Worker and synchronous cache keys
include the effective mode.

## Temporal prefix quantizers

Legacy samplers use the tap mapping from `430a52c^`. Each tap requests its raw
input time without replaying preceding Posterize Time quantizers. Adjustment
samplers also keep the original control clock and adjustment scope. Current
samplers replay ordered prefix quantizers at each sampled time and bound the
adjustment scope. At project rate 30, a requested tap at frame 1 after a 5 fps
Posterize Time prefix stays at frame 1 in legacy mode and maps to frame 0 in
current mode.

Each sampling effect owns its decision because it requests and combines its
own input taps. Prefix operators remain shared, and old and new samplers can
coexist in a stack. `defineFrameSampler()` installs mode persistence around
each effect's lifecycle, preserving custom serializers such as Time
Displacement's layer input. Temporal input revisions include the sampler's
mode and any enclosing sampler's mode, even when the cache key omits the
sampling effect itself. Finished frame keys include the serialized modes.

## Shadow quality

Legacy scenes select CM3's original Three r91 depth path from before `17e05e6`.
Their meshes receive no Zoidium default `customDepthMaterial`, so Three chooses
its native depth material and unmodified RGBA packing. Current scenes use the
shared depth material with polygon offset and the packed depth correction
from `71bd922`. Explicit mesh depth materials retain precedence in both modes.
Point light distance materials remain unchanged.

The native 3D Scene layer owns the mode because its meshes contribute to the
same light depth passes. The default depth accessor resolves the owner through
the live Three scene ancestry. Generated meshes and reparented meshes follow
their scene automatically. Each scene can retain its own mode in a composite
or project. Scene serialization carries the mode into temporal input and
finished frame cache keys.

## Regression evidence

`test/fixtures/legacy-render-outputs.json` pins numerical outputs from
`09b7c04^`, `a9007ee^` and `be6ea2b^`.
`test/fixtures/legacy-temporal-outputs.json` pins requested frames, decoded
frames and captured values from the actual `430a52c^` implementation for
ordinary and adjustment stacks. These fixtures contain no CM3 runtime code
or assets.

The compatibility, legacy render, temporal sampler, plugin API, shadow quality
and output frame tests cover migration without version checks, explicit
choices, new objects, round trips, duplication, history reloads, mode-aware
cache keys and historical output comparisons.

## Motion paths

Motion Paths stores edits in CM3's existing Position channels and native
keyframe fields only. It adds no rendering mode, object type or spatial path
field. Older builds can evaluate those edits without the plugin. Visibility
and local path-key selection are editor state and are not saved in projects.
Showing a path leaves existing animation untouched. Materializing an axis key
preserves hold, linear and bezier curves; other easing presets retain the
neighbouring tween and can change timing within the split segment. See
`plugins/motion-path/README.md` for the temporal handle mapping and limits.

## Track To constraints

Constraints adds optional `zoidiumTrackTo`, `zoidiumTrackAxis`, `zoidiumUpAxis`
and `zoidiumInfluence` keys inside each constrained native 3D object's
`properties`. The influence uses the host's ordinary dynamic number format,
including keyframes and expressions. Track-axis options are +X, +Y, +Z, -X,
-Y, -Z at indices 0 through 5; up-axis indices 0 through 2 mean X, Y, Z.
Only objects used as targets receive `properties.zoidiumId`, a persistent UUID.
A nonempty target adds the `constraints` plugin dependency with feature
`track-to`, including when found inside a composition or preserved payload.

Missing fields leave rendering unchanged. Untouched objects omit default
constraint fields. When clearing previously saved values, explicit defaults
override the host's retained unknown fields. Missing targets and skipped cycles
use the object's own evaluated pose. The plugin never rewrites Rotation
keyframes. UUID collisions regenerate the incoming copy's identity; a copied
group or scene remaps its internal target links as one load batch. Renaming
and reordering have no effect on identity.

Builds without Constraints can open these projects and ignore the extra keys,
but render the unconstrained keyed pose. Builds with the existing unknown-field
preservation retain those keys on resave. Inert UUIDs alone do not require the
plugin. No compatibility mode is needed because projects without a nonempty
Track to field retain their existing rendering. Camera+ sequence camera layers
are outside the same-scene target contract. See the
[Constraints guide](../plugins/constraints/README.md) for light conventions.

## Editor themes

Theme Editor preferences do not enter project files, object properties or
rendering modes. They change editor chrome and timeline DOM colors only.
Saved projects retain their existing rendered output. Older builds ignore
`themeId` in `zoidium.editor-settings` and use its retained `theme`, `hue` and
`saturation` profile. The existing Custom profile remains supported.

Named themes live in localStorage `zoidium.themes` as
`{version:1,themes:[{id,name,main,overrides,clips}]}`. IDs start with `user:`.
`main` and color values are six-digit hex strings. `overrides` accepts
`focus`, `link`, `clip`, `clipSelected` and `clipSelection`; absent keys mean
Auto. `clips` maps stable type keys to colors, with absent keys using the
theme clip color. Native layers use `cm3:<numeric type>`, audio uses `audio`,
and registered plugin layers use their namespaced type. Legacy numeric plugin
layers use `zoidium:<registration id>` when that id is namespaced, including
Camera+. Their registered numeric aliases resolve to the same key. Disabling
a plugin keeps its saved clip-color entry available for later reuse.

Single-theme JSON files have `{version:1,theme:{id,name,main,overrides,clips}}`.
Import validates every color and key, assigns a new ID and adds a numeric
suffix to a colliding name. Unsupported or corrupt local theme storage loads
no user themes; a missing selected theme falls back to Panzoid Classic.
Neither import nor export fetches resources or transmits project data.

For Auto colors, convert the main color and original Classic palette to HSL.
For palette entry `p` and Classic focus `f`, compute
`H = main.H + p.H - f.H`, `S = main.S * p.S / f.S`, and
`L = main.L + p.L - f.L`. Wrap hue, clamp saturation/lightness, then round
RGB channels to bytes. Focus is the exact main hex value. Classic's main
`#384668` reproduces all five original colors exactly. Built-in profiles use
the original hue/saturation transformation without any change. Duplicating
one preserves byte-exact colors with minimal overrides for channel-rounding
differences. A custom clip's selected color moves its HSL lightness 35% toward
white. Its label chooses the higher WCAG contrast of CM3's `#2c323f` and
`#f4f4f4`; native preset labels retain their original tint.

Theme Editor keeps one undo entry per committed preference edit, including
an entire native color-picker gesture. Its Undo/Redo buttons and keyboard
shortcuts operate only on theme preferences, separate from project history.
Escape cancels a picker gesture. Revert restores all theme preferences from
when the window opened and can itself be undone. Delete asks for confirmation.
Window geometry stays in the shared UI window storage, outside project files.
