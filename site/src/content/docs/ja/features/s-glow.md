---
title: S_Glow でグローを追加する
sidebar:
  label: S_Glow
---
**S_Glow (beta 1.0)** を使用すると、クリップの明るい部分に柔らかいグローを追加できます。このエフェクトは画像をしきい値で分離し、その結果をぼかしてからソースと合成します。

## エフェクトを追加する

1. Plugins で **S_Glow (beta 1.0)** を有効にします。
2. クリップを選択します。
3. Effects ピッカーの **NATIVE FX** から **S_Glow (beta 1.0)** を追加します。
4. 明るい部分だけが光るまで **Threshold** を上げます。

## グローを設定する

- **Brightness** はグローの強さを設定します。**Color** は放出される光の色を設定します。
- **Glow Width** はグローの広がりを画像のピクセル単位で設定します。**Width X** と **Width Y** は横方向と縦方向の広がりを倍率で設定します。
- **Width Red**、**Width Green**、**Width Blue** は色チャンネルごとの広がりを設定します。値を変えると色のにじみが分かれます。
- **Subpixel** はアニメーション中の小数の幅の変化を滑らかにします。
- **Combine** はグローとソースの合成方法を設定します。既定値は **Screen** です。**Source Opacity** はグローの生成量を変えずにソースを薄くします。
- **Glow Under Source** はソースをグローの上に配置します。**Affect Alpha** はグローが不透明度に加える量を設定します。
- **Show** を **Threshold** にすると、結果の代わりにしきい値で分離した画像を表示します。書き出し前に **Result** に戻します。

## 境界を広げる

画像の端を越えるグローはフレームで切り取られます。**Expand Borders** を **on** にすると、グローを生成する前に透明な余白を追加します。最終的な合成では、フレームは引き続き切り取られます。

## ブラーエンジンを選択する

- **AE Match (3-box)** が既定値です。調整された重みで 3 回のボックスブラーを実行します。
- **Performance (legacy)** は高速なブラーを使用します。

**Quality** は両方のエンジンのサンプリング精度を設定します。**Edge Mode** は画像の端の外側をブラーがどのようにサンプリングするかを選択します。

## Atmosphere のコントロールを使用する

**Atmosphere Amp** を 0 より大きくすると、グローにダストと影の構造が加わります。**Atmosphere Freq**、**Atmosphere Detail**、**Atmosphere Seed**、**Atmosphere Speed** はその構造を調整します。**Atmosphere Speed** を 0 にすると構造は停止します。

**Time Mode** を **Automatic** にするとプロジェクトのタイムラインに従います。**Manual** にすると **Time** が表示され、プレイヘッドとは独立して Atmosphere をアニメーションできます。

## 制限

**Brightness** と **Glow Width** を非常に大きくすると GPU の負荷が増え、高い **Quality** ではプレビューが遅くなることがあります。長いレンダーの前に、書き出しフレームで結果を確認します。

提供: MOUSEIIIIII
