# Clipper provenance

Generated dependency: clipper-lib npm 6.4.2, JavaScript port 6.4.2.2.
Upstream: https://github.com/junmer/clipper-lib
Algorithm: Angus Johnson's extension of Vatti polygon clipping, ported by Timo.
Copyright Angus Johnson 2010-2017; JSBN copyright Tom Wu 2005.
Boost Software License 1.0 and JSBN license are preserved beside the bundle asset.

The npm tarball is https://registry.npmjs.org/clipper-lib/-/clipper-lib-6.4.2.tgz.
Unmodified package/clipper.js SHA-256:
`a650c6946682edc1a64016f6553eeb5c32ce45eb7ca0ad5d8221961af011d97c`.
Generated with `terser@5.44.1 --compress --mangle`.
Generated clipper.js SHA-256:
See the checked-in generated file. The source has one reviewed typo fix in
ProcessEdgesAtTopOfScanbeam: `AddOutPt(ePrev2, e.Bot)` uses the in-scope `ePrev`.
The upstream `ePrev2` identifier is undefined. A license banner is prepended.

The adapter uses closed paths, strict simplicity and nonzero winding. It replaces
the error callback with an exception and replaces the square corner emitter on
each offset instance with exact bevel endpoints. The algorithm is otherwise unchanged.
No network access is used at runtime. Both licenses are declared bundle assets.

Earcut 2.2.4 is copied verbatim from the already licensed dependency in
`plugins/scene-plus/earcut.js`, including its Mapbox ISC notice. Its separate
license is a bundle asset. It triangulates only Clipper-resolved simple contours
with explicit hole ancestry. Existing shapes retain the original slab engine.
