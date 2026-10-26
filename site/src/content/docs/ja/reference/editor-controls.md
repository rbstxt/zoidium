---
title: アニメーションとプレビューのコントロール
description: Easing+ の座標、Motion Paths の操作、Player+ の描画と品質の設定。
sidebar:
  label: エディターのコントロール
---
これらのコントロールは編集とプレビューの動作を変えます。Easing+ と Motion Paths はネイティブのアニメーションチャンネルに書き込みます。Player+ の設定はローカルのビューポートに作用します。


## Easing+ の座標

**Out X**、**Out Y**、**In X**、**In Y** は数値のベジェ座標で、ステップは `0.001` です。初期値は選択したキーへ入る区間から取得します。X 座標の範囲は `0` から `1` です。Y はオーバーシュートに対応します。

Out は始点のキーのコントロールです。In は終点のキーのコントロールです。最初のキーには入る区間がありません。Escape を含むウィンドウの終了は、取り消し可能な1回の編集を確定します。

[Easing+ で入ってくるカーブを設定する](/docs/ja/features/easing-plus/)

## Motion Paths の操作と制限

| 入力 | 結果 |
| --- | --- |
| `O` | モーションパスの表示を切り替えます。 |
| `Shift-click` | キーの選択を切り替えます。 |
| `Shift-drag` | 移動を親の座標空間の主要な軸に制限します。 |
| `Alt-drag` | 接線の連続性を解除します。 |
| `Alt-click` | 隣接する区間の線形とベジェを切り替えます。 |
| `Escape` | 現在のドラッグを取り消します。 |

Position は式のないアニメーションの軸を必要とします。式を使う軸は表示できますが編集できません。Position のグループの式はパスを非表示にします。パスの線分は最大1500で、900フレームを超える区間ではフレームの点を省きます。

[Motion Paths で動きを編集する](/docs/ja/features/motion-path/)

## Player+ の描画と品質

**Pause drawing** はビューポートの描画を止めます。音声と再生ヘッドの動きは変えません。**Render once** は現在のフレームを描画します。**Resume drawing** は自動描画を再開します。初期状態では描画は有効です。

**Preview quality** はローカルの選択肢で、**Full quality**、**1/2 quality**、**1/4 quality**、**1/8 quality** があります。初期値は Full quality です。割合はビューポートの幅と高さの両方に適用します。プロジェクトと書き出しの解像度はそれぞれの値を保持します。

[Player+ のプレビューのコントロール](/docs/ja/features/player-plus/)

[プレビューキャッシュ](/docs/ja/features/preview-cache/)
