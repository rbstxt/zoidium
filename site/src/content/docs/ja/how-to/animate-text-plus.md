---
title: Text+ でネイティブの Text をアニメーションさせる
sidebar:
  label: Text+ で Text を動かす
---
ネイティブの 2D Text を、Text+ がレイヤーに追加する **Character** カテゴリで文字ごとにアニメーションさせます。

## 1 つのカテゴリを動かす

1. **Plugins** で **Text+** を有効にします。
2. **LAYERS** から **Text** を追加します。
3. Text レイヤーを選択します。
4. ネイティブのプロパティパネルで **Character** カテゴリを開きます。
5. **Mode** を選択します。オフセットには **Character Transform**、テキスト全体のブレンドには **Gradient Transform**、フェーズ駆動の振動には **Character Shake**、特定の文字には **Selected** の種類、シード付きのばらつきには **Random Scatter** を使います。
6. **Position**、**Scale**、**Rotation** を設定します。
7. 文字間のアニメーションにずれを付けるには **Delay** を設定します。
8. **Delay order** を選択します。
9. 文字のプロパティにキーフレームを設定します。

2D Text では、Position と Scale に X と Y を使います。Rotation はレイヤー平面内で回転します。ネイティブの **Text**、**Font**、**Size**、**Fill**、**Stroke** のコントロールはそのまま使います。テキスト全体を動かすには、**Character** の上にあるネイティブの **Position**、**Rotation**、**Scale** を編集します。

特定の文字に適用するには、**Selected Character Transform** または **Selected Character Shake** を選び、**Characters** に `1,4,5` のような 1 始まりの番号を入力します。スペースも文字スロットとして数えます。テキスト全体で変化をブレンドするには **Gradient Transform** を選び、**First** と **Last** のコントロールを設定します。文字を散らすには **Random Scatter** を選び、**Amount** をアニメーションさせます。いずれかの Shake モードを動かすには **Phase** をアニメーションさせます。

## Character 2 と Character 3 を重ねる

後のカテゴリは、前のカテゴリが残した状態から文字を動かします。

1. **Character** の **Mode** を **None** 以外にします。**Character** の下に **Character 2** が表示されます。
2. **Character 2** で別の **Mode** を設定します。同じ手順で **Character 3** が表示されます。
3. 各カテゴリに別々にキーフレームを設定します。

たとえば、**Character** で文字を振動させ、**Character 2** で散らします。文字のアニメーションを無効にするには、すべての **Mode** を **None** にします。Text+ なしでネイティブの Text を描画するには、**Plugins** で **Text+** を無効にします。文字の設定を保持するにはプロジェクトを保存します。

レイヤーを Shape+ に変換する前に、すべての **Character** カテゴリの **Mode** を **None** にします。変換後の Shape+ レイヤーは編集可能なアウトラインを持ち、Text+ の文字コントロールは残りません。

[Text+ の文字プロパティ](/docs/ja/reference/text-plus/) にモード、コントロール、デフォルト、範囲をまとめています。
