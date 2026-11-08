---
title: Constraints でオブジェクトの向きと追従を設定する
sidebar:
  label: Constraints
---
Track To で 3D オブジェクトをターゲットに向けます。Follow で変換をコピーできます。

## Track To でオブジェクトを向ける

1. **Objects** でオブジェクトを選択します。
2. Rotation の各行の下にある **Track to** を設定します。
3. ターゲットを選択します。
4. **Track axis** を選択します。
5. 異なる **Up axis** を選択します。
6. **Influence** を設定またはアニメーションさせます。

100 パーセントでは、トラック軸がターゲットを指します。0 では、オブジェクト自体の回転が優先されます。コンストレイントを削除するには、Track to を None に設定します。

スポットライトまたはディレクショナルライトの場合は、Track to と Influence を設定します。これらのライトはネイティブの Target 位置を通じて向きを合わせ、トラック軸のコントロールは表示されません。Track To によるカメラショットには、ネイティブのシーンカメラを使用します。Camera+ のシーケンスカメラレイヤーは、同一シーンのターゲット規約の対象外です。

## Follow で変換をコピーする

1. **Objects** で Group またはオブジェクトを選択します。
2. **Follow** でターゲットのパスを選択します。パスにはビデオトラック、シーン、オブジェクトの名前が含まれます。
3. **Follow space** で **World** または **Local** を選択します。
4. **Copy position**、**Copy rotation**、**Copy scale** を **On** または **Off** に設定します。
5. **Position offset**、**Rotation offset**、**Scale multiplier** を設定またはアニメーションさせます。

初期設定では、ターゲットのワールド変換と一致します。同じシーケンスの別のシーンレイヤーにあるターゲットも選択できます。
Follow を削除するには、**Follow** を **None** に設定します。変換をコピーした後に向きを合わせるには、**Track to** も設定します。

ターゲットを削除すると、追従するオブジェクトは現在のローカル姿勢を保持し、**(Missing target)** を表示します。
Undo はターゲットと接続を復元します。プロジェクトを開き直しても保存した姿勢を保持します。

コントロールのリファレンス: [constraints](/docs/ja/reference/constraints/).
