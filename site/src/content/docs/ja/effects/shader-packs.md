---
title: シェーダーパック (AfterClip・CCFX・Afterzoid)
description: 同梱の AfterClip、CCFX Shader Pack、Afterzoid Shader Pack 5 (AlipFX) の有効化手順と収録プリセット一覧です。
---
**Plugins** の **Adjustment Extensions** には、3 つの任意シェーダープリセットパックが用意されています。
単独エフェクトは 1 つのシェーダーを追加し、グループプリセットは編集可能な子エフェクトを含むエフェクトグループを挿入します (グループを展開すると内部の子エフェクトも調整できます)。

## AfterClip (32 シェーダー・11 グループ)

AfterClip からの移行向けパックです。**Plugins** で **AfterClip** を有効にすると、Effects ピッカーに **AFTERCLIP** が追加されます。
プロパティ名はプリセットごとに異なります (多くのシェイプに **Position**、**Rotation**、**Scale**、**Opacity** がありますが、**Line Wave** は **Time**、**Delay**、**Power**、**Step** を使います)。**Twitch** と **VHS** は含まれません。

### 単独エフェクト

- **SHADERS · REPEAT:** **Circle Dot Wave**, **Dot Wave**, **Duplicate (Extended)**, **Gradient Linear Repeat**, **Hex Dot Wave**, **Linear Repeat**, **Radial Repeat**, **Stroke (Extended)**
- **SHADERS · SHAPE:** **Arrow Shape**, **Chevron**, **CLE**, **Gradient (Easeable)**, **Hex Net**, **Line Wave**, **Line Wave Mask**, **Lines**, **Net**, **PinWheel**, **Plain Wave**, **Plain Wave Mask**, **Polygon**, **Polygon Echo**, **Repeating Dots**, **RoundedStar**, **Shockwave**, **Triangle**
- **SHADERS · WARP:** **Fractal Noise**, **Fractal Warp**, **Mirror (Fixed)**, **Polar Coordinates**, **Stretch**, **Wavy (Extended)**

### グループプリセット

| プリセット | 直下の子エフェクト数 | 備考 |
| --- | --- | --- |
| **Circular DotWave** | 4 | グループプリセット |
| **Hex DotWave** | 5 | グループプリセット |
| **Square DotWave** | 5 | グループプリセット |
| **Arrow Effect** | 11 | グループプリセット |
| **Burst** | 3 | グループプリセット |
| **Fractal Burst** | 8 | グループプリセット |
| **Fireworks** | 4 | グループプリセット |
| **Line Waves** | 6 | グループプリセット |
| **Spiral** | 5 | グループプリセット |
| **ChevSync** | 1 | **Sync**、**Ratio**、**Power**、**Amount** をアニメーション |
| **SyncTools v2** | 1 | グループプリセット |

## CCFX Shader Pack (12 シェーダー・7 グループ)

**Plugins** で **CCFX Shader Pack** を有効にすると、Effects ピッカーに **CCFX SHADER PACK** が追加されます。
プロパティ名の大文字・小文字や時間制御はプリセットごとに異なります。時間エクスプレッションが付いたプリセット (たとえば **Sunburst V2** は `uTime` を `time` で駆動) は、手動制御に変える意図がない限り式を残してください。

### 単独エフェクト

- **BACKGROUNDS:** **Sunburst V2** (`rotation`, `speed`, `scale`, `center`), **Voronoi Cell Pattern**
- **DISTORT:** **Puddle**, **Skew V2**, **Warp Waves**
- **TRANSITIONS:** **Wipe Checker**, **Wipe Dots**, **Wipe Rings**, **Wipe Stripes**
- **PART 2:** **CC Light Sweep**, **Lens Flare Lite**, **Plexus V1**

### グループプリセット

| プリセット | 直下の子エフェクト数 | 備考 |
| --- | --- | --- |
| **MxsterFX Dot BG (By CCFX)** | 2 | 背景グループ |
| **MxsterFX Square BG (By CCFX)** | 2 | 背景グループ |
| **Extrude** | 1 | グループプリセット |
| **CC Bend It** | 2 | グループに **Start**、**End**、**Bend** を公開 |
| **Hexagon Array** | 1 | グループプリセット |
| **Plexus V2** | 2 | グループプリセット |
| **AE Warp** | 1 | グループプリセット |

## Afterzoid Shader Pack 5 (AlipFX・200 シェーダー)

1. **Plugins** で **Afterzoid Shader Pack 5** を有効にします。
2. クリップを選び、Effects ピッカーの **ALIPFX · SHADER PACK 5** から検索して追加します。
3. ネイティブプロパティを調整します。

番号付きカラープロパティを Shader+ の Gradient へ置き換えて改造する方法は、[シェーダーの移植](/docs/ja/shaders/porting/#番号付き-alipfx-カラーを置き換える) を参照してください。厳密なピクセル互換が必要な場合は元のプリセットをそのまま使ってください。
