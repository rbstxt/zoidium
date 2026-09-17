# Zoidium architecture

Zoidium has two parts. The CM3 runtime comes from the configured upstream page.
Zoidium adds the extension layer around that runtime.

## Runtime flow

```text
Clipmaker 3 page + Video Editor 2 page
                  |
                  v
tools/runtime-resources.js
      |
      +--> .zoidium-resources/       local cache
      +--> dist/web/                 static deployment stage
      +--> temporary desktop stage   Electron packaging input
```

The repository stores only Zoidium-owned files. The staging tool does the
following:

1. Fetches the configured Clipmaker 3 and Video Editor 2 HTML pages.
2. Finds and deduplicates their same-origin CSS, JavaScript, worker, shader,
   texture, and font references.
3. Writes those files to the cache while keeping the paths CM3 expects.
4. Copies the Zoidium overlay files and generated plugin bundles into the stage.
5. Removes the fixed editor entry script and eager initialization from the
   staged HTML.
6. Generates a stage-only profile map for the discovered Clipmaker and Video
   Editor entry scripts.
7. Loads the layout selected in Settings, aliases its editor instance to `CM`,
   and starts the Zoidium extension layer around it.

The cache remains after a browser or development desktop process exits. A
temporary packaging stage is removed after Electron Builder finishes.

## Browser and Electron entry points

`tools/serve-with-resources.js` serves the cached stage over HTTP. Workers and
WASM depend on that HTTP origin.

`desktop/main.cjs` serves the packaged stage on a fixed loopback HTTP port and
opens it in Electron. The stable origin keeps localStorage available across
restarts. The build stage contains the fetched CM3 graph, so the packaged
application does not fetch CM3 again at launch.

`tools/build-web.js` copies the cached stage to `dist/web/`. The repository root
is not a deployment directory because its `index.html` is only a placeholder.

## Plugin flow

Each plugin has an editable `manifest.json` and source assets. The bundle builder
validates the manifest against `plugins/manifest.schema.json`, embeds declared
assets, and writes one generated `bundle.json`. The runtime plugin manager loads
the registry first and fetches a plugin bundle when the plugin is enabled.
The builder also normalizes every embedded asset URL to the manifest version,
so authors bump only the manifest `version` instead of hand-editing per-file
cache-busting queries. First-party styles and scripts share one `assetVersion`
counter in `zoidium/runtime-config.js` that the runtime loader appends automatically.

The manifest schema describes the fields shared by shader effects, groups,
native effects, materials, modules, resources, 3D object types, and 3D object
classes. The validator also checks that a 3D object class stays inside its
plugin namespace.

## Extension startup and shared namespace

Extension startup treats the entry script, editor exposure, `initTool()`, and the
shared UI kit (`zoidium/ui-kit.js`) as fatal: nothing works without them. Overlay
stylesheets and every other pre/post-init script load in isolation: a failure is
recorded, reported through `zoidium:extension-script-error`, and the remaining scripts
still load. `zoidium:ready` carries the failure list so the debug log (and agents)
can tell a clean boot from a degraded one.

Every Zoidium-owned integration registers on the shared `PZ.zoidium` namespace
through `PZ.zoidium.define(name, api, owner)` instead of direct assignment. A collision
warns with both owners while keeping last-wins behavior; `PZ.zoidium.ownerOf(name)`
reports the current owner. The policy layer installs `define()` before any other
Zoidium script runs.

`zoidium/debug-log.js` writes a bounded diagnostic journal to localStorage.
Uncaught errors, rejected promises, loader phases, plugin usage milestones, and
health signals are written as they occur. A later page load marks a still-active
session as interrupted and includes its retained exceptions in the downloaded
log. Project diagnostics contain plugin item IDs and counts, not project names
or content.

## Change boundaries

- CM3 resources belong in the ignored cache or generated stages.
- Zoidium runtime code belongs in `zoidium/`, `plugins/`, or the staging tools.
- Plugin source changes require a bundle rebuild and `pnpm run verify`.
- New runtime files must be copied into every required stage and covered by a
  verification check.
