# Plugin UI: floating windows and controls

Every Zoidium editor that needs more than a property row (setup dialogs,
designers, attribute panels, node editors, composition lists, focus tools)
opens as a **floating window** above the CM3 editor. The editor stays usable
behind it, so changes preview live in the normal viewport. Fullscreen
overlays that hide the editor, bundled UI fonts and borrowed preview viewports
are not used; a window can be maximized by the user when more room helps.

Windows and controls use the editor UI font, themed panels and title rows,
the theme accent for focus/selection, the theme value color, scrubbable
numbers and `proprow propbutton` buttons. Styles live
in `zoidium/ui-window.css`. Colors and the font are **theme tokens** (below),
so windows follow Settings (theme, hue, saturation, UI font).

## Theme tokens

Use these CSS custom properties in any plugin widget instead of literal colors:

| Token | Meaning |
| --- | --- |
| `--zui-font` | Editor UI font chosen in Settings |
| `--zui-accent`, `--zui-accent-rgb`, `--zui-accent-strong` | Theme focus/selection color (`rgb(var(--zui-accent-rgb) / .3)` for alpha) |
| `--zui-value`, `--zui-value-strong` | Theme value/link color (numbers, active items) |
| `--zui-bg`, `--zui-bg-title`, `--zui-bg-title-focused`, `--zui-bg-input`, `--zui-bg-sunken` | Panel, title row, input and sunken backgrounds |
| `--zui-border`, `--zui-border-soft`, `--zui-hover` | Borders and hover fill |
| `--zui-text`, `--zui-text-strong`, `--zui-text-bright`, `--zui-text-muted`, `--zui-text-faint`, `--zui-danger` | Text colors |
| `--zui-font-size` | Window body and control text (16px, like CM3 property rows) |
| `--zui-font-size-small` | Secondary text: list details, hints, units (14px, like CM3 option items) |
| `--zui-font-size-title` | Window and section titles (18px, like CM3 section titles) |
| `--zui-font-size-compact` | Canvas toolbars only: node headers, graph tiles (12px) |

## Which surface to use

| Need | Use |
| --- | --- |
| A few extra controls on an object/effect | Its CM3 properties (they appear in the normal panel) |
| A focused editor for one object/effect (setup, designer, attributes) | `registerEditor` / `registerAttributePanel` + a window |
| Native property rows inside a window | `context.ui.properties()` |
| A new sidebar page (like Plugins, Compositions) | `context.ui.sidePanel()` |
| A custom widget (curve, wheel, graph, node editor) | A window with plugin-owned widget DOM using theme tokens |
| A product-specific look users rely on (e.g. a suite designer) | A window with a registered **skin** (`registerSkin`) |

## Opening a window

Modules receive `context.ui`. Windows opened through it are closed when the
plugin is disabled, and their ids/persist keys are namespaced by plugin id.

```js
const win = context.ui.openWindow({
  id: `vhs:${effectKey}`,      // reopening the same id focuses the window
  title: "VHS Setup",
  subtitle: clipName,          // optional, shown dimmed in the title bar
  persistKey: "vhs-setup",     // remembers position, size and collapsed state
  width: 340,
  height: 460,
  mount(body, win) {
    const c = context.ui.controls;
    const tone = c.section("Tape");
    tone.body.appendChild(c.slider({
      label: "Tracking", min: 0, max: 1, step: 0.01, value: current,
      onInput: (v) => previewValue(v),   // continuous, while dragging
      onChange: (v) => commitValue(v),   // once per edit: record undo here
    }).element);
    body.appendChild(tone.element);
    return () => { /* remove watchers created by mount */ };
  },
  isValid: () => effect.parent != null, // polled; window closes when false
  footer: [{ title: "Done", variant: "primary", onClick: () => win.close() }],
});
```

Native effects and other code without a module context may call the global
`ZoidiumUI.openWindow` with ids prefixed by their plugin id, and must close
them on deactivation with `ZoidiumUI.closeWindows("<plugin-id>:")`.

More `openWindow` options: `placement` (`"right"` default, `"center"`,
`"left"`), `minWidth`/`minHeight`, `resizable`, `collapsible`, `maximizable`
(default: resizable), `skin` (a name passed to `registerSkin`), and
`chrome: "custom"` (no host title bar; the plugin draws its own header and
calls `win.makeDragHandle(headerElement)`).

Window object: `element`, `body`, `footer`, `titlebar`, `setTitle()`,
`setSubtitle()`, `setFooter(buttons)`, `setCollapsed()`, `setMaximized()`,
`toggleMaximized()`, `isMaximized()`, `makeDragHandle(el)`, `focus()`,
`reveal()` (expand, fit fully inside the editor and focus),
`close()`, `isOpen()`, `onClose(fn)`, `addCleanup(fn)`.

Behavior provided by the host: drag by title bar (or drag handle), resize from
the right/bottom edges and corner, maximize/restore, double-click title to
collapse (double-click a custom drag handle to maximize), Escape closes, focus
raises the window, the window is kept reachable when the browser resizes, and
key events inside a window do not reach CM3 editor shortcuts. Geometry,
collapsed and maximized state persist under `persistKey`.

## Native property rows: `context.ui.properties()`

```js
const view = context.ui.properties({
  target: () => particular,            // object, property list, group, or a getter
  keys: ["emitter.position", "emitter.velocity"], // optional subset; or (key, property) => bool
  labelWidth: 0.45,                    // optional label column fraction
});
panel.appendChild(view.element);
// view.setTarget(next); view.refresh(); view.dispose() in the mount cleanup
```

The rows are CM3's own (`PZ.ui.edit`): keyframe toggles, expressions, easing,
scrubbing, live values during playback and undo history work exactly as in the
Objects/Effects panels. Prefer this over rebuilding controls for existing
properties; use `controls` only for values that are not CM3 properties.

## Editors for objects, effects and materials

```js
context.ui.registerEditor({
  title: "Particular Designer",        // button: "Open Particular Designer"
  icon: "settings",                    // gear icon in the object's list row
  match: (target) => target instanceof ParticularClass,
  open: (target) => openDesigner(target),
});
```

CM3 lists then show a gear on matching rows and an "Open ..." button above
their properties. This registration is the only way to put an open-window
button in the property panel: do not add per-effect property buttons (custom
`zoidiumControl` renderers, `buttons:` declarations rendered into a row, or
hand-injected `proprow propbutton` elements). The button reads "Open <title>"
and its hint reads "Open the <title> window". Use the window title for the
registration title; launch labels and hints always follow this convention.
The registration is removed when the plugin is disabled. Launch rows appear only
in property panels that show values and commands. Name-only graph/track lists
with `showPropertyControls: false` or `hideAllListItemButtons: true` receive
neither launch rows nor editor gears. Objects/Effects list gears and native
property views keep their existing behavior.

When migrating a property-button launcher, retain any serialized placeholder
key in its property definition with `visible: false`, and remove its custom
control binding. Existing projects must keep loading and saving that key.

`match` runs when CM3 builds those rows. If it reads a property (for example,
PBR+ shows Node Editor only while **Use node graph** is on), call
`context.ui.refreshEditors()` from that property's `changed` handler so the
button appears or disappears right away.

`registerAttributePanel` builds the common case — a tabbed attribute window
(the Cinema 4D / After Effects / Blender convention: one tab per topic) whose
tabs show native rows:

```js
context.ui.registerAttributePanel({
  id: "fracture", title: "Voronoi Fracture",
  match: (target) => target.type === VORONOI_TYPE,
  tabs: [
    { id: "sources", title: "Sources", keys: ["distribution", "cells", "seed", "cellScale"] },
    { id: "motion", title: "Motion", keys: ["distance", "scatter", "spin"] },
    { id: "field", title: "Field", keys: (key) => key.startsWith("field") },
    { id: "custom", title: "Preview", build: (container, target, ui) => cleanupFn },
  ],
});
```

## Node graphs: `ZoidiumUI.nodeEditor()`

A themed node graph editor for plugins whose data is a graph (Material+ Node
Material uses it). It edits plain JSON and never evaluates the graph:

```js
const editor = ZoidiumUI.nodeEditor({
  nodeTypes: { noise: { title: "Noise", category: "Texture",
    inputs: [{ id: "uv", label: "UV", type: "vector" }],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    params: [{ id: "octaves", label: "Octaves", control: "number", min: 1, max: 8, step: 1, default: 4 }] } },
  graph: { nodes: [], links: [] },
  onChange: (graph, info) => commitOneUndoStep(graph, info.label), // once per gesture
});
win.body.appendChild(editor.element); // setGraph(), getGraph(), frameAll(), destroy()
```

Interaction follows Blender/Unreal conventions: middle-drag or Space-drag
pans, the wheel zooms, drag from an output to an input connects, right-click,
The header's "+ Add node" button, right-clicking the grid, Shift+A or Tab
open the searchable add menu, Ctrl/Cmd+drag cuts links,
Delete, Ctrl/Cmd+D, Ctrl/Cmd+C/V and Home/F work as expected.

Material+ exposes every numeric and color parameter as an input socket on its
parameter row. A connected field stays visible and disabled; disconnecting
restores its stored value. Options remain ordinary dropdowns. Registry params
opt into this with `socket: true` and a matching input port. `hidden: true`
keeps a historical node type evaluable while removing it from the add menu.

Float and Math retain signed numeric values beyond 0–1 through numeric links.
Math evaluates texture operands per pixel using luminance. Local parameter
expressions also sample each pixel: Gradient, Checker, Sine Wave, color
correction, colorizer, spectra, Blackbody, blending, arithmetic, and noise
brightness/contrast or Dirt radius. Color and Float pass through linked
textures. Color parameters sample RGB; numeric parameters sample luminance.
Noise lattice settings, octaves, seed and animation speeds, Random Color,
Texture/Projection/UvW whole-image transforms and Fresnel shader settings
use spatial mean luminance, or mean RGB for a color parameter. These settings
describe a whole texture operation rather than a pixel-local expression.
Only conversion to a displayed or baked texture clips values to 0–1. Math
Compare returns 1 when operands differ by at most 0.01. Divide and Modulo
return 0 for a divisor whose magnitude is below 1e-12; non-finite results also
return 0. Saved historical Math nodes migrate to a hidden legacy evaluator;
the separate historical math types keep their serialized IDs and behavior.

RGB Spectrum Wavelength and Gaussian Spectrum Center shift a connected
Input's wavelength relative to 550 nm. Blackbody Kelvin shifts its connected
Input relative to 4000 K. Without Input, these fields specify absolute values.
Bake Resolution supports 128, 256, 512, 1024 and 2048. Node Material and the
PBR+ node graph bake in a worker, replace pending edits with the newest graph,
and await the full chosen resolution before export. Baked maps use linear
magnification and mipmaps; the editor's Color output thumbnail is 128 pixels.

## Side panels: `context.ui.sidePanel()`

```js
const side = context.ui.sidePanel({ title: "Compositions", tabTitle: "Comps", icon: "layers" });
side.body.appendChild(context.ui.controls.note("...").element);
```

Side panels get the standard page header, background and scrolling of the
built-in panels and are removed on disable. The sidebar tab goes above About
by default; `position: "after:Effects"` places it right below an existing tab
(matched by its title), and `position: "afterAbout"` right below About. Do not build sidebar panels from
raw `createMenubarTab` markup.

## Confirm dialogs: `ZoidiumUI.confirm()` / `context.ui.confirm()`

```js
const approved = await context.ui.confirm({
  title: "Delete composition",
  message: 'Delete composition "Intro"?',
  confirmLabel: "Delete",   // danger styling comes from `danger: true`
  cancelLabel: "Cancel",
  danger: true,
});
if (approved) deleteComposition();
```

Questions use this shared dialog; plain messages use `notify`. Never use
native `confirm()` / `alert()`: they block the editor and behave differently
in desktop builds. The dialog is a small centered `openWindow` with the
shared footer buttons: Enter confirms, Escape and the close button cancel,
and a `danger` dialog focuses the safe (cancel) button. It returns a
`Promise<boolean>` and also calls `onConfirm` / `onCancel`. The window is
380px wide and shrink-wraps its content (title + message + footer), so a
one-line question stays compact. Keep the exact
wording of the question, including multi-step flows (ask twice with two
calls). Code that ran synchronously after `confirm()` must move into the
callback or after the `await`.

## Skins: plugin-specific looks

Some suites keep a look their users know (the Rowbyte & Red Giant suite
designers follow the original products). A skin is CSS scoped to the windows
that opt in; it cannot leak into the editor:

```js
context.ui.registerSkin("designer", `
  :scope { background: #101014; }            /* the window itself */
  .tc-preset:hover { color: #fff; }          /* scoped automatically */
`);
context.ui.openWindow({ id: "designer", skin: "designer", chrome: "custom", ... });
```

Selectors are prefixed with the window selector, `:scope` (or `:root`/`body`)
means the window, and `@media` blocks are scoped too. The host still owns
dragging, resizing, focus, keyboard isolation, Escape, close and disable
cleanup. Skins may not bundle fonts or remote assets; use system font stacks
or `var(--zui-font)`.

Skin CSS is untrusted and sanitized on registration: declarations that fetch
anything but an embedded `data:` URL are dropped (so a skin can neither phone
home nor pull a hostile font), `@import` is removed, and `@keyframes` names
are namespaced per skin id (with `animation` / `animation-name` references
rewritten to match), so two suites can use the same keyframe name without
colliding. A rule emptied by sanitizing is dropped.

## Controls

`context.ui.controls` (also `ZoidiumUI.controls`). Each builder returns
`{ element, get(), set(value), setDisabled(bool) }`.

| Builder | Options |
| --- | --- |
| `number` | `label, value, min, max, step, unit, dragSpeed, onInput, onChange` — drag horizontally to scrub (Shift ×10, Alt ×0.1), click to type |
| `slider` | `label, value, min, max, step, unit, softLimit, onInput, onChange` |
| `checkbox` | `label, value, onChange` |
| `select` | `label, value, options: [{ value, label }], onChange`; also `setOptions()` |
| `color` | `label, value: "#rrggbb", onInput, onChange` |
| `text` | `label, value, placeholder, multiline, rows, onInput, onChange` |
| `button` | `title, hint, variant: "primary" | "danger", onClick` |
| `buttonRow` | array of button options |
| `section` | `title` or `{ title, collapsed }`; append rows to `.body` |
| `tabs` | `[{ id, title, render(panel) }]`, lazy rendering; `show(id)` |
| `list` | `items: [{ id, title, detail }], value, emptyText, onSelect, onActivate`; `setItems()` |
| `note` | `(message, "warning")` |

## Editing rules

- A window edits the project through the same property objects CM3 uses.
  Commit each user edit once (`onChange`) through the native history hooks so
  undo/redo works. `onInput` may update the live value for preview only.
- Keep serialized configuration in project properties. Window position and
  size are UI state and stay in `persistKey` storage.
- Window code must not hold render or simulation state. Rendering stays a pure
  function of project data and time (see `docs/plugin-api.md`).
- Close windows whose target object is deleted (`isValid`) and release every
  listener in the `mount` cleanup.
- All text is English.

## Core Theme Editor

Settings > Color profile > Edit… opens the single Theme Editor window.
Named user themes, main-color derivation, advanced overrides and clip colors
preview immediately and persist locally. Editing a built-in creates a named
copy. Custom hue/saturation profiles remain available in Settings. The window
uses the standard resizable chrome and remembers geometry.

The theme controller is an internal `ZoidiumUIBuilder.themeEditor` component;
`open()` is available to core code and is not part of the public `ZoidiumUI`
or plugin API. Plugins continue to use `--zui-*` tokens. Layer registration
and media presets supply the runtime type names; plugin authors do not need
to add theme controls. See [editor theme storage and compatibility](project-compatibility.md#editor-themes).

## Context and anchored menus

Use `context.ui.openMenu(options)` for plugin menus, or
`ZoidiumUI.openMenu(options)` outside a module context. The scoped version
also closes the menu when the plugin is disabled. Both return
`{ element, close(restoreFocus = true), isOpen() }`.

```js
const menu = context.ui.openMenu({
  owner: win.element,          // remove the owner to dismiss the menu
  anchor: moreButton,          // or x: event.clientX, y: event.clientY
  align: "end",               // optional anchor alignment; default is start
  title: "Selection",         // optional overall heading and accessible label
  items: [
    { label: "Rename", shortcut: "F2", action: rename },
    { separator: true },
    { title: "Display" },      // optional section heading
    { label: "Visible", checked: visible, action: toggleVisible },
    { label: "Red", color: "#b53838", hint: "Asset label", action: setRedLabel },
    { label: "Delete", disabled: locked, action: remove },
  ],
});
// Menus tied to a temporary operation can instead pass an AbortSignal.
menu.close(false);            // dismiss without moving focus back
```

`owner` accepts a DOM element or a Zoidium window handle. `document` defaults
to the anchor's or owner's document, then the main document. Pointer coordinates
belong to that document's viewport. Popup callers must supply their own owner
or document, and load the shared UI styles just as they do for other kit UI.
`focusReturn` overrides the anchor or previously focused element. `signal`
and `onClose` provide explicit disposal and notification. No submenus are
provided. Actions can open another menu, as the Assets label picker does.

Menus measure their rendered size, flip at viewport edges, and clamp to the
viewport. They close on outside pointerdown, Escape, host scroll/resize,
window blur/pagehide, owner removal or abort. Scrolling within the menu
keeps it open. Arrow keys, Home/End and Tab/Shift+Tab move focus between enabled
items; Enter/Space activate. Tab cycles within the open menu, preserving the
Shape+ interaction. Disabled entries cannot activate. `muted: true` dims an informational action
without disabling it, as in Assets usage guidance. Hover and keyboard
selection use the same highlight. One menu is open across the application,
including popup documents and the searchable node add menu.

Menu colors use existing theme tokens. `--zui-menu-active` is derived from the
accent and panel background. `--zui-shadow` supplies the shadow pigment.
Shared metrics are `--zui-menu-font-size` (13px),
`--zui-menu-title-font-size` (12px), `--zui-menu-padding` (4px 0),
`--zui-menu-item-padding` (5px 14px), and `--zui-menu-title-padding`
(4px 14px 5px). The searchable node add menu uses these same metrics.

The Theme Editor derives light extension chrome when the main focus color's
HSL lightness exceeds 60%. All built-in themes retain dark chrome. Text,
inputs, borders, danger text and value colors update together, including open
menus, custom canvases and mirrored popup documents. Content colors such as
asset labels, channel curves and rendered thumbnails retain their meaning.
Standalone help pages read the same saved theme and follow storage changes.
