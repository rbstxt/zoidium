---
title: Optical Flares のコントロールと要素
description: 光源の配置、ウィンドウのコントロール、要素の初期値、保存状態と制限。
sidebar:
  label: Optical Flares リファレンス
---
Optical Flares は、要素のスタックを設定できる 3D オブジェクトです。以下のラベルはオプションウィンドウの表記です。プロパティパネルのラベルとは異なる場合があります。

## 光源

| ウィンドウのコントロール | 意味と制限 |
| --- | --- |
| **Source** | **Object 3D** はフレアオブジェクトのワールド位置を使用します。**Light** は同じレイヤー内のライトを使用します。**Screen (2D)** は **2D Position** オフセットを使用します。 |
| **Light index** | 0 始まりのライト番号で、0 から 32 です。大きな番号は最後の利用可能なライトを使います。 |
| **Occlude** | 3D 光源と手前のジオメトリの深度を比較します。初期状態はオフです。画面上の光源では深度による遮蔽を使用しません。 |
| **Fade amount** | 遮蔽の強さで、0 から 100 です。100 では、覆われたピクセルのフレアを完全に隠します。0 では、ジオメトリを通してフレアを表示します。 |
| **Edge margin** | 画面端の外側のフェード領域です。正規化デバイス座標で 0 から 2、初期値は 0.25 です。 |
| **Distance falloff** | カメラからの距離によるサイズ変化の指数で、0 から 2 です。初期値の 0 は、このサイズ変化を無効にします。 |
| **Reference distance** | カメラ距離によるサイズ変化の基準距離で、0.01 から 1000 です。初期値は 10 です。 |

レイヤーの有効なカメラが 3D 光源を投影します。カメラの後ろや、画面端のフェード領域より外側の光源は消えます。要素は光源から **Center** を通る軸に沿って配置されます。

カメラ距離によるサイズ変化は、0.05 倍から 20 倍に制限します。これは以下の要素軸に沿ったサイズ変化のスイッチとは別の設定です。

## 全体と詳細のコントロール

| セクション | ウィンドウのコントロール | 適用範囲 |
| --- | --- | --- |
| **Global** | **Center**、**Brightness**、**Scale**、**Color**、**Color mode**、**Rotation offset** | フレアの配置と全体の外観です。色モードは **Tint**、**RGB**、**Alpha** です。 |
| **Global** | **Scale offset** | 要素軸上の正の距離が増えるほど、要素のサイズを小さくします。 |
| **Global** | **Evolution**、**Flicker**、**Flicker speed**、**High quality** | 時間によるアニメーションと描画のコントロールです。ちらつきはプロジェクト時間とシードに依存します。 |
| **Advanced** | **Element scale**、**Aspect ratio**、**Blend mode**、**Color**、**Seed** | 要素共通の倍率と合成です。合成モードは **Add**、**Screen**、**Normal** です。 |
| **Advanced** | **Scale with distance** | Global の Scale offset と同じ、要素軸に沿った共通サイズ係数を有効にします。どちらかのスイッチで、係数を 1 回だけ適用します。 |
| **Advanced** | **Render mode** | **On Black** または **Transparent** です。 |

新しいフレアの全体の Brightness は 70、Scale は 75 です。保存された値は変更しません。

## 選択した要素

| ウィンドウのコントロール | 意味 |
| --- | --- |
| **Type**、**Enabled**、**Solo** | 要素の種類と表示です。先頭 24 要素のどれかで Solo が有効な場合、その範囲で Solo と Enabled が有効な要素だけを描画します。 |
| **Color**、**Size**、**Brightness** | 要素ごとの色、拡大率、不透明度です。Brightness は 0 から 100 です。 |
| **Position**、**Rotation**、**Aspect ratio** | フレア軸に沿った距離、回転、高さに対する幅です。Position は -300 から 500 を受け付けます。 |
| **Blend mode** | 要素の Add、Screen、Normal 合成です。 |
| **Scale with distance** | 正のフレア軸に沿って、要素ごとのサイズを小さくします。共通のスイッチとは独立しています。 |
| **Animate**、**Seed** | 要素のアニメーション切り替えとシードです。 |
| **Shape**: **Texture**、**Illumination**、**Falloff** | 任意のテクスチャと、その形状コントロールです。 |
| **Shape**: **Matte shape**、**Matte start**、**Matte fade** | マットの形状と境界のコントロールです。 |

Texture の選択肢は **None**、**Soft**、**Hex**、**Ring**、**Streak**、**Spikes**、**Orbs**、**Custom 1**、**Custom 2**、**Custom 3** です。Custom の選択肢は、**Custom Layers** の **Custom Layer 1**、**Custom Layer 2**、**Custom Layer 3** を参照します。

## 要素一覧

これらは要素を追加したときの初期値です。Size と Position はオプションウィンドウのラベルです。

<!-- elements:start -->
| 要素 | Size | Position | Aspect ratio |
| --- | --- | --- | --- |
| **Glow** | 100 | 5 | 1 |
| **Multi Iris** | 60 | 38.5 | 1 |
| **Iris** | 85 | 75 | 1 |
| **Streak** | 90 | 0 | 6 |
| **Shimmer** | 60 | 0 | 1 |
| **Glint** | 55 | 0 | 1 |
| **Spike Ball** | 55 | 0 | 1 |
| **Sparkle** | 70 | 0 | 1 |
| **Ring** | 85 | 120 | 1 |
| **Hoop** | 150 | 95 | 1.8 |
| **Caustic** | 90 | 110 | 1 |
| **Lens Orbs** | 100 | 150 | 1 |
<!-- elements:end -->

## プリセット、制限、保存状態

基本の 5 プリセットは **Default Lens Flare**、**Anamorphic Blue**、**Sparkle Burst**、**Cinematic Warm**、**Sci-Fi Plasma** です。

描画に使用するのは、スタック順で先頭の最大 24 要素です。その範囲を超える要素は描画しません。空で保存したスタックは空のままです。

要素の変更、Solo、光源設定、独自のレイヤーアセットは、プロジェクトの状態です。並べ替えとリセットは取り消しできます。

お気に入りと **Preview bg** の選択は、このマシンに保存されます。プロジェクトや書き出しには影響しません。

手順は [Optical Flares オブジェクトを追加・編集する](/docs/ja/features/optical-flares/)を参照してください。
