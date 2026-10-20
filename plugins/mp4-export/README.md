# MP4 export

Adds H.264 MP4 to the native Device render format selector. The implementation
uses the existing deterministic frame renderer, project frame-rate conversion,
aspect settings and native offline audio mixer. MKV and WebM keep their existing
export path.

The MP4 writer uses WebCodecs and the pinned Mediabunny release in `vendor/`.
Codec support is checked when rendering starts. Export options belong to the
current export page and add no saved project fields.
