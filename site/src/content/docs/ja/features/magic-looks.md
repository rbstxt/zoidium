---
title: Magic Looks で画像をグレーディングする
sidebar:
  label: Magic Looks
---
カラー、ライト、およびレンズツールの順序付けられたチェーンを構築します。

1. Plugins で **Magic Looks** を有効にします。
2. **COLOR** からそのエフェクトを追加します。
3. **Open Magic Looks Setup** をクリックします。
4. **Category** を選択します。
5. **Add tool** をクリックします。
6. 選択したインスタンスのネイティブパラメータ行を編集します。
7. 行をドラッグしてツールの順序を変更します。

同じアニメーションを持つ別のインスタンスを作成するには、**Duplicate** をクリックします。インスタンスを削除するには、**Remove** をクリックします。キーボードで操作する場合は、ドラッグの代わりに Move up または Move down を使用します。

既存のアニメーションが必要な場合は、ルックプリセットを適用する前にプロジェクトを保存します。プリセットはチェーンの値とアニメーションをリセットします。インスタンスの識別情報と順序を維持したままニュートラルな値に戻すには、**Clear look** を選択します。

LUT を適用するには、LUT ツールを追加し、そのインスタンスで 3D の `.cube` ファイルをインポートします。

[Magic Looks ソースコントラクト](https://github.com/rbstxt/zoidium/blob/dev/plugins/magic-looks/README.md)に、LUT の制限とマルチパスの要件が記載されています。[Magic Looks の互換性](/docs/ja/development/project-compatibility/#magic-looks)に、過去のレンダラーと新しいインスタンスチェーンについて記載されています。

[Color Curves のプロパティ](/docs/ja/reference/native-fx-image/#color-curves)に、RGB カーブを直接調整する別の Native FX フィルターを記載しています。

コントロールのリファレンス: [magic-looks](/docs/ja/reference/magic-looks/).
