---
title: OpenZoid Legacy
description: OpenZoid Legacy の 7 エフェクト (Echo・Posterize Time・Jpeg Damage・VHS・Datamosh・Tracery・ASCII) とセットアップウィンドウの使い方です。
---
**OpenZoid Legacy** は Effects ピッカーの **SETUP LEGACY** に 7 種類の確定的エフェクトを追加します (うち 4 つは専用セットアップウィンドウ付き)。
また、WebM 向けの **True datamosh** 書き出しパスも有効になります ([動画とフレームの書き出し](/docs/ja/workflow/export/#true-datamosh-で書き出す-webm) を参照)。

## エフェクト追加とセットアップウィンドウ

1. **Plugins** で **OpenZoid Legacy** を有効にします。
2. レイヤークリップを選び、Effects ピッカーの **SETUP LEGACY** からエフェクトを追加します。
3. **VHS**、**Datamosh**、**Tracery**、**ASCII** はプロパティ上部のボタン (**Open VHS Setup**、**Open Datamosh Setup**、**Open Tracery Setup**、**Open ASCII Setup**) から専用ウィンドウを開けます。
4. ライブプレビューを見ながらプリセットや各項目を調整し、**Done** で閉じます (編集は即時反映され、**Undo** で戻せます)。

新規の **VHS**、**Jpeg Damage**、**Datamosh** はクリップ内時間 + **Time Offset** (秒) で動きます。保存されたシードでランダム結果が再現され、**Glitch!** (VHS) や **Mosh!** (Datamosh) は 1 回の Undo ステップで新しいシードを保存します。

| エフェクト | 出力 | セットアップウィンドウ |
| --- | --- | --- |
| **Echo (Legacy)** | 過去フレームを明示サンプリングして合成。 | プロパティのみ |
| **Posterize Time (Legacy)** | ソース時間をフレームレート刻みで保持。 | プロパティのみ |
| **Jpeg Damage** | JPEG 圧縮劣化を再現 (元ファイルは変更しません)。 | プロパティのみ |
| **VHS** | テープの色・トラッキング・ノイズ・揺れを再現。 | **Open VHS Setup** |
| **Datamosh** | 事前再生なしで確定的に圧縮崩れを再現。 | **Open Datamosh Setup** |
| **Tracery** | 手動ポイントまたは色検出領域にコールアウトを描画。 | **Open Tracery Setup** |
| **ASCII** | 映像を文字セルへ変換。 | **Open ASCII Setup** |

## Echo (Legacy) と Posterize Time (Legacy)

[Native FX 時間エフェクト](/docs/ja/effects/native-fx/time/) の **Echo** / **Posterize Time** とは別エフェクトです。

- **Echo (Legacy):** 各エコーが 1 プロジェクトフレームずつ過去をサンプルします (上限 `16`)。
  - **Mode:** **smear**, **maximum** (既定), **additive**, **screen**。
  - **Number of Echoes:** `0` ～ `16` (初期値 `6`)。
  - **Decay:** `0` ～ `0.99` (初期値 `0.88`、過去フレームの重み)。
  - **Strength:** `0` ～ `1` (初期値 `1`、元映像との合成量)。
  - **Threshold:** `0` ～ `1` (初期値 `0`)。
- **Posterize Time (Legacy):** **Frame Rate** (`1` ～ `120` FPS、初期値 `8`) で時間サンプリング間隔を落とします (プロジェクトや書き出し FPS は変わりません)。

## Jpeg Damage

**Amount** (`0` ～ `1`、初期値 `1`)、**Quality** (`0.01` ～ `1`、初期値 `0.1`)、**Res Factor** (`1` ～ `8`、初期値 `1`) に加え、以下の項目を持ちます。

| コントロール | 役割 |
| --- | --- |
| **Res Rel X** | 水平解像度比。 |
| **All / X / Y / Low / Mid / High Freq Scale** | 周波数帯域ごとの重み。 |
| **Affect Luma**, **Affect Chroma** | 輝度・色差への劣化強度。 |
| **Error Rate**, **Err Block Density**, **Error Amp**, **Error Coherence** | ブロックエラーの頻度・密度・強度・まとまり。 |
| **Jitter Frames** | ジッターの時間まとめ幅 (`0` ～ `240`)。 |
| **Rand Seed**, **Time Offset** | 再現シードとクロックオフセット。 |
| **Scale Lights**, **Offset Darks**, **Saturation** | 明部・暗部・彩度の調整。 |

## VHS

**Amount** (`0` ～ `1`) で強度、**Roll Speed** (`0` ～ `5`、初期値 `1.5`) で縦ロール速度を調整します。

| グループ | コントロール |
| --- | --- |
| **Master** | **Amount** |
| **Color** | **Signal Strength**, **Color Stripes**, **Chroma Crawl**, **Chroma Loss**, **Flicker**, **RGB Split**, **Blue Screen** |
| **Image** | **VHS Sharpen**, **Interlace**, **Static Warp**, **Fast Forward**, **Tracking**, **Anisotropy Warp**, **Tear**, **Hum Bar**, **Crease**, **Ghost**, **Blinds**, **Snow Dots**, **Speed Dots**, **Anisotropy Snow Dots** |
| **Motion** | **Jitter X**, **Jitter Y**, **Roll**, **Roll Speed**, **Persistence** (過去フレーム合成), **Skew** |
| **Noise** | **Noise Evolution**, **Noise Opacity** |
| **Overlay** | **OSD Timecode** |

**Clean VHS** でクリーンプリセット、**Glitch!** でシード付き劣化パターンを生成します。

## Datamosh

**Look** は **Motion matching** と 80 種のレガシールック、**Motion** は **Identity**、**Scale**、**Vertical**、**Horizontal**、**Zoom**、**Shear**、**Wave**、**Swap**、**Random** から選べます。
静的 (アニメーション不可) プロパティ: **Look**、**Motion**、**I-frame Interval**、**Motion Samples**、**Block Size**、**Seed**。

| プロパティ | 初期値 | 範囲 |
| --- | --- | --- |
| **Amount** | `1` | `0` ～ `1` |
| **I-frame Interval** | `30` | `2` ～ `240` プロジェクトフレーム |
| **Motion Samples** | `4` | `1` ～ `15` |
| **Block Size** | `12` | `2` ～ `64` |
| **Seed** | `0` | `0` ～ `9999` |
| **Remove Frames (Hold)** | `0.15` | `0` ～ `1` |
| **Speed** | `1` | `0` ～ `5` |
| **Time Offset** | `0` | オフセット (秒) |
| **Intensity** | `0.6` | `0` ～ `2` |
| **Acceleration** | `0.35` | `0` ～ `1` |
| **Blend** | `0.8` | `0` ～ `1` |
| **Threshold** | `0.12` | `0` ～ `1` |

セットアップウィンドウには **Master**、**Cadence**、**Motion**、および **How to mosh** ガイドがあります。**Clean Pass** でリセット、**Mosh!** / **Remove Frame** でシードとホールド設定を変更 (**Remove Frame** はタイムラインのフレーム削除や動画改変を行いません)、**New Seed** はシードのみ更新します。このプレビューエフェクトだけを書き出す場合は、**Export > Device** の **True datamosh** を **off** にしてください。

## Tracery

- **色検出 (初期値オン):** **Detection** をオンにして **Key Color** (初期値白)、**Threshold**、**Blur Strength**、**Detection Quality** (**low** / **medium** / **high** 既定 / **extreme**) を調整します。調整中は **Show Mask** をオンにし、書き出し前にオフへ戻してください。**Alpha Layer** でアルファレイヤー出力を選べます。色検出はモーショントラッキング用キーフレームを自動生成しません。
- **手動ポイント:** **Detection** をオフにし、**Point 1** ～ **Point 6** (**Point 1** は中央で初期有効) の位置・サイズ・ラベル・オフセットをキーフレームまたは式で動かします。
- **セットアップグループ:** **Detection**、**Boxes** (**rectangle** / **square** / **ellipse** / **circle**)、**Markers**、**Grid**、**Connections** (**spline** / **pcb traces** / **smooth bend** / **step bend**)、**Labels**、**Points**。

## ASCII

- **グリッドと調子:** **Block size** (`4` ～ `64`、初期値 `23`)、**Character size** (`8` ～ `64`、初期値 `18`)、**Contrast**、**Brightness**、**Background color**。
- **文字と色:** **Character set** (**standard** / **blocks** / **detailed** / **minimal** / **custom** + **Custom characters**)、Black / White / Grey / Alpha バンド (各塗り・線・色・不透明度)、**Color mode** (**band colors** / **footage colors** / **duotone** / **mono** / **invert**)。
- **追加グループ:** **Random**、**Sine waves**、**Advanced noise**、**Scroll**、**Glitch**。フォントは同梱フォントとローカルフォールバックを使用します。
