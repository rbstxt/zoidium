---
title: パススルーシェーダーを作成する
description: 入力画像を保持する Custom Shader を作成します。
---
入力画像をそのまま返す Custom Shader エフェクトを作成します。開始する前に、Plugins で Shader+ を有効にします。

## エフェクトを追加する

1. 表示可能なコンテンツを含むクリップを選択します。
2. Effects でネイティブの Custom Shader エフェクトを追加します。
3. シェーダーコードエディターを開きます。
4. ドラフトを次のシェーダーに置き換えます:

```glsl
precision highp float;
uniform sampler2D tDiffuse;
varying vec2 vUvScaled;
void main() {
	gl_FragColor = texture2D(tDiffuse, vUvScaled);
}
```

5. **Apply** をクリックします。
6. 出力を確認するには、編集用カメラをオフにします。

出力はエフェクトの入力と一致します。`tDiffuse` にはその入力画像が含まれます。`vUvScaled` には、入力テクスチャのサンプリングに必要なスケールが既に適用されています。

## 座標を表示する

1. ドラフトを次のシェーダーに置き換えます:

```glsl
precision highp float;
varying vec2 vUv;
void main() {
	gl_FragColor = vec4(vUv, 0.0, 1.0);
}
```

2. **Apply** をクリックします。

出力には赤と緑の座標ランプが表示されます。`vUv` は出力画像全体に広がります。入力サンプリングの場合、`vUvScaled` は `vUv * uvScale` と等しくなります。`resolution` は出力の幅と高さをピクセル単位で提供します。[シェーダーリファレンス](/docs/ja/reference/shader/)にそれらの宣言が記載されています。

## コントロールを追加する

1. Shader プロパティを開きます。
2. **+** をクリックします。
3. ZOIDIUM の下にある Slider を選択します。
4. 名前を `Amount` に設定します。
5. コードエディターを開きます。
6. ドラフトを次のシェーダーに置き換えます:

```glsl
precision highp float;
uniform sampler2D tDiffuse;
uniform float Amount;
varying vec2 vUvScaled;
void main() {
	vec4 color = texture2D(tDiffuse, vUvScaled);
	gl_FragColor = vec4(color.rgb * Amount, color.a);
}
```

7. **Apply** をクリックします。
8. エフェクトプロパティで Amount を変更します。

Amount によって画像の明るさがスケーリングされるようになりました。1 の場合、入力は変更されません。その他の種類については、[プロパティコントロール](/docs/ja/development/shader-properties/) を参照します。
