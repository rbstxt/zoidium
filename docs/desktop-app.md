# Desktop project files

Zoidium is an independent external extension layer around CM3. The desktop
build packages CM3 resources from a generated stage alongside Zoidium's code.

The installer declares `.pz` files as **Zoidium Project**, with the **Editor**
role on macOS, Windows NSIS, and Linux. Linux AppImage associations require
normal desktop integration of the AppImage. No signing configuration is added.

The application accepts project files from its first command line, a second
launch, and macOS `open-file` events. It restores and focuses the editor window.
Only absolute paths to nonempty regular files with a case-insensitive `.pz`
extension are accepted. Archives larger than 2 GiB minus one byte are ignored,
keeping transport inputs within the signed 32-bit address range. The shared
project validator currently limits decompressed archives to 512 MB; larger
inputs report an error and keep the current project.
Invalid paths and unrelated command-line flags are ignored.

Files received during startup wait until CM3 initialization and Zoidium's
project loader finish. Multiple requests open in order, waiting for each import
to complete. The loader uses the same `editor.open()` path as the toolbar,
including unsaved-change confirmation, archive validation, plugin activation,
asset loading, project names, and errors. A verified restore point is created
before replacement; a failed validation, backup, or load keeps the current
project. See [Saving and restore points](project-saving.md). Cancelling the confirmation keeps the
current project and consumes that open request.

The sandboxed preload exposes only a file notification and fixed ready/completed
IPC channels. The main process accepts messages from the local main editor
frame only. A file notification contains a basename and a temporary random URL,
not a filesystem path. The loopback server streams only the current queued
project. Its URL expires when the renderer completes or cancels the import, or
when the renderer navigates or crashes. Project files are never uploaded.
`nodeIntegration` stays disabled and `contextIsolation` stays enabled.

To test command-line opening during development, use a populated resource cache:

```bash
node tools/start-electron.js /absolute/path/to/project.pz
```

The start script forwards user arguments to Electron. A second invocation sends
its arguments to the existing application. Each development invocation stages
the current checkout's extension files and removes its temporary stage on exit.
