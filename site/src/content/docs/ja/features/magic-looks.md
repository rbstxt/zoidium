---
title: Magic Looks で画像をグレーディングする
sidebar:
  label: Magic Looks
---
カラー、ライト、レンズのツールを順序付けたチェーンを作ります。

1. Plugins で **Magic Looks** を有効にします。
2. **COLOR** からそのエフェクトを追加します。
3. **Open Magic Looks Setup** をクリックします。
4. **Category** を選択します。
5. **Add tool** をクリックします。
6. 選択したインスタンスのネイティブパラメータ行を編集します。
7. 行をドラッグしてツールの順序を変更します。

同じアニメーションを持つ別のインスタンスを作成するには、**Duplicate** をクリックします。インスタンスを削除するには、**Remove** をクリックします。キーボードで操作する場合は、ドラッグの代わりに Move up または Move down を使います。

既存のアニメーションを残す必要がある場合は、ルックプリセットを適用する前にプロジェクトを保存します。プリセットはチェーンの値とアニメーションをリセットします。インスタンスの識別情報と順序を維持したままニュートラルな値に戻すには、**Clear look** を選択します。

LUT を適用するには、LUT ツールを追加し、そのインスタンスで 3D の `.cube` ファイルをインポートします。

[Color Curves のプロパティ](/docs/ja/reference/native-fx-image/#color-curves)に、RGB カーブを直接調整する別の Native FX フィルターについて記載しています。

コントロールのリファレンス: [magic-looks](/docs/ja/reference/magic-looks/).
