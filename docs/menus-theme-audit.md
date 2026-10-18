# Menus and theme audit

Baseline: `dde1bcc`. Branch: `ux/menus-theme`.

The shared menu API and examples are in [Plugin UI](plugin-ui.md#context-and-anchored-menus).
Shape+, centered sidebar tabs and all Assets popups use it. The searchable node
add menu keeps its structure, shares metrics/highlight, and participates in the
single-open coordinator. Text inputs retain native browser menus; other floating
window chrome cancels them. The intentional CM3 preview-canvas menu is unchanged.
Curve point right-click deletion is unchanged.

## Literal color triage

Scanned every tracked runtime `.js` and `.css` file at the baseline, including
inline styles, injected CSS, SVG fills, canvas paints and numeric color constants.
Excluded tests, build tools, vendored payloads and `plugins/alipfx/`. The broad
scan found 65 files, including four non-color matches. No source CM3 resources
were added. Files containing only `rgb()`/`hsl()` function definitions or calls
were inspected too and have no additional chrome colors. Named colors were checked too;
`transparent` and `currentColor` express transparency/inheritance rather than
a component palette.

“Fixed” means UI chrome now uses the shared theme. “Kept” records content,
canonical theme definitions, startup fallbacks, or the existing native host
boundary. “Dead” duplicated menu styles were removed rather than retained.

| File | Classification and reason |
| --- | --- |
| `about/legal.css` | Fixed help/rescue page chrome; reads the saved theme through theme-document.js. |
| `about/rescue/project-rescue.js` | Fixed rescue panel/button/status chrome. Token fallbacks remain for the standalone bookmarklet on pages without Zoidium. |
| `plugins/asset-manager/assets-model.js` | Kept: Asset label palette is project content data. |
| `plugins/asset-manager/assets.css` | Removed dead duplicated menu styles. Kept the thumbnail transparency checker as content backing. |
| `plugins/constraints/constraint-overlay.js` | Kept: 3D scene constraint line must contrast with arbitrary rendered content. |
| `plugins/core/audio-track-visibility.js` | Fixed enabled/disabled audio toolbar icon fills. |
| `plugins/core/centered-layout.js` | Removed dead tab-menu CSS and implementation; sidebar shadow uses the shared shadow token. |
| `plugins/core/particle-defaults.js` | Kept: Default particle gradients are saved render properties. |
| `plugins/core/project-files.js` | Kept: False positive: 0x10ffff is a Unicode bound, not a color. |
| `plugins/core/restore-videoeditor-controls.js` | Fixed restored toolbar icon colors. |
| `plugins/geometry-plus/geometry-plus.js` | Kept: Default geometry gradient is render data. |
| `plugins/geometry-plus/spline-math.js` | Kept: RGBA format mentioned by interpolation documentation; no UI paint. |
| `plugins/graph-plus/canvas.js` | Kept: Already tokenized selection overlays. No edits allowed in graph-plus. |
| `plugins/graph-plus/editor-helpers.js` | Kept: False positive: &#39; is an HTML escape, not a color. No edits allowed. |
| `plugins/layer-input/layer-input-host.js` | Kept: White mesh/material base color preserves source image rendering. |
| `plugins/magic-looks/looks-widgets.js` | Fixed live wheel/curve redraw on theme changes with listener cleanup. Chrome reads computed theme variables; fallback values remain for isolated widgets. Hue/tint discs and R/G/B identities stay content colors. |
| `plugins/material-plus/image-plus.js` | Kept: White texture material color is rendering data. |
| `plugins/material-plus/pbr-plus.js` | Kept: White PBR material color is rendering data. |
| `plugins/material-plus/surface-material.js` | Kept: Black/white gradient defaults are material data. |
| `plugins/material-plus/surface-props.js` | Kept: Black/white gradient defaults are saved material properties. |
| `plugins/material-plus/uv-custom.js` | Kept: White native material fallback is rendering data. |
| `plugins/motion-path/overlay.js` | Kept: Scene path/handle outlines deliberately contrast with arbitrary scene content. |
| `plugins/motion-path/runtime.js` | Fixed the motion path toolbar icon. Scene overlay colors stay separate. |
| `plugins/native-fx/colorcurves.css` | Kept: Only R/G/B channel identities are literal. Graph/grid/point chrome already uses tokens and updates through SVG/CSS. |
| `plugins/native-fx/effects/ccpixelpolly.js` | Kept: Transparent renderer clear color is effect output. |
| `plugins/native-fx/effects/dropshadow.js` | Kept: Transparent renderer clear color is effect output. |
| `plugins/openzoid-legacy/datamosh-render.js` | Kept: False positive: integer hashing/seed constants, not UI paint. |
| `plugins/openzoid-legacy/effect-windows.js` | Kept: White fallback is a color property input value, not chrome. |
| `plugins/openzoid-legacy/effects/ascii.js` | Kept: RGBA strings encode rendered image pixels. |
| `plugins/openzoid-legacy/effects/tracery-overlay.js` | Kept: RGBA strings and white masks encode rendered output. |
| `plugins/optical-flares/optflares-thumbs.js` | Kept: Flare previews, rings, masks and lens sprites represent rendered content. |
| `plugins/optical-flares/optflares-window-data.js` | Kept: Black thumbnail backgrounds preserve additive flare previews; borders/labels already use tokens. |
| `plugins/optical-flares/optflares-window.js` | Kept: the named "black" preview background is rendered flare content selected by the user. |
| `plugins/plugin-manager.css` | Fixed warning, error, experimental badge and focus chrome. Per-plugin metadata badge identities stay content colors. |
| `plugins/scene-plus/scene-deform.js` | Kept: 3D deformation cages require scene contrast and distinguish edit mode. |
| `plugins/shape-plus/editor-canvas.js` | Kept: Path/anchor/handle overlays must remain visible over arbitrary scene and shape colors. |
| `plugins/shape-plus/editor-menu.js` | Removed dead duplicated CSS/DOM implementation; adapter uses the shared menu. |
| `plugins/shape-plus/editor.js` | Fixed selected/inactive viewport toolbar icon fills and colors. |
| `plugins/shape-plus/native-hints.js` | Fixed hint text and swatch borders. Kept actual paint colors and gradient stops. |
| `plugins/shape-plus/native-ui.js` | Fixed Zoidium Contents/add-row icon colors. |
| `plugins/shape-plus/properties.js` | Kept: Saved shape gradient defaults. |
| `plugins/shape-plus/svg-import.js` | Kept: SVG named-color parsing table is imported artwork data. |
| `plugins/trapcode-suite/form.js` | Kept: White particle material color preserves render colors. |
| `plugins/trapcode-suite/lights-c4d.js` | Fixed light controls icon fill and secondary label text. |
| `plugins/trapcode-suite/particular-defs.js` | Kept: Default saved particle color gradient. |
| `plugins/trapcode-suite/particular.js` | Kept: Particle preset gradient stops are render content. |
| `plugins/trapcode-suite/trapcode-color.js` | Kept: Particle preset gradients and empty white gradient preview are content data. |
| `plugins/trapcode-suite/trapcode-common.js` | Kept: Default saved particle gradient values. |
| `zoidium-welcome-tour.css` | Fixed notice text and link colors. |
| `zoidium/debug-log.js` | Fixed diagnostic panel, text and buttons. Startup fallbacks are needed before UI styles exist. |
| `zoidium/plugin-apis.js` | Removed obsolete literal fallbacks from theme-backed property mode buttons. |
| `zoidium/plugin-manager-factories.js` | Kept: Missing-layer scene placeholder material represents project/scene content. |
| `zoidium/plugin-manager-picker.js` | Kept: Per-plugin metadata badge identity colors and RGBA conversion; UI status chrome lives in plugin-manager.css. |
| `zoidium/plugin-manager-state.js` | Kept: Default plugin identity palette, used as metadata badge colors. |
| `zoidium/runtime-loader.js` | Fixed bootstrap failure panel/buttons with theme tokens and pre-stylesheet startup fallbacks. |
| `zoidium/shared/color.js` | Kept: Color conversion fallback value is content data. |
| `zoidium/theme-clips.js` | Kept: Native clip-label contrast fallback retained at the CM3 boundary. |
| `zoidium/theme-editor.css` | Fixed the Edit color profile button background, border and text. |
| `zoidium/theme-model.js` | Theme definitions and contrast endpoints retained. Added dark/light neutral token generation for every palette; these are the authoritative theme values. |
| `zoidium/ui-kit-controls.js` | Kept: Default value of a color input is content data. |
| `zoidium/ui-node-editor-fields.js` | Kept: Default color parameter and gradient preview serialization are content data. |
| `zoidium/ui-node-editor-graph.js` | Fixed missing-node tint using danger. Kept socket type colors and category hashes as stable graph identities. |
| `zoidium/ui-node-editor.css` | Fixed grid, chrome shadows, borders, ramp handles, focus, missing/default title tint and add-menu metrics/highlight. Kept default socket color as type identity. |
| `zoidium/ui-overrides.css` | Fixed extension restore, toast, settings/help/link chrome and extension scrollbars. Existing native CM3 scrollbar defaults and native palette fallbacks remain at the host boundary. |
| `zoidium/ui-window.css` | Fixed window/tab/resize-grip/danger chrome and scoped native row/input/button defaults inside extension containers. Root literals define the default theme, not a second component palette. |

## New tokens and light themes

`--zui-shadow` is the shared shadow pigment, black for every palette. All other
new tokens are derived menu styling/metrics: `--zui-menu-active`,
`--zui-menu-font-size`, `--zui-menu-title-font-size`, `--zui-menu-padding`,
`--zui-menu-item-padding`, and `--zui-menu-title-padding`.

The baseline Theme Editor had no neutral light palette. It only changed the five
accent/clip colors. The shared theme model now supplies light neutral colors when
the main focus color has HSL lightness above 60%, with dark text/value/danger
colors. Built-in themes keep their existing dark surfaces. The Theme Editor
explains this behavior. It requires no saved theme schema changes and changes no
project data. Help pages use the saved theme without bootstrapping CM3. Popup
style mirroring now forwards live theme changes as well as the initial palette.

## Graph+ gaps, left for the concurrent branch

No files in `plugins/graph-plus/` were changed. Its source currently contains no
literal neutral chrome colors. `theme.js` still defines its own `.g2-popup-*`
container/item metrics instead of the shared menu. `gpSyncTheme` copies a fixed
list of theme tokens into popup documents and omits the new shadow/menu tokens.
An adopter should use the main kit's `openMenu({ document, owner, ... })` and
include the shared UI stylesheet, or extend that token mirroring list. The
existing curve/property color families are content identities.

## Verification and artifacts

Runtime captures and machine-readable results are saved under
`/Users/dia/Projects/GitHub/zoidium-beta-work/menus-theme/`.
`runtime-qa.cjs` replays baseline source through browser routing for before shots
and loads the working branch for after shots. It uses a fresh context per version,
the same centered layout and a temporary project created from the Shape+ media
preset. The light theme is created through the Theme Editor's own state API.

All requested checks passed: `build:plugin-bundles`,
`check:plugin-manifests`, `check:plugin-bundles`, and `verify`. Verification covers
27 manifests/bundles, syntax in 389 JS files, the 1000-line limit, ESLint, and
2,464 passing tests. `build:web` staged 177 cached CM3 resources and produced a
363-file deployment tree. The stage was inspected for the injected index,
shared menu/theme scripts, v161 overlay assets and local Source Code Pro font.
The generated deployment tree was removed after inspection.

The final main and extra browser runs report zero page/console errors. The
popup menu measured 210 by 115 pixels and remained inside its 500 by 450
viewport. An open Magic Looks curve canvas changed its background pixel from
`[32,32,32,255]` to `[250,250,250,255]` on a live theme change. The native browser
menu test changed from allowed to cancelled on empty window chrome, while
inputs and the intentional preview canvas remained allowed.

The shared kit API is `openMenu({ owner, document, x, y, anchor, align, title,
items, focusReturn, signal, onClose })`. The plugin-scoped API closes owned
menus on disable. Items support label, shortcut, hint, swatch color, disabled,
checked, muted, separator and section title options. Handles expose `close()`,
`element`, and `isOpen()`.

Plugin versions: core 68, Shape+ 14, Assets 10, Easing+ 28, Magic Looks 15,
Motion Paths 3, Trapcode Suite 38. Manifest asset queries, registry entries,
bundles and integrity hashes were rebuilt together. Shared assets use version
161 and the registry query uses version 112.

### Screenshot coverage and limitations

There are 75 PNG captures in the artifact directory. Every main surface has
`before-<surface>-dark.png`, `before-<surface>-light.png`,
`after-<surface>-dark.png`, and `after-<surface>-light.png`:

- `shape-menu`, `shape-selection-menu`, `tab-menu`
- `assets-row-menu`, `assets-project-menu`, `assets-label-menu`
- `node-add-menu`, `node-fields`
- `theme-editor`, `welcome`, `restore`, `plugins`
- `surfaces`, `surfaces-bottom`
- `videoeditor`, `help`, `help-rescue`, `rescue-panel`

Additional captures are `after-surfaces-live-light.png`,
`after-popup-menu-light.png`, and `after-popup-menu-live-dark.png`.
Machine-readable details are `runtime-results.json` and `extra-results.json`.
The scripts and their logs are saved alongside the captures.

Migrated menus were opened in the real staged CM3 runtime. Node fields and
curve widgets use their real shared builders in a temporary kit window.
Rare bootstrap/debug/rescue states, the light-controls icon/hint styles and
the Easing+ outline use source-backed visual fixtures; complete error recovery
and light setup workflows were not exercised. Video Editor captures disable
Shape+ and Motion Paths, which already fail to activate in that layout at the
baseline because it has no native viewport toolbar. CM3's native dark surfaces
and existing accent behavior remain unchanged. Before-light captures use the
same light main color in the baseline Theme Editor, whose neutral surfaces
still stayed dark.

No source CM3 runtime directories were added, no original cache files were
modified, and no project data was uploaded. Only the copied ignored cache is
retained. The local server was stopped after verification.


## Files changed

76 files, including generated bundles and versioned manifests:

```text
about/acknowledgements/index.html
about/acknowledgements/ja/index.html
about/copyright/index.html
about/copyright/ja/index.html
about/faq/index.html
about/faq/ja/index.html
about/legal.css
about/privacy/index.html
about/privacy/ja/index.html
about/rescue/index.html
about/rescue/ja/index.html
about/rescue/project-rescue.js
about/terms/index.html
about/terms/ja/index.html
docs/menus-theme-audit.md
docs/plugin-api.md
docs/plugin-ui.md
plugins/asset-manager/assets-window.js
plugins/asset-manager/assets.css
plugins/asset-manager/bundle.json
plugins/asset-manager/manifest.json
plugins/core/audio-track-visibility.js
plugins/core/bundle.json
plugins/core/centered-layout.js
plugins/core/manifest.json
plugins/core/restore-videoeditor-controls.js
plugins/core/window-stylesheet-guard.js
plugins/easing-plus/bundle.json
plugins/easing-plus/easing-plus.css
plugins/easing-plus/manifest.json
plugins/magic-looks/bundle.json
plugins/magic-looks/looks-widgets.js
plugins/magic-looks/manifest.json
plugins/motion-path/bundle.json
plugins/motion-path/manifest.json
plugins/motion-path/runtime.js
plugins/plugin-manager.css
plugins/registry.json
plugins/shape-plus/bundle.json
plugins/shape-plus/editor-actions.js
plugins/shape-plus/editor-menu.js
plugins/shape-plus/editor.js
plugins/shape-plus/manifest.json
plugins/shape-plus/native-hints.js
plugins/shape-plus/native-ui.js
plugins/trapcode-suite/bundle.json
plugins/trapcode-suite/lights-c4d.js
plugins/trapcode-suite/manifest.json
test/audio-track-visibility.test.js
test/plugin-lifecycle.test.js
test/plugin-small-windows-theme.test.js
test/popup-theme.test.js
test/shape-plus-native-hints.test.js
test/theme-document.test.js
test/theme-model.test.js
test/ui-kit-surface.test.js
test/ui-menu.test.js
zoidium-welcome-tour.css
zoidium/debug-log.js
zoidium/plugin-apis.js
zoidium/plugin-manager-lifecycle.js
zoidium/runtime-config.js
zoidium/runtime-loader.js
zoidium/settings.js
zoidium/theme-document.js
zoidium/theme-editor.css
zoidium/theme-editor.js
zoidium/theme-model.js
zoidium/ui-kit-menus.js
zoidium/ui-kit-windows.js
zoidium/ui-kit.js
zoidium/ui-node-editor-graph.js
zoidium/ui-node-editor-menu.js
zoidium/ui-node-editor.css
zoidium/ui-overrides.css
zoidium/ui-window.css
```
