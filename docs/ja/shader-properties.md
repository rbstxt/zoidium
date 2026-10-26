# シェーダープロパティ

Shader+ は、ネイティブの Custom Shader プロパティにエディターを追加します。エフェクトを追加し、Shader properties を開き、+ をクリックして、ZOIDIUM の下にある種類を選択します。プロパティを右クリックすると、名前変更、複製、または削除ができます。または "Property settings…" を選択して、名前、種類、およびその種類が使用する設定(範囲、デフォルト、選択肢、グループ、ツールチップ、可視性)を編集します。適用すると 1 つの Undo ステップを記録します。
種類の選択は、そのプロパティのネイティブストレージ型を共有します。数値の種類を変更しても、すべてのキー、トゥイーン、および式が保持されます。デフォルトは作成メタデータです。変更しても現在の値は上書きされません。

## 数値とベクトル

Slider は範囲バー付きの NUMBER です。Angle はラジアンを保存し、度数法で表示します。Toggle(off/on メニュー)と Dropdown は NUMBER 値を保存します。そのエディターは整数を書き込み、新しいキーは Hold を使用します。これらのエディターを接続しても、評価値を丸めたり、古いキーの補間を変更したりしません。小数の式は GLSL にそのまま届きます:

```glsl
uniform float Mode;
uniform float Enabled;
// Use these in main(), when rounding or a threshold is wanted:
// int mode = int(Mode + 0.5);
// bool enabled = Enabled > 0.5;
```

`uniform int` と `uniform bool` も動作します。Three r91 は、アクティブな GLSL uniform 型から GL セッターを選択します。整数 uniform は GL の整数変換を使用します。シェーダーが小数値を必要とする場合は float uniform を使用します。

Dropdown 項目は、名前を変更してもインデックスを保持します。`Mode_Linear` は、include 展開後のシェーダーがそのトークンを参照する場合にのみ定数として出力されます。コメントは対象外です。Static dropdown はネイティブの OPTION ストレージを使用し、コンパイル時の `#define Mode index` を使用します。Seed はランダム化ボタンを追加します。Color + alpha はストレート RGBA vec4 です。Point(UV/画素メタデータ付き vec2)はメニューに表示されなくなりました。保存済みの Point プロパティは引き続き読み込み、vec2 としてバインドします。

グループは、ネイティブ一覧内に折りたたみ可能な見出しとして表示されます。ツールチップは行に表示されます。"Visible when" は、そのエフェクトの別のプロパティと、その行を表示する値を選択します。例として `1; 2` を指定した Mode があります。これは `{"property":"Mode","values":[1,2]}` として保存され、コントローラーのネイティブ評価値を使用し、エディターにのみ影響します。

## グラデーション

Gradient は静的 TEXT JSON を保存します:

```json
{"stops":[{"position":0,"color":[0,0,0,1]},{"position":1,"color":[1,0.5,0,1]}],"interpolation":"linear","space":"srgb","cyclic":false}
```

エディターは Node Effect の Color Ramp ウィジェットを再利用します。ストップをドラッグし、矢印キーを使用し、ストップを追加/削除し、またはその位置、色、アルファを編集します。補間は constant、linear、ease、または cardinal です。色空間は sRGB、linear RGB、および OKLab です。周期的グラデーションは最終ストップを最初に接続し、リングプレビューを表示します。テクスチャはストレートアルファの 256×1 RGBA8 です。

```glsl
precision highp float;
// #include <zoidium/gradient>
uniform sampler2D Ramp;
varying vec2 vUv;
void main() { gl_FragColor = zGradient(Ramp, vUv.x); }
```

座標を折り返すには `zGradientCycle(Ramp,t)` を使用します。`zGradient` は座標をクランプします。

## カーブとパレット

Curve は、`points`、`range`、`channels`、および共有 Color Curves チャンネル配列 `composite`、`red`、`green`、`blue`、`alpha` を持つ静的 TEXT JSON を保存します。共有 Color Curves エディターがポイント編集を提供します。Single は 1 本のカーブを使用します。RGBA は各 RGB チャンネルの前にコンポジットを適用し、アルファを独立に評価します。Range は正規化カーブ出力を選択した単位に対応付けます。

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

Shader+ は範囲 uniform を挿入し、既知の Curve プロパティに対する 2 引数ヘルパー呼び出しに追加します。3 引数呼び出しでは範囲を明示的に指定できます。テクスチャは 1024×1 です。エディターレンダラーがサポートを報告する場合は、フィルター可能/レンダリング可能なハーフフロートを使用します。そうでない場合、RGBA8 は 1/255 の正規化出力精度です。範囲の再対応付けは両パスとも GLSL で行われるため、0–1 の範囲外の値も単位を保持します。変更は、再コンパイルなしで LUT と範囲を更新します。

Palette は、最大 16 色のストレート RGBA カラーとして `{"colors":[[1,0,0,1],[0,0,1,1]]}` を保存します。`uniform vec4 Colors[16]; uniform int Colors_count;` を宣言します。スウォッチストリップは、再コンパイルなしで配列を変更します。

## テキスト

Text は、`text`、`font`、`size`、`align`、`lineHeight`、`letterSpacing`、`mode`、および `sdf` を持つ静的 TEXT JSON を保存します。フォントキーは CM3 プリセットまたはプロジェクトフォントアセットを指します。ネイティブフォントメニューを使用するか、カスタムの TTF/OTF/WOFF ファイルを選択します。行には、複数行テキスト、画素単位のサイズ、配置、行の高さ、および em 単位の字間が含まれます。フォント変更を含め、確定した各変更は完全な JSON プロパティに対する 1 つの Undo ステップです。

```glsl
precision highp float;
// #include <zoidium/text>
uniform sampler2D Title;
uniform float Title_aspect;
uniform vec2 Title_size;
varying vec2 vUv;
void main() { gl_FragColor = vec4(vec3(1.0), zText(Title, vUv)); }
```

Layout モードは文字列全体をラスタライズします。Atlas モードは、改行を除く固有文字を出現順に等セルグリッドに配置します。`Title_grid` と `Title_count` を提供します。`zGlyph(Title,Title_grid,index,uv)` を使用します。テクスチャの最長辺は 2048 画素に制限されます。テキストは 2000 文字まで、アトラスは 256 グリフまでです。グリフ輪郭は CSS フォントではなく CM3 のフォントアセット由来です。SDF は符号付き距離をアルファに保存し、エッジを 0.5 とします。SDF では、アルファをカバレッジとして扱う代わりに、0.5 周辺で `smoothstep` を使用します。

Text は、その JSON が変更された場合にのみ再ベイクします。エクスポート準備はフォント読み込みとラスタライズを待ちます。フォント失敗は、英語のシェーダーエラーでエクスポート準備を停止します。Shader+ はフォントアセットの読み込み/解放参照を所有し、プロパティ削除、エフェクトのアンロード、または無効化時にテクスチャとともに解放します。Gradient、Curve、Palette、および Text は、このリリースでは静的です。

## AlipFX 移行

`plugins/alipfx/controls.json` は、ビルド時に 5 つの代表的なエフェクトに対応付けます。エディターメタデータのみを追加します。シェーダーソース、ネイティブ型、値、キーフレーム、式、および uniform 名は変更されません。既存の保存済みエフェクトは独自の定義を保持します。対応付けはプロジェクトを書き換えません。

ProGradient の `Color_1` から `Color_8` のような番号付き色を置き換えるには、Gradient プロパティを作成し、既存の順序で色をストップにコピーしてから、シェーダーの補間ルーチンを `zGradient(Ramp,t)` に置き換え、その include を追加します。色空間、ストップ間隔、色相挙動、およびアルファを明示的に合わせます。これはシェーダー移行であり、画素が変わることがあります。正確な互換性が必要な場合は古いシェーダーを保持します。メタデータ対応付けは、これらのシェーダー編集を一切行いません。

## グラデーションとカーブのエディター

Gradient は共有インラインストップエディターを使用するようになりました。チェッカーボードプレビュー、個別の不透明度ストップ、中点ダイヤモンド、S/V 正方形、色相/アルファストリップ、hex/RGB フィールド、およびローカルプリセットを含みます。Reverse は両方のストップ一覧を反転します。Distribute は選択した一覧を等間隔に配置します。ストップの編集はライブでプレビューし、1 つの Undo ステップを確定します。周期的グラデーションは Bar/Wheel ビュー、三角マーカー、Interpolate、および Cycle 反復を提供します。ビューはエディターの状態のみです。Interpolate は linear または constant を選択します。補間メニューは引き続き ease と cardinal を提供します。

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

中点は、そのストップに続く区間に属します。デフォルトは 0.5 です。個別の不透明度ストップは、カラーストップのアルファを上書きします。`repetitions` は有限で 1 以上、デフォルトは 1 で、`Name_repetitions` を通じて `zGradientCycle(Name,t)` に影響します。`zGradient(Name,t)` は引き続き単一バーをサンプリングします。`zGradientCycle` への明示的な第 3 引数は、そのプロパティの反復を上書きします。反復の編集はシェーダーを再コンパイルしません。

単一チャンネルカーブは、デフォルトで塗りつぶしの Graph を使用します。数値の 0/1 x ラベル、範囲基準の y ラベル、ポイントコントロール、Handles、Random、Reset、および形状プリセット付きです。プロパティを右クリック > Property settings > Curve editor で Graph または Curves を選択します。RGBA はチャンネル基準の Curves エディターを保持します。任意の `zoidiumShader.axis:["Start","Peak","End"]` はグラフの x 軸に名前を付けます。2 つのラベルも受け付けます。軸ラベルはメタデータであり、時間またはカーブサンプリングの変更ではありません。Property settings はその配列を JSON として受け付けます。

ポイントは、明示的な 3 次ベジェハンドルを `[x,y,null,{"in":[x,y],"out":[x,y]}]` として持てます。ハンドルは絶対正規化座標です。各ハンドルは任意です。X ハンドルは区間内に制約され、一意な x から y への対応付けのために順序付けされます。y は 0–1 にクランプされます。明示的なハンドルのない区間は、元の単調な Color Curves サンプラーを使用します。Handles の表示やエディタースタイルの変更は、ポイントデータを書き込みません。Random は 5 つの静的ポイントを 1 回作成します。レンダリングがランダムなポイントを生成することはありません。

入力輝度ヒストグラムは未実装です。`zoidiumShader.histogram` は予約済みで、このバージョンでは効果がありません。
