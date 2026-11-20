---
title: Plexus
description: 基本形状、画像、パス、OBJ から 3D 点群を作り、線・面・三角形分割・ビームと音声連動エフェクターで描画します。
---
**Plexus** (**Rowbyte & Red Giant Suite** 内) は、3D 点群を生成してエフェクターで変形し、点・線・面・三角形分割・ビームで結んで描画する 3D オブジェクトです。

## Plexus を追加する

1. **Plugins** で **Rowbyte & Red Giant Suite** を有効にします。
2. シーンの **Objects** ピッカーから **Plexus** を追加します。
3. デザイナーウィンドウを開くか、Properties パネルで **Geometry**、**Effector**、**Renderer** を調整します。

以下の表で `—` は範囲指定なしを示します。

## Object

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Enabled** | 選択肢 | **off**, **on** | **on** | このブロックを有効化。 |

## Geometry

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Geometry type** | 選択肢 | **layers**, **paths**, **obj**, **primitives**, **instances**, **slicer** | **instances** | 点群の生成元。 |
| **Primitive** | 選択肢 | **box**, **sphere**, **cylinder**, **plane**, **ring** | **box** | プリミティブ点群の形状。 |
| **Count** | 数値 | `0` ～ `60000` | `200` | 生成する点数。 |
| **Size** | 3D ベクトル | ≥ 0 | `[500, 500, 500]` | 点群のサイズ。 |
| **Position** | 3D ベクトル | — | `[0, 0, 0]` | 位置 (シーン単位)。 |
| **Path turns** | 数値 | `0` ～ `10` | `3` | プロシージャルパスの周回数。 |
| **Layer** | アセット | `image/*` | なし | 点群に使う画像ソース。 |
| **OBJ file** | アセット | `.obj` | なし | 読み込む OBJ ジオメトリ。 |
| **Random seed** | 数値 | — | `0` | 再現可能な乱数シード。 |

## Effector

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Effector type** | 選択肢 | **noise**, **spherical field**, **container**, **transform**, **color map**, **shade**, **sound** | **noise** | 点群へ適用する処理。 |
| **Amount** | 数値 | — | `100` | エフェクター全体の強さ。 |
| **Noise amount** | 数値 | — | `40` | ノイズ変位の振幅。 |
| **Noise scale** | 数値 | ≥ 0.0001 | `1` | ノイズの空間スケール。 |
| **Strength[%]** | 数値 | — | `50` | 球状フィールドの強さ (%)。 |
| **Radius** | 数値 | ≥ 0 | `300` | 球状フィールドの半径。 |
| **Position** | 3D ベクトル | — | `[0, 0, 0]` | 位置 (シーン単位)。 |
| **Container size** | 3D ベクトル | ≥ 0 | `[500, 500, 500]` | コンテナーの寸法。 |
| **Transform scale** | 数値 | — | `100` | 点群の拡大率 (%)。 |
| **Transform rotation** | 3D ベクトル | — | `[0, 0, 0]` | 点群の回転 (度)。 |
| **Color map by** | 選択肢 | **index**, **height**, **distance** | **index** | **Color** と **Color 2** のブレンド基準。 |
| **Color**, **Color 2** | RGB カラー | `0` ～ `1` | `[1, 1, 1]`, `[0, 0.3, 1]` | 1 番目と 2 番目の点カラー。 |
| **Audio layer** | アセット | `audio/*`, `video/*` | なし | オフライン音声解析用の音声・動画アセット。 |
| **Audio offset (seconds)** | 数値 | ≥ 0 | `0` | 解析ウィンドウの遅延 (秒)。 |
| **Audio trim in (seconds)** | 数値 | ≥ 0 | `0` | 解析開始メディア時刻 (秒)。 |
| **Audio trim out (seconds)** | 数値 | ≥ 0 | `0` | 解析終了メディア時刻 (秒、`0` で末尾まで)。 |
| **Sound strength** | 数値 | ≥ 0 | `100` | 音声エフェクターの強さ。 |

## Renderer

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Renderer type** | 選択肢 | **points**, **lines**, **facets**, **triangulation**, **beams** | **lines** | 描画モード。 |
| **Point size** | 数値 | `0` ～ `10` | `4` | 点の大きさ。 |
| **Line type** | 選択肢 | **distance**, **adjacency**, **shape** | **distance** | 接続方式。 |
| **Max distance** | 数値 | ≥ 0 | `200` | 線を結ぶ最大距離。 |
| **Max connections** | 数値 | `0` ～ `10` | `5` | 1 点あたりの最大接続数。 |
| **Opacity** | 数値 | `0` ～ `100` | `80` | 不透明度 (%)。 |
| **Ambient**, **Diffuse**, **Specular** | 数値 | `0` ～ `100` | `25`, `75`, `0` | 各ライティング寄与 (%)。 |
| **Color** | RGB カラー | `0` ～ `1` | `[1, 1, 1]` | 基準 RGB カラー。 |

## 評価と上限

- **lines** は最大 `12,000` 点、**facets** と **triangulation** は最大 `4,000` 点・`20,000` 三角形まで対応します。
- ジオメトリ読み込みは `16` MiB 超のテキストまたは `500,000` 頂点超のデータを拒否します。
- **Audio layer** が未設定の場合、**sound** エフェクターは内蔵の時間波形を使います。アセットがある場合はオフセット・トリム区間の音声を使います。

関連するスイート機能: [Trapcode Particular](/docs/ja/3d/trapcode-particular/)、[Trapcode Form](/docs/ja/3d/trapcode-form/)、[ライト](/docs/ja/3d/lights/)。
