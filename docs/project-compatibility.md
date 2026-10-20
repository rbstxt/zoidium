# Saved rendering compatibility

Zoidium is an external extension layer around CM3. It assigns rendering modes
before the host loads a saved project. Any saved object without an explicit
mode loads as `legacy`, regardless of the plugin versions recorded in the file.
Explicit `legacy` and `current` fields always win. New objects use `current`
and serialize that choice. There are no new UI controls.

## Expressions+

Expressions remain source strings in native dynamic properties. No compiled
code enters project files. Extended syntax/API adds the `expressions-plus`
dependency with feature `expressions`; scanning includes preserved and nested
project records. Source strings stay intact through native serialization,
archive saving, copy/paste and history. Older Zoidium builds can warn from the
dependency descriptor. Vanilla CM3 cannot interpret the plugin dependency;
it displays its native expression error for unsupported syntax/API.

Constructor and prototype member reads retain CM3's results, including computed
reads. The security exception is invoking a Function-like constructor or eval
through any path, including `new`, aliases and callbacks. Those calls now
produce an English expression error and use the property's own value. Unknown
free globals, `this`, async and generator syntax remain unavailable. Compilation
uses the Function constructor of a temporary sandboxed iframe removed before
evaluation. No new API handle exposes a host or realm object.

Execution also has explicit deterministic limits of 10,000,000 loop/call steps
and 256 nested calls per outer evaluation. Exceeding a limit or any other
expression error falls back to the property's keyed value. This replaces
CM3's undefined error result. Legacy expressions within these limits keep
their native signatures and detached-realm intrinsic identities. The native
corpus test compares accepted repository expressions against the cached CM3
compiler without checking CM3 code or captured data into Git.

MP4 Export adds no project fields or rendering modes. Format, bitrate and
codec decisions belong to the current Device render page. Disabling the
plugin or opening a project in an older build leaves its rendering unchanged.
The plugin uses the same deterministic frame renderer and native offline
audio mixer. Odd output dimensions receive a black padding pixel at the
right or bottom for H.264, without resizing the rendered image.

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

## Preview cache memory

`previewCacheMiB` stays in localStorage `zoidium.editor-settings`, outside
project files. Its default remains 512 MiB and existing valid values remain
unchanged. The accepted range is now 0 through 16384 MiB. Older builds clamp
values above their 2048 MiB maximum when reading them. No project field,
rendering mode, frame key or invalidation rule changes.

The runtime retains at most 8192 finished preview frames, bounded by their
counted RGBA8 bytes. Driver overhead and other render targets are extra.
An OUT_OF_MEMORY error reduces the session ceiling to 90 percent of current
retained usage and evicts to that ceiling. Context loss forgets all entries
without disposing dead textures and halves the ceiling. If the host renderer
restores successfully, caching can resume below that ceiling. A second context
loss disables captures for the rest of the session. One notice reports the
first memory failure or context loss. These ceilings survive project changes,
cache clears and preference changes, and reset only when the page reloads.
Settings reports live usage at the current drawing-buffer size and any reduced
session limit. The larger preference is a maximum, not a reservation of GPU
memory. It cannot guarantee enough free GPU or shared system memory.

## Node Effect

Node Effect is authored as CM3 Custom Shader effect type 1. Executable GLSL
in `properties.fragShader` owns the pixels. A trailing
`// @zoidium-node-effect` line contains compact version-1 graph JSON with
nodes, links, positions, parameter settings and stable node IDs. The parser
validates version, structure, values, ports, cycles and size before editing.
The existing shader stays active if graph validation or shader linking fails.

Exposed channels remain native `customProperties`, including their keyframes,
tangents and expressions. Generated uniform names encode the node ID, so a
parameter label change preserves animation. Optional `zoidiumLabel` and
`zoidiumDefault` fields inside each native custom property definition are
editor metadata. Older builds ignore them. Changing parameter type replaces
that channel with its new default. Time is a native float channel with the
native expression `time`, evaluated from the owning clip's Time property.

Bare CM3 and builds without Node Effect execute the saved shader and native
channels without evaluating the graph. They can show generated uniform names.
Graph comments survive native serialization, Zoidium archive saving, effect
copy/paste, and history snapshots. No compatibility mode or change to existing
effect classes is needed. Projects without Node Effect retain their existing
rendering. See [Node Effect](../plugins/node-effect/README.md) for limits and
alpha handling.

## Sequence Controls

The native sequence Properties record has one optional hidden text field,
`properties.zoidiumControls`. Its JSON value is
`{version:1,nextId,controls:[nativePropertyRecord,...]}`. Each record is a
native custom dynamic property with its ordinary values, keyframes, tangents
and expression source. Its type carries `zoidiumControlId` and
`zoidiumControlKind`, plus Slider min/max/step or Angle display conversion.
IDs are local to a sequence and do not change when a control is reordered.

The live Controls list is a native child of the sequence and has native
property addresses for history and graph editing. The hidden text property's
serializer reads that list; the list is not a second serialized authority.
Loading or pasting sequence Properties rebuilds it before the editor reads
its values. Empty, untouched sequences omit the field. Sequence Controls add
feature `sequence-controls` to the Expressions+ dependency.

Current unknown-field preservation includes sequence properties, so disabling
Expressions+ retains the payload on resave. Earlier builds whose preservation
covers only layers, clips and media may drop it when resaving; keep the original
file. Vanilla CM3 ignores the field. These builds cannot evaluate control links.
Generated links use `control(name, id)` to survive rename/reorder. Manual
name-only links follow exact names. Deleting the ID makes a generated link fail
and use its own keyed value, rather than selecting a replacement control.

## Expressions+ shader extensions and world links

World/camera links add only ordinary expression source strings. There are no
new transform fields, camera copies or frame caches in saved projects.

Shader includes and automatic uniform declarations remain in the native
`properties.fragShader` string and add dependency feature `shader-extensions`.
Expansion happens only during compilation; expanded library code and runtime
uniform values are never serialized. Native custom properties are unchanged.
Older builds can open and retain the GLSL, but do not expand include comments
or supply automatic uniforms, so their output may differ or fail to compile.
Shaders that do not opt into these extensions retain their original source
bytes, compiler path and uniforms.
