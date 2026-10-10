# Getting the CM3 runtime resources

Zoidium is an external extension layer around Clipmaker Gen3 (CM3). The
repository contains only Zoidium's own code. The CM3 runtime (its HTML pages,
JavaScript bundles, workers, shaders, textures and so on) lives in the
Git-ignored cache at `.zoidium-resources/` on your machine. Never commit those
files, attach them to issues or pull requests, or upload them anywhere public.

There are three ways to fill the cache. Try them in this order.

## 1. Fetch from Panzoid

```bash
pnpm run setup
```

This fetches the configured CM3 pages and every resource they reference. When
it succeeds you are done: `pnpm run web`, `pnpm run dev` and the builds reuse
the cache from now on.

If Panzoid has a browser check in front of its pages, this fails with a
message saying that the page is behind a browser check (HTTP 403). The tools
never try to get past that check. Use one of the options below instead.

## 2. Restore a snapshot from a maintainer

Maintainers keep a private snapshot of a tested CM3 runtime. Ask one of them
for a snapshot file (`*.zcs`) through a private channel, then run:

```bash
pnpm run cm3:restore -- --from=/path/to/cm3-snapshot.zcs
```

The restore checks every file's size and SHA-256 and the cache metadata
before it replaces your cache. Keep the snapshot file private and delete it
once restored.

Maintainers with R2 credentials can restore straight from the bucket:

```bash
ZOIDIUM_R2_ACCOUNT_ID=... ZOIDIUM_R2_ACCESS_KEY_ID=... ZOIDIUM_R2_SECRET_ACCESS_KEY=... \
  pnpm run cm3:restore -- --from=r2://zoidium-cm3-cache/cm3-snapshot.zcs
```

## 3. Save the two pages in your own browser

Only the two HTML pages are behind the browser check; the files they
reference can still be downloaded normally. You can open the pages yourself in
a normal browser and let the tools fetch the rest.

1. In your usual browser, open each page and wait until the editor loads (the
   browser check passes on its own or asks you to confirm you are human):
   - <https://panzoid.com/legacy/gen3/clipmaker.html>
   - <https://panzoid.com/legacy/gen3/videoeditor.html>
2. For each page, open its source view and save it as a file. Save the source
   view, not "Webpage, Complete", because the tools need the page exactly as
   the server sent it:
   - Chrome, Edge, Brave: go to `view-source:https://panzoid.com/legacy/gen3/clipmaker.html`,
     then press Ctrl+S (Cmd+S on macOS) and save it as `clipmaker.html`.
   - Firefox: same `view-source:` address, then File > Save Page As.
   - Repeat for `videoeditor.html`.
3. Build the cache from the saved pages:

   ```bash
   pnpm run setup -- --page-html=/path/to/clipmaker.html --video-editor-html=/path/to/videoeditor.html
   ```

   If a file is actually the browser check page ("Just a moment...") rather
   than the editor, the tool rejects it. Open the page again, wait for the
   editor, and save the source view again.
4. Delete the saved HTML files when you are done. They are CM3 files and must
   not end up in the repository.

## How deployments get the runtime

Cloudflare Pages builds start without a cache. `wrangler.jsonc` sets
`ZOIDIUM_CM3_SNAPSHOT` (`r2://zoidium-cm3-cache/cm3-snapshot.zcs`) and
`ZOIDIUM_R2_ACCOUNT_ID`; the R2 access key pair
(`ZOIDIUM_R2_ACCESS_KEY_ID`, `ZOIDIUM_R2_SECRET_ACCESS_KEY`) is stored as
encrypted secrets in the Pages project. Because the project uses a Wrangler
configuration file, plain-text variables entered in the dashboard are ignored;
keep non-secret values in `wrangler.jsonc`. The build restores that snapshot
instead of fetching Panzoid. Deployments therefore use the pinned
runtime that was tested, even when Panzoid changes or blocks its pages.

## Updating the snapshot (maintainers)

When Panzoid publishes a new CM3 version, or after rebuilding the cache from
saved pages:

1. Refresh the cache (`pnpm run setup`, or option 3 above) and test Zoidium
   against it (`pnpm run verify`, `pnpm run web`).
2. Export it and upload it to the private bucket:

   ```bash
   ZOIDIUM_R2_ACCOUNT_ID=... ZOIDIUM_R2_ACCESS_KEY_ID=... ZOIDIUM_R2_SECRET_ACCESS_KEY=... \
     pnpm run cm3:export -- --output=r2://zoidium-cm3-cache/cm3-snapshot.zcs
   ```

   Without credentials, export to a local file and upload it with Wrangler
   while logged in to the account that owns the bucket:

   ```bash
   pnpm run cm3:export -- --output=/tmp/cm3-snapshot.zcs
   pnpm exec wrangler r2 object put zoidium-cm3-cache/cm3-snapshot.zcs --file=/tmp/cm3-snapshot.zcs --remote
   ```

3. Trigger a new deployment so it picks up the updated snapshot.

Snapshots made from a cache built by a current Zoidium also contain the two
original pages, so a later Zoidium version can rebuild its cache from the
snapshot without contacting Panzoid.
