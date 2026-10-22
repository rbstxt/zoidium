---
title: Material+ でオブジェクトをシェーディングする
sidebar:
  label: Material+ と Node Material
---
3D オブジェクトに Material+ マテリアルを割り当てます。

## マテリアルを選択する

1. ネイティブプロパティパネルでオブジェクトのマテリアルを選択します。
2. シーンのライティングと個別のテクスチャマップを使用するには、PBR+ を選択します。
3. Color、Roughness、および Metalness を設定します。
4. 表面にテクスチャが必要な場合は、対応するマッププロパティで画像を選択します。
5. 共通の Wrap、Repeat、Offset、Center、および Rotation コントロールを調整します。

シェーディングを提供する視点依存の画像を使用するには、Matcap を選択します。ライティングのない画像を使用するには、Image+ を選択します。Material+ の UV レイアウトでネイティブの Custom Material コントロールを維持するには、UV Custom を選択します。

## ノードマテリアルを作成する

1. **Node Material** を選択します。
2. **Open Node Editor** をクリックします。
3. 検索可能なメニューからノードを追加します。
4. ノードを **Output** に接続します。
5. **Bake Resolution** を選択します。
6. メインビューポートでマテリアルを確認します。

PBR+ グラフの場合は、エディターを開く前に **Use node graph** を有効にします。画像ノードの場合は、**Selected node image** を使用してアセットを選択します。スターターマテリアルを試すには、レシピを選択します。元に戻すを実行すると、直前のグラフが復元されます。

[Material+ ソースコントラクト](https://github.com/rbstxt/zoidium/blob/dev/plugins/material-plus/README.md)に、ノード操作、ベイク、UV レイアウト、およびサーフェスコントロールについて記載されています。[PBR+ の互換性](/docs/ja/development/project-compatibility/#pbr-uv-layout)に、レガシー UV について記載されています。
