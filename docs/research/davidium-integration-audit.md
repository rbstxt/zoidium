# Davidium integration decision report

> This report records the initial audit. Follow-up fixes are documented in
> [the implementation report](davidium-integration-fixes.md). Source links now
> point to the repaired working trees; initial failure descriptions are historical.

Research date: 2026-10-01. No plugin or runtime implementation was merged.

## Decision

Do not merge the Davidium checkout wholesale. None of its six new complete
plugin packages is ready unchanged under the requested deterministic-render
and UI criteria. Several narrow manager/server/storage improvements can be
selected immediately. Stateless visual features can be brought across in
small ports after their packaging and lifecycle issues are fixed. History
effects, CPU particle simulation, and composition semantics need agreement
with the author before implementation proceeds.

This conclusion is based on the **actual modified local files**, not the
donor's remote or its last commit. Existing work in the destination, especially
Text+ and Scene+ Effector, is part of the comparison. The donor's source is
not dismissed because its remote remains `rbstxt/zoidium`.

The full findings are divided into:

- [Render determinism](davidium-render-determinism-audit.md), with actual-source
  scheduling/pass probes and effect-by-effect recommendations.
- [UI and plugin API](davidium-ui-api-audit.md), with reproduced integration
  failures, serialization and lifecycle analysis.
- [Raw OpenZoid changes](davidium-openzoid-integration-audit.md), including
  changes that never became Zoidium plugins.
- [Tooling and project storage](davidium-tooling-integration-audit.md), including
  selective changes and destination regressions to avoid.
- [Normalized file inventory](davidium-file-inventory.tsv), 70 donor-only and
  46 different files, 116 total including generated bundles.

## Meaning of the categories

"Select now" means the design and dependency boundary are suitable for a
small implementation change, followed by the repository's required checks.
It does not mean every donor test or every GPU rendering case has passed.
"Improve first" means the intended behavior is clear enough to implement
without choosing a different product. "Discuss first" means the behavior,
compatibility contract, or underlying algorithm needs an explicit decision.

For a fixed project, assets, settings, seed, render configuration, and target
time, the rendered result must not depend on earlier visited times, repeated
redraws, whether playback is running, wall time, or whether the editor just
opened. Legitimate edits and asset preparation are separate operations. The
host must wait for required assets before considering a frame complete.

## Plugin and feature classification

| Donor item | Classification | Decision and required work |
| --- | --- | --- |
| Existing Afterclip, AlipFX, CCFX, Easing+, Geometry+, Layer Input, Light+, Material+, Native FX, Particles+, Player+, Text+ | Already present | Their normalized source/bundle contents match. Twelve existing bundles are identical after embedded line endings are normalized. There is no new feature to merge from these directories. |
| Donor Scene+ | Keep destination | The destination already has an expanded Effector implementation and namespaced types. Replacing it with the smaller donor file would remove work. |
| Effector+ Twist and Warp | Mostly already covered; improve any selected delta | Retain destination Scene+ algorithms/IDs. Compare individual controls, not the donor's numeric class registration. Do not install a second overlapping geometry framework. |
| Effector+ "Voronoi Fracture" | Discuss intended geometry, then improve port | The raw and donor implementations match. They assign subdivided triangles to nearest seeded cells and cap boundaries, rather than exactly clipping volume cells. The render structure is promising. Agree accepted approximation/closed-surface quality, cost limits and saved-object compatibility, then port into the existing deformer ownership model. |
| Camera+ DOF/depth controls, camera tracking and deterministic vibrate | Improve first | Isolate stateless parts. Preserve existing compositor wrappers; fix focus actions/buttons, required runtime checks, track3d serialization and numeric layer registration. Use explicit render hooks instead of whole-method replacement. |
| Camera+ video motion blur | Discuss first, redesign | The three-slot ring advances per render call. At the same frame it changes which previous frame it mixes; reverse seek reads a future visited frame. Choose shutter-time source sampling using the existing temporal host. |
| OpenZoid Legacy Jpeg Damage | Small early port after fixes | Its shader uses explicit time/seed rather than history. Extract it from the legacy package, retain bundle asset loading, and remove the copied CM3 common vertex shader. Check premultiplied alpha, aspect ratio, save/load, and target-host APIs. |
| OpenZoid Legacy Posterize Time | Improve first as a temporal sampler | Select source time by `floor(t * rate) / rate` using the effect's chosen origin/rate semantics. Holding whichever frame happened to render first in a bucket is incorrect. Prefer the existing temporal mechanism over a legacy buffer port. |
| OpenZoid Legacy Echo | Improve through existing Native FX; avoid duplicate implementation | Repeated redraw and reverse seek do not reconstruct the same temporal input. There is also a tap-selection indexing defect. Map useful legacy modes and saved properties to explicitly requested source times. Current Native FX Echo already uses the destination temporal API. |
| OpenZoid Legacy Datamosh preview and export renderer | Discuss first | Preview feedback and export-only byte manipulation are different algorithms. Agree on one reproducible visible result, frame/seed/codec settings, restart points, preview/export parity, and performance limits. |
| OpenZoid Legacy VHS | Discuss first for history; improve UI separately | Output feeds back into history on every render, with persistence enabled by default. Split stateless tape/noise distortion from temporal persistence. Rebuild persistence from declared samples or deterministic state, and integrate Setup through host UI. |
| Trapcode Particular | Discuss first, redesign CPU/audio | Seeded random initialization does not make incremental simulation deterministic. Direct seek, sparse playback, and reverse seek integrate different elapsed time. Live audio analyser values also depend on playback. Specify simulation steps/replay and time-indexed audio analysis. |
| Trapcode Form | Improve first; discuss audio behavior | Much geometry evaluation is explicit-time math, but models/masks/maps arrive asynchronously outside complete prepare barriers. Await required assets, include asset/property revisions in cache keys, use saved/time-indexed audio inputs, and fix registration/UI lifecycle. |
| Trapcode Plexus | Improve first; discuss audio/cache ownership | Avoid live analyser state, await model preparation, validate matrix/update ordering and cache invalidation, and register objects through the host API. |
| Trapcode Light C4D | Improve first | Stateless controls are a useful early port, but replacement of native Light and global prototype mutations must preserve other plugins, serialization, and disable behavior. Do not carry the suite merely to get light controls. |
| Trapcode designer windows | Improve first | Separate preview/rendering ownership from editor UI. Use host panels/dialogs, staged property changes, keyboard focus, close/dispose handling, and shared controls. |
| Optical Flares rendering | Improve first | Mostly stateless time/seed evaluation. Fix occlusion dependence on object update order and stale mesh caches; make camera/transform preparation explicit. Keep custom-texture preparation awaited. |
| Optical Flares editor | Improve first | Integrate its element-stack editor with host UI and undo; separate serialized flare configuration from window state. Fix plugin usage detection, failed activation rollback, and disable cleanup. |
| Precomp+ | Discuss first | The implementation creates independent copies and tries to reconnect them by names. It lacks required media serialization and can remove audio-only selections from Main without a replacement clip. Decide stable composition IDs/references, nested time/offset rules, audio, cycle rejection, undo and disabled-plugin behavior before UI polishing. |

The render and UI reports provide source lines for each row. Full packages
stay in the more restrictive category when their included features span
several categories.

## Evidence that changes the merge decision

The render probes execute donor functions with controlled host inputs. GPU
buffers are represented symbolically where stated; these results demonstrate
input/history dependence, not a pixel-quality measurement.

| Target frame/input | Observed donor behavior |
| --- | --- |
| Datamosh or VHS, identical input rendered twice | First reads empty history; second reads the first output. |
| Legacy Posterize Time, frame 2 | Sequential `[0,1,2]` uses source 0; direct `[2]` uses source 2; reverse `[3,2]` uses source 3. |
| Camera video motion blur, frame 2 | Forward playback mixes source 2 with source 1; repeated frame 2 mixes 2 with 2; reverse traversal mixes 2 with 3. |
| Particular CPU simulation, frame 6 at 30 fps | Forward integrates 0.2 seconds; sparse `[0,6]` integrates 0.1; direct `[6]` integrates zero. |
| Raw NodeMaterial, time 0.05 seconds | Cold evaluation and returning from 0.1 seconds produce different baked results because the time-difference cache skips the update. |
| Precomp activation | The UI call receives a panel object instead of its DOM element, suppresses a TypeError, and creates no Comps tab. Deactivation still leaves patched save/precompose behavior and retained panel state. |
| Camera focus Link/Set | Dispatcher passes `null` as the button; the actual focus function calls `button.closest('li')` and throws. |

Resetting history on backward seek is not a solution. It creates a clean but
different result from sequential playback. Skipping feedback while paused
only fixes repeated redraw; it leaves direct/reverse/sparse seek incorrect.
Fixing random seeds alone does not fix either problem.

## UI API recommendation

A new declarative **plugin settings** API is useful only for persistent plugin
preferences. Object-specific VHS/Datamosh parameters, focus targets, particle
presets, and flare element stacks belong to project/object properties and
undoable editors. Putting all of them into global Settings would give the
wrong persistence and selection semantics.

The destination already supplies shared `ZoidiumUI` components and custom
property-control registration through the plugin APIs. Use those for simple
buttons and controls. Add a small optional host API for complex panels and
dialogs if the accepted features justify it:

```js
context.ui.registerPanel({ id, title, mount, selectionScope });
context.ui.openDialog({ id, title, mount, commit, cancel });
context.ui.registerSettings({ id, title, fields, defaults });
```

These are proposals, not current callable APIs. Panel/dialog registration
must return a disposer, own timers/listeners and preview resources, close on
plugin disable, report mount errors, support keyboard focus/escape, and reuse
Zoidium styling. Object dialogs should edit a draft and commit through project
undo; global settings need namespaced/versioned storage. Do not place render
simulation state in UI components.

Also make plugin activation transactional. A module that patches global
classes and then throws must have its partial patches rolled back. Register
cleanup before executing activation, and scope it to the plugin. Existing
object registration and `isInUse` behavior must prevent disabling a plugin
whose serialized objects are still in the project. Nested compositions need
the same traversal rule.

An API is optional. If there are only a few accepted editors, direct reuse of
the host UI kit with a clearly owned adapter is sufficient. The render,
serialization, and undo contracts are mandatory either way.

## Render integration design

Use the destination's `context.temporal` and frame-sampling support for Echo,
Posterize Time, and motion blur. Add ordered compositor hooks if camera/depth
features cannot be expressed through the current hooks. Hooks should declare
their stage and render context, including source/target time, camera, layer,
resolution, and sub-render depth. They must not replace the shared compositor
with a copied OpenZoid method.

For true simulation/feedback features, choose between an analytical result at
time `t`, deterministic fixed-step replay from a defined start, or cached
checkpoints plus deterministic replay to `t`. Cache/checkpoints may accelerate
the answer but cannot define it. Their keys must include project/property
revision, assets, seed, source time, relevant camera/geometry state, and render
configuration. Animated controls must be sampled at each simulation step.
Audio-reactive features need deterministic decoded-audio analysis indexed by
project time and referenced clip offsets.

Raw NodeMaterial/PBR animation should key baking by an explicitly chosen
time sample and all dependencies. If 15 Hz material animation is intended,
evaluate the canonical `floor(t * 15) / 15` time for that bucket. Do not
compare the requested time with the last visited bake time.

## Raw OpenZoid findings

The separate [OpenZoid report](davidium-openzoid-integration-audit.md) inventories
NodeMaterial and its node editor/evaluator, PBR node/bump/ramp/Fresnel/AO/cel/
UV/reflection additions, material/editor changes, expression/property changes,
the Voronoi geometry contract, GIF media support, Graph Editor changes,
composition and 3D-track serialization, and host hooks that plugin ports
silently assume. It distinguishes wholly missing changes, donor-only partial
ports, and already integrated Text+/bevel work.

The genuine raw-only or missing-support list is:

| Raw addition | Integration decision |
| --- | --- |
| Node Material, 31-node evaluator and node editor | Improve exact-time bake caching, animated-node detection, asset preparation and UI/undo, then port as a material plugin. |
| Node graphs feeding PBR channels | Share the repaired graph evaluator; retain the current PBR+ material identity. |
| Custom Material rewrite | Select individual shader/control additions and decide old `custom` project compatibility before replacing a native material. |
| Extended PBR shader controls | Port missing ramp, bump, Fresnel, AO/cel, UV projection and reflection controls individually. Current PBR+ covers only part of this set. |
| GIF decode and time seeking | Define clip-local versus project-global animation; await decoding and support shared assets at different clip offsets. |
| Image material opacity | Good small early extension candidate with round-trip and transparency checks. |
| Graph Editor 2 | Discuss full editor replacement versus a smaller integrated graph editor; refactor UI lifecycle and undo. |
| Expression/property base-value changes and helpers | Port implemented helpers with explicit context/units. `loopIn`, `loopOut` and `pingPong` currently return their input unchanged. |
| Composition and 3D/mute track metadata serialization | Required supporting fixes for donor Precomp+/Camera+, rather than optional new UI. |

DOF, motion blur, tracking, legacy effects, designers and composition changes
are not all raw-only anymore. Several are present in donor plugins but have
missing supporting core changes. "A plugin exists" is therefore not evidence
that its original feature was completely ported.

Do not copy raw CM3 core, UI, three.js, workers, fonts, or embedded resource
dumps. For example, donor legacy `shaders/common.glsl` exactly matches the
ignored CM3 cache's vertex shader after trimming. Read it for analysis, but
use the host shader asset or Zoidium-owned shader code during a port. All
staging remains within `tools/runtime-resources.js` and ignored outputs.

## Recommended order

1. Select the manager per-definition object-picker fix and narrow local-server
   error handling. Bring memory-copy improvements over without replacing
   destination project-file behavior.
2. Define transactional plugin cleanup and use the existing object/property
   registration APIs. Settle the minimum panel/dialog adapter.
3. Port isolated stateless additions: Jpeg Damage, Optical Flares after
   occlusion preparation, light controls, and camera DOF/vibrate. Fix their
   save/load and disable behavior before publishing registry entries.
4. Port temporal-sampling effects with the existing temporal host. Preserve
   current Native FX Echo and destination Scene+ rather than installing
   overlapping legacy implementations.
5. Resolve the author-discussion decisions for Datamosh/VHS history,
   Particular CPU/audio, Precomp references/audio, and fracture semantics.
6. Bring across raw material/node/graph/media additions independently, after
   their exact-time caches, dependency preparation, UI/undo and serialization
   contracts are defined.

## Acceptance checks for implementation

For every time-dependent feature, compare cold direct seek to time `t`,
ascending playback to `t`, descending seek to `t`, random traversal ending at
`t`, and repeated redraw at `t`. Include pause/resume, project reload, clone,
effect reordering, property edits, source clip offsets, different preview
cadences, and export at matching resolution/settings. Use decoded assets and
an explicit preparation barrier. Compare pixels within a stated device-local
tolerance where necessary; shader floating-point differences across GPUs are
a different question from seek-path dependence.

For UI features, verify solo activation, each supported plugin combination,
activation failure, disable with live objects, re-enable, dialog close,
keyboard focus, saved project reload, undo/redo, and nested composition
traversal. Test actual CM3 APIs, not permissive mocks that omit or invent
required fields.

The destination verify/build checks passed. The donor verify result was
288/293, with five Camera+ harness failures. This investigation reproduced
specific functional faults but did not run full GPU visual regression tests.
The supporting reports distinguish measured behavior from static inference.
