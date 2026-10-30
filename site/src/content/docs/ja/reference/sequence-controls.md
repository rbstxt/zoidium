---
title: Expressions+ の Sequence Controls
description: コントロールの種類、初期値、スライダーの設定、名前の規則、接続。
sidebar:
  label: Sequence Controls
---
Expressions+ は各シーケンスに **Controls** リストを追加します。上限はシーケンスごとに 256 コントロールです。各コントロールはネイティブのアニメーションプロパティです。


## コントロールの種類

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Slider** | 数値 | 0 ～ 100 | `0` | 数値のコントロールです。初期のステップは0.01です。 |
| **Angle** | 数値 | 明示的な範囲指定なし | `0` | 度単位で表示します。 |
| **Checkbox** | 選択肢 | **off**, **on** | **off** | off では0、on では1を返します。 |
| **Color** | RGB カラー | 0 ～ 1 | `[1, 1, 1]` | RGB の値です。 |
| **Point 2D** | 2D ベクトル | 明示的な範囲指定なし | `[0, 0]` | 2つの数値の成分です。 |
| **Point 3D** | 3D ベクトル | 明示的な範囲指定なし | `[0, 0, 0]` | 3つの数値の成分です。 |


## 名前、範囲、接続

**Rename…** の名前は空欄にできず、シーケンス内で一意である必要があります。**Move up** と **Move down** は順序を変えます。**Remove control** はコントロールを削除します。これらのコマンドはネイティブの Undo に対応します。

**Slider settings…** は **min**、**max**、**step** を表示します。max は min 以上、step は正の値である必要があります。

**Link to control…** は一致するプロパティの型を一覧にします。数値のプロパティにも Checkbox を接続できます。接続は `control(name, id)` の式を設定します。固定の ID は名前を変えても接続を保持します。

[Expressions+ を使う](/docs/ja/features/expressions-plus/)
