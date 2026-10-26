---
title: Light+ で標準ライトを追加する
description: 標準ライトの種類を選び、マテリアルが照明に反応するか確認します。
sidebar:
  label: Light+
---
Light+ を使うと、3D オブジェクトのピッカーからネイティブの CM3 ライトを選べます。

## ライトを追加する

Single Color と Matcap のマテリアルはライトに反応しません。照明の変化を確認するには、照明に反応するマテリアルを使用してください。

1. **Plugins** で **Light+** を有効にします。
2. シーンの 3D オブジェクトのピッカーを開きます。
3. **Light+** を開きます。
4. **Spot light**、**Point light**、**Directional light**、**Hemisphere light** のいずれかを選択します。
5. 位置を持つライトの場合は、標準のプロパティパネルで **Position** を調整します。
6. 同じシーンのオブジェクトで結果を確認します。

## ライトを調整する

1. Spot、Point、Directional ライトでは、**Color** と **Intensity** を設定します。
2. Spot または Directional ライトでは、**Target** を調整してライトを向けます。
3. Spot ライトでは、**Angle** を調整して円錐の幅を変更します。
4. Hemisphere ライトでは、**Sky color**、**Ground color**、**Intensity** を設定します。

Intensity は 0 から 100、Spot の Angle は 0 から 90 度を受け付けます。Hemisphere ライトには Position と Target の行はありません。

## ライトの提供元を選ぶ

Light+ は標準ライトのプロパティを使用します。追加のライトの種類やコントロールを使うには、[Rowbyte & Red Giant Suite](/docs/ja/features/trapcode-suite/) を使用してください。

ライトを選ぶときは、提供元のプラグインのどちらか一方だけを有効にしてください。Light+ とスイートは両方ともライトのピッカー項目を追加し、メニューとコントロールが異なります。

コントロールのリファレンス: [light-plus](/docs/ja/reference/light-plus/).
