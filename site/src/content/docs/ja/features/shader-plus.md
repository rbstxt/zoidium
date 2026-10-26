---
title: Shader+ でシェーダーコントロールを追加する
sidebar:
  label: Shader+
---
ネイティブの Custom Shader エフェクトに型付きコントロールを追加します。

1. Plugins で **Shader+** を有効にします。
2. クリップにネイティブの Custom Shader エフェクトを追加します。
3. **Shader properties** を開きます。
4. **+** をクリックします。
5. **ZOIDIUM** の下にある種類を選択します。
6. プロパティの名前を設定します。
7. コードエディターを開きます。
8. 一致する uniform を宣言します。
9. **Apply** をクリックします。

最初のエフェクトを作成する場合は、[パススルーシェーダーを作成する](/docs/ja/shaders/basics/) に従います。各コントロールの宣言については、[プロパティの種類ごとの例](/docs/ja/shaders/kind-examples/) を参照します。補完、診断、Declare、テンプレートには、[シェーダーの編集とチェック](/docs/ja/shaders/editor/)を使います。

[プロパティコントロール](/docs/ja/development/shader-properties/) では設定と保存フォーマットについて説明しています。[Shader+ の互換性](/docs/ja/development/project-compatibility/#shader-のプロパティ種類)では、テクスチャおよび配列プロパティに対するプラグインの要件について説明しています。
