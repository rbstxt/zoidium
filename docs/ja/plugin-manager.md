# プラグインマネージャーのオーバーレイ

`zoidium/runtime-config.js` は、共有プラグイン API の後にマネージャーオーバーレイを読み込み、最後に `plugins/plugin-manager.js` を実行してマネージャーを開始します。

実装オーバーレイは `zoidium/` の下にあり、Web とデスクトップのステージングツールがディレクトリごとコピーします。実装は役割ごとに分割されています:

- `plugin-manager-state.js` は定数、レジストリー、トラッカー、準備状態を作ります。
- `plugin-manager-persistence.js` はプラグイン選択と保存承認を保存します。
- `plugin-manager-assets.js` はバンドルアセットを解決し、マニフェストを検証してパッケージを読み込みます。
- `plugin-manager-picker.js` はピッカーエントリーを装飾し、ネイティブエフェクト検索結果を並べ替えます。
- `plugin-manager-factories.js` はエフェクト/マテリアルファクトリーを導入し、プラグイン利用状況を追跡します。
- `plugin-manager-lifecycle.js` はモジュールを有効化、破棄、登録解除し、診断を報告します。
- `plugin-manager-scanners.js` はシリアル化済みプロジェクト内の依存関係を検出します。
- `plugin-manager-fallbacks.js` は利用できない数値オブジェクトとレイヤーを保持します。
- `plugin-manager-projects.js` はプロジェクト読み込み、保存、フィールド保持にフックします。
- `plugin-manager-panel.js` は Plugins ページを作り、プラグイン/グループ切り替えを処理します。

オーバーレイは `window.ZoidiumPluginManagerInternals` を共有します。これは内部実装テーブルであり、プラグイン API ではありません。固定のバインディングはこのテーブルから取り出して使います。可変の起動フラグとピッカーオブザーバーは、使うときにテーブルから読み取ります。オーバーレイ間の関数呼び出しは転送クロージャーを使うため、すべてのオーバーレイ読み込み後に循環参照が解決します。初期化を始めるのは最後の起動スクリプトだけです。既存の `PZ.zoidium.define` 名とイベントは引き続き公開 API です。

本体マーカーは既存の VM ソーススライス特性テストを支えます。`test/plugin-manager-source.js` はそれらの本体を元の順序で組み立てます。`test/plugin-manager-overlays.test.js` は実際の順序付きオーバーレイも実行し、import、共有状態、起動エクスポートを確認します。

アセットオーバーレイ内の `evaluatePluginSource` は、マネージャーで唯一ソースを動的に評価する場所です。ネイティブファクトリーレシーバーとモジュールの名前付き引数を保持します。プラグインコードは引き続き完全なオリジン権限で実行されます。このヘルパーは将来の評価ポリシーの集約点であり、セキュリティサンドボックスではありません。
