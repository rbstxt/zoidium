---
title: Material+ でオブジェクトをシェーディングする
sidebar:
  label: Material+ と Node Material
---
3D オブジェクトに Material+ マテリアルを割り当てます。

## マテリアルを選択する

1. ネイティブプロパティパネルでオブジェクトのマテリアルを選択します。
2. シーンのライティングと個別のテクスチャマップを使うには、PBR+ を選択します。
3. Color、Roughness、および Metalness を設定します。
4. 表面にテクスチャが必要な場合は、対応するマッププロパティで画像を選択します。
5. 共通の Wrap、Repeat、Offset、Center、および Rotation コントロールを調整します。

陰影を付ける視点依存の画像を使うには、Matcap を選択します。ライティングのない画像を使うには、Image+ を選択します。Material+ の UV レイアウトでネイティブの Custom Material コントロールを維持するには、UV Custom を選択します。

## Color Ramp を追加する

1. **Color Ramp** を **on** にします。
2. **Color Ramp Curve** のグラデーションを編集します。
3. **Color Ramp Source** でランプの入力を選択します。
4. **Color Ramp Interpolation** と **Color Ramp Factor** でベースカラーへの混ぜ方を設定します。

## ノードマテリアルを作成する

1. **Node Material** を選択します。
2. **Open Node Editor** をクリックします。
3. 検索可能なメニューからノードを追加します。
4. ノードを **Output** に接続します。
5. **Bake Resolution** を選択します。
6. メインビューポートでマテリアルを確認します。

PBR+ グラフでは、エディターを開く前に **Use node graph** を有効にします。画像ノードでは、**Selected node image** を使用してアセットを選択します。スターターマテリアルを試すには、レシピを選択します。元に戻すと、直前のグラフが復元されます。

コントロールのリファレンス: [material-plus](/docs/ja/reference/material-plus/), [material-nodes](/docs/ja/reference/material-nodes/).
