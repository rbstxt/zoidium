---
title: Getting started
description: Choose a layout, open a project, enable tools and save your work.
---
Zoidium is an open-source collection of tools for extending CM3. It runs as an
external extension layer around the editor and is independent of Panzoid.

## Web or desktop

[Open the web editor](/) to work in the browser. The desktop application packages
the staged CM3 runtime with the same extension layer. It can open `.pz` files
from the operating system. Read [desktop project files](/docs/development/desktop-app/)
for file association and opening behavior.

For a local checkout, run `pnpm install --frozen-lockfile`, `pnpm run setup`,
then `pnpm run web`. Open the HTTP address printed by the server. Setup fetches
the configured CM3 resource graph into an ignored cache. `pnpm run desktop:start`
starts the desktop development build.

## Open and save projects

Use Open in the project toolbar or Ctrl+O to load a `.pz` archive. Zoidium checks
the archive and offers to enable required installed plugins. If a plugin is
unavailable, its data can remain as a missing-type placeholder.

Save downloads or writes a validated project archive with attached asset bytes.
Keep downloaded copies of important work. Restore points use local browser
storage, which clearing site data can remove. See
[saving and restore points](/docs/development/project-saving/) for recovery,
missing assets and save failure behavior.

## Choose a layout

Open Settings and change **Editor layout**. Reload to apply the selection.
The available layouts are Clipmaker 3, Clipmaker 3 Centered, Video Editor 2,
Video Editor 2 Centered and Video Editor 2 Centered 2. The centered variants
rearrange the viewport and panels. They use the same project data and plugins.

## Settings and plugins

Settings controls editor appearance, UI font, gradient editor and preview cache
memory. Appearance and cache preferences stay local to this browser and do not
change rendered project content. [Preview cache](/docs/features/preview-cache/)
explains the memory setting.

Open the Plugins sidebar to see the installed tools and their status. Enable a
plugin before adding its objects, effects or materials. A plugin in use can
refuse to turn off until its project content is removed. Read the
[plugin manager guide](/docs/development/plugin-manager/) for groups, dependencies
and missing types.

Start with [Shape+](/docs/features/shape-plus/) for 2D paths,
[Text+](/docs/features/text-plus/) for 3D character animation, or
[Shader+](/docs/features/shader-plus/) for custom image effects.
