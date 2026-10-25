---
title: Repair missing or failed assets
sidebar:
  label: Repair assets
---
Reconnect the files that a project needs before exporting or saving a new archive.

## Find the problem items

1. In **Plugins**, enable **Assets** if the tab is unavailable.
2. Open **Assets**, then click **Open Assets**.
3. Set the usage filter to **Problems**.
4. Select an item and read its status and usage information.

**Missing** means the project lacks the file. **Failed** means the item failed to load. **Problems** includes every missing file and failed items that the project uses.

To find a use, open the selected item's usage list or choose **Reveal in Timeline**. If the use belongs to a closed composition, open that composition in **Compositions** first. Switching compositions clears Undo and Redo.

## Locate the original file

1. For a **Missing** item, choose **Locate…**.
2. Select the original file on your computer.
3. Check the item's status again.

If the file differs from the original, Assets offers **Replace**. Accept only when you intend to change the source everywhere it can be replaced. Otherwise, cancel and choose the original file.

## Replace or reload a source

Before replacing a source, inspect its uses. **Replace…** changes every editable use of the item. Uses in closed compositions can be skipped and are listed in the result. Open those compositions to replace their uses separately.

1. Select the item.
2. To use different content, choose **Replace…**, then select a file of the same type.
3. To retry the existing source after a load or network failure, choose **Reload**.
4. Check the result notification and the rendered content.

If a replacement gives the wrong result, use Undo before switching compositions.

## Resolve missing fonts

1. Open the Assets project menu.
2. Choose **Resolve Fonts…**.
3. For each problem font, choose a built-in font in **Replace with**, or click **Font file…**.
4. To leave a font unchanged, select **Keep as is**.
5. Click **Replace**.
6. Check the text layout and line breaks.

To retry a failed built-in font without changing its identity, use **Reload** on the item instead.

## Save the repaired project

1. Return the filter to **Problems** and check the remaining items.
2. Save a new `.pz` archive with the normal project save action.
3. Keep the earlier archive until you have checked the repaired copy.

**Collect Files…** downloads asset files and a report. It does not replace the editable project archive. [Saving and restore points](/docs/development/project-saving/) describes archive recovery. [Assets reference](/docs/reference/assets/) lists the organization and cleanup commands.
