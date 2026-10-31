---
title: Text+ で文字をアニメーションさせる
sidebar:
  label: Text+
---
ネイティブの 2D Text は **Character** カテゴリで動かし、3D Text は Text+ の親オブジェクトで動かします。

## ネイティブの Text レイヤーを動かす

1. **Plugins** で **Text+** を有効にします。
2. **LAYERS** から **Text** を追加します。
3. Text レイヤーを選択します。
4. ネイティブのプロパティパネルで **Character** カテゴリを開きます。
5. **Mode** を選択します。オフセットには **Character Transform**、テキスト全体のブレンドには **Gradient Transform**、フェーズ駆動の振動には **Character Shake**、特定の文字には **Selected** の種類、シード付きのばらつきには **Random Scatter** を使います。
6. **Position**、**Scale**、または **Rotation** を設定します。
7. 文字間のアニメーションをオフセットするには、**Delay** を設定します。
8. **Delay order** を選択します。
9. 文字のプロパティにキーフレームを設定します。

特定の文字に影響を与えるには、**Selected Character Transform** を選択し、**Characters** に `1,4,5` などの 1 から始まる数値を入力します。スペースも文字の数に含みます。
テキストの先頭から末尾に向けて変形を変えるには、**Gradient Transform** を選択し、**First** と **Last** の各コントロールを設定します。
テキストを散らすには、**Random Scatter** を選択して **Amount** をアニメーションさせます。
いずれかの Shake モードを動かすには、**Phase** をアニメーションさせます。

ネイティブの Text では、Position と Scale に X と Y を使用します。Rotation はレイヤーの平面内で回転します。
ネイティブの **Text**、**Font**、**Size**、**Fill**、**Stroke** コントロールを使用します。

Assets に読み込んだフォントは、**Font** ピッカーの **Project fonts** にファミリー名順で表示されます。ピッカーは組み込みフォント、プロジェクトフォント、**custom...** の順に並べます。
テキスト全体を移動するには、**Character** より上にあるネイティブの **Position**、**Rotation**、**Scale** コントロールを編集します。

複数のアニメーションを組み合わせるには、**Character** > **Mode** を設定してから **Character 2** を使います。
**Character 2** は、最初の **Mode** が **None** 以外のときに **Character** の下に表示されます。**Character 3** も同じように表示されます。
後のカテゴリは、前のカテゴリが残した状態から文字をさらに動かします。たとえば、**Character** で文字を揺らし、**Character 2** で散乱させます。

文字のアニメーションを無効にするには、すべての **Mode** を **None** に設定します。
Text+ を使用せずにネイティブの Text を描画するには、**Plugins** で **Text+** を無効にします。
文字の設定を残すには、プロジェクトを保存します。
アニメーションを復元するには、**Text+** を再び有効にします。

レイヤーを Shape+ に変換する前に、すべての **Character** カテゴリで **Mode** を **None** に設定します。
変換した Shape+ レイヤーには編集可能なアウトラインがあり、Text+ の文字コントロールはありません。

## 親オブジェクトで 3D Text を動かす

1. 3D Scene の **Objects** パネルを開きます。
2. Text+ から **Character Transform** を追加します。
3. ネイティブの 3D Text オブジェクトを親オブジェクトの中に配置します。
4. 親オブジェクトの **Character** カテゴリを開きます。
5. Position、Scale、または Rotation を設定します。
6. 文字間のアニメーションをオフセットするには、**Delay** を設定します。
7. **Delay order** を選択します。
8. 文字のプロパティにキーフレームを設定します。

特定の文字に影響を与えるには、Selected Character Transform を使用し、**Characters** に `1,4,5` などの 1 から始まる数値を入力します。テキストを散らすには、Random Scatter を使って **Amount** をアニメーションさせます。Character Shake を動かすには、**Phase** をアニメーションさせます。

## 選択した 3D 文字にマテリアルを割り当てる

1. 3D Scene の **Objects** パネルで、Text+ から **Character Material** を追加します。
2. ネイティブの 3D Text オブジェクトを親の中に置きます。
3. **Character** の **Characters** に、`1,3,4` などの 1 から始まる番号を入力します。
4. すべての文字を対象にするには、**Characters** を空にします。
5. **Front material** を開き、change ボタンで両方のキャップのマテリアルを選択します。
6. **Side material** を開き、押し出しの側面とベベルのマテリアルを選択します。
7. 各マテリアルのネイティブプロパティを編集するか、キーフレームを設定します。

面に元の Text のマテリアルを使うには、そのスロットのマテリアルを削除します。
文字のマテリアルを入れ替えるには、内側に **Character Material** の親を追加します。
内側の親の **Characters** で対象の文字を選択し、2 つのマテリアルの選択を逆にします。
文字を選択している最も内側の親が両方のスロットを制御します。
内側の空のスロットは、元の Text のマテリアルを使います。

同じ Text にアニメーションを設定するには、マテリアルの親と Text+ のアニメーションの親を入れ子にします。
必要に応じて、他の種類のオブジェクトもグループに入れられます。Character Material が変更するのは 3D Text だけです。
Text+ なしでプロジェクトを開くと、元の Text のマテリアルで描画します。保存したスロットは保持します。

コントロールのリファレンス: [text-plus](/docs/ja/reference/text-plus/).
