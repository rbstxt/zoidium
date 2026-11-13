# シェーダープロパティ

Time sample プロパティの使い方は[別の時刻のレイヤーを読み取る](shader-time-samples.md)を参照してください。

Shader+ は、ネイティブの Custom Shader プロパティにエディターを追加します。エフェクトを追加し、Shader properties を開き、+ をクリックします。ZOIDIUM の下にある種類を選択します。プロパティを右クリックすると、名前変更、複製、削除ができます。または "Property settings…" を選択します。名前、種類、その種類が使う設定(範囲、既定、選択肢、グループ、ツールチップ、可視性)を編集します。適用すると 1 つの Undo ステップを記録します。
種類の選択は、そのプロパティのネイティブストレージ型を共有します。数値の種類を変更しても、すべてのキー、トゥイーン、式が保持されます。既定は作成メタデータです。変更しても現在の値は上書きされません。


Shader+ の種類メタデータがないネイティブ数値は、Slider の範囲設定を表示します。
他のネイティブ型は、種類を選ぶまで Native と表示されます。
編集せずに Apply をクリックしても、定義と現在の値は変わりません。

## 数値とベクトル

Slider は範囲バー付きの NUMBER です。Angle はラジアンを保存し、度数法で表示します。Toggle と Dropdown は NUMBER 値を保存します。Toggle の既定の表示は off/on メニューです。
Property settings の Display = Checkbox を選ぶと、1 回のクリックで切り替えられます。
Checkbox の表示はエディターのテーマに従います。
Display を変更しても、現在の値、アニメーション、式、シェーダー出力は変わりません。そのエディターは整数を書き込みます。新しいキーは Hold を使います。これらのエディターを接続しても、評価値を丸めたり、古いキーの補間を変更したりしません。小数の式は GLSL にそのまま届きます:

```glsl
uniform float Mode;
uniform float Enabled;
// Use these in main(), when rounding or a threshold is wanted:
// int mode = int(Mode + 0.5);
// bool enabled = Enabled > 0.5;
```

`uniform int` と `uniform bool` も動作します。Three r91 は、アクティブな GLSL uniform 型から GL セッターを選択します。整数 uniform は GL の整数変換を使います。シェーダーが小数値を必要とする場合は float uniform を使います。

Dropdown 項目は、名前を変更してもインデックスを保持します。`Mode_Linear` は、include 展開後のシェーダーがそのトークンを参照する場合にだけ定数として出力されます。コメントは対象外です。Static dropdown はネイティブの OPTION ストレージを使い、コンパイル時の `#define Mode index` を使います。Seed はランダム化ボタンを追加します。Color + alpha はストレート RGBA vec4 です。Point(UV/画素メタデータ付き vec2)はメニューに表示されなくなりました。保存済みの Point プロパティは引き続き読み込み、vec2 としてバインドします。

Slider、Seed、Time sample、Angle の設定には Decimals と Snap を表示します。Time sample の設定には、Minimum、Maximum、Step も表示します。Minimum と Maximum は行エディターの値を制限します。Step はドラッグの倍率と矢印キーの増分です。Decimals は表示する小数点以下の桁数を 0 から 100 で指定します。Snap は、確定する行の編集値を Snap の倍数に丸めます。グリッドは Minimum の設定値から始まります。未設定の場合は 0 から始まります。ちょうど中間の値は 0 から遠い方へ丸めます。Snap が空欄または 0 の場合、その項目は定義から削除されます。Snap が作用するのは新しい編集だけです。他の種類から Time sample に変換すると、範囲の指定なしで単位の Step から始まります。古い Slider の範囲がオフセットを制限しません。範囲を付けるには値を入力します。行の範囲や Snap を指定しても、行を編集しない限り、保存された値、キーフレーム、シェーダー出力は変わりません。

## リセットの動作

Shader エフェクトのネイティブな Properties の reset は、フラグメントシェーダーのコードを保持します。
Name や Enabled など、その他のネイティブプロパティはリセットします。
Shader properties の見出しには、別の **Reset custom properties to defaults** ボタンがあります。
このボタンは、定義とグループを保持したまま、すべてのカスタムコントロールを 1 回の操作でリセットします。

カスタムリセットはキーフレームと式を削除し、フレーム 0 に静的な値を復元します。
現在のフレームにキーを追加する方式ではなく、After Effects の Reset の動作に合わせています。
`zoidiumShader.default` がある場合、リセットはその値を使います。
それ以外の場合は、プロパティ定義の値かネイティブの既定値を使います。
ベクトルコントロールはすべての成分をリセットします。Gradient、Curve、Palette、Text は既定の JSON 値を復元します。
Undo は、以前の値、キーフレーム、式のソースをまとめて復元します。

## グループと表示条件

グループはネイティブ一覧内に折りたたみ可能な見出しとして表示されます。ツールチップは行に表示されます。
Shader properties の **+** リストには、検索でも見つかる **Group** があります。
この操作は、選択した行を新しい名前のグループへまとめて移動します。Undo は 1 回分です。
少なくとも 1 つのプロパティを選択し、未使用のグループ名を指定する必要があります。
ロック中のグループでは、プロパティを出し入れできません。

**Visible when** は、同じエフェクト内の別のプロパティを選択します。
**Has value** には、完全一致の値、比較、両端を含む数値範囲を指定できます。
セミコロンは候補を OR で結びます。

| 入力 | 行を表示するコントローラーの値 |
| --- | --- |
| `> 5.5` | 5.5 より大きい |
| `>= 1` | 1 以上 |
| `< 0` | 0 より小さい |
| `<= 2` | 2 以下 |
| `!= 3` | 3 と異なる |
| `= 4` | 4 と等しい |
| `1..5` | 1 以上 5 以下 |
| `1; 2; > 5.5` | 1 または 2 と等しいか、5.5 より大きい |

比較には、アニメーションや式を含むコントローラーのネイティブ評価値を使います。
演算子、比較対象の数値、範囲の順序が無効な場合、Apply で変更を保存する前にエラーを表示します。
既存の完全一致条件は厳密な一致を維持します。演算子の文字を含む保存済み文字列も同じです。
表示条件が影響するのはエディターの行だけです。非表示のコントロールも、現在の値をシェーダー、Preview cache、書き出しに渡します。

完全一致の値は、保存形式 `{"property":"Mode","values":[1,2]}` を維持します。
新しい比較は、`{"op":">","value":5.5}` や `{"op":"range","min":1,"max":5}` を格納する `conditions` 配列を追加します。
`values` と `conditions` の配列は OR の候補です。どれかが一致すると行を表示します。

グループにも同じ条件を設定できます。グループに所属する行を右クリックして Group settings… を選択します。
コントローラーの一覧には、同じエフェクト内のグループに属さないプロパティだけが表示されます。
条件は所属するすべてのプロパティに保存されます。そのため、保存、再読み込み、複製、Undo、Redo でも条件は保持されます。
行が表示されるのは、自身の条件と所属グループの条件の両方を満たす場合だけです。
非表示のグループは、見出しとすべての子を隠します。Show hidden は、非表示のグループも表示します。
プロパティを別のグループに移すと、そのグループの条件が付きます。グループから外すと、条件は外れます。
コントローラーのプロパティが見つからない場合（削除や名前の変更のあとなど）、グループは Show hidden をオンにするまで隠れたままです。

## シェーダーでのキーフレームデータ

Slider と Point コントロールはネイティブの動的プロパティです。そのため、ネイティブの行とまったく同じように式を受け付けます。コントロールの横にあるアニメーションボタンを Alt キーを押しながらクリックします。別のプロパティを読み取る式を入力します。uniform は、評価値から毎フレーム更新されます。

Ball という名前のレイヤーの動きで Point コントロールを駆動するには、次を使います:

```js
thisComp.layer("Ball").property("Position").velocity
```

`velocity` は秒単位で報告します。スカラープロパティには数値を返します。ベクトルプロパティには配列を返します。`speed` は大きさを報告します。`valueAtTime(seconds)` は過去をサンプリングします。`time - thisComp.frameDuration` は 1 フレーム前です:

```js
thisComp.layer("Ball").property("Position").valueAtTime(time - thisComp.frameDuration)
```

同じエフェクトのコントロールには、`thisObject` でアドレス指定します。例として `thisObject.property("Source").velocity` があります。動作するシェーダーから始めるには、New from template を選びます。次に Velocity from a property を選びます。テンプレートは Point コントロールを宣言します。このレシピをコメントで繰り返します。

## グラデーション

Gradient は静的 TEXT JSON を保存します:

```json
{"stops":[{"position":0,"color":[0,0,0,1]},{"position":1,"color":[1,0.5,0,1]}],"interpolation":"linear","space":"srgb","cyclic":false}
```

エディターは Node Effect の Color Ramp ウィジェットを再利用します。ストップをドラッグします。矢印キーを使います。ストップを追加/削除します。その位置、色、アルファを編集します。補間は constant、linear、ease、cardinal です。色空間は sRGB、リニア RGB、OKLab です。周期的グラデーションは最終ストップを最初に接続し、リングプレビューを表示します。テクスチャはストレートアルファの 256×1 RGBA8 です。

```glsl
precision highp float;
// #include <zoidium/gradient>
uniform sampler2D Ramp;
varying vec2 vUv;
void main() { gl_FragColor = zGradient(Ramp, vUv.x); }
```

座標を折り返すには `zGradientCycle(Ramp,t)` を使います。`zGradient` は座標をクランプします。

## カーブとパレット

Curve は、`points`、`range`、`channels`、共有 Color Curves チャンネル配列 `composite`、`red`、`green`、`blue`、`alpha` を持つ静的 TEXT JSON を保存します。共有 Color Curves エディターがポイント編集を提供します。Single は 1 本のカーブを使います。RGBA は各 RGB チャンネルの前にコンポジットを適用し、アルファを独立に評価します。Range は正規化カーブ出力を選択した単位に対応付けます。

```glsl
precision highp float;
// #include <zoidium/curve>
uniform sampler2D Response;
varying vec2 vUv;
void main() {
  float value = zCurve(Response, vUv.x);
  gl_FragColor = zCurves(Response, vec4(value));
}
```

Shader+ は範囲 uniform を挿入します。既知の Curve プロパティに対する 2 引数ヘルパー呼び出しに追加します。3 引数呼び出しでは範囲を明示的に指定できます。テクスチャは 1024×1 です。エディターレンダラーがサポートを報告する場合は、フィルター可能/レンダリング可能なハーフフロートを使います。そうでない場合、RGBA8 は 1/255 の正規化出力精度です。範囲の再対応付けは両パスとも GLSL で行われます。そのため 0–1 の範囲外の値も単位を保持します。変更は、再コンパイルなしで LUT と範囲を更新します。

Palette は、最大 16 色のストレート RGBA カラーとして `{"colors":[[1,0,0,1],[0,0,1,1]]}` を保存します。`uniform vec4 Colors[16]; uniform int Colors_count;` を宣言します。スウォッチストリップは、再コンパイルなしで配列を変更します。

## テキスト

Text は、`text`、`font`、`size`、`align`、`lineHeight`、`letterSpacing`、`mode`、`sdf` を持つ静的 TEXT JSON を保存します。フォントキーは CM3 プリセットまたはプロジェクトフォントアセットを指します。ネイティブフォントメニューを使うか、カスタムの TTF/OTF/WOFF ファイルを選択します。行には、複数行テキスト、画素単位のサイズ、配置、行の高さ、em 単位の字間が含まれます。フォント変更を含め、確定した各変更は完全な JSON プロパティに対する 1 つの Undo ステップです。

```glsl
precision highp float;
// #include <zoidium/text>
uniform sampler2D Title;
uniform float Title_aspect;
uniform vec2 Title_size;
varying vec2 vUv;
void main() { gl_FragColor = vec4(vec3(1.0), zText(Title, vUv)); }
```

Layout モードは文字列全体をラスタライズします。Atlas モードは、改行を除く固有文字を出現順に等セルグリッドに配置します。`Title_grid` と `Title_count` を提供します。`zGlyph(Title,Title_grid,index,uv)` を使います。テクスチャの最長辺は 2048 画素に制限されます。テキストは 2000 文字まで、アトラスは 256 グリフまでです。グリフ輪郭は CM3 のフォントアセット由来であり、CSS フォント由来ではありません。SDF は符号付き距離をアルファに保存し、エッジを 0.5 とします。SDF では、アルファをカバレッジとして扱う代わりに、0.5 周辺で `smoothstep` を使います。

Text は、その JSON が変更された場合にだけ再ベイクします。書き出し準備はフォント読み込みとラスタライズを待ちます。フォント失敗は、英語のシェーダーエラーで書き出し準備を停止します。Shader+ はフォントアセットの読み込み/解放参照を所有します。プロパティ削除、エフェクトのアンロード、無効化時にテクスチャとともに解放します。Gradient、Curve、Palette、Text は、このリリースでは静的です。

## パス

Path は、レイヤーマスクまたは Shape+ パスを参照する TEXT JSON を保存します。行には参照先のレイヤーとパスが表示され、欠落時は Missing source と表示します。ソース種別(Mask または Shape+ path)を選び、レイヤー、マスクまたはパスの順に指定します。確定した各変更は完全な JSON 値に対する 1 つの Undo ステップです。

`Name` という Path プロパティごとに、シェーダーは以下を受け取ります:

```glsl
uniform sampler2D NameCoverage; // シェーダーの UV 空間でのカバレッジ
uniform sampler2D NamePoints;   // 256 等間隔点、xy は UV 空間
uniform float NameLength;        // u 単位でのパス長
uniform int NameCount;          // サンプル点数、欠落時は 0
```

Coverage はフェザー適用済みマスクアルファ(または塗りつぶした Shape+ パス)をシェーダーの UV 空間にリサンプルしたものです。Points は弧長で等間隔に配置されます。開いたパスは端点を保持します。Points テクスチャは 256x1 RGBA float で、nearest フィルタでサンプルします。Length はマスク空間長をソースレイヤー幅で割った値です。float テクスチャが使えない場合、Points は 8 ビットにフォールバックし、1 回だけ警告します。Coverage は常に 8 ビットです。

パスはレンダーフレームで解決されるため、アニメーションするマスクやパスがエフェクトを動かします。欠落または削除されたソースは空のカバレッジ、カウント 0、目に見えるシェーダーエラーを結び付けます。サンプリングはレンダーしないため Path プロパティがレンダー循環を作ることはありません。Plexus や Particular のエミッターには同じサンプル表現(256 点と長さ)を再利用できます。エミッター結び付けはこのリリースに含まれません。

例: パスに沿ったグロー描画。

```glsl
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D GlowPathCoverage;
uniform sampler2D GlowPathPoints;
uniform int GlowCount;
varying vec2 vUvScaled;
void main(){
  vec4 base = texture2D(tDiffuse, vUvScaled);
  float cov = texture2D(GlowPathCoverage, vUvScaled).a;
  float d = 1e9;
  for (int i = 0; i < 128; i++) {
    vec2 p = texture2D(GlowPathPoints, vec2((float(i) * 2.0 + 0.5) / 256.0, 0.5)).xy;
    d = min(d, distance(vUvScaled, p));
  }
  float glow = (1.0 - smoothstep(0.0, 0.12, d)) * step(0.5, float(GlowCount));
  vec3 col = base.rgb + vec3(1.0, 0.55, 0.2) * glow * (0.25 + 0.75 * cov);
  gl_FragColor = vec4(col, base.a);
}
```

フレームが正方形でない場合、距離を先に `vec2(aspect, 1.0)` でスケールします。ループは 1 点おきに 128 タップします。パスが長くグローが細い場合は 256 点すべてを使います。

## AlipFX 移行

`plugins/alipfx/controls.json` は、ビルド時に 5 つの代表的なエフェクトに対応付けます。エディターメタデータだけを追加します。シェーダーソース、ネイティブ型、値、キーフレーム、式、uniform 名は変更されません。既存の保存済みエフェクトは独自の定義を保持します。対応付けはプロジェクトを書き換えません。

ProGradient の `Color_1` から `Color_8` のような番号付き色を置き換えるには、Gradient プロパティを作成します。既存の順序で色をストップにコピーします。シェーダーの補間ルーチンを `zGradient(Ramp,t)` に置き換え、その include を追加します。色空間、ストップ間隔、色相挙動、アルファを明示的に合わせます。これはシェーダー移行であり、画素が変わる場合があります。正確な互換性が必要な場合は古いシェーダーを保持します。メタデータ対応付けは、これらのシェーダー編集を一切行いません。

## グラデーションとカーブのエディター

Gradient は共有インラインストップエディターを使うようになりました。チェッカーボードプレビュー、個別の不透明度ストップ、中点ダイヤモンド、S/V 正方形、色相/アルファストリップ、hex/RGB フィールド、ローカルプリセットを含みます。Reverse は両方のストップ一覧を反転します。Distribute は選択した一覧を等間隔に配置します。ストップの編集はライブでプレビューします。1 つの Undo ステップを確定します。周期的グラデーションは Bar/Wheel ビュー、三角マーカー、Interpolate、Cycle 反復を提供します。ビューはエディターの状態だけです。Interpolate は linear または constant を選択します。補間メニューは引き続き ease と cardinal を提供します。

任意のグラデーション JSON フィールドは次のとおりです:

```json
{
  "stops": [{"position":0,"color":[1,0,0,1],"midpoint":0.3},
            {"position":1,"color":[0,0,1,1]}],
  "opacityStops": [{"position":0,"alpha":0,"midpoint":0.5},
                   {"position":1,"alpha":1}],
  "cyclic": true,
  "repetitions": 3
}
```

中点は、そのストップに続く区間に属します。既定は 0.5 です。個別の不透明度ストップは、カラーストップのアルファを上書きします。`repetitions` は有限で 1 以上であり、既定は 1 です。`Name_repetitions` を通じて `zGradientCycle(Name,t)` に影響します。`zGradient(Name,t)` は引き続き単一バーをサンプリングします。`zGradientCycle` への明示的な第 3 引数は、そのプロパティの反復を上書きします。反復の編集はシェーダーを再コンパイルしません。

単一チャンネルカーブは、既定で塗りつぶしの Graph を使います。数値の 0/1 x ラベル、範囲基準の y ラベル、ポイントコントロール、Handles、Random、Reset、形状プリセット付きです。プロパティを右クリックします。Property settings > Curve editor で Graph または Curves を選択します。RGBA はチャンネル基準の Curves エディターを保持します。任意の `zoidiumShader.axis:["Start","Peak","End"]` はグラフの x 軸に名前を付けます。2 つのラベルも受け付けます。軸ラベルはメタデータであり、時間またはカーブサンプリングの変更ではありません。Property settings はその配列を JSON として受け付けます。

ポイントは、明示的な 3 次ベジェハンドルを `[x,y,null,{"in":[x,y],"out":[x,y]}]` として持てます。ハンドルは絶対正規化座標です。各ハンドルは任意です。X ハンドルは区間内に制約されます。一意な x から y への対応付けのために順序付けされます。y は 0–1 にクランプされます。明示的なハンドルのない区間は、元の単調な Color Curves サンプラーを使います。Handles の表示やエディタースタイルの変更は、ポイントデータを書き込みません。Random は 5 つの静的ポイントを 1 回作成します。レンダリングがランダムなポイントを生成することはありません。

入力輝度ヒストグラムは未実装です。`zoidiumShader.histogram` は予約済みであり、このバージョンでは効果がありません。
