---
title: Edit and check a shader
description: Use completion, diagnostics, Declare and templates in the Shader+ editor.
---
Enable Shader+ and open a Custom Shader's code editor.

## Complete a symbol

1. Type a uniform or helper prefix in the code area.
2. Use the arrow keys to select a completion.
3. Press Tab or Enter to insert the selected name.

Press Escape to close completion. Hover over a symbol or place the caret in a
function call to read its signature. In the side list, click **?** for an example.
Click **Documentation** to open the matching reference anchor.

## Fix a draft error

1. Edit the draft.
2. Wait for the live check after the 400 ms pause.
3. Click a diagnostic to select its source line.
4. Correct the code.

The live check compiles a disposable program. The saved effect and preview remain
unchanged until Apply. Muted uniform hints are advisory; the compiler decides
whether the shader is valid. If a property lacks a declaration, click **Declare**
to insert the declaration into the draft.

## Start from a template

1. Open **New from template**.
2. Select a template.
3. Confirm the draft replacement.
4. If the template needs properties, click **Add properties**.
5. Click **Apply** to save the source.

Add properties creates one project history entry. Apply creates a separate entry.
Animated noise requires Expressions+. Text overlay uses a project font.

## Find and edit text

Use these shortcuts while the code area has focus:

- Ctrl or Cmd + F opens literal find and replace.
- Ctrl or Cmd + / toggles line comments.
- Tab indents; Shift + Tab removes indentation.
- Ctrl or Cmd + Z undoes a draft edit.
- Ctrl or Cmd + S, or Ctrl + Enter, applies the draft.
- Ctrl or Cmd + Plus or Minus changes the code font size.

Project undo refreshes the draft from the saved property. Font size stays local
and does not enter the project. See [editor compatibility](/docs/development/project-compatibility/#shader-editor-development-aids).
