# CM3: temporarily showing only the preview (player) area

Runtime inspected: the Git-ignored CM3 cache (`.zoidium-resources/`), specifically

- `ui-1.0.72.js` — window/panel framework, including `PZ.ui.window`
- `clipmaker-3.0.106.js` — the Clipmaker panel tree (the preview is one panel in it)
- `pz.all-35.css` and the fetched `clipmaker.html` page shell

Live page checked: `https://panzoid.com/legacy/gen3/clipmaker.html` (fetched
2026-09-16; the page hash matches the cached source page, so the runtime above is
the one the live editor loads).

## Answer

CM3 has no fullscreen button, menu entry, or Fullscreen API call. The string
`fullscreen` does not appear anywhere in `core-1.0.102.js`, `ui-1.0.72.js`, or
`clipmaker-3.0.106.js`. What exists is an undocumented keyboard toggle inside
`PZ.ui.window` that makes the **focused panel** fill the window and restores the
previous layout when pressed again. Pointed at the viewport panel, that is
"show only the player".

## How to use it

1. Click once inside the area you want to keep — for the player, click the 3D
   preview. Panels are `div.editorpanel[tabindex="0"]`, and clicking a
   non-focusable child such as the preview canvas focuses the panel element.
2. Press the Backquote key (` / ~, the key left of "1"; on JIS keyboards that
   physical key is normally the 半角/全角 key). The focused panel is re-parented to the
   window root at `top:0;left:0;width:100%;height:100%` and every other panel
   disappears. The preview canvas then covers the whole editor window.
3. Press the same key again to go back to the previous layout.

The toggle applies to whatever panel has focus, so the same key also maximizes
Media, Edit, or an object panel.

Related behavior in the same handler: Ctrl+Shift+Backquote constructs a second
instance of the focused panel in a separate browser window
(`new PZ.ui.window(editor).setPanel(new PanelConstructor(editor))`, default
600x400). That window is ordinary browser chrome, so it can be fullscreened with
F11.

## Source

`ui-1.0.72.js`, inside `PZ.ui.window` (`this.el` is `#panecontainer`,
class `editorwindow`, in the main window, and the popup body in a secondary
window):

```js
this.el.addEventListener("keydown", function (e) {
  if (!e.altKey && "Backquote" === e.code) {
    let t = this.window.document.activeElement;
    if (!t || !t.pz_panel) return;
    let i = t.pz_panel;
    if (e.ctrlKey && e.shiftKey) {
      let e = new i.constructor(this.editor);
      new PZ.ui.window(this.editor).setPanel(e);
    } else
      this.oldPanel
        ? (this.panel = null, i.oldParent.appendChild(i.el), delete i.oldParent,
           this.setPanel(this.oldPanel), delete this.oldPanel)
        : (i.oldParent = i.el.parentElement, this.oldPanel = this.panel, this.setPanel(i));
    i.el.focus();
    e.preventDefault();
  }
}.bind(this));
```

`PZ.ui.panel` gives every panel element `tabindex="0"` and the back-reference
`el.pz_panel`; `PZ.ui.window.prototype.setPanel` removes the current root panel
element and appends the given panel at 100% width and height, then calls
`panel.resize()`. The two branches are therefore a layout swap, not a browser
fullscreen request: the preview canvas is only as large as its panel, and
`PZ.ui.viewport.prototype.resize` resizes the renderer to that panel.

## Verification (live runtime)

Loaded the live Gen3 Clipmaker page and measured the preview panel (the
`.editorpanel` holding the viewport canvas):

| Step | Preview rect | Visible panels |
| --- | --- | --- |
| default layout | 386,93 895x426 | 6 |
| click preview, press Backquote | 0,0 1280x800 | 1 |
| press Backquote again | 386,93 895x426 | 6 |

The click was a real pointer event and the key was a real key press, so the focus
path (canvas click -> panel `tabindex="0"` element) is confirmed, not assumed.
The Ctrl+Shift+Backquote popup branch is read from the source above; it was not
exercised in this check.

## Notes for the extension layer

- Zoidium stages `ui-1.0.72.js` unchanged, so the toggle is already available in
  the extension layer without reimplementing it; the core extension below only
  remaps the keys the native handler cannot see.
- To trigger it from Zoidium code (for example from the preview context menu in
  `plugins/core/preview-context-menu.js`), locate the viewport panel element
  (`el.pz_panel instanceof PZ.ui.viewport`), run `panelEl.focus()`, and dispatch a
  bubbling `KeyboardEvent("keydown", { code: "Backquote", key: "`", bubbles: true })`
  on it. A synthesized event and a real key press produced the same
  maximize/restore pair in the live runtime.
- The toggle state (`panel`, `oldPanel`, and the panel's saved `oldParent`) lives
  on the `PZ.ui.window` instance, so it is per window and does not survive a
  reload. A plugin that wants to know whether the preview is currently soloed has
  to track that itself or compare the panel element against its parent.

## Mac keyboards and the Zoidium remap

The handler above only matches `event.code === "Backquote"`, a key position of a
US layout, which a Mac keyboard does not always deliver. On JIS layouts the
half-width/full-width key is consumed by the system input source before the page
sees a keydown, and the key that types "`" is the one labelled "@", so the
combination that types the native character arrives with a code CM3 ignores.

`plugins/core/panel-fullscreen-shortcut.js` (Zoidium core, pre-init) listens for
keydown in the capture phase and, when the focused element carries `pz_panel`,
replays the toggle as a bubbling
`KeyboardEvent("keydown", { code: "Backquote", key: "`" })` on that panel
element. It matches the character the combination types, taken from the layout
the browser is typing with, so it carries no per-layout key list:

| Pressed | Layout | Event fields it matches |
| --- | --- | --- |
| Shift plus the "@" key, which types "`" | JIS | key "`", any code except Backquote |
| the combination that types "`" elsewhere | any | key "`", any code except Backquote |
| the same combination with `key` replaced by an input source | JIS | code "BracketLeft" with a shift, and no character in `key` (Process, Unidentified, Dead, or empty) |
| "`" or "~" on the native backquote position | ANSI | left to CM3, the code is Backquote |
| "@" on its own, or any other character | any | left alone, the combination types something else |

Alt, Ctrl, and Meta combinations are left to the browser, and the remap is inert
when the focused element has no `pz_panel`, so a text field inside a panel keeps
typing "@" normally. The Backquote code is ignored so CM3 keeps handling it.

Verified on the staged local build (`pnpm run web`, Clipmaker 3 layout), with the
preview panel focused and at 386,0 895x519 in the default layout:

| Step | Preview rect | Visible panels |
| --- | --- | --- |
| real Shift+2 press, which types "@" here | 386,0 895x519 | 6, nothing happens |
| real Shift+2 press inside the `.pz-filterbox` text field | unchanged, the field received "@" | 6 |
| event with `key: "`"`, `code: "BracketLeft"`, shift held | 0,0 1280x800 | 1 |
| the same event again | 386,0 895x519 | 6 |
| event with `key: "Process"`, `code: "BracketLeft"`, shift held | 0,0 1280x800 | 1 |
| the same event again | 386,0 895x519 | 6 |
| real Backquote press, the native path | 0,0 1280x800 | 1 |
| real Backquote press again | 386,0 895x519 | 6 |
| event with `key: "{"`, `code: "BracketLeft"`, shift held (US Shift+[) | 386,0 895x519 | 6, nothing happens |
| event with `key: "`"`, `code: "BracketLeft"`, shift and Ctrl held | 386,0 895x519 | 6, left to the browser |
