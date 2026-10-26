# プラグイン UI: フローティングウィンドウとコントロール

プロパティ行を超える要素を必要とするすべての Zoidium エディター (セットアップダイアログ、デザイナー、属性パネル、ノードエディター、コンポジション一覧、フォーカスツール) は、CM3 エディターの上に **floating window** として開きます。背後ではエディターは操作可能なままです。そのため変更は通常のビューポートでライブにプレビューされます。エディターを隠す全画面オーバーレイ、バンドルされた UI フォント、借用したプレビュービューポートは使いません。広い作業領域が必要な場合、ユーザーはウィンドウを最大化できます。

ウィンドウとコントロールは、エディター UI フォント、テーマ化されたパネルとタイトル行、フォーカス/選択用のテーマアクセント、テーマ値色、スクラブ可能な数値、`proprow propbutton` ボタンを使います。スタイルは `zoidium/ui-window.css` にあります。色とフォントは**theme tokens** (下記) です。そのためウィンドウは Settings (テーマ、色相、彩度、UI フォント) に追従します。

## テーマトークン

プラグインウィジェットでは、リテラル色の代わりに次の CSS カスタムプロパティを使います。

| トークン | 意味 |
| --- | --- |
| `--zui-font` | Settings で選択したエディター UI フォント |
| `--zui-accent`, `--zui-accent-rgb`, `--zui-accent-strong` | テーマのフォーカス/選択色 (アルファ付きは `rgb(var(--zui-accent-rgb) / .3)`) |
| `--zui-value`, `--zui-value-strong` | テーマの値/リンク色 (数値、有効な項目) |
| `--zui-bg`, `--zui-bg-title`, `--zui-bg-title-focused`, `--zui-bg-input`, `--zui-bg-sunken` | パネル、タイトル行、入力欄、窪み背景の背景色 |
| `--zui-border`, `--zui-border-soft`, `--zui-hover` | 境界線とホバー時の塗り |
| `--zui-text`, `--zui-text-strong`, `--zui-text-bright`, `--zui-text-muted`, `--zui-text-faint`, `--zui-danger` | テキスト色 |
| `--zui-font-size` | ウィンドウ本文とコントロールのテキスト (16px、CM3 プロパティ行と同様) |
| `--zui-font-size-small` | 補助テキスト: 一覧の詳細、ヒント、単位 (14px、CM3 オプション項目と同様) |
| `--zui-font-size-title` | ウィンドウとセクションのタイトル (18px、CM3 セクションタイトルと同様) |
| `--zui-font-size-compact` | キャンバスツールバーのみ: ノードヘッダー、グラフタイル (12px) |

## どのサーフェスを使うか

| 必要性 | 使うもの |
| --- | --- |
| オブジェクト/エフェクトへの少数の追加コントロール | その CM3 プロパティ (通常のパネルに表示される) |
| 1 つのオブジェクト/エフェクト用の専用エディター (セットアップ、デザイナー、属性) | `registerEditor` / `registerAttributePanel` とウィンドウ |
| ウィンドウ内のネイティブプロパティ行 | `context.ui.properties()` |
| 新しいサイドバーページ (Plugins、Compositions のようなもの) | `context.ui.sidePanel()` |
| カスタムウィジェット (カーブ、ホイール、グラフ、ノードエディター) | テーマトークンを使いプラグイン所有のウィジェット DOM を持つウィンドウ |
| ユーザーが頼りにする製品固有の見た目 (スイートデザイナーなど) | 登録済み **skin** (`registerSkin`) を持つウィンドウ |

## ウィンドウを開く

モジュールは `context.ui` を受け取ります。これを経由して開いたウィンドウは、プラグインの無効化時に閉じます。その ID と永続化キーはプラグイン ID で名前空間化されます。

```js
const win = context.ui.openWindow({
  id: `vhs:${effectKey}`,      // reopening the same id focuses the window
  title: "VHS Setup",
  subtitle: clipName,          // optional, shown dimmed in the title bar
  persistKey: "vhs-setup",     // remembers position, size and collapsed state
  width: 340,
  height: 460,
  mount(body, win) {
    const c = context.ui.controls;
    const tone = c.section("Tape");
    tone.body.appendChild(c.slider({
      label: "Tracking", min: 0, max: 1, step: 0.01, value: current,
      onInput: (v) => previewValue(v),   // continuous, while dragging
      onChange: (v) => commitValue(v),   // once per edit: record undo here
    }).element);
    body.appendChild(tone.element);
    return () => { /* remove watchers created by mount */ };
  },
  isValid: () => effect.parent != null, // polled; window closes when false
  footer: [{ title: "Done", variant: "primary", onClick: () => win.close() }],
});
```

モジュールコンテキストを持たないコード (ネイティブエフェクトなど) は、プラグイン ID を接頭辞とする ID でグローバル `ZoidiumUI.openWindow` を呼べます。無効化時には `ZoidiumUI.closeWindows("<plugin-id>:")` で閉じる必要があります。

その他の `openWindow` オプション: `placement` (`"right"` が既定、`"center"`、`"left"`)、`minWidth`/`minHeight`、`resizable`、`collapsible`、`maximizable` (既定: サイズ変更可能)、`skin` (`registerSkin` に渡す名前)、`chrome: "custom"` (ホストのタイトルバーなし。プラグインが独自ヘッダーを描画し、`win.makeDragHandle(headerElement)` を呼び出す)。

ウィンドウオブジェクト: `element`、`body`、`footer`、`titlebar`、`setTitle()`、`setSubtitle()`、`setFooter(buttons)`、`setCollapsed()`、`setMaximized()`、`toggleMaximized()`、`isMaximized()`、`makeDragHandle(el)`、`focus()`、`reveal()` (展開し、エディター内に完全に収めてフォーカスする)、`close()`、`isOpen()`、`onClose(fn)`、`addCleanup(fn)`。

ホストが提供する動作: タイトルバー (またはドラッグハンドル) によるドラッグ、右辺/下辺と角からのサイズ変更、最大化/復元、タイトルのダブルクリックで折りたたみ (カスタムドラッグハンドルのダブルクリックで最大化)、Escape で閉じる、フォーカスで前面化、ブラウザーのサイズ変更時にウィンドウを到達可能な位置に保つ、ウィンドウ内のキーイベントを CM3 エディターのショートカットに伝えない。形状、折りたたみ状態、最大化状態は `persistKey` の下に永続化されます。

## ネイティブプロパティ行: `context.ui.properties()`

```js
const view = context.ui.properties({
  target: () => particular,            // object, property list, group, or a getter
  keys: ["emitter.position", "emitter.velocity"], // optional subset; or (key, property) => bool
  labelWidth: 0.45,                    // optional label column fraction
});
panel.appendChild(view.element);
// view.setTarget(next); view.refresh(); view.dispose() in the mount cleanup
```

行は CM3 独自のもの (`PZ.ui.edit`) です。キーフレーム切り替え、エクスプレッション、イージング、スクラブ、再生中のライブ値、Undo 履歴は Objects/Effects パネルとまったく同様に動作します。既存のプロパティ用にコントロールを再構築するよりこちらを優先します。`controls` は CM3 プロパティでない値にだけ使います。

## オブジェクト、エフェクト、マテリアル用のエディター

```js
context.ui.registerEditor({
  title: "Particular Designer",        // button: "Open Particular Designer"
  icon: "settings",                    // gear icon in the object's list row
  match: (target) => target instanceof ParticularClass,
  open: (target) => openDesigner(target),
});
```

CM3 の一覧は一致する行に歯車を表示します。そのプロパティの上に "Open ..." ボタンを表示します。この登録は、プロパティパネルにウィンドウを開くボタンを配置する唯一の方法です。エフェクトごとのプロパティボタン (カスタム `zoidiumControl` レンダラー、行に描画される `buttons:` 宣言、手挿入の `proprow propbutton` 要素) を追加しないでください。ボタンは "Open <title>" と読みます。ヒントは "Open the <title> window" と読みます。登録タイトルにはウィンドウタイトルを使います。起動ラベルとヒントは常にこの規約に従います。プラグインの無効化時に登録は削除されます。起動行は、値とコマンドを表示するプロパティパネルにだけ表示されます。`showPropertyControls: false` または `hideAllListItemButtons: true` の名前のみのグラフ/トラック一覧には、起動行もエディター歯車も表示されません。Objects/Effects 一覧の歯車とネイティブプロパティビューは既存の動作を保ちます。

プロパティボタンの起動器を移行する場合、プロパティ定義内のシリアル化済みプレースホルダーキーは `visible: false` で保持します。カスタムコントロールバインディングを削除します。既存のプロジェクトはそのキーの読み込みと保存を維持する必要があります。

`match` は CM3 がそれらの行を構築するときに実行されます。プロパティを読む場合 (たとえば PBR+ は **Use node graph** がオンの間だけ Node Editor を表示する)、そのプロパティの `changed` ハンドラーから `context.ui.refreshEditors()` を呼び出します。ボタンは直ちに表示または非表示になります。

`registerAttributePanel` は共通ケースを構築します。タブ付き属性ウィンドウ (Cinema 4D / After Effects / Blender の規約: トピックごとに 1 タブ) であり、各タブはネイティブ行を表示します。

```js
context.ui.registerAttributePanel({
  id: "fracture", title: "Voronoi Fracture",
  match: (target) => target.type === VORONOI_TYPE,
  tabs: [
    { id: "sources", title: "Sources", keys: ["distribution", "cells", "seed", "cellScale"] },
    { id: "motion", title: "Motion", keys: ["distance", "scatter", "spin"] },
    { id: "field", title: "Field", keys: (key) => key.startsWith("field") },
    { id: "custom", title: "Preview", build: (container, target, ui) => cleanupFn },
  ],
});
```

## ノードグラフ: `ZoidiumUI.nodeEditor()`

データをグラフとするプラグイン用のテーマ化ノードグラフエディター (Material+ Node Material が使用) です。プレーン JSON を編集します。グラフを評価しません。

```js
const editor = ZoidiumUI.nodeEditor({
  nodeTypes: { noise: { title: "Noise", category: "Texture",
    inputs: [{ id: "uv", label: "UV", type: "vector" }],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    params: [{ id: "octaves", label: "Octaves", control: "number", min: 1, max: 8, step: 1, default: 4 }] } },
  graph: { nodes: [], links: [] },
  onChange: (graph, info) => commitOneUndoStep(graph, info.label), // once per gesture
});
win.body.appendChild(editor.element); // setGraph(), getGraph(), frameAll(), destroy()
```

操作は Blender/Unreal の規約に従います。中ドラッグまたは Space ドラッグでパンします。ホイールでズームします。出力から入力へのドラッグで接続します。右クリック、ヘッダーの "+ Add node" ボタン、グリッドの右クリック、Shift+A または Tab で検索可能な追加メニューを開きます。Ctrl/Cmd+ドラッグでリンクを切断します。Delete、Ctrl/Cmd+D、Ctrl/Cmd+C/V、Home/F は期待どおりに動作します。

Material+ はすべての数値・色パラメーターをパラメーター行の入力ソケットとして公開します。接続されたフィールドは表示されたまま無効化されます。切断すると保存値を復元します。オプションは通常のドロップダウンのままです。レジストリーパラメーターは `socket: true` と一致する入力ポートでこれに加わります。`hidden: true` は履歴ノード型を評価可能に保ちながら追加メニューから除きます。

Float と Math は数値リンクを通じて 0–1 の範囲外の符号付き数値を保持します。Math はテクスチャオペランドを輝度でピクセルごとに評価します。ローカルパラメーターエクスプレッションもピクセルごとにサンプリングします。対象: Gradient、Checker、Sine Wave、色補正、カラライザー、スペクトル、Blackbody、ブレンド、算術、ノイズの明るさ/コントラスト、Dirt 半径。Color と Float はリンクされたテクスチャを通過させます。色パラメーターは RGB をサンプリングします。数値パラメーターは輝度をサンプリングします。ノイズ格子設定、オクターブ、シード、アニメーション速度、Random Color、Texture/Projection/UvW 全体画像変換、Fresnel シェーダー設定は空間平均輝度 (色パラメーターでは平均 RGB) を使います。これらの設定はピクセルローカルな式ではなくテクスチャ全体の操作を記述します。表示またはベイクされるテクスチャへの変換時のみ値を 0–1 にクリップします。Math Compare はオペランド差が最大 0.01 の場合に 1 を返します。Divide と Modulo は除数の絶対値が 1e-12 未満の場合に 0 を返します。非有限結果も 0 を返します。保存済み履歴 Math ノードは非表示のレガシー評価器に移行します。個別の履歴 math 型はシリアル化 ID と動作を保ちます。

RGB Spectrum Wavelength と Gaussian Spectrum Center は接続された Input の波長を 550 nm 基準でシフトします。Blackbody Kelvin は接続された Input を 4000 K 基準でシフトします。Input がない場合、これらのフィールドは絶対値を指定します。Bake Resolution は 128、256、512、1024、2048 に対応します。Node Material と PBR+ ノードグラフはワーカーでベイクします。保留中の編集を最新グラフで置き換えます。書き出し前に選択解像度全体の完了を待ちます。ベイク済みマップはリニア拡大とミップマップを使います。エディターの Color 出力サムネイルは 128 ピクセルです。

## サイドパネル: `context.ui.sidePanel()`

```js
const side = context.ui.sidePanel({ title: "Compositions", tabTitle: "Comps", icon: "layers" });
side.body.appendChild(context.ui.controls.note("...").element);
```

サイドパネルは組み込みパネルの標準ページヘッダー、背景、スクロールを取得します。無効化時に削除されます。サイドバータブは既定で About の上に配置されます。`position: "after:Effects"` は既存タブ (タイトルで照合) の直下に配置します。`position: "afterAbout"` は About の直下に配置します。生の `createMenubarTab` マークアップからサイドバーパネルを構築しないでください。

## 確認ダイアログ: `ZoidiumUI.confirm()` / `context.ui.confirm()`

```js
const approved = await context.ui.confirm({
  title: "Delete composition",
  message: 'Delete composition "Intro"?',
  confirmLabel: "Delete",   // danger styling comes from `danger: true`
  cancelLabel: "Cancel",
  danger: true,
});
if (approved) deleteComposition();
```

質問にはこの共有ダイアログを使います。単なるメッセージには `notify` を使います。ネイティブ `confirm()` / `alert()` を使わないでください。エディターをブロックし、デスクトップビルドで動作が異なります。ダイアログは共有フッターボタンを持つ小さな中央配置 `openWindow` です。Enter で確定します。Escape と閉じるボタンでキャンセルします。`danger` ダイアログは安全側 (キャンセル) ボタンにフォーカスします。`Promise<boolean>` を返します。`onConfirm` / `onCancel` も呼び出します。ウィンドウ幅は 380px で内容 (タイトル + メッセージ + フッター) に合わせて縮みます。そのため 1 行の質問はコンパクトに収まります。複数ステップのフロー (2 回の呼び出しで 2 回尋ねる) を含め、質問の文言は正確に保ちます。`confirm()` の後に同期的実行されたコードはコールバック内または `await` の後に移動する必要があります。

## スキン: プラグイン固有の見た目

一部のスイートはユーザーが知る見た目を保ちます (Rowbyte & Red Giant スイートデザイナーは元の製品に従います)。skin は参加したウィンドウにスコープされる CSS であり、エディターに漏れ出しません。

```js
context.ui.registerSkin("designer", `
  :scope { background: #101014; }            /* the window itself */
  .tc-preset:hover { color: #fff; }          /* scoped automatically */
`);
context.ui.openWindow({ id: "designer", skin: "designer", chrome: "custom", ... });
```

セレクターにはウィンドウセレクターが接頭辞付けされます。`:scope` (または `:root`/`body`) はウィンドウを意味します。`@media` ブロックもスコープされます。ドラッグ、サイズ変更、フォーカス、キーボード分離、Escape、閉じる、無効化時のクリーンアップはホストが所有し続けます。skin はフォントやリモートアセットをバンドルできません。システムフォントスタックまたは `var(--zui-font)` を使います。

skin CSS は信頼されず、登録時にサニタイズされます。埋め込み `data:` URL 以外を取得する宣言は破棄されます。そのため skin は外部送信も敵対的フォントの取得もできません。`@import` は除去されます。`@keyframes` 名は skin ID ごとに名前空間化されます (`animation` / `animation-name` 参照は一致するよう書き換え)。そのため 2 つのスイートが同じキーフレーム名を衝突なく使えます。サニタイズで空になったルールは破棄されます。

## コントロール

`context.ui.controls` (`ZoidiumUI.controls` も同様) です。各ビルダーは `{ element, get(), set(value), setDisabled(bool) }` を返します。

| ビルダー | オプション |
| --- | --- |
| `number` | `label, value, min, max, step, unit, dragSpeed, onInput, onChange` — 水平ドラッグでスクラブ (Shift ×10、Alt ×0.1)、クリックで入力 |
| `slider` | `label, value, min, max, step, unit, softLimit, onInput, onChange` |
| `checkbox` | `label, value, onChange` |
| `select` | `label, value, options: [{ value, label }], onChange`; および `setOptions()` |
| `color` | `label, value: "#rrggbb", onInput, onChange` |
| `text` | `label, value, placeholder, multiline, rows, onInput, onChange` |
| `button` | `title, hint, variant: "primary" | "danger", onClick` |
| `buttonRow` | ボタンオプションの配列 |
| `section` | `title` または `{ title, collapsed }`; 行は `.body` に追加 |
| `tabs` | `[{ id, title, render(panel) }]`、遅延描画; `show(id)` |
| `list` | `items: [{ id, title, detail }], value, emptyText, onSelect, onActivate`; `setItems()` |
| `note` | `(message, "warning")` |

## 編集ルール

- ウィンドウは CM3 と同じプロパティオブジェクトを経由してプロジェクトを編集します。各ユーザー編集をネイティブ履歴フック経由で 1 回コミットします (`onChange`)。Undo/Redo が動作するためです。`onInput` はプレビュー用にライブ値を更新できます。
- シリアル化設定はプロジェクトプロパティに保持します。ウィンドウ位置とサイズは UI 状態であり、`persistKey` ストレージに置きます。
- ウィンドウコードは描画やシミュレーションの状態を保持しません。描画はプロジェクトデータと時刻の純粋関数のままです (`docs/plugin-api.md` 参照)。
- 対象オブジェクトが削除されたウィンドウを閉じます (`isValid`)。`mount` クリーンアップですべてのリスナーを解放します。
- すべてのテキストは英語で記述します。

## コアテーマエディター

Settings > Color profile > Edit… で単一の Theme Editor ウィンドウを開きます。名前付きユーザーテーマ、メイン色導出、詳細オーバーライド、クリップ色は即時プレビューします。ローカルに永続化します。組み込みの編集は名前付きコピーを作成します。カスタム色相/彩度プロファイルは Settings で引き続き利用できます。ウィンドウは標準のサイズ変更可能クロームを使い、形状を記憶します。

テーマコントローラーは内部 `ZoidiumUIBuilder.themeEditor` コンポーネントです。`open()` はコアコード用であり、公開 `ZoidiumUI` やプラグイン API の一部ではありません。プラグインは `--zui-*` トークンを使い続けます。レイヤー登録とメディアプリセットがランタイム型名を提供するため、プラグイン作者はテーマコントロールを追加する必要がありません。[エディターテーマの保存と互換性](project-compatibility.md#エディターテーマ) を参照してください。

## コンテキストメニューとアンカー付きメニュー

プラグインメニューには `context.ui.openMenu(options)` を使います。モジュールコンテキスト外では `ZoidiumUI.openMenu(options)` を使います。スコープ付き版はプラグイン無効化時にメニューも閉じます。どちらも `{ element, close(restoreFocus = true), isOpen() }` を返します。

```js
const menu = context.ui.openMenu({
  owner: win.element,          // remove the owner to dismiss the menu
  anchor: moreButton,          // or x: event.clientX, y: event.clientY
  align: "end",               // optional anchor alignment; default is start
  title: "Selection",         // optional overall heading and accessible label
  items: [
    { label: "Rename", shortcut: "F2", action: rename },
    { separator: true },
    { title: "Display" },     // optional section heading
    { label: "Visible", checked: visible, action: toggleVisible },
    { label: "Red", color: "#b53838", hint: "Asset label", action: setRedLabel },
    { label: "Delete", disabled: locked, action: remove },
  ],
});
// Menus tied to a temporary operation can instead pass an AbortSignal.
menu.close(false);            // dismiss without moving focus back
```

`owner` は DOM 要素または Zoidium ウィンドウハンドルを受け付けます。`document` は既定でアンカーまたは所有者のドキュメント、次にメインドキュメントです。ポインター座標はそのドキュメントのビューポートに属します。ポップアップの呼び出し元は独自の所有者またはドキュメントを提供します。他のキット UI と同様に共有 UI スタイルを読み込む必要があります。`focusReturn` はアンカーまたは直前にフォーカスされた要素を上書きします。`signal` と `onClose` は明示的な破棄と通知を提供します。サブメニューは提供しません。Assets ラベルピッカーのように、アクションは別のメニューを開けます。

メニューは描画サイズを測定します。ビューポート端で反転し、ビューポート内に収めます。外部 pointerdown、Escape、ホストのスクロール/サイズ変更、ウィンドウブラー/pagehide、所有者の除去または中断で閉じます。メニュー内のスクロールでは開いたままです。矢印キー、Home/End、Tab/Shift+Tab は有効な項目間でフォーカスを移動します。Enter/Space で実行します。Tab は開いたメニュー内で循環し、Shape+ の操作を保ちます。無効な項目は実行できません。`muted: true` は Assets 使用ガイダンスのように、情報アクションを無効化せずに淡色表示します。ホバーとキーボード選択は同じハイライトを使います。ポップアップドキュメントと検索可能なノード追加メニューを含め、アプリケーション全体で開くメニューは 1 つです。

メニュー色は既存のテーマトークンを使います。`--zui-menu-active` はアクセントとパネル背景から導出されます。`--zui-shadow` は影の色素を提供します。共有メトリクスは `--zui-menu-font-size` (13px)、`--zui-menu-title-font-size` (12px)、`--zui-menu-padding` (4px 0)、`--zui-menu-item-padding` (5px 14px)、`--zui-menu-title-padding` (4px 14px 5px) です。検索可能なノード追加メニューは同じメトリクスを使います。

Theme Editor はメインフォーカス色の HSL 明度が 60% を超える場合に明るい拡張クロームを導出します。すべての組み込みテーマは暗いクロームを保ちます。テキスト、入力欄、境界線、危険テキスト、値色は、開いたメニュー、カスタムキャンバス、ミラー化ポップアップドキュメントを含めて一括更新されます。アセットラベル、チャンネルカーブ、描画済みサムネイルなどのコンテンツ色は意味を保ちます。スタンドアロンヘルプページは同じ保存テーマを読み、保存変更に追従します。

`ZoidiumUI.registerMenuExtension({id, items(options)})` は他のプラグインのコンテキストメニューハンドラーを置換せずに共有メニューへアクションを追加します。項目の配列を返します。所有者/項目が一致しない場合は `[]` を返します。ID は一意である必要があります。返された disposer を `context.lifecycle.onDispose` に登録します。コールバックは元のメニューオプションと現在の項目配列のコピーを受け取ります。状態の検査だけを行います。失敗した拡張はホストのメニューを利用可能に残し、英語の診断ログを出力します。Expressions+ はこれを使います。Show in Graph Editor を保ちながら Graph Editor 2 のプロパティメニューに参加します。

## 共有グラデーションエディター

`window.ZoidiumGradientEditor.create(options)` は現在のテーマトークンでインラインプロパティウィジェットを構築します。`{element,get(),set(value),editing,
dispose()}` を返します。`get()` と `set()` は値をコピーします。値は
`{stops:[{position,color,midpoint?}],opacityStops?:[{position,alpha,midpoint?}],
cyclic?:boolean}` です。色は正規化 RGBA 配列またはネイティブ RGBA 文字列を受け付けます。ネイティブストップ用に `document`、`value`、`readOnly`、`advanced:false` を渡します。ネイティブモードは中点、独立した不透明度ストップ、ホイール、未対応フィールドを必要とするユーザープリセットを隠します。

1 つの履歴操作の開始用に `onStart()`、ライブプレビュー用に `onInput(value)`、完了または破棄用に `onFinish(cancel)` を提供します。`onStart` から `false` を返すと、他の操作が履歴を所有する間の編集を拒否します。Escape はドラッグをキャンセルします。カスタム補間/色空間のプレビュー用に 256 テクセル RGBA8 LUT を返す `bake(value)` を提供します。これがない場合、ウィジェットはリニア RGBA をプレビューします。`dispose()` は実行中のポインタージェスチャをキャンセルし、要素を除去します。

`ZoidiumGradientEditor.propertyControl(property,options)` は `pz_update()` 付きネイティブ `editbox` を返します。同じ CM3 editStart/editFinish 契約を配線し、実プロパティの履歴アドレスを使います。任意の `read()` と `write(value,frame)` は TEXT JSON プロパティに適合させます。既定アダプターはネイティブ `[{position,color:"rgba(...)"}]` 保存を保ちます。小数 RGB 値を含め未編集の色文字列を保持します。Shape+ のローカル時刻ファサードに対応します。これらのウィジェットは既存ラベルの下のネイティブプロパティ行全体に広がります。

Settings > Gradient editor で Zoidium または Classic を選択します。Classic は元のピッカーと履歴フックを含め元の CM3 ジェネレーターを呼び出します。ディスパッチはプロパティコントロールレジストリーの背後に留まります。そのためエディター切り替え時もカスタムコントロールと Shape+ のファサードは登録されたままです。

色と不透明度のハンドルはドラッグ、Delete、矢印キーによる微移動、大きいステップ用の Shift、色/値フィールドへのフォーカス用の Enter/ダブルクリックに対応します。バーハンドルを垂直に 65 ピクセル超ドラッグすると除去します。詳細バーの上をクリックすると独立した不透明度ストップを作成します。ダイヤモンドは次のセグメントの中点を編集します。プリセットは `zoidium.gradient-presets.v1` でブラウザーローカルです。ユーザープリセットは最大 24 です。作成したストップだけを含み、プロジェクトや画像データは保存しません。

## 共有カーブコントロールと Shader コードウィンドウ

`plugins/material-plus/graph-curves.js` は Color Curves と Shader+ のシングル/RGBA カーブコントロールを提供します。`createCurveControl(property, context)` は `filled`、`range()` ラベル、`axis` ラベル、`tools`、`presets`、`reset(channel)` 用の任意 `options` を受け付けます。任意 `handles` は `get`、`move`、`movePoint` 操作を提供します。既定サンプラーとネイティブ Color Curves 保存は変更されません。これらのコントロールは正方形プロットで CM3 の値列に収まります。ポインタードラッグ、点フィールド、プリセット、Random、Reset はそれぞれ 1 つのネイティブ履歴操作をコミットします。Escape はドラッグをキャンセルします。Graph/Curves はこの 1 ウィジェット上で表示オプションを選択します。

Shader+ の有効中、ネイティブ Shader および Expression エディターボタンは形状を永続化した Zoidium ウィンドウを開きます。コード領域は Source Code Pro、行番号、Tab/Shift+Tab インデント、Apply、Ctrl/Cmd+S または Ctrl+Enter を使います。Shader 側一覧は uniform/ヘルパー名を挿入します。Shader エラーは CM3 既存の define 補正済みエラーイベントを使います。再度開くと同プロパティのウィンドウにフォーカスします。対象の除去またはプロジェクトの置換で閉じます。

## シェーダーエディターの作成ツール

Shader+ コードウィンドウは下書きと上限付きローカル Undo/Redo スタックを CM3 プロジェクト履歴とは別に保ちます。Apply、Ctrl/Cmd+S、Ctrl+Enter はネイティブプロパティアドレスと 1 つのネイティブ履歴操作を保ちます。ネイティブプロジェクト Undo/Redo はウィンドウを更新します。新しいローカル Undo スタックを開始します。補完は Tab/Enter で確定します。矢印で移動します。Escape で閉じます。それ以外の Escape は共有ウィンドウ動作を保ちます。IME 変換中は補完を確定しません。

エディターは Ctrl/Cmd+/ による行コメント、対括弧、Enter インデント、Ctrl/Cmd+F リテラル検索/置換、Ctrl/Cmd +/- フォントサイズに対応します。`zoidium.shader-editor.fontSize` は 10〜24 px 設定をローカルに保存します。ホバーまたはキャレット配置でリファレンス署名を表示します。側一覧の疑問符は例も表示します。`plugins/shader-plus/reference.js` は安定 ID 付きのプレーンなバージョン管理データです。その `docsUrl` は `/docs/reference/shader/` を指します。側一覧のヘルプリンクはそのページを項目 ID 付きで新しいタブに開きます。Web デプロイとデスクトップビルドは静的ドキュメントを含みます。リファレンスは `node tools/export-shader-reference.js` で書き出します。テストはヘルパーオーバーロード、include、種類保存、補助バインディングを実装と照合します。

編集停止後 400 ms で Shader 下書きは現在のレンダラーコンテキストを使います。使い捨て WebGL プログラムでコンパイルとリンクを行います。共有シェーダーパイプラインは切り離しファサード上でネイティブセットアップと登録済み変換/宣言を実行します。Shader+ のプレビュー宣言はテクスチャ define を除去し、参照されるオプション定数を追加します。ベイクもテクスチャ保持も行いません。これらの検査はプロパティ、ライブパス、プロジェクト履歴、描画フレームのいずれも書き込みません。診断は展開済み include 行を含みます。指示子に、挿入バインディングを最も近い作成行に対応付けます。エラーはガターに印を付け行に下線を引きます。診断のクリックはその行を選択します。ミュートされた uniform ヒントは参考情報です。Declare は不足宣言を精度宣言の後に下書きへ追加します。

テンプレートからの新規作成は Passthrough、Color adjust、Gradient map、Curve remap、Animated noise、Text overlay を提供します。エディターテキストの置換には確認が必要です。必須プロパティは衝突しない名前と明示的な Add properties アクションを使います。これは 1 つのネイティブ履歴項目です。Apply は別のソース編集です。テンプレートは既存プロパティをすべて残します。Animated noise は有効な Expressions+ プラグインを必要とします。それ以外ではメニューで無効です。Text は既存 Shader+ フォントローダーを経由したプロジェクトのプリセットフォントパスを使います。
