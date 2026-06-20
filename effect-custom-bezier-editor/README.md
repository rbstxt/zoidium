# Zoidium Bezier Easing Editor

Panzoid の既存イージングパネル (専用タブが開く、 マウスドラッグのみ) を、
フローティング UI に置き換えて使いやすくする拡張。

**Panzoid minified コードには触らない**。 すべて公開 API
(`PZ.ui.properties.prototype.setTween` / `setControlPoints` / `setContinuousTangent`)
経由で書き込むため、 undo/redo とタイムライン UI の追従が自動で効く。

## ファイル

- `bezier-editor.js` — メインエントリ。 `pz-tweens` ボタンをフックし、 フローティング UI を開く
- `bezier-editor.css` — フローティング UI のスタイル (`pz.all-35.css` の dark theme に合わせる)
- `presets.js` — プリセットライブラリ (CSS 5 種 + Material 3 種 + Panzoid built-in + デフォルト)

## 使い方

1. クリップ内の effect / property をシーケンスに追加
2. アニメーションさせたいプロパティに keyframe を追加 (時計アイコン)
3. プロパティ行の `[easing]` ボタン (clock の右隣) をクリック
4. Zoidium のフローティング UI が出る:
   - **プリセット** ボタン (linear, ease, ease-in, ...) を 1 クリックで適用
   - **Control Points** 数値入力で `cp1x, cp1y, cp2x, cp2y` を直接編集
   - **continuous tangent** チェックで鏡像ハンドルをトグル
5. 確定 → Panzoid タイムラインの keyframe 位置とイージング表示が即座に更新

## 設計メモ

- `pz-tweens` ボタンの click を **capture phase + `stopImmediatePropagation`** で横取り
- `PZ.editor.showEaseDropDown` を monkey-patch して、 ボタンに onclick が直接残っていても介入できるように
- `MutationObserver` で `pz-tweens` ボタンの動的再生成を捕捉
- 数値入力 → `setTween({tween:256})` でまず Bezier モードに切替 → `setControlPoints({...})` で値を書き込み
- プリセット適用 → `setTween` → 必要なら `setControlPoints` を順に呼ぶ

## 制限 (Phase 1 MVP)

- SVG プレビューと制御点ドラッグは未実装 (Phase 3)
- JSON エクスポート / インポートは未実装 (Phase 4)
- プリセットは 30 フレーム間隔を想定した controlPoints X 値。 短い/長い区間では `PZ.tween.correctCurve` が自動スケールする
- 数値入力は Y 値も生値 (CSS 標準の 0..1 ではない)。 期待する値が出ない場合は Panzoid 既存 UI で確認しながら調整

## 関連

- [`../docs/BEZIER_EDITOR_PLAN.md`](../docs/BEZIER_EDITOR_PLAN.md) — 実装計画と Panzoid 内部 API 解析
- [`../AGENTS.md`](../AGENTS.md) §6.4 — `PZ.ui.properties.prototype` の公開 setter 一覧
