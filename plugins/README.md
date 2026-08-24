# Zoidium plugins

Plugins register optional effects and 3D object features without modifying Panzoid's bundled JavaScript.
The plugin manager loads only `registry.json` at startup. A pack manifest is fetched
when that pack is enabled, and the selected effect's preset and GLSL source are
loaded only when the user adds it to a project.

UI-only plugins use a manifest `modules` array. Each module exports `activate(context)`
and may export `deactivate()`. The plugin manager runs activation only while the pack
is enabled and restores the original UI behavior when it is disabled.

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
      "version": "1",
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
