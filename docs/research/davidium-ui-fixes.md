# Davidium UI integration fixes

Implemented on 2026-10-01. Shared helpers were changed in both Zoidium and the
local Davidium donor. New plugin UI implementations remain in Davidium.

## Shared ownership

`ZoidiumUI.removeMenubarTab(tab)` updates the host elevator's active panel and
panel list, removes the tab and panel, and clears handlers. It is idempotent.
`ZoidiumUI.acquirePreview(viewport, close)` closes the previous custom editor
before transferring a viewport, and returns a release function. A stale release
cannot release a newer owner's lease. Precomp uses the tab helper; Trapcode,
Optical Flares and the legacy setup editors use preview leases.

The donor's main viewport accessor now tracks instances through per-editor
WeakMaps and WeakRefs. A later popout does not replace the first main viewport.
Explicit registration can override that choice, unloaded panels are excluded,
and an editor cannot borrow a different editor's viewport as a fallback.

## Camera and object actions

Camera Link and Set actions retain the actual button through the dispatcher.
Focus values use the target clip's local frame. A narrow focus property renderer
makes those buttons available without depending on the unrelated legacy pack.
The 3D track switch serializes through reversible video-track load/toJSON
wrappers. Label buttons and handlers are removed during deactivation.

The bundle-owned `plugins/shared/designer-actions.js` service provides object
gear buttons with independent registrations. Optical Flares opens its own
editor without requiring Trapcode. Unregistering one provider retains the
others; unregistering the last provider removes buttons and restores owned
host wrappers. Dead wrappers beneath another extension stop dispatching.

## Optical Flares and Trapcode

Optical preview brightness and Solo selection are scoped to the borrowed
viewport's render call with `try/finally`. Normal editor and export renders do
not read designer preview settings. Closing restores viewport rendering,
position, edit mode, watchers, intervals and event handlers. Cancel restores
the original flare snapshot. Initialization failure releases the preview lease.

Optical deactivation closes owned editors, removes gear/style, and restores
its factory, class and namespace members while preserving later providers.
Trapcode deactivation closes its editor, removes its style and restores owned
classes/factory wrappers. C4D lights capture and restore property definitions,
prototype methods and static definitions; a later provider is preserved.
Shared Trapcode helper namespaces remain available to other enabled packs.

The UI cleanup does not redefine CPU simulation, live audio or approximate
light backends. Labels such as IES/Dome/Portal still need agreement with the
author about their promised behavior before release.

## Legacy setup windows

Setup controls use native edit/history hooks at the captured clip-local frame.
Related writes are grouped. Remove Frame writes a hold spike at the selected
frame and restores it at the next frame; it does not schedule a wall-clock
mutation. Setup windows release borrowed viewports and their watchers/listeners
when closed or deactivated. Datamosh/VHS rendering remains deferred because its
feedback history still depends on the sequence of renders.

## Verification

The focused UI suite passes 25 tests across Camera, designer gear, main
viewport, Optical lifecycle, setup windows, Trapcode lights and UI kit. Tests
exercise dispatcher clicks, local focus time, serialized 3D tracking,
independent gear registration, scoped rendering, failed editor initialization,
prototype restoration, frame-local edits, tab removal and preview ownership.
Full repository results are in the [combined report](davidium-integration-fixes.md).

These tests use controlled host DOM/runtime fixtures. They do not establish
visual layout quality or actual GPU output. No automation-capable T3 preview
was available. A new general settings-page API was not added; existing
property controls and shared ownership repair the concrete integration bugs.
