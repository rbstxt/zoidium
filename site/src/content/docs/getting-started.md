---
title: Set up the editor
sidebar:
  label: Getting started
description: Open a project, choose a layout, and enable plugins.
---
Set up Zoidium's external extension layer around CM3, then save a project.
[The overview](/docs/) describes the project and its independent status.

## Open the editor

[Open the web editor](/). For desktop, start the Zoidium application.
[Desktop project files](/docs/development/desktop-app/) describes file associations.

For a local checkout, run these commands:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run setup
pnpm run web
```

Open the HTTP address printed by the server. To start desktop development,
run `pnpm run desktop:start` instead of `pnpm run web`.

## Choose a layout

1. Open **Settings**.
2. Set **Editor layout**.
3. Reload Zoidium.

Choose Clipmaker 3, Clipmaker 3 Centered, Video Editor 2, Video Editor 2 Centered,
or Video Editor 2 Centered 2. Use Settings to choose the theme, UI font,
gradient editor, and preview cache memory limit.

[Preview cache](/docs/features/preview-cache/) explains the memory limit.

## Enable a plugin

1. Open **Plugins** in the sidebar.
2. Find the plugin or group.
3. Enable the plugin.
4. Add its objects, effects, or materials from the matching picker.

Before disabling a plugin, remove project content that requires the plugin.
If Zoidium offers to save a restore point, complete that step before continuing.
[The plugin manager](/docs/development/plugin-manager/) describes the implementation.

## Open and save a project

1. Click **Open** in the project toolbar, or press Ctrl+O.
2. Choose a `.pz` archive.
3. If Zoidium requests a required installed plugin, enable the plugin.
4. Edit the project.
5. Click **Save**.
6. Keep a downloaded copy of important work.

[Saving and restore points](/docs/development/project-saving/) describes local
backups, missing assets, and save failures. Clearing site data can remove local
restore points.
