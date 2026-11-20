---
title: Text+
description: ネイティブ 2D テキストと 3D テキストの文字単位アニメーション、最大 3 段の 2D アニメーター、3D 文字別マテリアル、3D ベベル設定を解説します。
---
**Text+** (既定で有効) を使うと、ネイティブの 2D **Text** レイヤーや **3D Text** オブジェクトを文字単位でアニメーションさせ、選んだ 3D 文字だけに前面・側面マテリアルを割り当て、3D テキストの間隔やベベルを調整できます。

Formula・Spline・Orbit・Repeater・Voronoi を含む 11 種類のエフェクターを積み重ねたい場合や、**3D Text** を文字ごとの別オブジェクトに分解したい場合は、[ExpressText+](/docs/ja/2d-and-text/expresstext-plus/) を使ってください。Text+ コンテナーが 3D Text を所有している間は、ExpressText+ よりも Text+ が優先されます。

## ネイティブ 2D Text レイヤーをアニメーションさせる

1. **Plugins** で **Text+** が有効であることを確認します。
2. **LAYERS** から **Text** を追加して選択します。
3. ネイティブの Properties パネルで **Character** カテゴリを開きます。
4. **Mode** で **Character Transform**、**Gradient Transform**、**Character Shake**、**Selected Character Transform**、**Selected Character Shake**、または **Random Scatter** を選びます。
5. **Position**、**Scale**、**Rotation**、**Delay**、**Delay order** を設定し、キーフレームを打ちます。

- **特定の文字だけ動かす:** **Selected** 系モードを選び、**Characters** に `1,4,5` のような 1 始まりの番号を入力します (空白も 1 文字として数えます)。
- **最大 3 段の重ね掛け:** **Character > Mode** を有効にすると下に **Character 2** が現れ、同様に **Character 3** も現れます。後のカテゴリは前の結果に対して重なります (例: **Character** で揺らし、**Character 2** で散らす)。
- **2D のコントロールと全体変形:** 2D では Position と Scale は X / Y のみ、Rotation は平面内回転となり、**Rotation order** と **Axis** はありません。テキスト全体の移動や書式は、上部のネイティブ **Text**、**Font**、**Size**、**Fill**、**Stroke**、**Position**、**Rotation**、**Scale** で操作します。読み込み済みフォントは **Font** ピッカーの **Project fonts** に並びます。
- **無効化や Shape+ 変換:** 文字アニメーションを止めるには、すべての **Mode** を **None** にします (2D Text を Shape+ へ変換する前に必ず行ってください。変換後の Shape+ 輪郭には Text+ コントロールがありません)。**Plugins** で **Text+** を無効にしてもネイティブ Text はそのまま描画され、設定も保存されます。

## 親オブジェクト経由で 3D Text をアニメーションさせる

1. 3D Scene の **Objects** パネルで、**Text+** のアニメーション親 (**Character Transform**、**Gradient Transform**、**Character Shake**、**Selected Character Transform**、**Selected Character Shake**、**Random Scatter**) を追加します。
2. ネイティブの **3D Text** オブジェクトをその親の子として配置します。
3. 親の **Character** カテゴリを開き、プロパティをアニメーションさせます。

アニメーション親を入れ子にすると変換が合成されます。新しいスケール設定は元の Text スケールに乗算されます。

## 選んだ 3D 文字に別マテリアルを割り当てる

1. 3D Scene の **Objects** パネルで **Text+** の **Character Material** を追加します。
2. ネイティブの **3D Text** オブジェクトを中に入れます。
3. **Character** の **Characters** に `1,3,4` のような 1 始まりの番号を入力します (空欄にすると全文字が対象になります)。
4. **Front material** (前後キャップ) と **Side material** (押し出し側面とベベル) にマテリアルを設定します。元の Text マテリアルを残したいスロットはマテリアルを削除します。
5. 各マテリアルのプロパティを編集またはキーフレーム化します。

特定の文字だけ前面と側面を入れ替えたい場合は、内側にもう 1 つ **Character Material** 親を入れ子にして対象文字を指定します。その文字を選択している最も内側の親が両方のスロットを制御します (内側の空スロットは元の Text マテリアルを使用)。
**Character Material** は任意の Text+ アニメーション親と入れ子にでき、3D Text 以外のオブジェクトを同じグループに置いても影響しません。Text+ 無効環境で開いた場合は元の Text マテリアルで描画され、スロット設定は保持されます。

## プロパティリファレンス

以下の表は 3D 親コントロールを基準にしています。2D では Position と Scale は 2D ベクトル、Rotation は単一角度になり、**Rotation order** と **Axis** は表示されません。`—` は範囲指定なしを意味します。

### Character Transform (および Selected Character Transform)

**Selected** 版には **Characters** (初期値 `1`、空欄で対象なし) が追加され、遅延も選択文字のみ数えます。

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Characters** | テキスト | テキスト | `1` | 1 始まりの文字番号 (Selected 版のみ)。空白も 1 文字。 |
| **Position** | 3D ベクトル | — | `[0, 0, 0]` | 文字ごとの位置オフセット。 |
| **Scale** | 3D ベクトル | ≥ 0.001 | `[1, 1, 1]` | 文字ごとの拡大倍率。 |
| **Rotation** | 3D ベクトル | — | `[0, 0, 0]` | 文字ごとのオイラー回転 (度)。 |
| **Rotation order** | 選択肢 | **XYZ**, **YZX**, **ZXY**, **XZY**, **YXZ**, **ZYX** | **XYZ** | 3 軸の回転順序。 |
| **Pivot** | 選択肢 | **Character**, **Text** | **Character** | 各文字中心またはテキスト全体中心。 |
| **Delay** | 数値 | ≥ 0 | `0` | 文字間の遅延フレーム数。 |
| **Delay order** | 選択肢 | **Forward**, **Reverse**, **Center out**, **Random** | **Forward** | 遅延を割り当てる順。 |
| **Seed** | 数値 | — | `1` | **Random** 遅延順のシード。 |

### Gradient Transform

中間の文字は **First** と **Last** の値を線形補間します (1 文字のときは **First** を使用)。

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **First position**, **Last position** | 3D ベクトル | — | `[0, 0, 0]` | 先頭文字と末尾文字の位置オフセット。 |
| **First scale**, **Last scale** | 3D ベクトル | ≥ 0.001 | `[1, 1, 1]` | 先頭文字と末尾文字の拡大倍率。 |
| **First rotation**, **Last rotation** | 3D ベクトル | — | `[0, 0, 0]` | 先頭文字と末尾文字の回転 (度)。 |
| **Rotation order** | 選択肢 | **XYZ**, **YZX**, **ZXY**, **XZY**, **YXZ**, **ZYX** | **XYZ** | 3 軸の回転順序。 |

### Character Shake (および Selected Character Shake)

揺れを動かすには **Phase** をアニメーションさせてください (**Phase** が一定のままだと静止姿勢になります)。**Selected** 版には **Characters** (初期値 `1`) が追加されます。

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Characters** | テキスト | テキスト | `1` | 1 始まりの文字番号 (Selected 版のみ)。 |
| **Amplitude** | 数値 | `0` ～ `360` | `0` | 最大振れ角 (度)。 |
| **Period** | 数値 | ≥ 0 | `24` | 1 周期の長さ (**Phase** 単位)。 |
| **Phase** | 数値 | — | `0` | 揺れの進行位相。 |
| **Axis** | 3D ベクトル | — | `[0, 0, 1]` | 回転軸 (3D のみ)。 |
| **Pivot** | 選択肢 | **Character**, **Text** | **Character** | 各文字中心またはテキスト全体中心。 |
| **Phase offset** | 数値 | ≥ 0 | `0` | 文字間の位相差。 |
| **Offset order** | 選択肢 | **Forward**, **Reverse**, **Center out**, **Random** | **Forward** | 位相差を割り当てる順。 |
| **Seed** | 数値 | — | `1` | **Random** 順のシード。 |

### Random Scatter

**Amount** をアニメーションさせて、シード付きのランダム姿勢へ散らします。

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Amount** | 数値 | ≥ 0 | `0` | 元の姿勢からランダム姿勢へのブレンド量。 |
| **Pivot** | 選択肢 | **Character**, **Text** | **Character** | 各文字中心またはテキスト全体中心。 |
| **Min position**, **Max position** | 3D ベクトル | — | `[-10, -10, -10]`, `[10, 10, 10]` | ランダム移動の範囲。 |
| **Min rotation**, **Max rotation** | 3D ベクトル | — | `[0, 0, 0]` | ランダム回転の範囲 (度)。 |
| **Min scale**, **Max scale** | 3D ベクトル | ≥ 0.001 | `[1, 1, 1]` | ランダム拡大率の範囲。 |
| **Seed** | 数値 | — | `1` | 再現可能な乱数シード。 |

### 3D Text の追加プロパティ

| コントロール | 型 | 範囲または選択肢 | 初期値 | 出力への影響 |
| --- | --- | --- | --- | --- |
| **Horizontal spacing** | 数値 | `-200` ～ `200` | `0` | 文字間の追加水平スペース。 |
| **Index offset** | 数値 | ≥ 0 | `0` | 共有文字シーケンス内での開始オフセット。 |
| **Total characters** | 数値 | ≥ 0 | `0` | 遅延やグラデーション計算に使う総文字数 (`0` でローカル文字数)。 |
| **Bevel size** | 2D ベクトル | ≥ 0 | `[0.1, 0.5]` | ベベルの厚みと幅。 |
| **Bevel side** | 選択肢 | **outside**, **inside** | **outside** | 輪郭に対するベベルの向き。 |
| **Bevel subdivision** | 数値 | `1` ～ `100` | `3` | ベベルの分割数。 |
| **Cap profile** | 選択肢 | **flat**, **round** | **round** | キャップの形状。 |
| **Bevel tension** | 数値 | `0` ～ `1` | `0.5` | 丸ベベルの曲率。 |

シーケンスのフレームレートを変更しても、Text+ のタイミングは秒単位で自動調整されます。詳しくは [タイムラインとフレームレート](/docs/ja/workflow/timeline/) を参照してください。
