---
title: Trapcode の照明のプロパティ
description: スイートの8種類の照明、表示するコントロール、初期値、IES の制限。
sidebar:
  label: Trapcode の照明
---
スイートは **Trapcode Lights** に 8 種類の照明を登録します。Light+ のネイティブの照明とは別の型です。


## 照明の型

| ピッカーの名前 | 表示するコントロール |
| --- | --- |
| **Point Light (Omni)** | **Position**, **Color**, **Intensity**, **Distance**, **Decay** |
| **Spot Light** | **Position**, **Target**, **Color**, **Intensity**, **Angle**, **Penumbra**, **Distance**, **Decay** |
| **Infinite Light (Directional)** | **Position**, **Target**, **Color**, **Intensity**, **Temperature (K)**, **Shadow Softness**, **Shadow Coverage** |
| **Area Light** | **Position**, **Target**, **Color**, **Intensity**, **Width**, **Height** |
| **Hemisphere Light (Sky/Ground)** | **Sky color**, **Ground color**, **Intensity** |
| **Photometric IES Light** | **Position**, **Target**, **Color**, **Intensity**, **Angle**, **Penumbra**, **Distance**, **Decay**, **IES Profile**, **IES File** |
| **Sun (Directional)** | **Target**, **Color**, **Intensity**, **Sun Azimuth**, **Sun Elevation** |
| **Portal Light** | **Position**, **Target**, **Color**, **Intensity**, **Width**, **Height** |


## 共有のコントロール

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Position** | 3D ベクトル | 明示的な範囲指定なし | `[0, 10, 0]` | シーンの単位で指定する照明の位置です。 |
| **Target** | 3D ベクトル | 明示的な範囲指定なし | `[0, 0, 0]` | 照明を向ける点です。 |
| **Color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | 照明の RGB カラーです。 |
| **Sky color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | 上方からの色です。 |
| **Ground color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | 下方からの色です。 |
| **Intensity** | 数値 | 0 ～ 100 | `1` | 照明の出力の倍率です。 |
| **Angle** | 数値 | 0 ～ 90 | `60` | スポットの円錐の角度です。度単位です。 |


## スイートの追加コントロール

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Distance** | 数値 | 0 ～ 5000 | `0` | 照明の到達距離です。0 は有限の上限を設定しません。 |
| **Decay** | 数値 | 0 ～ 4 | `1` | 距離による減衰の指数です。 |
| **Penumbra** | 数値 | 0 ～ 1 | `0.5` | スポットの円錐の縁の柔らかさです。 |
| **Width** | 数値 | 0.1 ～ 200 | `10` | 長方形の発光面の幅です。 |
| **Height** | 数値 | 0.1 ～ 200 | `10` | 長方形の発光面の高さです。 |
| **Sun Elevation** | 数値 | -10 ～ 90 | `45` | 太陽の仰角です。度単位です。 |
| **Sun Azimuth** | 数値 | -180 ～ 180 | `0` | 太陽の方位角です。度単位です。 |
| **Temperature (K)** | 数値 | 1000 ～ 12000 | `6500` | ケルビン単位の色温度の倍率です。 |
| **Shadow Softness** | 数値 | 0 ～ 10 | `1` | シャドウマップのフィルターの半径です。 |
| **Shadow Coverage** | 数値 | 10 ～ 2000 | `200` | 平行光源の影のカメラの表示範囲です。 |
| **IES Profile** | テキスト | テキスト | `Downlight` | 組み込みまたは読み込んだ照明の角度分布です。 |
| **IES File** | テキスト | テキスト | 空欄 | ローカルの IES ファイルです。読み込みと削除のコントロールがあります。 |


## IES、面光源、影

IES の読み込みは `TILT=NONE` の LM-63 Type C に対応します。プロファイルは照明の角度ごとの強度を変えます。非対応のファイルを指定した場合は前のプロファイルを保持します。

Area Light と Portal Light は長方形の発光面を使います。浮動小数点テクスチャのフィルタリングがない場合は、9 点のスポットを使います。パストレーシングによる間接照明は行いません。

[スイートのオブジェクトと照明を追加する](/docs/ja/features/trapcode-suite/)
