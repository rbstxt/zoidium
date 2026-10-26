---
title: Optical Flares オブジェクトを追加・編集する
description: 3D シーンにフレアを配置し、要素のスタックと光源の遮蔽を調整します。
sidebar:
  label: Optical Flares
---
Optical Flares を使うと、3D シーンにレンズフレアを配置し、専用ウィンドウで構成要素を編集できます。

## 光源を配置する

1. **Plugins** で **Optical Flares** を有効にします。
2. シーンの 3D オブジェクトのピッカーを開きます。
3. **Optical Flares** の下で **Default Lens Flare** または別のプリセットを選択します。
4. フレアのプロパティを選択します。
5. **Open Optical Flares** をクリックします。
6. ウィンドウの **Source** セクションで、**Source** を **Object 3D** のままにします。
7. シーン内でフレアオブジェクトを移動して、光源を配置します。

ライトを光源にするには、**Light** を選び、**Light index** に同じレイヤー内のライトの 0 始まりの番号を設定します。**Screen (2D)** は、旧プロジェクト向けに固定の画面オフセットを光源として維持します。

## 要素のスタックを編集する

描画に使用するのは先頭の最大 24 要素です。それより大きなスタックを作る前に、[要素一覧と制限](/docs/ja/reference/optical-flares/)を確認してください。

1. **Browser** で **Elements** を開きます。
2. 要素のタイルをクリックして追加します。
3. **Elements** の一覧で編集する要素を選択します。
4. **Selected element** で **Size**、**Brightness**、**Position**、**Color** を調整します。
5. 要素だけを確認するには、**Solo** を有効にします。
6. フレア全体の表示に戻すには、すべての **Solo** をオフにします。
7. 行をドラッグするか、**Move Up** と **Move Down** でスタックの順序を変更します。

Solo はプロジェクトに保存され、書き出しにも反映されます。ウィンドウのプレビュー背景は、ローカルの表示設定です。

## ジオメトリの後ろでフレアを隠す

1. **Source** で **Occlude** を有効にします。
2. 深度によって完全に隠すには、**Fade amount** を 100 に設定します。
3. 手前のジオメトリを通してフレアを一部残すには、**Fade amount** を下げます。
4. 光源の前にシーンのオブジェクトを移動して、結果を確認します。

## 要素に独自の画像を使う

1. **Custom Layers** を展開します。
2. **Custom Layer 1**、**Custom Layer 2**、**Custom Layer 3** のいずれかに画像を指定します。
3. 要素を選択します。
4. その要素の **Shape** セクションを展開します。
5. **Texture** を **Custom 1**、**Custom 2**、**Custom 3** のいずれかに設定します。

距離による拡大・縮小、光源の投影、全体のコントロール、保存状態は [Optical Flares リファレンス](/docs/ja/reference/optical-flares/)を参照してください。
