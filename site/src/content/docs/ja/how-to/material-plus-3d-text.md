---
title: 3D Text に Material+ を使う
sidebar:
  label: 3D Text の Material+
---
ネイティブの 3D Text を **PBR+** マテリアルでシェーディングし、Text+ の **Character Material** 親でキャップと押し出し側面に別のマテリアルを割り当てます。

## テキスト全体を PBR+ でシェーディングする

1. **Plugins** で **Material+** を有効にします。
2. ネイティブのプロパティパネルで 3D Text オブジェクトを選択します。
3. マテリアルを **PBR+ Material** に変更します。
4. **Color**、**Roughness**、**Metalness** を設定します。
5. 表面にテクスチャが必要な場合は、対応するマップのプロパティで画像を選択します。
6. 共通の **Wrap**、**Repeat**、**Offset**、**Center**、**Rotation** を調整します。

Material+ は独自の UV 配置でテクスチャを貼るため、オブジェクト単位のタイリングではなく、キャップと側面で同じ密度を保ちます。シーンの環境マップで照らすには **Reflection** を有効にします。

## Color Ramp を追加する

1. **Color Ramp** を **on** にします。
2. **Color Ramp Curve** のグラデーションを編集します。
3. **Color Ramp Source** でランプの入力を選択します。
4. **Color Ramp Interpolation** と **Color Ramp Factor** でベースカラーへの混ぜ方を設定します。

## キャップと側面に別のマテリアルを割り当てる

1. **Plugins** で **Text+** を有効にします。
2. 3D シーンの **Objects** パネルを開きます。
3. Text+ から **Character Material** を追加します。
4. ネイティブの 3D Text オブジェクトを親の中に配置します。
5. **Front material** を開き、変更ボタンで両方のキャップ用のマテリアルを選択します。
6. **Side material** を開き、押し出し側面とベベル用のマテリアルを選択します。
7. 各マテリアルのネイティブのプロパティを編集またはキーフレームで動かします。

特定の文字に適用するには、**Characters** に `1,3,4` のような 1 始まりの番号を入力します。すべての文字に適用するには **Characters** を空にします。片方の面に元の Text マテリアルを残すには、そのスロットからマテリアルを削除します。文字を選択している最も内側の親が両方のスロットを制御します。同じテキストをアニメーションさせるには、マテリアル親と Text+ のアニメーション親を入れ子にします。

[Material+ のプロパティ](/docs/ja/reference/material-plus/) と [Text+ の文字プロパティ](/docs/ja/reference/text-plus/) にマテリアルとスロットのコントロールをまとめています。
