---
title: Custom Shader へのシェーダーの移植
description: Shadertoy スタイルのエントリーポイントと番号付き AlipFX カラーを適合させます。
---
編集する前に、元のシェーダーのコピーを保持します。これらの変更によってピクセルが変化する可能性があります。

## Shadertoy スタイルのソースを適合させる

1. `mainImage(out vec4 color, in vec2 fragCoord)` を `void main()` に置き換えます。
2. 出力引数への書き込みを `gl_FragColor` に置き換えます。
3. `uniform vec2 resolution;` を宣言します。
4. `varying vec2 vUv;` を宣言した後、ピクセル座標を `vUv * resolution` に置き換えます。
5. シェーダーがエフェクト入力をサンプリングする場合は、`uniform sampler2D tDiffuse;` を宣言します。
6. `varying vec2 vUvScaled;` を宣言した後、その入力を `vUvScaled` でサンプリングします。
7. シェーダーにプロジェクトの時間が必要な場合は、Expressions+ を有効にします。
8. `uniform float zTime;` を宣言し、時間の読み取りを `zTime` に置き換えます。
9. サポートされていない GLSL 機能を GLSL ES 1.00 同等の機能に置き換えます。
10. **Apply** をクリックし、コンパイラの結果を確認します。

テクスチャサンプリングには `texture2D` を使用します。Custom Shader は、Shadertoy の追加チャンネル、マルチパスバッファ、マウス状態、またはフィードバック履歴を提供しません。それらの依存関係を削除するか、明示的なプロジェクトプロパティに置き換えます。

## 番号付き AlipFX カラーを置き換える

1. `Ramp` という名前のグラデーションプロパティを追加します。
2. 元の色を既存の順序でストップにコピーします。
3. 元のストップの間隔、色空間、およびアルファを一致させます。
4. ソースに `// #include <zoidium/gradient>` を追加します。
5. `uniform sampler2D Ramp;` を宣言します。
6. 以前の補間呼び出しを `zGradient(Ramp, t)` に置き換えます。
7. ソースを適用し、その出力をオリジナルと比較します。

新しいサンプリングが必要な外観と一致しない場合は、元のシェーダーを保持します。パックがビルド時に付けるコントロールのメタデータでは、これらのソースの編集は行われません。[AlipFX の移行](/docs/ja/development/shader-properties/#alipfx-移行)を参照します。
