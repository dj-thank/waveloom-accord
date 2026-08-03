# Kagariai Roof Rib — Runtime Admission 引き継ぎ

更新日: 2026-08-03  
対象: `prop-kagariai-roof-rib-01`  
現在の判定: **candidate-review-open / runtime 未採用**

## 結論

roof-rib は img2threejs の8工程、ブラウザ7視点、PBR 16枚、形状・描画予算、collision digest まで通過している。ただし、画像生成物の見た目が良いことと、競技マップへ安全に採用できることは別の判定である。

今回、採用準備として以下を追加した。

- `left` / `right` / `none` の finial 構成を自動検証
- factory-owned / borrowed を区別するリソース所有権
- 共有 geometry / material / texture を一度だけ解放する idempotent dispose
- 現行屋根データに追従する3配置の候補マトリクス
- Human・競技安全・renderer の3ゲートが揃うまで必ず停止する fail-closed admission

さらに、本番と同じ `SceneRenderer`・完全なproduction sceneで確認するため、**localhostかつ
`roofRibReview=1` の二重条件でだけ動くreview-only経路**を追加した。通常起動と外部ホストでは
PBR読込もscene object生成も行わない。production admissionレコードは変更しておらず、
`enabled:false / candidate-only / collision:none` のままである。

## 実装 SSOT

- factory: `client/img2threejs/roof-rib/createKagariaiRoofRibModel.js`
- admission candidate: `client/img2threejs/roof-rib/runtimeAdmissionCandidate.js`
- runtime adapter: `client/img2threejs/roof-rib/runtimeAdapter.js`
- local review gate: `client/img2threejs/roof-rib/reviewGate.js`
- tests: `tests/img2threejs_roof_rib_candidate.test.js`
- sculpt spec: `work/img2threejs/fpsow-adoption-wave-001/roof-rib/roof-rib-sculpt-spec.json`
- browser report: `work/img2threejs/fpsow-adoption-wave-001/roof-rib/browser-blockout/report.json`
- browser captures: `work/img2threejs/fpsow-adoption-wave-001/roof-rib/browser-blockout/`
- map review harness: `client/img2threejs/roof-rib/map-review.html`
- map review evidence: `work/roof-rib-map-review/report.json`
- live production-scene evidence: `work/roof-rib-live-review/report.json`
- pinned renderer evidence SSOT: `docs/evidence/AAA_ROOF_RIB_LIVE_REVIEW_EVIDENCE_20260803.json`

## 固定された契約

### 構成

| finial | 親 socket | 用途 |
|---|---|---|
| `left` | `socket_finial_left` | 左端アクセント |
| `right` | `socket_finial_right` | 右端アクセント。factory既定値 |
| `none` | なし | 連続配置の中央、反復感の緩和 |

全構成で `collision: none`。finial を外しても tile 70、spine 10、hardware 13 の batching 契約は変えない。

### リソース所有権

`createKagariaiRoofRibModel({ ownsPbrTextures: true })` のときだけ、dispose がPBRテクスチャも破棄する。既定値は borrowed であり、rendererやasset cacheが共有するテクスチャを壊さない。

```js
const model = createKagariaiRoofRibModel({
  THREE,
  pbrTextures,
  ownsPbrTextures: false,
  finial: 'right',
});

scene.add(model);

// geometry/material はfactory所有。borrowed textureは残す。
disposeKagariaiRoofRibModel(model);
```

dispose は2回目に `false` を返す。1回目の解放数は `root.userData.disposal` に残る。

### Support contact

実マップ再撮影で、factory最下端がローカルY `+0.07m` なのにadapterがroot原点をsupport天面へ
置いていたため、候補全体が7cm浮いていたことを発見した。adapterはmap Z-up変換後に
`verticalOffsetM: -0.07` を適用し、3配置すべてで描画AABB最下端と `supportTopZ` の差を
1µm未満へ固定した。これはpresentation transformだけで、collision solidは変更していない。

## 配置候補マトリクス

3件とも playable bounds `x[-126,126] / y[-92,92]` の外、visual bounds `x[-180,180] / y[-140,140]` の内側にある。現行 `district-hip-roofs` の transform index と天面高をテストで照合するため、屋根データだけ変わって配置台帳が古くなる状態はテストで落ちる。

| ID | position (map x,y,z) | finial | support |
|---|---:|---|---|
| `north-roof-rib-west` | `[-95.55, 103, 39.3]` | left | `district-hip-roofs[0]` |
| `north-roof-rib-mid` | `[-26.95, 103, 32.8]` | none | `district-hip-roofs[2]` |
| `north-roof-rib-east` | `[46.55, 103, 47.8]` | right | `district-hip-roofs[4]` |

これらは**提案座標**であり、production採用済みという意味ではない。明示的なlocalhostレビュー時だけ
同座標を `SceneRenderer.world` に表示する。3個を個別描画した最悪値は 7,716 triangles /
15 draw calls / texture 16枚共有で、実シーン3条件も予算内だった。

## Runtime adapter

`runtimeAdapter.js` は renderer統合直前の独立した公開境界である。現行のcandidateレコードを渡すと、scene objectを1個も生成する前にfail-closedで停止する。承認済みレコードに対してのみ次を行う。

- mapのZ-upとfactoryのY-upを `rotation.x = Math.PI / 2` で明示変換
- 3配置を固定support座標へ配置
- left / none / right finial構成を生成
- 全childを `collision:none` のまま保持
- 7,716 triangles / 15 draw calls / texture 16枚共有の最悪値をmetadataへ記録
- 一括dispose時に各childを一度だけ解放し、borrowed共有textureは保持

adapterは通常のstatic importには入れていない。`reviewGate.js` がlocalhost＋明示クエリを認めた場合だけ
`client/render.js` がdynamic importする。通常起動のブラウザ実測は
`roofRibReview=disabled:not-requested`、badgeなし、review body classなし、console error/warning 0だった。

admissionは最終3ゲートだけでなく、schema、asset ID、source SHA-256、collision policy、5つの技術証拠、placement transform、finial値、重複ID、固定competitive/visual envelopeを毎回再検証する。`enabled=true` だけを書き換える迂回はできない。

### 完了した統合境界

まず独立した **map review harness** を作り、その後に同じreview admissionを使う
localhost限定live-map reviewを追加した。production admissionは `runtimeRenderer:pass` を要求するため、
本番admissionを先に開ける循環は作っていない。

- URLまたはテスト専用フラグから明示起動し、通常ゲーム起動では絶対に動かない
- candidate badgeと `collision:none` を画面へ常時表示
- 本番admissionレコードを変更せず、review専用コピーを使う
- 現行map camera・lighting・fog・environmentを再利用
- 3配置、12m / 28m / 45m、昼・夕方・逆光を撮影
- harness結果だけで `runtimeRenderer:pass` にせず、telemetryとHuman判定を記録してから更新

上記のmap review harnessを実装済み。production game serverのCSPは緩めていない。

```powershell
cd C:\Users\rambo\projects\kagariai-props
C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m http.server 8792 --bind 127.0.0.1
```

```text
http://127.0.0.1:8792/client/img2threejs/roof-rib/map-review.html?site=west&distance=12&light=day
```

ブラウザ実測は `reviewReady:true`、canvas 1、console error 0、warning 0。DOMにも `candidateOnly:true / reviewOnly:true / productionEnabled:false / collision:none` を固定公開している。

| View | Frame triangles | Frame DC | 証拠 |
|---|---:|---:|---|
| west / 12m / day | 2,662 | 14 | `work/roof-rib-map-review/west-12m-day.png` |
| west / 28m / day | 5,106 | 17 | telemetry |
| west / 45m / day | 7,582 | 23 | telemetry |
| east / 45m / backlit | 2,618 | 10 | `work/roof-rib-map-review/east-45m-backlit.png` |
| overview / dusk | 5,010 | 18 | `work/roof-rib-map-review/overview-dusk.png` |

距離で数値が単調減少しないのは、遠距離ほどfrustumへ別の候補とsupport contextが入るため。asset-only最悪値は別契約の7,716 triangles / 15 DCである。

### 完全なproduction sceneでの実測

起動例:

```text
http://127.0.0.1:8793/?roofRibReview=1&roofRibSite=west&roofRibDistance=12&roofRibLighting=day
```

レビュー時だけカメラを監査条件と同じ40°へ固定する。通常ゲームの75°は変更しない。初回画像で
75°のため画面占有が不足していることを発見し、テストを先に赤にしてから40°と部品実中心
（support top + 0.42m）へ修正した。

| View | Frame triangles | Frame DC | 証拠 |
|---|---:|---:|---|
| west / 12m / day | 507,294 | 90 | `work/roof-rib-live-review-v2/west-12m-day-contact.jpg` |
| mid / 28m / dusk | 517,992 | 98 | `work/roof-rib-live-review-v2/mid-28m-dusk-contact.jpg` |
| east / 45m / backlit | 518,032 | 97 | `work/roof-rib-live-review-v2/east-45m-backlit-contact.jpg` |

全条件で上限 1,200,000 triangles / 250 DC 内、console error 0 / warning 0。
通常起動の非表示証拠、接地修正後3画像のSHA-256、894テスト、collision digestは
`docs/evidence/AAA_ROOF_RIB_LIVE_REVIEW_EVIDENCE_20260803.json` に固定した。report自体の
SHA-256は `3778DEA513E220BA1357FF2D600FE1C1A3F47B9931535F3ED8F3D1877199B1A5` で、
admission recordとテストが一致を強制する。

## Admission gate

| Gate | 現在 | 完了条件 |
|---|---|---|
| source provenance | PASS | SHA-256と生成経路が一致 |
| strict sculpt spec | PASS | strict-quality error 0 |
| browser look-dev | PASS | 7視点、exception 0、console error 0 |
| collision digest | PASS | authored solid digest不変 |
| disposal lifecycle | PASS | 重複解放なし、借用texture破棄なし |
| Human art review | **PENDING** | 下記4枚を人が見て採用可否を記録 |
| competitive safety | **AUTOMATED PASS / HUMAN PENDING** | cluster検査、30/30 routeはPASS。Human視認性判定を記録 |
| runtime renderer | **PASS** | production scene 3距離、support contact、dispose、予算、例外0をSHA固定 |

`assertKagariaiRoofRibRuntimeAdmission()` は現在必ず次で停止する。

```text
ROOF_RIB_RUNTIME_ADMISSION_BLOCKED:enabled,state,humanArt,competitiveSafety
```

## Human review 用4枚

1. `browser-blockout/three-quarter.png` — 主シルエットと反復タイル
2. `browser-blockout/grazing-closeup.png` — seam dirt、edge wear、verdigris
3. `browser-blockout/reference-matched.png` — 元参照との色・比率
4. `browser-blockout/detached-finial.png` — socketと取り外し状態

レビュー記録には `APPROVE` / `REVISE` / `REJECT` のいずれか、理由、確認者、日時を残す。AI自己評価はHuman承認の代替にしない。

自己完結したHuman review packetを
`outputs/roof-rib-human-review-20260803/` に作成済み。参照、接地修正前後、28m、45m、
SHA256SUMS、採点表、machine-readableなpending decision、Claude用プロンプトを含む。
初期 `review-decision.json` は `productionAdmissionAuthorized:false` であり、人の回答なしには変更しない。

## 次の担当者向け ToDo

- [x] left / right / none の配置構成テスト
- [x] idempotent dispose と共有リソース重複解放防止
- [x] borrowed textureの保護
- [x] 3配置を現行屋根transformへ照合
- [x] fail-closed admission module
- [x] 承認済みレコード専用runtime adapter
- [x] Y-up → map Z-up座標変換テスト
- [x] admission改ざん耐性（collision・digest・競技境界）
- [x] runtime group一括disposeとborrowed texture保護
- [x] production分離map review harness
- [x] 12m / 28m / 45m、day / dusk / backlitのブラウザ操作
- [x] browser console error 0 / warning 0
- [x] SHA-256付きスクリーンショット3枚とJSON report
- [x] 全体テスト 894 / 894 green
- [x] authored collision manifest check PASS、digest不変
- [ ] Human art reviewを記録
- [x] candidate状態のまま、独立したrenderer adapterをテスト先行で実装
- [x] `client/render.js` 側へlocalhost＋明示クエリの二重review gateを追加
- [x] productionとは分離したmap review harnessを作り、ゲート循環なしで実測する
- [x] 完全なproduction scene内で同じ3地点を再撮影
- [x] factory原点由来の7cm浮きを解消し、3配置のsupport contactをAABBで固定
- [x] renderer証拠をtracked JSONへ昇格し、report SHA改ざんをadmissionで拒否
- [x] Human art / competitive readability用の画像・採点表・decision template・Claude promptをpackaging
- [x] 3配置の実画面を昼・夕方・逆光で撮影
- [x] 12m / 28m / 45m で同一モデルの視認性、triangles、draw callsを測定
- [ ] runtime LODを将来採用する場合、その切替境界でpopを再検証
- [x] 統合後に `nearby cladding never bundles into body-height cover without collision` を再実行
- [x] 30/30 route、collision digest、full suiteを再実行
- [ ] Human + competitive + renderer が全PASS後のみ `state: runtime-admitted`, `enabled: true` へ変更
- [ ] 採用後も元画像、PBR抽出物、生成factoryのprovenanceを保持

## Claude / Codex 継続プロンプト

```text
Repository: C:\Users\rambo\projects\kagariai-props

Continue the Kagariai roof-rib runtime-admission task. Read these files first:
- docs/AAA_ROOF_RIB_RUNTIME_ADMISSION_20260803.md
- docs/AAA_IMAGE2_ASSET_WAVE_001_20260803.md
- client/img2threejs/roof-rib/createKagariaiRoofRibModel.js
- client/img2threejs/roof-rib/runtimeAdmissionCandidate.js
- client/img2threejs/roof-rib/runtimeAdapter.js
- tests/img2threejs_roof_rib_candidate.test.js
- work/img2threejs/fpsow-adoption-wave-001/roof-rib/browser-blockout/report.json

Rules:
1. Preserve candidate-only and fail closed. The live-map review path already exists, but it must continue to require localhost plus roofRibReview=1. Never set production enabled=true until Human art review and competitive safety are explicitly recorded.
2. Use TDD. First add a failing test at a public seam, then implement the smallest change.
3. Preserve collision:none. Do not add solids or infer collision from the visual mesh.
4. Keep the authored collision digest unchanged: 66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29.
5. Preserve unrelated worktree changes and do not touch outputs/aaa-material-fpsow-20260803/.
6. Use the bundled Node executable under C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe.
7. Preserve both existing review routes: the standalone harness and the localhost-only full SceneRenderer review. Never weaken CSP or permit external-host activation.
8. Read docs/evidence/AAA_ROOF_RIB_LIVE_REVIEW_EVIDENCE_20260803.json and the referenced v2 images before changing camera, placement, material, support fit, or scale. Preserve its SHA binding in runtimeAdmissionCandidate.js.
9. Automated integration evidence is complete: 894/894, renderer gate PASS, support clearance 0m, fake-cover cluster PASS, 30/30 routes, collision digest unchanged, browser exception/warning 0. The three distances currently render one model; if runtime LOD is introduced, test its pop boundary separately. Do not rerun blindly unless relevant bytes change.
10. Report exact evidence. Never call the asset AAA-complete from automated tests alone.

Current verified asset metrics before runtime integration:
- 2,572 triangles
- 5 asset draw calls
- 16 PBR textures
- 7 browser views
- exceptions 0 / console errors 0
- collision none
- Tier-1 IoU 0.8533

Deliverables:
- tested feature-flagged renderer adapter (still disabled until gates pass)
- integrated screenshots and runtime telemetry (already captured candidate-only)
- competitive safety evidence
- updated admission record and handoff
```

## やってはいけないこと

- `enabled:true` だけ先に変える
- visual meshをそのままcollisionへ流す
- 3個配置の合計を1個分の予算として報告する
- borrowed textureをdisposeする
- candidate画像をHuman承認済みと表現する
- 既存のpresentation層やsolidsを置換してdigestを変える
