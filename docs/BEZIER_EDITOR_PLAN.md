# Zoidium ベジェイージングエディタ — 計画 (Phase 0 完了)

Panzoid 既存の Tween イージングパネルを使いやすくするため、 **Panzoid コード (minified) を一切改造せず** に、独立 UI から `controlPoints` を含む keyframe データを読み書きする方針をまとめる。

> **スコープ**: 計画のみ。 コードはまだ書かない。 ユーザの GO が得られてから Phase 1 以降に着手する。

---

## 1. ユーザの要求 (再掲)

> ベジェイージングエディタが専用タブ開くんじゃなくてその場でちゃちゃっと編集できるのが理想。
> なんか新しく独立 UI 作ってイージングの JSON に干渉してみたいな感じ。
> Panzoid 既存のパネルは触らない (改造不可、minified)。

**ペインポイント**:
- 既存パネルが使いにくい (マウスドラッグのみ、プリセット不足)
- 数値入力できない
- デフォルト `[[-10, 0], [10, 0]]` がリニアすぎてベジェの形が UI 上で分からない
- 気に入ったベジェをコピペ・共有しづらい

---

## 2. Phase 0: Panzoid 内部 API の静的解析結果

`js/core-1.0.102.js` と `js/ui-1.0.72.js` を grep / Python で全文解析した (1 行 minified なので正規表現＋括弧マッチング)。

### 2.1 データモデル: `PZ.keyframe` (core-1.0.102.js)

```js
class PZ.keyframe {
  constructor(value=0, frame=0, tween=1) {
    this.value = value;
    this.frame = frame;
    this.controlPoints = [[-10, 0], [10, 0]];  // ← [[cp1x,cp1y], [cp2x,cp2y]]
    this.continuousTangent = true;
    this.tween = tween;
  }
  load(e) { /* 既存キーフレームの読み込み (controlPoints, continuousTangent も) */ }
  get absoluteFrame() { return this.frame + this.parentObject.frameOffset; }
  toJSON() { /* 保存用 */ }
}
```

**重要**:
- `controlPoints` は **Bezier 補間 (tween >> 8 == 1、 つまり tween >= 256) のときだけ意味がある**。 tween=1 (Linear) や tween=2..32 (built-in ease) では使われない。
- デフォルト `[[-10, 0], [10, 0]]` は「**両ハンドルとも時間軸のみ**」でリニア補間と等価。 Panzoid の UI 上は「ベジェ」表示だがイージングは線形。
- 単位: cp.x は **frame 単位のオフセット**、 cp.y は **値レンジに対する割合** (負値あり)。 シェーダの評価時に `tween.bezier(start, cp1.y * scale + start, cp2.y * scale + end, end, t)` のように評価される (`PZ.tween.bezier`)。
- `tween` のエンコーディング: `tween = (interp << 8) | easeIndex`
  - `tween = 1`: Linear (interp=0, ease=1=linear no-op)。 keyframe コンストラクタのデフォルト
  - `tween = 2..32`: built-in ease (easeList[low 8] = Quadratic/Cubic/.../Bounce)
  - `tween = 256` (= `1<<8|0`): Bezier, no built-in ease (controlPoints を使う)
  - `tween = 0` (interp=0, ease=0) は easingList[0]="none" (fn:null) なので使用不可
- `correctCurve` が X ハンドルの距離がフレーム間隔を超えないようクランプする。

### 2.2 トゥイーン定義: `PZ.tween`

| 名前 | 種類 | 用途 |
|---|---|---|
| `PZ.tween.linear(e, t, r)` | function | 線形補間 |
| `PZ.tween.bezier(e, t, r, i, a)` | function | Cubic Bezier 評価 (内部用) |
| `PZ.tween.correctCurve(e, t)` | function | controlPoints をフレーム範囲にクランプ |
| `PZ.tween.curve(e, t, r, i, a, s, n)` | function | 汎用カーブ評価 |
| `PZ.tween.catmullRom(e, t, r, i, a)` | function | Catmull-Rom スプライン |
| `PZ.tween.easingList` | Array<{name, fn}> | 32 個のビルトイン (Linear, Quadratic, Cubic, ..., Bounce) |
| `PZ.tween.easing` | オブジェクト | 11 カテゴリ (Linear, Quadratic, Cubic, Quartic, Quintic, Sinusoidal, Exponential, Circular, Elastic, Back, Bounce) × {In, Out, InOut, OutIn} |
| `PZ.tween.easingList` の `name` | | 既存 32 種: `linear`, `quadratic in`, ..., `cubic out-in` (Panzoid の ease dropdown の中身) |

**注**: CSS 標準の `ease`, `ease-in`, `ease-out`, `ease-in-out` は **存在しない**。 これらは自前で `controlPoints` を書く必要がある (e.g. `ease = [[0.25, 0.1], [0.25, 1.0]]` の cubic-bezier(0.25, 0.1, 0.25, 1.0) 相当)。

### 2.3 Expression 評価器: `PZ.expression.methods`

`PZ.expression.methods` に登録されている式から呼べる関数 (keyframe `expression` フィールドや `Code` effect (type 0) で使用):

```js
{
  // ベクトル演算
  add, sub, mul, div, clamp, dot, cross, normalize, length,

  // スカラー
  wave: e => 2 * (1 & e) - 1,              // 矩形波 (±1)
  random, gaussRandom,
  shake(t, freq=1, phase=0, amp=1, jitter=0, smooth=1),
  lerp, linear: (e, t, r) => PZ.tween.linear(e, t, r),
  catmullRom: (e, t, r, i, a) => PZ.tween.catmullRom(e, t, r, i, a),
  ease: (e, t="Quadratic", r="InOut") => PZ.tween.easing[t][r](e),
}
```

→ `ease(t, type, dir)` は **存在する**。 chevron-sync.json の README 通り。

### 2.4 既存 UI のフックポイント: `PZ.editor.easeDropDown` (ui-1.0.72.js)

**`PZ.editor` は独立した名前空間** (class ではない。 `PZ.editor = {}` で初期化される):

| API | 役割 |
|---|---|
| `PZ.editor.easeDropDown` | `<ul class="pz-dropdown">` 要素。 lazy 初期化 |
| `PZ.editor.showEaseDropDown(button)` | ボタン横に ease ドロップダウンを表示。 button.pz_input と button.pz_set() を経由して tween を書き込む |
| `PZ.editor.showFontDropDown` / `PZ.editor.fontDropDown` | フォント用、構造は同じ |

**既存 UI 起動シーケンス** (PZ.ui.controls.createKeyframeControls, ui-1.0.72.js 内):

```js
// 各 keyframe プロパティの [interp] [easing] ボタン
let i = document.createElement("button");  // ← interp ボタン (Linear / Bezier トグル)
i.classList.add("pz-tweens");
i.title = "interpolation";
i.pz_value = 0;
i.onclick = function() { i.pz_set(0 === i.pz_value ? 1 : 0); };

let n = document.createElement("button");  // ← easing ボタン (ドロップダウン起動)
n.classList.add("pz-tweens");
n.title = "easing";
n.pz_value = 0;
n.onclick = function() { PZ.editor.showEaseDropDown(n); };
```

ボタンからプロパティ / プロパティOps / 現在フレームへの到達パス:

```js
n.pz_set = function(e) {
  // ...
  let t = this.parentElement.parentElement.parentElement,  // 親プロパティ DOM
      s = t.pz_object,                                     // 対象プロパティ (PZ.property)
      r = t.parentElement.pz_controls,                      // プロパティOps (PZ.ui.properties インスタンス)
      a = r.editor.playback.currentFrame - s.frameOffset;  // keyframe の frame
  // ...
  r.propertyOps.setTween({ property: s.getAddress(), frame: a, tween: ... });
};
```

### 2.5 公開セッター: `PZ.ui.properties.prototype` (ui-1.0.72.js)

**`PZ.ui.properties` クラスには、 keyframe データを書き換えるための公開メソッドが揃っている**:

| メソッド | 引数 | 動作 |
|---|---|---|
| `setControlPoints({property, frame, controlPoints})` | `controlPoints: [[x1,y1],[x2,y2]]` | `controlPoints` を更新、 history に push、 `onKeyframeChanged.update` 発火 |
| `setTween({property, frame, tween})` | `tween: int = (interp<<8) \| easeIndex` | keyframe.tween を更新 |
| `setContinuousTangent({property, frame, continuous})` | bool | 連続ハンドル (鏡像) のトグル。 有効化時、 反対側ハンドルを自動再計算 |
| `setValue({property, frame, value})` | 任意の値 | keyframe.value を更新 |
| `createKeyframe({property, data: PZ.keyframe})` | | 新規 keyframe 作成 |
| `deleteKeyframe({property, frame})` | | keyframe 削除 |
| `moveKeyframe({property, frame, newFrame})` | | 移動 |
| `setExpression({property, frame, expression})` | 文字列 | JavaScript 式評価 |
| `toggleKeyframe({property, frame, animated?})` | | キーフレームの on/off |

**全セッター共通仕様**:
- 変更前値を `editor.history.pushCommand(self, {property, frame, oldValue})` で記録 → **undo / redo が自動で効く**
- 変更後 `property.onKeyframeChanged.update(keyframe)` を発火 → **Panzoid 既存の UI (タイムライン上のキーフレーム表示等) も自動追従**
- `property.getKeyframe(frame)` で keyframe を取得 (`PZ.keyframe` インスタンスを返す)

### 2.6 グローバル: タイムラインインスタンスの取得経路

`clipmaker-3.0.106.js` での生成:

```js
var CM = new PZ.ui.editor;  // ← グローバル editor インスタンス
// ...
o = new PZ.ui.timeline(CM);  // ← タイムライン (ローカル変数、 CM に代入されない)
o.tracks.videoTrackSize = 30;
// ...
s.keyframePanel = o.keyframes;  // s / n / l は edit panel (プロパティパネル)
```

**問題点**: `o` (timeline) はローカル変数で `CM` に保存されない。 ただし以下から間接的に取得できる:

- 各プロパティ編集パネル (e.g. Sequence / Edit) の `.keyframePanel` プロパティ (= `o.keyframes`)
- グローバル `CM` (= `new PZ.ui.editor()`) から `CM.sequence`, `CM.project` 等は取得可
- **実用上は `pz-tweens` ボタンの `parentElement.parentElement.parentElement.parentElement.pz_controls` から `propertyOps` インスタンスを取得するのが最も安定**

---

## 3. 計画: Plan A 「pz-tweens ボタンフック + フローティング UI」

### 3.1 全体アーキテクチャ

```
Zoidium/
├── index.html                              # ← <script src="..."> 1 行追加
├── pz.all-35.css                           # 触らない
├── effect-custom-bezier-editor/            # ← 新規ディレクトリ
│   ├── bezier-editor.js                    # エントリ (initBezierEditor())
│   ├── bezier-editor.css                   # フローティング UI 用スタイル
│   ├── presets.js                          # プリセットライブラリ (CSS / Material)
│   └── README.md                           # 使い方
└── effect-custom/loader.js                 # 触らない (effect ではなく UI 拡張)
```

`index.html` の `<script src="./js/clipmaker-3.0.106.js"></script>` の直後に `<script src="./effect-custom-bezier-editor/bezier-editor.js"></script>` を追加 (1 行)。

### 3.2 フック戦略: 既存 minified ボタンの乗っ取り

`pz-tweens` クラスを持つ `<button>` は:
- **動的に生成される** (プロパティパネルが更新されるたび再生成)
- 2 種類ある: 1 つは Linear/Bezier トグル (interp)、もう 1 つは ease dropdown 起動 (easing)
- 両者とも `class="pz-tweens"`

**hook の流れ**:

1. `MutationObserver` で `document.body` を監視し、 `pz-tweens` ボタンが新規追加されるたびに wrap
2. 各ボタンに click ハンドラを追加:
   - **`title="easing"` のボタン** (ease dropdown) → デフォルト動作 (`PZ.editor.showEaseDropDown`) をキャンセルし、 自前のフローティング UI を開く
   - **`title="interpolation"` のボタン** (Linear/Bezier トグル) → **触らない** (トグル動作は有用)
3. フローティング UI では:
   - 上段: プリセットボタン (linear, ease, ease-in, ease-out, ease-in-out, material/\*, back, bounce, custom bezier)
   - 中段: ベジェ曲線 SVG プレビュー (現在 controlPoints 値から描画)
   - 下段: cp1x, cp1y, cp2x, cp2y 数値入力 + 連続ハンドル checkbox
   - コントロールポイントハンドル (SVG 上のドラッグ可能な 2 つの円)
4. UI 上の操作 → `propertyOps.setControlPoints()` / `setTween()` / `setContinuousTangent()` を呼ぶ

### 3.3 データ取得・書き込み API (フックから使う)

```js
// pz-tweens ボタンの click ハンドラ内
const btn = e.currentTarget;
const propEl = btn.parentElement.parentElement.parentElement;
const prop = propEl.pz_object;                  // PZ.property.dynamic インスタンス
const controls = propEl.parentElement.pz_controls;  // PZ.ui.properties インスタンス
const frame = controls.editor.playback.currentFrame - prop.frameOffset;
const keyframe = prop.getKeyframe(frame);

// --- 読み取り ---
const tween = keyframe.tween;                   // 0=Linear, 1=Bezier, 256+ = プリセット ease index
const cp = keyframe.controlPoints;              // [[x1,y1],[x2,y2]]
const cont = keyframe.continuousTangent;        // bool

// --- 書き込み ---
// Bezier の controlPoints を変更
controls.setControlPoints({
  property: prop.getAddress(),
  frame,
  controlPoints: [[x1, y1], [x2, y2]],
});

// tween を Bezier に切り替え (controlPoints 編集前に必要)
controls.setTween({ property: prop.getAddress(), frame, tween: 256 });
//   ※ 256 = (interp=1)<<8 | easeIndex=0 = Bezier / no built-in ease
// 1 = Linear (easeList[1] = linear no-op、 keyframe コンストラクタのデフォルト)
// 2..32 = built-in ease (e.g. 2 = quadratic in, 3 = quadratic out, 5 = cubic in, 26 = back in, 30 = bounce in)
// 257 = Bezier / linear (冗長、 256 と同じ)

// 連続ハンドルをトグル
controls.setContinuousTangent({
  property: prop.getAddress(),
  frame,
  continuous: true,
});
```

### 3.4 実装フェーズ

| Phase | 内容 | 工数見積 |
|---|---|---|
| Phase 0 (完了) | Panzoid 内部 API 静的解析 | 済 |
| Phase 1 | フローティング UI のスケルトン + プリセットボタン (Linear, ease, ease-in, ease-out, ease-in-out) | 2-3 h |
| Phase 2 | 数値入力 (cp1x, cp1y, cp2x, cp2y) + 既存キーフレーム値の読み取り | 2-3 h |
| Phase 3 | SVG ベジェプレビュー + 制御点ドラッグ編集 (drop 時のみ `setControlPoints`) | 3-4 h |
| Phase 4 | プリセットバンク拡張 (Material 3種, back, bounce, custom) + JSON エクスポート / インポート | 2-3 h |
| Phase 5 | tween トグルとの統合 (Linear/Bezier 切替でプリセット一覧を出し分け) + 連続ハンドルの再計算プレビュー | 1-2 h |

**合計**: 約 10-15 時間 (週末 1-2 つ分)

### 3.5 リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| `pz-tweens` ボタンのクラス名や構造が変わる | hook 失敗 | **そもそも hook しない代替**: `PZ.editor.showEaseDropDown` 関数を自前で上書き (monkey-patch) する。 クリックで ease ドロップダウンが開く瞬間に介入 |
| minified 内部のクラス名・メソッド名変更 | API 消失 | `PZ.ui.properties.prototype.setControlPoints` 等の公開 API 名を **このドキュメントに固定**。 バージョン固定 (`clipmaker-3.0.106.js` から動かさない) で当面回避 |
| 自 UI 編集中に Panzoid 既存 ease dropdown が同時に開く | 競合 | フローティング UI を開いたら `PZ.editor.easeDropDown` を `display: none` で非表示にする |
| `property.frameOffset` が想定と違う | frame 計算ミス | `keyframe.absoluteFrame - keyframe.parentObject.frameOffset` で取得するより、 `keyframe.frame` (relative) を直接使う方が安全 (絶対 frame は playback.currentFrame と等価) |
| undo/redo で自 UI が古い controlPoints を表示 | UI 同期漏れ | `PZ.observable` を使って property の `onKeyframeChanged` を購読し、 UI を再描画 (← Panzoid 標準のオブザーバ機構に乗る) |
| tween=0 (Linear) や tween=2-8 (built-in) のキーフレームで `setControlPoints` しても反映されない | 混乱 | 書き込み前に自動で `setTween({tween: 256})` (= Bezier) に切り替える、 もしくは警告 UI |

### 3.6 受け入れ基準 (Phase 5 完了時点)

- [ ] フローティング UI が、Panzoid の既存 ease dropdown と同じ位置に出る (同じ DOM 階層に挿入)
- [ ] プリセット (linear, ease, ease-in, ease-out, ease-in-out) 5 種 + Material 3 種 + カスタム Bezier
- [ ] 数値入力で controlPoints を 4 値 (cp1x, cp1y, cp2x, cp2y) とも編集可能
- [ ] SVG プレビューが controlPoints の変更に追従
- [ ] 制御点ハンドルのドラッグで controlPoints を編集 (drop 時のみ API 呼び出し、 編集中はローカルのみ)
- [ ] 編集結果が Panzoid のタイムライン上の keyframe 表示に即時反映
- [ ] undo/redo で自 UI の表示も追従
- [ ] 気に入ったベジェを JSON ファイルにエクスポート / インポート可能
- [ ] clipmaker-3.0.106.js, core-1.0.102.js, ui-1.0.72.js, pz.all-35.css は **一切変更されていない**

---

## 4. 計画: Plan B 「独立シェーダ effect」 (フォールバック)

Phase 0 の結果から **Plan A が確実に実装可能** と判明したので Plan B は取らない。 だが、 minified を一切触れないアプローチの代替として記録しておく。

### 4.1 概要

Panzoid の keyframe ベジェとは独立に、 自前の `Code` effect (type 0) を作る:

```json
{
  "name": "Bezier Easing (Zoidium)",
  "type": 0,
  "customProperties": [
    { "type": 4, "properties": {"name": "cp1"}, "keyframes": [{"value": [0.25, 0.1]}] },
    { "type": 4, "properties": {"name": "cp2"}, "keyframes": [{"value": [0.25, 1.0]}] }
  ],
  "objects": [{
    "type": "shader",
    "...": "fragment シェーダ内で cubic Bezier を評価する GLSL"
  }]
}
```

メリット: Panzoid 内部に一切触らない、 既存 tween と独立。
デメリット: 既存の `tween=1` ベジェとは別の場所に独立したベジェ表現、 「Panzoid の keyframe ベジェを編集する」というユーザ要求は満たせない。

→ Plan A で実装する。

---

## 5. 確認事項 (GO サイン前)

実装着手前にユーザに確認したい:

1. **フローティング UI の挿入位置**: 既存 ease dropdown と同じ位置 (プロパティ行の横) か、 画面右下固定か → 推奨: 既存と同じ位置 (Panzoid の直感的ワークフローを崩さない)
2. **プリセットの初期セット**: CSS 5 種のみか、 Material 3 種も入れるか → 推奨: CSS 5 種 + Material 3 種 + back / bounce / "Custom"
3. **Phase 1 から順次実装 vs 全 Phase 一気に**: 推奨: Phase 1-2 までを MVP として作り、 動作確認してから Phase 3 以降
4. **JSON エクスポート/インポートの形式**: プリセット 1 個 = 1 JSON ファイル (collection.json に複数) か → 推奨: collection.json 形式
5. **`pz-tweens` ボタンへの介入方法**: MutationObserver で捕捉 (保守的) vs `PZ.editor.showEaseDropDown` を monkey-patch (積極的) → 推奨: 両方実装 (片方失敗しても動く)
