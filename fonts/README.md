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
