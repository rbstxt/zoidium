---
title: OpenZoid Legacy
---
OpenZoid Legacy は **SETUP LEGACY** に 7 つのエフェクトを追加します。このパックは CM3 を取り巻く外部拡張レイヤーです。

## エフェクトと設定ウィンドウ

| エフェクト | 出力 | 設定の起動行 |
| --- | --- | --- |
| **Echo (Legacy)** | 明示的にサンプリングした過去のフレームを合成します。 | プロパティのみ |
| **Posterize Time (Legacy)** | フレームレートの区間ごとにソース時刻を保持します。 | プロパティのみ |
| **Jpeg Damage** | JPEG の圧縮破損を再現します。 | プロパティのみ |
| **VHS** | テープの色、トラッキング、ノイズ、動きの乱れを再現します。 | **Open VHS Setup** |
| **Datamosh** | ソースフレームのサンプルで圧縮の乱れを再現します。 | **Open Datamosh Setup** |
| **Tracery** | 手動ポイントの注釈や、色で検出した領域のオーバーレイを描画します。 | **Open Tracery Setup** |
| **ASCII** | 入力を文字セルの画像に変換します。 | **Open ASCII Setup** |

設定ウィンドウはエフェクトのプロパティを直接編集し、プレビューはビューポートのままです。**Done** はウィンドウを閉じます。

## Echo (Legacy)

各エコーは、1 つ前のエコーよりさらに 1 プロジェクトフレーム前のソースをサンプリングします。エコー数の上限は 16 です。

| プロパティ | 初期値 | 範囲または選択肢 |
| --- | --- | --- |
| **Mode** | **maximum** | **smear**、**maximum**、**additive**、**screen** |
| **Number of Echoes** | 6 | 0～16 |
| **Decay** | 0.88 | 0～0.99 |
| **Strength** | 1 | 0～1 |
| **Threshold** | 0 | 0～1 |

**Decay** は過去に向かって連続するサンプルの重みを制御します。**Strength** はエコーの結果を元の入力に混ぜます。

## Posterize Time (Legacy)

**Frame Rate** の初期値は 8、エディターでの範囲は 1～120 FPS です。時間方向のサンプリングを変更するものであり、プロジェクトや書き出しのフレームレートは変更しません。

## Jpeg Damage

**Amount** の初期値は 1、範囲は 0～1 です。**Quality** の初期値は 0.1、範囲は 0.01～1 です。**Res Factor** の初期値は 1、範囲は 1～8 です。

| コントロール | 機能 |
| --- | --- |
| **Res Rel X** | 水平方向の解像度比率。 |
| **All Freq Scale**、**X Freq Scale**、**Y Freq Scale**、**Low Freq Scale**、**Mid Freq Scale**、**High Freq Scale** | 周波数の重み。 |
| **Affect Luma**、**Affect Chroma** | 輝度と色の破損の強さ。 |
| **Error Rate**、**Err Block Density**、**Error Amp**、**Error Coherence** | ブロックエラーの分布と強さ。 |
| **Jitter Frames** | ジッターの時間のまとまり。範囲は 0～240。 |
| **Rand Seed** | 再現可能なランダム変化。 |
| **Scale Lights**、**Offset Darks**、**Saturation** | 出力の明暗と色の変更。 |
| **Time Offset** | エフェクトの時計に加えるオフセット。 |

ソースの JPEG ファイルは書き換えません。

## VHS

**Amount** はエフェクトの混合量で、範囲は 0～1 です。**Roll Speed** の範囲は 0～5、初期値は 1.5 です。

| グループ | コントロール |
| --- | --- |
| **Master** | **Amount** |
| **Color** | **Signal Strength**、**Color Stripes**、**Chroma Crawl**、**Chroma Loss**、**Flicker**、**RGB Split**、**Blue Screen** |
| **Image** | **VHS Sharpen**、**Interlace**、**Static Warp**、**Fast Forward**、**Tracking**、**Anisotropy Warp**、**Tear**、**Hum Bar**、**Crease**、**Ghost**、**Blinds**、**Snow Dots**、**Speed Dots**、**Anisotropy Snow Dots** |
| **Motion** | **Jitter X**、**Jitter Y**、**Roll**、**Roll Speed**、**Persistence**、**Skew** |
| **Noise** | **Noise Evolution**、**Noise Opacity** |
| **Overlay** | **OSD Timecode** |

**Persistence** は、明示的にサンプリングした過去のソースフレームを混ぜます。**Clean VHS** は未破損のプリセットを選択します。**Glitch!** は保存済みのシードを変更し、再現可能なテープ破損の値を生成します。

## Datamosh

**Look** には **Motion matching** と 80 個の旧来の項目があります。**Motion** の選択肢は **Identity**、**Scale**、**Vertical**、**Horizontal**、**Zoom**、**Shear**、**Wave**、**Swap**、**Random** です。

| プロパティ | 初期値 | 範囲 |
| --- | --- | --- |
| **Amount** | 1 | 0～1 |
| **I-frame Interval** | 30 | 2～240 プロジェクトフレーム |
| **Motion Samples** | 4 | 1～15 |
| **Block Size** | 12 | 2～64 |
| **Seed** | 0 | 0～9999 |
| **Remove Frames (Hold)** | 0.15 | 0～1 |
| **Speed** | 1 | 0～5 |
| **Time Offset** | 0 | 秒単位の数値オフセット |
| **Intensity** | 0.6 | 0～2 |
| **Acceleration** | 0.35 | 0～1 |
| **Blend** | 0.8 | 0～1 |
| **Threshold** | 0.12 | 0～1 |

**Look**、**Motion**、**I-frame Interval**、**Motion Samples**、**Block Size**、**Seed** はアニメーションできません。

設定ウィンドウはコントロールを **Master**、**Cadence**、**Motion** に分けます。**How to mosh** は操作ガイドです。**Clean Pass** は未破損のプリセットを選択します。**Mosh!** と **Remove Frame** は新しいシードを保存し、シミュレーションのプロパティを変更します。**New Seed** はシードだけを変更します。

**Remove Frame** はシミュレーションの保持量を設定します。タイムラインのフレームやエンコード済みキーフレームは削除しません。別の **True datamosh** 書き出しコントロールが、レンダリング後にエンコード済みキーフレームを削除します。

## Tracery

**Detection** は初期状態でオンです。白が初期値の **Key Color** に一致する領域を検出します。**Threshold**、**Blur Strength**、**Detection Quality** が検出を制御します。品質の選択肢は **low**、**medium**、**high**、**extreme** で、初期値は **high** です。

**Show Mask** は検出マスクを表示します。**Alpha Layer** はアルファレイヤーの出力を選択します。キーの色に一致する部分がなければ、検出領域は生成されません。

設定グループは **Detection**、**Boxes**、**Markers**、**Grid**、**Connections**、**Labels**、**Points** です。ボックス形状は **rectangle**、**square**、**ellipse**、**circle** です。接続の種類は **spline**、**pcb traces**、**smooth bend**、**step bend** です。

手動ポイントは 6 つあります。**Point 1** は初期状態で中央に有効です。各ポイントは位置の百分率、サイズ、ラベル、ラベルのオフセットを持ちます。手動ポイントの動きはキーや式で指定します。色の検出はモーショントラッキングのキーを書き込みません。

## ASCII

**Block size** はセルのグリッドを設定し、初期値は 23、範囲は 4～64 です。**Character size** の初期値は 18、範囲は 8～64 です。**Contrast**、**Brightness**、**Background color** が画像を調整します。

**Character set** は **standard**、**blocks**、**detailed**、**minimal**、**custom** から選択できます。**Custom characters** がカスタム文字列を指定します。Black、White、Grey、Alpha の各バンドには、塗り、線、色、不透明度のコントロールがあります。

**Color mode** は **band colors**、**footage colors**、**duotone**、**mono**、**invert** から選択できます。追加の設定グループには **Random**、**Sine waves**、**Advanced noise**、**Scroll**、**Glitch** があります。

フォントは同梱の Source Code Pro とローカルの代替フォントを使います。

## 時間、シード、保存データ

新しい VHS、Jpeg Damage、Datamosh エフェクトは、クリップ内の時刻に秒単位の **Time Offset** を加えて使います。

保存したシードにより、ランダムな値が再現されます。ランダム化ボタンは新しい値を保存します。

## True datamosh の書き出し

**True datamosh** は初期状態でオフで、7 つのエフェクトとは独立しています。レンダリング後に VP8 または VP9 の WebM データを処理します。成功した場合は `video-moshed.webm` とキーフレーム数の注記を生成します。失敗した場合は、失敗の注記とともに未処理の動画を渡します。**at clip cuts** でカットがない場合は、元のファイルとファイル名が保たれます。

処理中に **Cancel** を実行すると、処理後のファイルも完了ページも渡されません。処理後のファイルでは正確なシークができません。

設定手順は[旧来のエフェクトを使う](/docs/ja/how-to/use-legacy-effects/)を参照してください。書き出しの手順は[True datamosh の書き出し](/docs/ja/how-to/export-true-datamosh/)を参照してください。
