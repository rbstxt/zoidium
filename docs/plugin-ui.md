# Plugin UI: floating windows and controls

Every Zoidium editor that needs more than a property row (setup dialogs,
designers, attribute panels, node editors, composition lists, focus tools)
opens as a **floating window** above the CM3 editor. The editor stays usable
behind it, so changes preview live in the normal viewport. Fullscreen
overlays that hide the editor, bundled UI fonts and borrowed preview viewports
are not used; a window can be maximized by the user when more room helps.

Windows and controls share CM3 panel chrome: the editor UI font, `#2a2a2a`
panels, `#222` title rows, the theme accent for focus/selection, the theme
value color, scrubbable numbers and `proprow propbutton` buttons. Styles live
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
  label: "Designer",                   // optional custom button text
  icon: "settings",                    // gear icon in the object's list row
  match: (target) => target instanceof ParticularClass,
  open: (target) => openDesigner(target),
});
```

CM3 lists then show a gear on matching rows and an "Open ..." button above
their properties (the convention the VHS Setup button established). The
registration is removed when the plugin is disabled.

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
