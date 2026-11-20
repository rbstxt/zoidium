---
title: Getting started
description: Open Zoidium, pick an editor layout, move windows across monitors, enable plugins, and save projects.
---
Set up Zoidium's external extension layer around CM3, arrange your workspace, and save a project.

## Open the editor

[Open the web editor](/). On desktop, start the Zoidium application.
See [Desktop app](/docs/development/desktop-app/) for `.pz` file associations and command-line opening.

## Choose a layout and theme

1. Open **Settings**.
2. Set **Editor layout**.
3. Reload Zoidium to apply the layout.

You can choose **Clipmaker 3**, **Clipmaker 3 Centered**, **Video Editor 2**, **Video Editor 2 Centered**, or **Video Editor 2 Centered 2**.
The three **Centered** layouts add a second tab sidebar on the right, so the preview sits between two panel columns.
**Video Editor 2 Centered 2** also extends the right sidebar beside the timeline.

To rearrange panels in a **Centered** layout, right-click a panel tab and choose **Move to top**, **Move up**, **Move down**, **Move to bottom**, or **Move to right sidebar** (**Move to left sidebar** when the tab is on the right).
Each sidebar keeps at least one tab. Zoidium saves the arrangement with your other local editor settings.

In **Settings**, you can also set the editor theme, UI font, gradient editor, default frame rate, and [preview cache memory limit](/docs/workflow/preview-and-cache/).

## Move editor windows to another monitor

Floating Zoidium windows such as **Graph editor**, **Shader**, **Expression**, and **Trapcode Designer** can pop out into separate browser windows without interrupting your edit.

1. Open the floating editor window.
2. In its title bar, click **Pop out**.
3. If the browser blocks the popup, allow popups for this site and click **Pop out** again.
4. Drag the popup window to the monitor you want.

To bring the window back into the main editor, click **Return to editor** in its title bar, or close the OS window.
The floating window returns to its previous position and size. The next pop-out reuses the popup's last position and size when the browser permits it.

To close the editor itself, click **Close** inside its title bar. Closing the main Zoidium page closes every popup.
Removing the edited effect or replacing the project also closes its editor.
Unsaved text stays in the live editor when you move it between windows. Click **Apply** to write shader or expression text back to the project.

## Enable a plugin

1. Open **Plugins** in the sidebar.
2. Find the plugin in its category.
3. Turn the plugin on.
4. Add its objects, effects, or materials from the matching picker.

Some plugins are on by default. See the [Plugin index](/docs/plugins/) for every available plugin and its category.

Before disabling a plugin, remove project content that depends on it.
If Zoidium offers to save a restore point, complete that step before continuing.
See [Plugin manager](/docs/development/plugin-manager/) for enable and disable rules.

## Open and save a project

1. Click **Open** in the project toolbar, or press Ctrl+O.
2. Choose a `.pz` archive.
3. If Zoidium prompts for an installed plugin that the project requires, enable that plugin.
4. Edit the project.
5. Click **Save** to download a `.pz` copy.
6. Keep a downloaded copy of important work.

[Saving and restore points](/docs/development/project-saving/) covers local automatic backups, the save reminder dot, missing assets, and damaged archives.
Clearing browser site data can remove local restore points.
If something goes wrong, check [Troubleshooting](/docs/troubleshooting/).
