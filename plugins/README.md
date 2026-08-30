# Zoidium plugins

Plugins register optional effects and 3D object features without modifying Panzoid's bundled JavaScript.
The plugin manager loads only `registry.json` at startup. When a pack is enabled,
it fetches that pack's generated single-line `bundle.json` once. The bundle contains the
manifest, runtime modules, presets, and text assets, so enabling a pack does not
fan out into dozens of small requests. Shader effect data remains lazy at the
Panzoid object level: the manager parses and clones an effect preset only when
the user adds that effect to a project.

`bundle.json` files are generated artifacts. Source manifests and assets remain
in the plugin directory for editing and rebuilding, but are not part of the
normal runtime load path:

```bash
npm run build:plugin-bundles
npm run check:plugin-bundles
```

The builder updates the versioned `bundle`, `manifest`, and `locale` URLs in
`registry.json`. `npm run dist` runs the bundle build automatically. Static
hosts should serve the bundles with HTTP compression (Cloudflare Pages does
this automatically); the repository's `_headers` and Electron server also set
long-lived caching for versioned bundles and locale catalogs.

Japanese locale catalogs intentionally remain separate, small, lazy language
chunks. This prevents enabling Japanese UI from downloading the full AfterClip
or Afterzoid shader pack when only translations are needed.

UI-only plugins use a manifest `modules` array. Each module exports `activate(context)`
and may export `deactivate()`. The plugin manager runs activation only while the pack
is enabled and restores the original UI behavior when it is disabled.

`日本語化` is an offline, catalog-driven UI localization pack. It loads its core
Japanese catalog plus the `locales.ja` catalog declared by every plugin manifest,
then translates exact source messages in the editor DOM, dynamically generated UI,
dialogs, and same-origin popup windows. It does not split identifiers or translate
individual words at runtime. The pack is disabled by default and does not override
the editor font, so untranslated Latin text continues to use the original Source Code
Pro font.

## Localization catalogs

Every plugin must ship a Japanese catalog and declare it in its manifest:

```json
{
  "version": "1",
  "locales": {
    "ja": "./plugins/example/locales/ja.json?v=1"
  }
}
```

The catalog uses the exact English source message as its key:

```json
{
  "schemaVersion": 1,
  "locale": "ja",
  "namespace": "example",
  "messages": {
    "Example Effect": "サンプルエフェクト",
    "Controls the effect amount.": "エフェクト量を調整します。",
    "Amount": "量"
  }
}
```

Catalogs must cover registry metadata, effect/group/object/material names and
descriptions, property and option labels, and text created by plugin modules. When a
plugin version changes, update both its locale URL cachebuster and any translated
source messages that changed. The active localization API is also available as
`window.ZoidiumI18n`; modules may call `t(message, variables)` for direct lookup or
`registerCatalog(catalog, source)` when they create messages that cannot be declared
in their manifest catalog.

Shader packs may also declare `effects` and `groups`. An effect references one preset
JSON and one GLSL file. A group references a group preset plus any inline shader files;
the manager hydrates those shaders before passing the data to Panzoid's built-in group
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
The plugin is intentionally Zoidium-only because it extends the compositor and material
factory APIs.

The optional AfterClip pack is generated from the separate AfterClip source tree with:

```bash
node tools/build-afterclip-plugin.js "/path/to/AfterClip/src"
```

It includes the non-VHS, non-Twitch AfterClip shaders and group presets, normalized for
Zoidium's WebGL 1 and premultiplied source-over conventions.

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
      "version": "2",
      "author": "Zoidium",
      "effects": ["dropshadow", "radialblurspin"]
    }
  ]
}
```

On load, Zoidium detects Native FX both from dependency metadata and from the
AfterClip-compatible effect types. It asks before enabling the pack. Declining
keeps the original effect data in a non-rendering Missing Native FX placeholder;
enabling the pack later restores those effects without reopening the project.
Project-provided paths are never loaded.

`Light+` is disabled by default. The standard `Light` object creates a Spot Light
directly; enabling `Light+` replaces that picker entry with a chooser for Spot,
Point, Directional, and Hemisphere lights. Objects added through that chooser are
saved as ordinary Panzoid light data and do not create a plugin dependency.

Afterzoid Shader Pack 4 is generated from the user-provided source pack with:

```bash
node tools/build-alipfx-plugin.js "/path/to/Afterzoid Shader Pack 4"
```
