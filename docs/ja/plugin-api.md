# Zoidium プラグイン API（簡易版）

プラグインには 5 つの種類と、隠されたコア種類が 1 つあります。
完全なドキュメントは後日提供します。このファイルでは、コントラクトと作成方法を説明します。

## 種類

| kind | 追加内容 | 例 | JS |
| --- | --- | --- | --- |
| shader-pack | 単一シェーダーとマルチシェーダーグループ | AlipFX, CCFX, AfterClip | No |
| native-fx | 時間操作を含むマルチパスエフェクト | Native FX, Layer Input | Yes |
| object | 3D 形状とコンテナー | Geometry+, Effector, Text+, Light+ | Shapes yes |
| material-pack | 3D マテリアル | Material+ | Yes |
| extension | パネルを含むその他すべて | Player+, Easing+, Particles+ | Yes |
| core | 隠された組み込み extension | Zoidium Core | Yes |

Particles+ はスプライトアセットを提供するため、extension に分類されます。

## 共通マニフェストフィールド

- kind: 上の表のいずれか。新規プラグインでは必須です。
- visibility: visible（既定）または hidden。core は hidden でなければなりません。
- alwaysEnabled: true は常時有効で無効化できないことを意味します。core は true でなければなりません。
- phase, coreScripts: core のみ。読み込み順序を記録します。
  実際の順序は zoidium/runtime-config.js にあり、
  plugins/core/manifest.json と一致しなければなりません。

種類ごとの必須セクションは tools/validate-plugin-manifests.js が検査します。
不足があると pnpm run check:plugin-manifests が失敗します。

## 種類ごとの作成方法

スキャフォールドコマンド（レジストリーには触れず、次の手順を表示します）:

```bash
node tools/new-plugin.js --kind=native-fx --id=my-filter --name="My Filter"
node tools/new-plugin.js --kind=shader-pack --id=my-pack
node tools/new-plugin.js --kind=native-fx --template=temporal --id=my-time-fx
```

### shader-pack: エフェクトとグループ

- 単一エフェクトは effects[] を使います（1 つのシェーダーと 1 つのプリセット）。
  グループは groups[] を使います（1 つのプリセットと N 個のシェーダー）。
- 純粋な宣言のみで、JavaScript は不要です。CCFX（plugins/ccfx/）がリファレンスです。
- tools/build-afterclip-plugin.js のような一括インポーターがパックダンプを変換します。

### native-fx: フィルターとテンポラル

- filter（通常の画像エフェクト）: シェーダーの URL、uniform、プロパティ、update を指定して ZoidiumPluginApis.defineFilter
  を呼び出すだけです。
  plugins/native-fx/effects/radialblurspin.js を参照してください。
- 直接操作のビジュアルエディターが必要なフィルターは、
  `ZoidiumPluginApis.propertyControls.register()` でレンダラーを登録できます。
  プロパティには標準の CM3 ストレージ型を保持し、その `zoidiumControl` フィールドに登録済み id を設定します。
  レンダラーは CM3 のプロパティリスト内に留まり、通常の履歴フックを使います。
  plugins/native-fx/effects/colorcurves.js を参照してください。
- temporal（時間操作）: kind に time-offset または posterize-time を指定して ZoidiumPluginApis.defineTemporal
  を呼び出すだけです。
  ホスト（plugins/core/temporal-render.js）が演算子を適用するため、作成者がフレームに直接触れることはありません。
  timeoffset.js と posterizetime.js を参照してください。
  ホストは、フレームサンプラーを含むシーケンスを含め、具体的な各レイヤーをマッピング先の入力時刻で 1 回だけ評価します。
  Composite と Precomp+ の子は、各サンプラータップを含め、その時刻を継承します。
  プロパティコントロールは明示的なフレームを読み取ります。編集中のビューポートは、描画前に
  そのレイヤーを再生ヘッド位置で更新します。シーケンスのレンダリング後は、コンテンツツリー全体を復元しません。
  サンプラーは、中断されたパスが読み取ったトランスフォームと
  エフェクト uniform を、その子孫を再評価せずに復元します。
  1 つの入力フレームにマッピングされるタップはキャプチャを共有し、個別の重みを保持します。
  サンプラーのないプロジェクトは、出力キャッシュの
  シリアル化やアイドル時のプリフェッチなしでライブ描画します。サンプラーは出力キャッシュを保持します。
- frame sampler（マルチフレーム画像エフェクト）:
  プロパティと決定論的な
  `getRequest(effect, frame)` 関数を指定して
  `ZoidiumPluginApis.defineFrameSampler` を呼び出します。コアコンポジターが
  必要なオフスクリーンターゲットを評価して再利用します。エフェクトは返された
  テクスチャを合成するだけです。plugins/native-fx/effects/echo.js を参照してください。
  各タップは、シリアル化順序でサンプラーより前の時間演算子を適用して
  エフェクト入力を評価します。プレフィックス量子化子は、現在の画像だけを量子化するのではなく、
  タップの時刻を使います。サンプラーの入力時刻に既に含まれる時間オフセットは、
  プレフィックスの再実行前にリベースされるため、二重に加算されません。
  サンプラーより後のテンポラル演算子は、合成結果に対する
  既存の評価を保持します。調整プレフィックスは
  プロジェクト時刻を使い、下位トラックのスコープをサンプラー入力で止めます。
  入れ子の準備とレンダリングは、同じ 8 段の深さ制限を共有します。

- 複雑なマルチパスエフェクト（Drop Shadow など）は、手書きのままにできます。
- 初回リリースより後に追加された API が必要なエフェクトは、
  `requiresApis` で宣言します（たとえば Echo は `defineFrameSampler` を宣言し、Color
  Curves は `propertyControls` を宣言します）。ページを提供する extension シェルがそれらの API より古い場合、
  エフェクトはエフェクト読み込みを壊す代わりに、明示的な非互換プレースホルダーに
  フォールバックします。ページを再読み込みすると
  extension レイヤーが更新され、エフェクトが復元されます。

### object: objectClasses（および objectTypes）

- 新しい形状は、zoidium:<id>/<shape> 型の objectClasses[] を宣言し、
  モジュールから実装を登録します。Geometry+ を参照してください。
- 既存のピッカー項目の置換や拡張は objectTypes[] を使います。
  Light+ を参照してください。
- 形状モジュールは context.apis.objects を使えます（数値プロパティ、シェーディング）。

### material-pack: materialTypes

- materialTypes[] を宣言し、モジュールから実装を登録します。
  Material+ を参照してください。
- 新しいマテリアル型は Material+ に追加します。メッシュ UV 経由でテクスチャを
  サンプリングするマテリアルは、CM3 ネイティブの
  `WorldUVGenerator` UV（湾曲したテキストや押し出し側壁でせん断します）の代わりに、
  共有 UV レイアウトを使わなければなりません:

  ```js
  const uvLayout = new Function(context.getAsset("text", "./plugins/material-plus/uv-layout.js"))()();
  material.update = function (frame) { uvLayout.ensureMaterial(this); /* ... */ };
  material.unload = function () { uvLayout.releaseMaterial(this); /* ... */ };
  ```

  このレイアウトは 3D Text と押し出し形状だけを書き換え、エフェクターソースの
  ジオメトリに追従し、レイアウトマテリアルがなくなったら元の UV を復元します。
  UV を一切読まないマテリアル（Matcap）は除外されます。

### extension: modules

- 各モジュールは `activate(context)` をエクスポートします。`deactivate()` は任意です。どちらも
  async にできます。モジュールは `context.apis` とバンドルの `context.getAsset` を受け取ります。
- ホストを変更する前に、所有する DOM、ウォッチャー、タイマー、プロトタイプパッチを
  `context.lifecycle.onDispose(cleanup)` に登録します。マネージャーは
  `activate()` を呼ぶ前にモジュールを所有するため、アクティベーションが途中で
  失敗してもクリーンアップが実行されます。クリーンアップコールバックは登録の逆順で await され、
  1 回だけ実行され、他のクリーンアップが失敗しても続行します。モジュールの `deactivate()` が
  先に実行されます。コールバックは、既に削除済みのリソースを許容しなければなりません。
- モジュールがまだ所有するパッチだけをアンロードします。元のディスクリプター
  または関数を保持し、ホストが置換版をまだ参照している場合だけ復元します。
- `isInUse()` は、プロジェクトデータが実装を失う場合にモジュールの無効化を防ぐため
  true を返せます。これは、管理対象オブジェクトと
  リソース追跡を補います。
- `ZoidiumUI.createMenubarTab({ panel: panel.el, ... })` はパネル DOM
  要素を受け取ります。返されたタブを保持し、破棄時に `removeMenubarTab(tab)` に渡します。
  削除はエレベーターのパネル一覧とアクティブタブも更新します。
- ビューポートを借りるカスタムエディターは、
  `ZoidiumUI.acquirePreview(viewport, close)` を呼び出せます。前の所有者は
  新しいリースの返却前に閉じられます。エディターが閉じたらリースを解放します。
  一時的なレンダープロパティはプレビュー描画の範囲に限定し、`finally` で復元します。
  通常レンダリングではデザイナー専用の状態を保持しません。

- エディター、セットアップダイアログ、デザイナーは、
  `context.ui.openWindow()` 経由でフローティングウィンドウとして開きます。
  CM3 プロパティにはネイティブプロパティ行（`context.ui.properties`）を、
  その他の値には `context.ui.controls` を使います。オブジェクト/エフェクト/マテリアルエディターは
  `context.ui.registerEditor` または `registerAttributePanel` で、サイドバーページは
  `context.ui.sidePanel` で、製品固有の見た目は `context.ui.registerSkin` で登録します。
  `context.ui` 経由で登録したものは、プラグイン無効化時にすべて削除されます。
  フルスクリーンオーバーレイ、バンドル UI フォント、借用プレビュービューポートは受け付けません。
  コンテキストメニューとアンカーメニューには `context.ui.openMenu()` を使います。
  ショートカット、ヒント、スウォッチ、チェック、無効項目、所有者破棄に対応します。
  完全な API は [Plugin UI](plugin-ui.md#コンテキストメニューとアンカー付きメニュー) を参照してください。

通常の extension モジュールは Player+ と Easing+ を参照してください。個別の設
定ページ API は追加していません。オブジェクトごとの永続設定はプロジェクトの
プロパティに保持し、ウィンドウ経由で編集します。

### ネイティブ 3D フォント読み込み

Core は、ネイティブの `PZ.asset.font.get3DFont()` と `loading3d` を、
成功時は `THREE.Font` に、読み取り/解析失敗時は `null` に確定させます。失敗の詳細は、
`stage` と `message` を持つ `zoidiumFont3dError` として共有フォントデータ上で利用できます。
`zoidiumFont3dState` は `loading`、`ready`、`failed` のいずれかです。Core は失敗を
既存の通知 UI 経由で報告します。プラグインは、同じ管理対象の失敗を
重ねて報告すべきではありません。保留中の読み取りにタイムアウトはありません。

アセットソース、ファイル、リモート URL の変更は、共有の解析済みフォントと
読み込み状態を無効化します。ネイティブ Text ジオメトリは、Text+ の
文字ジオメトリを含め、自動的に更新されます。失敗した Text はプレビューとエクスポートでは空になります。
他のオブジェクトはレンダリングを続けます。ネイティブフォントプロパティ編集は既存の
undo/redo 動作を保持します。Core は、アンロード済みフォントアセットをプロジェクトの
アセット一覧内に保持するため、それらのネイティブ履歴操作は添付バイトを復元できます。

### プラグインの複数ファイル分割

ソースファイルは 1000 行以下に保ちます（`pnpm run verify` が検査します）。
追加ファイルはすべてマニフェストでテキストアセットとして宣言し、手書きの `new Function` ラッパーの
代わりに共有バンドルローダーで読み込みます:

```js
const require = context.apis.modules.createRequire(context.getAsset, {
  root: "./plugins/my-plugin/",
  scope: { context },          // extra names visible inside every file
});
const curves = require("./curves.js");   // module.exports of curves.js
```

各ファイルはローダーごとに `function (module, exports, require, ...scope)` として 1 回だけ実行されます。
`require` は、要求元ファイルに対する `./` と `../` を解決し、`root` の
外側のパスを拒否し、循環参照では CommonJS と同様に部分的なエクスポートを返します。
ネイティブエフェクトソースは、グローバルの
`ZoidiumPluginApis.modules.createRequire` 経由で同じローダーに到達できます。

### 共有モジュール（zoidium/shared/）

複数プラグインで重複するロジック用の純粋ヘルパーは `zoidium/shared/*.js` にあり、
`ZoidiumPluginApis` 上で公開されます（`context.apis` 上も同様）:

| table | file | contents |
| --- | --- | --- |
| `random` | `shared/random.js` | シード付き 0-1 ハッシュと対応 GLSL チャンク |
| `props` | `shared/props.js` | プロパティリーダーと JSON クローン |
| `color` | `shared/color.js` | クランプ、lerp、色空間変換 |
| `gl` | `shared/gl.js` | レンダーターゲットとコピーパスのヘルパー（`THREE` を受け取る） |
| `json` | `shared/json.js` | プロトタイプ安全な JSON 解析と代入 |
| `windows` | `shared/windows.js` | Escape 処理と永続ウィンドウジオメトリ |

オーバーレイ項目は、`zoidium/plugin-apis.js`（これらをアタッチします）の前、
`zoidium/settings.js`（`ZoidiumSharedJson` を読み取ります）とすべてのプラグインの前に、
`postInitScripts` で読み込まれます。呼び出し側は共有テーブルを
直接使い、ローカルフォールバックは置きません。ビット単位のピンは
`test/shared-random.test.js` と `test/shared-helpers.test.js` にあります。

各テーブルには非列挙の `workerSource()` メソッドがあります。モジュールの
名前付きイニシャライザーを `Function.prototype.toString()` でシリアル化し、
`globalThis.ZoidiumPluginApis` 上にテーブルを初期化するスクリプトを返します。
ワーカーが必要とするテーブルのみを、ワーカーのバンドル済みモジュールの評価前に
先頭に追加します:

```js
const prelude = context.apis.random.workerSource() +
  context.apis.props.workerSource() + context.apis.color.workerSource();
const worker = new Worker(URL.createObjectURL(new Blob([prelude, jobSource], {
  type: "text/javascript",
})));
```

イニシャライザーはヘルパー依存関係を含み、ワーカー内に新しいクロージャー
状態を作ります。スクリプトの fetch や `window`、`document`、
ページの API オブジェクトを必要としません。モジュール作成者は、依存関係をその
イニシャライザー内に保持するか、ヘルパーに明示的に渡さなければなりません。
Effector メッシュジョブと Material+ グラフワーカーは、
バンドル済みソースアセットとともにこの仕組みを使います。
`test/shared-worker-realms.test.js` は、生成された両ワーカーをブラウザグローバルなしの VM
レルムで評価し、完全な結果をメイン
レルムと比較します。`test/worker-helper-pins.test.js` は、移行済み呼び出し箇所を
移行前の verbatim コピーに対してピン留めします。

- `random`: `legacyHash01(seed, index)`（Datamosh/VHS セットアップ）と
  `nextSeed(seed)`、`sceneSeededRandom`（Scene+）、`textSeedHash` /
  `textSeededRandom`（Text+）、`effectorHash01` / `effectorHashUnitVector`
  （Effector コア）、`particularSimHash`（Particular）、
  `plexusRand` / `plexusHash2` / `plexusSmoothNoise2` / `plexusFbm2`（Plexus）、
  `formSrand` / `formHash3` / `formSmoothNoise`（Form）、
  `vibrateHashNoise` / `vibrateSampleNoise`（Camera+）。バリアントは
  整数演算が異なるため、名前を個別に保持します。統合してはなりません。
  `GLSL_RAND` は、Form と Particular のポイントシェーダーが共有する
  `"float rand(vec2 n) { ... }"` チャンクです。
- `props`: `readNumber(property, time, fallback)`（有限数またはフォールバック、
  例外なし）、`readVector` / `readColor`（成分ごとのフォールバック、
  フォールバックは変更しません）、`forEachProp(properties, visit)`（所有
  項目の走査）、`cloneJson`（レジストリーセマンティクス）と `cloneJsonValue`
  （リセットデータセマンティクス: 関数は `undefined` にクローンします）、
  `finiteOr(value, fallback)`、`numberValue` はスカラー値を強制変換し、
  `readNumberCoerced` は Material+ の任意ゲッターと数値文字列の
  動作を保持します。
- `color`: `clamp` / `lerp`、`clampUnit`（Effector: NaN と非正数は
  0 に潰します）対 `clamp01`（NaN はそのまま通します）、`hsvToRgb` / `rgbToHsv`
  （色相は度、Magic Looks）、`hsvToRgb01` / `rgbToHsv01`（色相は [0, 1]、
  Material+ グラフランタイム）、`hslToRgb`、`hexToRgb` / `rgbToHex`。
- `gl`: `createRenderTarget(THREE, w, h, options)`（options はそのまま渡すため、
  各呼び出し箇所の depth/stencil 動作を保持します。ミップマップは
  固定で無効）、`sameSize` / `ensureSize`（インプレースの `setSize`）、
  `disposeTarget` / `disposeAll`（例外なし）、`createCopyPass(THREE)`
  （素の CopyShader パス）、`disposePass`（マテリアルとクアッドジオメトリ）。
- `json`: `parseJsonSafe(text, fallback)`（例外なし）、
  `parseJsonClean` / `cleanParsed`（すべての深さで `__proto__`/`constructor`/`prototype`
  を除去します）、`safeAssign(target, ...sources)`（それらのキーをスキップするため、
  解析済みペイロードがターゲットのプロトタイプを変更できません）。
- `windows`: `isEscapeKey(event)` / `shouldCloseOnEscape(event)`（UI
  キットの閉じるパスを反映します。未消費の Escape）、`onEscape(target, handler)`
  （破棄関数を返します）、`readWindowGeometries(storage)` /
  `writeWindowGeometry(storage, key, geometry)`（`zoidium.ui.windows.v1` localStorage
  スキーマ。例外なし）。

### core: 隠されたプラグイン

- plugins/core/ のみ。パネルには表示されず、無効化できず、
  プロジェクトにも保存されません。
- デバッグログ（PZ.zoidium.getDebugPlugins()）には表示されます。
- 失敗したコアスクリプトは起動を中断しません。zoidium:ready が運ぶ
  失敗一覧に入ります（縮退起動）。

## レンダリングコントラクト

描画するすべてのプラグインは決定論的でなければなりません。固定のプロジェクト、アセット、
設定、シード、対象時刻に対し、レンダリングフレームは過去の
レンダリング、再生方向、繰り返し再描画、ウォールクロック時刻、再生中か
どうかによらず不変でなければなりません。

- フレーム時点で解析的に評価するか、定義済み開始点から固定ステップで再実行します。
  キャッシュとチェックポイントは高速化手段としてのみ許可され、結果に影響するすべての入力を
  キーに含めなければなりません。
- Core はサンプラー入力テクスチャを、完全なシリアル化コンテンツ、アセット/ファイルの
  同一性、出力解像度とアスペクト設定、プラグイン状態変更、ソース時刻、
  エフェクト、入れ子深さ、調整スコープでメモ化します。すべてのキーはサンプラー
  より前のレイヤーで切断されるため、サンプラー自体や後のエフェクトの編集では
  入力を保持します。監査済み通常レイヤーコンテンツ（サンプラー
  より前の監査済みエフェクト）は、クリップタイミング、シーケンスプロパティ、そのエフェクト
  プレフィックスだけをキーにするため、無関係なトラックも編集できます。プレフィックスの Time Offset と
  Posterize Time 演算子はキーに残ります。その他のコンテンツはシーケンス全体を
  使います。式、レイヤーソース、コンポジションが切断対象エフェクトを読み取れる場合、
  切断は適用されません。編集世代ショートカットがコンテンツ
  シリアル化を置き換えることはありません。Undo/redo は常駐中の項目を再利用できます。
  過去のサンプラーを持たない入力は深さ間でストレージを共有します。調整
  入力は深さを保持します。下位トラックがサンプラー内に再帰する可能性があるためです。
  `PZ.zoidium.debugDisableFrameSamplerInputReuse = true` は、現在の準備済みプランを保持したまま、
  準備間の再利用を無効化します（ピクセル比較用）。
- サンプラーは任意保持の RGBA8 ターゲットを、合計がルートコンポジターごとに最大
  256 MiB、エフェクトごとに最大 128 スロットかつ
  入力入れ子深さの範囲でのみ割り当てます。単一タップ要求は 1 つのターゲットを再利用します。
  その他のプランは通常、フレームスパン、タップ数、
  4 つの追加スクラブスロットを保持するため、再生はバイト
  上限に達する前にターゲットを再利用します。すべてのエフェクトにわたり、予約されていない
  スロットのうち最も使用されていないものを追い出します。
  アクティブな要求に必須のターゲットは、従来どおりバイト上限を超えられます。
  ターゲット総量の上限は 256 MiB に
  `width * height * 4 * sum(peak unique taps per live effect/depth)` を加えたもので、
  最大 64 タップ、8 深さです。これは RGBA8 ピクセルストレージの計算です。ドライバー
  オーバーヘッド、コンポジタースクラッチバッファー、エフェクト所有の作業バッファーは別枠です。
  アクティブな準備バッチと公開済み出力プランは、キャプチャまたは
  メインレンダリングが終わるまで予約されたままです。
- コンテンツ編集は、期限切れスロットをターゲットプールの再割り当てなしで補充します。
  ターゲットの上書きは古いメモ項目を直ちに切り離すため、保持キーは
  常駐ターゲット数に収まります。各常駐リビジョンは、フレーム項目間で 1 つのコンテンツ
  文字列を共有します。プロジェクト解像度イベントとコンポジター
  リサイズはプールを直ちに解放します。非同期入力準備と
  保留中プレビューは、公開前にコンテンツキーを検証します。エフェクトアンロード、
  プロジェクト置換、コンポジターアンロードは、隔離デコーダースケジュールを含め完全なランタイムを
  破棄します。プラグイン状態変更も破棄します。
- Core は完成済みエディタープレビューフレームも保持します（`plugins/core/output-frame-cache.js`）。
  キャッシュにないフレームは、キャッシュなしの場合とまったく同じくライブ描画されます。
  証明可能に完成した描画は GPU 上でコピーされ（リードバックなし、変換なし）、
  同じプロジェクト状態とフレームに対して再表示されます。完成とは、以下を意味します。
  このリビジョン向けにプロジェクトのリソースが確定し、読み込み中のフォントがなく、
  保留中の時間エフェクトプレビューがなく、可視ビデオがすべて、この正確なフレームを
  完成させたプレビュー専用の隔離デコーダーから描画され、一時停止中は可視オブジェクト
  各自の `prepare(frame)` が await 済みです。フレーム更新中にデータを
  読み込むオブジェクトは `zoidiumFrameReady(frame)` を公開します（Trapcode Form、Plexus、
  Particular、Optical Flares）。現在のフレーム向けデータが読み込み中は
  `false` を返します。
- キャッシュキーは、完全なプロジェクトシリアル化とアセット同一性、
  有効トラック、描画バッファーサイズ、アスペクトとレンダラー設定、プラグインの
  バージョンと状態、フォント完成です。任意の入力
  イベント、ネイティブ履歴操作（ポップアウトウィンドウ由来も含む）、プロジェクト変更
  通知の後に再計算され、その後 1.5 秒間も再計算されます。それ以外の間は、安価な部分
  （アセット、トラック、バッファーサイズ、設定、プラグイン、フォント）だけを比較します。
  検証済み一覧外のプラグインを必要とするプロジェクトはライブプレビューのままです。
  `PZ.zoidium.debug.frameCache.assertKeys = true` はヒットごとに再シリアル化し、
  不一致を数えます。`disabled = true` は比較用にキャッシュを無効化します。
- 一時停止して 0.8 秒アイドルすると、キャッシュは再生ヘッドの最大 150 フレーム先と
  8 フレーム後ろまで、プロジェクトのプライベートコピー（専用の
  デコーダーとサンプラープール）経由でレンダリングします。タスクごとに 1 フレームで、
  任意の入力、編集、シーク、再生で停止します。コピーはリビジョンごとに 1 回だけ構築され、
  ウィンドウ完成、再生開始、プロジェクト変更で解放されます。同期描画が 50 ms を
  超えるシーンと、ビデオメディアを含むプロジェクト（プライベートデコーダーが
  エディター自体の再生を遅くしました）はプリフェッチしません。
  表示済みフレームはそのまま保持されます。
- メモリ: Settings の **Preview cache** 値が、数える RGBA8 バイト数を制限します
  （既定 512 MiB、0 で無効。1920 x 1080 フレームは最大 64 枚）。
  Settings は最大 16384 MiB を受け付け、保持項目は最大 8192 件です。GPU
  割り当て失敗やコンテキストロストはセッション専用の上限を下げ、
  設定変更では上げられません。[プレビューキャッシュのメモリ](project-compatibility.md#プレビューキャッシュのメモリ)
  を参照してください。
  プリフェッチコピーは、存在する間、2 つ目のサンプラープール（256 MiB と必須タップ）
  と複製ジオメトリを追加します。プロジェクト置換、解像度
  変更、プラグイン状態変更、設定値縮小、コンポジターアンロードで
  フレームを解放します。エクスポートとスポイトはネイティブ描画のままです。
- 他フレームが必要なエフェクトは、`defineFrameSampler` または
  `defineTemporal` で要求します。前の出力を履歴として
  逆供給してはなりません。
- 乱数は `Math.random()` ではなく、(seed, index, frame) のシード付きハッシュから取得します。
- オーディオリアクティブ機能は、プロジェクト時刻のデコード済みオーディオを解析します
  （Trapcode Suite の `T.audioAnalysis` を参照）。ライブの `AnalyserNode` は使いません。
- 非同期アセットは、フレーム完成前に `prepare()` で await します。

## 互換性とシリアル化型

- 新しいオブジェクトクラスは名前空間付き文字列型（`zoidium:<plugin>/<name>`）を使います。
  数値型は CM3 や他プラグインと衝突するため、旧プロジェクトの
  読み込み専用に予約されています。
- レガシー数値型を読み込まなければならないプラグインは、
  `PZ.zoidium.legacyObject3dTypes` で宣言し（衝突時はアクティベーションを拒否します）、
  名前空間付きクラスにマッピングして、名前空間付き型で保存します。Effector+
  がリファレンスです。
- 機能追加のためにバニラ CM3 クラスを置換またはパッチしてはなりません。
  Camera+ のように個別のオブジェクトを追加するため、そのプラグインを使わない
  プロジェクトは CM3 とまったく同じくレンダリングされます。

マネージャーは、メディア、レイヤー、クリップ上に読み込まれた未知のトップレベルフィールドと未知の
`properties` 項目をクローンして保持します。保存時はそれらのフィールドをホストシリアライザーの
出力にマージします。現在のホストフィールドとプロパティが優先されます。
ライブ extension 自身のデータフィールドは、保持スナップショットより優先されます。
インスタンスの再読み込みはスナップショットを置換します。これは、無効化された Precomp+ の
`media.comp` と composite の `compId`/`offset` を対象にし、プラグイン記述子のない
旧プロジェクトも含みます。コンポジションデータは保存時に Precomp+ 要件も追加します。

これはシリアル化メタデータを保持するものであり、無効化された機能のレンダリングや
編集動作を保持するものではありません。入れ子の extension データは独自フィールドに保持します。
マネージャーは、ホスト配列への不足項目のマージや、削除されたホストオブジェクトの復元はしません。
未知のオブジェクト/エフェクト/マテリアル型は、個別の missing-type アダプターを使います。

## セキュリティと将来のコミュニティプラグイン

プラグインマネージャー経由でアクティベーションできるのは、出荷レジストリーに記載され、
SHA-256 完全性ダイジェストが一致するファーストパーティバンドルのみです。ビルダーは
正確な UTF-8 bundle.json バイト（末尾改行を含む）をハッシュし、レジストリーに
`sha256-<base64>` を記録します。チェックモードは古いダイジェストを拒否します。
マネージャーはテキストを取得し、Web Crypto で検証してからバンドルを解析します。
ダイジェスト不足、不一致、Web Crypto 利用不可、バージョン不一致は
アクティベーションを拒否し、Plugins ページとデバッグログに表示されます。プロジェクト駆動の
アクティベーションも、無効化済みプラグインに対して同じ検査を使います。
localhost や 127.0.0.1 のような HTTPS と HTTP ループバックオリジンは、Electron の
ループバックサーバーを含め、Web Crypto に必要なセキュアコンテキストに対応します。
その他の HTTP オリジンはフェールクローズします。レジストリーとバンドルの要求は
キャッシュ項目を再検証します。古いレジストリーと新しいバンドルの組み合わせは
フェールクローズします。一致するファイルを再読み込みまたはデプロイします。
デスクトップパッケージはレジストリーとバンドルを含みます。

これは、出荷レジストリーに対する改ざん証跡であり、署名ではありません。
レジストリーとバンドルの両方を置換できる攻撃者は、ダイジェストも置換できます。
リリースチャネルを保護し、両ファイルの変更をレビューします。隠された Core
バンドルもマネージャーが検査しますが、Core の pre-init スクリプトはランタイムローダーが
先に実行する別の信頼済みアプリケーションブートストラップファイルです。
バンドルダイジェストは、それらの先行スクリプト要求を認証しません。
その別の隔たりを閉じるには、実行前にローダーレベルの検証が必要です。

バンドルは宣言済みローカルアセットを埋め込み、モジュールは getAsset 経由で読み取ります。
ソースツリーは実行時に fetch しません。テンポラルエフェクトは境界付きの
操作とフレームオフセットを宣言します。これらのコントラクトは JavaScript サンドボックスではありません。
同一レルムのコードは、エディターの DOM、ストレージ、ネットワーク、プロジェクトにアクセスできます。
コードがグローバルオブジェクトを使えたりホストプロトタイプをパッチできるとき、
マニフェスト許可フラグや絞り込んだコンテキストオブジェクトでは制限を強制できません。

将来のコミュニティプラグインマニフェストは、プロジェクトフィールドと編集コマンド、
ネットワークオリジンとメソッド、ローカルストレージ割り当て、
ファイルのインポート/エクスポート、UI パネルのバージョン付きケーパビリティを
宣言すべきです。インストーラーはそれらの要求を提示し、許可を記録し、
未宣言の操作を拒否しなければなりません。そのような宣言は設計提案であり、
現在のマニフェストスキーマが対応する権限ではありません。

コミュニティコードには、バージョン付きメッセージ API を備えた個別のサンドボックス化 iframe または
ワーカーレルムが必要です。iframe は同一オリジンアクセスのない不透明オリジンでなければならず、
ワーカーは隔離オリジンと制限的なネットワークポリシーが必要です。
ホストはすべてのメッセージと許可を検証し、明示的なデータコピーまたは
スコープ付きハンドルのみを渡し、メッセージサイズと処理量を制限し、アンロード時に
ハンドルを取り消さなければなりません。パネルレンダリングとファイル/ネットワーク操作は
ホストブローカー経由でなければなりません。ワーカーはエディター DOM に触れられず、
iframe パネルはエディターのストレージやグローバルオブジェクトを継承してはなりません。
レビュー、署名、リソース制限、安全な更新は、コミュニティバンドル受け入れ前の
前提条件のままです。

## 検査

```bash
pnpm run build:plugin-bundles
pnpm run check:plugin-manifests
pnpm run check:plugin-bundles
pnpm run verify
```

## タイムライントラック拡張

`timeline.registerTrackField(name, { default })` は、トラック上に JSON フィールドを宣言します。
読み込んだ値が既定値を上書きし、保存時はライブトラック値を読み取ります。
ホストは、プラグイン無効時も未知のトラックフィールドを保持します。
破棄は再アクティベーション用に宣言を解放します。シリアル化は有効なままのため、
プラグイン無効化でプロジェクトデータは消去されません。予約済みオブジェクトキー、`type`、
`clips` は宣言できません。

`timeline.registerTrackButton({ id, label, title(track), isActive(track),
onToggle(track, editor), kinds: ["video"] })` は、既存と新規の
トラックラベルにボタンを追加します。プラグインは `onToggle` 内で自身の履歴トランザクションを所有します。
undo/redo 後にアクティブ状態を更新するには `timeline.refreshTrackButtons()` を呼び出します。
返された破棄関数はボタンを削除し、ラベルレイアウトを復元します。複数の
プラグインは、互いの登録を置換せずにボタンを登録できます。

## メディアプリセットとレイヤー拡張

`media.registerPreset({ id, name, icon, json })` は、ライブプロジェクトと以降に読み込む
プロジェクトに CM3 Media プリセットをインストールします。`json` は CM3 メディアペイロードで、
`assets`、`data`、`baseType` を含みます。プリセットは `preset: true` が付くため、
CM3 は保存済みプロジェクトメディアから除外します。返された破棄関数は、登録がなくなったら
プリセットとプロジェクト読み込みフックを削除します。

`layers.registerType({ id, type, factory, name?, plugin?, legacyType? })` は、
名前空間付きレイヤーファクトリーを登録します。`legacyType` は任意で、歴史的な
数値フォーマット専用です。9 未満の ID は予約済みです。Camera+ が型 9 を保持します。
ファクトリーとレガシー宣言は破棄時に個別に削除されます。名前空間付き
レイヤーは、読み込み時にプラグイン使用を追跡し、アンロード時に解放します。`plugin` は
所有プラグインの表示メタデータを提供できます。

`layers.registerPicker({ type, name, description?, ... })` は、ネイティブの Add Layer
ピッカーに 1 項目を追加します。その破棄関数は、その項目だけを削除します。
Media プリセットは別途登録します。ネイティブ Shape 型 6/7/8 は変更されません。

未知の名前空間付きレイヤーは、非レンダリングのプレースホルダーを使います。
読み込んだ JSON ペイロード全体をクローンして保持し、未知の入れ子フィールドとプロパティ
チャネルを含め、保存時はホスト正規化なしで返します。解析済みレイヤーレコード外の
JSON 書式は保持されません。依存関係スキャンは名前空間を認識し、所有プラグインを
提示します。そのプラグインを有効化すると、非アクティブクリップを含め、所有クリップ上の
付随プレースホルダーがすべて復元されます。

## アセット

`ZoidiumPluginApis.assets` は `ZoidiumAssets` と同じレジストリーです。
`snapshot(editor)` はアセット、作成済み使用箇所、状態、件数を返し、リビジョンで
キャッシュします。`subscribe(listener)` は変更をアニメーションフレームごとに 1 通知に
まとめます。`refresh()` はキャッシュを無効化します。`reveal(usage)` は、コンポジションを
切り替えずにライブ所有者を選択します。閉じたコンポジションの使用箇所は
`false` を返します。各項目の非列挙 `asset` はライブ CM3 アセットであり、コピーでは
ありません。シリアル化したり、レジストリー経由でアセット所有権を変更したりしません。
組み込みとプラグインのプリセットファイルは、使用中だけ表示されます。未使用の
ものは内部依存関係です。開いているルートタイムラインは項目ではありません。

Assets プラグインは、このレジストリーを After Effects 形式の Project パネルとして表示します。
他のコードは、そのプラグイン有効中に
`ZoidiumAssetsPanel.open({ select: itemId, filter: "problems" })` で項目付きで開けます。

`replace(itemId, { file })` は、参照を変更する前に保持済みで重複除去された
ターゲットをインポートします。`replace(itemId, { itemId: targetId })` は既存項目を
使います。どちらも `{ ok, replaced, newId, skipped, reason, error }` の promise を
返します。ネイティブ ASSET 値、一致するすべてのキーフレーム、プラグイン参照、通常の Media
テンプレートは、1 つの undo ステップで変更されるか、現在の履歴操作に結合します。
コンシューマーはクリップタイミングを保持して再読み込みします。旧 FILE 項目は保持されたままです。
種類不一致は `ok: false, reason: "kind"` を返します。閉じたコンポジションは
変更されず、`skipped` に `{ path, reason: "closed-composition" }` として現れます。
`locate()` は、ファイルバイトが異なる場合も `reason: "different"` を返します。

`builtInFonts()` は、ネイティブ Font ドロップダウン順の `{ id, key, name }` 項目を
返します。一覧表示だけではアセットは作られません。置き換え先として使うと
プリセット項目になります。

ネイティブ ASSET プロパティで表現できない参照は、プラグインが報告できます:

```js
const dispose = context.apis.assets.registerReferences({
  id: "example/graph-images",
  label: "Graph images",
  collect(project, emit) {
    // Read project data only. Emit once per authored reference.
    emit({ key: assetKey, path: ["Object", "Material", "Image node"],
      owner: material, address: graphProperty.getAddress(), revealable: true });
  },
});
context.lifecycle.onDispose(dispose);
```

収集は、アセットの読み込み/アンロード、Blob URL 作成、プロジェクト変更をしてはなりません。
パスは作成済み所有者を記述します。`address` と `owner` は任意です。省略する場合は、
ライブプロパティパネルのない参照として `revealable: false` を設定します。
アダプター id は一意でなければなりません。プラグイン無効化時に登録を破棄します。
任意の `replace(oldKey, newKey)` フックは、レジストリーの履歴操作内で
ネイティブ propertyOps 書き込みによりライブ作成参照を更新します。別の操作を
開いたり、閉じたコンポジションを編集したりしてはなりません。Material+ は各
グラフ JSON プロパティを 1 回ずつ書き換えます。IES アダプターはプロファイル、テキスト、
ファイル名を書き込みます。このフックのないアダプターは、そのライブ参照の置き換えを
抑止します。

CM3 アセットのない埋め込みデータでは、emit レコードに `item` を含められます。
`{ kind, source: "embedded", name, size, mime }` と安定した合成キーを指定します。
閉じたコンポジション内の参照は `composition: { id, name }` を含められます。
これらの使用箇所は表示対象になりません。プラグインがテキストプロパティ内に参照を
格納する場合、アダプター収集は閉じたコンポジション JSON も対象にします。
Precomp+ は切り離された閉じたタイムラインを `PZ.precomp.referenceSources(editor)`
経由で公開します。

スナップショットは、エディターごとにアニメーションフレームあたり最大 1 回だけ再構築されます。
そのフレーム内の 2 回目の変更は次のフレームに反映されます。繰り返し読み取りは
同じスナップショットオブジェクトを返します。`refresh()` は診断用にそのキャッシュを明示的に
迂回します。購読者は初期スナップショットと以降の変更リビジョンを受け取ります。

アセット修復は `capabilities(item)` で `reload`、`locate`、`exportFile` の
可否を報告します。`reload(itemId)` は、プロジェクトデータや履歴を変更せずに
デコード済みコンシューマーを再構築し、`{ ok, status, error }` を返します。
`locate(itemId, file)` は、ネイティブハッシュが一致する場合だけ不足 FILE アセットを
受け付け、`{ ok, reason, error }` を返します。不一致はプロジェクトを変更せずに
`reason: "different"` を返します。`exportFile(itemId)` は
`{ blob, filename }` または `null` を返します。ダウンロード UI とオブジェクト URL は
呼び出し側が所有します。

プラグインはプライベートデコーダーキャッシュを
`registerReloader({ id, reload(key, asset) })` で無効化します。フックはネイティブ
アセットの各修復で、共有ラッパーキャッシュのリセット後に実行されます。promise を返せ、
コンシューマーの再構築完了前に解決してはなりません。参照
カウントと保存データは変更しません。返された登録はプラグイン
ライフサイクル経由で破棄します。参照アダプターも、自身の emit 項目用に
`reload(key, asset)` を実装できます。これらのアダプター項目は、その参照アダプターが
フックを提供する場合だけ Reload 可否を報告します。

埋め込み参照レコードは `bytes: text` を提供できます。レジストリーはこの
テキストを非公開に保ち、Export File に使います。IES ファイル名には `.ies` 接尾辞が付きます。
ネイティブフォントラッパーは `reset()` を公開します。失敗デコード状態を消去し、警告を
再武装して、新しい 3D フォント読み込み promise を返します。一時プリセット読み取りは
2 秒、6 秒、18 秒後に再試行します。添付ファイルと解析失敗は再試行しません。


ライブエディタープロジェクト内のすべての FILE 項目は、未使用ファイルや旧プロジェクトから
読み込んだ不足ファイルを含め保持されます。スナップショット項目は `retained` を公開します。
`ZoidiumAssets.retained(id)` は現在のプロジェクトを検査します。プリセットとプライベート
レンダープロジェクトは保持参照を受け取りません。保持はランタイムの
所有権のみです。ネイティブアセット JSON と添付アーカイブバイトがファイルを保持します。

`import(files)` は `{ ok, items: [{ id, name, created }], errors }` の promise を
返します。画像、ビデオ、音声にはネイティブのファイルハッシュと Media インポートを使います。
その他のファイルはアセット項目のまま残ります。重複バイトは既存項目を再利用します。インポート、
`removeUnused(ids?)`、`removeItems(ids)` は、それぞれ開いている履歴操作に結合するか、
1 つの undo ステップを作ります。`removeUnused` は `{ ok, removed, freed, skipped }` を
返し、removed/skipped 項目は `id`、`name`、`size` を持ちます。Media ホールドは
作成済み使用箇所に数えません。`removeItems` は
`{ ok, removed, clearedUses }` の promise を返します。フッテージクリップを削除し、プロパティと
一致するキーフレームを消去します。閉じたコンポジション内の使用箇所は、編集全体を
`reason: "in-closed-composition"` と `composition: { id, name }` で拒否します。

参照アダプターは `clear(key)` を実装し、そのキーのライブ作成使用箇所をすべて
ネイティブプロパティ操作で削除できます。Core は自身の履歴操作内でフックを呼びます。
別の操作を開始したり、閉じたコンポジション JSON を編集したりしません。
Material+ はグラフ画像パラメーターをこの方法で消去します。IES アダプターは
プロファイル、ファイル名、埋め込みデータを消去します。削除は、未対応アダプターでは
変更前に拒否します。Undo は同じアセットオブジェクトを復元し、Blob URL を
再作成してからコンシューマーを復元します。

不足 FILE（エディター内にバイトがなく、使用中・未使用を問いません）の保存は、そのキーを
`zoidium.json` 内の任意 `missingAssets` に書き込みます。これは既知の不在の記録であり、
ファイルバイトではありません。既存の完全性レコードと添付バイトは通常の
検証を受けます。

フォルダーとラベルは After Effects の Project パネルに従います。`snapshot().folders`
は `{ id, name, parent, label }` を一覧表示し、各項目は `folder` と `label` を持ちます
（0 = なし、1-16 = AE ラベル色）。`createFolder(name, parent)`、
`renameFolder(id, name)`、`deleteFolder(id)`（内容は親に移動します。
アセットは削除しません）、`moveItems(ids, folderId)`、`setLabel(ids, label)` は
それぞれ 1 つの undo ステップを記録します。メタデータはプロジェクトの
`zoidiumAssets` ルートフィールドに保存され、CM3 は無視します。存在しなくなった項目の
項目は保存時に除去されます。

`collectFiles({ name? })`（After Effects の Collect Files）は、`{ ok, blob, filename,
collected, missing, report }` の promise を返します。バイトのあるすべての
ファイル項目（添付ファイルと埋め込みプラグインデータ）を格納した ZIP で、項目名に
大文字小文字を区別しない「 (2)」接尾辞を付け、Assets フォルダーに対応する
ディレクトリーに入れ、`Collect Files Report.txt` に不足ファイルを一覧表示します。
プロジェクトは変更しません。`consolidate()`（Consolidate All Footage）は、バイトが同一の
ファイル、プリセット、プラグインデータ URL 項目を同種ごとにまとめ、
`replace()` で重複の使用箇所をすべて保持項目 1 つに置き換え、
未使用になった重複を `removeUnused` と同様に削除します。すべて 1 つの undo
ステップです。保持項目は、作業項目、組み込みプリセット、添付
ファイル、使用数最多の順に選びます。`{ ok, consolidated, groups: [{ keep,
merged }], removed, skipped }` を返します。CM3 は添付ファイルをバイトの
SHA-256 でキー付けするため、実際には重複はファイルとプリセットまたはプラグインデータ
URL の組み合わせになります。

`propertyAt(element)` は、CM3 プロパティ行内の要素を、アセットプロパティ編集中の行なら
`{ address, name, kind }` に解決し、`assign(itemId, address, frame?)` はその
プロパティを 1 つの undo ステップで項目に設定し、`{ ok, frame }` を返します
（型不一致は `reason: "kind"`、式駆動プロパティは `"expression"`）。
ネイティブプロパティパネルと同様に、編集フレームは既定で再生ヘッドからプロパティの
`frameOffset`（クリップ開始）を引いたものになります。アニメーションプロパティは
`propertyOps.startEdit` 経由でそのフレームにキーフレームを得るか、そのフレームの
既存キーフレームが変更されます。`dragMedia(itemId)` は、フッテージ項目を表示する
Media タブ項目を返します（CM3 自身のタイムラインドラッグ用）。なければ `null` です。


### 任意プラグインの要求

`await PZ.zoidium.requestPlugin(id, reason)` は、プラグインマネージャーにインストール済み
プラグインの有効化を要求します。現在の機能がそれを必要とする理由を、短い英語の説明で
指定します。マネージャーは Enable/Cancel 確認を表示し、レジストリーの
実験的警告を含め、承認後にのみプラグインを有効化して保持します。
プラグイン有効化時は `true` を、辞退、未知 ID、
アクティベーション失敗時は `false` を返します。有効化済みプラグインは再び確認しません。
成功した要求は、開いているネイティブプロパティエディターを再構築するため、新規インストールの
入力コントロールが直ちに表示されます。この API はプラグインの起動既定値を変更しません。

## 共有 Custom Shader パイプライン

`ZoidiumPluginApis.shaderPipeline` は、Custom Shader プロトタイプのコンパイルと
フレームごとのフックを所有します。ステージを登録し、返された登録を破棄します:

```js
const remove = context.apis.shaderPipeline.register({
  id: "my-plugin",
  transformSource(source, raw) { return source; },
  declare(source) { /* this is the native shader effect, after native setup */ },
  update(frame) { /* native evaluated uniforms are already bound */ },
});
context.lifecycle.onDispose(remove);
```

Includes はソース変換の前に展開されます。名前付き GLSL ライブラリを
`registerIncludes({name: source})` で登録し、`// #include <zoidium/name>` を使います。
Includes は境界付きで、重複除去され、ブロックコメント内のディレクティブを無視します。
すべての登録は破棄関数を返します。コンパイルは失敗時もネイティブソース
プロパティを復元します。通常シェーダーはソースバイトと
uniform を保持します。Expressions+ は既存の includes と zTime/zFrame/ctl_
バインディングをこのパイプライン経由で提供します。Node Effect のネイティブシェーダーも同じ
コンパイルパスを使います。Shader+ はネイティブセットアップ後にサンプラーと配列を追加し、
ネイティブ TEXT 定義を削除し、数値種の評価をすべてネイティブに保ちます。

Shader+ の定義と例は [Shader properties](shader-properties.md) にあります。

`shaderPipeline.preview(effect, raw)` は、切り離したファサード上で同じコンパイル
セットアップを実行し、エディター診断用の
`{source, expanded, locations, defines, vertexShader}` を返します。`locations`
は展開済みソース行から作成行へのマップです。ステージはソース変換を `this`
ローカルに保たなければなりません。リソースを所有するか共有状態を変更する場合は、
`declare` の代わりに `previewDeclare(source)` フックを使います。
アセット読み込みやテクスチャベイクなしでコンパイル定義を再現しなければなりません。
プレビューはステージの update/error ハンドラーを呼ばず、パスも描画しません。通常の
コンパイルとフレームごとの更新は既存パスのままです。
