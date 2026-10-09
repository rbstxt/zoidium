# Davidium integration fixes

Implemented on 2026-10-01 against the modified local working trees. This report
supersedes the initial audit's descriptions of the repaired defects. The
original inventory and reproduced failures remain historical evidence.

## Scope and placement

Common host and tooling repairs were applied to both
`/Users/dia/Projects/GitHub/Zoidium` and
`/Users/dia/Projects/GitHub/Davidium/zoidium`. Repairs to the six donor-only
plugins remain in the donor. Raw Node Material/PBR repairs remain in
`/Users/dia/Projects/GitHub/Davidium/openzoid-main/openzoid-main`. The destination
still has 14 plugins; this change does not import six whole packs whose remaining
rendering and composition contracts need agreement.

Existing destination edits were preserved. No external CM3 runtime resources
were added to the destination's tracked source. The copied legacy common vertex
shader was removed from the donor pack; effects now resolve the host resource
through the existing asset interface. Public numeric object IDs and effect IDs
were retained. Source manifests, generated bundles, registry URLs, and shell
cache versions were updated together.

## Host lifecycle and numeric objects

Both plugin managers own a module before calling its `activate()`. Modules can
register cleanup with `context.lifecycle.onDispose(fn)` before mutating the
host. Deactivation and cleanup are async, ordered, and idempotent. One cleanup
failure does not prevent the others. Concurrent disable requests during a slow
activation join one cleanup; enabling during that cleanup waits and then
reactivates. Group switches await deactivation.

Object picker registration checks each plugin/name/type entry, so several
entries from the same plugin register without duplicates. The donor's numeric
plugin guard inspects serialized live projects, nested composition data and
Main backups. Numeric factories cannot be disabled while their project data
still needs them, including extended C4D light data using vanilla type IDs.

Numeric placeholder restoration prepares and loads the replacement before
removing the original. Failed loads retain serialized data and retry tracking.
Camera restoration updates every owned alias, including `clip.object`, the
cached `track.layer` and nested containers. A later track selection therefore
cannot restore the old placeholder. Detached numeric objects are not replaced.
Placeholder unload removes missing-instance tracking.

Effector+ restores owned class definitions as well as factory and scene update
wrappers, including partial activation failure. Newer destination Scene+
behavior was retained. Approximate Voronoi geometry and naming still need a
separate decision.

## Precomp safety repairs

The Comps tab now mounts the panel's DOM element and uses the shared tab-removal
helper. Disposal removes watchers, commands, panels and metadata hooks.
Composition use and pending transitions prevent normal disabling.

The fetched CM3 media/layer contract is extended reversibly to preserve
`isComp`, `compLength`, `compSource`, `compId`, `compClipLinks` and `compSourceId`. New collapsed
clips identify their source composition by a persisted ID. Legacy name-based
reveal works only when the match is unambiguous.

Saving or backing up while editing a composition serializes Main's tracks,
length and clip links without swapping the displayed sequence. The current
composition draft is included in its media entry. Editor save and recovery
functions retain their original calling and error behavior; a failed save is
not silently invoked a second time.

Composition switching waits for media, tracks and nested object loads before
committing. Failed preparation leaves the displayed sequence intact. Pending
switches and replaced projects cannot commit stale prepared data. Creation
waits for media loading and removes failed drafts. Released tracks are unloaded
after a successful switch.

Pre-compose rejects audio-only and mixed audio/video selections before creating
media or deleting clips. Its English message explains that audio was left
unchanged. It also requires the timeline before attempting collapse. This
prevents the known data-loss path; it does not add nested audio rendering.
Composition rows are keyboard activatable.

Main/composition edits still use snapshots. Editing a composition does not
update the copied child layers in Main. A live-reference implementation,
nested audio, undo ownership and full cross-composition clip-link semantics
remain design work. Precomp is still deferred for a complete merge.

## Desktop media and shutdown

Both desktop servers support bounded single byte ranges, suffix/open-ended
ranges, 416 for unsatisfiable ranges, and `If-Range` validation. HEAD returns
full representation metadata. File errors retain their actual cause. Stream
cleanup follows the response pipeline rather than the request's normal close
event. Client cancellation does not emit a server failure.

Destination desktop shutdown closes idle connections and force-closes remaining
connections after two seconds. Existing destination crash diagnostics, font
configuration and fixed storage origin remain. The donor's already bounded
shutdown was retained.

## Rendering, UI and storage

Detailed implementation and compatibility notes are in:

- [Render and raw material fixes](davidium-render-fixes.md).
- [UI ownership and controls](davidium-ui-fixes.md).
- [Tooling and atomic donor storage](davidium-tooling-fixes.md).
- [Plugin lifecycle contract](../plugin-api.md).

Echo and Posterize now obtain their source frames from the core temporal API.
Echo retains its effect ID and mixing modes, with the host's 16-sample cap.
Form/Plexus await their required inputs; Flare occlusion evaluates after scene
transforms. Node Material/PBR exact-time cache fixes are implemented in the raw
source, but those materials still need plugin packaging and integration review.

Raw expression evaluation also restores its shared frame/property/value context
after nested or failed calls. Advertised loop/easing stubs remain deferred.

A new general settings-page plugin API was not needed for these repairs.
Shared viewport ownership, tab cleanup and a narrow Camera property renderer
cover the identified UI failures. More elaborate graph editors can be designed
when their plugin integration is concrete.

## Remaining merge decisions

Datamosh/VHS feedback, Particular CPU simulation, camera video blur and live
analyser audio remain history dependent. A paused-frame guard would not make
reverse/direct seeks deterministic. Their source-frame/replay contracts still
need agreement. Light labels such as IES, Dome and Portal must reflect the
actual backend before release. Raw graph materials, GIF time mapping and
expression extensions require additional semantic and serialization review.

## Verification

- Destination `pnpm run verify`: 302/302 tests passed; all 14 manifests,
  bundles and JavaScript syntax checks passed.
- Donor `pnpm run verify`: 363/363 tests passed; all 20 manifests, bundles
  and JavaScript syntax checks passed. Its pre-existing installed modules and
  updated lockfile trigger pnpm automatic install; verification used
  `pnpm --config.verify-deps-before-run=false run verify` with the declared
  test dependency available. The full verifier ran, with no tests skipped.
- Raw OpenZoid focused tests: 9/9 passed; changed core/material JavaScript
  passed syntax checks.
- Both `build:web` scripts succeeded using 177 CM3 cached resources. Generated
  stages contained the expected 14/20 plugin bundles, matching local font
  files and no non-core source trees. Shared designer helpers are embedded
  bundle assets. Both disposable `dist/web` trees were removed after inspection;
  resource caches were retained. Repository resource boundaries were checked.
- Destination `git diff --check` passed. The donor's initial tree has extensive
  CRLF changes relative to its old Git HEAD, so a whole-tree whitespace diff
  is not a meaningful clean-baseline check and was not normalized wholesale.

Source scheduling, lifecycle and storage tests do not establish GPU pixel
parity. No automation-capable T3 preview was available, so runtime visual
checks are still outstanding.
