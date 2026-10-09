# Effector+ (compatibility)

Effector+ is a thin compatibility layer. The Twist, Warp, and Voronoi Fracture
objects are implemented in the Effector plugin (`repeater`), which provides
the menu entries and the namespaced `zoidium:repeater/*` types.

This plugin maps the numeric types used by Davidium Effector+ projects onto
those namespaced classes:

- 7 → `zoidium:repeater/twist`
- 8 → `zoidium:repeater/warp`
- 9 → `zoidium:repeater/voronoi-fracture`

Loaded objects are saved with the namespaced type, so a project is upgraded
the first time it is saved. The plugin has no picker entries. It needs the
Effector plugin to be enabled for these objects to resolve; if it is not, they
load as missing objects and recover when Effector is enabled again.

Numeric types are claimed in `PZ.zoidium.legacyObject3dTypes`. Activation
fails rather than overriding a claim held by another plugin.
