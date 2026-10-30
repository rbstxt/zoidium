---
title: Material+ のプロパティ
description: マテリアルのスロット、マップ、UV 変形、物理的な表面のコントロール、環境の制限。
sidebar:
  label: Material+ リファレンス
---
Material+ は **Matcap**、**PBR+**、**UV Custom**、**Node Material**、**Image+** を登録します。表は新しいマテリアルの初期値を示します。保存済みのプロジェクトは異なる値を保持する場合があります。


## PBR+

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | ベースカラーの倍率です。 |
| **Texture (Base color)** | アセット | image/* | なし | Color を掛けるベースカラー画像です。 |
| **Emissive** | RGB カラー | 0 ～ 1 | `[0, 0, 0]` | 照明に依存しない表面の色です。 |
| **Emissive intensity** | 数値 | ≥ 0 | `1` | 発光色と発光マップの倍率です。 |
| **Emissive map** | アセット | image/* | なし | 発光を変調する画像です。 |
| **Roughness** | 数値 | 0 ～ 1 | `0.5` | 表面の粗さです。低い値ほどハイライトが鋭くなります。 |
| **Roughness map** | アセット | image/* | なし | 粗さを変調する画像です。 |
| **Metalness** | 数値 | 0 ～ 1 | `0` | 誘電体と金属の表面の反応の合成量です。 |
| **Metalness map** | アセット | image/* | なし | 金属度を変調する画像です。 |
| **Normal map** | アセット | image/* | なし | 接空間の法線画像です。 |
| **Normal scale** | 数値 | ≥ 0 | `1` | 読み込んだ法線画像の強さです。 |
| **Alpha map** | アセット | image/* | なし | 表面のアルファを変調する画像です。 |
| **Alpha threshold** | 数値 | 0 ～ 1 | `0` | このアルファ値未満の断片を破棄します。 |
| **Reflection** | 選択肢 | **off**, **on** | **off** | Environment image の指定がない場合にシーンの環境マップを使います。 |
| **Reflection intensity** | 数値 | ≥ 0 | `1` | 環境の反射の倍率です。 |
| **Transparency** | 選択肢 | **off**, **on** | **off** | アルファの透過を有効にします。 |
| **Opacity** | 数値 | 0 ～ 1 | `1` | 不透明度の倍率です。 |
| **Blending** | 選択肢 | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | 描画先の画像に対する合成方法です。 |
| **Render side** | 選択肢 | **front**, **back**, **both** | **front** | 描画する面です。 |
| **Wrap** | 選択肢 | **none**, **tile**, **reflect** | **tile** | 画像の座標を固定、反復、または鏡面反復します。 |
| **Repeat** | 2D ベクトル | 明示的な範囲指定なし | `[1, 1]` | U と V のテクスチャの反復倍率です。 |
| **Offset** | 2D ベクトル | 明示的な範囲指定なし | `[0, 0]` | U と V のテクスチャの移動量です。 |
| **Center** | 2D ベクトル | 明示的な範囲指定なし | `[0, 0]` | テクスチャの変形の基準点です。 |
| **Rotation** | 数値 | 明示的な範囲指定なし | `0` | 度単位の回転です。 |


## PBR+ と Node Material で共有する表面のコントロール

PBR+ は上の表の独自の基本プロパティを使います。Node Material は以下の表の表面の初期値を使いますが、**Bump Strength** は `1`、**Use node graph** は **on** です。PBR+ のグラフの初期値は **off** です。

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Bake Resolution** | 選択肢 | **128**, **256**, **512**, **1024**, **2048** | **256** | グラフのベイクに使う正方形のマップの寸法です。 |
| **Color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | 表面の色です。Node Material の初期値は白です。 |
| **Luminance Color** | RGB カラー | 0 ～ 1 | `[0, 0, 0]` | 照明に依存しない表面の色です。 |
| **Color Ramp** | 選択肢 | **off**, **on** | **off** | 表面のカラーランプを有効にします。 |
| **Color Ramp Curve** | グラデーション | 編集可能なストップ | 黒から白 | Color Ramp が使う色のストップです。 |
| **Color Ramp Source** | 選択肢 | **luminance**, **u**, **v** | **luminance** | ランプに入力する座標です。 |
| **Color Ramp Interpolation** | 選択肢 | **linear**, **constant**, **ease** | **linear** | ランプのストップ間の補間です。 |
| **Color Ramp Factor** | 数値 | 0 ～ 1 | `1` | カラーランプの合成量です。 |
| **Roughness** | 数値 | 0 ～ 1 | `0.5` | 表面の粗さです。低い値ほどハイライトが鋭くなります。 |
| **Metalness** | 数値 | 0 ～ 1 | `0.5` | 誘電体と金属の表面の反応の合成量です。 |
| **Texture** | アセット | image/* | なし | Color を掛けるベースカラー画像です。 |
| **Bump Strength** | 数値 | 0 ～ 2 | `0` | グラフまたは手続き型のバンプの強さです。 |
| **Bump Noise** | 選択肢 | **off**, **on** | **off** | グラフの Bump 出力の代わりに固定シードのノイズを使います。 |
| **Bump Noise Scale** | 数値 | 1 ～ 64 | `4` | 手続き型のバンプの模様のスケールです。 |
| **Bump MIP Falloff** | 選択肢 | **off**, **on** | **on** | 遠いミップレベルでバンプの細部を減らします。 |
| **Fresnel** | 選択肢 | **off**, **on** | **off** | 視線の角度による色の変化を有効にします。 |
| **Fresnel Color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | 視線の角度で加える色です。 |
| **Fresnel Power** | 数値 | 0.1 ～ 8 | `4` | 視線の角度に対する変化の形状です。 |
| **Fresnel Mix Strength** | 数値 | 0 ～ 1 | `0.7` | フレネルの色の合成量です。 |
| **Ambient occlusion map** | 選択肢 | **off**, **on** | **off** | 画像に基づくアンビエントオクルージョンの陰影を有効にします。 |
| **Ambient occlusion map texture** | アセット | image/* | なし | アンビエントオクルージョンに使う画像です。 |
| **Ambient Occlusion Intensity** | 数値 | 0 ～ 1 | `0.5` | アンビエントオクルージョンの色の適用量です。 |
| **Ambient occlusion exponent** | 数値 | 0.01 ～ 8 | `1` | オクルージョンのマップに適用する指数です。 |
| **Ambient Occlusion Color** | RGB カラー | 0 ～ 1 | `[0, 0, 0]` | 遮蔽された領域の色です。 |
| **Cel Renderer** | 選択肢 | **off**, **on** | **off** | 段階的な拡散反射と鏡面反射の陰影を有効にします。 |
| **Cel Steps** | 数値 | 1 ～ 16 | `4` | 拡散反射の陰影の段階数です。 |
| **Cel Smoothness** | 数値 | 0 ～ 1 | `0.1` | セルシェーディングの段階間の滑らかさです。 |
| **Cel Specular Steps** | 数値 | 1 ～ 32 | `6` | 鏡面反射の陰影の段階数です。 |
| **Projection Rotation** | 3D ベクトル | 明示的な範囲指定なし | `[0, 0, 0]` | 投影の回転です。度単位です。 |
| **Projection Scale** | 3D ベクトル | 明示的な範囲指定なし | `[1, 1, 1]` | 各軸の投影の拡大率です。 |
| **Projection Translation** | 3D ベクトル | 明示的な範囲指定なし | `[0, 0, 0]` | 投影の座標空間の移動量です。 |
| **Projection Lock Aspect Ratio** | 選択肢 | **off**, **on** | **off** | すべての投影軸に X の拡大率を使います。 |
| **Projection** | 選択肢 | **uv**, **spherical**, **cylindrical**, **cubic** | **uv** | UV、球状、円筒状、立方体状のテクスチャの投影です。 |
| **Reflection Layer** | 選択肢 | **off**, **on** | **off** | 反射レイヤーとそのクリアコートのコントロールを有効にします。 |
| **Reflection Layer Strength** | 数値 | 0 ～ 1 | `1` | 反射レイヤーのクリアコートの強さです。 |
| **Reflection Layer Opacity** | 数値 | 0 ～ 1 | `1` | 反射レイヤーのクリアコートの不透明度の倍率です。 |
| **Reflection Layer Roughness** | 数値 | 0 ～ 1 | `0` | 反射レイヤーの粗さです。 |
| **Specular Layer** | 選択肢 | **off**, **on** | **on** | 鏡面反射のレイヤーを有効にします。 |
| **Specular Strength** | 数値 | 0 ～ 2 | `1` | 鏡面反射のレイヤーの強さです。 |
| **Specular Opacity** | 数値 | 0 ～ 1 | `1` | 鏡面反射のレイヤーの不透明度の倍率です。 |
| **Global Reflection Brightness** | 数値 | 0 ～ 2 | `1` | 反射の明るさの倍率です。 |
| **Emission strength** | 数値 | ≥ 0 | `1` | グラフの RGB Emission の強さです。 |
| **Clearcoat** | 数値 | 0 ～ 1 | `0` | Reflection Layer が off の場合のクリアコートの量です。 |
| **Clearcoat roughness** | 数値 | 0 ～ 1 | `0` | Reflection Layer が off の場合のクリアコートの粗さです。 |
| **Reflectivity** | 数値 | 0 ～ 1 | `0.5` | 誘電体の反射率です。 |
| **Environment image** | アセット | image/* | なし | 正距円筒の反射画像です。Reflection とは独立してシーンの環境マップを置き換えます。 |
| **Environment intensity** | 数値 | ≥ 0 | `1` | 指定した Environment image の倍率です。 |
| **Environment rotation** | 数値 | 明示的な範囲指定なし | `0` | 環境画像の回転です。度単位です。 |
| **Shadow side** | 選択肢 | **Auto**, **Front**, **Back**, **Double** | **Auto** | 影を落とす面です。Auto は両面のマテリアルに Back を使います。 |

**Use node graph** が **on** の間は、**Open Node Editor** ボタンでグラフを開きます。**Selected node image** は選択した Image または Texture ノードの画像を保持します。


## Matcap

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Matcap** | アセット | image/* | なし | 視点依存の陰影画像です。シーンの照明はこのマテリアルを変えません。 |
| **Color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | Matcap 画像に掛ける色です。 |
| **Brightness** | 数値 | ≥ 0 | `1` | Matcap 画像の明るさの倍率です。 |
| **Transparency** | 選択肢 | **off**, **on** | **off** | アルファの透過を有効にします。 |
| **Opacity** | 数値 | 0 ～ 1 | `1` | 不透明度の倍率です。 |
| **Blending** | 選択肢 | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | 描画先の画像に対する合成方法です。 |
| **Render side** | 選択肢 | **front**, **back**, **both** | **front** | 描画する面です。 |


## UV Custom

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | ベースカラーの倍率です。 |
| **Emissive** | RGB カラー | 0 ～ 1 | `[0, 0, 0]` | 照明に依存しない表面の色です。 |
| **Roughness** | 数値 | 0 ～ 1 | `0.5` | 表面の粗さです。低い値ほどハイライトが鋭くなります。 |
| **Metalness** | 数値 | 0 ～ 1 | `0.5` | 誘電体と金属の表面の反応の合成量です。 |
| **Texture** | アセット | image/* | なし | Color を掛けるベースカラー画像です。 |
| **Transparency** | 選択肢 | **off**, **on** | **off** | アルファの透過を有効にします。 |
| **Opacity** | 数値 | 0 ～ 1 | `1` | 不透明度の倍率です。 |
| **Blending** | 選択肢 | **none**, **normal**, **additive**, **subtractive**, **multiply** | **normal** | 描画先の画像に対する合成方法です。 |
| **Render side** | 選択肢 | **front**, **back**, **both** | **front** | 描画する面です。 |
| **Normal map** | アセット | image/* | なし | 接空間の法線画像です。 |
| **Normal scale** | 数値 | ≥ 0 | `1` | 読み込んだ法線画像の強さです。 |
| **Wrap** | 選択肢 | **none**, **tile**, **reflect** | **tile** | 画像の座標を固定、反復、または鏡面反復します。 |
| **Repeat** | 2D ベクトル | 明示的な範囲指定なし | `[1, 1]` | U と V のテクスチャの反復倍率です。 |
| **Offset** | 2D ベクトル | 明示的な範囲指定なし | `[0, 0]` | U と V のテクスチャの移動量です。 |
| **Center** | 2D ベクトル | 明示的な範囲指定なし | `[0, 0]` | テクスチャの変形の基準点です。 |
| **Rotation** | 数値 | 明示的な範囲指定なし | `0` | 度単位の回転です。 |
| **Reflection** | 選択肢 | **off**, **on** | **off** | Environment image の指定がない場合にシーンの環境マップを使います。 |


## Image+

Image+ は照明を使いません。**Image** は画像アセットで、初期値は空です。**Transparency**、**Opacity**、**Wrap**、**Repeat**、**Offset**、**Center**、**Rotation**、**Render side** の型、範囲、初期値は上の PBR+ と同じです。


## マップの合成と制限

3D Text と押し出し形状では、キャップはテキストの範囲に対応し、側面は輪郭に沿って展開します。Matcap はメッシュの UV の代わりに視線の方向を使います。

Normal map はグラフの Normal とバンプの細部と合成されます。Bump Noise はグラフの Bump より優先します。アンビエントオクルージョンはマップを使い、シーンの形状による影の計算はしません。

環境画像は 2 の累乗の寸法で、上限は 4096×2048 です。HDR と EXR には対応しません。

[マテリアルのノードのプロパティ](/docs/ja/reference/material-nodes/)

[Material+ でオブジェクトに陰影を付ける](/docs/ja/features/material-plus/)
