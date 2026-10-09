# Precomp+

A Zoidium `extension` plugin. It ports the OpenZoid composition engine
with original behavior preserved, plus one navigation fix.

- Pre-compose selected — moves timeline clips into a new comp tab,
  keeping multi-track layering, keyframe offsets, and track switches.
- Composition tabs — Main plus one tab per comp with New comp,
  Pre-compose, open, and delete, plus save/backup hooks so edits and
  undo survive tab switches.
- Open source composition — jumps from a clip into the comp it came from.
- Back to Main composition — returns from inside a nested comp.
- Drill-in fix — the project-changed watcher only resets comp state when
  the project object is replaced (new/open). Comp switches mutate the
  same sequence in place, so entering an asset no longer pops back out
  to the main layers.

The `precomp-runtime` module evaluates the bundled engine through the
plugin bundle asset API, hooks save/backup, appends the timeline
clip-menu items, and docks a Comps tab when the host UI allows it.
Disabling the pack unwraps the menu; the engine namespace stays
available and inert without use.

```bash
# after adding the registry entry
pnpm run build:plugin-bundles
pnpm run verify
```
