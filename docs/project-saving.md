# Saving and restore points

Zoidium is an independent external extension layer around CM3. Project files
remain gzip-compressed TAR archives with CM3's `meta`, `project`, and asset
entries. The optional `zoidium.json` entry adds the project name and a size and
full SHA-256 digest for each entry. Existing CM3 asset IDs stay unchanged.
Older Zoidium builds ignore this additional integrity metadata.

Save copies attached asset bytes into page memory, checks local asset
references and content IDs, builds the archive, then decodes and validates the
finished Blob through the same validator used by Open. Font and texture preview
decoding is not needed to save their attached bytes. Saving therefore does not
wait for a video export, preview decoder, or another tab's export-workspace
lease. An unreadable or missing local asset stops the save and names the asset;
the previous file and restore points remain available. Zoidium does not silently
remove missing assets to make a save succeed.

Browser Save writes only a validated Blob. File System Access uses a writable
stream and aborts a failed write or commit. Download fallback also validates
before starting the download. A failed save leaves the project dirty. Edits or
project replacement during archive construction cancel delivery; an old save
cannot attach its destination handle to a newly opened project.

Each asynchronous archive read and preparation step has a ten-second wait
limit. Complete save preparation has a sixty-second limit. The picker waits
for the user's choice. JavaScript timers cannot run while the browser's main
thread is blocked by synchronous work. Archive processing limits uncompressed
input to 512 MB, JSON entries to 32 MB, entry count to 10,000, and project nesting to 128 levels. Inputs above
these limits fail explicitly and leave the current project intact.

Restore points default to five-minute intervals. Each new point stores one
complete validated archive and its metadata in one IndexedDB transaction. The
writer reads it back, checks its size and full SHA-256 digest, and validates its
archive before rotation. Snapshot IDs are inserted, never overwritten. Older
split records remain readable; their shared asset cleanup scans references and
deletes assets in one transaction spanning both stores.
Backup writes, verification, quota cleanup, and rotation use an origin-wide
writer lock. Browsers without Web Locks use a renewable IndexedDB lease.
Lease ownership is checked inside each mutating transaction; an expired or
replaced lease cannot commit a point or delete retention candidates.

Automatic retention keeps recent points while preserving the newest verified
point for each project and tab owner. Manual points are retained until deleted.
If storage is full, Zoidium removes the oldest extra automatic points and
retries. It preserves the last verified point and reports when space remains
insufficient. Browser storage is local to the application origin and can be
removed by clearing site data. Download important projects separately.

Open and New take a verified restore point before replacing an existing project.
Restore validates its selected point first, then backs up the current project
before loading it. A failure keeps the current project. A structurally readable
archive with unavailable assets offers **Open readable parts**, lists the bad
assets, and keeps their references so they can be attached again. A damaged
project document or container cannot be opened partially. Error notifications
also offer restore-point recovery.

Individual and group plugin switches take a verified backup before disabling
plugins. A failed backup keeps the switches enabled. Plugins used by the
project also refuse disable operations through the plugin manager's usage
locks. Serialized plugin data stays present when its implementation is
unavailable. Zoidium has no in-session plugin upgrade action. An external code
update should be preceded by a downloaded project or verified restore point.

The desktop loader uses this same Open path. Its trusted loopback route checks
regular-file type and size again after opening a file. Renderer reads and
loading have bounded waits and always release the desktop import queue.
