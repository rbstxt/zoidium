# Missing Node Material image metadata, 2026-10-15

This note audits the save and restore paths against the supplied debug log,
`zoidium-debug-2026-10-15T01-17-31-509Z.json`. It does not contain project data
or CM3 runtime files. The reviewed checkout starts at `b2c41cc`.

## Established cause of the save failure

The log's final event, at `2026-10-15T01:17:27.717Z`, reports
`ProjectDataError` from `plugins/core/project-files.js?v=120:253`. Its path
ends in `material.properties.nodeImage`, with asset ID
`ab116c5d984be6edf981692f9271b981`. See the supplied log, lines 7223-7231.
The screenshot refers to another object path with the same ID. The first
exception stops the validator, so neither source enumerates every affected
material.

The error text and stack match `checkAssetReferences` before commit
`b456c56`. In that revision, lines
247-263 recursively inspect serialized JSON, recognize a 32 or 64 hexadecimal
character value under fields such as `nodeImage`, and throw when the value
is absent from `document.assets`. This proves that the serialized document
contained a reference without a corresponding asset table entry. It does
not prove that image bytes were corrupt, that disk space ran out, or that
the file picker failed. The old source is available with
`git show b456c56^:plugins/core/project-files.js`.

The current checkout already contains the fix in commit
`b456c562b6dacff76b14a4ea0f526e78378cb71f`, followed by version refresh
`b2c41cc`. The checked-in manifests identify Core version 41 and Material+
version 16. See [the Core manifest](../../plugins/core/manifest.json#L6)
and [the Material+ manifest](../../plugins/material-plus/manifest.json#L6).
Missing metadata references now produce a warning while remaining
in the document. Declared assets with missing, empty, wrong-size, or
wrong-hash bytes still fail validation. See
[project-files.js, lines 247-297](../../plugins/core/project-files.js#L247)
and [project-archive.js, lines 193-282](../../plugins/core/project-archive.js#L193).
The debug log describes the older page code. Its stack cannot establish
which code is deployed now or which code a still-open tab currently holds.

## Why restore points also fail

Normal save calls `createArchive`, which serializes the project, adds attached
asset files, computes integrity, validates the document, encodes the archive,
then decodes and validates it again before returning a Blob. A validation
failure happens before a writable file is opened. See
[project-files.js, lines 395-470](../../plugins/core/project-files.js#L395),
[the save caller at line 605](../../plugins/core/project-files.js#L605), and
[the writer at line 656](../../plugins/core/project-files.js#L656).

Manual and automatic restore points call the same `projectFiles.createArchive`
before storing their record. A missing-metadata failure prevents reaching
`saveSnapshot`. Download fallback is available only if an archive Blob already
exists. See [project-restore.js, lines 411-469](../../zoidium/project-restore.js#L411).
Changing download settings or retrying the same unchanged project cannot
remove this particular validation error.

The supplied debug log does not contain the serialized project or asset
payloads. The debug panel explicitly excludes project content. See
[debug-log.js, line 56](../../zoidium/debug-log.js#L56). Recovering the unsaved
state requires the still-open editor, or an independently saved project or
restore point. The log alone cannot rebuild it.

## Narrow recovery options

`nodeImage` is a hidden ASSET property named `Selected node image`. The Node
Editor mirrors the selected graph image into it. The fixed code clears that
mirror when selection is cleared or the editor closes. See
[node-material.js, line 65](../../plugins/material-plus/node-material.js#L65)
and [lines 435-462](../../plugins/material-plus/node-material.js#L435).
That establishes why this field can be unrelated to an image still used by
the material's graph. The log does not contain that graph, so it cannot prove
that clearing the field is sufficient for this particular live project.

A rescue tool should first serialize the live project into a separate
archive and retain all attached asset files. The normal saver provides the
reference packaging behavior in
[project-files.js, lines 408-445](../../plugins/core/project-files.js#L408).
Repair only the archive copy. Clear a missing-metadata `nodeImage` value only
after parsing its material's graph and checking that the graph does not use
that asset ID. A malformed or unsupported graph must remain an unresolved
case. Scan the complete serialized document, including media and nested
compositions, rather than editing only the first error path.

Keep the raw archive as a separate recovery artifact before repairing the
copy. Raw serialization without the normal validator is a data capture, not
proof that the file can reopen. After changing the copied JSON, recompute
integrity and use the old page's validator on the result. Then encode,
decode, and validate the finished Blob before offering the repaired download.
The normal `triggerDownload` validates again in `restore` mode. See
[project-files.js, lines 482-499](../../plugins/core/project-files.js#L482).
Never invent asset metadata to satisfy the validator or substitute an
unrelated image under the missing ID. Existing asset names are checked
against their bytes, including CM3's native hash format. See
[project-archive.js, lines 227-243](../../plugins/core/project-archive.js#L227).

Replacing the exported `projectFiles.validateProjectArchive` function does
not patch the old saver's lexical reference. Both `createArchiveUnlocked`
and `openValidatedArchive` call the private function inside their closure.
See [project-files.js, line 353](../../plugins/core/project-files.js#L353),
[line 446](../../plugins/core/project-files.js#L446), and
[the exports at line 973](../../plugins/core/project-files.js#L973).
A blanket validation bypass would also remove real corruption checks.

The [console recovery script](../../tools/recovery/node-image-rescue.js)
implements the copy-only approach. Its
[instructions](../../tools/recovery/README.md) explain the original and
compatible downloads, JSON-only fallback, and independent reopen check. It
does not alter the live project's properties, use the shared export worker,
or write a restore point. "Compatible" means accepted by that page's archive
validator. On corrected pages, unrelated dangling asset properties can remain
as warnings. It does not certify complete visual recovery.

## Other recorded error and remaining uncertainty

The current session recorded `Cannot read properties of undefined (reading
'filename')` at `00:45:55.447Z`, from CM3's property UI. See supplied log,
lines 5415-5427. It is consistent with a property UI attempting to display an
asset whose descriptor is missing. The stack does not identify its property
or ID, so the log alone cannot prove it is the same `nodeImage` reference.
Earlier Layer Input exceptions belong to a different, closed session.

The recovery copy cannot recover bytes which are absent from the live asset
table, caches, prior archives, and original source files. If an actual image
node still uses the missing ID, preserving the project structure and
relinking the original image is a separate step from clearing stale UI
selection metadata.

## Verification

`node --test test/save-safety.test.js` passed all 35 tests on this checkout.
The existing regression at
[save-safety.test.js, lines 282-290](../../test/save-safety.test.js#L282)
confirms that a stale serialized `nodeImage` selection can save and reopen
under the corrected code. These tests verify repository behavior, not the
unsupplied live project contents.

The recovery script was also run against the actual old
`plugins/core/project-files.js` obtained with
`git show b456c56^:plugins/core/project-files.js`, loaded into the test harness
in place of the current source. For a serialized Node Material with the
reported missing ID and an empty graph, that validator rejected the original
capture with `has no asset metadata`, accepted the compatible capture after
encoding and decoding, and the live test project's serialized JSON remained
unchanged. This uses the old production validator rather than only a test
implementation of its behavior. It remains a synthetic project test, not a
capture or reopen of the affected user's browser state.
