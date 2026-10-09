# Precomp+

A Zoidium `extension` plugin. It adds compositions: groups of timeline clips
that Main keeps as one clip, and that you can open and edit.

## Workflow

1. Select one or more **video** clips on the timeline.
2. Click **Pre-compose** in the Comps tab or in the Compositions window, then
   name the composition (default `Comp 1`). The selected clips move into the
   composition, and Main gets one clip that plays it. Audio clips stay on Main.
3. Open **Compositions** (Comps tab) to see Main and every composition, with
   their length and how many clips use them. Double-click a composition, or
   press **Open**, to edit its clips. The window subtitle, the tab label and the
   location line show that you are editing it. **Back to Main** returns.
4. Rename, duplicate or delete compositions from the same window. A composition
   that a clip uses cannot be deleted; the message names the clips to remove.

Pre-compose is undoable as one step. Undo is cleared when you switch between
Main and a composition, because undo entries refer to the live clips.

## Rules

- A composition cannot contain itself, directly or through another composition.
- Disabling Precomp+ is refused while the project has compositions.
- Saving while a composition is open writes Main and the open composition
  correctly.
- Export is blocked with a message while a composition is open. Return to Main
  before exporting video or capturing a frame.
- The Media panel and Compositions window both refuse to delete compositions
  that are used by clips in Main or another composition.

## Limitations

- Audio inside a composition is stored but not played yet. Pre-compose leaves
  selected audio clips on Main, where playback and export continue normally.
- Compositions are created from video clips only; their clip links are not
  carried over.
- Enable Precomp+ before opening projects containing compositions. The host
  prompts to enable the plugin using the saved project requirement, but does
  not yet preserve unknown composition fields if it starts loading while the
  plugin is disabled. Enable it first to avoid losing composition links.

## Files

- `comps.js` — the engine (`PZ.precomp`): model, pre-compose, undo steps,
  nested rendering and scheduling, serialization hooks.
- `precomp-runtime.js` — the Comps tab, the Compositions window and the
  Pre-compose dialog.

Build and verify:

```bash
pnpm run build:plugin-bundles
pnpm run verify
```
