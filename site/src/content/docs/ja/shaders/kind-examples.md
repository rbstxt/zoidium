---
title: プロパティの種類ごとの例
description: すべての Shader+ の種類に対する GLSL バインディングと式。
---
これらのフラグメントは、ファイルスコープの宣言と `main()` 用の式を示しています。名前はサンプルのプロパティ名と一致しています。[シェーダーリファレンス](/docs/ja/reference/shader/)には、受け入れられる型、ネイティブのストレージ型、補助バインディングが記載されています。

## Slider

```glsl
uniform float Amount;
// Inside main():
float brightness = Amount * 2.0;
```

## Angle

エディターには度数法で表示されます。シェーダーはラジアンを受け取ります。

```glsl
uniform float Rotation;
// Inside main():
vec2 direction = vec2(cos(Rotation), sin(Rotation));
```

## Seed

シードは数値です。この例では、Expressions+ の決定論的ハッシュ include を使用します。

```glsl
// #include <zoidium/hash>
uniform float Seed;
// Inside main():
float randomValue = zHash(Seed);
```

## Toggle

bool はネイティブの整数変換を受け取ります。float は小数の値を保持します。

```glsl
uniform bool Enabled;
// Inside main():
float amount = Enabled ? 1.0 : 0.0;
```

## Dropdown

Linear や Smooth という名前の項目は、参照される定数 `Mode_Linear` と `Mode_Smooth` を定義します。名前を変更しても、項目のインデックスは安定して維持されます。

```glsl
uniform int Mode;
// Inside main():
float amount = Mode == Mode_Smooth ? 1.0 : 0.0;
```

## Static dropdown

プロパティが定義を提供します。uniform の宣言はありません。

```glsl
// Mode is a native compile-time definition.
#if Mode == 0
const float amount = 0.0;
#else
const float amount = 1.0;
#endif
```

## Color + alpha

プロパティはストレート RGBA 値を提供します。

```glsl
uniform vec4 Tint;
// Inside main():
gl_FragColor = vec4(Tint.rgb * Tint.a, Tint.a);
```

## Point

Point は保存済みのプロパティでは引き続き使えますが、追加メニューからは非表示になっています。

```glsl
uniform vec2 Center;
varying vec2 vUv;
// Inside main():
float distanceFromCenter = length(vUv - Center);
```

## Gradient

include がヘルパーを提供します。Shader+ はプロパティの周期的反復設定用の `Ramp_repetitions` を提供します。

```glsl
// #include <zoidium/gradient>
uniform sampler2D Ramp;
varying vec2 vUv;
// Inside main():
vec4 color = zGradient(Ramp, vUv.x);
vec4 repeatedColor = zGradientCycle(Ramp, vUv.x);
```

## Curve

Shader+ は `Response_range` を提供し、既知の Curve プロパティに対する 2 引数の呼び出しにその範囲を追加します。3 引数の呼び出しでは範囲を明示的に指定します。

```glsl
// #include <zoidium/curve>
uniform sampler2D Response;
varying vec2 vUv;
// Inside main():
float mapped = zCurve(Response, vUv.x);
vec3 mappedRgb = zCurves(Response, vec3(vUv.x));
```

## Palette

Palette は最大 16 個のストレート RGBA カラーとカウントを提供します。

```glsl
uniform vec4 Colors[16];
uniform int Colors_count;
// Inside main():
vec4 firstColor = Colors_count > 0 ? Colors[0] : vec4(0.0);
```

## Text

Layout モードはカバレッジテクスチャを提供します。SDF アルファにはエッジを 0.5 とする距離が含まれます。Atlas モードでは `Title_grid` と `Title_count` も提供されます。

```glsl
// #include <zoidium/text>
uniform sampler2D Title;
varying vec2 vUv;
// Inside main():
float coverage = zText(Title, vUv);
gl_FragColor = vec4(vec3(coverage), coverage);
```

Gradient、Curve、Palette、および Text は静的プロパティです。[プロパティコントロール](/docs/ja/development/shader-properties/)では、それらのエディターと保存形式について説明しています。
