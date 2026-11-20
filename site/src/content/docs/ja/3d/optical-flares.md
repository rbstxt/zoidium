---
title: Optical Flares
description: 3D シーンへレンズフレアを配置し、最大 24 要素のスタック、遮蔽 (Occlude)、カスタムレイヤーテクスチャを調整する方法です。
---
**Optical Flares** を使うと、アクティブなシーンカメラを通して投影される 3D レンズフレアを配置し、専用ウィンドウで最大 24 個のフレア要素を自由に組み合わせられます。

## フレアを追加して配置する

1. **Plugins** で **Optical Flares** を有効にします。
2. シーンの 3D オブジェクトピッカーで **Optical Flares** を開き、**Optical Flares** またはプリセット (**Default Lens Flare**、**Anamorphic Blue**、**Sparkle Burst**、**Cinematic Warm**、**Sci-Fi Plasma**) を追加します。
3. オブジェクトを選択して **Open Optical Flares** をクリックします。
4. **Source** を **Object 3D** のままにし、3D 空間でフレアオブジェクトを動かして光源位置を決めます。

シーン内のライトへ追従させるには **Source** を **Light** にし、同じレイヤー内のライトの 0 始まり番号を **Light index** へ指定します。**Screen (2D)** は旧プロジェクト向けの 2D 固定オフセットです。

## 要素スタックを編集する

レンダラーが処理するのはスタック先頭から最大 `24` 要素までです。`25` 個目以降は描画されません。空のまま保存されたスタックは、開き直しても空のまま維持されます。

1. **Browser > Elements** で要素タイルをクリックしてスタックへ追加します。
2. **Elements** 一覧から要素を選び、**Selected element** で **Size**、**Brightness**、**Position**、**Color** を調整します。
3. 行をドラッグするか **Move Up** / **Move Down** で順序を入れ替えます。
4. 単体確認には **Solo** を使い、書き出し前にすべての **Solo** をオフに戻してください (**Solo** はプロジェクトに保存され書き出しにも影響します)。

## 手前のオブジェクトで隠す・カスタム画像を使う

- **深度による遮蔽:** **Source** で **Occlude** をオンにし、**Fade amount** を設定します (`100` で完全に隠れ、下げると手前のメッシュ越しに透けます)。
- **カスタム要素画像:** **Custom Layers** を開いて **Custom Layer 1** ～ **Custom Layer 3** に画像を指定し、要素の **Shape > Texture** で **Custom 1** ～ **Custom 3** を選びます。

## コントロールリファレンス

以下のラベルは **Optical Flares** ウィンドウ基準です (Properties パネル上のラベルと一部異なる場合があります)。

### Source

3D 光源はアクティブカメラで投影され、カメラ後方または **Edge margin** 外へ出ると消えます。各要素は光源から **Center** を通る軸上に並びます。カメラ距離による拡大率は `0.05` ～ `20` にクランプされます。

| コントロール | 意味と上限 |
| --- | --- |
| **Source** | **Object 3D** (オブジェクト位置)、**Light** (同一レイヤーのライト)、**Screen (2D)** (**2D Position** オフセット)。 |
| **Light index** | 0 始まりのライト番号 (`0` ～ `32`、範囲超過時は最後のライトを使用)。 |
| **Occlude** | 3D 光源を前景ジオメトリで深度テストして遮蔽 (初期値オフ、Screen 光源では無効)。 |
| **Fade amount** | 遮蔽の強さ (`0` ～ `100`)。 |
| **Edge margin** | 画面外フェード幅 (`0` ～ `2` NDC、初期値 `0.25`)。 |
| **Distance falloff** | カメラ距離によるサイズ減衰指数 (`0` ～ `2`、初期値 `0` で無効)。 |
| **Reference distance** | 距離スケーリングの基準距離 (`0.01` ～ `1000`、初期値 `10`)。 |

### Global と Advanced

新規フレアの初期値は **Brightness** `70`、**Scale** `75` です。

| セクション | コントロール | 役割 |
| --- | --- | --- |
| **Global** | **Center**, **Brightness**, **Scale**, **Color**, **Color mode**, **Rotation offset** | 全体配置と色 (**Tint** / **RGB** / **Alpha**)。 |
| **Global** | **Scale offset** | 正の軸方向へ離れるほど要素を縮小。 |
| **Global** | **Evolution**, **Flicker**, **Flicker speed**, **High quality** | 時間アニメーションと描画品質 (Flicker はプロジェクト時間とシードから計算)。 |
| **Advanced** | **Element scale**, **Aspect ratio**, **Blend mode**, **Color**, **Seed** | 共通倍率とブレンド (**Add** / **Screen** / **Normal**)。 |
| **Advanced** | **Scale with distance** | Global の **Scale offset** と同じ共通距離縮小 (どちらか一方で 1 回適用)。 |
| **Advanced** | **Render mode** | **On Black** または **Transparent**。 |

### Selected element

| コントロール | 意味 |
| --- | --- |
| **Type**, **Enabled**, **Solo** | 種類と表示状態。先頭 24 要素のいずれかで **Solo** がオンのとき、その範囲の Solo かつ有効な要素のみ描画されます。 |
| **Color**, **Size**, **Brightness** | 要素ごとの色・サイズ・不透明度 (`0` ～ `100`)。 |
| **Position**, **Rotation**, **Aspect ratio** | フレア軸上の位置 (`-300` ～ `500`)、回転角、縦横比。 |
| **Blend mode** | 要素ごとの **Add** / **Screen** / **Normal**。 |
| **Scale with distance** | 要素単体の軸方向距離縮小 (共通スイッチとは独立)。 |
| **Animate**, **Seed** | 要素アニメーションのオン/オフとシード。 |
| **Shape**: **Texture**, **Illumination**, **Falloff** | テクスチャ (**None**、**Soft**、**Hex**、**Ring**、**Streak**、**Spikes**、**Orbs**、**Custom 1～3**) と形状設定。 |
| **Shape**: **Matte shape**, **Matte start**, **Matte fade** | マット形状とフェード区間。 |

**Animate** は **Sparkle** と **Hoop** のみに作用します。**Falloff** は **Ring** テクスチャのみに作用し、**Illumination** は **None** と **Orbs** には効果がありません。

### 要素カタログ

追加時の初期値一覧です。

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

要素設定、**Solo**、光源設定、カスタムレイヤーはプロジェクトに保存され、並べ替えやリセットは Undo に対応します。お気に入りと **Preview bg** はローカル環境のみに保存されます。
