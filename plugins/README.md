# Zoidium plugins

Plugins register optional effects without modifying Panzoid's bundled JavaScript.
The plugin manager loads only `registry.json` at startup. A pack manifest is fetched
when that pack is enabled, and the selected effect's preset and GLSL source are
loaded only when the user adds it to a project.

AlipFX Shader Pack 4 is generated from the user-provided source pack with:

```bash
node tools/build-alipfx-plugin.js "/path/to/Afterzoid Shader Pack 4"
```
