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
