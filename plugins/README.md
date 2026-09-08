# Zoidium plugins

Plugins are optional CM3 extension tools. They add effects, materials, 3D object
classes, and UI integrations from an external layer around the runtime.
The plugin manager loads only `registry.json` at startup. When a pack is enabled,
it fetches that pack's generated single-line `bundle.json` once. The bundle contains the
manifest, runtime modules, presets, and text assets, so enabling a pack does not
fan out into dozens of small requests. Shader effect data remains lazy at the
CM3 object level: the manager parses and clones an effect preset only when
the user adds that effect to a project.

`bundle.json` files are generated artifacts. Source manifests and assets remain
in the plugin directory for editing and rebuilding, but are not part of the
normal runtime load path:

```bash
pnpm run build:plugin-bundles
pnpm run check:plugin-manifests
pnpm run check:plugin-bundles
```

The builder updates the versioned `bundle` and `manifest` URLs in
`registry.json`. `pnpm run build` and `pnpm run dist` run the bundle build
automatically. Static
hosts should serve the bundles with HTTP compression (Cloudflare Pages does
this automatically); the repository's `_headers` and Electron server also set
long-lived caching for versioned bundles.

UI-only plugins use a manifest `modules` array. Each module exports `activate(context)`
and may export `deactivate()`. The plugin manager runs activation only while the pack
is enabled and removes its integration when it is disabled.

## Custom 3D object classes

Plugins that add new 3D object classes declare an `objectClasses` array and a runtime
module. Each class uses the stable type namespace
`zoidium:<plugin-id>/<object-id>`, so it can be serialized without colliding with
CM3's numeric object types:

```json
{
  "objectClasses": [
    {
      "id": "rounded-box",
      "type": "zoidium:geometry-plus/rounded-box",
      "name": "Rounded Box",
      "description": "A box with rounded corners.",
      "schemaVersion": 1
    }
  ]
}
```

The module receives a scoped `context.object3d` API. Its `registerClass()` factory
must return a `PZ.object3d` subclass (or an instance), including `load()`, `toJSON()`,
`update()`, `prepare()`, and `unload()` lifecycle methods. The plugin manager adds
the declared classes to the 3D picker and stores their object IDs in project
metadata. If a project is opened while the class is unavailable, Zoidium keeps the
serialized data in a non-rendering Missing 3D Object placeholder and restores it
after the providing plugin is enabled.

To add class entries as variants inside an existing 3D picker entry, a manifest may
set `objectClassParent` to that entry's source `name` and numeric `type`. The class
items are appended to the parent's existing `list` while the plugin is enabled.

`Geometry+` is the reference implementation. It registers procedurally generated
Rounded Box, low-poly Polyhedron, Cone, Capsule, Tube, Gear, and Helix objects through
this API. It is disabled by default and can be enabled from the Plugin Manager.

Shader packs may also declare `effects` and `groups`. An effect references one preset
JSON and one GLSL file. A group references a group preset plus any inline shader files;
the manager hydrates those shaders before passing the data to CM3's built-in group
effect. The bundle builder embeds all of those references in the single plugin bundle.

If a module or native effect needs a file that is not expressed by the standard
manifest fields, declare it with `resources`:

```json
{
  "resources": [
    {
      "id": "style",
      "type": "text",
      "source": "./plugins/example/example.css?v=1"
    }
  ]
}
```

Runtime modules receive `context.getAsset(type, source)`. Native effect factories
receive the same resolver as `this._zoidiumGetAsset`. Both return the bundled
asset synchronously, or `undefined` for legacy non-bundled manifests, so a
versioned network fallback can be retained when necessary.

`Layer Input` adds source-track selectors to its Layer Input and Layer Input Displacement
Map effects and Layer Source material. The first implementation targets top-level video
tracks and stores references as stable track IDs, so reordering tracks does not retarget
a source. The runtime builds an isolated capture for the selected track and reuses it
for the effect/material during the current frame. Self-references and graph cycles are
rejected in the picker and are also guarded at render time; a cycle loaded from old or
hand-edited JSON is cleared from the offending source property and marked as circular.
The plugin is intentionally Zoidium-only because it uses the CM3 compositor and material
factory extension APIs.

The optional AfterClip pack is generated from the separate AfterClip source tree with:

```bash
pnpm run generate:afterclip -- "/path/to/AfterClip/src"
```

It includes the non-VHS, non-Twitch AfterClip shaders and group presets, normalized for
Zoidium's WebGL 1 and premultiplied source-over conventions.

Afterzoid Shader Pack 4 is generated from the user-provided source pack with:

```bash
pnpm run generate:alipfx -- "/path/to/Afterzoid Shader Pack 4"
```

The generated plugin keeps the pack's GLSL and preset data under `plugins/alipfx/`.
The original source-pack dumps and CM3 runtime directories are not included in the
repository.

## Manifest schema

Every registered manifest must match [`manifest.schema.json`](./manifest.schema.json).
The bundle builder and `pnpm run verify` validate the schema. The schema covers
effects, groups, native effects, materials, modules, resources, 3D object types,
and 3D object classes.

## Project metadata

Saved project JSON has a root-level `plugins` array only when an incompatible
plugin is actually used. Vanilla-compatible packs such as Light+ and Afterzoid
are never recorded as dependencies:

```json
{
  "plugins": [
    {
      "id": "native-fx",
      "name": "Native FX",
      "version": "4",
      "author": "Zoidium",
      "effects": ["dropshadow", "radialblurspin", "timeoffset", "posterizetime"]
    }
  ]
}
```

On load, Zoidium detects Native FX both from dependency metadata and from its
native effect types. It asks before enabling the pack. Declining
keeps the original effect data in a non-rendering Missing Native FX placeholder;
enabling the pack later restores those effects without reopening the project.
Project-provided paths are never loaded.

`Light+` is disabled by default. It provides an extended light chooser for Spot,
Point, Directional, and Hemisphere lights. Objects added through that chooser are
saved as ordinary CM3 light data and do not create a plugin dependency.

`Repeater` adds Repeater objects to 3D Scene. Repeater copies its source objects by
a fixed transform step, Linear Repeater interpolates between the first and last
copy, and Random Repeater uses deterministic seeded ranges so the layout does
not flicker while the timeline plays. Generated copies are runtime-only; project
JSON stores the repeater controls and source objects once.
