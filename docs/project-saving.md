# Saving and restore points

A failed save keeps your edits in the editor. Edits made while a save is running cancel that save. If a save or open takes a long time, a "Still working" question offers Keep waiting or Stop. It closes itself when the step finishes, so a valid project never fails on time alone. Automatic backups stop at that point instead of asking.

## Restore points

Zoidium stores restore points automatically every five minutes. Manual points are kept until you delete them. Open, New, Restore, and plugin disable store a restore point of the current project first. When that backup fails, for example because browser storage is full, you choose between keeping the current project and continuing without a backup.

Restore checks the selected point first, then backs up the current project before loading it. A failure keeps the current project. If storage is full, Zoidium removes the oldest extra automatic points and keeps the newest one for each project.

Restore points live in browser storage, local to the application. Clearing site data can remove them. Download important projects separately.

## Missing assets

A file that is already missing in the editor does not stop the save. Its reference is recorded, the reopened project shows it as missing again, and a notice after the save lists it.

An attached asset whose bytes cannot be read stops the save and names the asset. The previous file and restore points remain available.

## Open a damaged project

A readable archive with unavailable assets offers **Open readable parts**. It lists the bad assets and keeps their references so they can be attached again. A damaged project document or container cannot be opened partially. Error notifications also offer restore-point recovery.
