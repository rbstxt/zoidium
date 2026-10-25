---
title: Assets
---
The **Assets** tab and window list the project's files, built-in resources, plugin resources, embedded resources, and compositions.

## Types, status, and uses

The type filter includes **Composition**, **Video**, **Audio**, **Image**, **Font**, **3D Model**, **LUT**, **Shader**, **IES Profile**, and **File** when those kinds exist in the project.

| Status | Meaning |
| --- | --- |
| **Ready** | The registry has no loading, missing, or failed status for the item. |
| **Loading** | The resource is loading. |
| **Missing** | The referenced file is unavailable. |
| **Failed** | Resource loading failed. |

**Uses** counts references, including uses in closed compositions. A use can be a clip, a property, or a keyframe. A listed use is selectable only when the editor can reveal it. Closed-composition uses report the composition that contains them.

## Filters and search

| Filter | Contents |
| --- | --- |
| **All** | Every item. |
| **Used** | Items with at least one reference. |
| **Unused** | Items with no references. |
| **Problems** | Missing files, plus failed items with at least one reference. |

**Type** limits the item kind. **Search** matches words in names, types, status, sources, and details. Every search word must match. A filter, type restriction, or search shows a flat list. The unrestricted view shows folders.

## Item commands

Commands are enabled only when they apply to the selected item.

| Command | Result |
| --- | --- |
| **Import…** | Adds files as project items. Footage also appears in the native Media panel. |
| **Reveal in Timeline** | Selects an editable use. Closed-composition uses require that composition to be open. |
| **Reload** | Retries the existing resource without selecting a replacement. |
| **Locate…** | Reattaches an original missing file. A different file can enter the replacement flow after confirmation. |
| **Replace…** | Replaces editable uses with another file of the same kind. Uses in closed compositions are skipped and reported. |
| **Download** | Downloads the available bytes as a separate file. |
| **Delete** | Removes an unused file, or confirms deletion of its clips and property uses. Uses in closed compositions block deletion. |
| **Open Composition** | Opens a composition's source timeline. |
| **Rename** | Changes a composition's name or a folder's name. |
| **Duplicate** | Creates a separate composition source. |

Composition rows use composition commands. File reload and download do not apply to them. Used compositions cannot be deleted until their referring clips are removed.

## Project commands

**Project commands** contains the following operations.

| Command | Result |
| --- | --- |
| **New Folder** | Creates an organizational folder. |
| **Remove Unused Items** | Removes imported files with no references. It does not ask for confirmation. Undo restores them. |
| **Consolidate All Footage** | Merges files with identical bytes. Closed-composition uses can keep an original item alive and are reported. |
| **Collect Files…** | Downloads a ZIP with available files under `Assets` and a report of missing files. It is not a `.pz` project archive. |
| **Resolve Fonts…** | Replaces used missing or failed fonts with a built-in font or a font file. |

Collection does not repair missing bytes. Built-in and plugin items are not ordinary imported files eligible for unused-file cleanup.

## Folders, labels, and drag operations

Folders organize project items without changing the files on disk. **New Folder Inside** creates a child folder. **Delete Folder** moves its contents to the parent rather than deleting assets. A folder cannot move into itself or a descendant.

The **Label ▸** menu sets one of 16 label colors or **None** on items and folders. Folder structure and label metadata are saved with the project.

Dragging an item or folder onto a folder moves it there. Dropping on empty list space moves it to the root. Files dropped from the computer are imported. Supported footage can be dragged onto the timeline. Compatible asset items can be dropped onto asset-property rows.

## Undo limits

Import, replacement, unused-file removal, consolidation, folder edits, label edits, and asset-property assignment use project history. Reload, collection, and download are resource or file operations, not source-edit recovery copies.

Switching Precomp+ compositions clears Undo and Redo. An Undo operation cannot restore a file that was never available to the project.

[Repair assets](/docs/how-to/repair-assets/) gives recovery steps. [Saving and restore points](/docs/development/project-saving/) covers editable archives.
