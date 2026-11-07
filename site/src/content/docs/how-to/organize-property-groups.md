---
title: Organize custom properties into groups
sidebar:
  label: Property groups
---
Group custom properties without changing their names or shader uniforms.
These steps apply to Shader+ and other objects or effects with a **Custom properties** list.

## Create a group

1. Right-click a custom property row.
2. Choose **Group…**.
3. Enter a group name in **Group**.
4. Click **Apply**.

To add another property to the group, repeat these steps with the same name.
You can also drag a property onto an unlocked group heading or one of its rows.

To remove a property from a group, open **Group…**, clear **Group**, and click **Apply**.

## Change group settings

1. Click **Settings** beside the group name.
2. Edit **Name**.
3. Set **Lock** to prevent accidental drag operations.
4. Click **Apply**.

To collapse or expand a group, click its name.
To change the display order, drag an unlocked group heading.

A locked group rejects heading drags and property drags into or out of the group.
Unlock the group before changing a property's group assignment.
You can still edit and animate property values while the group is locked.

## Lock a 3D object group

1. Find the group in the **Objects** panel.
2. Click **Lock** on its row.

To unlock the group, click **Locked**.
The lock prevents panel drags of the group or its contents and drops into the group.
The group's transforms and animation continue to render.

## Keep group settings in a project

Save the project after you organize its properties.
Group names, display order, collapsed state, and locks survive reopen and duplication.
Each group edit or lock change is one undo step.

Existing projects keep their current property organization.
Shader+ properties with an existing **Group** setting use the shared group headings.
Older builds can open saved projects, but they do not enforce these locks.
