# Zoidium plugins

Plugins register optional effects without modifying Panzoid's bundled JavaScript.
The plugin manager loads only `registry.json` at startup. A pack manifest is fetched
when that pack is enabled, and the selected effect's preset and GLSL source are
loaded only when the user adds it to a project.

## Project metadata

Saved project JSON always has a root-level `plugins` array. Only plugins used by
effects that are still present in the project are included:

```json
{
  "plugins": [
    {
      "id": "alipfx-shader-pack-4",
      "name": "Afterzoid Shader Pack 4",
      "version": "4",
      "author": "AlipFX",
      "effects": ["4-color-gradient"]
    }
  ]
}
```

On load, Zoidium asks before enabling each required plugin. Project-provided
paths are never loaded; the plugin ID must match an entry in the bundled local
registry.

Afterzoid Shader Pack 4 is generated from the user-provided source pack with:

```bash
node tools/build-alipfx-plugin.js "/path/to/Afterzoid Shader Pack 4"
```
