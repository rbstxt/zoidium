---
title: S_Glow
description: チャンネル別の広がり、境界拡張、ブラーエンジン選択、アトモスフィア調整を備えた高精度グローエフェクトです。
---
**S_Glow (beta 1.1)** は、しきい値を超える明るい部分を抽出してぼかし、元映像の前または後ろに合成するグローエフェクトです。

## S_Glow を追加する

1. **Plugins** で **S_Glow (beta 1.1)** を有効にします。
2. クリップを選び、Effects ピッカーの **NATIVE FX** から **S_Glow (beta 1.1)** を追加します。
3. 光らせたいハイライトだけが残るよう **Threshold** を上げます。
4. 発光元だけを確認したいときは **Show** を **Threshold** に切り替え、書き出し前に必ず **Result** へ戻してください。

## グローと合成コントロール

- **Brightness** / **Color:** 発光の強さと色味を設定します。
- **Glow Width** / **Width X** / **Width Y:** ピクセル単位の広がりと、横・縦方向の倍率を設定します。
- **Width Red** / **Width Green** / **Width Blue:** RGB チャンネルごとの広がりを変えて色収差のような縁取りを作れます。
- **Subpixel:** アニメーション時の小数幅変化を滑らかにします。
- **Combine** / **Source Opacity:** 元映像との合成モード (既定 **Screen**) と、グローを弱めずに元映像だけ薄める不透明度を設定します。
- **Glow Under Source** / **Affect Alpha:** グローを元映像の背面に配置し、グローがアルファへ加える量を調整します。
- **Expand Borders:** **on** にするとぼかし前に透明余白を追加し、クリップ端でグローが途切れるのを防ぎます (最終コンポジションの枠では引き続きクリップされます)。ヘッダーの目のボタンで **S_Glow** をオフにした場合、余白拡張もスキップされます。詳しくは [エフェクトのバイパス](/docs/ja/effects/bypass/) を参照してください。

## ブラーエンジンとアトモスフィア

- **ブラーエンジン:** 既定の **AE Match (3-box)** は校正済み 3 パスのボックスブラーを実行し、**Performance (legacy)** はより高速なパスを使います。**Quality** は両エンジンのサンプリング精度、**Edge Mode** は画面外のサンプリング方式を決めます。
- **アトモスフィア:** **Atmosphere Amp** を `0` より大きくすると、**Atmosphere Freq**、**Atmosphere Detail**、**Atmosphere Seed**、**Atmosphere Speed** (`0` で静止) による塵や影の揺らぎが加わります。**Time Mode** は **Automatic** でタイムライン連動、**Manual** にすると **Time** が表示されて独立アニメーションできます。

## 負荷の注意

非常に大きな **Brightness** と **Glow Width**、および高い **Quality** は GPU 負荷が高くなりプレビューが遅くなります。長時間の書き出し前に代表フレームで確認してください。

Contributed by MOUSEIIIIII.
