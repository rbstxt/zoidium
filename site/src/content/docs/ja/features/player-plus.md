---
title: Player+ のプレビュー操作
description: Player+ によるビューポートの描画と、再生や書き出しとの関係。
sidebar:
  label: Player+
---
Player+ はプレイヤーのツールバーに描画操作を追加します。ビューポートの描画を一時停止した状態で、プロジェクトを編集できます。

## 描画と再生

**Pause drawing** はビューポートの再描画を停止します。再生ヘッドや音声は停止しません。再生は通常の再生コントロールで個別に操作します。

**Render once** は、描画の一時停止中に加えた変更を含めて、現在のフレームを描画します。**Resume drawing** はビューポートの自動更新を再開します。

編集の手順は[負荷の高いプロジェクトのプレビューガイド](/docs/ja/how-to/preview-heavy-project/)を参照してください。

## プレビューサイズと書き出しサイズ

**Preview quality** には **Full quality**、**1/2 quality**、**1/4 quality**、**1/8 quality** があります。各比率はビューポートの幅と高さのピクセル数に適用されます。選択はローカルに保存されます。

Player+ が変更するのは、エディターのビューポートサイズです。プロジェクトの解像度と書き出し設定は別に管理されます。[プレビューキャッシュ](/docs/ja/features/preview-cache/)には独立したメモリ予算があります。

コントロールのリファレンス: [editor-controls](/docs/ja/reference/editor-controls/).
