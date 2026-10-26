---
title: Trapcode スタイルのオブジェクトを追加する
sidebar:
  label: Trapcode 風のオブジェクトとライト
---
3D Scene にパーティクルシステム、ポイントネットワーク、またはライトを追加します。

1. Plugins で **Rowbyte & Red Giant Suite** を有効にします。
2. シーンの **Objects** ピッカーを開きます。
3. **Trapcode Particular**、**Trapcode Form**、または **Plexus** を選択します。
4. オブジェクトのデザイナーを開きます。
5. ネイティブパラメーターを編集します。
6. 通常のビューポートで結果を確認します。

エミッターベースのパーティクルシステムには Particular を選択します。パーティクルラティスにはForm を選択します。ソースポイントを線またはファセットで接続するには Plexus を選択します。

スイートのライトを使用するには、ピッカーで **Trapcode Lights** を開きます。測光データをインポートするには、Photometric IES を選択し、TILT=NONE のローカル LM-63 Type C ファイルを選択します。

[Suite のソースコントラクト](https://github.com/rbstxt/zoidium/blob/dev/plugins/trapcode-suite/README.md)では、決定論的モーション、音声分析、ライトの動作、制限について説明しています。

コントロールのリファレンス: [trapcode-particular](/docs/ja/reference/trapcode-particular/), [trapcode-form](/docs/ja/reference/trapcode-form/), [plexus](/docs/ja/reference/plexus/), [trapcode-lights](/docs/ja/reference/trapcode-lights/).
