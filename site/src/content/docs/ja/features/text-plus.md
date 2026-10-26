---
title: Text+ で文字をアニメーションさせる
sidebar:
  label: Text+
---
ネイティブの 2D Text は **Character** カテゴリで、3D Text は Text+ の親オブジェクトでアニメーション化します。

## ネイティブの Text レイヤーをアニメーション化する

1. **Plugins** で **Text+** を有効にします。
2. **LAYERS** から **Text** を追加します。
3. Text レイヤーを選択します。
4. ネイティブのプロパティパネルで **Character** カテゴリを開きます。
5. **Mode** で **Character Transform** などを選択します。
6. **Position**、**Scale**、または **Rotation** を設定します。
7. 文字間のアニメーションをオフセットするには、**Delay** を設定します。
8. **Delay order** を選択します。
9. 文字のプロパティにキーフレームを設定します。

特定の文字に影響を与えるには、**Selected Character Transform** を選択し、**Characters** に `1,4,5` などの 1 から始まる数値を入力します。スペースも文字の数に含みます。
テキストの先頭から末尾に向けて変形を変えるには、**Gradient Transform** を選択し、**First** と **Last** の各コントロールを設定します。
文字を散乱させるには、**Random Scatter** を選択して **Amount** をアニメーション化します。
各 Shake モードをアニメーション化するには、**Phase** をアニメーション化します。

ネイティブの Text では、Position と Scale に X と Y を使用します。Rotation はレイヤーの平面内で回転します。
ネイティブの **Text**、**Font**、**Size**、**Fill**、**Stroke** コントロールを使用します。
テキスト全体を移動するには、**Character** より上にあるネイティブの **Position**、**Rotation**、**Scale** コントロールを編集します。

文字のアニメーションを無効にするには、**Mode** を **None** に設定します。
Text+ を使用せずにネイティブの Text を描画するには、**Plugins** で **Text+** を無効にします。
文字の設定を保持するには、プロジェクトを保存します。
アニメーションを復元するには、**Text+** を再び有効にします。

レイヤーを Shape+ に変換する前に、**Character** > **Mode** を **None** に設定します。
変換した Shape+ レイヤーには編集可能なアウトラインがあり、Text+ の文字コントロールはありません。

## 親オブジェクトで 3D Text をアニメーション化する

1. 3D Scene の **Objects** パネルを開きます。
2. Text+ から **Character Transform** を追加します。
3. ネイティブの 3D Text オブジェクトを親オブジェクトの中に配置します。
4. 親オブジェクトの **Character** カテゴリを開きます。
5. Position、Scale、または Rotation を設定します。
6. 文字間のアニメーションをオフセットするには、**Delay** を設定します。
7. **Delay order** を選択します。
8. 文字のプロパティにキーフレームを設定します。

特定の文字に影響を与えるには、Selected Character Transform を使用し、**Characters** に `1,4,5` などの 1 から始まる数値を入力します。テキストを散乱させるには、Random Scatter を使用して **Amount** をアニメーション化します。Character Shake をアニメーション化するには、**Phase** をアニメーション化します。

[Text+ のソースコントラクト](https://github.com/rbstxt/zoidium/blob/dev/plugins/text-plus/README.md)では、ピボット、ディレイ、シェイク、ネストされた親について説明しています。[Text+ の互換性](/docs/ja/development/project-compatibility/#text-スケール合成)では、保存されたスケールモードについて説明しています。
