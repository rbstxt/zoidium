---
title: モーションブラー (Smart Motion Blur / ZSMB)
description: Smart Motion Blur、ZSMB、Camera+ Motion Blur の使い分け、3D シーンやパーティクルへの適用手順、各パラメーターの解説です。
---
Zoidium には動きの種類に応じて選べる 3 つのモーションブラーがあります。

| 方式 | プラグイン | 向いている用途 |
| --- | --- | --- |
| **Smart Motion Blur** | **Native FX** | 3D シーンとパーティクル (**Shutter Samples**)、または実写動画や Adjustment レイヤー (**Optical Flow**)。 |
| **ZSMB (beta 1.0)** | **ZSMB (beta 1.0)** | 解析品質 (`Full` / `1/2` / `1/4` / `1/8`) を選んでプレビューも書き出しも軽く処理できる軽量オプティカルフローブラー。 |
| **Camera Motion Blur** | **Camera+** | 3D シーン内のカメラ移動に特化したシャッターブラー ([Camera+](/docs/ja/3d/camera-plus/) を参照)。 |

## Smart Motion Blur

**Smart Motion Blur** は、小数フレーム時刻でシーンを再描画する **Shutter Samples** と、前後フレームから動きを推定する **Optical Flow** を使い分けます。

### エフェクトの配置場所

- **3D シーン・回転メッシュ・パーティクル:** **Smart Motion Blur** を **3D Scene** クリップ本体に追加し、**Reconstruction** を **Automatic** にします。3D Scene レイヤーでは **Automatic** が自動で **Shutter Samples** を選び、輪郭変化や押し出し面まで正確にぼかします。
- **フッテージ動画:** フッテージクリップ本体に追加します (**Automatic** は **Optical Flow** を選択)。
- **レイヤー自身の Position / Rotation / Scale 移動:** 対象レイヤーの上に **Adjustment** クリップを置いて追加します (エフェクトの入力には自身の最終レイヤー変形が含まれないため)。Adjustment レイヤー越しに高速なレイヤー変形や 3D 回転を直接サンプルしたい場合は、**Reconstruction** を **Shutter Samples** に切り替えてください。

### 設定手順

1. **Plugins** で **Native FX** を有効にします。
2. **3D Scene**、フッテージ、または **Adjustment** クリップを選び、Effects ピッカーの **NATIVE FX** から **Smart Motion Blur** を追加します。
3. 動きのあるフレームへ移動します (前後 1 フレーム送ってパーティクルやオブジェクトが実際に動くことを確認してください。パーティクルが止まっている場合は **Time** にキーフレームを打ちます)。
4. **Blur Amount** を「シャッター角度 ÷ 360」に設定します (`0.5` が 180 度シャッター)。
5. 書き出し前に **View** が **Result** に戻っていることを確認します。

### 調整のコツ

- **Shutter Samples の負荷軽減:** 未キャッシュ 1 フレームあたり **Balanced** で `32` 回、**High** で `64` 回のシーン評価を行います。編集中は [プレビューとキャッシュ](/docs/ja/workflow/preview-and-cache/) の **Pause drawing**、**1/8** / **1/4** 品質、**Render once** を使い、最終確認時だけ **Full quality** にしてください。
- **Optical Flow の調整:** 速い動きを取りこぼす場合は **Motion Sensitivity** または **Max Displacement (px/frame)** を上げます (最大移動量は 1 フレームあたりの実移動ピクセル付近に保ちます)。ベクトルの荒れを抑えるには **Vector Smoothness** を上げ、別方向に動く物体がすれ違う場面では下げます。**View** を **Motion Vectors** や **Confidence** に切り替えて追跡状態を確認したら、必ず **Result** へ戻してください。

### Smart Motion Blur のプロパティ

| プロパティ | 初期値 | 範囲または選択肢 | 意味 |
| --- | --- | --- | --- |
| **Blur Amount** | `0.5` | `0` ～ `1` | プロジェクトフレーム単位の中心シャッター長 (`値 × 360°`)。`0` は無処理。 |
| **Motion Sensitivity** | `70` | `0` ～ `100` | **Max Displacement** に対するオプティカルフロー探索比率。`0` で両モード無効。 |
| **Vector Smoothness** | `50` | `0` ～ `100` | 近傍ベクトル間の平滑化重み。 |
| **Max Displacement (px/frame)** | `256` | `1` ～ `256` | 1 フレームあたりの最大追跡距離 (プロジェクト px)。 |
| **Analysis Frames** | **Both** | **Both**, **Previous**, **Next** | オプティカルフロー解析に使う隣接フレーム (片側指定時は反対側へ速度を反転流用)。 |
| **Quality** | **Balanced** | **Balanced**, **High** | **Balanced** は `32` サンプル、**High** は `64` サンプル。 |
| **View** | **Result** | **Result**, **Motion Vectors**, **Confidence** | 診断ビューは **Reconstruction** に関係なくオプティカルフローで描画されます。 |
| **Reconstruction** | **Automatic** | **Automatic**, **Optical Flow**, **Shutter Samples** | **Automatic** は 3D Scene で **Shutter Samples**、他レイヤーで **Optical Flow** を選択。 |

### Smart Motion Blur の制限

- **Blur Amount** または **Motion Sensitivity** が `0` のとき、あるいは **Optical Flow** で隣接フレームが同一・欠如・カット検出されたときは、入力画像をそのまま出力します。
- **Shutter Samples** はクリップ境界でクランプされ、**Analysis Frames**、**Vector Smoothness**、**Max Displacement**、および正の **Motion Sensitivity** 変更は影響しません。撮影済み動画に中間フレームは増えず、非常に速く細い輪郭ではサンプル縞が出ることがあります。
- **Optical Flow** は全解析フレームで隠れている背景を復元できません。繰り返し模様や同系色の交差で誤追跡することがあり、外部モーションベクトル入力は備えていません。

## ZSMB (beta 1.0)

**ZSMB (beta 1.0)** は隣接フレームを追跡してブラーを再構成する軽量オプティカルフローブラーで、解析解像度を選んでプレビューと書き出しを高速化できます。

### ZSMB の追加と設定

1. **Plugins** で **ZSMB (beta 1.0)** を有効にします。
2. フッテージまたは **3D Scene** クリップを選び、**NATIVE FX** から **ZSMB (beta 1.0)** を追加します。
3. 動きのあるフレームへ移動し、**Blur Amount** を `0` より大きく設定 (既定 `0.5` = 180 度シャッター) し、**Quality** を選びます。

### Quality レベル

**Quality** はプロジェクト幅に対する動き解析の幅を決めます。モーションフィールドは出力フレームに合わせてスケーリングされるため、どのレベルでもブラーの長さと位置は維持されます。

| Quality | 解析幅 | 特徴 |
| --- | --- | --- |
| **Full** | プロジェクト幅 | 基準品質。最も低速。 |
| **1/2** | プロジェクト幅の 1/8 | 既定。**Full** より大幅に高速で実用的な細部。 |
| **1/4** | プロジェクト幅の 1/16 | **1/2** より高速、細部はやや柔らかめ。 |
| **1/8** | プロジェクト幅の 1/32 | 最速レベル。 |

- 解析幅が描画フレーム幅を超えることはありません。プレビューで **Player+** の品質を下げると解析幅もその範囲に抑えられ、プロジェクトより大きい書き出しでもプロジェクト幅を超えて解析しません。
- **Quality** はプロジェクトに保存されます。旧プロジェクトは従来の **Full** または **1/2** の結果を保持します。

### ZSMB のコントロールと制限

- **Blur Amount:** シャッター角度 ÷ `360` (初期値 `0.5`、`0` で無効)。
- **Motion Sensitivity:** `0` ～ `100` (初期値 `70`、`0` でバイパス)。速い動きを取りこぼすときに上げます。
- **Track Frame:** **Previous** (既定) または **Next**。フレーム `0` のみ、前のフレームがないため **Previous** でも次のフレームを使います。
- **Enabled:** **off** にして元の映像と比較できます。
- 品質を下げると細部や **Motion Sensitivity** への反応が **Full** と異なる場合があります。**Full** でも他社製モーションブラーと全クリップで一致する保証はありません。書き出し時は常にネイティブ経路でデコードし、プレビュー時のみ対応が確認されたソースで高速デコーダーを使います。

Contributed by Zoidium contributors.
