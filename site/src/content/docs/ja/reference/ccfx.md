---
title: CCFX エフェクト一覧
description: 登録されたエフェクト、カテゴリ、グループプリセット。
sidebar:
  label: CCFX 一覧
---
CCFX は単体エフェクトを 12 個、グループプリセットを 7 個登録します。単体エフェクトはシェーダーを 1 つ挿入します。グループは保存された子エフェクトの構成を挿入します。

## 単体エフェクト

| エフェクト | ピッカーのカテゴリ | ID |
| --- | --- | --- |
| **Sunburst V2** | **BACKGROUNDS** | `part-1-backgrounds-sunburst` |
| **Voronoi Cell Pattern** | **BACKGROUNDS** | `part-1-backgrounds-voronoi-cell-pattern` |
| **Puddle** | **DISTORT** | `part-1-distort-puddle` |
| **Skew V2** | **DISTORT** | `part-1-distort-skew-v2` |
| **Warp Waves** | **DISTORT** | `part-1-distort-warp-waves` |
| **Wipe Checker** | **TRANSITIONS** | `part-1-transitions-s-wipechecker` |
| **Wipe Dots** | **TRANSITIONS** | `part-1-transitions-s-wipedots` |
| **Wipe Rings** | **TRANSITIONS** | `part-1-transitions-s-wiperings` |
| **Wipe Stripes** | **TRANSITIONS** | `part-1-transitions-s-wipestripes` |
| **CC Light Sweep** | **PART 2** | `part-2-cc-light-sweep` |
| **Lens Flare Lite** | **PART 2** | `part-2-lens-flare-lite` |
| **Plexus V1** | **PART 2** | `part-2-plexus-v1` |

## グループプリセット

| プリセット | 直接の子の数 | ID |
| --- | --- | --- |
| **MxsterFX Dot BG (By CCFX)** | 2 | `group-part-1-backgrounds-mxsterfx-halfdots-bg` |
| **MxsterFX Square BG (By CCFX)** | 2 | `group-part-1-backgrounds-mxsterfx-square-bg` |
| **Extrude** | 1 | `group-part-1-miscellaneous-extrude` |
| **CC Bend It** | 2 | `group-part-2-cc-bend-it` |
| **Hexagon Array** | 1 | `group-part-2-hexagon-array` |
| **Plexus V2** | 2 | `group-part-2-plexus-v2` |
| **AE Warp** | 1 | `group-part-2-warp` |

## プロパティと範囲

コントロールはプリセットごとに異なります。Sunburst V2 には **rotation**、**speed**、**scale**、**center** があります。CC Bend It グループには **Start**、**End**、**Bend** があります。

Sunburst V2 の **uTime** は `time` を使用します。ほかのプリセットでは、手動の値や別の式を使う場合があります。パック全体に共通する時間コントロールはありません。

[CCFX の使用手順](/docs/ja/features/ccfx/).
