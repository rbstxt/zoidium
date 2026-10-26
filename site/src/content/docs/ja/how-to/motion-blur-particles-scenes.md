---
title: パーティクルと 3D シーンにモーションブラーを追加する
sidebar:
  label: パーティクルとシーンのブラー
---
**3D Scene** 内のパーティクルやオブジェクトには、Scene レイヤー自体に **Smart Motion Blur** を適用します。

## Scene レイヤーにエフェクトを追加する

1. **Plugins** で **Native FX** を有効にします。
2. パーティクルや動くオブジェクトを含む **3D Scene** クリップを選択します。
3. エフェクトピッカーの **NATIVE FX** から **Smart Motion Blur** を追加します。
4. **Reconstruction** は **Automatic** のままにします。
5. コンテンツが動くフレームに移動します。
6. **View** を **Result** にしてブラーを確認します。

**3D Scene** レイヤーでは、**Automatic** は **Shutter Samples** を使います。シャッター範囲の小数点以下の時刻でシーンを再評価します。この用途では **Adjustment** レイヤーにエフェクトを配置しないでください。**Adjustment** レイヤーは下のレイヤーの合成結果を取り込むため、**Automatic** はオプティカルフローに切り替わり、変化するシルエットや押し出し面を取り逃します。**Adjustment** レイヤーは、レイヤー自体の Position、Rotation、Scale による動きに使います。

## 再構成モードを選ぶ

- パーティクルや **3D Scene** 内のオブジェクトには **Automatic** を使います。各シャッターのタップでシーンの可視状態を直接取り込みます。
- 映像の流れと見た目を合わせる場合など、隣接フレーム間の動きを推定するには **Optical Flow** を選択します。
- **Automatic** がオプティカルフローを使う場面で小数点以下のシーン取り込みを強制するには **Shutter Samples** を選択します。

**Optical Flow** で速い動きを取り逃す場合は、**Motion Sensitivity** または **Max Displacement (px/frame)** を上げます。変位の上限は 1 フレームあたりの想定移動量に近づけます。**Shutter Samples** では **Blur Amount** と **Quality** で結果を調整します。トラッキングのコントロールはシャッターの結果を変えません。

## フレーム間でパーティクルが動くことを確認する

このエフェクトは隣接するプロジェクトフレームを比較します。隣接フレームが同一の場合、ブラーは付かず、入力がそのまま出力されます。

1. 1 フレーム進め、1 フレーム戻します。
2. フレーム間でパーティクルの位置が目に見えて変わることを確認します。
3. 静止する場合は、パーティクルの **Time** プロパティをキーフレームで動かし、シャッター範囲でシミュレーションが進むようにします。
4. **Blur Amount** と **Motion Sensitivity** が 0 より大きいことを確認します。どちらかが 0 の場合も入力がそのまま出力されます。

## Full quality の負荷を抑える

キャッシュにないフレームは、**Balanced** で 32 回、**High** で 64 回のシーン評価が必要です。**Full quality** のプレビューサイズでは、すべての評価がフルサイズで描画されます。

1. 編集中は Player+ の **Pause drawing** と **Render once** を使い、**1/8 quality** または **1/4 quality** で作業します。[重いプロジェクトをプレビューする](/docs/ja/how-to/preview-heavy-project/) に従ってください。
2. 最終のブラー確認のときだけ **Full quality** に切り替えます。
3. **Blur Amount** はシャッター角度を 360 で割った値にします。180 度シャッターでは 0.5 です。
4. ブラーではなくトラッキングを確認するには、**View** を **Motion Vectors** または **Confidence** にします。書き出す前に **Result** に戻します。

[Smart Motion Blur のプロパティ](/docs/ja/reference/smart-motion-blur/) にデフォルト、範囲、制限をまとめています。
