# Round 5 implementation record

The final round keeps editing in CM3's native Objects panel and main preview.
Saved schemaVersion 1 and renderVersion 1 remain unchanged. Existing geometry
keeps the original evaluator unless a new item explicitly requests new behavior.

Implementation sequence:

1. Native property visibility and pre-effect preview editing.
2. Pure deformation, deterministic noise, bounded integer clipping and offsets.
3. Defensive SVG parsing, native conversion and scoped clipboard actions.
4. Numerical oracles, browser regression and performance measurements.
5. Bundle version 8 and default-on release only after verification succeeds.

Implemented and verified through the native Objects panel and main preview.
Bundle version 8 is default-on. The autosave race was reproduced and fixed.

Detailed QA artifacts are kept outside the repository under shape-plus/r5.

## Final verification

- `pnpm run verify`: 2284 passed, zero failures or skips.
- `pnpm run build:web`: passed; inspected bundle-only version 8, all 43 text
  assets/licenses and 19 identical local font files, then removed dist/web.
- Headless browser suites ran sequentially on port 8138 with finally cleanup.
  Native Objects editing, real clipboard/file actions, conversion history,
  mixed JSON/.pz reload, pre-effect handles and backup cancellation passed.
- Shared render/export/native captures match rounds 1-4 byte-for-byte. Native
  layer types 6/7/8 retain identical serialization and zero changed pixel bytes.
- Full/1/8 performance fixtures retain six programs; static geometry rebuilds
  zero times after warmup. Animated/wiggle fixtures rebuild once per frame.
  Wiggle median was 1.2/1.0 ms; 128-copy repeater median was 0.2/0.2 ms.
- Detailed results, scripts, timings and inspected screenshots are in the
  external `shape-plus/r5/results.md` artifact directory.

The README records the supported SVG subset, quantization/work budgets,
conversion refusals and direct-planar preview editing limits.
