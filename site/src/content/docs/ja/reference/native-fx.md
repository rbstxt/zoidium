---
title: Native FX リファレンス
description: 22 種類の Native FX エフェクトの一覧と、プロパティのリファレンス。
sidebar:
  label: Native FX リファレンス
  order: 70
---
Native FX は、CM3 の外部拡張レイヤーである Zoidium のエフェクトパックです。
**Plugins** で **Native FX** が有効な場合、22 種類のエフェクトが **Effects** ピッカーの **NATIVE FX** に表示されます。

## エフェクト

| エフェクト | 出力 |
| --- | --- |
| [Radial Blur (Spin)](/docs/ja/reference/native-fx-image/#radial-blur-spin) | 現在の画像を中心点の周囲で対称に回転サンプリングし、ブラーを生成します。 |
| [Color Curves](/docs/ja/reference/native-fx-image/#color-curves) | 共通カーブと赤、緑、青の個別カーブで RGB の明るさを変換します。 |
| [Drop Shadow](/docs/ja/reference/native-fx-image/#drop-shadow) | 入力のアルファを着色し、ずらしてぼかした影を入力の背後に合成します。 |
| [Radial Shadow](/docs/ja/reference/native-fx-image/#radial-shadow) | 点光源から離れる方向に入力を拡大投影し、着色した影を生成します。 |
| [Echo](/docs/ja/reference/native-fx-time/#echo) | 明示的に取得した過去の入力を、不透明度を減衰させながら合成します。 |
| [Time Offset](/docs/ja/reference/native-fx-time/#time-offset) | プロジェクトフレーム単位のオフセットを加えた時刻で、レイヤーの入力を評価します。 |
| [Posterize Time](/docs/ja/reference/native-fx-time/#posterize-time) | 低いフレームレートの時計に合わせて、レイヤーの入力を保持します。 |
| [Time Displacement](/docs/ja/reference/native-fx-time/#time-displacement) | 輝度マップに基づいて、各ピクセルに使用する取得時刻を選択します。 |
| [CC Wide Time](/docs/ja/reference/native-fx-time/#cc-wide-time) | 現在の入力と前後のプロジェクトフレームのサンプルを、平均または加算します。 |
| [Time Difference](/docs/ja/reference/native-fx-time/#time-difference) | 現在の入力と時間をずらした入力の、色またはアルファの差を表示します。 |
| [Color Difference Key](/docs/ja/reference/native-fx-keying/#color-difference-key) | キー色の最大チャンネルと他の 2 チャンネルとの差から、キーイング用のマットを生成します。 |
| [Advanced Spill Suppressor](/docs/ja/reference/native-fx-keying/#advanced-spill-suppressor) | 入力のアルファを維持しながら、キー色の過剰なチャンネル成分を抑制します。 |
| [Key Cleaner](/docs/ja/reference/native-fx-keying/#key-cleaner) | アルファの空間フィルター、コントラスト、色かぶりの補正で、キーイング後の輪郭を調整します。 |
| [Linear Color Key](/docs/ja/reference/native-fx-keying/#linear-color-key) | キー色からの色の距離に基づいて、ピクセルを除去または保持します。 |
| [Radio Waves](/docs/ja/reference/native-fx-generators/#radio-waves) | 発生点から広がる多角形または円の波を描画します。 |
| [Beam](/docs/ja/reference/native-fx-generators/#beam) | 2 点を結ぶ線分に、着色したビームを描画します。 |
| [Numbers](/docs/ja/reference/native-fx-generators/#numbers) | 再現可能な数値、書式付き時刻、日付、または 16 進数を描画します。 |
| [Timecode](/docs/ja/reference/native-fx-generators/#timecode) | 評価時刻を SMPTE タイムコード、フレーム数、またはフィートとフレーム数で描画します。 |
| [CC Page Turn](/docs/ja/reference/native-fx-transitions/#cc-page-turn) | 現在の入力を円筒状の折り目に沿って曲げ、陰影のある裏面を描画します。 |
| [Card Wipe](/docs/ja/reference/native-fx-transitions/#card-wipe) | 現在の入力を格子状のカードに分け、指定した順序で裏返します。 |
| [CC Pixel Polly](/docs/ja/reference/native-fx-transitions/#cc-pixel-polly) | 現在の入力を多角形または四角形の破片に分けて動かします。 |
| [Smart Motion Blur](/docs/ja/reference/smart-motion-blur/) | 小数時刻で取得したシーンをぼかすか、隣接フレームから動きを再構成します。 |

## コントロールと入力

各リファレンスの表は、このパック固有のすべてのプロパティを記載しています。
ベクトルの行の後には、プロパティ定義と同じ **.X** と **.Y** の成分ラベルを記載しています。
**Enabled** は、どのエフェクトでも **on** が既定値で、**off** は処理を無効にします。
共通のレイヤー変形とエフェクトの並び順は、CM3 のコントロールです。

[時間エフェクト](/docs/ja/reference/native-fx-time/)に、取得時刻、クリップの境界、サンプル数の上限を記載しています。
[生成エフェクト](/docs/ja/reference/native-fx-generators/)と[トランジション](/docs/ja/reference/native-fx-transitions/)に、時刻から計算するアニメーションと描画の上限を記載しています。

[OpenZoid Legacy](/docs/ja/reference/openzoid-legacy/)の **Echo (Legacy)** と **Posterize Time (Legacy)** は別のエフェクトです。
[Layer Input](/docs/ja/how-to/use-layer-input/)に、他のトラックを画像入力として使用する方法を記載しています。
