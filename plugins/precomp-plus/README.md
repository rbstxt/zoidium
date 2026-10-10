# Precomp+

A Zoidium `extension` plugin. It adds compositions: groups of timeline clips
that Main keeps as one clip, and that you can open and edit.

## Workflow

1. Select one or more **video or audio clips** on the timeline.
2. Click **Pre-compose** in the Comps tab or in the Compositions window, then
   name the composition (default `Comp 1`). The selected clips move into the
   composition: video selections leave one clip for the composition on Main,
   while audio moves with it and keeps playing on Main through the normal
   audio pipeline (see Audio below). An audio-only selection moves without
   leaving a clip behind.
3. Open **Compositions** (Comps tab) to see Main and every composition, with
   their length and how many clips use them. Double-click a composition, or
   press **Open**, to edit its clips. The window subtitle, the tab label and the
   location line show that you are editing it. **Back to Main** returns.
4. Rename, duplicate or delete compositions from the same window. A composition
   that a clip uses cannot be deleted; the message names the clips to remove.
5. **New composition** (Comps tab, or the Compositions window footer) creates
   an empty composition without switching to it, so the creation stays one
   undo step. Double-click it to edit its clips.

Right-click a timeline clip for Rename layer, Reveal source in Project,
Pre-compose selected (opens the Pre-compose dialog), Open source composition,
Duplicate, Split at playhead and Delete. Each editing item is one undo step.

Pre-compose is undoable as one step. Undo is cleared when you switch between
Main and a composition, because undo entries refer to the live clips.

## Audio

Audio clips move into compositions together with video, and nested audio
keeps playing on Main and in exports: composition audio is scheduled at its
Main-time window with time, volume and pan remapped, as a pure function of
the frame, so playback and export stay deterministic. Muted audio tracks stay
muted, including inside compositions.

## Rules

- A composition cannot contain itself, directly or through another composition.
- Disabling Precomp+ is refused while the project has compositions.
- Saving while a composition is open writes Main and the open composition
  correctly.
- Export is blocked with a message while a composition is open. Return to Main
  before exporting video or capturing a frame.
- The Media panel and Compositions window both refuse to delete compositions
  that are used by clips in Main or another composition.
- Pre-compose carries each moved track's eye (`enabled`) and Camera+ `3D`
  (`track3d`) switches into the composition, and opening a composition
  restores them live.

## Compatibility

- Projects saved by OpenZoid or Davidium (`isComp` / `compLength` /
  `compSource` media) load into the Zoidium composition model: each entry
  gets a stable id and keeps its source-name list for Open source
  composition lookup. Saves also write those fields back, so Davidium and
  OpenZoid keep reading compositions saved by Zoidium.

## Limitations

- Compositions are created from timeline clips; their clip links are not
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
