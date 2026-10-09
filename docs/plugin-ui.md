# Plugin UI: floating windows and controls

Every Zoidium editor that needs more than a property row (setup dialogs,
designers, composition lists, focus tools) opens as a **floating window** above
the CM3 editor. The editor stays usable behind it, so changes preview live in
the normal viewport. Fullscreen overlays, private themes, custom fonts and
borrowed preview viewports are not used for new or ported UI.

Windows and controls share CM3 panel chrome: Source Code Pro, `#2a2a2a`
panels, `#222` title rows, `#384668` focus/selection accent, `#7e8fb9` values,
scrubbable numbers and `proprow propbutton` buttons. Styles live in
`zoidium/ui-window.css`; plugins should not ship their own window themes.

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

Window object: `element`, `body`, `footer`, `setTitle()`, `setSubtitle()`,
`setFooter(buttons)`, `setCollapsed()`, `focus()`, `close()`, `isOpen()`,
`onClose(fn)`, `addCleanup(fn)`.

Behavior provided by the host: drag by title bar, resize from the right/bottom
edges and corner, double-click title to collapse, Escape closes, focus raises
the window, the window is kept reachable when the browser resizes, and key
events inside a window do not reach CM3 editor shortcuts.

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
