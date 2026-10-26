---
title: Node Effect でフィルターを作成する
sidebar:
  label: Node Effect
---
ノードグラフを使用して画像フィルターを作成します。

1. クリップを選択します。
2. Effects ピッカーの **NATIVE FX** の下にある **Node Effect** を追加します。
3. **Open Node Editor** をクリックします。
4. **Layer Color** を **Output** の Color に接続します。
5. Layer Color の Alpha を Output の Alpha に接続します。
6. 出力を確認するには、編集用カメラをオフにします。

アニメーションできる値を公開するには、Parameter ノードを追加して Float、Color、または Vector2 を選択します。Effects でそのチャンネルをアニメーションさせます。パターンをアニメーションさせるには、Time をパターンの Time 入力に接続します。

スターターフィルターを使用するには、**Recipes** から Glow、Chromatic aberration、Displacement by noise、または Duotone を選択します。元に戻すと、以前のグラフとチャンネルが復元されます。

Blur または Edge Detect で以前のグラフの出力を読み取る必要がある場合は、Node Effect を別に重ねます。これらのノードは現在のエフェクトの入力画像をサンプリングします。

[Node Effect のソースコントラクト](https://github.com/rbstxt/zoidium/blob/dev/plugins/node-effect/README.md)では、サンプリング、アルファ、パラメーター、制限について説明しています。[Node Effect の互換性](/docs/ja/development/project-compatibility/#node-effect)では、保存された GLSL とグラフのメタデータについて説明しています。

[Native FX リファレンス](/docs/ja/reference/native-fx/)に、同じ **NATIVE FX** カテゴリーの既製フィルターについて記載しています。

コントロールのリファレンス: [node-effect](/docs/ja/reference/node-effect/).
