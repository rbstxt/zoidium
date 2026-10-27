---
title: Expressions+ でプロパティをリンクする
sidebar:
  label: Expressions+
---
ネイティブの動的プロパティにエクスプレッションソースを追加します。

1. Plugins で **Expressions+** を有効にします。
2. プロパティのアニメーションボタンを Alt クリックします。
3. エディターにエクスプレッションを入力します。
4. エクスプレッションを適用します。
5. 再生ヘッドを移動して、評価された値を確認します。

構文、プロパティのナビゲーション、Sequence Controls、またはカメラリンクを選択するには、[エクスプレッションリファレンス](/docs/ja/development/expressions/) を使用します。コントロールの名前変更や並べ替え後もリンクを維持する必要がある場合は、生成されたコントロールリンクを使用します。

シェーダーのノイズ、ハッシュ、カラー、符号付き距離のヘルパーを使う場合は、[シェーダーの include](/docs/ja/reference/shader/#include) を使う前に Expressions+ を有効にします。

[エクスプレッションの互換性](/docs/ja/development/project-compatibility/#expressions)に、保存されるソースとフォールバック値について記載されています。

コントロールのリファレンス: [sequence-controls](/docs/ja/reference/sequence-controls/).
