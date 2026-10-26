---
title: Light+ のネイティブのプロパティ
description: ネイティブの照明の種類、初期値、範囲、マテリアルの反応。
sidebar:
  label: Light+ リファレンス
---
Light+ はネイティブの CM3 の照明を表示します。Single Color、Image+、Matcap のマテリアルはシーンの照明に反応しません。


## 照明の型

| ピッカーの名前 | 表示するコントロール |
| --- | --- |
| **Spot light** | **Position**, **Target**, **Color**, **Intensity**, **Angle** |
| **Point light** | **Position**, **Color**, **Intensity** |
| **Directional light** | **Position**, **Target**, **Color**, **Intensity** |
| **Hemisphere light** | **Sky color**, **Ground color**, **Intensity** |


## 共有するコントロール

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Position** | 3D ベクトル | 明示的な範囲指定なし | `[0, 100, 100]` | シーンの単位で指定する照明の位置です。 |
| **Target** | 3D ベクトル | 明示的な範囲指定なし | `[0, 0, 0]` | 照明を向ける点です。 |
| **Color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | 照明の RGB カラーです。 |
| **Sky color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | 上方からの色です。 |
| **Ground color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | 下方からの色です。 |
| **Intensity** | 数値 | 0 ～ 100 | `1` | 照明の出力の倍率です。 |
| **Angle** | 数値 | 0 ～ 90 | `60` | スポットの円錐の角度です。度単位です。 |

Spot、Point、Directional のプリセットは Position を `0, 100, 100` に設定します。Hemisphere には Position と Target の欄がありません。他の初期値はネイティブの照明のプロパティ定義に従います。

[Light+ でネイティブの照明を追加する](/docs/ja/features/light-plus/)
