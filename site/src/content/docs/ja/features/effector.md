---
title: Effector でオブジェクトを複製・変形する
description: 子オブジェクト、リピーター、変形フィールド、破砕、Delay を設定します。Scene+ とも呼ばれます。
sidebar:
  label: Effector
---
**Effector** を使うと、3D オブジェクトのグループを手続き的に複製または変形できます。プラグインのソースディレクトリ名は Scene+ です。

## 元のオブジェクトを子として追加する

1. **Plugins** で **Effector** を有効にします。
2. シーンの 3D オブジェクトのピッカーを開きます。
3. **Effector > Repeater** を選択します。
4. リピーター自身の行の **+** をクリックして、元のオブジェクトを追加します。
5. **Repeater** プロパティセクションで **Count** を設定します。
6. **Position**、**Rotation**、**Scale** を調整して、複製を離します。

最上位に追加したオブジェクトは、同じ階層に並ぶ兄弟になります。オブジェクトに作用させるには、エフェクターの階層内に配置してください。

始点と終点の変換の間に複製を配置するには、**Linear Repeater** を選択します。範囲内に複製を散布するには、**Random Repeater** を選び、**Seed** を設定します。前のフレームを評価した複製には、**Echo Repeater** を選び、**Offset** を設定します。

## フィールドでメッシュを変形する

1. **Effector > Twist** または **Effector > Warp** を追加します。
2. メッシュをそのエフェクターの子として追加します。
3. Twist では **Axis** と **Angle** を調整します。Warp では **Axis** と **Strength** を調整します。
4. 作用する領域を制限するには、**Field** を **infinite** から **box** または **sphere** に変更します。
5. **Field position**、**Field rotation**、**Field scale**、**Falloff** を調整します。
6. 曲げるための形状が不足する場合は、[メッシュの制限](/docs/ja/reference/effector/)の範囲内で **Subdivision** を増やします。

エフェクターの変換が、ローカルの軸とフィールドの座標系を定義します。

## ビューポートでフィールドを編集する

1. 編集用カメラが有効な状態で、エフェクターを 1 つ選択します。
2. **Field position** の横で **Edit field in viewport** を有効にします。
3. ドラッグして、カメラ平面上でフィールドを移動します。
4. フィールドを回転するには、中心の周囲を Shift キーを押しながらドラッグします。
5. フィールドを均等に拡大・縮小するには、Alt キーを押しながら右または上にドラッグします。
6. Escape キーでモードを終了します。ドラッグ中の場合は、その操作を取り消します。

## メッシュを破片に分割する

密度の高いメッシュの場合は、セル数を増やす前に[破砕の制限](/docs/ja/reference/effector/)を確認してください。

1. **Effector > Voronoi Fracture** を追加します。
2. 閉じたメッシュをその子として追加します。
3. **Cells**、**Seed**、**Distribution** を設定します。
4. 切断面を閉じるには、**Inner faces** を **closed** に設定します。
5. **Distance**、**Scatter**、**Spin** のいずれかをアニメーションさせて、破片を離します。
6. メッシュ全体に順番に動きを与えるには、**Field > linear** を選び、**Sweep** をアニメーションさせます。

文字を選択する場合は、先に **Text+** を有効にしてください。**Characters** に `1,3-5` のような 1 始まりの範囲を入力します。ほかの文字に作用させるには、**Invert selection** を使用します。

## 各部分の動きを遅らせる

1. **Effector > Plain** を追加します。
2. Plain の子として **Delay** を追加します。
3. Delay の中に元のオブジェクトを追加します。
4. Plain の **Position offset**、**Rotation offset**、**Scale offset** のいずれかをアニメーションさせます。
5. Delay で **Mode** を選び、**Strength** と **History frames** を調整します。

この階層により、Delay は上流の Plain の動きをサンプリングできます。正確なコントロール、処理予算、旧プロジェクトの動作は [Effector リファレンス](/docs/ja/reference/effector/)を参照してください。
