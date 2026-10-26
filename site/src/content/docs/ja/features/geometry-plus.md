---
title: Geometry+ でメッシュを作成する
sidebar:
  label: Geometry+
---
3D Scene にプロシージャルメッシュを追加します。

1. シーンの **Objects** ピッカーを開きます。
2. **GEOMETRY+** の下にある形状を選択します。
3. 形状の数値プロパティを編集します。
4. マテリアルを割り当てます。

Rounded Box、Polyhedron、Cone、Capsule、Tube、Gear、Helix、または Spline を選択します。中空の円柱を作成するには、Tube を選択して壁の厚さを調整します。スイープパスを作成するには、Spline を選択してそのポイントを編集します。パスに合うよう補間と閉ループのオプションを設定します。

[Material+](/docs/ja/features/material-plus/) は PBR およびノードベースのマテリアルを提供します。[Geometry+ マニフェスト](https://github.com/rbstxt/zoidium/blob/dev/plugins/geometry-plus/manifest.json)に、名前空間付きのオブジェクトタイプと説明が記載されています。

コントロールのリファレンス: [geometry-plus](/docs/ja/reference/geometry-plus/).
