---
title: Motion Paths で動きを編集する
sidebar:
  label: Motion Paths
---
メインプレビューでネイティブの Position キーとタンジェントを移動します。

1. タイムラインでレイヤークリップを選択します。
2. レイヤーのトランスフォームコントロールを有効にするには、**T** を押します。
3. **O** を押すか、ビューポートの **motion paths** ボタンをクリックします。
4. パス上のキーの四角形をクリックします。
5. キーを移動するには、四角形をドラッグします。
6. 動きを曲げるには、黄色のタンジェントハンドルをドラッグします。

3D オブジェクトの場合は、レイヤークリップの代わりに **Objects** でオブジェクトを選択します。Position には、少なくとも 1 つのアニメーション化された軸が必要です。

選択を変更するには、Shift を押しながらクリックします。移動を制限するには、ドラッグ中に Shift を押し続けます。連続性を解除するには、タンジェントを Alt を押しながらドラッグします。隣接するリニアセグメントとベジェセグメントを切り替えるには、キーを Alt を押しながらクリックします。ドラッグをキャンセルするには、Escape を押します。

[Motion Paths のソースコントラクト](https://github.com/rbstxt/zoidium/blob/dev/plugins/motion-path/README.md)では、時間ハンドルと編集制限について説明しています。[Motion Paths の互換性](/docs/ja/development/project-compatibility/#motion-paths)では、ネイティブのキー保存について説明しています。

コントロールのリファレンス: [editor-controls](/docs/ja/reference/editor-controls/).
