# Davidium UI and plugin API integration audit

> This report records the initial audit. Follow-up fixes are documented in
> [the implementation report](davidium-integration-fixes.md). Source links now
> point to the repaired working trees; initial failure descriptions are historical.

Date: 2026-10-01. Source is the local Davidium `zoidium/` working tree, not only its committed HEAD. Target is the current Zoidium working tree, including existing user edits. This audit makes no runtime changes. External CM3 code was inspected only inside its ignored resource cache. No CM3 code is copied into this report or repository.

## Decision

No complete new plugin that opens custom UI should be merged unchanged. The small object-picker registration fix can be selected independently. Existing source-equivalent plugin bundles need no merge. Effector+ uses ordinary property controls and does not need a new settings page API. Camera+, Optical Flares and the setup/designer windows need shared UI ownership and several concrete fixes. Precomp+ should wait for agreement with its author about composition references, audio and save behavior.

This is a source and contract audit with focused executable reproductions. It does not certify GPU images or a browser interaction session. A plugin passing source tests does not establish that its custom editor works with the real host DOM.

## Plugin inventory

There are 20 source manifests and registry entries, versus 14 target plugins. The six new folders are `camera-plus`, `effector-plus`, `openzoid-legacy`, `optical-flares`, `precomp-plus`, and `trapcode-suite`. IDs come from each source manifest and the [plugins/registry.json:1](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/registry.json:1).

| Folder | Manifest ID | Source version | Kind | UI or integration status |
| --- | --- | --- | --- | --- |
| `afterclip` | `afterclip` | 3 | `shader-pack` | Editable plugin sources equivalent; no new UI to merge. |
| `alipfx` | `alipfx-shader-pack-4` | 6 | `shader-pack` | Editable plugin sources equivalent; no new UI to merge. |
| `camera-plus` | `camera-plus` | 1 | `extension` | New focus buttons/menu and track toggle; revise. |
| `ccfx` | `ccfx-shader-pack` | 2 | `shader-pack` | Editable plugin sources equivalent; no new UI to merge. |
| `core` | `core` | 12 | `core` | Target version 11; project-files changed and main-viewport added. |
| `easing-plus` | `easing-plus` | 20 | `extension` | Editable plugin sources equivalent; no new UI to merge. |
| `effector-plus` | `effector-plus` | 1 | `object` | New standard object-property groups; revise object registration, no custom settings page. |
| `geometry-plus` | `geometry-plus` | 6 | `object` | Editable plugin sources equivalent; no new UI to merge. |
| `layer-input` | `layer-input` | 9 | `native-fx` | Editable plugin sources equivalent; no new UI to merge. |
| `light-plus` | `light-plus` | 3 | `object` | Editable plugin sources equivalent; no new UI to merge. |
| `material-plus` | `material-plus` | 5 | `material-pack` | Editable plugin sources equivalent; no new UI to merge. |
| `native-fx` | `native-fx` | 8 | `native-fx` | Editable plugin sources equivalent; no new UI to merge. |
| `openzoid-legacy` | `openzoid-legacy` | 4 | `native-fx` | New VHS and Datamosh windows; defer history effects, redesign window editing. |
| `optical-flares` | `optical-flares` | 1 | `object` | New Setup launcher and element-stack editor; revise. |
| `particles-plus` | `particles-plus` | 6 | `extension` | Editable plugin sources equivalent; no new UI to merge. |
| `player-plus` | `player-plus` | 9 | `extension` | Editable plugin sources equivalent; no new UI to merge. |
| `precomp-plus` | `precomp-plus` | 1 | `extension` | New Comps sidebar and clip actions; defer for author discussion. |
| `scene-plus` | `repeater` | 10 | `object` | Target Repeater version 12, source version 10; preserve target implementation. |
| `text-plus` | `text-plus` | 17 | `object` | Editable plugin sources equivalent; no new UI to merge. |
| `trapcode-suite` | `trapcode-suite` | 3 | `object` | New fullscreen designers and gear entry, plus Light replacement; revise/split. |

Physical bundle differences for twelve existing plugins do not imply new features. Embedded asset strings contain CRLF differences; normalizing JSON and those strings makes every existing bundle equal except `core` and `scene-plus`. Rebuild selected changes from editable sources rather than copying these bundles. `light-plus` is already identical even as a physical bundle.

## Existing API and the smallest useful extension

The target already supports UI extensions. The `extension` kind accepts modules, and `activate(context)` receives the host editor, document, window, bundle asset resolver and shared APIs. [target plugins/plugin-manager.js:1311](/Users/dia/Projects/GitHub/Zoidium/plugins/plugin-manager.js:1311) The shared API explicitly supports custom property controls that opt in through `zoidiumControl`, preserve CM3 storage types, and return an unregister function. [target zoidium/plugin-apis.js:51](/Users/dia/Projects/GitHub/Zoidium/zoidium/plugin-apis.js:51) The UI kit already creates sidebar tabs and page headers. [target zoidium/ui-kit.js:55](/Users/dia/Projects/GitHub/Zoidium/zoidium/ui-kit.js:55)

The missing contract concerns ownership and lifecycle, rather than a new plugin kind. Current modules can change globals and DOM directly. They have no host-owned registration for object editor commands, property actions, modal windows, track actions, or preview use. The existing APIs also do not automatically dispose DOM created by a module. `deactivate()` is optional in current documentation. [target docs/plugin-api.md:88](/Users/dia/Projects/GitHub/Zoidium/docs/plugin-api.md:88)

| UI need | Existing path | Recommended integration |
| --- | --- | --- |
| Twist, Warp, fracture and camera numeric properties | Ordinary CM3 property definitions | Keep in the object inspector. Do not invent a global settings page. |
| Specialized compact control | `propertyControls.register()` | Use it for a focus action row or other property-local editor. Unregister on plugin disable. |
| Plugin-level preferences | Existing Settings panel and `ZoidiumUI` | Add a small host-owned settings section only if preferences are actually independent of objects/projects. |
| Object-specific large editor | No owned editor-command registration | Optional `context.ui.registerObjectEditor()` with predicate, label and an unregister function. Optical Flares must own its own command. |
| Property action buttons | Donor patches `createControls` and `runPropertyAction` repeatedly | Optional shared `registerPropertyAction()` and action-row renderer. Preserve the triggering button and scoped editor. |
| Composition workspace | `createMenubarTab()` exists, but only returns a DOM tab | Host registration should return a disposer for tab, panel, elevator descriptor and subscriptions. |
| Fullscreen designer preview | Several editors move the same viewport DOM node | Host preview lease should allow one owner and restore the exact original DOM position and edit state. |

These proposed names are design suggestions, not APIs already implemented. They can remain internal host helpers until multiple plugins use them. The user can also choose to omit custom fullscreen windows and keep normal inspectors and small actions. That path avoids most new API work.

A useful module scope should own disposers for listeners, timers, styles, object commands and panels; roll them back when activation fails; close windows when their object or project disappears; and dispose them on disable. Shared windows should handle focus trapping, keyboard dismissal, focus return, responsive layout and visible errors consistently. UI preference storage belongs in plugin-scoped settings; project values belong in serialized object properties. Preview-only adjustments must not alter export evaluation.

## Common lifecycle and serialization blockers

### Numeric factories bypass the target object registry

Effector+, Trapcode Suite and Optical Flares install numeric `PZ.object3d.create` wrappers instead of registering namespaced classes through `context.object3d`. Their manifests declare picker entries without `objectClasses`. See [plugins/effector-plus/manifest.json:10](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/effector-plus/manifest.json:10), [plugins/effector-plus/effector-runtime.js:49](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/effector-plus/effector-runtime.js:49), [plugins/trapcode-suite/trapcode-runtime.js:64](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/trapcode-runtime.js:64), and [plugins/optical-flares/optical-flares-runtime.js:70](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optical-flares-runtime.js:70).

The target object registry tracks instantiated custom objects, attaches metadata, and refuses unregistering a class while objects are in use. [target plugins/core/object3d-registry.js:114](/Users/dia/Projects/GitHub/Zoidium/plugins/core/object3d-registry.js:114) The manager checks tracked metadata and optional `runtime.isInUse()` before disabling a plugin. [target plugins/plugin-manager.js:2370](/Users/dia/Projects/GitHub/Zoidium/plugins/plugin-manager.js:2370) None of the six new runtime modules provides `isInUse()`. The direct numeric object instances do not pass through the registry's `instantiate()` path. A picker entry is plugin-owned, but the resulting object is not automatically tracked as plugin usage. Disabling a pack can therefore remove its factory/render hooks while live objects remain.

Use namespaced classes for new Zoidium object formats and explicit legacy aliases for already published numeric payloads. Preserve legacy numbers 7-13 through a migration path, with separate layer/object contexts for the ambiguous number 9. Do not silently reinterpret an existing serialized type. Camera layers need an equivalent layer registration and dependency mechanism.

### Activation is not transactional

The manager pushes a runtime into `state.runtimeModules` only after `await runtime.activate(...)` succeeds. [target plugins/plugin-manager.js:1325](/Users/dia/Projects/GitHub/Zoidium/plugins/plugin-manager.js:1325) If activation mutates globals and then throws, the failed module is absent from the list used for deactivation. Camera+ installs many render, layer and sequence changes before demanding a timeline track-label owner; the editor/PZ installation state is assigned at the end. [plugins/camera-plus/camera-runtime.js:1408](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-runtime.js:1408) A missing track-label method can leave earlier changes installed even though the manager displays an error.

Prepare a scope before activation, register cleanup as each operation succeeds, and roll the scope back on failure. Merely making `deactivate()` more comprehensive does not fix this execution order.

### Donor numeric placeholders are incomplete

The donor manager adds data-preserving numeric placeholders and a restoration path, but it should not be merged wholesale as the object API strategy. [plugins/plugin-manager.js:2246](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/plugin-manager.js:2246) Placeholder `unload()` does not remove the object from the retained missing-object set. Object restoration replaces a parent slot before loading succeeds, with no rollback. [plugins/plugin-manager.js:2355](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/plugin-manager.js:2355)

Camera-layer restoration scans only `project.sequence.videoTracks/audioTracks` and replaces `track.layer`; it does not replace `clip.object`, visit inactive clips, or restore layers in nested composites/media compositions. [plugins/plugin-manager.js:2399](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/plugin-manager.js:2399) The cached upstream `PZ.track.update()` assigns `track.layer` from the active `clip.object` on every evaluation. Therefore a replacement of `track.layer` alone disappears on the next frame. This is a concrete ownership mismatch, not a matter of UI polish.

Dependency detection should come from declared/registered plugin features and typed project traversal. The donor hardcodes native effect names and numeric ranges in the manager and identifies numeric objects by absence of an effects array. [plugins/plugin-manager.js:42](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/plugin-manager.js:42), [plugins/plugin-manager.js:1969](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/plugin-manager.js:1969) It also misses Camera-only tracking, extended camera properties and Precomp metadata when no new numeric layer is present.

### Shared fullscreen windows conflict over one viewport

The Trapcode designer, Optical Flares editor and VHS/Datamosh windows save the current viewport parent, move `CM.mainViewport.el` into their window, and restore it with `appendChild()` on close. [plugins/trapcode-suite/designer.js:309](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/designer.js:309), [plugins/optical-flares/optflares-editor.js:1492](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares-editor.js:1492), [plugins/openzoid-legacy/vhs-setup.js:582](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/vhs-setup.js:582), [plugins/openzoid-legacy/datamosh-setup.js:496](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/datamosh-setup.js:496)

Trapcode and Optical Flares coordinate through `designer.current`. VHS and Datamosh use separate editor globals. These groups can both be open, so the saved parent can itself be a temporary window. Closing them out of order can move the preview into a removed window. Each opens global keyboard/resize listeners and poll timers. A shared lease and host-owned dialog lifecycle are preferable to independent reparenting.

The fullscreen roots are plain `div` elements. The audited files define no dialog role, `aria-modal`, focus trap or focus return. Several preset, system and composition selectors use clickable `div`/`li` nodes without keyboard activation. See [plugins/trapcode-suite/designer.js:127](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/designer.js:127), [plugins/optical-flares/optflares-editor.js:435](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares-editor.js:435), and [plugins/precomp-plus/comps.js:619](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:619). Copying these windows and only changing their CSS would leave those problems intact.

## Per-plugin findings

### Precomp+ should wait for author agreement

1. The Comps tab never mounts through the actual target UI kit. `installTab()` creates a `PZ.ui.compsPanel` object and passes that object as `panel`; the kit expects a DOM element and immediately writes `panel.style.top`. The `try/catch` suppresses the resulting TypeError, and activation still returns successfully. [plugins/precomp-plus/precomp-runtime.js:184](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/precomp-runtime.js:184), [target zoidium/ui-kit.js:71](/Users/dia/Projects/GitHub/Zoidium/zoidium/ui-kit.js:71) Pass `panel.el`, register the corresponding panel object deliberately, and retain both the returned tab and its disposer.
2. Even correcting the DOM argument is insufficient. Deactivation removes only `installedTab.el` and the clip-menu wrapper. It leaves the actual sidebar tab, elevator descriptor, `PZ.ui.comps.panels`, `editor.save`, `recovery.backUp`, project watchers and `precomposeSelection` in place. It does not leave an active composition safely or prevent disabling while one is open. [plugins/precomp-plus/precomp-runtime.js:222](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/precomp-runtime.js:222), [plugins/precomp-plus/comps.js:490](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:490), [plugins/precomp-plus/comps.js:575](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:575)
3. New composition media passes `isComp` and `compLength` into upstream `PZ.media.load()`, but this plugin never adds the raw OpenZoid media serialization changes. Upstream ignores those fields. `listComps()` relies exclusively on `m.isComp`. [plugins/precomp-plus/comps.js:11](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:11), [plugins/precomp-plus/comps.js:187](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:187) Actual cached CM3 media-class evaluation confirms `isComp=false`, no length, and no serialized composition keys after loading the plugin's payload. This blocks ordinary composition discovery before save/reload is even tested.
4. Main's collapsed composite and the media composition independently clone the selected layer data. The collapsed clip contains `type:2` with `objects:children`; it has no stable reference to the composition media. Opening the source matches clip names or lists of source names. Renames and duplicate names can select the wrong composition, and editing the media does not update the already cloned Main composite. [plugins/precomp-plus/comps.js:356](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:356), [plugins/precomp-plus/comps.js:388](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:388), [plugins/precomp-plus/comps.js:451](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:451)
5. The audio-only branch deletes selected Main clips and inserts no replacement. The video branch also deletes selected clips, including audio in a mixed selection, but only builds the video composite replacement. [plugins/precomp-plus/comps.js:400](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:400), [plugins/precomp-plus/comps.js:429](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:429) Agree on preservation of audible output before calling this a safe precompose operation.
6. Composition switching clears and rebuilds the one live project sequence. Calls to `tr.load()` and media loading are not awaited before the switch proceeds. Save temporarily swaps Main into that same sequence, calls the original save and restores the editing composition; failures are swallowed, and restoration is not protected by `finally`. Recovery follows a separate synchronous swap. [plugins/precomp-plus/comps.js:70](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:70), [plugins/precomp-plus/comps.js:148](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:148), [plugins/precomp-plus/comps.js:490](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/precomp-plus/comps.js:490) Existing undo commands can also hold references to replaced tracks/clips. Define composition identity, export source, async save behavior, history scope, and project switching before rewriting this engine.

Discuss whether composition reuse is live or snapshot-based, how audio and nested time offsets behave, how cycle prevention works, and whether an active composition belongs in a separate editor sequence rather than replacing Main in place. This affects the data model. A generic settings API cannot resolve it.

### Camera+ needs repairs before merging

The most useful UI additions are focus Link/Set/Unlink actions and the track 3D switch. Both can fit into the current inspector/timeline once the host owns their registration. They do not require a fullscreen settings window.

- Link and Set currently fail immediately. `routeFocusAction()` invokes `showFocusTargetMenu(null, target, mode)`, while the real menu begins with `button.closest('li')`. Both reproduced `TypeError: Cannot read properties of null (reading 'closest')`. The dispatcher receives an element but drops it before routing. [plugins/camera-plus/camera-runtime.js:782](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-runtime.js:782), [plugins/camera-plus/focus-ui.js:2](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/focus-ui.js:2)
- Camera definitions declare `buttons`, but Camera+ installs a dispatcher without installing a renderer for those definitions. Upstream lacks this renderer; the Setup Legacy code explicitly supplies it. Thus Camera+ alone does not have a reliable entry point for its focus tools. [plugins/camera-plus/camera-class.js:301](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-class.js:301), [plugins/camera-plus/camera-runtime.js:1076](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-runtime.js:1076), [plugins/openzoid-legacy/datamosh-setup.js:552](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/datamosh-setup.js:552) Use the existing custom-property-control API or a shared action renderer, not a dependency on enabling unrelated legacy effects.
- The 3D switch writes `track.track3d` directly, outside a history operation. The added Transform effect uses history, but its toggle flag does not share that transaction. The plugin never patches track load/toJSON, and upstream does not serialize `track3d`. [plugins/camera-plus/camera-runtime.js:1319](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-runtime.js:1319) The flag disappears on reopen. Add the required track serialization and dependency metadata before shipping the toggle.
- The toggle is a 22 by 16 pixel button with state communicated mostly by text color/background and title. Use a shared timeline control with an accessible name and `aria-pressed`, keep the setting in undo, and avoid binding DOM controls to tracks by page-wide document order. `enhanceExistingLabels()` scans all matching eye buttons for every known editor. [plugins/camera-plus/camera-runtime.js:1293](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-runtime.js:1293), [plugins/camera-plus/camera-runtime.js:1348](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-runtime.js:1348)
- Disable cleanup removes the button before reading `btn.parentElement` to restore the label grid. That parent is then null and the best-effort catch hides the exception, so the four-column grid may stay behind. Save the parent and its original style before removal. [plugins/camera-plus/camera-runtime.js:1384](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-runtime.js:1384)
- Preset activation appends loaded media to the live project outside history. Disable removes matching Camera presets without unloading them. [plugins/camera-plus/camera-runtime.js:1157](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-runtime.js:1157) Prefer a host preset catalogue rather than modifying a user's project on enable.

The source test suite has five Camera failures, all at `installLayerLoad()` because its stub lacks `PZ.layer.prototype.load`. That is a stale test fixture, not proof that actual CM3 lacks the method. It still prevents accepting the donor verification as passing, and the tests currently stop before exposing the real focus failure. Source-wide verification is 288 passed, 5 failed, 293 tests. The temporal-render audit separately decides which Camera rendering features can be retained.

### Optical Flares needs a self-owned object editor

The Options window can be retained after repair. Its large element stack justifies an object editor when a compact inspector cannot handle stack ordering/presets. It should open directly from the selected Optical Flares object and reuse host transport controls. A separate fullscreen Setup splash requiring an extra click adds little value. [plugins/optical-flares/optflares-editor.js:435](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares-editor.js:435)

The current gear button belongs to `trapcode-suite/designer-gear.js`. Without that unrelated plugin, Optical Flares has only a programmatic global entry point. Source README admits this dependency but its manifest does not declare it. [plugins/optical-flares/README.md:10](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/README.md:10), [plugins/trapcode-suite/designer-gear.js:90](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/designer-gear.js:90)

Close restores its viewport/listeners during a normal UI close. Runtime deactivation only unwraps the numeric create function; it does not close an open editor, remove injected CSS, clear preview modifiers, or dispose the designer registration. [plugins/optical-flares/optical-flares-runtime.js:133](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optical-flares-runtime.js:133), [plugins/optical-flares/optflares-editor.js:1423](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares-editor.js:1423) Enable/disable must own the entire window.

The editor writes preview brightness, scale and position into `root._designerPreview`; the object's normal `update(time)` multiplies those values into its actual material uniforms. UI preview state therefore affects normal rendering and potentially export at the same project/frame until the window closes. [plugins/optical-flares/optflares-editor.js:509](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares-editor.js:509), [plugins/optical-flares/optflares.js:1101](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares.js:1101) Use a separate preview evaluator or explicitly override only the preview render context.

Solo toggles `element._solo` without history or serialized properties. `checkElementVisible()` reads this state, but there are no other `_solo` reads in the object renderer. It can change whole-quad visibility when a soloed element is disabled; it does not implement a general per-element solo filter. Close does not clear `_solo`. [plugins/optical-flares/optflares-editor.js:1020](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares-editor.js:1020), [plugins/optical-flares/optflares.js:1192](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares.js:1192) Agree whether Solo is preview-only, then implement it entirely in that context and restore it on close.

Property edits call `ops.setValue()` with the global rounded playback frame, while the other audited editors subtract `property.frameOffset`. Verify clips starting away from zero, nested sequences and keyframed elements before merging. [plugins/optical-flares/optflares-editor.js:522](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares-editor.js:522) Cancel reloads the initial stack/properties through further history operations, so history and redo behavior must be tested rather than treated as a simple modal rollback. [plugins/optical-flares/optflares-editor.js:1449](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares-editor.js:1449)

### Trapcode designers and lights need splitting

The designer's reuse of `PZ.ui.edit` is useful. Its separate fullscreen controls, 200 ms refresh interval, clickable preset/system/block divs and viewport movement should move into the same host lifecycle as Optical Flares. [plugins/trapcode-suite/designer.js:173](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/designer.js:173), [plugins/trapcode-suite/designer.js:309](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/designer.js:309) Runtime disable unwraps only the object factory; the gear module removes only the command generator wrapper. Neither closes `designer.current` or removes already mounted gear buttons. [plugins/trapcode-suite/trapcode-runtime.js:125](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/trapcode-runtime.js:125), [plugins/trapcode-suite/designer-gear.js:129](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/designer-gear.js:129) Re-enable evaluates the designer file again and creates a new designer registry, potentially losing the reference to a previously open window. Avoid recreating shared helper state while another plugin uses it.

Lights should be a separate feature or integrated with Light+, rather than forcing a particle suite to replace the basic Light picker. The manager only replaces a vanilla entry. If Light+ already owns that entry, the Trapcode Light chooser is appended instead, giving overlapping providers; the README's "last one enabled wins" description is not enforced. [plugins/plugin-manager.js:1500](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/plugin-manager.js:1500), [plugins/trapcode-suite/README.md:38](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/README.md:38)

More seriously, `lights-c4d.js` changes `Light.propertyDefinitions`, `Light.prototype.changeObjectType/load/update`, and adds a once-only guard. These changes are never undone by the runtime deactivation that only unwraps `PZ.object3d.create`. Disabled Trapcode lights continue affecting vanilla light instances. [plugins/trapcode-suite/lights-c4d.js:42](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/lights-c4d.js:42), [plugins/trapcode-suite/lights-c4d.js:115](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/lights-c4d.js:115), [plugins/trapcode-suite/lights-c4d.js:269](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/lights-c4d.js:269)

The visible light descriptions also promise more than their backends implement. Dome uses a HemisphereLight; IES is a SpotLight with an IES profile tag; Portal is a RectAreaLight or DirectionalLight, not a global-illumination portal. [plugins/trapcode-suite/lights-c4d.js:57](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/lights-c4d.js:57), [plugins/trapcode-suite/lights-c4d.js:325](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/lights-c4d.js:325) Naming and accepted approximations need author agreement. The source already distinguishes legacy Hemisphere type 4 from new Area type 4 by payload properties. Preserve that migration and never blindly renumber old project objects.

### Setup Legacy windows can be replaced by ordinary controls

VHS and Datamosh setup windows offer presets and parameter sliders for the same serialized effect values already available in the inspector. A compact preset/action section inside that inspector is a viable integration. This would avoid moving the viewport, fullscreen ownership and duplicate property-button patches. The deterministic-render audit must first decide which underlying effects to retain.

Slider and preset changes call `property.set()` directly without grouping changes into history/property operations. [plugins/openzoid-legacy/vhs-setup.js:318](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/vhs-setup.js:318), [plugins/openzoid-legacy/datamosh-setup.js:197](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/datamosh-setup.js:197) Batch presets as one undoable operation and coalesce slider gestures. Randomizing a preset at an explicit user click is acceptable if the resulting values are stored; it is distinct from random rendering on every redraw. The `Mosh!` button does store random values. [plugins/openzoid-legacy/datamosh-setup.js:405](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/datamosh-setup.js:405)

The `Remove Frame` action sets hold to 1, then 350 ms later sets hold to 0.15 using whichever playback frame exists then. Its timer is not owned or cancelled on close. Even paused at one frame, the project value changes after wall-clock time. Replace this with a serialized frame/keyframe operation or explicit fixed-time effect parameter. [plugins/openzoid-legacy/datamosh-setup.js:420](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/datamosh-setup.js:420)

Modules do close their own open windows and release their shared property-button renderer on deactivation, which is better than the newer designers. They leave setup methods/data on the editor and a compatible global dispatcher after disable. [plugins/openzoid-legacy/vhs-setup.js:784](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/vhs-setup.js:784), [plugins/openzoid-legacy/datamosh-setup.js:701](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/datamosh-setup.js:701) Declare intentionally persistent host services separately from per-plugin functions.

The legacy pack also declares `shaders/common.glsl` as a checked-in resource. Root audit confirmed its trimmed contents equal the ignored CM3 cached vertex shader. This violates the repository's CM3 resource boundary even if the plugin bundle builds correctly. Resolve the host shader through its asset pipeline or use an independently authored Zoidium vertex implementation; do not copy that file or its current embedded bundle payload. [Source legacy resource manifest](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/manifest.json:58)

Image bundle use is correct: the build system embeds image data URIs in `assets.text`, so `getAsset('text', vhs-logo.png)` is valid. [target tools/build-plugin-bundles.js:111](/Users/dia/Projects/GitHub/Zoidium/tools/build-plugin-bundles.js:111) The inspected new plugin JavaScript and manifests contain no Japanese text. All UI copy remains English, as required. Branded descriptions and credits still need a separate rights/attribution review.

### Effector+ does not require new custom UI

Its Twist, Warp and fracture settings use standard `PZ.property` definitions and ordinary picker groups. [plugins/effector-plus/manifest.json:1](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/effector-plus/manifest.json:1), [plugins/effector-plus/deformer-objects.js:39](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/effector-plus/deformer-objects.js:39) Focus the integration work on deterministic deformation, geometry ownership, performance and object registry migration. Numeric type 9 for fracture is distinct from Camera layer 9 but should use typed legacy migration. Factory and scene-update hooks need usage tracking and transactional cleanup. The render audit decides whether fracture itself is ready.

### Main viewport alias should become a host preview accessor

The new core file wraps the upstream viewport constructor, retains every constructed instance in a strong array, and assigns a `mainViewport` alias to known editor globals after readiness. [plugins/core/main-viewport.js:17](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/core/main-viewport.js:17) It chooses the last matching viewport, or even a last global fallback when there is no matching editor. That is not a durable contract for multiple editors, destroyed panels or popout viewports. Use an explicit accessor/registration for the host's main preview with lifetime cleanup. Keep this separate from the dialogs that want to borrow it. It is useful infrastructure after repair, not a reason to enable six custom windows at once.

## Independently mergeable object-picker fix

The target currently skips all later `objectTypes` entries when any entry of that plugin has registered. The donor changes this to per-definition idempotency by including name and type. [target plugins/plugin-manager.js:1440](/Users/dia/Projects/GitHub/Zoidium/plugins/plugin-manager.js:1440), [plugins/plugin-manager.js:1484](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/plugin-manager.js:1484) The precise selected change is:

```js
if (objectTypes.some((entry) =>
  entry?._zoidiumPluginId === plugin.id &&
  entry?.name === definition.name &&
  entry?.type === definition.type
)) continue;
```

This fixes multi-entry object plugins without adopting any numeric-factory maps or UI redesign. Running the donor `node --test test/plugin-object-types.test.js` passed 2/2 tests. The tests execute the real registration loop and check all picker entries, replacement bookkeeping and repeat registration. [test/plugin-object-types.test.js:19](/Users/dia/Projects/GitHub/Davidium/zoidium/test/plugin-object-types.test.js:19) Adapt their manifest fixture into a generic synthetic multi-entry manifest when selecting the fix, so the target test does not need an unmerged Trapcode payload.

## Focused evidence collected

| Check | Result | Scope |
| --- | --- | --- |
| Target full verification, run by root audit | 276/276 tests passed | Existing working tree before any merge |
| Source full verification, run by root audit | Manifests/bundles/syntax passed; 288/293 tests passed | Five Camera fixture failures |
| Donor object-picker registration test | 2/2 passed | Multi-entry and idempotent registration |
| Actual target UI kit + Precomp runtime with host-shaped DOM objects | Activation succeeds but catches `Cannot set properties of undefined (setting 'top')`; zero tabs | Reproduces object-vs-element mount bug |
| Same Precomp activation/disable | `saveStillPatched=true`, one retained panel, `precomposeSelection` still a function | Reproduces lifecycle leftovers |
| Actual focus menu + extracted real Camera router | Both Link and Set throw null `closest` TypeError | Reproduces discarded triggering button |
| Actual cached CM3 media class + composition payload | `isComp=false`, length missing, no serialized comp keys | Reproduces missing raw media integration |
| Donor numeric-layer restoration function | Changes `track.layer`, leaves `clip.object` unchanged; next evaluation selects old placeholder | Reproduces nonpersistent Camera-layer restoration |
| Bundle asset inspection | VHS PNG is a text-map data URI | No image asset bug |
| Japanese runtime string scan | No matches in six new plugin JS/manifests | Does not assess dynamic user project text |

Before merge, verify plugin enable/disable/enable, activation failure rollback, open-window disable, project/object deletion, overlapping windows, keyboard-only operation, popup/layout resize, save/reload while a composition is active, undo/redo after composition switching, and correct local frames in nested clips. Rendering checks must also compare fresh direct seeks, forward/backward seeks, repeated paused redraw, preview/export and warm/cold caches.

## Physical changed-file appendix

The full root inventory records 70 Davidium-only paths and 46 different paths, 116 total after line-ending normalization of plain files. Existing JSON bundles can still differ because embedded source strings encode CRLF. It excludes ignored CM3 runtime/cache outputs. The twelve existing plugin bundle paths should be reduced to the two actual changed bundles after semantic normalization. Existing target-only files, including the newer Repeater source/test, are not deletions to import.

| Status | Path |
| --- | --- |
| Different | `ARCHITECTURE.md` |
| Different | `CONTRIBUTING.md` |
| Different | `README.ja.md` |
| Different | `README.md` |
| Different | `about/acknowledgements/index.html` |
| Different | `about/acknowledgements/ja/index.html` |
| Different | `about/privacy/index.html` |
| Different | `about/privacy/ja/index.html` |
| Different | `desktop/main.cjs` |
| Different | `docs/plugin-api.md` |
| Different | `docs/research/openzoid-dof-text-portability.md` |
| New | `package-lock.json` |
| Different | `package.json` |
| Different | `plugins/README.md` |
| Different | `plugins/afterclip/bundle.json` |
| Different | `plugins/alipfx/bundle.json` |
| New | `plugins/camera-plus/README.md` |
| New | `plugins/camera-plus/bundle.json` |
| New | `plugins/camera-plus/camera-class.js` |
| New | `plugins/camera-plus/camera-layer.js` |
| New | `plugins/camera-plus/camera-runtime.js` |
| New | `plugins/camera-plus/depth-passes.js` |
| New | `plugins/camera-plus/focus-ui.js` |
| New | `plugins/camera-plus/manifest.json` |
| New | `plugins/camera-plus/render-layer.js` |
| New | `plugins/camera-plus/render-sequence.js` |
| New | `plugins/camera-plus/scene-dof.js` |
| New | `plugins/camera-plus/sequence-tracking.js` |
| New | `plugins/camera-plus/vibrate.js` |
| Different | `plugins/ccfx/bundle.json` |
| Different | `plugins/core/bundle.json` |
| New | `plugins/core/main-viewport.js` |
| Different | `plugins/core/manifest.json` |
| Different | `plugins/core/project-files.js` |
| Different | `plugins/easing-plus/bundle.json` |
| New | `plugins/effector-plus/README.md` |
| New | `plugins/effector-plus/bundle.json` |
| New | `plugins/effector-plus/deform-framework.js` |
| New | `plugins/effector-plus/deformer-objects.js` |
| New | `plugins/effector-plus/effector-runtime.js` |
| New | `plugins/effector-plus/manifest.json` |
| Different | `plugins/geometry-plus/bundle.json` |
| Different | `plugins/layer-input/bundle.json` |
| Different | `plugins/material-plus/bundle.json` |
| Different | `plugins/native-fx/bundle.json` |
| New | `plugins/openzoid-legacy/README.md` |
| New | `plugins/openzoid-legacy/bundle.json` |
| New | `plugins/openzoid-legacy/datamosh-export.js` |
| New | `plugins/openzoid-legacy/datamosh-logo.svg` |
| New | `plugins/openzoid-legacy/datamosh-render.js` |
| New | `plugins/openzoid-legacy/datamosh-setup.js` |
| New | `plugins/openzoid-legacy/effects/datamosh.js` |
| New | `plugins/openzoid-legacy/effects/echo-legacy.js` |
| New | `plugins/openzoid-legacy/effects/jpegdamage.js` |
| New | `plugins/openzoid-legacy/effects/posterizetime-legacy.js` |
| New | `plugins/openzoid-legacy/effects/vhs.js` |
| New | `plugins/openzoid-legacy/manifest.json` |
| New | `plugins/openzoid-legacy/shaders/common.glsl` |
| New | `plugins/openzoid-legacy/shaders/fx_echo.glsl` |
| New | `plugins/openzoid-legacy/shaders/fx_jpegdamage.glsl` |
| New | `plugins/openzoid-legacy/shaders/fx_posterizetime.glsl` |
| New | `plugins/openzoid-legacy/vhs-logo.png` |
| New | `plugins/openzoid-legacy/vhs-setup.css` |
| New | `plugins/openzoid-legacy/vhs-setup.js` |
| New | `plugins/optical-flares/README.md` |
| New | `plugins/optical-flares/bundle.json` |
| New | `plugins/optical-flares/manifest.json` |
| New | `plugins/optical-flares/optflares-editor.js` |
| New | `plugins/optical-flares/optflares.js` |
| New | `plugins/optical-flares/optical-flares-runtime.js` |
| New | `plugins/optical-flares/trapcode-common.js` |
| Different | `plugins/particles-plus/bundle.json` |
| Different | `plugins/player-plus/bundle.json` |
| Different | `plugins/plugin-manager.js` |
| New | `plugins/precomp-plus/README.md` |
| New | `plugins/precomp-plus/bundle.json` |
| New | `plugins/precomp-plus/comps.js` |
| New | `plugins/precomp-plus/manifest.json` |
| New | `plugins/precomp-plus/precomp-runtime.js` |
| Different | `plugins/registry.json` |
| Different | `plugins/scene-plus/bundle.json` |
| Different | `plugins/scene-plus/manifest.json` |
| Different | `plugins/scene-plus/scene-plus.js` |
| Different | `plugins/text-plus/bundle.json` |
| New | `plugins/trapcode-suite/README.md` |
| New | `plugins/trapcode-suite/bundle.json` |
| New | `plugins/trapcode-suite/designer-gear.js` |
| New | `plugins/trapcode-suite/designer.js` |
| New | `plugins/trapcode-suite/form.js` |
| New | `plugins/trapcode-suite/lights-c4d.js` |
| New | `plugins/trapcode-suite/manifest.json` |
| New | `plugins/trapcode-suite/particular.js` |
| New | `plugins/trapcode-suite/plexus.js` |
| New | `plugins/trapcode-suite/trapcode-common.js` |
| New | `plugins/trapcode-suite/trapcode-runtime.js` |
| Different | `pnpm-lock.yaml` |
| Different | `pnpm-workspace.yaml` |
| New | `test/camera-plus.test.js` |
| New | `test/designer-gear.test.js` |
| New | `test/effector-plus.test.js` |
| New | `test/main-viewport.test.js` |
| Different | `test/plugin-dependencies.test.js` |
| Different | `test/plugin-groups.test.js` |
| New | `test/plugin-object-types.test.js` |
| New | `test/precomp-plus.test.js` |
| Different | `test/project-files.test.js` |
| New | `test/setup-windows.test.js` |
| Different | `tools/runtime-resources.js` |
| Different | `tools/serve-with-resources.js` |
| Different | `tools/start-electron.js` |
| Different | `zoidium/debug-log.js` |
| Different | `zoidium/direct-download.js` |
| Different | `zoidium/project-restore.js` |
| Different | `zoidium/runtime-config.js` |
| Different | `zoidium/runtime-loader.js` |
| Different | `zoidium/settings.js` |
