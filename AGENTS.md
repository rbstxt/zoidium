# Zoidium — Agent Guide

Zoidium は Panzoid Clipmaker Gen3 のオフライン・ミラー。 詳細は `README.md` を参照。 このファイルは **AI エージェントが Zoidium のコードを編集・拡張する際の規約** をまとめる。

---

## 1. クイックスタート

```bash
npm install
npm run web      # 開発: http://localhost:8123 (npx serve)
npm start        # Electron アプリ
npm run dist     # 配布物 (.dmg / .exe / .AppImage) ビルド
```

`npx serve` を使う関係上、 `file://` プロトコルではなく `http://` でアクセスする必要あり。

---

## 2. 触ってはいけないファイル

これらは Panzoid 同梱の minified バンドル。 **改造しない** （最新版で同期できなくなるため）:

- `js/core-1.0.102.js`
- `js/ui-1.0.72.js`
- `js/clipmaker-3.0.106.js`
- `js/three.r91.min.js`
- `effect/boxblur.js` 等の既存 43 個のエフェクト（コピーして雛形に利用するだけ）

逆に、**変更して良い領域**:

- `index.html` (script タグの追加)
- `effect-custom/` (カスタムエフェクト置き場)
  - `effect-custom/groups/` (Group プリセット JSON 置き場)
- `assets/shaders/fragment/preset/` (カスタムシェーダ)
- `package.json` (electron-builder 設定、 scripts)
- ブランド表記 (タイトル、 About、 Copyright)
- `_redirects` / `.cfignore` (Cloudflare Pages デプロイ設定)

---

## 3. プロジェクト構成

```
Zoidium/
├── index.html                  # エントリポイント
├── main.js                     # Electron メインプロセス
├── pz.all-35.css               # メインスタイル
├── download.html               # ダウンロードフロー (Panzoid download.html 互換)
├── 404.html                    # 404 ページ
├── js/                         # Panzoid minified バンドル (触らない)
├── effect/                     # Panzoid デフォルト 43 個 (触らない)
├── material/                   # Panzoid デフォルト (触らない)
├── worker/                     # WASM workers (触らない)
├── assets/
│   ├── fonts/2d/               # 28 TTF フォント
│   ├── images/                 # アイコン・SVG sprite
│   ├── shaders/
│   │   ├── vertex/common.glsl  # 共通 vertex shader
│   │   └── fragment/
│   │       ├── fx_*.glsl       # Panzoid デフォルト シェーダ
│   │       └── preset/         # カスタムシェーダ置き場
│   └── textures/particles/
├── effect-custom/              # 開発者用カスタムエフェクト (主な作業領域)
│   ├── loader.js               # エントリ (配列1行追加で登録)
│   ├── _template_shader.js     # 雛形 A: GLSL オンリー
│   ├── _template_advanced.js   # 雛形 B: 複数パス JS ロジック
│   ├── _template.glsl          # 雛形シェーダ
│   ├── sepia.js                # 例: 雛形 A ベースのサンプル
│   ├── polygonecho.js          # 例: 雛形 A ベース、 multi-uniform
│   ├── dropshadow.js           # 例: 雛形 B ベース、 multi-pass + RT
│   └── README.md               # エフェクト追加の詳細手順
└── fonts/                      # Open Sans / Source Code Pro (woff2)
```

---

## 4. カスタムエフェクトを追加する手順

エンドユーザーから見える流れ: 開発者が `effect-custom/` に JS + GLSL を置き、 `loader.js` の配列に1行追加 → ブラウザリロードで Effects パネルに新エントリが現れる → エンドユーザーはそれを検索・追加できる。 エンドユーザーがリストを直接編集することは**できない**（loader.js はバンドル内）。

### 4.1 タイプ A: GLSL オンリー (画像処理)

```bash
# 1. 雛形をコピー
cp effect-custom/_template_shader.js effect-custom/<type>.js
cp effect-custom/_template.glsl     assets/shaders/fragment/preset/<shaderfile>.glsl
```

`effect-custom/<type>.js` を編集:

```js
(this.defaultName = "My Effect"),
  (this._zoidiumMeta = {
    category: "ENHANCE",       // 後述のカテゴリ名
    desc: "One-line description",
  }),
  (this.shaderfile = "preset/<shaderfile>"),  // ← シェーダファイル名
  // ...
  (this.propertyDefinitions = {
    enabled: { /* OPTION off;on */ },
    // uniform と同じ名前のパラメータを追加
  }),
```

`assets/shaders/fragment/preset/<shaderfile>.glsl` を編集 (GLSL)。

`effect-custom/loader.js` の `ZOIDIUM_CUSTOM_EFFECTS` 配列に `"<type>"` を1行追加。 リロード。

### 4.2 タイプ B: JS ロジック (複数パス、 RenderTarget)

雛形 `_template_advanced.js` を雛形にし、 `load()` / `unload()` / `resize()` 内で `THREE.WebGLRenderTarget` や `THREE.Scene` を使ってマルチパスを組み立てる。 実例: `dropshadow.js` (boxblur シェーダ + 合成パスで影を生成)。

### 4.2b タイプ C: Group プリセット (JSON)

Panzoid 純正 Twitch のような「**子エフェクトを customProperties + JavaScript 式で束ねる**」
コンテナを、 副作用なしの **JSON 1 本** で登録する。 シェーダを書かずに既存エフェクトを
組み合わせたいときに使う。

```bash
# effect-custom/groups/<name>.json を作成
```

```json
{
  "name": "My Preset",
  "desc": "...",
  "category": "DISTORT",
  "type": 0,                  // ← 0 固定 (PZ.effect.group)
  "properties": { "name": "My Preset (v1)", "enabled": {...} },
  "customProperties": [...],  // ユーザ向けダイヤル
  "objects": [...]             // 子エフェクト + expression
}
```

`effect-custom/loader.js` の `ZOIDIUM_CUSTOM_GROUPS` 配列に `"<name>"` を1行追加。 リロード。

JSON スキーマ詳細 / expression で使える関数 (`shake`, `wave`, `lerp`, `ease` 等) /
具体的な Twitch サンプルは [`effect-custom/groups/README.md`](effect-custom/groups/README.md) を参照。

**内部動作**:

- loader は JSON を `fetch` → `JSON.parse` → 検証 (`type===0` / `objects` 配列の存在)
- `name` / `desc` / `category` を取り出して UI 表示用に使い、 残り全フィールドを `data` に詰める
- `PZ.ui.objectTypes.get(PZ.effect)` に `{name, desc, type: 0, data, _zoidiumKey}` を挿入
  (`_zoidiumKey` は JSON ファイル名、 重複検出用)
- ピッカーがクリックされると Panzoid 内部で `PZ.effect.group.load(data)` が呼ばれ、
  `properties` / `customProperties` / `objects` がそのまま Group インスタンスを初期化する
- **factory (`fnList`) は触らない** (Group クラスは Panzoid 組込のため)

**シェーダカスタムエフェクトとの対比**:

| | タイプ A/B (JS) | タイプ C (JSON) |
|---|---|---|
| 登録先 | `PZ.effect.fnList[name]` | `objectTypes` のエントリに `data` |
| 実行基盤 | `new Function(code).call(this)` | Panzoid 組込 `PZ.effect.group` |
| ピッカーが呼ぶ | `(await fnList[type]).call(this)` | `PZ.effect.create(0).load(data)` |
| 重複検出キー | `type` 文字列 (ファイル名) | `_zoidiumKey` (JSON ファイル名) |

### 4.3 `_zoidiumMeta` (UI 表示制御)

`propertyDefinitions` の前に `this._zoidiumMeta` を定義することで、 UI のカテゴリと説明文を指定できる:

```js
(this._zoidiumMeta = {
  category: "ENHANCE",  // 既存 or 任意 (例: "CUSTOM")
  desc: "Tints the image with a warm brown sepia tone.",
}),
```

**loader.js 内部の挙動**:

- `category` が既存 Panzoid カテゴリ名と一致 → そのカテゴリの末尾に挿入
- `category` が新規名 → リスト末尾に新規ヘッダ `<name>` を作って直後に挿入
- `category` 省略 → リスト末尾 (MISC 扱い)
- `desc` 省略 → 既定の "Custom effect (Zoidium)"

**指定可能な Panzoid カテゴリ名**:

| name | 内容 |
|---|---|
| `LAYER` | Color/Gradient/Image Overlay |
| `COLOR` | 色調補正全般 |
| `ENHANCE` | Bloom, FXAA, Edge Detection |
| `DISTORT` | RGB Shift, Fisheye, Glitch |
| `BLUR + SHARPEN` | Box/Gaussian/Radial/Directional Blur, Sharpen |
| `FRAMING` | Crop, Transform, Mask |
| `MISC` | Group, Shader |

> 注意: Panzoid の効果リストは `category: true` のエントリを「ヘッダ」、 それ以外を「効果エントリ」 と判定する。 そのため、 loader.js はカスタムエントリに **`category` フィールドをセットしない** (内部用に `_zoidiumCategory` という別名を使う)。

### 4.4 UI へ自動反映される理由

`loader.js` は `initTool()` 後に実行され、 以下を行う:

1. `effect-custom/<type>.js` を `fetch`
2. コード先頭の `this.defaultName` を正規表現で抽出 (副作用なしで)
3. `PZ.effect.fnList[type] = Promise.resolve(factory)` でファクトリ登録 (Panzoid core の `await fnList[type].call(this)` 規約に合わせる)
4. `PZ.ui.objectTypes.get(PZ.effect).push({...})` で UI タブ登録 (適切なカテゴリ位置に挿入)
5. 既存の同名エントリがあれば重複スキップ

---

## 5. Uniform ガイドライン

Panzoid 純正エフェクトの統計 (43 ファイル, 188 プロパティ) に基づく。

### 5.1 名前規則

| 対象 | 規則 | 例 |
|---|---|---|
| GLSL uniform | lowerCamelCase | `tDiffuse`, `uvScale`, `bloomStrength` |
| JS `propertyDefinitions` キー | lowerCamelCase、 GLSL uniform と**完全一致** | `bloomStrength` |
| `name` (UI 表示) | Title Case + スペース可 | `"Bloom Strength"` |
| シェーダファイル | `fx_<snake_case>.glsl` | `fx_boxblur.glsl` |

JS と GLSL の名前を一致させると、 `update()` 内で機械的に書ける:
```js
u.bloomStrength.value = this.properties.bloomStrength.get(e);
```

### 5.2 `dynamic: !0` を必ず付ける

Panzoid 純正では 14% が `dynamic:!0` なし (OPTION での "off;on" 切替のみ)。 **Zoidium では全プロパティに `dynamic:!0` を付ける** (Zoidium 方針)。 キーフレーム化できないと創造性を損なうため。

### 5.3 step 値 (Panzoid 統計の上位)

Panzoid 統計の上位 4 種で 90% を占める:

| 値 | 用途 | 典型例 |
|---|---|---|
| **0.1** | ざっくりなスライダー | Brightness, Contrast, Density |
| **0.01** | 高精度スライダー | Dither, Weight, Decay |
| **0.05** | 中間精度 | Decay (variant) |
| **1.0** | 整数のみ (角度、ピクセルサイズ、 繰り返し数) | Rotation, Width, Repeat |

**プロジェクト固有ルール: `min=0, max=1` のときは step を 0.1 に統一する** (Panzoid 統計では 0.1 と 0.01 が半々だが、 統一することでスライダーのドラッグ感度を揃える)。 例: `Opacity: { min: 0, max: 1, step: 0.1 }`。

### 5.4 min / max の方針

- **基本は設定しない** (Zoidium 方針)。 スライダーが無限にドラッグできる方が、 意図しないクリッピングが起きず創造的。
- 例外: シェーダ側で発散が問題になるケース (例: 半径 0 で log、 反復計算の安定性)。
- `step: 1` だけで範囲無制限でも実用上問題ないことが多い (上下キーで整数増減、 大きな値は直接入力)。

### 5.5 default 値

Panzoid 統計の上位:
- `1.0` (43%)
- `0.0` (32%)
- `0.5`, `0.8` など中間値

**推奨: 0.0 か 1.0 を基本、 必要に応じて意味のある中立点 (例: Rotation=0, Position=[0,0])**。

### 5.6 type 別ベストプラクティス

#### NUMBER (連続スライダー)

```js
amount: {
  dynamic: !0,
  name: "Amount",
  type: PZ.property.type.NUMBER,
  value: 0.5,           // default
  // min / max はつけない (Zoidium 方針)
  step: 0.1,            // [0,1] なら 0.1 推奨
},
```

#### OPTION (ドロップダウン)

```js
mode: {
  dynamic: !0,
  name: "Mode",
  type: PZ.property.type.OPTION,
  value: "off",         // items の最初の値
  items: "off;on",      // ';' 区切り、 2〜4 個が目安
},
```

`update()` で文字列を数値に変換 (シェーダ uniform が int / float の場合):
```js
u.mode.value = this.properties.mode.get(e) === "on" ? 1 : 0;
```

#### COLOR (vec3)

```js
color: {
  dynamic: !0,
  name: "Color",
  type: PZ.property.type.COLOR,
  value: [1, 1, 1],     // [R, G, B] 各 0〜1
},
```

R/G/B を個別 NUMBER で持たせるのは避ける。

#### VECTOR2 / VECTOR3 / VECTOR4

```js
position: {
  dynamic: !0,
  name: "Position",
  type: PZ.property.type.VECTOR2,
  value: [0, 0],
},
```

#### 整数値のみ

Panzoid に整数型フラグは存在しない。 `step: 1` で実用的に整数化できる (ドラッグ・矢印・直接入力すべて 1 単位にスナップ)。 念のため `update()` で:
```js
u.count.value = parseInt(this.properties.count.get(e), 10);
// または
u.count.value = Math.round(this.properties.count.get(e));
```

### 5.7 シェーダ側の基本パターン

Panzoid の vertex shader (`assets/shaders/vertex/common.glsl`) は以下の varying を渡してくる:
```glsl
varying vec2 vUv;
varying vec2 vUvScaled;  // = uv * uvScale
varying vec2 bgCoord;
```

fragment シェーダで:
```glsl
uniform sampler2D tDiffuse;
varying vec2 vUv;          // Panzoid 標準
// varying vec2 vUvScaled; // boxblur 等は vUv を使い、 別途 uvScale を掛けて再計算

vec4 texel = texture2D(tDiffuse, vUv * uvScale);  // このパターンが無難
```

`ShaderMaterial` の uniforms には必ず `tDiffuse`, `uvScale`, `resolution` を含める (Panzoid core が要求)。

### 5.8 チェックリスト (新規 uniform 追加時)

- [ ] uniform 名は lowerCamelCase、 GLSL と JS で完全一致
- [ ] `dynamic: !0` (例外なし)
- [ ] `step` は {0.01, 0.05, 0.1, 0.2, 1.0, 3.0, 10.0} から選ぶ
- [ ] `[0, 1]` 範囲は step 0.1
- [ ] 整数値のみは `step: 1`
- [ ] min / max はつけない (発散防止に必要な場合のみ例外)
- [ ] default は 0.0 か 1.0、 もしくは意味のある中立点
- [ ] `update()` で `u.X.value = this.properties.X.get(e)` と機械的に書ける
- [ ] OPTION は items 2〜4 個、 文字列を `update()` で数値変換
- [ ] `_zoidiumMeta` で category と desc を指定
- [ ] シェーダの `fragmentShader` が GLSL ES 1.0 (WebGL 1) で動くか (Three.js r91 の制約)

---

## 6. 既知の罠

### 6.1 シェーダカスタムエフェクトで `customProperties` を使わない

Panzoid の `PZ.effect.shader` は `customProperties` から自動的に uniform をバインドする。 **しかし `_template_shader.js` パターンでは使ってない**。 代わりに `ShaderMaterial` の uniforms を `load()` 内で明示的に定義する。 理由は:
- シェーダファイル単体で完結し、 デバッグしやすい
- uniform 名の命名規則が自由 (Panzoid 規約の空白→`_` 変換を気にしなくて良い)
- uniform 型を ShaderMaterial.uniforms で明示できる

### 6.2 `PZ.effect.fnList[type]` には Promise resolved factory を入れる

```js
PZ.effect.fnList[name] = Promise.resolve(function () {
  new Function(code).call(this);
});
```

Panzoid core は `await fnList[type].call(this)` で factory を呼ぶ。 factory 内の `this` は `parentProject` 等がセット済みの Panzoid 側インスタンス。 トップレベルで `new PZ.effect()` して factory を呼ぶと `parentProject` が null で失敗する。

### 6.3 renderer パイプラインに乗せる

カスタムエフェクトで `THREE.WebGLRenderTarget` を自前で立ててマルチパス処理するのは Panzoid の EffectComposer と統合する難易度が高い。 実例: dropshadow.js は Panzoid 由来の `THREE.ShaderPass` を使いつつ、 内部で `THREE.WebGLRenderTarget` を使って合成パスを実現している。 **`window.open` で `download.html` を直接開く方式** (file URL ではない) は動作確認済み (cf. save ボタン → download.html 起動 → FileSaver.js で保存)。

### 6.4 Panzoid 内部 API スナップショット (Zoidium 拡張用)

Zoidium が minified な Panzoid コードに介入して独自 UI を構築するときの公開 API 一覧。
**clipmaker-3.0.106.js, core-1.0.102.js, ui-1.0.72.js, pz.all-35.css をアップグレードするまで有効**。
新バージョンで API 名が変わる場合はここも更新すること。

#### キーフレームデータ (`PZ.keyframe`, core)

```js
class PZ.keyframe {
  constructor(value=0, frame=0, tween=1) {
    this.value = value;
    this.frame = frame;                    // 親 property からの相対 frame
    this.controlPoints = [[-10,0],[10,0]]; // Bezier 用 [[cp1x,cp1y],[cp2x,cp2y]]
    this.continuousTangent = true;         // true で cp2 が cp1 と鏡像
    this.tween = tween;                    // 1=Linear(default), 2..32=built-in ease, 256=Bezier
  }
  load(e) { /* 既存 keyframe の読み込み (controlPoints 含む) */ }
  get absoluteFrame() { return this.frame + this.parentObject.frameOffset; }
  toJSON() { /* セーブ用 */ }
}
```

- `controlPoints` は **Bezier 補間 (tween >> 8 == 1) のときだけ** 使われる。 tween=1 (Linear) や tween=2..32 (built-in ease) では無視。
- デフォルト `[[-10,0],[10,0]]` は **リニア** (両ハンドルが時間軸上にある)
- `tween` のエンコーディング: `tween = (interp << 8) | easeIndex`
  - `tween = 1`: Linear (interp=0, ease=1=linear/no-op)。 keyframe コンストラクタのデフォルト
  - `tween = 2..32`: built-in ease (easeList[low 8] = Quadratic/Cubic/.../Bounce)
  - `tween = 256` (= `1<<8|0`): Bezier, no built-in ease (controlPoints を使う)
  - `tween = 0` (interp=0, ease=0) は easingList[0]="none" (fn:null) なので使用不可
- CSS `cubic-bezier()` との対応: `cubic-bezier(p1x, p1y, p2x, p2y)` → `[[p1x*duration, p1y*valueRange], [p2x*duration, p2y*valueRange]]` (duration=フレーム差、 valueRange=キー値の絶対差) を `tween=256` と組み合わせて使う

#### 公開セッター (`PZ.ui.properties.prototype`, ui)

プロパティOps インスタンス (`pz-tweens` ボタンの `parentElement.parentElement.parentElement.parentElement.pz_controls`) から呼ぶ。
**全セッター共通**: 履歴 push による undo/redo + `property.onKeyframeChanged.update(keyframe)` 発火による UI 追従が自動で効く。

| メソッド | 引数 | 動作 |
|---|---|---|
| `setControlPoints({property, frame, controlPoints})` | `controlPoints: [[x1,y1],[x2,y2]]` | controlPoints 更新 |
| `setTween({property, frame, tween})` | `tween: int = (interp<<8)\|easeIndex` | keyframe.tween 更新。 256 = Bezier, 1 = Linear, 2..32 = built-in ease |
| `setContinuousTangent({property, frame, continuous})` | bool | 連続ハンドル (鏡像) トグル。 有効化時、 反対側ハンドルを自動再計算 |
| `setValue({property, frame, value})` | 任意 | keyframe.value 更新 |
| `setExpression({property, frame, expression})` | JS 文字列 | keyframe.expression (動的計算式) を設定 |
| `createKeyframe({property, data: PZ.keyframe})` | | 新規 keyframe 作成 |
| `deleteKeyframe({property, frame})` | | keyframe 削除 |
| `moveKeyframe({property, frame, newFrame})` | | 移動 |
| `toggleKeyframe({property, frame, animated?})` | | on/off |

#### 既存イージング UI のフックポイント (`PZ.editor`, ui)

`PZ.editor = {}` は **class ではない独立名前空間** (PZ.editor.prototype.* とは別物):

| API | 用途 |
|---|---|
| `PZ.editor.easeDropDown` | `<ul class="pz-dropdown">` 要素。 lazy 初期化 |
| `PZ.editor.showEaseDropDown(button)` | ボタン横に ease ドロップダウンを表示 |
| `PZ.editor.fontDropDown` / `PZ.editor.showFontDropDown` | フォントドロップダウン (同じ構造) |

`PZ.ui.controls.createKeyframeControls` が `[interp] [easing]` ボタンを生成。 それぞれ
- `title="interpolation"` → Linear/Bezier トグル
- `title="easing"` → `PZ.editor.showEaseDropDown(this)` 呼び出し

両ボタンとも `class="pz-tweens"` を持ち、 動的に再生成される (MutationObserver で捕捉)。

#### トゥイーン / Expression エンジン (`PZ.tween` / `PZ.expression.methods`, core)

- `PZ.tween.linear(e, t, r)` — 線形補間
- `PZ.tween.bezier(e, t, r, i, a)` — Cubic Bezier 評価 (内部用)
- `PZ.tween.correctCurve(e, t)` — controlPoints の X をフレーム範囲にクランプ
- `PZ.tween.easingList` — 32 個のビルトイン ({Linear, Quadratic, Cubic, Quartic, Quintic, Sinusoidal, Exponential, Circular, Elastic, Back, Bounce} × {In, Out, InOut, OutIn})
- `PZ.tween.easing.<Category>.<Direction>` — easingList の fn プロパティ (e.g. `Cubic.In`, `Bounce.Out`)

`PZ.expression.methods` 経由で式評価器から呼べるヘルパー:
- ベクトル: `add, sub, mul, div, clamp, dot, cross, normalize, length`
- スカラー: `wave(e) = ±1`, `random(e)`, `gaussRandom(e, mean, std)`, `shake(t, freq, phase, amp, jitter, smooth)`, `lerp, linear, catmullRom, ease(t, type, dir)`

#### グローバルインスタンス

- `CM = new PZ.ui.editor` (= `PZ.ui.editor` クラスのグローバルインスタンス) — `clipmaker-3.0.106.js` で生成
- timeline インスタンスは `CM` に保存されない。 各プロパティ編集パネルの `.keyframePanel` (= `PZ.ui.timeline.keyframes` インスタンス) から間接的に取得

#### 関連

詳細は [`docs/BEZIER_EDITOR_PLAN.md`](docs/BEZIER_EDITOR_PLAN.md) を参照 (Zoidium ベジェイージングエディタの実装計画)。

---

## 7. 関連ドキュメント

- `README.md` — 英語版
- `README.ja.md` — 日本語版
- `REWRITE.md` — TypeScript 移行の長期戦略 (今は minified 維持、 将来的に Vite + React + TS)
- `effect-custom/README.md` — エフェクト追加の quickstart (開発者向け)
- `docs/BEZIER_EDITOR_PLAN.md` — ベジェイージングエディタ実装計画 (Phase 0 完了)
