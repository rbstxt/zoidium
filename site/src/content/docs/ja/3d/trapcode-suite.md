---
title: Trapcode Suite
description: Trapcode Particular、Trapcode Form、Plexus、Trapcode Lights の使い分け、3D オブジェクトの非表示、IES 測光データの読み込み手順です。
---
**Rowbyte & Red Giant Suite** は、3D Scene にパーティクルシステム、ポイントネットワーク、拡張ライトを追加します。

## どのツールを選ぶか

**Plugins** で **Rowbyte & Red Giant Suite** を有効にし、シーンの **Objects** ピッカーからオブジェクトを追加します。

| ツール | 向いている用途 | ガイドとコントロール |
| --- | --- | --- |
| **Trapcode Particular** | 物理演算、フィールド、オーディオリアクターを備えたエミッター式パーティクルシステム。 | [Trapcode Particular](/docs/ja/3d/trapcode-particular/) |
| **Trapcode Form** | フラクタルフィールドやレイヤーマップで変形できる 3D パーティクルラティスとストリング。 | [Trapcode Form](/docs/ja/3d/trapcode-form/) |
| **Plexus** | ソースポイントを点、線、ファセット、三角分割、ビームでつなぐ点群ネットワーク。 | [Plexus](/docs/ja/3d/plexus/) |
| **Trapcode Lights** | Area、Sun、Portal、Photometric IES を含む拡張 3D ライト。 | [ライト](/docs/ja/3d/lights/) |

エミッターベースのパーティクルシステムには **Particular** を選びます。パーティクルラティスには **Form** を選びます。ソースポイントを線やファセットで接続するには **Plexus** を選びます。

### スイートオブジェクトを追加する

1. **Plugins** で **Rowbyte & Red Giant Suite** を有効にします。
2. シーンの **Objects** ピッカーを開きます。
3. **Trapcode Particular**、**Trapcode Form**、または **Plexus** を選びます。
4. オブジェクトのデザイナーウィンドウを開くか、Properties パネルでネイティブパラメーターを編集します。
5. 通常のビューポートで結果を確認します。

## Photometric IES ライトを読み込む

1. シーンの **Objects** ピッカーで **Trapcode Lights** を開きます。
2. **Photometric IES Light** を選びます。
3. **IES File** で、`TILT=NONE` のローカル LM-63 Type C `.ies` ファイルを選びます。

非対応のファイルを選んだ場合、以前のプロファイルがそのまま維持されます。8 種類のスイートライトとパラメーター一覧は [ライト](/docs/ja/3d/lights/) を参照してください。

## 3D オブジェクトを非表示にする

3D オブジェクトを非表示にして更新と準備処理を省くには、オブジェクトのプロパティで **Enabled** を **off** にします。時間に応じて切り替えるには **Enabled** にキーフレームを追加します。

**Trapcode Particular** を再びオンにすると、要求されたフレームを評価します。カメラにはまだ **Enabled** がないため、別のカメラへ切り替えるか Camera+ の **Active Camera** を使ってください。
