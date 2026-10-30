---
title: Edit animation curves with Graph Editor 2
description: Reveal properties, pin curves, and edit native keyframes in Graph Editor 2, also called Graph+.
sidebar:
  label: Graph Editor 2
---
Use Graph Editor 2, also called Graph+, to edit native keyframes in the graph panel or a floating graph window.

## Show a property

1. In **Plugins**, enable **Graph Editor 2**.
2. Right-click an animatable property row or its timeline label.
3. Choose **Show in Graph Editor**.
4. To open the floating window directly, press Ctrl+G.

To reveal a focused property row, press Alt+Shift+G. Vector and color properties open all their components together.

## Pin or follow curves

**Follow selection** starts on. Selecting a property replaces the displayed curves.

1. Select a property to show its curves.
2. To add another property, Ctrl-click or Shift-click its row.
3. To retain the displayed curves while selecting other objects, turn off **Follow selection**.
4. To replace pinned curves explicitly, use **Show in Graph Editor** again.

Selecting an object or layer follows its animated properties, including nested material and geometry properties. The follow preference persists locally.

## Change keys and tangents

1. Select **Marquee** to select keys with a drag.
2. Select the keys to change.
3. Choose **Linear**, **Step**, **Ease**, or **Custom easings**.
4. For handle editing, use **Bezier**.
5. To separate tangent directions, choose **Break Tangents**.
6. To restore continuous tangents, choose **Auto Tangents**.
7. To inspect the edited range, click **Frame**.

## Edit vector axes

1. Click an axis row to show that axis and select its keys.
2. To combine axes, Ctrl-click or Shift-click additional rows.
3. To select all components, click the parent row.
4. To hide a curve, click its eye button. To isolate an axis, click its **S** button.
5. To move sibling keys at the same frame together, turn on **Link axes**.

With **Link axes** on, horizontal drags and nudges move same-frame sibling keys. Value changes stay on the selected axes.
Copy and paste preserve axis names. To paste a single axis onto a different axis, select only the destination axis.

## Inspect expressions

1. Show a property that has an expression.
2. To inspect its evaluated output, use **Fit** or **Frame**.
3. To edit its keys, remove the expression first.

Expression curves use dashed lines and an **Expression** label. Very slow expressions may draw over several redraws.

For an incoming-segment curve editor, use [Easing+](/docs/features/easing-plus/). Both tools use the same native Bezier handles.

For toolbar meanings, focused-window shortcuts, and view controls, see the [Graph Editor 2 reference](/docs/reference/graph-editor/).
