# Davidium tooling and project-storage fixes

Implemented on 2026-10-01 in the modified local working trees. The donor is
`/Users/dia/Projects/GitHub/Davidium/zoidium`; the destination is this checkout.
Existing destination changes were retained. This note describes implementation,
not the earlier audit's unmodified behavior.

## Changes in both working trees

- `tools/runtime-resources.js` now uses one retry policy for source HTML and
  discovered resources. It retries temporary network failures and HTTP 408,
  429, 500, 502, 503, and 504, at most twice. Backoff is 300 ms and 600 ms.
  `Retry-After` seconds and HTTP dates can increase that delay. All attempts,
  response-body reads, and waits share the configured timeout, 30 seconds by
  default. Caller cancellation and fetch AbortError do not retry. Permanent HTTP
  failures, origin violations, and source-directory violations do not retry.
  Fetching and writing remain in the existing resource-cache pipeline.
- `tools/serve-with-resources.js` binds the first loopback socket, reads its
  actual assigned port, and binds the second socket to that same port. Port zero
  therefore reports a usable common port. A collision on the second socket
  closes the first socket and retries the complete pair. Unsupported IPv6
  loopback leaves IPv4 working; other errors still fail. A browser-launch error
  is reported without terminating the local server.
- `zoidium/runtime-loader.js` fetches each stylesheet or isolated script group
  concurrently and appends tags in declaration order. Classic scripts retain
  `async=false`. Every load promise gets a rejection handler immediately, so a
  later fast failure cannot become an unhandled rejection while an earlier
  request is pending. Styles settle before pre-init scripts; all pre-init
  scripts settle before initialization. The UI kit remains a fatal barrier
  before the scripts that depend on it. Destination bootstrap diagnostics,
  failure metadata, and debug-log download controls also remain in the donor.
- `zoidium/settings.js` uses a 30-second elapsed deadline rather than a guessed
  sum of retry delays. Polling stops when the panel exists, the active editor
  changes or is marked destroyed, or the page closes. Failure emits one English
  diagnostic event at the deadline.
- `zoidium/direct-download.js` suppresses overlapping button downloads and
  restores the previous disabled state after success or failure. An already
  disabled button remains disabled. Download hooks can return promises. Anchor
  object URLs remain alive for 60 seconds, and cleanup also runs when clicking
  the anchor throws. Existing eager detachment of live worker files and the
  local download-page interception remain intact.
- `plugins/core/project-files.js` hashes each archive entry separately and hashes
  a JSON manifest of its name, length, and digest. It no longer retains every
  media byte array and then allocates another complete archive-sized buffer.
  Fingerprints carry the `entries-v2:` prefix. Existing backups remain readable;
  comparison with an older fingerprint can create one extra automatic backup.
  TAR preparation reuses stable Blobs, wraps byte entries for WORKERFS, and
  detaches live File-backed entries. Hashing a single large asset still reads
  that asset into memory; this is not a streaming SHA-256 implementation.

## Plugin lifecycle review

The main task added asynchronous module cleanup and numeric-class usage guards.
Review found that two disable requests during slow activation could both await
the same activation and then start separate unregister passes. The manager now
reserves `disablePromise` before waiting for activation. Concurrent disables
join one cleanup; a later enable waits for that cleanup and activates again.
This correction is present in both working trees.

Lifecycle tests exercise the real enable/disable functions with controlled
activation and cleanup delays. Donor tests also exercise actual disable behavior
when numeric classes occur in serialized project data, nested composition
media, or the main-composition backup, while an unrelated pack can deactivate.
C4D light usage is covered despite its vanilla object type.

## Additional donor fixes

The donor keeps its version 2 shared-asset restore format. Snapshot creation now
writes the snapshot and its assets in one read/write IndexedDB transaction over
both stores. It checks every referenced asset inside that transaction, reuses
already stored media, and rolls back the whole operation on missing assets,
quota errors, request errors, or synchronous exceptions. Request errors retain
the underlying cause and reject after transaction abort.

Orphan collection reads snapshot references and deletes unreferenced assets
inside a single transaction over both stores. IndexedDB serializes this with
writers in other tabs. Delete-all clears both stores atomically. Database
connections close on version changes so a newer schema can upgrade. Asset-read
abort events reject rather than leaving a pending operation.

Destination project-name display handling, legacy encoded-name decoding,
save-picker user-activation fallback, dirty tracking, file-input cleanup, file
error metadata, and toolbar name rendering were selectively backported. The
new shared-asset functions were retained. The donor's blanket WASM and generic
binary compression exclusion was removed; those responses use the existing
MIME-aware middleware policy.

The donor adds `fake-indexeddb` as a development dependency, with its pnpm
lockfile updated. Existing npm lockfile content and destination dependencies
were not replaced. The donor's existing modules directory rejected pnpm's
virtual-store configuration, so dependency resolution used `--lockfile-only`
and tests used an ignored link to an external temporary pnpm installation. A
fresh full dependency install is not claimed.

## Verification

Meaningful regression tests cover paired ephemeral ports, second-bind retries,
IPv6 unavailability, transient/permanent fetch errors, timeout during
`Retry-After`, cancellation, a fast later bootstrap failure, the Settings
elapsed deadline and cancellation, overlapping download clicks, rejected
exports, object-URL lifetime, Blob reuse, and archive fingerprint order and
content changes.

Donor storage tests execute the actual storage functions against
`fake-indexeddb`. They cover version 1 archive preservation during upgrade,
missing-asset rollback, synchronous quota failure, asynchronous IDB request
failure, automatic/manual writers in separate connections overlapping orphan
collection, shared-media retention after deletion, concurrent delete-all and
write, and avoidance of repeated media writes. Project-file tests cover shared
asset reconstruction into the archive used by download.

Targeted suites passed with 45 destination tests and 54 donor tests. Full
repository verification, generated plugin bundle freshness, and staged Web
builds are handled in the main task after all agents finish. The subsequent
lifecycle review passed five manager lifecycle tests in each working tree and
22 donor dependency/usage tests.

## Remaining integration decisions

The destination retains its version 1 backup format. The donor's transaction
and migration tests establish a safer implementation, but replacing the
production backup format still needs a deliberate integration of its UI and
backup lifecycle. These tests do not claim real-browser IndexedDB quota
behavior, real TAR-worker reconstruction, or platform-specific large-media
performance. No older donor desktop diagnostics, dependency versions, storage
origin policy, or Scene+ implementation replaced the destination versions.

Desktop byte-range serving and shutdown are a separate work item. Automatic
port fallback for desktop remains a product decision because changing ports
changes the storage origin. No CM3 runtime source files were added to tracked
source directories, and no project data is sent by these changes.
