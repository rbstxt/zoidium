---
title: Particles+ スプライト
description: ネイティブパーティクルの Texture ピッカーへ 54 種類のモノクロスプライトを追加する Particles+ の使い方と一覧です。
---
**Particles+** を使うと、ネイティブパーティクルオブジェクトの **Texture** ピッカーから、54 種類の `128 × 128` モノクロ (白＋グロー) スプライトを選べます。
変更されるのはパーティクルのテクスチャのみで、シミュレーション挙動自体は変わりません。

## スプライトを設定する

1. **Plugins** で **Particles+** を有効にします。
2. 3D シーン内のネイティブパーティクルオブジェクトを選択します。
3. **Texture** ピッカーを開き、**circle**、**ring_outline**、**flare_glint** などのスプライトを選びます。
4. プロジェクトを保存して画像アセットを保持します。

プリセットを選ぶと画像がプロジェクトのアセット一覧に追加され、**Particles+** への依存関係が記録されます (通常の CM3 とは非互換になります)。
使用中のスプライトが残っている間は **Particles+** を無効にできません。依存関係を外すには、すべての Particles+ テクスチャをネイティブテクスチャまたは自前の画像へ差し替えてください。

## スプライト一覧

### 図形とパターン (31 種)

- **circle**, **square**, **triangle**, **pentagon**, **hexagon**, **octagon**, **diamond**
- **ring_outline**, **ring_double**, **triangle_outline**, **square_outline**, **rounded_square**, **rounded_square_outline**, **hexagon_outline**
- **plus**, **plus_cut_square**, **cross**, **cross_outline**, **line_horizontal**, **line_vertical**
- **grid**, **dot_grid**, **radial_lines**, **spiral**, **snowflake**, **lattice**, **concentric_rings**, **broken_ring**
- **star_5**, **star_6**, **star_8**

### グローとフレア (23 種)

- **flare_glow_ring**, **flare_halo**, **flare_double_halo**, **flare_blob**, **flare_orb_soft**
- **flare_burst**, **flare_burst_soft**, **flare_needles**, **flare_starburst_fine**, **flare_starburst_dust**, **flare_eight_ray**
- **flare_streak_thin**, **flare_streak_wide**, **flare_streak_glow**, **flare_vertical_streak**, **flare_crossbeam**
- **flare_fourdot**, **flare_fourdot_soft**, **flare_sixdot**, **flare_ring_streak**, **flare_ripple**, **flare_spectral**, **flare_glint**
