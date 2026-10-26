---
title: Text+ で文字をアニメーションさせる
sidebar:
  label: Text+
---
Text+ の親オブジェクトを使用して、ネイティブの 3D Text をアニメーション化します。

## 文字のアニメーションを追加する

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
