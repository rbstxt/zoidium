---
title: Material+
description: 補正済み UV を備えた PBR+、Node Material、Matcap、UV Custom、Image+ の 5 種類の 3D マテリアルを解説します。
---
**Material+** は 3D オブジェクト向けに 5 種類のマテリアル (**PBR+**、**Node Material**、**Matcap**、**UV Custom**、**Image+**) を追加します。
3D Text や押し出し形状では補正済みの UV レイアウトが自動適用され、前後キャップはテキスト外枠に収まり、側面も歪みなく輪郭に沿って展開されます。

## マテリアルを選んで設定する

1. **Plugins** で **Material+** を有効にします。
2. 3D オブジェクトを選択し、ネイティブ Properties パネルでマテリアルを開きます。
3. 用途に合う種類を選びます。
   - **PBR+:** 物理ベースライティング、各種テクスチャマップ、Color Ramp、Fresnel、セルシェーディング、クリアコート、任意ノードグラフ。
   - **Node Material:** ノードグラフから表面マップをベイクするプロシージャルマテリアル (**Use node graph** が初期値 **on**)。
   - **Matcap:** 視点依存の Matcap 画像で陰影を付ける無照明マテリアル (シーンライトを無視)。
   - **UV Custom:** 標準の Custom Material 構成に Material+ の補正済み UV を組み合わせたマテリアル。
   - **Image+:** 不透明度と UV 調整を持つ無照明画像マテリアル。

### Color Ramp を追加する (PBR+ / Node Material)

1. **Color Ramp** を **on** にします。
2. **Color Ramp Curve** のグラデーションを編集します。
3. **Color Ramp Source** (**luminance**、**u**、**v**) を選びます。
4. **Color Ramp Interpolation** と **Color Ramp Factor** でベースカラーへの合成具合を調整します。

### Node Material を組む

1. **Node Material** を選ぶ (または **PBR+** で **Use node graph** をオンにする)。
2. **Open Node Editor** をクリックします。
3. 検索メニューからノードを追加 (またはレシピを選択) し、**Output** に接続します。
4. **Image** / **Texture** ノードの画像は **Selected node image** で割り当てます。
5. **Bake Resolution** を選び、ビューポートで確認します。**Undo** で前のグラフへ戻せます。

各ノードの入出力と制限は [Material+ ノードリファレンス](/docs/ja/3d/material-nodes/) を参照してください。

## プロパティリファレンス

`—` は範囲指定なしを示します。

### PBR+

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Color** | RGB カラー | `0` ～ `1` | `[1, 1, 1]` | ベースカラーの乗算色。 |
| **Texture (Base color)** | アセット | `image/*` | なし | **Color** と乗算するベースカラー画像。 |
| **Emissive** | RGB カラー | `0` ～ `1` | `[0, 0, 0]` | ライトに依存しない自己発光色。 |
| **Emissive intensity** | 数値 | ≥ 0 | `1` | 発光色とマップの倍率。 |
| **Emissive map** | アセット | `image/*` | なし | 発光を変調する画像。 |
| **Roughness** | 数値 | `0` ～ `1` | `0.5` | 表面の粗さ (低いほど鋭いハイライト)。 |
| **Roughness map** | アセット | `image/*` | なし | 粗さを変調する画像。 |
| **Metalness** | 数値 | `0` ～ `1` | `0` | 非金属と金属のブレンド。 |
| **Metalness map** | アセット | `image/*` | なし | 金属度を変調する画像。 |
| **Normal map** | アセット | `image/*` | なし | 接空間法線マップ画像。 |
| **Normal scale** | 数値 | ≥ 0 | `1` | 法線マップの強さ。 |
| **Alpha map** | アセット | `image/*` | なし | アルファを変調する画像。 |
| **Alpha threshold** | 数値 | `0` ～ `1` | `0` | この閾値未満のピクセルを破棄。 |
| **Reflection** | 選択肢 | **off**, **on** | **off** | **Environment image** 未指定時にシーン環境反射を使用。 |
| **Reflection intensity** | 数値 | ≥ 0 | `1` | 環境反射の倍率。 |
| **Transparency** | 選択肢 | **off**, **on** | **off** | アルファ透過を有効化。 |
| **Opacity** | 数値 | `0` ～ `1` | `1` | 不透明度の倍率。 |
| **Blending** | 選択肢 | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | 背景とのブレンド方式。通常は **Transparency** がオフの間は見た目に変化しません。 |
| **Render side** | 選択肢 | **front**, **back**, **both** | **front** | 描画する面。 |
| **Wrap** | 選択肢 | **none**, **tile**, **reflect** | **tile** | UV 座標のクランプ・繰り返し・反転。 |
| **Repeat** | 2D ベクトル | — | `[1, 1]` | U / V の繰り返し倍率。 |
| **Offset** | 2D ベクトル | — | `[0, 0]` | U / V の平行移動。 |
| **Center** | 2D ベクトル | — | `[0, 0]` | テクスチャ変換の基準点。 |
| **Rotation** | 数値 | — | `0` | テクスチャ回転 (度)。 |

### PBR+ / Node Material 共通のサーフェスコントロール

**Node Material** はこの初期値に加え、**Bump Strength** `1`、**Use node graph** **on** で始まります。

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Bake Resolution** | 選択肢 | **128**, **256**, **512**, **1024**, **2048** | **256** | ベイクする正方形マップの解像度。 |
| **Color** | RGB カラー | `0` ～ `1` | `[1, 1, 1]` | 表面色。 |
| **Luminance Color** | RGB カラー | `0` ～ `1` | `[0, 0, 0]` | 無照明の表面色。 |
| **Color Ramp** | 選択肢 | **off**, **on** | **off** | サーフェスカラーランプを有効化。 |
| **Color Ramp Curve** | グラデーション | 編集可能なストップ | 黒～白 | Color Ramp のカラーストップ。 |
| **Color Ramp Source** | 選択肢 | **luminance**, **u**, **v** | **luminance** | ランプの入力座標。 |
| **Color Ramp Interpolation** | 選択肢 | **linear**, **constant**, **ease** | **linear** | ストップ間の補間方式。 |
| **Color Ramp Factor** | 数値 | `0` ～ `1` | `1` | ランプの合成量。 |
| **Roughness** | 数値 | `0` ～ `1` | `0.5` | 表面の粗さ。 |
| **Metalness** | 数値 | `0` ～ `1` | `0.5` | 金属度。 |
| **Texture** | アセット | `image/*` | なし | **Color** と乗算するベースカラー画像。 |
| **Bump Strength** | 数値 | `0` ～ `2` | `0` | グラフまたはノイズのバンプ強度。 |
| **Bump Noise** | 選択肢 | **off**, **on** | **off** | グラフの Bump 出力の代わりにプロシージャルノイズを使用。 |
| **Bump Noise Scale** | 数値 | `1` ～ `64` | `4` | プロシージャルバンプの模様サイズ。 |
| **Bump MIP Falloff** | 選択肢 | **off**, **on** | **on** | 遠距離のバンプ細部を減衰。 |
| **Fresnel** | 選択肢 | **off**, **on** | **off** | 視線角度に応じた輪郭色付けを有効化。 |
| **Fresnel Color** | RGB カラー | `0` ～ `1` | `[1, 1, 1]` | 輪郭の色。 |
| **Fresnel Power** | 数値 | `0.1` ～ `8` | `4` | 輪郭遷移の鋭さ。 |
| **Fresnel Mix Strength** | 数値 | `0` ～ `1` | `0.7` | Fresnel の合成量。 |
| **Ambient occlusion map** | 選択肢 | **off**, **on** | **off** | 画像ベースのアンビエントオクルージョンを有効化 (シーン形状からの影計算は行いません)。 |
| **Ambient occlusion map texture** | アセット | `image/*` | なし | AO マップ画像。 |
| **Ambient Occlusion Intensity** | 数値 | `0` ～ `1` | `0.5` | AO の強さ。 |
| **Ambient occlusion exponent** | 数値 | `0.01` ～ `8` | `1` | AO マップの指数。 |
| **Ambient Occlusion Color** | RGB カラー | `0` ～ `1` | `[0, 0, 0]` | 遮蔽部の色味。 |
| **Cel Renderer** | 選択肢 | **off**, **on** | **off** | 段階的なトゥーン陰影を有効化。 |
| **Cel Steps** | 数値 | `1` ～ `16` | `4` | 拡散光の階調数。 |
| **Cel Smoothness** | 数値 | `0` ～ `1` | `0.1` | 階調境界の滑らかさ。 |
| **Cel Specular Steps** | 数値 | `1` ～ `32` | `6` | ハイライトの階調数。 |
| **Projection** | 選択肢 | **uv**, **spherical**, **cylindrical**, **cubic** | **uv** | テクスチャ投影方式。 |
| **Projection Translation** | 3D ベクトル | — | `[0, 0, 0]` | 投影座標の平行移動。 |
| **Projection Rotation** | 3D ベクトル | — | `[0, 0, 0]` | 投影座標の回転 (度)。 |
| **Projection Scale** | 3D ベクトル | — | `[1, 1, 1]` | 投影座標の軸別スケール。 |
| **Projection Lock Aspect Ratio** | 選択肢 | **off**, **on** | **off** | X スケールを全軸に適用。 |
| **Reflection Layer** | 選択肢 | **off**, **on** | **off** | クリアコート反射層を有効化。 |
| **Reflection Layer Strength** | 数値 | `0` ～ `1` | `1` | クリアコートの強さ。 |
| **Reflection Layer Opacity** | 数値 | `0` ～ `1` | `1` | クリアコートの不透明度倍率。 |
| **Reflection Layer Roughness** | 数値 | `0` ～ `1` | `0` | クリアコートの粗さ。 |
| **Specular Layer** | 選択肢 | **off**, **on** | **on** | スペキュラー層を有効化。 |
| **Specular Strength** | 数値 | `0` ～ `2` | `1` | スペキュラー強度。 |
| **Specular Opacity** | 数値 | `0` ～ `1` | `1` | スペキュラー不透明度倍率。 |
| **Global Reflection Brightness** | 数値 | `0` ～ `2` | `1` | 反射全体の明るさ倍率。 |
| **Emission strength** | 数値 | ≥ 0 | `1` | ノードグラフ RGB Emission の強さ。 |
| **Clearcoat**, **Clearcoat roughness** | 数値 | `0` ～ `1` | `0` | **Reflection Layer** がオフのときのクリアコート設定。 |
| **Reflectivity** | 数値 | `0` ～ `1` | `0.5` | 非金属の反射率。 |
| **Environment image** | アセット | `image/*` | なし | 正距円筒図法の環境反射画像 (**Reflection** とは独立してシーン環境を上書き)。最大 4096×2048 の 2 のべき乗サイズが必要で、HDR / EXR は非対応です。 |
| **Environment intensity** | 数値 | ≥ 0 | `1` | 環境画像の倍率。 |
| **Environment rotation** | 数値 | — | `0` | 環境画像の回転 (度)。 |
| **Shadow side** | 選択肢 | **Auto**, **Front**, **Back**, **Double** | **Auto** | 影生成に使う面 (**Auto** は両面マテリアルで **Back** を使用)。 |

### Matcap

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Matcap** | アセット | `image/*` | なし | 視点依存の陰影画像 (シーンライトは影響しません)。 |
| **Color** | RGB カラー | `0` ～ `1` | `[1, 1, 1]` | Matcap 画像に乗算する色。 |
| **Brightness** | 数値 | ≥ 0 | `1` | 明るさ倍率。 |
| **Transparency** | 選択肢 | **off**, **on** | **off** | アルファ透過を有効化。 |
| **Opacity** | 数値 | `0` ～ `1` | `1` | 不透明度倍率。 |
| **Blending** | 選択肢 | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | 背景とのブレンド方式。通常は **Transparency** がオフの間は見た目に変化しません。 |
| **Render side** | 選択肢 | **front**, **back**, **both** | **front** | 描画する面。 |

### UV Custom

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Color** | RGB カラー | `0` ～ `1` | `[1, 1, 1]` | ベースカラー乗算色。 |
| **Emissive** | RGB カラー | `0` ～ `1` | `[0, 0, 0]` | 自己発光色。 |
| **Roughness** | 数値 | `0` ～ `1` | `0.5` | 表面の粗さ。 |
| **Metalness** | 数値 | `0` ～ `1` | `0.5` | 金属度。 |
| **Texture** | アセット | `image/*` | なし | ベースカラー画像。 |
| **Transparency** | 選択肢 | **off**, **on** | **off** | アルファ透過を有効化。 |
| **Opacity** | 数値 | `0` ～ `1` | `1` | 不透明度倍率。 |
| **Blending** | 選択肢 | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | 背景とのブレンド方式。通常は **Transparency** がオフの間は見た目に変化しません。 |
| **Render side** | 選択肢 | **front**, **back**, **both** | **front** | 描画する面。 |
| **Normal map** | アセット | `image/*` | なし | 接空間法線画像。 |
| **Normal scale** | 数値 | ≥ 0 | `1` | 法線マップ強度。 |
| **Wrap** | 選択肢 | **none**, **tile**, **reflect** | **tile** | UV ラップ方式。 |
| **Repeat**, **Offset**, **Center** | 2D ベクトル | — | `[1, 1]`, `[0, 0]`, `[0, 0]` | UV 変換。 |
| **Rotation** | 数値 | — | `0` | テクスチャ回転 (度)。 |
| **Reflection** | 選択肢 | **off**, **on** | **off** | シーン環境反射を使用。 |

### Image+

**Image+** は無照明マテリアルです。**Image** に画像アセットを指定します (初期値は空)。**Transparency**、**Opacity**、**Wrap**、**Repeat**、**Offset**、**Center**、**Rotation**、**Render side** は上の **PBR+** と同じ型・範囲・初期値です。
