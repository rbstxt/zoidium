# Zoidium

> CM3の体験を拡張するためのオープンソースツール集。

Zoidiumは、Clipmaker Gen3（CM3）の外側で動作する拡張レイヤーです。
プラグイン、ローカル優先のアダプター、クリエイター向けツール、ブラウザ・
デスクトップ向けのパッケージングを提供します。

Zoidiumのソースコード、プラグイン、ドキュメント、ビルドツールは
[MIT License](./LICENSE)で許諾されます。同梱のSource Code Pro、Geist、Geist Mono、
JetBrains Mono、IBM Plex Sans、IBM Plex Mono、Cascadia Mono、Fira Codeフォントには独自の
[SIL Open Font License 1.1](./fonts/LICENSE.md)が適用されます。
実行時またはビルド時に取得するCM3リソースは、それぞれの権利者の通知と利用条件に従います。

リポジトリには、CM3のランタイム、エフェクト、マテリアル、ワーカー、
シェーダー、テクスチャ、CM3由来のフォント、アイコン、ダウンロードページを
含めません。一方、`fonts/`には別ライセンスで利用できるUIフォントを
同梱しています。これはPanzoid/CM3リソースではありません。`pnpm run setup`または
開発・ビルドの開始時に、
`tools/runtime-resources.js` が設定されたClipmaker 3とVideo Editor 2のソースページ、
および両者が使う同一オリジンのリソースグラフをGit管理外の
`.zoidium-resources/`へ取得します。キャッシュは
ローカルサーバー終了後も保持し、静的デプロイではそのデプロイに必要な生成物だけが残ります。
CM3とZoidiumの拡張レイヤーは、このキャッシュに取得したCM3リソースを使用します。
CM3固有のフォントプリセットはキャッシュから使いますが、Zoidiumの拡張レイヤーは
Settingsで選択したローカルまたはシステムのフォントを使います。フォントCDNへのリクエストは発生しません。

## クイックスタート

前提: Node.js 18+ と pnpm 11.1.2。リポジトリの`package.json`でpnpmのバージョンを固定しています。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run setup     # CM3リソースキャッシュを取得・更新
pnpm run web       # キャッシュを準備して http://127.0.0.1:8123 と http://localhost:8123 で配信
pnpm run dev       # 同じ処理を行い、ブラウザも開く
pnpm start         # Electron開発モード（キャッシュを使用）
pnpm run verify    # マニフェスト、バンドル、構文、テストを確認
```

ローカルWebサーバーはZoidium管理の実行時ファイルをチェックアウトから
直接配信するため、サーバーを再起動せずにブラウザを再読み込みすれば編集内容が
反映されます。プラグインのソースやマニフェストを変更した場合は
`pnpm run build:plugin-bundles`で生成済みバンドルを更新してください。次の再読み込み
からすぐに使用されます。

リポジトリの`index.html`を`file://`で直接開かないでください。これは
ブートストラップ用のプレースホルダーであり、実際のCM3ページは実行時
ステージへ生成されます。Web WorkerとWASMにはHTTPオリジンが必要です。

## ビルドとデプロイ

静的サイトを作る場合:

```bash
pnpm run build
```

生成先は`dist/web/`です（Gitの対象外）。Cloudflare Pagesなどの静的ホストでは、
Build commandを`pnpm run build`、出力ディレクトリを`dist/web`に設定します。
`pnpm run build`は`pnpm run build:web`と同じCM3 Fetch処理を行うDeployの入口です。
`wrangler.jsonc`にもPagesの出力先として`dist/web`を記録しています。ビルド時に
CM3ソースグラフを取得するため、ビルド環境にはネットワーク接続が必要です。
リポジトリ直下をDeployしないでください。直下の`index.html`はソースチェックアウト用の
プレースホルダーであり、Deploy対象は生成された`dist/web/`です。

Cloudflare Pagesへ直接Deployする場合は次を実行します。

```bash
pnpm run deploy
```

CM3ステージを先に生成し、`dist/web/`だけをWranglerで公開します。
Wranglerの認証と`zoidium` Pagesプロジェクトへのアクセス権が必要です。

デスクトップ配布物を作る場合:

```bash
pnpm run dist
```

Electronビルダーは、キャッシュ済みのCM3リソースを一時的なアプリツリーへ展開して
インストーラーを作り、その一時ツリーを削除します。インストーラーにはその
ビルドに必要なランタイムが含まれますが、ソースリポジトリには含まれません。

ビルドまたはローカル実行時に互換ソースを差し替える場合は、
`ZOIDIUM_CM3_SOURCE_PAGE`または`ZOIDIUM_VIDEO_EDITOR_SOURCE_PAGE`を設定します。
既定値は次のURLです。

`https://panzoid.com/legacy/gen3/clipmaker.html`

`https://panzoid.com/legacy/gen3/videoeditor.html`

## ランタイムのライフサイクル

処理の流れは次のとおりです。

1. キャッシュがない、または更新を指定した場合に、設定されたCM3 HTMLページを取得する。
2. 同一オリジンのCSS・JavaScriptリンクと静的ランタイム参照を検出する。
3. URLパスを維持したまま、取得物をGit管理外のキャッシュへ保存する。
4. ステージ内の`index.html`をパッチし、CM3の初期化を遅延してZoidium拡張層を注入する。
5. ステージを配信またはパッケージ化する。
6. ローカルサーバー終了後もキャッシュを保持し、ビルド処理用の一時ツリーだけを終了時に削除する。

コミット済みのリソースマニフェストやソースページのコピーはありません。
`pnpm run setup`で現在のHTMLとランタイムグラフからキャッシュを更新し、通常の実行は
そのキャッシュを再利用します。キャッシュがない場合は`web`やビルドが自動作成します。

保存・書き出し時は、CM3側の旧来のダウンロードページ遷移を
`zoidium/direct-download.js`が捕捉し、生成済みBlobをその場でブラウザの
ダウンロード機構へ渡します。別ページや新しいウィンドウは開きません。

`tools/runtime-resources.js`はCM3ファイルを取得する唯一の処理です。設定された
ソースページを取得し、同一オリジンの参照ファイルを検出し、Git管理外のキャッシュへ
保存します。その後、Zoidiumのファイルをステージへコピーし、CM3の初期化を遅延させる
パッチを適用します。ブラウザサーバー、Webビルダー、Electronビルダーはこの処理を共有します。

## リポジトリ構成

```text
Zoidium/
├── index.html                  # ブートストラップ用プレースホルダー
├── LICENSE                     # Zoidiumが保有する部分のMIT License
├── main.js                     # Electronプロセスとキャッシュ利用サーバー
├── package.json                # pnpmスクリプトとElectron設定
├── fonts/
│   ├── fonts.css               # ローカルUIフォント
│   ├── cascadia-mono-regular.woff2
│   ├── fira-code-regular.woff2
│   ├── geist-sans-variable.woff2
│   ├── geist-mono-variable.woff2
│   ├── ibm-plex-sans-regular.woff2
│   ├── ibm-plex-mono-regular.woff2
│   ├── jetbrains-mono-variable.woff2
│   ├── source-code-pro-regular.woff2
│   ├── LICENSE.md              # Source Code ProのSIL Open Font License
│   └── README.md               # 出典とライセンスの詳細
├── tools/
│   ├── runtime-resources.js    # CM3グラフの取得・キャッシュ・検出・パッチ
│   ├── serve-with-resources.js # キャッシュ利用Webサーバー
│   ├── build-web.js            # 静的デプロイ用ビルダー
│   └── build-electron.js       # 一時ステージ用Electronビルダー
├── zoidium/
│   ├── runtime-config.js       # 拡張プロファイル
│   ├── runtime-loader.js       # 拡張ブートストラップ
│   ├── runtime-fonts.css       # 選択したローカル/システムフォントを適用
│   ├── settings.js             # エディター設定タブ
│   ├── runtime-policy.js       # ローカル優先のポリシーアダプター
│   └── direct-download.js      # その場でのBlobダウンロード
├── plugins/                    # 拡張ソースと生成済みプラグインバンドル
└── about/                      # 通知とプロジェクト情報
```

## プラグイン

プラグインはCM3を拡張する任意のツールです。ソース、マニフェスト、プリセット、
編集用アセットは`plugins/`に置き、通常の実行時には有効化されたプラグインごとに
生成済みの`bundle.json`を1回取得します。

```bash
pnpm run build:plugin-bundles
pnpm run check:plugin-manifests
pnpm run check:plugin-bundles
```

`pnpm run build`と`pnpm run dist`ではバンドル生成も自動実行されます。バンドルの規約は
[`plugins/README.md`](./plugins/README.md)を参照してください。

## 位置づけと帰属

Zoidiumは独立したオープンソースツール集であり、CM3またはPanzoidの公式製品
ではありません。CM3のソースファイルは設定された上流ページから実行時・ビルド時に
取得され、それぞれの権利者の通知と利用条件に従います。Zoidiumの拡張コード、
プラグイン、ドキュメント、ビルドツールはMIT Licenseで許諾されます。最新の通知は
[`about/acknowledgements/`](./about/acknowledgements/)を確認してください。

## 関連ファイル

- [`README.md`](./README.md) — English README
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — コントリビューター向け手順
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — ランタイムとプラグインの構造
- [`zoidium/README.md`](./zoidium/README.md) — ステージ実装メモ
- [`AGENTS.md`](./AGENTS.md) — コントリビューター／エージェント向け規約
