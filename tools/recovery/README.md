# Project rescue scripts

Two console scripts recover a project from a still-open editor tab whose
normal Save, restore point, or restore-point download no longer works.
Both run locally in that page, never change the live project, never write
restore points, and send nothing over the network.

- [project-rescue.js](../../about/rescue/project-rescue.js) is the general
  tool. Use it first. It is served at `/about/rescue/project-rescue.js`, and
  the [rescue page](../../about/rescue/index.html) at `/about/rescue` turns
  it into a bookmarklet. Error toasts in the editor link to that page, and
  the page links the Zoidium Discord server for bug reports.
- [node-image-rescue.js](node-image-rescue.js) handles only a stale Node
  Material image selection, described further below.

## General rescue: project-rescue.js

Do not refresh or close the affected tab, open another project in it, or
clear site data. Stop playback and editing.

1. Click the **Zoidium Rescue** bookmarklet from `/about/rescue` on the
   affected tab. Without a bookmark, open DevTools on that tab, choose
   **Console** with the context selector on `top`, paste the entire
   [project-rescue.js](../../about/rescue/project-rescue.js), and press Enter.
   Do not navigate the editor tab to the file.
2. When the rescue page was opened from an editor error toast, its **Run in
   the editor tab that opened this page** button starts the same script in
   that tab.
3. The orange panel shows each step live, the failed step with its error,
   and a Discord link with a **Copy report** button. In the Console, wait for
   `===== Summary =====`. Each step prints `[PZRescue] > step`, then
   `ok`, `FAILED`, or `STUCK`. A step that has not finished prints
   `still waiting at "step"` every 5 seconds. A failed or stuck step logs its
   error and the script continues with the next fallback.
4. The best file downloads automatically: `...-repaired.pz` or
   `...-rescued.pz`. The panel in the top-right corner offers every file. Its buttons use the browser's save dialog where available, which
   bypasses the download system.
5. Open the downloaded file in a **different** editor tab and check it. Close
   the affected tab only after the copy is usable and saved normally.

What the script tries, in order:

| Area | Approach |
| --- | --- |
| Serialization | CM3's `PZ.project.save`, then `JSON.stringify(project)`, then an object-by-object serializer. Only objects whose `toJSON()` throws, cycles, or throwing getters are left out. If an object has a `properties` field, a generic copy of its fields is kept. Every omitted path is logged. |
| Attached files | Each asset's `file`, then the page's own `blob:` URL for that asset. Files up to 256 MB are copied into memory. An asset without bytes is reported by filename. It opens as a missing asset, which can be relinked with **Media > Missing assets > Locate**. |
| Repairs (copy only) | Rebuilds broken asset-table entries from the live assets. Corrects a recorded size only when the bytes match the asset ID. Removes non-string runtime thumbnails. Clears a stale `nodeImage` selection only when its graph does not use that ID. When anything is repaired, an unmodified `...-raw.pz` is also built. |
| Packaging | The script includes its own gzip/TAR writer. Without `CompressionStream`, it uses CM3's tar worker. Each file is re-read and checked, then run through Zoidium's open validator for information. The validator is skipped above 512 MB to protect page memory. |
| Diagnosis | Reports a never-finished earlier Save or open/restore, pending plugin activation, objects that never finished loading, and asset references without asset metadata. It names dialog-like elements on screen. Finally, it runs Zoidium's normal archive builder without writing anything and reports where it fails. If that builder succeeds, its validated file is offered as `...-zoidium.pz`. |
| Restore points | Reads Zoidium's IndexedDB storage read-only. Full and split points are rebuilt without the validator, which may be what blocks their normal Download button. |

Console commands after the run:

```js
await PZRescue.download()            // best file again; or "raw", "json", "zoidium"
PZRescue.panel()                     // reopen the orange panel
PZRescue.urls()                      // blob URLs to open in a new tab
await PZRescue.downloadAssets()      // every attached image/video/audio/font file
await PZRescue.restorePoints()       // table of stored restore points
await PZRescue.downloadRestorePoint(0)
copy(PZRescue.report())              // step/diagnosis report, no project content
```

If no `.pz` can be built, the summary names the first failed or stuck step.
`PZRescue.download("json")` still saves the editing data without media
bytes. Keep the tab open and share the `copy(PZRescue.report())` output.

Limits: the capture reflects the moment of serialization. Undo history and
uncommitted text in an active field are not included. An object that never
finished loading may serialize with default values. Bytes that are absent
from the page cannot be invented, and a missing asset is never relabelled
with another file. Pasting the script again keeps the earlier run in
`PZRescue.previous`.

## Stale Node Material image selection: node-image-rescue.js

Use this only on the **still-open affected editor tab**. Do not refresh, close
the tab, clear site data, open another project in that tab, or disable plugins
before copying its unsaved state. Pause playback and editing while capturing.
The script runs locally in that page. It sends no project data over the network
and does not write to IndexedDB or change the live project.

1. Open DevTools on the affected tab and choose **Console**, in the main frame.
2. Open [node-image-rescue.js](node-image-rescue.js) as text, copy the entire
   file, paste it into Console, and run it once. Do not navigate the editor to
   the script file. Wait for `Rescue copies are ready`, or inspect the failure
   message. The capture is stored in `window.ZoidiumRescue`.
3. Download the original snapshot first:

   ```js
   await ZoidiumRescue.download("original")
   ```

4. Run a separate command to download the validated compatible copy:

   ```js
   await ZoidiumRescue.download("compatible")
   ```

5. Confirm that both `.pz` downloads finished. Keep the affected tab open.
   Open the compatible file in a **different editor tab** and check its text,
   timing, materials, images, fonts, and audio. Only close the original tab
   after the independent copy is usable and safely saved.

`original.pz` preserves the serialized project and all readable attached files,
including its stale references. It is an emergency capture, and the old page
can reject it. Keep it even if the compatible copy works. A compatible copy
is offered only after the current page's own archive validator accepts it and
accepts the encoded and decoded result. This checks the archive and assets;
it does not prove that every plugin will render identically after loading.

The compatible copy changes only missing-metadata `nodeImage` values on Node
Material or PBR+ whose parsed graph contains no occurrence of the missing ID.
It also uses Zoidium's normal thumbnail sanitizer and adds fresh integrity
metadata. No graph nodes, animation, objects, or real image references are
removed. The script examines all nested serialized project data, rather than
only the first failing object path.

If no compatible copy is available, inspect:

```js
({ error: ZoidiumRescue.error, assetError: ZoidiumRescue.assetError,
   graphWarnings: ZoidiumRescue.graphWarnings, repairs: ZoidiumRescue.repairs })
```

Download `original` if available. Also preserve the JSON:

```js
await ZoidiumRescue.download("json")
```

The JSON retains serialized editing data but **does not include asset bytes**.
Missing bytes, a real graph image using a missing ID, or malformed graph JSON
block the compatible copy. Other dangling asset properties are preserved and
checked by the page's validator. The affected old validator rejects them;
the corrected validator can warn and accept them. An accepted archive still
needs an independent reopen and visual inspection. If an attached file cannot
be read, JSON may be the only available capture. Do not invent
asset metadata or relabel another image with the missing hash.

The capture describes the state at serialization time. Stop editing until it
finishes. It does not contain undo history, uncommitted text in controls, or
future changes, and cannot capture data from objects that have not initialized.
It needs enough page memory for archive construction. It never invokes CM3's
shared export worker or its legacy download-page flow.

The script deliberately refuses a second execution while `ZoidiumRescue`
exists so it cannot overwrite the first capture. Separate download commands
avoid relying on multiple automatic downloads from a single console execution.
