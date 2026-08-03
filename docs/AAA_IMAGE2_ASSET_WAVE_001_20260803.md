# Image生成 × img2threejs Asset Wave 001（2026-08-03）

## 状態

FPSOW / SURAVASA のオブジェクト分解から得た配置文法を使い、Kagariai固有デザインの参照画像を6点生成した。画像は既存ゲームアセットの複写ではなく、新規の設計資料である。

現時点では全点 `candidate-only`。画像が良いだけではruntime採用しない。img2threejs strict-quality、複数角度レンダー、性能、競技安全、権利、Human art reviewを通す必要がある。

生成経路: Codex内蔵の最新Image生成経路。各画像は別プロンプトで個別生成した。

保存先:

`work/img2threejs/fpsow-adoption-wave-001/references`

## 候補一覧

| 優先 | ID | ファイル | SHA-256 | 判定 |
|---:|---|---|---|---|
| 1 | roof-rib | `kagariai-roof-rib-reference-v1.png` | `526A593493B80B371F91115916432E7C93B89795E520FA44FF0FD347625B10C7` | 最初にimg2threejs化。反復効果が高く、部品分割が明確 |
| 2 | collision-rock | `kagariai-collision-rock-reference-v1.png` | `53899B7A1CA83FCE65A467D4BB9676D0919FAF44ECEE4823257366C17590DE09` | 見た目とコライダーを同時設計。fake-cover対策に直結 |
| 3 | salt-shrub | `kagariai-salt-shrub-reference-v1.png` | `624DBDD7E76D26FF206DC4BE4344E7935BCE3BAC509DC026FA51F832CE6CE45C` | 高さ0.62m以下・視線の隙間を守る植生族 |
| 4 | tide-pilaster | `kagariai-tide-pilaster-reference-v1.png` | `8FB92583E402208E0FD2C62BD4FD9B491711531E01094A48A2A229A9566FCFB2` | hero寄り。ランドマークの中間スケールを強化 |
| 5 | light-mast | `kagariai-light-mast-reference-v1.png` | `3199C519B26742078B2C1817D8E44A3ED5773A00630CA62CE6F3E74DB1FF0C84` | emissive主体＋pooled light 1個で採用する設計 |
| 6 | coastal-pine | `kagariai-coastal-pine-reference-v1.png` | `F577218FAC4558E626824F4150281E7E35A465FFA02ED3ADF53A092D6007FE39` | シルエットは強いが枝葉コスト大。最後に最適化 |

## 現在のimg2threejs証跡

`roof-rib` は intake から `material-pass` まで完了し、現在は `surface-pass` 待ち。runtime採用はまだ行っていない。

- 画像: 1536 × 1024、2,340,450 bytes
- technical suitability: pass
- admission: pass
- foreground coverage: 0.8058
- largest component fraction: 0.9993
- duplicate: none
- complexity: complex
- 16ゾーンのdetail inventory scaffold生成済み
- pre-spec: `work/img2threejs/fpsow-adoption-wave-001/roof-rib/pre-spec-assessment.json`
- strict-quality: PASS
- 完了pass: `blockout` / `structural-pass` / `form-refinement` / `material-pass`
- Tier-1 silhouette IoU: 0.8562（基準0.85）
- material color delta-E max: 15.87（基準20以下）
- browser: 4固定視点、例外0、console error 0
- runtime予算: 2,572 triangles / 5,000、8 draw calls / 8、16 textures
- collision: `none`、candidate-only、マップsolid未変更
- factory: `client/img2threejs/roof-rib/createKagariaiRoofRibModel.js`
- preview: `client/img2threejs/roof-rib/preview.html`
- spec / 全レビュー証跡: `work/img2threejs/fpsow-adoption-wave-001/roof-rib/roof-rib-sculpt-spec.json`

### material passで却下した2案

数値だけで採用せず、ブラウザ画像を見て次を却下した。

1. ceramic と copper に同一の混在cropを使った版。青瓦へ銅色が転写された。
2. 素材球全体をcropした版。球の輪郭とタイル端の白欠けが各インスタンスへ反復した。

最終版は素材球・クローズアップの**内部面のみ**を再cropし、1024px PBRを再抽出した。confidence は ceramic 0.778、copper / iron / brass も0.70以上。IBLとper-instance tintを加え、4素材を分離した。ただし参照より清潔で明るいため、surface passで局所汚れ・継ぎ目・緑青の配置を詰める。

## 実装順とゲート

### 1. roof-rib

- macro: tile shell / copper spine / end blocks / finial
- meso: repeated tile rows / rain channel / end joint / finial socket
- micro: ceramic crazing / edge chips / verdigris / seam dust / fasteners
- geometry target: 1,200–2,500 triangles per unique module
- runtime: tile rowはInstancedMesh、spineとend capは共有geometry
- collision: 非遮蔽の屋根装飾なので追加solidなし。登攀可能面との干渉だけ検査
- blocker: 正面・側面・3/4でタイル枚数とfinial位置が一致すること

### 2. collision-rock

- visible meshとsimple convex colliderを別データとして同じfactoryから返す
- undercut / cave / body-sized hollowを禁止
- top height 0.85mを基準とし、ジャンプ・登攀・射線を実測
- fake-cover cluster検査とroute auditを必須にする

### 3. salt-shrub

- 最大高さ0.62m、5 crown、crown間に透過隙間
- 葉はgeometry clumpまたはalpha cardの少数族をinstancing
- 複数株が近接した時も胴体帯のopaque occupancyが上限を超えないこと
- 風アニメーションを入れる場合はvertex shaderだけ。個別skeletonは禁止

### 4–6

- pilaster: hero propとして材質を優先し、反復数は抑える
- light-mast: bulbはemissive instance、実lightは代表1個または距離プール
- pine: trunk/primary boughをgeometry、needle massをLOD cardへ分離

## 生成プロンプト（再実行用）

### roof-rib

```text
Use case: stylized-concept
Asset type: AAA real-time FPS environment prop reference sheet for procedural Three.js reconstruction
Primary request: Design one original Kagariai modular roof-rib and finial unit for repeated placement on a coastal shrine roof, using FPS-friendly geometry and a strong silhouette, not copied from any existing game asset.
Scene/backdrop: clean neutral warm-gray studio background
Subject: one 2.4 m long roof ridge module with layered blue ceramic tiles, a low copper spine, one detachable spear-like finial, hidden modular end joints, rain channels and salt-wear
Style/medium: high-end AAA game prop concept render, physically plausible PBR, production reference sheet
Composition/framing: same single module shown in top orthographic, side orthographic, end view, and 3/4 perspective; include a small exploded inset showing tile shell, spine, and finial as three logical parts
Lighting/mood: neutral softbox studio lighting emphasizing normal and roughness response
Color palette: deep indigo glaze, pale ceramic edge wear, dark iron joints, oxidized copper, very restrained gold
Materials/textures: ceramic micro-crazing, chipped edges, rain streaks, verdigris, dust in seams
Constraints: isolated asset, repeated-placement friendly, clear pivots and attachment boundaries, no text, no logo, no watermark, no people
Avoid: oversized cathedral ornament, organic curves that cannot tile, excessive polygons, magenta background, existing game IP
```

### collision-rock

```text
Use case: stylized-concept
Asset type: AAA real-time FPS collision-matched environment prop reference sheet for procedural Three.js reconstruction
Primary request: Design one original Kagariai tide-worn rock cluster whose visible silhouette can be matched by a simple gameplay collider.
Scene/backdrop: clean neutral warm-gray studio background
Subject: a three-lobe basalt cluster 2.2 m wide, 1.5 m deep, 1.05 m tall; broad climb-readable top at 0.85 m, sloped sides, no undercuts, no hidden caves, a thin copper tide-marker plate embedded flush on one face
Style/medium: high-end AAA real-time prop concept render, physically plausible PBR
Composition/framing: same rock in front, side, top plan, and 3/4 views; include a translucent simple collider overlay inset matching the outer mass
Lighting/mood: neutral grazing studio light
Color palette: charcoal basalt, wet blue-gray lower band, pale salt crust, oxidized copper marker
Materials/textures: stratified fractures, rounded water erosion, cavity-darkened cracks, barnacle traces only as shallow relief
Constraints: collision-friendly convex mass, climbable intent readable, no body-sized visual hollow, no text, no logo, no watermark
Avoid: sharp fantasy crystal, cave opening, unsupported overhang, magenta background, existing game IP
```

### salt-shrub

```text
Use case: stylized-concept
Asset type: AAA real-time FPS environment vegetation prop reference sheet for procedural Three.js reconstruction
Primary request: Design one original Kagariai salt-marsh shrub cluster that enriches ground detail without ever becoming body-height fake cover.
Scene/backdrop: clean neutral warm-gray studio background
Subject: one irregular cluster 1.6 m wide, 1.0 m deep, maximum 0.62 m tall; five clearly separated plant crowns with visible gaps, exposed dark stems, sparse wind-bent leaves, a few pale seed heads
Style/medium: realistic stylized AAA game vegetation concept render, production reference sheet
Composition/framing: same cluster in front orthographic, side orthographic, top plan, and 3/4 perspective, consistent crown placement
Lighting/mood: neutral studio daylight
Color palette: muted blue-green, olive, straw, salt-gray stems, tiny restrained indigo flowers
Materials/textures: waxy leaf roughness variation, salt speckling, dry broken tips
Constraints: all opaque masses remain below 0.62 m, obvious sightline gaps through cluster, no ground shadow baked into albedo, no text, no logo, no watermark
Avoid: hedge wall, dense opaque cube, floating leaves, magenta background, existing game IP
```

残る3点の完全プロンプトは、生成画像と同じ意図を各assessmentの`sourcePrompt`へ転記する。新しい変種を生成する場合も、1画像1アセット・同一形状の複数角度・中立照明・IP非模倣を維持する。

## Claude / 次担当へのToDo

- [x] 6候補を生成し、プロジェクト内へ永続保存
- [x] SHA-256を記録
- [x] roof-ribのtechnical probe / admission / local spec search
- [x] roof-ribの16ゾーンdetail inventory scaffold
- [x] 16ゾーンを目視し、10件以上のdetailをcomponent/materialフィールドへ割り当てる
- [x] pre-specの`unassessed`を実観察値で埋める
- [x] `new_sculpt_spec.py`でspecを生成し、generic feature targetを固有項目へ置換
- [x] strict-qualityを通す
- [x] `forge/next.py <spec>`が示すpass順だけで実装
- [x] blockout / structural / form / material を各々レンダー比較
- [x] front / side / three-quarter / top の4固定視点を保存
- [x] surface pass: seam dirt、局所edge wear、blade patinaを追加し、grazing close-upを保存
- [x] lighting pass: neutral / grazing / reference-matched の3照明を比較
- [x] interaction pass: stable pivot、実socket親子、可逆detached-preview、破壊グループ、collision無効方針を検証
- [x] optimization pass: 2,572 tris / **5 DC** / 16 texturesを実測し、70瓦を1 drawへ統合、60 FPS目標と未承認LOD方針を記録
- [x] runtime admission候補: left / right / none の配置マトリクス、dispose lifecycle、実マップ12m/28m/45mを検証
- [x] candidate-only live-map reviewでperformance / fake-cover / 30 route / collision digest / full suiteを再監査
- [ ] Human art reviewと競技視認性の最終承認後だけproduction admissionを開く
- [x] Human review packetを `outputs/roof-rib-human-review-20260803/` に作成
- [ ] 直接コピーしたFPSOWバイトは混ぜず、許諾文と改変由来をprovenance台帳へ保存

## 2026-08-03 最終実測

| Gate | Result |
|---|---:|
| img2threejs build passes | **8 / 8 complete** |
| asset triangles | **2,572 / 5,000** |
| asset draw calls | **5 / 8**（瓦4 courseを1 batchへ統合） |
| PBR textures | **16 / 16** |
| browser evidence | **7 views / exceptions 0 / console errors 0** |
| automated tests | **894 / 894 green** |
| strict-quality | **PASS**（static actionProfile warningsのみ） |
| collision | **none** |
| authored collision digest | `66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29` |

主要証拠は`work/img2threejs/fpsow-adoption-wave-001/roof-rib/browser-blockout/report.json`、surface / lighting / interaction / optimizationの各`comparison-review-*.png`、および`roof-rib-sculpt-spec.json`内のpass別review履歴に保存した。

## Runtime admission ブラッシュアップ（2026-08-03）

`roof-rib` に left / right / none 構成テスト、所有権を区別する idempotent dispose、現行 `district-hip-roofs` に座標追従する3配置候補、fail-closed admission を追加した。実装・ゲート・Claude/Codex用継続プロンプトは `docs/AAA_ROOF_RIB_RUNTIME_ADMISSION_20260803.md` をSSOTとする。候補は引き続き runtime 未採用である。

その後、localhost＋`roofRibReview=1` の二重条件でだけ本番 `SceneRenderer` に候補を表示する
live-map reviewを追加した。12m/day、28m/dusk、45m/backlitを完全なproduction sceneで撮影し、
507,294–518,032 triangles / 90–98 DC、console error/warning 0を確認。factory原点由来の
7cmの浮きもadapterで解消し、3配置すべてのsupport clearanceを0mへ固定した。全894テスト、
fake-cover cluster、30/30 route、collision digest不変も再確認した。証拠SSOTは
`docs/evidence/AAA_ROOF_RIB_LIVE_REVIEW_EVIDENCE_20260803.json`。renderer技術ゲートだけはPASSへ進めたが、これはproduction採用ではなく、Human art reviewと
競技視認性の最終判断は引き続きPENDINGである。

## 正直な判定

このWaveで完成したのは**高品質な設計参照6点と、roof-rib候補のimg2threejs build pipeline 8/8**。各reviewは blockout 0.76、structural 0.78、form 0.80、material 0.79、surface 0.77、lighting 0.76、interaction 0.80、optimization 0.80。ブラウザ実測は2,572 tris / 5 asset DC / 16 textures、7視点、例外0、console error 0、collision noneである。

ただしこれはAAA完成判定ではない。実マップ配置、competitive fake-cover / route監査、dispose lifecycle、
12m/28m/45m描画監査までは完了したが、Human art reviewとHumanによる競技視認性判定は未完。
LODは`documented-not-runtime-admitted`であり、画像生成物とPBR抽出は形状・表面の根拠候補に留まる。
隠れた背面・正確寸法・最終採用可否を単独では保証しない。
