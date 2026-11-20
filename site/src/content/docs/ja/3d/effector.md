---
title: Effector
description: 3D オブジェクト階層を複製・変形・粉砕・遅延させる Effector と Effector+ 互換レイヤーのガイドとリファレンスです。
---
**Effector** (既定で有効) を使うと、配下に配置した 3D オブジェクトをプロシージャルに複製、ねじり、曲げ、粉砕、遅延できます。トップレベルの並列オブジェクトには作用しません。

## エフェクターを設定する

### 子オブジェクトを複製する (Repeater)

1. シーンの 3D オブジェクトピッカーで **Effector > Repeater** (または **Linear Repeater**、**Random Repeater**、**Echo Repeater**) を追加します。
2. リピーター行の **+** をクリックして複製元のオブジェクトを子として追加します。
3. **Repeater** セクションで **Count** (`1` ～ `128`) と位置・回転・スケールを調整します。

始点と終点の間に並べるなら **Linear Repeater**、シード付き範囲で散らすなら **Random Repeater**、過去フレームの姿勢を並べるなら **Echo Repeater** を使います。

### Twist や Warp でメッシュを変形する

1. **Effector > Twist** または **Effector > Warp** を追加し、対象メッシュを子に入れます。
2. Twist では **Axis** と **Angle**、Warp では **Axis** と **Strength** を調整します。
3. 範囲を限定するには **Field** を **infinite** から **linear**、**box**、**sphere**、**cylinder**、**noise** に変更し、**Field position**、**Field rotation**、**Field scale**、**Falloff** を調整します。
4. 曲げを滑らかにしたい場合は、400,000 三角形の上限内で **Subdivision** を上げます。

エフェクター自身のトランスフォームがローカル軸とフィールド基準を決めます。

### ビューポートでフィールドを編集する

1. 3D 編集カメラが有効な状態で、エフェクターを 1 つ選択します。
2. **Field position** の横にある **Edit field in viewport** をオンにします。
3. ドラッグでカメラ平面移動、中心周りを Shift ドラッグで回転、右または上へ Alt ドラッグで均等拡大縮小を行います。
4. Escape でドラッグキャンセルまたは編集終了になります (選択変更や編集カメラ終了でも解除)。

**linear**、**box**、**sphere**、**cylinder** フィールドにはガイドが表示されます (**infinite** と **noise** には境界ガイドなし)。ガイドは書き出しには写りません。

### Voronoi Fracture でメッシュを粉砕する

1. **Effector > Voronoi Fracture** を追加し、閉じたメッシュを子に入れます (高密度メッシュは元の 160,000 / 出力 1,600,000 三角形上限を確認してください)。
2. **Cells**、**Seed**、**Distribution** を設定し、断面を閉じるには **Inner faces** を **closed** にします。
3. **Distance**、**Scatter**、**Spin** をアニメーションさせて破片を飛ばすか、**Field > linear** で **Sweep** を動かします。
4. 3D Text の文字選択 (**Text+** が必要) では **Characters** に `1,3-5` のような 1 始まり範囲を入力し、必要に応じて **Invert selection** を使います。

### Plain と Delay で動きを遅らせる・弾ませる

1. **Effector > Plain** を追加し、その子に **Delay**、さらに **Delay** の子に対象オブジェクトを入れます。
2. **Plain** の **Position offset**、**Rotation offset**、**Scale offset** をアニメーションさせます。
3. **Delay** で **Mode** (**Blend** / **Average** / **Spring**) と **Strength**、**History frames** を設定します。
4. 強いバウンスを作るには、**Mode** を **Spring**、**Strength** を `100` にし、**Spring damping** を下げてオーバーシュートを大きく、**History frames** を上げて余韻を長く、**Spring cycles** を上げて反復回数を増やします。

## オブジェクト種類とプロパティリファレンス

| ピッカー名 | 用途 |
| --- | --- |
| **Repeater** | 一定の変換ステップで複製。 |
| **Linear Repeater** | 最初と最後の変換の間へ均等配置。 |
| **Random Repeater** | シード付きランダム範囲で複製。 |
| **Echo Repeater** | 過去のフレーム時刻の姿勢を複製。 |
| **Twist** | ローカル軸周りに子孫メッシュをねじる。 |
| **Warp** | エフェクター座標系で子孫メッシュを曲げる。 |
| **Voronoi Fracture** | シード付き Voronoi 破片へ剛体分割。 |
| **Plain** | 連結パーツ・文字・上流破片へフィールド重み付き変換を適用。 |
| **Delay** | 上流の動きを過去フレームサンプルで平滑化・バウンス化。 |

### Repeaters

**Count** の初期値は `5` (`1` ～ `128`) です。スケールの最小値は各軸 `0.001`、回転は度単位です。

| 種類 | コントロール | 意味と初期値 |
| --- | --- | --- |
| **Repeater** | **Position**, **Rotation**, **Scale** | 1 コピーごとの加算。Position `[10, 0, 0]`、Scale `[1, 1, 1]`。 |
| **Linear Repeater** | **Position**, **Rotation**, **Scale** | 最初のコピーに対する最後のコピーの相対変換。Position `[40, 0, 0]`、Rotation `[0, 0, 90]`。 |
| **Random Repeater** | **Min/Max position**, **Min/Max rotation**, **Min/Max scale**, **Seed** | シード付き範囲。**Seed** 初期値 `1`。 |
| **Echo Repeater** | **Offset** | コピー間の過去フレーム間隔 (`0` ～ `100000`、初期値 `5`)。 |

### Twist、Warp、Subdivision

- **Twist:** **Axis** (**X** / **Y** / **Z**、初期値 **Y**)、**Angle** (`-1440` ～ `1440` 度、初期値 `0`)、**Offset** (軸上の基準点)。
- **Warp:** **Axis** (**X** / **Z**、初期値 **X**)、**Strength** (`-720` ～ `720` 度、初期値 `0`)、**Offset** (曲げ基準点)。
- **Subdivision:** 辺の分割数 `1`、`2`、`4` (既定)、`8`、`16`。上限は 1 メッシュあたり `400,000` 三角形で、上限内に収まるよう整数段階ずつ下がります (元から上限超えのメッシュは簡略化しません)。

### Fields

**Twist**、**Warp**、**Voronoi Fracture**、**Plain** 共通のフィールド設定です。

| コントロール | 意味と初期値 |
| --- | --- |
| **Field** | **infinite** (既定)、**linear**、**box**、**sphere**、**cylinder** (Y 軸方向)、**noise**。 |
| **Field position** | エフェクター空間でのオフセット (初期値 `[0, 0, 0]`)。 |
| **Field rotation** | XYZ オイラー回転 (度、初期値 `[0, 0, 0]`)。 |
| **Field scale** | 変形前サイズに対する % (初期値 `[100, 100, 100]`、最小 `0.01`)。 |
| **Falloff** | 境界の遷移幅 (`0` ～ `100`、初期値 `100`、`0` で硬い境界)。 |
| **Falloff curve** | **linear** (既定)、**smooth**、**ease in**、**ease out**。 |
| **Invert field** | フィールド重みを反転 (初期値 **off**)。 |
| **Sweep** | Linear フィールドの進行度 (`0` ～ `100`)。 |
| **Noise scale** | フィールドスケールに対するノイズ波長 (`0.01` ～ `10000`、初期値 `100`)。 |
| **Noise evolution** | シード付きノイズの連続オフセット (初期値 `0`)。 |

### Voronoi Fracture

| コントロール | 意味と上限 |
| --- | --- |
| **Cells**, **Seed** | セル数 `1` ～ `1000` (初期値 `24`)。**Seed** 初期値 `1`。 |
| **Distribution**, **Cell scale** | **uniform** / **surface** / **center** / **edges**。**Cell scale** 初期値 `[100, 100, 100]`。 |
| **Inner faces** | **open** / **closed** (初期値 **closed**。元メッシュの開いた境界は閉じません)。 |
| **Fragment colors** | **material** / **random** (初期値 **random**、シード付き)。 |
| **Offset fragments** | 破片の隙間 (`0` ～ `100`、初期値 `0`)。 |
| **Distance**, **Scatter**, **Spin** | 破片の飛散・回転 (初期値 `0`、Distance / Scatter `-1000` ～ `1000`、Spin `-3600` ～ `3600` 度)。 |
| **Direction**, **Rotation**, **Fragment scale** | 追加移動 (`[0, 0, 0]`)、XYZ 回転 (`[0, 0, 0]` 度)、破片スケール % (`100`)。最大フィールド強度では **Randomness** に関係なく指定 % に達し、`0` で各破片が 1 点に収束します。 |
| **Gravity**, **Randomness** | Gravity はエフェクター `-Y` 方向への落下、**Randomness** (`0` ～ `100`) は破片ごとの動き減衰。どちらも初期値 `0`。 |
| **Characters**, **Invert selection** | `1,3-5` 形式の 1 始まり文字範囲 (**Text+** 必須。空白カウント・改行除外、空欄は全文字、不正な非空指定は 0 文字、**Invert selection** でも空欄は全文字のまま)。 |

- **上限と更新:** 入力 `160,000` 三角形、出力 `1,600,000` 三角形が上限で、超えると分割せずそのまま描画します。不透明破片は同深度で階層順に重なり、透過マテリアルは通常ソートを維持します。**Cells**、**Seed**、元形状の変更中は直前フレームを保持して **Fracturing...** を表示し、スクラブ・**Render once**・書き出しは正確な結果を待ちます。評価失敗時は未分割メッシュへフォールバックして警告を出します。

### Plain と Delay

**Plain** は **Position offset**、**Rotation offset** (度)、**Scale offset** (`0` で不変、`1` で 2 倍)、**Uniform scale** (いずれも初期値 `0`) を持ちます。

| Delay コントロール | 意味と初期値 |
| --- | --- |
| **Mode** | **Blend** (既定・指数重み)、**Average** (均等重み)、**Spring** (減衰振動)。 |
| **Strength** | フィルター結果とのブレンド (`0` ～ `100`、初期値 `75`)。 |
| **History frames** | 1 フレーム刻みの過去サンプル数 (`1` ～ `120`、初期値 `12`)。 |
| **Spring damping** | 減衰速度 (`0.25` ～ `12`、初期値 `3`、小さいほど大きくオーバーシュート)。**Spring** 専用。 |
| **Spring cycles** | **History frames** 内の振動回数 (`0.25` ～ `8`、初期値 `1`)。**Spring** 専用。 |

**Strength** `100`・**Spring cycles** `1`・**History frames** `48` でステップ入力に対するオーバーシュート目安: damping `3` で 29%、`2` で 58%、`1` で 154%、`0.5` で 352%、`0.25` で 751%。重みが打ち消し合う設定 (**History frames** が `1` または `2` かつ **Spring cycles** `1` など) では **Spring** は効果がありません。

入れ子の **Delay** は 1 メッシュあたり `96` サンプル (または最大 **History frames** の 4 倍の大きい方) の予算を共有し、破片トポロジが異なるサンプルはスキップされます。
Effector v42 より古いビルドは **Spring damping** と **Spring cycles** を無視し、**History frames** を 24 上限で評価します (そのビルドで保存すると 2 つの Spring 設定は失われます)。

### 旧 Effector+ プロジェクトの互換性

数値タイプ 7 / 8 / 9 で Twist・Warp・Voronoi Fracture を保存した旧 Effector+ プロジェクトを開く場合のみ、**Plugins** で **Effector+** を有効にしてください。ピッカー項目は増えず、内部的に **Effector** の実装へ引き継ぎます。
