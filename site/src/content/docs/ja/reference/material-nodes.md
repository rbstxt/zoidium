---
title: マテリアルのノードのプロパティ
description: ノードのソケット、パラメーターの型、範囲、初期値、グラフの制限。
sidebar:
  label: マテリアルのノード
---
以下は表示される Material+ ノードの一覧です。**Output** への経路がないノードはマテリアルに作用しません。

数値と色のフィールドには入力ソケットもあり、接続すると保存済みの値を置き換えます。テクスチャは数値に輝度、色に RGB を渡します。

表の読み方: **Scale** は模様の周波数です。**Seed** は乱数の種のまき直しです。**Ratio Y** は Y 方向の比率です。**Octaves** はノイズ層の数です。**Brightness** は明るさを調整します。**Contrast** はコントラストを調整します。**Speed X/Y** は模様を毎秒移動します。**Offset X/Y** は座標をずらします。**Scale X/Y** は座標を拡大します。**Rotation** は座標を回転します。**Color 1/2** は最初の 2 色です。**Opacity** は Base 入力への合成量です。**Color** は一定の色です。**Image** は Selected node image で画像を選びます。**Mix** は合成量です。**Value** は数値の入力です。**Factor** は合成の度合いです。**Interpolation** は値の間を補間します。**Type** は模様の種類です。**Distortion** は模様の変形です。Combine ノードでは、**Red**、**Green**、**Blue**、**Hue**、**Saturation**、**Value** の行が成分の値です。— の範囲は自由な値を受け付けます。

シード、寸法、速度、変形、Random Color、Fresnel の入力は、接続したテクスチャの平均値を使います。その他の模様と色の入力はテクスチャをピクセルごとに評価します。


## Output

マテリアルのベイクする表面のチャンネルを受け取ります。

入力: **Color**, **Luminance**, **Emission**, **Normal**, **Roughness**, **Metalness**, **Bump**, **Opacity**, **Fresnel**, **Normal strength**

出力: なし

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Normal input** | 選択肢 | **Tangent-space color**, **Height** | **Tangent-space color** | Normal を接空間の色または高さとして解釈します。 |
| **Normal strength** | 数値 | 0 ～ 8 | `1` | ベイクする法線の細部の強さです。 |


## Noise

シード付きの値ノイズと、相関を分けた RGB ノイズを生成します。

入力: **UV**, **Scale**, **Ratio Y**, **Octaves**, **Seed**, **Brightness**, **Contrast**, **Speed X**, **Speed Y**

出力: **Value**, **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Scale** | 数値 | 1 ～ 64 | `4` | — |
| **Ratio Y** | 数値 | 0.02 ～ 64 | `1` | — |
| **Octaves** | 数値 | 1 ～ 8 | `4` | — |
| **Seed** | 数値 | 0 ～ 9999 | `1` | — |
| **Brightness** | 数値 | 0 ～ 2 | `1` | — |
| **Contrast** | 数値 | 0 ～ 4 | `1` | — |
| **Speed X** | 数値 | -4 ～ 4 | `0` | — |
| **Speed Y** | 数値 | -4 ～ 4 | `0` | — |


## Gradient

入力の係数または座標を2色に変換します。

入力: **Input**, **Base**, **Offset X**, **Offset Y**, **Scale X**, **Scale Y**, **Rotation**, **Opacity**, **Midpoint**, **Color 1**, **Color 2**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Type** | 選択肢 | **linear**, **circular**, **angular**, **diamond** | **linear** | — |
| **Offset X** | 数値 | -1 ～ 1 | `0` | — |
| **Offset Y** | 数値 | -1 ～ 1 | `0` | — |
| **Scale X** | 数値 | 0.05 ～ 8 | `1` | — |
| **Scale Y** | 数値 | 0.05 ～ 8 | `1` | — |
| **Rotation** | 数値 | -180 ～ 180 | `0` | — |
| **Opacity** | 数値 | 0 ～ 1 | `1` | — |
| **Blending mode** | 選択肢 | **normal**, **add**, **subtract**, **multiply**, **screen**, **overlay**, **darken**, **lighten**, **difference**, **soft light**, **dodge**, **burn**, **linear light**, **divide**, **exclusion**, **hue**, **saturation**, **color**, **value** | **normal** | Base と合成する方法です。 |
| **Midpoint** | 数値 | 0.01 ～ 0.99 | `0.5` | グラデーションの色の間の中間点です。 |
| **Color 1** | RGB カラー | — | `[0.1, 0.1, 0.12]` | — |
| **Color 2** | RGB カラー | — | `[1, 1, 1]` | — |


## Color

入力: **Color**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Color** | RGB カラー | — | `[0.8, 0.8, 0.8]` | — |


## Checker

市松模様で2色を交互に配置します。

入力: **UV**, **Scale**, **Color 1**, **Color 2**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Scale** | 数値 | 1 ～ 64 | `8` | — |
| **Color 1** | RGB カラー | — | `[0, 0, 0]` | — |
| **Color 2** | RGB カラー | — | `[1, 1, 1]` | — |


## Image

UV 空間でプロジェクトの画像をサンプリングします。

入力: **UV**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Image** | アセット | プロジェクトアセット | 空欄 | — |


## Texture

座標の投影と変形を使ってプロジェクトの画像をサンプリングします。

入力: **Offset X**, **Offset Y**, **Scale X**, **Scale Y**, **Rotation**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Image** | アセット | プロジェクトアセット | 空欄 | — |
| **Projection** | 選択肢 | **planar**, **polar**, **cylindrical**, **spherical** | **planar** | 画像の座標の投影です。 |
| **Offset X** | 数値 | -1 ～ 1 | `0` | — |
| **Offset Y** | 数値 | -1 ～ 1 | `0` | — |
| **Scale X** | 数値 | 0.05 ～ 8 | `1` | — |
| **Scale Y** | 数値 | 0.05 ～ 8 | `1` | — |
| **Rotation** | 数値 | -180 ～ 180 | `0` | — |


## Fresnel

Output の Fresnel を通じて視線の角度による色を制御します。

入力: **Color**, **Power**, **Mix**

出力: **Value**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Color** | RGB カラー | — | `[1, 1, 1]` | — |
| **Power** | 数値 | 0.1 ～ 8 | `4` | 視線の角度による色の変化の指数です。 |
| **Mix** | 数値 | 0 ～ 1 | `1` | — |


## Mix

A と B を合成します。

入力: **A**, **B**, **Opacity**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Mode** | 選択肢 | **normal**, **add**, **subtract**, **multiply**, **screen**, **overlay**, **darken**, **lighten**, **difference**, **soft light**, **dodge**, **burn**, **linear light**, **divide**, **exclusion**, **hue**, **saturation**, **color**, **value** | **normal** | このノードの処理方法です。 |
| **Opacity** | 数値 | 0 ～ 1 | `1` | — |


## Math

スカラーまたはピクセルごとの算術を計算します。

入力: **A**, **B**, **C / Smoothness**

出力: **Value**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Operation** | 選択肢 | **Add**, **Subtract**, **Multiply**, **Divide**, **Minimum**, **Maximum**, **Power**, **Modulo**, **Absolute**, **Invert**, **Clamp**, **Compare**, **Sine**, **Round**, **Square Root**, **Logarithm**, **Exponent**, **Floor**, **Ceiling**, **Fraction**, **Sign**, **Smooth Minimum**, **Smooth Maximum**, **Snap**, **Wrap**, **Ping-Pong**, **Cosine**, **Tangent**, **Arctan2**, **Greater Than**, **Less Than** | **Add** | 算術または比較の演算です。 |
| **A** | 数値 | — | `0` | 最初の演算対象です。 |
| **B** | 数値 | — | `1` | 2番目の演算対象です。 |
| **C / Smoothness** | 数値 | — | `0.5` | 3番目の演算対象です (滑らかさ、または Wrap の下限)。 |


## Value (Float)

スカラー値を生成します。

入力: **Value**

出力: **Value**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Value** | 数値 | — | `1` | — |


## Sine Wave

正弦波の模様を生成します。

入力: **UV**, **Scale**, **Phase**

出力: **Value**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Scale** | 数値 | 0.25 ～ 64 | `6` | — |
| **Phase** | 数値 | 0 ～ 1 | `0` | 模様の位相のオフセットです。 |
| **Axis** | 選択肢 | **U**, **V** | **U** | 波の方向です。 |


## Marble

変形した大理石の縞を生成します。

入力: **UV**, **Bands**, **Veins**, **Noise Scale**, **Octaves**, **Seed**

出力: **Value**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Bands** | 数値 | 0.25 ～ 32 | `5` | — |
| **Veins** | 数値 | 0 ～ 12 | `3` | 大理石の筋の強さです。 |
| **Noise Scale** | 数値 | 1 ～ 32 | `6` | 大理石の変形のノイズのスケールです。 |
| **Octaves** | 数値 | 1 ～ 8 | `4` | — |
| **Seed** | 数値 | 0 ～ 9999 | `1` | — |


## Ridged Fractal

稜線状のフラクタルノイズを生成します。

入力: **UV**, **Scale**, **Ratio Y**, **Octaves**, **Seed**, **Brightness**, **Contrast**, **Speed X**, **Speed Y**

出力: **Value**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Scale** | 数値 | 1 ～ 64 | `6` | — |
| **Ratio Y** | 数値 | 0.02 ～ 64 | `1` | — |
| **Octaves** | 数値 | 1 ～ 8 | `4` | — |
| **Seed** | 数値 | 0 ～ 9999 | `1` | — |
| **Brightness** | 数値 | 0 ～ 2 | `1` | — |
| **Contrast** | 数値 | 0 ～ 4 | `1` | — |
| **Speed X** | 数値 | -4 ～ 4 | `0` | — |
| **Speed Y** | 数値 | -4 ～ 4 | `0` | — |


## Turbulence

乱流のノイズを生成します。

入力: **UV**, **Scale**, **Ratio Y**, **Octaves**, **Seed**, **Brightness**, **Contrast**, **Speed X**, **Speed Y**

出力: **Value**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Scale** | 数値 | 1 ～ 64 | `6` | — |
| **Ratio Y** | 数値 | 0.02 ～ 64 | `1` | — |
| **Octaves** | 数値 | 1 ～ 8 | `4` | — |
| **Seed** | 数値 | 0 ～ 9999 | `1` | — |
| **Brightness** | 数値 | 0 ～ 2 | `1` | — |
| **Contrast** | 数値 | 0 ～ 4 | `1` | — |
| **Speed X** | 数値 | -4 ～ 4 | `0` | — |
| **Speed Y** | 数値 | -4 ～ 4 | `0` | — |


## Dirt (approx)

手続き型の汚れの細部を生成します。

入力: **UV**, **Scale**, **Ratio Y**, **Octaves**, **Seed**, **Radius**

出力: **Value**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Scale** | 数値 | 1 ～ 64 | `4` | — |
| **Ratio Y** | 数値 | 0.02 ～ 64 | `1` | — |
| **Octaves** | 数値 | 1 ～ 8 | `4` | — |
| **Seed** | 数値 | 0 ～ 9999 | `1` | — |
| **Radius** | 数値 | 0.1 ～ 4 | `1.4` | 周辺のサンプリングまたは汚れの細部の半径です。 |


## RGB Spectrum

波長を RGB に変換します。

入力: **Input**, **Wavelength**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Wavelength** | 数値 | 380 ～ 780 | `550` | Input がない場合は絶対的な波長です。Input がある場合は550 nmに対するずれです。 |


## Gaussian Spectrum

ガウス型のスペクトルを RGB に変換します。

入力: **Input**, **Center nm**, **Width nm**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Center nm** | 数値 | 380 ～ 780 | `550` | Input がない場合はスペクトルの中心です。Input がある場合は550 nmに対するずれです。 |
| **Width nm** | 数値 | 5 ～ 200 | `60` | ガウス型のスペクトルの幅です。 |


## Blackbody

黒体の温度を RGB に変換します。

入力: **Input**, **Kelvin**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Kelvin** | 数値 | 1000 ～ 40000 | `4000` | Input がない場合は絶対温度です。Input がある場合は4000 Kに対するずれです。 |


## Random Color

シード付きの均一なランダムな色を生成します。

入力: **Seed**, **Brightness**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Seed** | 数値 | 0 ～ 9999 | `1` | — |
| **Brightness** | 数値 | 0 ～ 2 | `1` | — |


## Color Correction

入力の色を調整します。

入力: **Input**, **Brightness**, **Contrast**, **Gamma**, **Hue Shift**, **Saturation**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Brightness** | 数値 | 0 ～ 2 | `1` | — |
| **Contrast** | 数値 | 0 ～ 2 | `1` | — |
| **Gamma** | 数値 | 0.1 ～ 4 | `1` | 中間調のガンマの調整です。 |
| **Hue Shift** | 数値 | -180 ～ 180 | `0` | 色相のずれです。 |
| **Saturation** | 数値 | 0 ～ 2 | `1` | 彩度の倍率または成分です。 |


## Colorizer

入力を5色のランプに変換します。

入力: **Input**, **Color 1**, **Color 2**, **Color 3**, **Color 4**, **Color 5**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Color 1** | RGB カラー | — | `[0, 0, 0]` | — |
| **Color 2** | RGB カラー | — | `[0.25, 0.25, 0.3]` | — |
| **Color 3** | RGB カラー | — | `[0.7, 0.7, 0.75]` | ランプの中央の色です。 |
| **Color 4** | RGB カラー | — | `[1, 1, 1]` | ランプの4番目の色です。 |
| **Color 5** | RGB カラー | — | `[1, 1, 1]` | ランプの最後の色です。 |


## Cosine Mix

コサイン補間で A と B を合成します。

入力: **A**, **B**, **Mix**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Mix** | 数値 | 0 ～ 1 | `0.5` | — |


## Projection

投影した UV 座標を生成します。

入力: **Offset X**, **Offset Y**, **Scale X**, **Scale Y**, **Rotation**

出力: **Projection**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Texture Projection** | 選択肢 | **planar**, **polar**, **cylindrical**, **spherical** | **planar** | このノードの処理方法です。 |
| **Offset X** | 数値 | -1 ～ 1 | `0` | — |
| **Offset Y** | 数値 | -1 ～ 1 | `0` | — |
| **Scale X** | 数値 | 0.05 ～ 8 | `1` | — |
| **Scale Y** | 数値 | 0.05 ～ 8 | `1` | — |
| **Rotation** | 数値 | -180 ～ 180 | `0` | — |


## UvW Transform

Input のサンプリングに使う座標を変形します。

入力: **Input**, **Offset X**, **Offset Y**, **Scale X**, **Scale Y**, **Rotation**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Offset X** | 数値 | -1 ～ 1 | `0` | — |
| **Offset Y** | 数値 | -1 ～ 1 | `0` | — |
| **Scale X** | 数値 | 0.05 ～ 8 | `1` | — |
| **Scale Y** | 数値 | 0.05 ～ 8 | `1` | — |
| **Rotation** | 数値 | -180 ～ 180 | `0` | — |


## Color Ramp

Factor を、独立して使える Color と Alpha に変換します。

入力: **Factor**

出力: **Color**, **Alpha**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Factor** | 数値 | 0 ～ 1 | `0.5` | — |
| **Interpolation** | 選択肢 | **Constant**, **Linear**, **Ease**, **Cardinal** | **Linear** | — |
| **Stops** | ランプ | 編集可能なストップ | `Black to white` | 位置付きの RGBA カラーのストップです。 |


## Map Range

範囲間で数値を変換します。

入力: **Value**, **From min**, **From max**, **To min**, **To max**, **Steps**

出力: **Value**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Value** | 数値 | — | `0.5` | — |
| **From min** | 数値 | — | `0` | 変換元の範囲の下限です。 |
| **From max** | 数値 | — | `1` | 変換元の範囲の上限です。 |
| **To min** | 数値 | — | `0` | 変換先の範囲の下限です。 |
| **To max** | 数値 | — | `1` | 変換先の範囲の上限です。 |
| **Interpolation** | 選択肢 | **Linear**, **Stepped**, **Smoothstep**, **Smootherstep** | **Linear** | — |
| **Steps** | 数値 | 1 ～ 1000 | `4` | Stepped の補間の段階数です。 |
| **Clamp** | 選択肢 | **Off**, **On** | **On** | 結果を変換先の範囲に制限します。 |


## RGB Curves

全体の RGB とチャンネルごとのカーブを適用します。

入力: **Color**, **Factor**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Factor** | 数値 | 0 ～ 1 | `1` | — |
| **Curves** | カーブ | 編集可能なストップ | `Identity` | RGB とチャンネルごとのトーンカーブです。 |


## Separate RGB

入力: **Color**

出力: **Red**, **Green**, **Blue**


## Combine RGB

入力: **Red**, **Green**, **Blue**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Red** | 数値 | 0 ～ 1 | `0` | — |
| **Green** | 数値 | 0 ～ 1 | `0` | — |
| **Blue** | 数値 | 0 ～ 1 | `0` | — |


## Separate HSV

入力: **Color**

出力: **Hue**, **Saturation**, **Value**


## Combine HSV

入力: **Hue**, **Saturation**, **Value**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Hue** | 数値 | 0 ～ 1 | `0` | — |
| **Saturation** | 数値 | 0 ～ 1 | `0` | — |
| **Value** | 数値 | 0 ～ 1 | `0` | — |


## Voronoi

セルの距離、色、位置を生成します。

入力: **UV**, **Exponent**, **Smoothness**, **Scale**, **Randomness**, **Seed**, **Speed X**, **Speed Y**

出力: **Distance**, **Color**, **Position**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Feature** | 選択肢 | **F1**, **F2**, **Smooth F1**, **Distance to Edge** | **F1** | 計算する Voronoi の特徴です。 |
| **Distance** | 選択肢 | **Euclidean**, **Manhattan**, **Chebyshev**, **Minkowski** | **Euclidean** | Voronoi の距離の計量です。 |
| **Exponent** | 数値 | 0.1 ～ 16 | `2` | ミンコフスキー距離の指数です。 |
| **Smoothness** | 数値 | 0.001 ～ 1 | `0.5` | Smooth F1 の補間量です。 |
| **Scale** | 数値 | 0.01 ～ 64 | `5` | — |
| **Randomness** | 数値 | 0 ～ 1 | `1` | セルの位置の変動量です。 |
| **Seed** | 数値 | 0 ～ 9999 | `1` | — |
| **Speed X** | 数値 | -4 ～ 4 | `0` | — |
| **Speed Y** | 数値 | -4 ～ 4 | `0` | — |


## Wave

方向付きの縞または輪を生成します。

入力: **UV**, **Scale**, **Distortion**, **Detail**, **Seed**

出力: **Value**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Type** | 選択肢 | **Bands**, **Rings** | **Bands** | — |
| **Direction** | 選択肢 | **X**, **Y**, **Diagonal** | **X** | 波の模様の方向です。 |
| **Profile** | 選択肢 | **Sine**, **Saw**, **Triangle** | **Sine** | 波の輪郭です。 |
| **Scale** | 数値 | 0.01 ～ 64 | `5` | — |
| **Distortion** | 数値 | 0 ～ 20 | `0` | — |
| **Detail** | 数値 | 0 ～ 8 | `2` | 模様の細部の段階です。 |
| **Seed** | 数値 | 0 ～ 9999 | `1` | — |


## Brick

色付きのレンガと目地を生成します。

入力: **UV**, **Scale**, **Width**, **Height**, **Mortar size**, **Row offset**, **Seed**, **Brick 1**, **Brick 2**, **Mortar**

出力: **Color**, **Mortar**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Scale** | 数値 | 0.01 ～ 64 | `5` | — |
| **Width** | 数値 | 0.01 ～ 4 | `1` | レンガの幅です。 |
| **Height** | 数値 | 0.01 ～ 4 | `0.5` | レンガの高さです。 |
| **Mortar size** | 数値 | 0 ～ 0.5 | `0.04` | 目地の幅です。 |
| **Row offset** | 数値 | 0 ～ 1 | `0.5` | 交互のレンガ列のずれです。 |
| **Seed** | 数値 | 0 ～ 9999 | `1` | — |
| **Brick 1** | RGB カラー | — | `[0.6, 0.17, 0.08]` | — |
| **Brick 2** | RGB カラー | — | `[0.3, 0.06, 0.03]` | — |
| **Mortar** | RGB カラー | — | `[0.08, 0.08, 0.08]` | 目地の色です。 |


## Magic

反復する色の模様を生成します。

入力: **UV**, **Scale**, **Depth**, **Distortion**

出力: **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Scale** | 数値 | 0.01 ～ 64 | `5` | — |
| **Depth** | 数値 | 0 ～ 10 | `2` | Magic の反復数です。 |
| **Distortion** | 数値 | 0 ～ 10 | `1` | — |


## White Noise

シード付きのホワイトノイズを生成します。

入力: **UV**, **Scale**, **Seed**

出力: **Value**, **Color**

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Scale** | 数値 | 1 ～ 4096 | `256` | — |
| **Seed** | 数値 | 0 ～ 9999 | `1` | — |


## グラフの制限

グラフの上限は 200 ノードと 400 接続です。循環と、同じ入力への重複した接続は拒否されます。Bake Resolution は 128、256、512、1024、2048 です。書き出しは要求したベイクの完了を待ちます。

[Material+ のプロパティ](/docs/ja/reference/material-plus/)
