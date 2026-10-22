---
title: Grade an image with Magic Looks
sidebar:
  label: Magic Looks
---
Build an ordered chain of color, light, and lens tools.

1. Enable **Magic Looks** in Plugins.
2. Add its effect from **COLOR**.
3. Click **Open Magic Looks Setup**.
4. Choose a **Category**.
5. Click **Add tool**.
6. Edit the selected instance's native parameter rows.
7. Drag a row to change the tool order.

To make another instance with the same animation, click **Duplicate**. To remove
an instance, click **Remove**. Use Move up or Move down instead of a drag when
working with the keyboard.

Before applying a look preset, save the project if you need the existing
animation. A preset resets chain values and animation. Choose **Clear look** to
restore neutral values while retaining instance identities and order.

To apply a LUT, add a LUT tool and import a 3D `.cube` file in that instance.

[Magic Looks source contract](https://github.com/rbstxt/zoidium/blob/dev/plugins/magic-looks/README.md)
describes LUT limits and multipass requirements.
[Magic Looks compatibility](/docs/development/project-compatibility/#magic-looks)
describes the historical renderers and new instance chains.
