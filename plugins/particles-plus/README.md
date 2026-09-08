# Particles+

Particles+ is an external extension layer for CM3 that adds 54 original,
monochrome sprite presets to the Texture picker of particle objects. It does
not replace or modify CM3's built-in particle textures.

## Sprite catalog

Geometric shapes and patterns:

`circle`, `square`, `triangle`, `pentagon`, `hexagon`, `octagon`, `diamond`,
`ring_outline`, `ring_double`, `triangle_outline`, `square_outline`,
`rounded_square`, `rounded_square_outline`, `hexagon_outline`, `plus`,
`plus_cut_square`, `cross`, `cross_outline`, `line_horizontal`,
`line_vertical`, `grid`, `dot_grid`, `radial_lines`, `spiral`, `snowflake`,
`lattice`, `concentric_rings`, `broken_ring`, `star_5`, `star_6`, `star_8`.

Glow and flare variants:

`flare_glow_ring`, `flare_halo`, `flare_double_halo`, `flare_blob`,
`flare_orb_soft`, `flare_burst`, `flare_burst_soft`, `flare_needles`,
`flare_starburst_fine`, `flare_starburst_dust`, `flare_eight_ray`,
`flare_streak_thin`, `flare_streak_wide`, `flare_streak_glow`,
`flare_vertical_streak`, `flare_crossbeam`, `flare_fourdot`,
`flare_fourdot_soft`, `flare_sixdot`, `flare_ring_streak`, `flare_ripple`,
`flare_spectral`, `flare_glint`.

## Image guarantees

Every sprite is a 128x128 8-bit RGBA PNG, matching the standard CM3 particle
texture size. It is generated from procedural geometry in
`tools/build-particles-plus-sprites.js` using supersampled coverage. Every
pixel has RGB `#FFFFFF`; shape edges, glow, and gradients are represented only
by the alpha channel. The generator also checks the transparent safety margin,
dimensions, file set, and manifest/catalog agreement.

The source images in the external reference preset directory were used only
for visual inspection. No reference pixels or reference files are embedded,
copied, or read at runtime.

## Project compatibility

The plugin uses CM3's normal image asset path. Selecting a Particles+ sprite
stores the bundled PNG as a data URL in the normal project asset list, so it
survives save/reload. The Zoidium project metadata records the selected sprite
IDs in the plugin descriptor's `sprites` field. Because this is Zoidium
extension data, projects using Particles+ are marked incompatible with vanilla
Panzoid Clipmaker 3, and the plugin manager blocks disabling Particles+ while a
project still uses one of its sprites.

## Regenerating and checking

```bash
pnpm run build:sprites
node tools/build-particles-plus-sprites.js --check --sheet /private/tmp/particles-plus-sheet.png
pnpm run build:plugin-bundles
pnpm run check:plugin-manifests
pnpm run check:plugin-bundles
```

When the catalog or plugin code changes, bump the manifest and registry
versioned URLs together, then rebuild the bundle.
