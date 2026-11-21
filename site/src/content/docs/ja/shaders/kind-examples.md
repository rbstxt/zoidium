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

## Path

Path プロパティはレイヤーマスクまたは Shape+ パスを参照し、4 つの uniform をバインドします。
パスに沿わせるには `Points` を使います。マスクするには `Coverage` を使います。

`Trail` という名前の Path プロパティでは、Shader+ が次の uniform をバインドします。

```glsl
uniform sampler2D TrailCoverage; // Coverage in the shader UV space (sample .a).
uniform sampler2D TrailPoints;   // 256 equally spaced points, xy in UV space.
uniform float TrailLength;       // Path length in u units.
uniform int TrailCount;          // 256 when the source resolves, 0 when missing.
```

- **座標空間:** `TrailCoverage` と `TrailPoints` はどちらも、`v = 1` を上端とするシェーダーの UV 空間を使います。Shape+ パスを参照する場合、Shape+ レイヤー自身のトランスフォームは適用されないため、座標はレイヤーローカル空間のままです。
- **弧長サンプル:** `TrailPoints` は 256×1 の RGBA テクスチャで、弧長で等間隔な 256 点を格納します。開いたパスでは、テクセル `0` が始点、テクセル `255` が終点です。閉じたパスでは、サンプル `k` は周回上の `k / 256` の位置にあります。
- **カウントと長さ:** `TrailCount` はソースが解決されたときに `256`、欠落しているときに `0` になります。頂点数ではなく、ソースがバインドされているかの確認に使います。`TrailLength` はマスク空間の長さをソースレイヤー幅で割った値で、`u` 単位です。16:9 のフレームで縦いっぱいの垂直線は、長さが `1.0` ではなく `0.5625` になります。
- **開いたパス:** `TrailCoverage` は塗りつぶしをラスタライズするときに開いたパスを閉じます。`TrailPoints` は開いたパスを閉じません。
- **サンプルの読み取り:** `0` から `255` までのサンプル `k` は、`texture2D(TrailPoints, vec2((float(k) + 0.5) / 256.0, 0.5)).xy` で読み取ります。`TrailPoints` は nearest フィルタを使うため、`0.0` から `1.0` までの弧長割合 `t` で滑らかな位置を得るには、隣り合う 2 つのテクセル間を補間します。

### パスに沿ったグロー

このフラグメントは、各ピクセルからサンプル点までの距離を測り、パスの周囲にグローを加算します。

```glsl
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D TrailPoints;
uniform int TrailCount;
uniform vec2 resolution;
varying vec2 vUvScaled;

void main() {
	vec4 base = texture2D(tDiffuse, vUvScaled);
	float aspect = resolution.x / max(resolution.y, 1.0);
	float d = 1e9;
	for (int i = 0; i < 128; i++) {
		float u = (float(i) * 2.0 + 0.5) / 256.0;
		vec2 p = texture2D(TrailPoints, vec2(u, 0.5)).xy;
		d = min(d, length((vUvScaled - p) * vec2(aspect, 1.0)));
	}
	float present = step(0.5, float(TrailCount));
	float glow = (1.0 - smoothstep(0.0, 0.04, d)) * present;
	gl_FragColor = vec4(base.rgb + vec3(1.0, 0.55, 0.2) * glow, base.a);
}
```

このループは 1 点おきに 128 タップを確認します。パスが長い場合やグローが細い場合は、ループの上限を `256` に変え、`float(i) * 2.0` を `float(i)` に置き換えます。

### パスに沿ってパーティクルを動かす

このフラグメントは、`TrailPoints` 上に 8 個のパーティクルを配置し、時間経過で動かします。`pathPoint` が隣り合うテクセル間を手動で補間するため、動きが滑らかになります。

```glsl
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D TrailPoints;
uniform int TrailCount;
uniform vec2 resolution;
uniform float zTime; // Supplied by Expressions+, or replace with an animated Slider.
varying vec2 vUvScaled;

vec2 pathPoint(float t) {
	float idx = clamp(t, 0.0, 1.0) * 255.0;
	float i0 = floor(idx);
	float i1 = min(i0 + 1.0, 255.0);
	vec2 a = texture2D(TrailPoints, vec2((i0 + 0.5) / 256.0, 0.5)).xy;
	vec2 b = texture2D(TrailPoints, vec2((i1 + 0.5) / 256.0, 0.5)).xy;
	return mix(a, b, idx - i0);
}

void main() {
	vec4 base = texture2D(tDiffuse, vUvScaled);
	float present = step(0.5, float(TrailCount));
	float aspect = resolution.x / max(resolution.y, 1.0);
	vec3 add = vec3(0.0);
	for (int i = 0; i < 8; i++) {
		float fi = float(i);
		float t = fract(zTime * 0.12 + fi / 8.0);
		vec2 p = pathPoint(t);
		float d = length((vUvScaled - p) * vec2(aspect, 1.0));
		float twinkle = 0.6 + 0.4 * sin(zTime * 6.0 + fi * 2.4);
		add += vec3(1.0, 0.75, 0.35) * (1.0 - smoothstep(0.0, 0.02, d)) * twinkle;
	}
	gl_FragColor = vec4(base.rgb + add * present, base.a);
}
```

向きを反転するには `pathPoint(1.0 - t)` を使います。開いたパスで終点から始点へ飛び戻らないようにするには、`t` をクランプするか、`abs(t * 2.0 - 1.0)` で往復させます。閉じたパスでは、`pathPoint` は周回上の `255/256` にあるテクセル `255` で止まります。テクセル `0` までの最後の区間も補間するには、`idx` に `fract(t) * 256.0` を、`i1` に `mod(i0 + 1.0, 256.0)` を使います。

ピッカーの操作、保存 JSON 形式、8 ビットフォールバックの詳細は、[Path プロパティ](/docs/ja/development/shader-properties/#パス)を参照してください。

Gradient、Curve、Palette、および Text は静的プロパティです。Path はレンダーフレームで解決されるため、アニメーションするマスクや Shape+ パスに合わせてエフェクトが動きます。[プロパティコントロール](/docs/ja/development/shader-properties/)では、それらのエディターと保存形式について説明しています。
