---
title: Smart Motion Blur のプロパティ
---
**Smart Motion Blur** は、小数時刻で取得したシーンを合成するか、隣接するプロジェクトフレーム間の動きを推定します。
**Blur Amount** は、現在のフレームを中心とするシャッター区間を制御します。

## プロパティ

| プロパティ | 既定値 | 範囲または選択肢 | 意味 |
| --- | --- | --- | --- |
| Blur Amount | 0.5 | 0～1 | プロジェクトフレーム単位のシャッター時間。シャッター角度は、この値の 360 倍です。 |
| Motion Sensitivity | 70 | 0～100 | Max Displacement に対するオプティカルフローの追跡範囲の割合。0 は両方の再構成方法を無効にします。 |
| Vector Smoothness | 50 | 0～100 | 近接するオプティカルフローの推定値をそろえる強さ。 |
| Max Displacement (px/frame) | 256 | 1～256 | 1 フレームあたりの追跡変位の上限。単位はプロジェクトピクセルです。 |
| Analysis Frames | Both | Both、Previous、Next | 動きの推定に使用する隣接フレーム。片側だけを使用する場合、反対側のシャッター区間には対称の速度を使用します。 |
| Quality | Balanced | Balanced、High | Balanced は 32 時刻、High は 64 時刻を取得します。 |
| View | Result | Result、Motion Vectors、Confidence | Result はブラーを表示します。Motion Vectors は赤と緑で水平と垂直の速度、青で速さを表示します。Confidence は動きの整合性と画像の差をグレースケールで表示します。両方の診断表示は、Reconstruction にかかわらずオプティカルフローを使用します。 |
| Reconstruction | Automatic | Automatic、Optical Flow、Shutter Samples | Automatic は、3D Scene レイヤーでは Shutter Samples、それ以外では Optical Flow を使用します。 |

## 制限

**Blur Amount** または **Motion Sensitivity** が 0 の場合、入力をそのまま出力します。**Optical Flow** で隣接フレームが同一または存在しない場合も同様です。
**Optical Flow** でクリップの端では、取得できる片側の動きを両側のシャッター区間に使用します。
**Optical Flow** でシーンの切り替わりを検出した場合、ブラーを省略します。

**Shutter Samples** は、各取得時刻をクリップの範囲内に制限し、同じ重みを維持します。
**Analysis Frames**、**Vector Smoothness**、**Max Displacement (px/frame)** は使用しません。
正の **Motion Sensitivity** は出力を変更しません。
録画済み映像の元フレーム間に、新しいフレームは生成されません。
シャッター内のカットは平均されます。動く細い輪郭には、サンプル間の帯が生じる場合があります。
遮蔽が解除される領域、繰り返し模様、細い形状、別々に動く似た色の領域では、軌跡が不正確になることがあります。
取得したどのフレームにも写っていない背景の細部は復元できません。
モーションベクトルの外部入力はありません。

レイヤー自身の変形は、解析される入力に含まれません。
動くコンテンツの上にある **Adjustment** レイヤーは、その動きを入力に含みます。

配置と調整の手順は、[動くコンテンツにブラーを追加する](/docs/ja/features/smart-motion-blur/)を参照してください。
