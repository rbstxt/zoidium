# Zoidium SEO research notes

調査日: 2026-09-04

このメモは、Zoidiumの検索流入設計を考えるために、Google Search Centralなどの一次資料から確認した事項をまとめたものです。検索順位やリッチリザルトの表示は保証されません。

## 公式資料から確認したこと

- Google Search Essentialsは、検索に必要な技術要件、スパムポリシー、ユーザーの役に立つコンテンツやクロール可能なリンクなどの基本方針を示している。要件を満たしても、クロール・インデックス・表示は保証されない。<https://developers.google.com/search/docs/essentials>
- JavaScriptサイトはクロール、レンダリング、インデックスの段階で処理される。サーバーサイドレンダリングや事前レンダリングは、ユーザーとクローラーの双方にとって高速になり、JavaScriptを実行できないボットにも届きやすい。<https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics>
- Googleが通常クロールできるリンクは、`href`を持つ`a`要素。重要なページは、発見可能なページから説明的なアンカーテキスト付きでリンクする。<https://developers.google.com/search/docs/crawling-indexing/links-crawlable>
- サイトマップは検索結果への掲載を保証するものではなく、検索に出したい正規URLを絶対URLで列挙するためのヒント。ルートに置き、Search Consoleで送信できる。<https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap>
- 異なる言語のページは、各言語版が自分自身と他の全言語版を相互に示す`hreflang`を使える。言語ごとに別URLを用意する方が、クローラーが全バリエーションを発見しやすい。<https://developers.google.com/search/docs/advanced/crawling/localized-versions>
- 構造化データは検索機能の対象になる手がかりだが、正しく実装してもリッチリザルト表示は保証されない。ページ本文に見えている内容と一致させる。<https://developers.google.com/search/docs/appearance/structured-data/sd-policies>
- `WebSite`構造化データは、Googleにサイト名の希望を伝えるためにホームページへ置ける。`Organization`はロゴや組織情報を説明する用途で使える。<https://developers.google.com/search/docs/appearance/site-names> <https://developers.google.com/search/docs/appearance/structured-data/organization>
- Core Web Vitalsはページ体験と検索の関連指標だが、良い数値だけで上位表示が決まるわけではない。<https://developers.google.com/search/docs/appearance/core-web-vitals>
- AI OverviewsやAI Modeに出るための専用ファイルや専用スキーマはなく、通常のクロール可能性、テキスト、内部リンク、ページ体験、正確な構造化データが基本になる。<https://developers.google.com/search/docs/appearance/ai-features>

## Zoidiumへの適用上の注意

- リポジトリの`index.html`はCM3ランタイムを含まないプレースホルダーで、`noindex, nofollow`が意図的に設定されている。検索用ホームページにする場合は、このファイルを直接公開用ページに変えるのではなく、生成ステージまたは別の静的サイトを設計する。
- 現在のWeb版ルートはCM3とZoidiumの実行シェルであり、説明文の多くがJavaScriptで生成される。検索用の説明、機能、プラグイン、導入手順は、ランタイムを起動しなくても読めるHTMLページとして別に用意する。
- PanzoidやCM3との関係は、独立した外部拡張レイヤーであることを明記する。公式サービスや承認製品と誤認させるタイトル、構造化データ、比較文は使わない。
