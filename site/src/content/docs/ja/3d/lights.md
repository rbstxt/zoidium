---
title: ライト (Light+ / Trapcode Lights)
description: Light+ によるネイティブ 3D ライトと、Rowbyte & Red Giant Suite の Trapcode Lights (Area・Sun・IES・Portal 等) の使い分けとコントロール一覧です。
---
3D シーンのライト拡張には 2 つのプラグインがあります。ネイティブ CM3 ライトを扱う **Light+** と、減衰・ペナンブラ・色温度・IES プロファイルを備えた **Trapcode Lights** (**Rowbyte & Red Giant Suite** 内) です。

両方を同時にオンにすると 3D ピッカーに 2 系統のライトメニューが並ぶため、迷わないよう使う側だけを有効にしておくのがおすすめです。
なお、**Single Color**、**Image+**、**Matcap** マテリアルは無照明のためライトに反応しません。

## Light+ (ネイティブライト)

1. **Plugins** で **Light+** を有効にします。
2. シーンの 3D オブジェクトピッカーで **Light+** を開きます。
3. **Spot light**、**Point light**、**Directional light**、または **Hemisphere light** を選びます。
4. ネイティブの Properties パネルで **Position**、**Target**、**Color** (または **Sky color** / **Ground color**)、**Intensity**、**Angle** を調整します。

### Light+ の種類

| ピッカー名 | 表示コントロール |
| --- | --- |
| **Spot light** | **Position**, **Target**, **Color**, **Intensity**, **Angle**, **Cast shadows** |
| **Point light** | **Position**, **Color**, **Intensity**, **Cast shadows** |
| **Directional light** | **Position**, **Target**, **Color**, **Intensity**, **Cast shadows** |
| **Hemisphere light** | **Sky color**, **Ground color**, **Intensity** |

Spot、Point、Directional の初期 **Position** は `[0, 100, 100]` で、**Cast shadows** は初期値 **on** (静的スイッチ。影が不要なライトはオフにして負荷を下げられます)。Hemisphere には **Position** と **Target** 行がありません。

## Trapcode Lights (Rowbyte & Red Giant Suite)

1. **Plugins** で **Rowbyte & Red Giant Suite** を有効にします。
2. シーンの 3D オブジェクトピッカーで **Trapcode Lights** を開きます。
3. 以下の 8 種類からライトを追加します。測光データを取り込むには、**Photometric IES Light** を選び、**IES File** で `TILT=NONE` のローカル LM-63 Type C `.ies` ファイルを選択します。

| ピッカー名 | 表示コントロール |
| --- | --- |
| **Point Light (Omni)** | **Position**, **Color**, **Intensity**, **Distance**, **Decay** |
| **Spot Light** | **Position**, **Target**, **Color**, **Intensity**, **Angle**, **Penumbra**, **Distance**, **Decay** |
| **Infinite Light (Directional)** | **Position**, **Target**, **Color**, **Intensity**, **Temperature (K)**, **Shadow Softness**, **Shadow Coverage** |
| **Area Light** | **Position**, **Target**, **Color**, **Intensity**, **Width**, **Height** |
| **Hemisphere Light (Sky/Ground)** | **Sky color**, **Ground color**, **Intensity** |
| **Photometric IES Light** | **Position**, **Target**, **Color**, **Intensity**, **Angle**, **Penumbra**, **Distance**, **Decay**, **IES Profile**, **IES File** |
| **Sun (Directional)** | **Target**, **Color**, **Intensity**, **Sun Azimuth**, **Sun Elevation** |
| **Portal Light** | **Position**, **Target**, **Color**, **Intensity**, **Width**, **Height** |

### Trapcode Lights の仕様と制限

- **IES プロファイル:** **Photometric IES Light** は `TILT=NONE` の LM-63 Type C 形式ローカル `.ies` ファイルに対応し、角度別の配光強度を変えます。非対応ファイルは以前のプロファイルを維持します。
- **Area / Portal ライト:** 矩形エミッターを使用します (パストレーシングによる間接光は計算しません)。
- **影:** **Cast shadows** の初期値は Spot / Point / Infinite / Sun で **on**、Area / Portal / IES で **off** です。Area と Portal では矩形の中央サンプルから影を落とします。

## コントロールリファレンス

`—` は範囲指定なしを示します。

### 共通ライトコントロール

| コントロール | 型 | 範囲 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Position** | 3D ベクトル | — | `[0, 100, 100]` (Light+) / `[0, 10, 0]` (Suite) | ライト位置 (シーン単位)。 |
| **Target** | 3D ベクトル | — | `[0, 0, 0]` | 指向性・スポットライトの照射先。 |
| **Color** | RGB カラー | `0` ～ `1` | `[1, 1, 1]` | ライトの RGB カラー。 |
| **Sky color** | RGB カラー | `0` ～ `1` | `[1, 1, 1]` | 上半球の色。 |
| **Ground color** | RGB カラー | `0` ～ `1` | `[1, 1, 1]` | 下半球の色。 |
| **Intensity** | 数値 | `0` ～ `100` | `1` | 光量の倍率。 |
| **Angle** | 数値 | `0` ～ `90` | `60` | スポット円錐の角度 (度)。 |

### Trapcode Lights 追加コントロール

| コントロール | 型 | 範囲 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Distance** | 数値 | `0` ～ `5000` | `0` | 照射距離上限 (`0` で制限なし)。 |
| **Decay** | 数値 | `0` ～ `4` | `1` | 距離減衰の指数。 |
| **Penumbra** | 数値 | `0` ～ `1` | `0.5` | スポット輪郭のぼかし量。 |
| **Width**, **Height** | 数値 | `0.1` ～ `200` | `10` | 矩形エミッターの幅と高さ。 |
| **Sun Elevation** | 数値 | `-10` ～ `90` | `45` | 太陽高度 (度)。 |
| **Sun Azimuth** | 数値 | `-180` ～ `180` | `0` | 太陽方位角 (度)。 |
| **Temperature (K)** | 数値 | `1000` ～ `12000` | `6500` | 色温度 (ケルビン)。 |
| **Shadow Softness** | 数値 | `0` ～ `10` | `1` | シャドウマップのフィルタ半径。 |
| **Shadow Coverage** | 数値 | `10` ～ `2000` | `200` | 平行光源シャドウカメラの適用範囲。 |
| **IES Profile** | テキスト | テキスト | `Downlight` | 組み込みまたは読み込み済みの配光プロファイル。 |
| **IES File** | テキスト | テキスト | 空欄 | ローカル `.ies` ファイルの読み込み・削除。 |
