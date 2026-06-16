# Zoidium

> **Panzoid Clipmaker Gen3** のローカル・スタンドアロン・ミラー — オフライン利用、プライバシー重視、将来的な拡張のために再構築。

Zoidium は Panzoid Clipmaker（WebGL 動画エディタ）一式をバンドルし、**ネットワーク通信なし・テレメトリなし・広告なし**でローカル動作する。ブラウザアプリ / Electron デスクトップアプリ / 静的 Web デプロイ（Cloudflare Pages など任意の静的ホスト）の 3 形態で提供。

---

## 特徴

- 🎬 **Clipmaker Gen3 完全同梱** — Three.js r91 レンダラ、43 エフェクト、39 シェーダ、4 マテリアル、パーティクルシステム
- 🌐 **100% オフライン** — API 通信なし、広告なし、テレメトリなし、全アセット同梱
- 🪟 **3 つの実行形態** — ブラウザ、Electron デスクトップ、静的 Web デプロイ
- 💾 **プロジェクト保存/読込** — `.pz` ファイルは Zoidium とオリジナル Panzoid 双方で動作
- 🔒 **プライバシー最優先** — アカウント不要、分析なし、リモートリクエストなし
- 📦 **クロスプラットフォームビルド** — macOS (`.dmg`)、Windows (`.exe`)、Linux (`.AppImage`)

---

## クイックスタート

### 前提条件

- Node.js 18+ および npm
- macOS / Windows / Linux

### 1. インストール

```bash
git clone https://github.com/zoidnerd/zoidium.git
cd zoidium
npm install
```

### 2. ブラウザで実行

```bash
npm run web
# → http://localhost:8123
```

ブラウザを自動で開く場合:

```bash
npm run dev
```

> ⚠️ **`file://` で `index.html` を直接開かないこと。** Web Worker と WASM モジュールは適切な HTTP オリジンが必要。

### 3. Electron アプリとして実行

```bash
npm start
# → ネイティブウィンドウ + 内蔵 HTTP サーバ
```

### 4. 配布用バイナリのビルド

```bash
npm run dist
```

`dist/` に成果物が出力される:

- `dist/mac/` — macOS `.dmg` (arm64 / x64)
- `dist/win/` — Windows `.exe` (NSIS インストーラ)
- `dist/linux/` — Linux `.AppImage`

---

## プロジェクト構成

```
zoidium/
├── index.html              # エントリポイント
├── pz.all-35.css           # メインスタイルシート（Panzoid pz.all-35.css のミラー）
├── main.js                 # Electron メインプロセス
├── package.json            # npm マニフェスト + electron-builder 設定
├── js/                     # コアエンジン & UI スクリプト（Panzoid minified）
│   ├── core-1.0.102.js
│   ├── ui-1.0.72.js
│   ├── clipmaker-3.0.106.js
│   └── three.r91.min.js
├── effect/                 # 43 種のポストプロセッシングエフェクト（vanilla JS）
├── material/               # 4 種のマテリアル
├── worker/                 # WASM ワーカ（tar, av/FFmpeg）
├── fonts/                  # Open Sans & Source Code Pro (woff2)
│   ├── fonts.css
│   ├── open-sans-regular.woff2
│   └── source-code-pro-regular.woff2
├── assets/
│   ├── fonts/2d/           # 28 種の TTF フォント
│   ├── images/             # アイコン & ファビコン
│   ├── shaders/            # 39 個の GLSL シェーダ
│   └── textures/particles/ # 36 種のパーティクルテクスチャ
├── docs/                   # フォーマット仕様 & 開発ノート
├── README.md               # English
├── README.ja.md            # 日本語
└── REWRITE.md              # 長期的リライト戦略
```

---

## 静的デプロイ（Cloudflare Pages, Vercel, Netlify など）

Zoidium はビルドステップなしの静的サイト。

1. リポジトリを Git プロバイダにプッシュ
2. 静的ホストで以下を設定:
   - **Build command:** *(空欄)*
   - **Build output directory:** `/`（プロジェクトルート）
3. デプロイ

`node_modules/`、`dist/`、巨大な `docs/` ファイルは `.gitignore` と `.cfignore` で除外されるためデプロイが軽量に保たれる。

### URL 構造

全アセットをプロジェクトルートから配信する、オリジナルの Panzoid と同じレイアウト:

```
/                          → index.html
/pz.all-35.css             → メインスタイルシート
/fonts/fonts.css           → ローカルフォント定義
/fonts/open-sans-regular.woff2
/fonts/source-code-pro-regular.woff2
/js/core-1.0.102.js
/js/ui-1.0.72.js
/js/clipmaker-3.0.106.js
/js/three.r91.min.js
/effect/...
/material/...
/worker/...
/assets/...
```

このため、`<link>` と `<script>` タグをそのまま任意の HTML（例: 最小限の "Graph editor" スタイルガイドなど）に埋め込めば、Zoidium / AfterClip / 他の Panzoid ミラーでアセット解決が共通になる。

---

## 開発

### エフェクト / マテリアルの編集

`effect/*.js` と `material/*.js` のエフェクト・マテリアルは Panzoid ランタイムが読み込む vanilla JS モジュール。`PZ.effect()` / `PZ.material()` ファクトリを export する — 既存ファイル（例: `brightnesscontrast.js`）を参照すれば API 形状が分かる。

新規エフェクトの追加:

1. `effect/myneweffect.js` を既存と同じ形式で作成
2. Panzoid ランタイムが `effect/` と `material/` 内のファイルを自動検出

### レガシー Panzoid コードの調査

同梱の `js/*.js` は minify 済み。可読なリファレンスとして:

- [`docs/PZ_FORMAT.md`](./docs/PZ_FORMAT.md) — Gen2 `.pz` ファイル形式
- [`docs/PZ_FORMAT_V3.md`](./docs/PZ_FORMAT_V3.md) — Gen3 `.pz` ファイル形式
- [`docs/TWEEN_LOCATIONS_SUMMARY.md`](./docs/TWEEN_LOCATIONS_SUMMARY.md) — トゥイーン/イージング一覧

---

## ロードマップ

[`REWRITE.md`](./REWRITE.md) を参照。レガシー minified バンドルを TypeScript + React + Vite に移植しつつ、`.pz` ファイルとのワイヤー形式互換性を維持する長期戦略。

---

## ライセンス

本プロジェクトは Panzoid レガシーエディタの派生物。全ての原著作権は Panzoid に帰属。Zoidium はオフラインモード用のシム（テレメトリ・広告・リモート API 呼び出しの無効化）とパッケージングのみを追加している。

---

## 関連

- [English README](./README.md) — 英語版
