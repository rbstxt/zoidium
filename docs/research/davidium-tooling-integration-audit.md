# Davidium tooling and project-storage integration audit

> This report records the initial audit. Follow-up fixes are documented in
> [the implementation report](davidium-integration-fixes.md). Source links now
> point to the repaired working trees; initial failure descriptions are historical.

Research date: 2026-10-01. This is an investigation, not a merge.

## Source identity and comparison method

The donor is the **modified working tree** at
`/Users/dia/Projects/GitHub/Davidium/zoidium`, not its Git remote. Its HEAD is
`0faf124f681dd8ea378ddc5ec49b132c875ef062`. The destination is the modified
working tree at `/Users/dia/Projects/GitHub/Zoidium`, HEAD
`1d643a2c0f07da342df0fc2320c94bdb491cdfe0`. Neither HEAD describes all the
code under investigation. Both have substantial local edits, and the donor
still has the original `rbstxt/zoidium` remote.

Compare file content after CRLF-to-LF normalization. For bundles, parse JSON
and recursively normalize embedded text before comparing. This eliminates
false feature differences caused by Windows line endings.

The [file inventory](davidium-file-inventory.tsv) records 116 new/different
files after file-level line-ending normalization, including generated bundles
and tests. Some bundle differences disappear when embedded JSON text is also
normalized, as described below. All fourteen
existing plugin directories are present in the donor. Twelve of their
normalized bundles are equal. Only `core` and `scene-plus` differ. Existing
editable plugin sources are identical apart from `core/project-files.js` and
`scene-plus/scene-plus.js`; the new `core/main-viewport.js` is a separate
addition. Thus do not copy every apparently changed bundle.

Six new donor plugins are Camera+, Effector+, OpenZoid Legacy, Optical Flares,
Precomp+, and Trapcode Suite. Their render/UI details are covered separately.

## Changes that can be selected immediately

These are small independent changes, not approval to replace entire files.

| Change | Evidence in donor | Recommendation |
| --- | --- | --- |
| Register every object-picker definition | `plugins/plugin-manager.js:1484-1491`, destination `:1441` | Select the per-definition idempotency condition. The destination skips all later definitions from one plugin; the donor checks plugin ID plus entry name/type. Keep this independent from the donor's numeric-class compatibility rewrite. |
| Catch browser-launch errors | `tools/serve-with-resources.js:107-115` | Select this hunk. An unavailable `xdg-open` or OS launcher should not terminate an otherwise usable local server. Preserve existing server behavior. |
| Permit IPv4 when IPv6 loopback is unavailable | `tools/serve-with-resources.js:151-157` | Select the narrow `EADDRNOTAVAIL`/`EAFNOSUPPORT` handling. Continue failing on other errors. |
| Reuse Blob entries for the TAR worker | `plugins/core/project-files.js:234-251` | Select after the existing WORKERFS Blob regression passes. It avoids an unnecessary full media copy and is independent of the new storage format. |
| Hash archive entries individually | `plugins/core/project-files.js:196-220` | Select the allocation improvement separately. Existing persisted fingerprints will differ, so accept one extra backup or version the fingerprint algorithm. The change does not by itself stream hashing of a single huge asset. |
| Guard download double-clicks | `zoidium/direct-download.js:175-197` | Select with state restoration in both success and rejection paths. Verify that it preserves a pre-existing disabled state rather than always enabling the button. |
| Keep download object URLs alive longer | `zoidium/direct-download.js:152-155` | The isolated 60-second delay is a reasonable download reliability change. Account for longer retained Blob memory for repeated large exports. |

The donor's comment about eagerly detaching worker files is **not new
behavior**. The destination already invokes `detach(blob)` eagerly at
`zoidium/direct-download.js:87-96`.

## Changes to improve before integration

### Fetch retries

`tools/runtime-resources.js:613-626,723-728` adds up to two retries around
resource fetches. It retains the existing origin/path constraints and resource
fetch entry point, so it is architecturally compatible. However, it retries
every exception, including permanent HTTP failures and policy rejections, and
does not retry the initial source HTML fetches. The comment says exponential
backoff, but the formula is linear `300 * (attempt + 1) + jitter`.

Select transient network errors and appropriate HTTP statuses, preserve
abort behavior, respect retry timing where supplied, and document the total
timeout budget. Apply the same deliberate policy to source-page fetching.
Resource fetching is unrelated to rendering determinism; jitter here does
not violate the user's rendering requirement.

### Random port and desktop port fallback

The donor correctly returns an actual port for `--port=0`, but independently
binds IPv4 and IPv6 to zero at `tools/serve-with-resources.js:149,164-175`.
An actual run of its exported `listenOnAvailablePort` returned:

```json
{"reported":59786,"ipv4":59786,"ipv6":59787}
```

Bind the first socket, then bind the second address to that socket's assigned
port. Retry the pair together if the second bind collides. Test both host
addresses; reporting the first port alone does not fix the mismatch.

Desktop fallback at `desktop/main.cjs:63-75,222-243` has another consequence.
The app stores settings and IndexedDB restore points under an origin that
includes its port. Falling from 17823 to 17824 changes the storage origin and
can make backups appear missing. Choose a product policy for a stable origin
or explicit storage migration before integrating automatic fallback.

### Desktop HTTP serving and shutdown

The donor adds byte-range responses at `desktop/main.cjs:139-193`, socket
tracking at `219-222`, and bounded shutdown at `312-338`. These are useful
independent candidates. A probe evaluated the actual donor `serveRequest`
with Electron startup omitted and served its `fonts/README.md` over HTTP:

| Request | Result |
| --- | --- |
| ordinary GET | 200, 2503 bytes |
| `Range: bytes=0-99` | 206, 100 bytes |
| `Range: bytes=-100` | 206, 100 bytes |
| `Range: bytes=-0` | 416 |

No stream error occurred in this probe. It does not establish large-video
seek, interrupted-client, `If-Range`, or lifecycle behavior. Complete those
checks when implementing the selective port. Preserve destination main logs,
crash reporter, Debug menu, font backend workaround, and error diagnostics.
The donor whole-file replacement removes all of them.

### Compression filtering

`tools/serve-with-resources.js:207-216` excludes audio/video, non-SVG images,
WASM, and octet-stream. Avoiding compressed media is reasonable, but WASM is
often compressible. Choose the exclusions using measured response size and
latency. Do not assume that all binary content is already compressed.

### Bootstrap parallel fetching

`zoidium/runtime-loader.js:64-96` sets `async=false` on dynamically appended
scripts to preserve classic-script execution order. That mechanism is defined
by the [HTML standard](https://html.spec.whatwg.org/multipage/scripting.html#attr-script-async).
The delayed attachment of promise rejection handlers is faulty.

A VM probe ran the actual donor loader with `slow.js` loading after 50 ms and
`missing.js` failing immediately. It recorded both an unhandled rejection
`Could not load pre-init: ./missing.js` and eventual `zoidium:ready` with the
ordinary degraded-load event. Handle each promise's rejection at creation,
then await result records in order. Test a missing later script while an
earlier script is still loading.

The donor also removes destination bootstrap log-download controls and
error metadata. Preserve those. CSS rules also have an order even when their
network fetches run in parallel; maintain insertion order and wait before
initialization.

### Settings installation retries

`zoidium/settings.js:622-636` adds a finite retry limit and a diagnostic event.
The comment promises approximately 30 seconds, but summing its 100 capped
delays yields **162128.438 ms**, over 162 seconds. Use an explicit elapsed-time
deadline and cancellation when the relevant editor is destroyed. The idea is
compatible; the present timing/comment is not ready to copy.

### Shared restore-point asset storage

The donor's `plugins/core/project-files.js:317-435` separates the project TAR
from media and supplies asset references. `zoidium/project-restore.js:10-12,
187-352,930-1016` upgrades IndexedDB to version 2, stores shared assets, and
adds idle/heap-pressure guards. This addresses real copying and retention
costs, so prefer improving and integrating it over discarding the design.

Integration must preserve the destination's project display-name handling,
save-picker user-activation fallback, file-input cleanup, and diagnostics.
These are removed by the donor whole-file versions. The donor test at
`test/project-files.test.js:282-319` covers the returned structure, not a real
IndexedDB upgrade or garbage-collection transaction.

Asset writes, snapshot writes, and orphan cleanup currently use separate
transactions. `saveAssets()` followed by `saveSnapshot()` leaves a window
where cleanup in another tab can delete assets not yet referenced by a
snapshot. `deleteOrphanAssets()` also reads snapshots before opening its asset
deletion transaction. A failure after asset persistence can leak assets.
Persist the record and referenced assets atomically across both stores, and
serialize pruning/GC with concurrent writers. Upgrade testing must retain
version-1 archive records and exercise missing assets, quota failures,
concurrent tabs, manual/automatic backup overlap, and download reconstruction.

The revision shortcut at `project-restore.js:661-669` assumes every meaningful
project mutation updates `project.ui.onChanged`. New graph/editor features
must honor that assumption. The heap limit is best-effort and absent on some
browsers; it is not a portable memory guarantee.

## Changes not to carry across

Do not downgrade the destination Node engine, Electron, or Electron Builder
to the donor's versions (`package.json:10,71-72`), replace the pnpm lockfile
with `package-lock.json`, remove `electron-winstaller` build permission, or
remove the desktop development signal forwarding in
`tools/start-electron.js`. These are unrelated to the added plugin behavior
and would undo destination work.

Likewise, keep destination `runtime-config.js` cache version 69 and assign a
new version after actual implementation. Donor version 67 is older. Preserve
the destination's expanded Scene+ Effector and namespaced object identities;
the smaller donor Scene+ is not an upgrade.

New registry entries, acknowledgements, dependency metadata, and source/bundle
rebuilds belong to each selected feature. Do not advertise every donor feature
before the corresponding implementation is accepted.

## Verification performed

- Destination `pnpm run verify`: 276 tests passed; manifests, bundle freshness,
  and JavaScript syntax passed.
- Donor `node tools/verify.js`: 20 manifests and bundles passed; 111 JavaScript
  files passed syntax; 288 of 293 tests passed. All five failures are Camera+
  tests whose runtime mock lacks `PZ.layer.prototype.load`. This proves the
  donor verification is red; it does not prove that method is absent in CM3.
- Destination `pnpm run build:web`: passed, staging 177 cached CM3 resources.
  Inspected matching local fonts, fourteen plugin bundles, bootstrap core
  scripts, and generated runtime directories. Only core retains a source
  manifest in this stage because it is also loaded by bootstrap.
- Removed the generated `dist/web` inspection stage. Left
  `.zoidium-resources/` intact. No CM3 `assets/`, `effect/`, `material/`, or
  `worker/` directory was added at repository root.
- T3 preview status and open both explicitly reported no attached browser
  automation host. No browser visual-quality or GPU pixel comparison is
  claimed by this report.

All existing dirty runtime files were preserved. The investigation writes
only research documents and the path/size inventory.
