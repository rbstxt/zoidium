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

The additional font sources and checksums are:

- Geist: <https://github.com/vercel/geist-font/blob/main/fonts/Geist/webfonts/Geist%5Bwght%5D.woff2> — `2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1`
- IBM Plex Mono: <https://github.com/IBM/plex/blob/master/packages/plex-mono/fonts/complete/woff2/IBMPlexMono-Regular.woff2> — `ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350`
- IBM Plex Sans: <https://github.com/IBM/plex/blob/master/packages/plex-sans/fonts/complete/woff2/IBMPlexSans-Regular.woff2> — `ba711a3085ff9f27440b6b9c4550cfc47c97bf36591d5da958b975bb3add8c1a`
- Cascadia Mono: <https://github.com/microsoft/cascadia-code/releases/tag/v2407.24> — `abbf67cceb200508c9590ac9b75b37dd2211f58ea56279f1fa6ec87265f9d713`
- Fira Code: <https://github.com/tonsky/FiraCode/releases/tag/6.2> — `a6ce59520b90e15d7062ffef214f94c8add5a4085c0bbb1683602ef227a4d1fe`

The complete OFL 1.1 text is included in [`LICENSE.md`](./LICENSE.md). The
settings panel also provides a generic system monospace fallback.
