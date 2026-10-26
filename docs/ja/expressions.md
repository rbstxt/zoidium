# Expressions+

Expressions+ は、Zoidium の外部の拡張レイヤーを通じて CM3 を拡張します。ネイティブプロパティの横にあるアニメーションボタンを Alt キーを押しながらクリックし、式を入力します。フィールドからフォーカスを外すと確定します。最後の式の文がその値を返します。明示的な `return` も使えます。失敗した式は、そのプロパティ自身のキー値を使います。行のツールチップに英語のエラーを表示します。各固有のソースとエラーの組み合わせは 1 回だけ記録します。診断キャッシュには上限があります。

## 言語

`var`、`let`、`const`、アロー関数、通常の関数、既定/レストパラメーター、テンプレートリテラル、分割代入、スプレッド、オプショナルチェーン、条件分岐、ループ、switch、`throw` を使います。例:

```js
const offsets = [1, 2, 3];
let total = 0;
for (const offset of offsets) total += offset;
value + total * sin(time)
```

Class、import、async/await、ジェネレーター、`with`、`debugger`、`this` は拒否されます。到達不能な分岐内も含め、不明な自由識別子はコンパイル時の ReferenceError のままです。`window`、`globalThis`、`document`、`self`、`top`、`parent`、`frames`、`Function`、`eval`、`Date` は利用できません。コンパイラは、一時的なサンドボックス化 iframe から取り出した Function コンストラクターを使います。その iframe を削除してから、式をコンパイルして評価します。

プロパティ読み取りは CM3 の動作を保ちます。これには `constructor`、`__proto__`、`prototype` の計算読み取りも含みます。これは 23 を返します:

```js
var key = "con" + "structor";
[1, 2, 3][key] === [4][key] ? 23 : 0
```

セキュリティ上の例外: Function、AsyncFunction、GeneratorFunction、AsyncGeneratorFunction、eval の呼び出しは式エラーです。別のレルムのコンストラクター、別名、計算パス、call/apply/bind、コールバック、オプショナル呼び出し、Promise コールバック、文字列メソッドに渡したオブジェクトの Symbol.replace/match/search/split メソッド、タグ付きテンプレート、`new` を経由する場合も同じです。それらのコンストラクターが作った関数を呼び出すことも同じエラーです。通常のコンストラクター値は、引き続き読み取り、比較、保存、返却ができます。動的呼び出しは実行時の呼び出しガードを通ります。CM3 メソッドと Math 関数の同一性はそのまま維持されます。これは、呼び出し強化を加えたホストの分離レルム式モデルであり、任意のサードパーティプラグイン用のサンドボックスではありません。

Expressions+ の構文または API を必要とするプログラムには、合計 10,000,000 のループ/呼び出しステップと、256 呼び出しの再帰制限があります。カウンターは外側のプロパティ読み取りごとにリセットします。参照先の式も対象に含みます。制限の超過は英語の式エラーです。CM3 互換のプログラムは、ネイティブの無制限ループ動作を保持します。そのため有限の従来の式は結果を維持します。

`Array`、`Number`、`String`、`Boolean`、`JSON`、`parseInt`、`parseFloat`、`isFinite`、`isNaN`、`Infinity`、`NaN`、`undefined`、`Math` が利用できます。`Math.random()` は利用できません。既存の `random(seed)` は、CM3 の正確なシード付きハッシュを保持します。再現可能なストリームには、`seedRandom(17, true); random()` を使います。2 番目の引数は、シードをフレームから独立させます。すべての評価は新しいストリームから開始します。ストリームの状態が次のフレームに残ることはありません。

## 値とナビゲーション

`frame` は CM3 のプロパティローカルフレームです。`time` は、所有するクリップの Time プロパティを保持します。単位は秒で、タイムリマッピングを含みます。`value` は、その式の前のプロパティ自身の値です。値とハンドルは、プロジェクトへの書き込みを公開しません。

`thisProperty` は、`value`、`valueAtTime(seconds)`、`velocity`、`speed`、`numKeys`、`key(index)`、`nearestKey(seconds)` を持ちます。キーインデックスは 1 から開始します。キーレコードは `index`、`time`、`value` を含みます。Velocity は 0.01 秒の対称微分です。speed はその大きさです。自身の valueAtTime は、式を経由して再帰せず、元のキーフレームをサンプリングします。

`thisObject` は、所有するオブジェクトまたはエフェクトです。`thisLayer`、`thisClip`、`thisSequence` とその別名 `thisComp` は上位レベルを提供します。ハンドルは次を公開します:

- `.parent` は、最も近い所有オブジェクト用です。`.parent(n)` は、その親から n レベル移動します。自由なブラウザー識別子 `parent` は引き続き利用できません。
- `.layer(nameOrIndex)` は、現在アクティブなビデオレイヤーを選択します。インデックス 1 は最初のビデオトラックです。`layer(nameOrIndex)` はシーケンスから開始します。
- `.effect(name)` はエフェクトを選択します。`effect("Glow")("Radius")` と `effect("Glow").param("Radius")` はパラメーター値を返します。
- `.object(name)` は、シーンまたはグループ内の直接の 3D 子を選択します。
- `.property(name)` はプロパティハンドルを返します。名前には、ストレージキー、ネイティブ表示名、カスタムプロパティ名を使えます。

`prop("path")` はプロパティ値を返します。`/Scene/Cube/Position` はシーケンスから開始します。`../Radius` は親から開始します。`./Position` は所有者から開始します。セグメントは正確な名前を使い、区切り文字は `/` です。`/` を含む名前では、代わりにハンドルメソッドを使う必要があります。クリップをまたぐ読み取りは、同じ絶対シーケンスフレームを使います。対象クリップのローカルフレームに変換します。循環するプロパティリンクはエラーを報告します。失敗した各プロパティは自身のキー値を使います。

## アニメーションヘルパー

既存の CM3 メソッドシグネチャは意味を保持します。特に、`linear(start, end, amount)` と `ease(amount, family, direction)` は変更ありません。無視される追加引数を含みます。Expressions+ の構文または API を使うプログラムでは、クランプされたスカラーまたはベクトル補間には、5 引数の AE 形式 `linear(t, tMin, tMax, a, b)` または `ease(t, tMin, tMax, a, b)` を使います。`easeIn` と `easeOut` も 5 引数を受け付けます。そのパックが有効な場合、既存の Trapcode ヘルパーシグネチャが優先されます。例:

```js
const t = time;
linear(t, 0, 1, 10, 20)
```

`clamp(value, min, max)` は数値または CM3 ベクトルを受け付けます。角度ヘルパーは `degreesToRadians(x)` と `radiansToDegrees(x)` を使います。`lookAt(from, to)` は XYZ オイラー角をラジアンで返します。ローカル +Z がターゲットを指します。

`wiggle(frequency, amplitude, octaves, amplitudeMultiplier, frame)` は、Zoidium の既存の Trapcode 実装を再利用します。そのため、Frequency は既存のフレーム基準の規則を保持します。位置のレシピは次のとおりです:

```js
wiggle(0.05, [20, 20, 0])
```

拡張構文または API を使うプロジェクトは、Expressions+ 依存関係を記録します。[保存済みプロジェクトの互換性](project-compatibility.md#expressions)を参照してください。

## パフォーマンス

実装の予算は、描画と初回コンパイルを除き、1,000 個の単純な式プロパティに対して 95 パーセンタイルで 16 ms です。開発マシンでのヘッドレス Chromium 実行では、20 フレームのウォームアップ後の 100 測定フレームを使います。`const x=sin(time); value + x * 2` に対して中央値 3.5 ms、p95 で 5.8 ms を測定しました。最も遅いサンプルは 10.5 ms でした。ガード付き評価とテスト専用ガードバイパスの交互測定では、1,000 プロパティあたり中央値 0.6 ms のガードコストでした(バイパス中央値 2.9 ms)。これは測定値であり、評価器が強制する期限ではありません。ループとプロパティナビゲーションは、その予算に作業を追加します。

## Sequence Controls

Sequence を開き、Controls を展開します。+ ボタンは Slider、Angle、Checkbox、Color、Point 2D、Point 3D を追加します。コントロールを右クリックすると、名前変更、順序変更、削除、Slider の min/max/step の編集ができます。Angle 値は内部でラジアンを使い、表示は度数法です。Checkbox はネイティブの off/on 値 0 と 1 を使います。コントロール名はシーケンス内で一意である必要があります。シーケンスは 256 個のコントロールをサポートします。

これらはネイティブの動的プロパティです。そのアニメーションボタン、キーフレーム、カーブ、Graph Editor 2、ネイティブ値コントロールを使います。追加、削除、名前変更、順序変更、設定変更、生成リンクの各操作は 1 つの Undo エントリーです。コントロールのキーフレームと式は、保存/再開とシーケンス設定のコピー後も残ります。

同じシーケンス内の任意のレベルの式は次を読み取れます:

```js
controls.Amount * 2
```

空白を含む名前には、`control("Glow radius")` または `controls["Glow radius"]` を使います。数値/ベクトル/カラープロパティの行を右クリックします。Link to control… を選択し、互換性のあるコントロールを選択します。生成された式はコントロールの安定 ID を含むため、その名前変更や順序変更後もリンクは動作し続けます。手書きの名前のみの式は、名前変更後に更新する必要があります。参照先のコントロールを削除すると、式エラーを報告します。プロパティ自身の値を復元します。

Amount という名前の Slider にリンクされたエフェクトの radius の場合:

```js
control("Amount")
```

## ワールドとカメラのリンク

オブジェクトハンドルと所有オブジェクトヘルパーは、`toWorld(point)`、`fromWorld(point)`、`worldPosition()`、`worldRotation()` を持ちます。ポイントは 3 要素の配列です。回転はラジアンの XYZ オイラー角であり、親グループ変換と Track To の適用後です。ワールド読み取りは、要求されたフレームでのネイティブ変換プロパティをサンプリングします。一時的な Three オブジェクト上で制約を解決します。ライブシーンを変更したり、前フレームのポーズを再利用したりしません。ネイティブカメラシェイクと Camera+ の振動/プロジェクションはカメラのコピー上で実行されます。

`object.toScreen(localPoint)` は、コンポジション画素単位で `[x, y, depth]` を返します。原点は左上です。`depth` は正規化デバイス深度であり、near で -1、far で +1 です。そのフレームでのレンダラーのアクティブなネイティブまたは Camera+ カメラが選択されます。対象シーントラックで 3D トラッキングが有効な場合、共有カメラトラックが適用されます。ネイティブシーンレイヤーの位置、スケール、回転が含まれます。`fromScreen([x,y,depth])` は、その対応付けをオブジェクトローカル座標へ逆変換します。往復には返された depth を保持します。ゼロスケール変換は反転できません。3D 所有者のないヘルパーは、所有するシーン内のワールド座標を使います。所有者が 2D レイヤーの場合は、最初のアクティブシーンを使います。

Scene という名前のシーン内の Shape という名前の 3D オブジェクトの中心に、ネイティブ Transform エフェクトの Image 位置を固定するには:

```js
const pixel = layer("Scene").object("Shape").toScreen([0, 0, 0]);
const size = thisComp.property("Resolution").value;
[pixel[0] - size[0] / 2, size[1] / 2 - pixel[1], 0]
```

その Image 回転を Camera+ の Z ロールから駆動するには:

```js
[0, 0, layer("Scene").object("Camera+").worldRotation()[2]]
```

これらのヘルパーは、作成済みのオブジェクト/グループ変換とレンダリングカメラを記述します。リピーターインスタンス、変形頂点、エフェクト後の画像歪み、入れ子のコンポジションの時間対応付けは、座標契約の対象外です。シアーまたは非一様スケールの親チェーンでは、worldRotation は Three の行列分解を使います。そのオイラー角は一意なシアー分解ではありません。

## シェーダー拡張

Custom Shader エフェクトは、元の保存済み GLSL を保持します。Expressions+ は、コンパイラ入力内でのみ、これらの完全行ディレクティブを正確に展開します:

```glsl
// #include <zoidium/hash>
// #include <zoidium/noise>
// #include <zoidium/color>
// #include <zoidium/sdf>
```

チャンクは 1 回だけ出力されます。Noise は hash を自動的に含みます。GLSL ES 1.00 ライブラリは、`zHash(float/vec2/vec3)`、`zNoise(vec2/vec3)`、`zSrgbToLinear(vec3)`、`zLinearToSrgb(vec3)`、`zRgbToHsv(vec3)`、`zHsvToRgb(vec3)`、`zSdCircle(vec2,float)`、`zSdSphere(vec3,float)`、`zSdBox(vec2,vec2)`、`zSdBox(vec3,vec3)`、`zSmoothUnion(float,float,float)` を持ちます。Hash/noise は 0–1 を返します。HSV は 0–1 の色相を使います。SDF 距離は内部で負です。色変換は RGB に作用し、アルファはシェーダー作成者に委ねます。

`uniform float zTime;` と `uniform float zFrame;` を宣言すると、所有クリップの Time を秒単位と、エフェクトローカルフレームを受け取ります。スカラー `int` uniform も受け付けます。ゼロ方向に切り捨てます。`ctl_<Name>` を float、int、vec2、vec3、vec4 として宣言すると、Sequence Control にバインドします。名前内の非 ASCII/空白/句読点文字は `_` になります。正規化後の名前が衝突するとエラーを報告します。コントロールの次元は一致する必要があります。Color は RGB を vec3 として、または不透明 RGBA を vec4 としてバインドします。Point 2D/3D は vec2/vec3 にバインドします。カンマ区切りの uniform 宣言を受け付けます。自動バインドは uniform 配列をサポートしません。

Amount という名前の Slider の場合:

```glsl
precision highp float;
uniform float zTime;
uniform float zFrame;
uniform float ctl_Amount;
varying vec2 vUvScaled;
// #include <zoidium/noise>
void main() {
  float n = zNoise(vUvScaled * 8.0 + vec2(zTime));
  gl_FragColor = vec4(vec3(ctl_Amount * n), 1.0);
}
```

ネイティブカスタムプロパティ式と Node Effect の公開パラメーターは、同じ式エンジンを使います。これらの宣言/include のない既存シェーダーは、正確に元のコンパイラ入力とネイティブ uniform を受け取ります。シェーダーエラーは CM3 のシェーダーエラーハンドラーを通じて表示されます。不足しているコントロールは、互換性のあるコントロールが存在すればすぐに回復できます。
