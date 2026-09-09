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
      +--> temporary Electron stage  desktop packaging input
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

The cache remains after a browser or development Electron process exits. A
temporary packaging stage is removed after Electron Builder finishes.

## Browser and Electron entry points

`tools/serve-with-resources.js` serves the cached stage over HTTP. Workers and
WASM depend on that HTTP origin.

`main.js` prepares the same kind of stage, serves it on a loopback HTTP server,
and opens it in Electron. It removes the temporary packaged stage when the app
closes.

`tools/build-web.js` copies the cached stage to `dist/web/`. The repository root
is not a deployment directory because its `index.html` is only a placeholder.

## Plugin flow

Each plugin has an editable `manifest.json` and source assets. The bundle builder
validates the manifest against `plugins/manifest.schema.json`, embeds declared
assets, and writes one generated `bundle.json`. The runtime plugin manager loads
the registry first and fetches a plugin bundle when the plugin is enabled.

The manifest schema describes the fields shared by shader effects, groups,
native effects, materials, modules, resources, 3D object types, and 3D object
classes. The validator also checks that a 3D object class stays inside its
plugin namespace.

## Change boundaries

- CM3 resources belong in the ignored cache or generated stages.
- Zoidium runtime code belongs in `zoidium/`, `plugins/`, or the staging tools.
- Plugin source changes require a bundle rebuild and `pnpm run verify`.
- New runtime files must be copied into every required stage and covered by a
  verification check.
