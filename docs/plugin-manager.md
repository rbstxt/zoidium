# Plugin manager overlays

`zoidium/runtime-config.js` loads the manager overlays after the shared plugin
APIs, then runs `plugins/plugin-manager.js` last to start the manager.

The implementation is split by responsibility:

- `plugin-manager-state.js` creates constants, registries, trackers, and readiness state.
- `plugin-manager-persistence.js` stores plugin choices and save approvals.
- `plugin-manager-assets.js` resolves bundle assets, validates manifests, and loads packages.
- `plugin-manager-picker.js` decorates picker entries and orders native effect search results.
- `plugin-manager-factories.js` installs effect/material factories and tracks plugin usage.
- `plugin-manager-lifecycle.js` activates, disposes, and unregisters modules and reports diagnostics.
- `plugin-manager-scanners.js` detects dependencies in serialized projects.
- `plugin-manager-fallbacks.js` preserves unavailable numeric objects and layers.
- `plugin-manager-projects.js` hooks project loading, saving, and field preservation.
- `plugin-manager-panel.js` builds the Plugins page and handles plugin/group toggles.

The overlays share `window.ZoidiumPluginManagerInternals`. This is an internal
implementation table, not a plugin API. Immutable bindings are captured from
that table. Mutable startup flags and the picker observer are read from the table
when used. Cross-overlay function calls use forwarding closures so circular
references resolve after all overlays load. Only the final startup script starts
initialization. Existing `PZ.zoidium.define` names and events remain the public API.

The body markers support the existing VM source-slice characterization tests.
`test/plugin-manager-source.js` assembles those bodies in their original order;
`test/plugin-manager-overlays.test.js` also executes the actual ordered overlays
to check imports, shared state, and startup exports.

`evaluatePluginSource` in the assets overlay is the manager's only dynamic source
evaluator. It preserves the native factory receiver and the module's named
arguments. Plugin code still runs with full origin privileges. The helper is a
common point for future evaluation policy, not a security sandbox.
