---
title: Assets and project files
description: Manage project media, fonts, folders, drag-and-drop imports, and repair missing or failed assets in the Assets panel.
---
The **Assets** panel lists every file, font, image, video, audio clip, 3D model, LUT, shader, IES profile, and composition in your project, shows where each item is used, and lets you reconnect missing or failed files.

**Assets** is enabled by default. Open the **Assets** tab in the sidebar, then click **Open Assets** to open the full window.

## Drop or paste files to import

You can drag files from your computer directly into Zoidium, or paste them from the clipboard.

| Drop target | Result |
| --- | --- |
| **Media** panel (including empty space) | Imports files into Project media. |
| **Timeline** | Imports files and places clips at the drop frame on the track under the pointer. |
| **Preview** | Imports files and places clips at the playhead on a new top track. |

If the track under the pointer is occupied, the timeline creates a new track.
File drops do not alter internal drags such as media tiles, clips, or layer rows.

Supported file types are images, video, audio, fonts, and `.pz` projects.
Dropping a `.pz` file imports it as a media item (the same as **Import**); it does not replace the open project. Unsupported files show an import error and are skipped. Multiple files import in order.

Press Ctrl+V (Cmd+V on macOS) to paste image, video, or audio files from the clipboard. Text fields keep normal paste behavior. Unnamed bitmaps save as `Pasted image 1.png`, `Pasted image 2.png`, and so on. When the timeline has focus, pasted media is placed at the playhead.

## Project fonts in font pickers

Fonts imported in **Assets** appear in every **Font** picker across Zoidium: native Text, 3D Text, Shape+ **Font Family** and **Fallback Font**, and Shader+ text.

- Pickers list built-in fonts first, then imported fonts under **Project fonts** sorted by name, then **custom...**.
- The picker button previews the selected project font in its own typeface. Shader+ text displays the file name instead.
- Picking a project font stores the asset key in one undo step.
- A project font that fails to parse shows its file name with a **failed** badge.
- Removing a font that is still in use marks the property as **Missing** without breaking the panel.

## Repair missing or failed assets

Reconnect problem files before exporting or saving a new project archive.

### Find problem items

1. Open **Assets**, then click **Open Assets**.
2. Set the usage filter to **Problems**.
3. Select an item and read its status and usage list.

**Missing** means the project does not have the file's bytes. **Failed** means the resource failed to load. **Problems** shows every missing item plus every failed item that has at least one use.

To jump to a reference, open the item's usage list or choose **Reveal in Timeline**.
Uses inside closed Precomp+ compositions report their composition name and cannot be edited until you open that composition in **Compositions**.

### Locate, replace, or reload a file

- **Locate…** (for **Missing** items): Select the original file on disk and verify the status becomes **Ready**. If the file differs from the original, Assets offers **Replace**. Accept only when you want to change the source across all editable uses.
- **Replace…**: Replaces every editable use with another file of the same type. Inspect the uses first. Uses inside closed compositions are skipped and listed in the result so you can open those compositions and replace them separately.
- **Reload**: Retries loading the existing source after a load or network failure without changing the item's identity.

If a replacement produces the wrong result, use **Undo**.

### Resolve missing or failed fonts

1. Open the Assets project menu and choose **Resolve Fonts…**.
2. For each problem font, choose a built-in font under **Replace with**, or click **Font file…** to pick a local font.
3. To leave a font unchanged, select **Keep as is**.
4. Click **Replace**, then check text layout and line breaks.

To retry a failed built-in font without replacing it, use **Reload** on that font item instead.

### Save the repaired project

1. Switch the filter back to **Problems** and confirm no unresolved items remain.
2. Save a new `.pz` archive with the normal **Save** command.
3. Keep the earlier archive until you verify the repaired copy.

**Collect Files…** downloads available asset bytes and a missing-files report as a ZIP. It is not a `.pz` project archive. See [Saving and restore points](/docs/development/project-saving/) for editable archives and recovery.

## Types, status, filters, and search

The **Type** filter lists **Composition**, **Video**, **Audio**, **Image**, **Font**, **3D Model**, **LUT**, **Shader**, **IES Profile**, and **File** whenever those kinds exist in the project.

| Status | Meaning |
| --- | --- |
| **Ready** | Available with no loading, missing, or failed status. |
| **Loading** | Currently loading. |
| **Missing** | Referenced file is unavailable. |
| **Failed** | Resource failed to load. |

**Uses** counts every reference across clips, properties, and keyframes, including references inside closed compositions.

| Usage filter | Shows |
| --- | --- |
| **All** | Every item. |
| **Used** | Items with at least one reference. |
| **Unused** | Items with no references. |
| **Problems** | Missing files, plus failed items with at least one reference. |

**Search** matches words across names, types, status, sources, and details. Every search word must match.
Applying a usage filter, type filter, or search shows a flat list. Clearing all filters shows your folder hierarchy.

## Item commands

Commands enable only when they apply to the selected item. Uses inside closed compositions are skipped, reported, or require opening that composition first.

| Command | Result |
| --- | --- |
| **Import…** | Adds files as project items. Footage also appears in the Media panel. |
| **Reveal in Timeline** | Selects an editable use in the open timeline. |
| **Reload** | Retries the existing resource without picking a replacement. |
| **Locate…** | Reattaches an original missing file (or enters replacement after confirmation). |
| **Replace…** | Replaces editable uses with another file of the same kind. |
| **Download** | Downloads the item's available bytes as a standalone file. |
| **Delete** | Removes an unused file, or asks to confirm deleting its clips and property uses. |
| **Open Composition** | Opens a composition's source timeline. |
| **Rename** | Renames a composition or folder. |
| **Duplicate** | Creates a separate copy of a composition source. |

Composition rows use composition commands. Reload and Download do not apply to compositions, and a used composition cannot be deleted until its referring clips are removed.

## Project commands

| Command | Result |
| --- | --- |
| **New Folder** | Creates an organizational folder. |
| **Remove Unused Items** | Removes unreferenced imported files without asking for confirmation. Undo restores them. |
| **Consolidate All Footage** | Merges imported files that have identical bytes. |
| **Collect Files…** | Downloads a ZIP matching the Assets folder structure plus a report of missing files. Does not repair missing bytes or replace a `.pz` archive. |
| **Resolve Fonts…** | Replaces used missing or failed fonts with a built-in font or font file. |

Built-in and plugin items are never deleted by **Remove Unused Items**.

## Folders, labels, and undo limits

- Folders organize items inside the Assets window without touching files on disk. **New Folder Inside** creates a nested folder. **Delete Folder** moves its contents up to the parent folder instead of deleting assets.
- The **Label ▸** menu assigns one of 16 label colors or **None** to items and folders. Folder layout and labels save with the project.
- Drag items or folders onto a folder to move them, or drop on empty list space to move them to the root. Drag supported footage onto the timeline, or drop compatible items onto asset-property rows.
- **Undoable:** Import, Replace, Remove Unused Items, Consolidate All Footage, folder edits, label edits, and asset-property assignment.
- **Not undoable:** Reload, Collect Files, and Download.
