# Zoidium plugins

Plugins register optional effects and 3D object features without modifying Panzoid's bundled JavaScript.
The plugin manager loads only `registry.json` at startup. A pack manifest is fetched
when that pack is enabled, and the selected effect's preset and GLSL source are
loaded only when the user adds it to a project.

UI-only plugins use a manifest `modules` array. Each module exports `activate(context)`
and may export `deactivate()`. The plugin manager runs activation only while the pack
is enabled and restores the original UI behavior when it is disabled.

Shader packs may also declare `effects` and `groups`. An effect references one preset
JSON and one GLSL file. A group references a group preset plus any inline shader files;
the manager hydrates those shaders before passing the data to Panzoid's built-in group
effect. This keeps group presets optional and self-contained inside the plugin pack.

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
