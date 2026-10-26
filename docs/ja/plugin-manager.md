# プラグインマネージャーのオーバーレイ

`zoidium/runtime-config.js` は、共有プラグイン API の後にマネージャーオーバーレイを読み込み、最後に `plugins/plugin-manager.js` を実行してマネージャーを開始します。

実装オーバーレイは `zoidium/` の下にあり、Web とデスクトップのステージングツールがディレクトリとしてコピーします。実装は責任ごとに分割されています:

- `plugin-manager-state.js` は定数、レジストリー、トラッカー、および準備状態を作成します。
- `plugin-manager-persistence.js` はプラグイン選択と保存承認を保存します。
- `plugin-manager-assets.js` はバンドルアセットを解決し、マニフェストを検証し、パッケージを読み込みます。
- `plugin-manager-picker.js` はピッカーエントリーを装飾し、ネイティブエフェクト検索結果を順序付けます。
- `plugin-manager-factories.js` はエフェクト/マテリアルファクトリーをインストールし、プラグイン使用状況を追跡します。
- `plugin-manager-lifecycle.js` はモジュールを有効化、破棄、および登録解除し、診断を報告します。
- `plugin-manager-scanners.js` はシリアル化済みプロジェクト内の依存関係を検出します。
- `plugin-manager-fallbacks.js` は利用できない数値オブジェクトとレイヤーを保持します。
- `plugin-manager-projects.js` はプロジェクト読み込み、保存、およびフィールド保持にフックします。
- `plugin-manager-panel.js` は Plugins ページを構築し、プラグイン/グループ切り替えを処理します。

オーバーレイは `window.ZoidiumPluginManagerInternals` を共有します。これは内部実装テーブルであり、プラグイン API ではありません。不変バインディングはそのテーブルから取得します。可変の起動フラグとピッカーオブザーバーは、使用時にテーブルから読み取ります。オーバーレイ間の関数呼び出しは転送クロージャーを使用するため、すべてのオーバーレイ読み込み後に循環参照が解決します。初期化を開始するのは最後の起動スクリプトのみです。既存の `PZ.zoidium.define` 名とイベントは引き続き公開 API です。

本体マーカーは既存の VM ソーススライス特性テストをサポートします。`test/plugin-manager-source.js` はそれらの本体を元の順序で組み立てます。`test/plugin-manager-overlays.test.js` は実際の順序付きオーバーレイも実行し、import、共有状態、および起動エクスポートを確認します。

アセットオーバーレイ内の `evaluatePluginSource` は、マネージャー唯一の動的ソース評価器です。ネイティブファクトリーレシーバーとモジュールの名前付き引数を保持します。プラグインコードは引き続き完全なオリジン権限で実行されます。このヘルパーは将来の評価ポリシーの共通点であり、セキュリティサンドボックスではありません。
