# FPSOW / SURAVASA 参照分解と Kagariai 採用方針（2026-08-03）

## 結論

FPSOW の見た目は「高ポリゴンだから」ではなく、次の組み合わせで成立している。

1. 巨大ランドマークから小物までの明確な階層
2. 安価な共有メッシュを大量配置する反復設計
3. 1材質あたり複数の PBR 入力を使う面内情報
4. 暖色地区と寒色地区を分ける局所照明
5. 屋根・外周を密にし、経路と広場を読みやすく残す密度設計

したがって、Kagariai へはシーン全体を複製せず、**配置文法・材質文法・軽量な小物族を再構築して採用する**。直接コピーする候補は、権利記録と個別の性能・競技安全ゲートを通るまで candidate-only とする。

## 実測した参照シーン

- オブジェクト: 31,412
- メッシュ配置: 16,322
- ユニークメッシュ: 1,987
- ユニーク材質: 527
- 画像 datablock: 1,443
- コレクション: 805
- ユニークメッシュ三角形: 1,088,931
- 配置展開後三角形: 6,324,489
- 共有メッシュ利用: 15,673 / 16,322（96.0%）
- Action / driver / animated object: 0（静的マップ）

プレイ領域の実勢寸法は、外れ値を除いたメッシュ中心の 1–99 percentile で約 277.75 × 275.86 × 43.33 m。巨大な全体 bounding box は遠方の外れオブジェクトを含むため、設計寸法として使わない。

## マテリアル診断の補正

`AAA_MATERIAL_REALISM_PLAN_20260802.md` の「1,443画像 / 527材質 = 2.7」は、画像 datablock の単純比としては正しいが、材質グラフの複雑さを表す値ではない。ノードグラフを接続単位で再監査した結果は次の通り。

- 画像→シェーダ接続: 2,431（平均 4.61 / 材質）
- 典型的な材質: Color + packed PBR + Normal、必要に応じて AO / Alpha / Emission
- Color 接続: 488
- packed PBR 接続: 473
- Normal 接続: 466
- AO 接続: 313
- Alpha 接続: 123
- Emission 接続: 113
- 全 1,987 メッシュが UVMap1 を持つ
- 1,353 メッシュが UV 2層、31メッシュが UV 3層
- 全 1,987 メッシュが ColorMap1 / ColorMap2 の頂点カラー2層を持つ

Kagariai の最低到達点は、近景主要材質に対する `albedo + normal + packed ORM`。Three.js では同一 packed texture の R/G/B を AO/roughness/metalness 用として共有できる。emissive と alpha は必要な材質だけに限定する。

## 採用優先順位

### 再構築を優先

- 草房、低木、ヤシ葉、小草: 安価で反復効果が高い
- 装飾柱、細い装飾帯、屋根リブ: 建築の中間スケールを埋める
- 生垣: 見た目と当たり判定を必ず一体で設計する
- 木・岩: シルエットを参考にして低ポリゴンで再構築する
- 瓦礫、マスト、ストリングライト: 元形状をそのまま使わず軽量化して再構築する

### 条件付き候補

- 装飾バルコニー / 手すり: 低頻度の hero prop。権利台帳、デシメーション、再テクスチャ後のみ
- 箱・設備筐体: 対応する solid を持つ場合のみ。無衝突の偽遮蔽を作らない

### 当面移植しない

- armature に依存する断片的な静的リグ部品
- 大量の点光源・スポットライトの直接複製
- 参照側の OWM 専用ノードグループそのもの

## 実装ゲート

各アセット族は次をすべて満たしてから runtime-admitted とする。

1. provenance: 元データ、許諾文、改変内容、配布条件を記録
2. performance: 三角形、instance、draw call、texture memory を実測
3. competition: fake cover、登攀、射線、経路、spawn 視認性を検査
4. visual: 固定カメラで before/after を比較
5. regression: full suite、collision digest、品質スコアを確認
6. human: 競技・権利・アートの最終確認

## 実行順

1. 現在の IBL と手続きマップを実レンダーで検証する
2. 面積・出現数上位の5材質を `albedo + normal + roughness` 化する
3. 草・低木・柱・屋根リブの4族を Kagariai 固有デザインで再構築する
4. 暖色 / 寒色の地区照明を、少数の pooled light と emissive で設計する
5. 木・岩・瓦礫を silhouette family として複数化する
6. hero prop は最後に個別採用する

## 解析成果物

完全な分解報告、全31,412配置、ファミリ集計、材質グラフ監査、画像一覧、代表アセット24種のレンダー、採用判定表は次に保存した。

`C:\Users\rambo\Downloads\SURAVASA\outputs\fpsow-map-analysis-20260803`

主報告:

`FPSOW_OBJECT_DECOMPOSITION_AND_ADOPTION.md`

元の `MAP.blend` は保存・改変していない。検査は Blender 5.1.2 の background / factory-startup / autoexec-disabled で実施した。
