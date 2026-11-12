# 別の時刻のレイヤーを読み取る

Shader+ の **Time sample** プロパティを使うと、現在の Custom Shader エフェクトに入る画像を別の時刻から読み取れます。

1. **Shader properties** を開き、**+** をクリックして **ZOIDIUM > Time sample** を選択します。
2. プロパティの名前を `Past` に変更します。
3. 1 フレーム前を読み取るには、オフセットを `-1` に設定します。
4. 秒を使う場合は、プロパティを右クリックして **Property settings…** を開き、**Offset units** で **Seconds** を選択します。同じパネルで、オフセットの行に **Minimum**、**Maximum**、**Step**、**Decimals**、**Snap** を設定できます。
5. シェーダーでプロパティをテクスチャとして宣言します。

```glsl
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D Past;
varying vec2 vUvScaled;
void main() {
	gl_FragColor = mix(texture2D(tDiffuse, vUvScaled),
		texture2D(Past, vUvScaled), 0.5);
}
```

オフセットをアニメーションさせるには、プロパティにキーフレームを追加します。Expressions+ でオフセットを制御するには、アニメーションボタンを Alt キーを押しながらクリックして式を入力します。再現可能な時刻のジャンプには、**Frames** 単位で `Math.floor(Math.sin(time * 12) * 3)` を使います。

2 枚の画像から始めるには、**New from template > Motion from two time samples** を選択し、**Add properties** をクリックします。`zTimeMotion` ヘルパーは明るさの変化から動きを推定します。正確なプロパティの動きが必要な場合は、プロパティの velocity を使います。時刻のジャンプから始めるには、**New from template > Time jitter** を選択し、**Add properties** をクリックします。このテンプレートには Expressions+ が必要です。

各エフェクトの Time sample プロパティは 4 個までにします。すべての入力テクスチャに `vUvScaled` を使います。`tDiffuse` と完全に同じ画像を読み取るには、オフセットを 0 にします。サンプルには前段のエフェクトが含まれます。現在のエフェクトと後段のエフェクトは含まれません。Adjustment レイヤーでは、出力時刻で有効な下位クリップを使います。この選択は Time Offset と同じです。Scene と Adjustment レイヤーはクリップ範囲外もサンプルできます。その他のレイヤーでは、最も近いクリップ端の画像を保持します。Pre-comp は既存の時刻マッピングに従います。

入力を準備できない場合は、準備完了後にフレームを再描画します。サンプルを取得できない場合は、エクスポートが停止します。オフセット、単位、キーフレーム、式を保持するには、プロジェクトを保存します。Shader+ v24 以降で開きます。古いビルドでは、新しい種類に対してシェーダーのコンパイルエラーが表示されます。
