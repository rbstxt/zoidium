---
title: Track To でオブジェクトを向ける
sidebar:
  label: Constraints と Track To
---
同一のネイティブ 3D Scene 内で、3D オブジェクトをターゲットに向けます。

1. **Objects** でオブジェクトを選択します。
2. Rotation の各行の下にある **Track to** を設定します。
3. ターゲットを選択します。
4. **Track axis** を選択します。
5. 異なる **Up axis** を選択します。
6. **Influence** を設定またはアニメーションさせます。

100 パーセントでは、トラック軸がターゲットを指します。0 では、オブジェクト自体の回転が優先されます。コンストレイントを削除するには、Track to を None に設定します。

スポットライトまたはディレクショナルライトの場合は、Track to と Influence を設定します。これらのライトはネイティブの Target 位置を通じて向きを合わせ、トラック軸のコントロールは表示されません。Track To によるカメラショットには、ネイティブのシーンカメラを使用します。Camera+ のシーケンスカメラレイヤーは、同一シーンのターゲット規約の対象外です。

[Constraints ソースコントラクト](https://github.com/rbstxt/zoidium/blob/dev/plugins/constraints/README.md)に、見つからないターゲット、循環参照、およびサポートされているライトについて記載されています。[Track To の互換性](/docs/ja/development/project-compatibility/#track-to-コンストレイント)に、保存される UUID とコンストレイントのプロパティについて記載されています。
