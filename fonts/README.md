# Bundled fonts

`source-code-pro-regular.woff2` is the unmodified regular WOFF2 font from
Adobe's Source Code Pro 2.042 release. It is used by the Zoidium UI and
extension layer so that they use the same `Source Code Pro` family as the CM3
editor.

- Source: <https://github.com/adobe-fonts/source-code-pro/tree/release/WOFF2/TTF>
- License: [SIL Open Font License 1.1](./LICENSE.md)
- SHA-256: `714eee29b70d191f5bf4b3a06b68f2c50522b1303d31c7d44dcefdcc5f9defd0`

This is a separately licensed Zoidium dependency, not a Panzoid/CM3 resource.
CM3-specific font assets, if any, are still fetched into the Git-ignored
runtime cache by `tools/runtime-resources.js`.

The settings panel also bundles the following OFL-licensed families:

- `geist-sans-variable.woff2` — Geist by the Geist Project Authors, SIL Open Font License 1.1.
- `geist-mono-variable.woff2` — Geist Mono by Vercel, SIL Open Font License 1.1.
- `ibm-plex-sans-regular.woff2` — IBM Plex Sans by IBM Corp., SIL Open Font License 1.1.
- `ibm-plex-mono-regular.woff2` — IBM Plex Mono by IBM Corp., SIL Open Font License 1.1.
- `jetbrains-mono-variable.woff2` — JetBrains Mono by the JetBrains Mono Project Authors, SIL Open Font License 1.1.
- `cascadia-mono-regular.woff2` — Cascadia Mono by Microsoft Corporation, SIL Open Font License 1.1.
- `fira-code-regular.woff2` — Fira Code by the Fira Code Project Authors, SIL Open Font License 1.1.
- `paper-mono-regular.woff2` — Paper Mono by the Paper-Mono.Git Project Authors, SIL Open Font License 1.1. The unmodified Regular WOFF2 from v1.000 is used for editor chrome and code surfaces. See [the original license notice](./LICENSE-Paper-Mono-OFL.txt).
- `inter-regular.woff2` — Inter by the Inter Project Authors, SIL Open Font License 1.1. The unmodified `web/Inter-Regular.woff2` from v4.1 is used for editor chrome; code surfaces keep Source Code Pro. See [the original license notice](./LICENSE-Inter-OFL.txt).
- `source-sans-3-regular.woff2` — Source Sans 3 by Adobe, SIL Open Font License 1.1. The unmodified Regular TrueType WOFF2 is used for editor chrome; code surfaces keep Source Code Pro. See [the original license notice](./LICENSE-Source-Sans-3-OFL.txt).
- `atkinson-hyperlegible-next-regular.woff2` — Atkinson Hyperlegible Next by the Atkinson Hyperlegible Next Project Authors, SIL Open Font License 1.1. The unmodified Regular WOFF2 is used for editor chrome; code surfaces keep Source Code Pro. See [the original license notice](./LICENSE-Atkinson-Hyperlegible-Next-OFL.txt).

The additional font sources and checksums are:

- Geist: <https://github.com/vercel/geist-font/blob/main/fonts/Geist/webfonts/Geist%5Bwght%5D.woff2> — `2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1`
- IBM Plex Mono: <https://github.com/IBM/plex/blob/master/packages/plex-mono/fonts/complete/woff2/IBMPlexMono-Regular.woff2> — `ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350`
- IBM Plex Sans: <https://github.com/IBM/plex/blob/master/packages/plex-sans/fonts/complete/woff2/IBMPlexSans-Regular.woff2> — `ba711a3085ff9f27440b6b9c4550cfc47c97bf36591d5da958b975bb3add8c1a`
- Cascadia Mono: <https://github.com/microsoft/cascadia-code/releases/tag/v2407.24> — `abbf67cceb200508c9590ac9b75b37dd2211f58ea56279f1fa6ec87265f9d713`
- Fira Code: <https://github.com/tonsky/FiraCode/releases/tag/6.2> — `a6ce59520b90e15d7062ffef214f94c8add5a4085c0bbb1683602ef227a4d1fe`
- Paper Mono: <https://github.com/paper-design/paper-mono/releases/tag/v1.000> — `ebfbaa0f177a172a207b38dc5708f6e0b648f75cd3fa523d5097380fa2a707f0`
- Inter: <https://github.com/rsms/inter/releases/tag/v4.1> — `e06f6b1bc553aaea4e4668023ed0ab0a147129c3107f511bc7d03d361b0ae085`
- Source Sans 3: <https://github.com/adobe-fonts/source-sans/blob/87b37a2daaed80fcb8e8ccb0085c4d72ddade12e/WOFF2/TTF/SourceSans3-Regular.ttf.woff2> — `53492fb3a0def77354f166a55d09b63a10855e91c206c7620a81cf56e97f8ec3`
- Atkinson Hyperlegible Next: <https://github.com/googlefonts/atkinson-hyperlegible-next/blob/7925f50f649b3813257faf2f4c0b381011f434f1/fonts/webfonts/AtkinsonHyperlegibleNext-Regular.woff2> — `378aea0f5c1d179f4e0b5382c06bfc87571b98cfcc4fd1352bc979e2e2259c54`

The complete OFL 1.1 text is included in [`LICENSE.md`](./LICENSE.md). The
settings panel also provides a generic system monospace fallback.

## Built-in font presets

The files in `presets/` are TTF fonts served at `assets/fonts/2d/<name>.ttf`
and offered in the CM3 font picker next to the host presets. The host renders
preset fonts with its bundled parser (TTF and OTF), so WOFF2 files cannot be
used here. The preset files are static instances: the variable fonts these
families ship overlap contours for interpolation, and the host parser fills
those overlaps wrongly (see `work/2026-10-31-font-ui/report-fonts.md` for the
"Geist Mono i" root cause). Shape+ text keeps the variable axes by loading
the matching file from `presets-variable/`, served at
`assets/fonts/2d-variable/<name>.ttf` (see the optional `"variable"` field in
`presets.json` and `plugins/shape-plus/preset-variables.js`). The picker
preview sprite (`font-previews.svg`) is generated from the static files; see
"Adding a preset" below. None of these families declares a Reserved Font
Name.

- `presets/geist.ttf` — Geist Regular (static), from [geist-font v1.9.0](https://github.com/vercel/geist-font/releases/tag/v1.9.0), file `Geist/ttf/Geist-Regular.ttf`. Size: 126048 bytes. License: [LICENSE-Geist-OFL.txt](./LICENSE-Geist-OFL.txt).
  SHA-256: `6bfbc2254860844f82844999b63c2977b08781daecdda9870ad0feef3bc1b3f5`
- `presets/geist mono.ttf` — Geist Mono Regular (static), from [geist-font v1.9.0](https://github.com/vercel/geist-font/releases/tag/v1.9.0), file `GeistMono/ttf/GeistMono-Regular.ttf`. Size: 148516 bytes. License: [LICENSE-Geist-OFL.txt](./LICENSE-Geist-OFL.txt).
  SHA-256: `bbc6e86aec043518fe50a981f452a027b195cf95a9b3bfe21b88560dc7240023`
- `presets/geist pixel circle.ttf`, `presets/geist pixel grid.ttf`, `presets/geist pixel line.ttf`, `presets/geist pixel square.ttf`, `presets/geist pixel triangle.ttf` — the five official Geist Pixel static shapes, from [geist-font v1.9.0](https://github.com/vercel/geist-font/releases/tag/v1.9.0), files `GeistPixel/ttf/GeistPixel-*.ttf`. Sizes: 320304, 196564, 95804, 94764, 194596 bytes. License: [LICENSE-Geist-OFL.txt](./LICENSE-Geist-OFL.txt).
  SHA-256: `9cd6bed2ba14b5a2ff6a04a2fdfafa3fbed201fc858910ef9e78a004206ad6a0` (circle), `49e93728ed05157fdeb5258fdee58aa955c44ebede8c59c96dda04e78ce0d90c` (grid), `c744abcc65c25d5c64f659ef8a82e53fe94050b8dc92bfe5e937ebd6a0d7948b` (line), `c1fbf7316997c1749857708998958e8ca0343416b3f8d2c7156d634a9520e997` (square), `981e4e468804f25c299beaa5d8f10054e9f1f74b73fdf7f820fcc7976e309a99` (triangle)
- `presets/geist serif.ttf` — Geist Serif Regular (static), from [geist-font v1.9.0](https://github.com/vercel/geist-font/releases/tag/v1.9.0), file `GeistSerif/ttf/GeistSerif-Regular.ttf`. Size: 132452 bytes. License: [LICENSE-Geist-OFL.txt](./LICENSE-Geist-OFL.txt).
  SHA-256: `6c33e2138c7544455f7807ee11356d636ab23944fe214d6cefd3fd5b1e45e171`
- `presets/geist serif square.ttf`, `presets/geist serif triangle.ttf`, `presets/geist serif heart.ttf` — the official Geist Serif static shapes, from [geist-font v1.9.0](https://github.com/vercel/geist-font/releases/tag/v1.9.0), files `GeistSerif/ttf/GeistSerif-Square.ttf`, `GeistSerif/ttf/GeistSerif-Triangle.ttf`, `GeistSerif/ttf/GeistSerif-Heart.ttf`. Sizes: 133092, 133072, 132892 bytes. License: [LICENSE-Geist-OFL.txt](./LICENSE-Geist-OFL.txt).
  SHA-256: `80b24a90ce54cc81230c0e77de358fc21f89e49ee87d6fc5889704d373d46702` (square), `ef04fbddb2869b1ef3e364cd5d19fa49e4ca03a837083e9ae743ede2586ba35e` (triangle), `1e3978f41d6b4bab87414b9c0b28e49a8e470225e745cb08a6a07dad95d95d1d` (heart)
- `presets/inter.ttf` — Inter Regular (static), from [Inter v4.1](https://github.com/rsms/inter/releases/tag/v4.1), file `extras/ttf/Inter-Regular.ttf`. Size: 411640 bytes. License: [LICENSE-Inter-OFL.txt](./LICENSE-Inter-OFL.txt) (byte-identical to the release `LICENSE.txt`).
  SHA-256: `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82`
- `presets/paper mono.ttf` — Paper Mono Regular (static), from [paper-mono v1.000](https://github.com/paper-design/paper-mono/releases/tag/v1.000), file `fonts/ttf/PaperMono-Regular.ttf`. Size: 106088 bytes. License: [LICENSE-Paper-Mono-OFL.txt](./LICENSE-Paper-Mono-OFL.txt) (byte-identical to the release `OFL.txt`).
  SHA-256: `d1ee286449d5276df35c34429891ef43ca5e54f4b526d5f985284457ef36fd64`

The files in `presets-variable/` are the original variable fonts for the
four static presets above, kept so Shape+ text can animate their axes. All
four are unmodified release files. No Reserved Font Name is declared.

- `presets-variable/geist.ttf` — Geist variable (weight 100–900), from [geist-font v1.9.0](https://github.com/vercel/geist-font/releases/tag/v1.9.0), file `Geist/variable/Geist[wght].ttf`. Size: 169056 bytes.
  SHA-256: `b85f4adce8f3fa245990c6b37237023ac9c5a6a034e35a427940372b1f4d210e`
- `presets-variable/geist mono.ttf` — Geist Mono variable (weight 100–900), from [geist-font v1.9.0](https://github.com/vercel/geist-font/releases/tag/v1.9.0), file `GeistMono/variable/GeistMono[wght].ttf`. Size: 171200 bytes.
  SHA-256: `c8c0fe44e62e5452878455fd9e9b06891291bf80854395c177fdd3b4326ab6af`
- `presets-variable/geist serif.ttf` — Geist Serif variable (ELSH shape axis 0–100, default Regular), from [geist-font v1.9.0](https://github.com/vercel/geist-font/releases/tag/v1.9.0), file `GeistSerif/variable/GeistSerif[ELSH].ttf`. Size: 155752 bytes.
  SHA-256: `be21be58d3eb75eed89ffab625f2cbe2a3920ccfdac14cd4efee1c828424bf76`
- `presets-variable/inter.ttf` — Inter variable (weight 100–900, optical size 14–32), from [Inter v4.1](https://github.com/rsms/inter/releases/tag/v4.1), file `InterVariable.ttf`. Size: 879708 bytes.
  SHA-256: `4989b125924991b90d05b2d16e0e388c48f7d5bb8b30539bbf9c755278d0ccaf`

No fontTools transformation was applied to any checked-in font: the static
presets and the variable files are all unmodified release artifacts
(verified with fontTools 4.64.0).

## Adding a preset

1. Drop the TTF into `presets/`, named `<preset name>.ttf`. The name must be
   lowercase, must be a valid file name, and must not collide with a host
   preset. Prefer an official static Regular TTF: the host parser fills
   overlapping variable outlines wrongly.
2. Add a `{ "name": ... }` entry to `presets.json` (alphabetical order). The
   optional `"label"` field changes only the sprite row text and defaults to
   the key. If the preset family ships a variable font you want Shape+ to
   animate, drop it into `presets-variable/` (same file name) and add the
   `"variable"` field naming that file; the preset file itself stays static.
3. Run `node tools/build-font-previews.js` to rebuild `font-previews.svg`.
4. Record the source URL, version, size, SHA-256, and license above.
5. `pnpm run verify` fails when the sprite or the runtime preset list
   (`plugins/core/font-presets.js`) is stale.
