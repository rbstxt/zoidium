---
title: OpenZoid Legacy のエフェクトを使う
sidebar:
  label: OpenZoid Legacy を使う
---
OpenZoid Legacy の時間処理、圧縮、テープ、注釈、文字のエフェクトをレイヤーに追加します。

## エフェクトを追加する

1. **Plugins** で **OpenZoid Legacy** を有効にします。
2. 適用先のレイヤーを選択します。
3. エフェクトピッカーを開きます。
4. **SETUP LEGACY** で **Echo (Legacy)**、**Posterize Time (Legacy)**、**Jpeg Damage**、**VHS**、**Datamosh**、**Tracery**、**ASCII** のいずれかを選択します。
5. Properties パネルでエフェクトを調整します。

編集時の描画負荷を下げるには、[Pause drawing と Render once](/docs/ja/how-to/preview-heavy-project/) を使ってください。

## 設定ウィンドウを開く

**VHS**、**Datamosh**、**Tracery**、**ASCII** では、エフェクトのプロパティの上にある対応する起動行を使います。

1. **Open VHS Setup**、**Open Datamosh Setup**、**Open Tracery Setup**、**Open ASCII Setup** のいずれかをクリックします。
2. プリセットを選ぶかコントロールを調整します。
3. メインのビューポートで結果を確認します。
4. **Done** をクリックしてウィンドウを閉じます。

編集はウィンドウを開いている間に反映します。**Done** は変更の一括適用ではなく、ウィンドウを閉じる操作です。編集を戻すには Undo を使ってください。

再現可能な変化を作るには、VHS の **Glitch!** または Datamosh の **Mosh!** をクリックします。各クリックはシードを保存し、1 回の Undo 操作を記録します。**Remove Frame** は Datamosh シミュレーションの保持コントロールを変更します。タイムラインのフレームを削除したり、動画ファイルを変更したりする操作ではありません。

## Tracery の注釈を配置する

マーカーを手動で配置するには、**Detection** をオフにします。必要な **Point 1** から **Point 6** のコントロールを有効にし、位置を設定します。ポイントのプロパティはキーフレームや式でアニメーションできます。

色から領域を検出するには、**Detection** をオンにし、**Key Color** を設定します。**Threshold** の調整中は **Show Mask** をオンにします。注釈の結果を書き出す前に **Show Mask** をオフにします。色の検出は、ポイントのキーフレームを書き込む自動モーショントラッキング解析ではありません。

## 結果を書き出す

ビューポートのエフェクトを通常の書き出しに使う場合は、Device ページの **True datamosh** を **off** のままにします。**Datamosh** エフェクトは明示的なソースのサンプルから描画するため、事前の再生は不要です。

エンコード済みファイルからキーフレームを削除するには、[True datamosh の書き出し](/docs/ja/how-to/export-true-datamosh/)に従ってください。[OpenZoid Legacy リファレンス](/docs/ja/reference/openzoid-legacy/)には、エフェクト、設定グループ、時間、制限をまとめています。
