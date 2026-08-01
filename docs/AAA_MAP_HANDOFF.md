# 大潮井 AAA品質マップ — 作業引き継ぎ

> **2026-07-29 最終統合改訂（この節が現行の正本）**
>
> 以下の古い節には統合前スナップショット（`1,060 solids`、`108 layers`、
> `14,753 instances`、Flashpoint runtime 未接続、route unsafe 1 等）が残っている。
> それらは作業履歴として残し、**現在値・現在の完了判定はこの節だけを参照すること。**

## 0.1 最終ローカル完了状態

### 実測値

| 指標 | 最終値 | 上限 / 判定 |
|---|---:|---:|
| 当たり判定ソリッド | **1,064** | 描画層による変更なし |
| presentation層 | **110** | 128 |
| 描画インスタンス | **17,725** | 24,000 |
| 最悪ドローコール（10視点） | **165** (`site-kado`) | 250 |
| 最悪三角形（10視点） | **506,314** (`site-kado`) | 1,200,000 |
| Flashpoint進入経路 | **30 / 30 safe** | unsafe 0、高所 unsafe 0 |
| 偽遮蔽クラスタ | **0** | 0 |
| ブラウザ地図契約 | **ready / 例外0 / console error 0** | 合格 |

### 企画開始から閉じた項目

- Flashpoint をサーバー既定モードとして有効化した。`World`、Bot、スナップショット、
  クライアント正規化、HUD、描画のすべてが5拠点の active / pending / resolved 契約を共有する。
  プロトコルは v6、`shared/data/mode_flashpoint.json` は `runtime_enabled`。
- 東西スポーン出口のデータ重複、`kado-west-shallows` の通行不能、Botの古い鏡像経路への
  フォールバックを修正した。実ランタイムの transition snapshot をクライアント正規化まで
  通すテストも追加した。
- 危険な「細い部品の束」を防ぐ cluster 検査を維持したまま、灯籠に実際の索・吊り紐を追加した。
  個別部品の0.8m制限だけに頼らない。
- 視覚面は、遠景に **dome 20** を導入、中央灯柱を copperPlaster の独立レイヤーに分離、
  広場の目地を basalt から cedar へ暖色化し、重複した金冠支柱を除去して23種の
  シルエットへ分散した。
- `tools/cdp_preview_audit.mjs` のナビゲーション直後に `documentElement` を読む競合も修正した。
  一時的な未生成DOMを監査例外として誤判定しない。

### 点数と境界

`tools/audit_map_quality_score.mjs` はソース定義だけでは満点を出さず、ブラウザ証跡JSONを
必須にするローカル品質スコアである。最終証跡は **100 / 100**（`complete-local-evidence`）。
これは「AAAを名乗る点数」ではない。競技契約、視覚階層、予算、ブラウザ契約が同時に揃った
ことの再現可能な確認値であり、人間の美術審査・実プレイ・デプロイ・本番マルチプレイヤーを
証明するものではない。

### 最終証跡

```powershell
$node = 'C:\Users\rambo\AppData\Local\OpenAI\Codex\runtimes\cua_node\f8d2abcb7481383b\bin\node.exe'

& $node --test tests/map_site_cladding.test.js tests/map_quality_score.test.js `
  tests/flashpoint_world.test.js tests/client_objective_presentation.test.js `
  tests/flashpoint_bot_route_adapter.test.js tests/server_protocol_version.test.js `
  tests/server_runtime_composition.test.js
& $node tools/generate_authored_map_collision.js --check
& $node tools/audit_route_safety.mjs
& $node tools/audit_fake_cover_clusters.mjs
& $node tools/audit_map_quality_score.mjs `
  --preview outputs/root-flashpoint-map-preview-final-20260729.json `
  --out outputs/root-flashpoint-quality-score-20260729.json
```

ブラウザと10視点性能の成果物:

- `outputs/root-flashpoint-map-preview-final-20260729.png`
- `outputs/root-flashpoint-map-preview-final-20260729.json`
- `outputs/root-perf-final-20260729/report.json`
- `outputs/root-flashpoint-quality-score-20260729.json`

### 次フェーズ: AAA Audio Factory

- ElevenLabs を使う大量音声生成の設計、100件単位のバッチToDo、権利・秘密・予算の停止条件、
  設計用／承認後実行用プロンプトは
  `outputs/AAA_AUDIO_FACTORY_HANDOFF_20260729.md` を正本とする。
- この時点では `ELEVENLABS_API_KEY` を読まず、API呼び出し・課金・音声生成は行っていない。
  初回Smoke 3件も Human GO 後に限る。

### 引き継ぎ上の注意

- `solids` と presentation の分離、0.8m規則、cluster検査は緩めない。見た目を足す場合は
  まず `tests/map_site_cladding.test.js` を赤にしてから、競技ルールを変えずに実装で直す。
- 表現評価は **close（AAAではない）**。残る主観的な改善余地は、地上プレイ中の情報密度、
  近景の灯籠密度、遠景都市の材料差である。いずれも blocker ではなく、予算には余裕がある。
- Git作業ツリーには今回以前から未追跡・未コミットのファイルがある。取り込み時は一括 stage
  せず、変更ファイルをレビューして選択的に扱うこと。
- 全73 test-file 回帰のうち `asset_licenses`、`asset_manifest_builder`、
  `audio_quality_audit` の3件は、今回の地図作業より前から追跡済みで削除状態にある
  `assets-src/local-audio/manifest.json` と90個の raw WAV を読むため失敗する。復元・生成は
  ユーザー既存の削除を覆すので行っていない。地図／Flashpoint に関係する47件の回帰は全て緑。

最終更新: **2026-07-29（7モジュール総力戦の最終監査後）**
作業ツリー: **`C:/Users/rambo/projects/kagariai-props`**（rc.5の作業コピー）

この文書だけを読めば、次の担当が単独で再開できるように書いてある。
上から順に読むこと。§0（環境）→ §1（絶対規則）→ §2（実測値）→ §3（7モジュール構成）
→ §4（設計の中核ルール）→ §5（今回得た知見）→ §6（AAA判定の結果）→ §7（残課題）
→ §8（既知の赤）→ §9（元ツリーへの取り込み）。

---

## 0. 最初にやること

```bash
export PATH="/c/Users/rambo/AppData/Local/OpenAI/Codex/runtimes/cua_node/f8d2abcb7481383b/bin:$PATH"
cd /c/Users/rambo/projects/kagariai-props
```

`node` はPATH上のシムが壊れているので**必ずこの絶対パス**を使う。node v24.14.0 / three 0.166.1。

### 画面を撮る（品質判定は必ず画像で行う。説明で合格としない）

```bash
# 1) 静的サーバー（8899が空いていなければ既に動いている。EADDRINUSE は正常）
node -e "const http=require('http'),fs=require('fs'),p=require('path');const mt={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.glb':'model/gltf-binary','.wav':'audio/wav'};http.createServer((q,s)=>{let f=p.join(process.cwd(),decodeURIComponent(q.url.split('?')[0]));try{if(fs.statSync(f).isDirectory())f=p.join(f,'index.html');const b=fs.readFileSync(f);s.writeHead(200,{'Content-Type':mt[p.extname(f)]||'application/octet-stream'});s.end(b);}catch(e){s.writeHead(404);s.end('nf');}}).listen(8899,()=>console.log('static on 8899'));" &

# 2) ヘッドレスChrome（CDP）
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --remote-debugging-port=9333 \
  --use-angle=swiftshader --enable-unsafe-swiftshader --window-size=1280,800 about:blank &

# 3) 10視点を撮る
node tools/capture_map_views.mjs --url http://localhost:8899/client/map-preview.html \
  --outdir outputs/<name> --views aerial,network,objective,spawn,orbit,site-shiogama,site-mizuichi,site-kado,site-ami,site-kazami
```

視点ID: `aerial` `network`(5拠点全景) `objective` `spawn` `orbit` `site-shiogama` `site-mizuichi` `site-kado` `site-ami` `site-kazami`

`--outdir` は**絶対パスでも動く**（監査時にスクラッチパッドへ直接吐かせた実績あり）。

### 監査ツール一覧（すべて `tools/` にある。読み取り専用）

| ツール | 何を出すか |
|---|---|
| `audit_perf_views.mjs` | 全10視点の calls / triangles / instances / layers（**予算判定はこれ**） |
| `audit_route_safety.mjs` | 30本の進入経路のカプセル走破性、高所経路 |
| `audit_fake_cover_clusters.mjs` | 偽の遮蔽クラスタ（テストの下敷き） |
| `audit_depth.mjs` | 高さ帯ごとのインスタンス分布・材質比率（原則1） |
| `audit_ground_mix.mjs` | 目標からの距離帯ごとの床材分布（原則6） |
| `audit_palette.mjs --files a.png,b.png` | 画像の暖色/寒色/金の面積比（原則4） |
| `audit_site_identity.mjs` | 5拠点の語彙の重なり |
| `audit_prim_cost.mjs` / `audit_layer_cost.mjs` | primitive別の実三角形数 / 層別コスト |
| `audit_crop.mjs --file x.png --out y.png --rect x,y,w,h --scale 3` | 拡大切り出し（**接地の検証に必須**） |

`vendor/three.module.js` は静的サーバー用にコピー済み（本番は `server/index.js` が配信）。

---

## 1. 絶対規則（違反は即やり直し）

1. **`C:/Users/rambo/Documents/Codex/` を読み書きしない。** Codexが同時作業中の元ツリー。
2. **`C:/Users/rambo/Downloads/SURAVASA/` を開かない。** Overwatchのマップ抽出データ
   （CC BY-NC-ND表示だが原権利はBlizzard）。ジオメトリ・テクスチャの移植は禁止。
   参照してよいのは密度・構成・可読性という抽象的な設計原則のみ。
3. **実在文化のモチーフ（インド風・モロッコ風）を入れない。** 設計書が
   「実在のどの文化の複製でもない」と定めている。貝灰漆喰・潮・灯の架空文化で作る。
   → この規則の帰結として **`dome` は使用0**、`archGate`（尖頭アーチ）は窯口と閘門の**10個だけ**。
     曲面は `barrelRoof`（半円筒）と `archWall`（半円アーチ）で稼ぐ。
4. **`solids` の既存分（`canonical-*` と `flash-*`）を変更しない。** 追加は `ring-*` のみ可。
5. **`tests/map_site_cladding.test.js` の安全規則を緩めない。**
   このテストは実際に作図ミスを**6件**検出している。落ちたら実装を直す。テストを直さない。
6. **`rotation[0]`（ピッチ）を使わない。** スケールのYとZが入れ替わり、安全テストの
   計算（yawのみ考慮）をすり抜けて宿主の外へ出る。薄い box をそのまま置く。
7. 日本語で書く。

---

## 2. 現在の到達点（2026-07-29 最終監査の実測値）

### 当たり判定

| 指標 | 値 |
|---|---|
| ソリッド合計 | **1,060** |
| 内訳 | `canonical-*` 175 ＋ `flash-*` 192 ＋ `ring-*` 693 |
| タグ内訳 | stair 394 / cover 265 / rim 212 / wall 85 / spawnwall 66 / slab 19 / tower 18 / ground 1 |

`map_oshioi.js` は legacy(canonical) + flashpoint(flash) + ring の3ソースを合成する。
`tests/map_collision.test.js` がこの3ソース合計と一致することを強制している。

### 描画（`presentation.layers`）

| 指標 | 実測 | ソフト予算（テストが赤にする値） | ハード予算 |
|---|---|---|---|
| 層 | **108** | 120 | 128 |
| インスタンス | **14,753** | 22,000 | 24,000 |
| 三角形（見積） | 見積 620,000以下 | 620,000 | — |
| 三角形（実測・最悪視点 network） | **465,976** | — | 1,200,000 |
| ドローコール（実測・最悪視点 network） | **203** | — | 250 |
| ドローコール（最良視点 site-ami） | 130 | — | — |

primitive別インスタンス（合計14,753）:
`box 7609 / plane 3505 / dodecaLow 1779 / cylinder 805 / spire 462 / archWall 183 /
hipRoof 117 / barrelRoof 112 / sawRoof 58 / lattice 33 / colonnade 29 / sphere 28 /
terrace 23 / archGate 10 / dome 0 / chamferBox 0`

semantics別の層数: `clad-existing-solid` 87 / `outside-playable-bounds` 21。

### 全10視点の実測（1600x900、`audit_perf_views.mjs`）

| 視点 | calls | triangles |
|---|---|---|
| aerial | 150 | 464,384 |
| **network** | **203** | **465,976** |
| objective | 144 | 463,568 |
| spawn | 145 | 463,580 |
| orbit | 144 | 463,568 |
| site-shiogama | 161 | 464,724 |
| site-mizuichi | 158 | 464,312 |
| site-kado | 163 | 464,760 |
| site-ami | 130 | 453,980 |
| site-kazami | 153 | 462,732 |

> **注意**: 単一視点だけを見て「DC 132」などと報告してはいけない。
> ドローコールは視点で 130〜203 と 1.56倍ぶれる。**判定は必ず最悪視点（network）で行う。**

### 競技指標

| 指標 | 実測 | 要求 |
|---|---|---|
| 偽の遮蔽クラスタ | **0** | 0 |
| 進入経路（5拠点 × 東西 × 3レーン） | 30本 / unsafe **1** | ≤1（§8.2の既知分） |
| 高所経路 unsafe | **0** | 0 |
| 拠点あたり進入経路 | **6**（各側3） | ≥3 |
| 敵対スポーン出口対 49 のうち相互視認 | **2**（いずれも§8.3の同一点問題） | 0 |
| 遮蔽間隔 上段(z≥3.5) p50 / 帯内(6〜9m) | **6.73m / 54.8%**（n=354） | 6〜9m |
| 遮蔽間隔 下段(z<3.5) p50 / 帯内(5〜7m) | **7.00m / 37.9%**（n=29） | 5〜7m |
| 禁止寸法帯 3.0〜4.0m の中心間対 | 14 | — |

> 遮蔽間隔の測り方は2種類ある。上表は**ソリッド単位の最近傍距離**（tag が
> cover/wall/tower/slab、プレイ領域内）。反復2の記録にある「p50 7.00m / 帯内 64.6%」は
> **近接ソリッドを塊にまとめてから**測った値で、母集団が違う。**比較するときは方式を揃えること。**

### 配色（`audit_palette.mjs`、1600x900のPNG）

| 視点 | 暖色 | 寒色 | 金 | 中性 |
|---|---|---|---|---|
| network | 16.4% | 45.0% | 2.4% | 38.6% |
| objective | **54.6%** | 17.8% | 13.2% | 27.6% |
| orbit | 51.4% | 23.1% | 12.2% | 25.5% |
| spawn | 40.5% | 32.4% | 3.4% | 27.2% |
| site-kado | 50.5% | 17.5% | 4.7% | 32.1% |

`network` の寒色 45.0% は**その大半が空（0x9bcbd8）と海**。俯瞰カメラの画角に空が
45%前後入るためで、プレイ領域そのものは暖色が支配している（objective 54.6%）。

### 高さ帯の分布（`audit_depth.mjs`、床 z=4 基準の相対高さ）

プレイ領域内 11,085インスタンス:
`0-2m 5,095 / 2-6m 2,731 / 6-10m 1,525 / 10-14m 451 / 14-20m 269 / 20-28m 55 / 28m+ 若干`
→ 6〜14m帯 = 1,976（**17.8%**）。
プレイ領域外（遠景都市）3,668インスタンスが 0〜28m+ にほぼ均等に分布。

材質上位: basalt 18.9% / shellShade 14.4% / cedar 9.6% / windowGlow 9.2% / copper 8.7% /
shell 7.9% / foliageLight 5.3% / farAccent 4.7% ...（寒色系は indigoGlow 0.4% +
indigoWall 0.3% + roofBlue 0.3% + farIndigo 0.2% + indigoCloth 0.1% の**indigo系1本だけ**）

### 床（`audit_ground_mix.mjs`、5つの目標からの最短距離帯ごとの層別インスタンス数）

| 層 | 0-8m | 8-16 | 16-26 | 26-40 | 40-60 | 60+ | 面積 |
|---|---|---|---|---|---|---|---|
| ground-pave-bright | 90 | 121 | 75 | 57 | 82 | 10 | 2,898 |
| ground-pave-mid | 66 | 145 | 150 | 31 | 5 | 0 | 4,583 |
| ground-pave-outer | 11 | 41 | 114 | 115 | 32 | 1 | 7,326 |
| ground-pave-far | 0 | 0 | 31 | 82 | 146 | 36 | 11,303 |
| ground-lane-gold（動線ライン） | 92 | 232 | 79 | 0 | 0 | 0 | 981 |
| ground-figure-seam | 34 | 280 | 489 | 303 | 92 | 8 | 1,100 |
| ground-curb | 27 | 32 | 51 | 135 | 63 | 8 | 155 |
| ground-tide-canal | 0 | 0 | 12 | 2 | 0 | 0 | 232 |

明るい舗装の比率（bright / bright+mid+outer+far）: **53.9% → 39.4% → 20.3% → 20.0% → 30.9% → 21.3%**
0〜40m は単調に暗くなる（原則6の「目標へ近づくほど明るく」を満たす）が、
**40〜60m帯で 30.9% へ反転する**（リング街路の明るい舗装）。§7に残課題として記載。

### 植生

| 層 | primitive | 数 |
|---|---|---|
| veg-planter-rim | box | 189 |
| veg-shrub | box | 120 |
| veg-undergrowth-mat | plane | 151 |
| veg-trunk-inner | cylinder | 69 |
| veg-crown-inner | dodecaLow | 207 |
| veg-boundary-trunk | cylinder | 142 |
| veg-boundary-crown | dodecaLow | 426 |

**プレイ空間の樹木 69本 : 境界の樹木 142本 = 1 : 2.06**（原則5「プレイ空間に疎、境界に密」）。
プレイ空間の69本は `ring-tree-*`（2.2 x 2.2 x 5.6〜8.1m, tag:'cover'）として
**当たり判定を持つ**。したがって太らせても偽の遮蔽にならない。

---

## 3. 7モジュール構成（今回の企画の成果物）

7人が同時に走るため**ファイル所有権**を切った。所有者以外は読むだけ。
統合は `map_oshioi_presentation.js` が5つの `*_LAYERS` を spread するだけの機械的な結合。

| 担当 | 所有ファイル | 役割 | 層 | インスタンス | 三角形 |
|---|---|---|---|---|---|
| **R 描画基盤** | `client/render.js`、`shared/data/map_oshioi_presentation.js` | 原始形状17種・材質・遠景都市・統合 | 19（自前分） | 3,100 | — |
| **K 当たり判定** | `shared/data/map_oshioi_ring_geometry.js` | `ring-*` 693個の当たり判定（樹木69本を含む） | 0 | 0 | — |
| **B 建物被覆** | `shared/data/map_oshioi_site_cladding.js` | 5拠点＋リング倉庫の描画専用被覆 | **56** | **4,104** | 94,798 |
| **G 地面** | `shared/data/map_oshioi_ground.js` | 街路・広場・動線ライン・縁石・水路 | **8** | **3,380** | 9,920 |
| **V 植生** | `shared/data/map_oshioi_vegetation.js` | 樹木の見た目・植栽枡・下草・屋上緑化 | **7** | **1,304** | 35,238 |
| **L ランドマーク** | `shared/data/map_oshioi_landmarks.js` | 拠点ごとの中ランドマーク・道標・灯具 | **9** | **804** | 19,880 |
| **C 中央コア** | `shared/data/map_oshioi_core_cladding.js` | canonical-* への被覆（集会堂・回廊） | **9** | **2,061** | 57,056 |

被覆5モジュール計 **89層 / 11,653インスタンス**。presentation自前分 19層と合わせて **108層 / 14,753**。

### 新規モジュールの契約（この形を崩さないこと）

```js
export const <NAME>_LAYERS = [
  { id: 'xxx-yyy', primitive: 'box', material: 'shell',
    semantics: 'clad-existing-solid',   // プレイ領域内なら必ずこれ
    castShadow: true, receiveShadow: true, transforms: [...] },
];
export const <NAME>_INSTANCE_COUNT = <合計>;   // 実数と一致すること（監査で照合する）
```

`transforms` の要素は `{ position: [x,y,z], scale: [sx,sy,sz], rotation: [0,0,yaw] }`。
**ゲーム座標 Z-up**（`client/render.js:245` で `world.rotation.x = -Math.PI/2` が既に掛かっている）。

### import の順序（循環に注意）

```
map_oshioi.js  →  map_oshioi_presentation.js  →  site_cladding / ground / vegetation / landmarks / core_cladding
map_oshioi.js  →  map_oshioi_ring_geometry.js
```

**新規モジュールから `map_oshioi.js` を import してはいけない。**
`map_oshioi_flashpoint_geometry.js` と `map_oshioi_ring_geometry.js` は import してよい。

この制約のせいで `core_cladding.js` は canonical-* の座標を
**`map_oshioi.js` の構築コードから写して再現している**（同ファイル冒頭のコメント参照）。
値がずれれば containment テストが即座に落ちるので、黙って嘘にはならない設計。
`site_cladding.js` も同じ方針で `SHIOGAMA_HOSTS` / `CORE_HOSTS_HALF` を書き下している。

### 所有関係の衝突点（3モジュールが同じ宿主に載っている）

`canonical-130` / `canonical-131`（南北の櫓、6x6x4m の箱ひとつ）に
**32層・146インスタンス**が site_cladding（大窯）・core_cladding（集会堂）・
landmarks（大煙突）の**3モジュールから**載っている。安全テストは通るが、
意味の重複がある。次に触るときはここを整理する（§7）。

---

## 4. 設計の中核ルール（壊さないこと）

### 被覆（cladding）の安全規則

`semantics: 'clad-existing-solid'` の層は、`tests/map_site_cladding.test.js` が次を強制する。

| 定数 | 値 | 意味 |
|---|---|---|
| `XY_TOLERANCE_M` | 0.35 | 宿主 footprint からの張り出し許容（装飾の縁取り分） |
| `THIN_VERTICAL_M` | 0.8 | 宿主上端より高く伸びてよい XY の上限 |
| `CLUSTER_GAP_M` | 1.0 | これ以下の隙間なら1つの塊として読む |
| `BODY_BAND_M` | 2.2 | 立っている人の胴体〜視線の帯 |
| `CLUSTER_FILL` | 0.40 | 開放トラス（柱だけ）と詰まった塊を分ける占有率 |

1. すべての被覆は**宿主ソリッドのXY footprint内**（許容0.35m）
2. 宿主上端より高く伸びてよいのは**XY 0.8m以下の細い垂直要素**のみ（煙突・帆柱・風見）
3. **近接インスタンスを束ねた塊**も同じ 0.8m 制限を受ける
   （床から段差1.1136m・水平3.5mで登れる天面の胴体帯 2.2m に入る部分だけを集め、
   隙間1.0mで束ね、最小辺 > 0.8m かつ占有率 ≥ 0.40 なら失格）
4. `solids` は legacy + flashpoint + ring の3ソースの合計に一致

**個別モジュールはテストより厳しく締めるのが正しい。**
`core_cladding.js` は自前 guard で `OUT_LIMIT = 0.30` にして、テストの 0.35 に
0.05m の余裕を残している。

### 座標系（間違えるとマップが横倒しになる）

`client/render.js:245` で既に `this.world.rotation.x = -Math.PI/2`。
world の中では**ゲーム座標 Z-up をそのまま書く**。
`rotation.x = +Math.PI/2` はY軸方向に生える単体プリミティブにのみ適用（ヒーローモデルの規約）。
**建築グループ全体に掛けてはいけない。**

### 移動定数から来る寸法（`shared/data/combat.json`）

ジャンプ到達 **1.1136m** ／ 最大水平飛距離 **3.50m** ／ 階段1段 **0.55m以下** ／
半身遮蔽 **1.20〜1.30m**（屈めば安全・立てば撃てる・登れない）／ 全身遮蔽 **2.20m以上** ／
**禁止寸法帯 1.05〜1.20m と 3.0〜4.0m**（登れるか飛べるか判別できない事故寸法）

### render.js の原始形状（全17種）と実三角形コスト

`audit_prim_cost.mjs` の実測（**PROJECT.md §4 の見積表とは値が違う。こちらが実測**）:

| primitive | 三角形 | primitive | 三角形 |
|---|---|---|---|
| `plane` | 2 | `spire` | 24 |
| `sawRoof` | 8 | `dodecaLow` | 36 |
| **`box`** | **12** | `cylinder` | 40 |
| `hipRoof` | 16 | `terrace` | 48 |
| `archGate` | 68 | `sphere` | 140 |
| `dodeca` | 144 | `dome` | 240 |
| `archWall` | 218 | `lattice` | 284 |
| `colonnade` | 320 | `barrelRoof` | 50 |
| **`chamferBox`** | **620** | | |

`archWall`（半円アーチ開口）`archGate`（尖頭アーチ）`lattice`（4×4格子）
`colonnade`（1ジオメトリに柱5本）`dome`（半球）`spire`（尖塔）`terrace`（テーパー台）
は `THREE.Shape` の穴として実装＝**本物の開口**。板の模様ではない。

---

## 5. 今回の企画で得た知見（次の担当が同じ轍を踏まないために）

### 5.1 「宿主からのはみ出し」は例外にせず、宿主 footprint へ切り詰める

`core_cladding` を書いたとき、宿主からはみ出す部品 **56件**で `throw` していたため
**ビルドごと落ちていた**。canonical-* には厚さ0.4mの薄い外周壁も含まれ、
厚い壁向けの寸法をそのまま載せると必ずはみ出す。

→ `emit()` の中で宿主の `[min-0.30, max+0.30]` へ **XYを切り詰める**方式に変更。
切り詰めた結果 0.05m 未満につぶれる部品だけを落とす。
これで安全規則（宿主 XY footprint 内）を満たしたまま部品を残せる。
実装は `shared/data/map_oshioi_core_cladding.js:194-217`。

**教訓**: 手で書いた寸法と宿主の実寸は必ずずれる。**ずれたら落とすのではなく、
宿主に合わせて削る。** 例外にすると全体が止まり、緩めると安全規則が壊れる。

### 5.2 「XY 0.8m以下」は**回転後のXY AABB**に対する制限である

`landmarks` の道標の腕木は**生スケール 0.78m** だったが、yaw が付くと
実効幅が `|cos θ|·sx + |sin θ|·sy = 0.81m` に膨らみ、安全テストが落ちた。

→ `span()` に**回転考慮の頭打ち**を入れた。元から細い部材（最大辺 0.8m 以下）に限り、
回転後の実効幅 `worst` が 0.8m を超えたら `k = 0.8 / worst` を掛けて縮める。
実装は `shared/data/map_oshioi_landmarks.js:39-53`。

**教訓**: 0.8m 制限を「スケールの上限」だと思ってはいけない。
テストは `|cos|·sx + |sin|·sy` を見ている。**yaw を付けるなら生スケールに余裕を持たせるか、
回転後に頭打ちする関数を通す。**

### 5.3 `chamferBox` は三角形予算を一撃で潰す

`chamferBox` は **620三角形/個**で `box`(12) の **52倍**。
係船環・木箱・階段側桁・上階を `box` へ置換して**約30万三角形を回収**し、
その分でインスタンス数を 2,745 → 14,753（5.4倍）に増やせた。
現在 `chamferBox` の使用は **0**。

**新しい部品は原則 `box`(12) と `plane`(2) で作る。**
`lattice`(284)/`colonnade`(320)/`archWall`(218)/`dome`(240) は要所だけ。

### 5.4 逼迫しているのは三角形ではなくドローコール

三角形は最悪視点で 465,976 / 1,200,000（**38.8%**）。まだ73万余っている。
ドローコールは最悪視点で 203 / 250（**81.2%**）。**1層＝1ドローコール。**

→ **層を増やすより、既存層に transforms を足す方が安い。**
新規モジュールは層数を絞り、1層あたりのインスタンス数を増やすこと。
実際、`ground` は 8層で 3,380インスタンス（1層あたり423）と効率がよく、
`site_cladding` は 56層で 4,104（1層あたり73）と層を食っている。

### 5.5 ドローコールは視点で1.56倍ぶれる

site-ami 130 ↔ network 203。**単一視点の数字を「実測値」として報告してはいけない。**
必ず `audit_perf_views.mjs` で全10視点を回し、**最悪視点で判定する**。

### 5.6 `rotation[0]`（ピッチ）は使わない

窓帯にピッチ回転を使うとスケールのYとZが入れ替わり、実XY範囲がずれる。
安全テストは yaw しか考慮しないので、ピッチを使うと検査をすり抜けて宿主の外へ出る。
薄い box をそのまま置けばよい。**現在7モジュールすべてで `rotation[0]` は 0。**

### 5.7 幅0.8mの制約下では植生は原理的に成立しない → 木そのものを当たり判定にする

0.8m 制限の帰結で、宿主の上に生やした樹冠は XY 0.61〜0.78m × 高さ 1.60〜3.68m の
**板**になってしまう。**原則5（植生は柔らかい遮蔽）は 0.8m の下では満たせない。**

→ `ring_geometry.js` に `ring-tree-*`（2.2 x 2.2 x 5.6〜8.1m, tag:'cover'）を69本追加し、
**木そのものを当たり判定にした**。幹 0.9m・樹冠 2.4〜2.8m をその footprint と
上端の内側だけに描くので、太らせても偽の遮蔽にならない。
既存ソリッド天端の樹木は全廃し、植栽枡・下草・屋上緑化の板（宿主上端 +0.05 以内）だけ残した。

### 5.8 安全テストが実際に検出した作図ミス（累計6件）

1. 船体 0.07m 突出
2. 風見の笠 0.10m 突出
3. 街路が床の縁からはみ出す（2件）
4. 窓帯のピッチ回転でスケールYZが入れ替わる
5. 祭儀灯柱の芯柱 0.74m 角×4本を 0.7m 間隔 → 束ねると 2.18 x 2.18m の偽の遮蔽
6. 灯籠櫓の煙道 0.76m 角×4本を 0.85m 間隔 → 2.46 x 2.46m の偽の遮蔽

5と6は**インスタンス単位の 0.8m 制限をすり抜けた**ので、
テストに「近接インスタンスを束ねた塊の検査」を追加した（規則を**強化**した。緩めていない）。

### 5.9 安全テストは「浮いているか」を見ていない

**今回いちばん重要な発見。** 安全テストは「宿主の footprint 内か」「宿主より高く伸びる部分が
細いか」しか見ない。**宿主の真上の空中に部品を置いても通る。**

実際、`clad-ring-lantern`（金の灯籠、dodecaLow、windowGlow材）**569個のうち565個**が
直下1m以内に支えが無く、直上1m以内にも吊り元が無い。
最寄りの帆柱（`clad-shell-trim` 0.34m角）から**水平に1.50m離れた空中**に浮いている。
`core-lantern` も168個中95個が同様。**合計約660個が宙に浮いている。**
`outputs/.../crop_lantern_objective.png` で肉眼で確認できる。

→ 次に追加すべきテスト: **接地/接続の検査**。
「宿主上端より上にある部品は、直下1m以内に他の部品の天端があるか、
直上1m以内に吊り元（索・腕木）があること」。実装案は §7 に書いた。

---

## 6. AAA品質の判定（2026-07-29 最終監査の結論）

参照画像から抽出した7原則＋競技不変条件。**画像と実測値を根拠にした判定。**
撮影画像: 10視点（`aerial network objective spawn orbit site-shiogama site-mizuichi
site-kado site-ami site-kazami`）＋拡大切り出し2枚。

| # | 原則 | 判定 | 根拠 |
|---|---|---|---|
| 1 | 奥行き4層 | **達成** | プレイ層11,085（0-2m 5,095 / 2-6m 2,731）、近景6-14m 1,976（17.8%）、遠景都市3,668が0-28m+に分布、遠景専用材質 farShell/farRoof/farAccent/farGlow で空気遠近。`network.png`・`spawn.png` で4層が明確に分離 |
| 2 | モジュールの3スケール反復 | **達成** | 108層中**50層**が層内に3段階（p10/p50/p90 が各1.6倍以上）のスケールを内包。最大 `clad-market-wall` で444倍。被覆天端 z は p10 4.0 / p50 5.4 / p90 12.7 / max 36.4m |
| 3 | 支配的な垂直ランドマーク | **達成** | 中央の大灯柱 BEACON_TIP = 36.4m が `orbit.png`・`spawn.png`・`objective.png` のいずれからも視認でき、シルエットで最も高い。5拠点それぞれに landmarks モジュールの中ランドマーク（804インスタンス / 9層） |
| 4 | 配色 | **達成** | objective 暖色54.6% / 寒色17.8% / 金13.2%。寒色系材質は indigo 系1本のみ（indigoGlow 0.4 + indigoWall 0.3 + roofBlue 0.3 + farIndigo 0.2 + indigoCloth 0.1 = 1.3%）。遠景は farShell 0xe6dcc6 / farAccent 0xa8a292 で明度を上げ彩度を落としている |
| 5 | 植生は柔らかい遮蔽 | **達成** | プレイ空間の樹木69本 : 境界142本 = 1 : 2.06。プレイ内69本は `ring-tree-*` として当たり判定を持つ（偽の遮蔽にならない）。`site-kado.png`・`site-kazami.png` の左端に境界の樹列が写っている |
| 6 | 床はパターンと動線ライン | **概ね達成（一部未達）** | 床材8種・面積28,577m²。`ground-lane-gold`（動線ライン）403本が目標から0-26mにのみ配置され、0-8m 92 / 8-16m 232 / 16-26m 79 と目標へ収束する。明るい舗装の比率は 53.9→39.4→20.3→20.0% と単調に減衰するが、**40-60m帯で30.9%へ反転する**（リング街路）。`aerial.png` で床の暗い筋の向きがばらつき、動線というより斑に見える箇所がある |
| 7 | 壁は直線、屋根と開口は曲線 | **達成** | 直線: box 7,609 + plane 3,505。曲面屋根: barrelRoof 112 + hipRoof 117 + sawRoof 58 = 287。曲線開口: archWall 183 + archGate 10 = 193。`dome` 0 は絶対規則3（実在文化の様式に読まれない）による意図的な判断 |

### 競技不変条件

| 条件 | 判定 | 根拠 |
|---|---|---|
| 拠点への進入は最低3経路 | **達成** | 5拠点 × 東西 × 3レーン = 30本。片側3本で要求を満たす |
| 裏道が罠になっていない | **概ね達成** | 30本中29本がカプセル走破可能。残る1本 `kado-west-shallows` は §8.2 の既知の赤（`flash-*` が原因で変更禁止） |
| 高所は取れるが居座れない（2方向以上の登り） | **達成** | 高所経路 unsafe **0**。`map_flashpoint_runtime.test.js` の「two stair-access high grounds」が緑 |
| 遮蔽間隔 6〜9m（下段5〜7m） | **未達** | 上段 p50 6.73m は帯内だが帯内率 54.8%。下段は n=29 と母数が薄く帯内率 37.9%。下段は §8.1 の理由で今回は着手していない |
| スポーン出口が相互に視認できない | **未達（データ起因）** | 敵対49対のうち47対は遮蔽されている。残る2対は east-forward-north と west-forward-north が**同一座標 [0,66,4] を出口として宣言している**ため（[0,-66,4] も同様）。ジオメトリではなくデータの問題。§8.3 |
| 偽の遮蔽ゼロ | **達成** | `audit_fake_cover_clusters.mjs` = 0、`map_site_cladding.test.js` の束ね検査が緑 |

### 総合判定: **AAAには未達（あと一歩）**

7原則は6.5/7、競技不変条件は4/6。予算にも余裕がある（DC 203/250、三角形 38.8%）。
**単一の決定的な欠陥は §5.9 の「約660個の金の灯籠が空中に浮いている」こと。**
これは実測（569個中565個が上下1m以内に支えなし）でも画像
（`crop_lantern_objective.png`）でも確認でき、`objective` 視点の金画素13.2%の
主要因なので、AAAレビューなら真っ先に指摘される。**最優先で直すこと。**

---

## 7. 残課題（優先度順）

### 7.1 【最優先】浮いている灯籠 約660個を接地させる

- `clad-ring-lantern` 569個（`site_cladding.js`）: 565個が完全に浮遊。
  最寄りの帆柱 `clad-shell-trim`（0.34m角）から水平1.50m離れている。
- `core-lantern` 168個（`core_cladding.js`）: 95個が完全に浮遊（73個は `core-string` に吊られている）。

直し方は3つ。**どれか1つを選べばよい。**
1. 灯籠を帆柱の真上（同一XY）へ寄せ、柱頭に載せる。最も安い。
2. `core-string` と同じ索の層をリング側にも作り、灯籠を索の下に吊る。層+1、インスタンス+数百。
3. 帆柱から水平の腕木（box、XY 0.8m以下）を出し、その先端の真下に吊る。層+1。

**同時に `tests/map_site_cladding.test.js` へ接地/接続テストを足すこと**（規則の強化）:
```
宿主上端 +0.05m より上にある被覆部品について、
  直下 1.0m 以内に他の被覆部品の天端 or ソリッド天端があること、または
  直上 1.0m 以内に他の被覆部品の底面があること
を要求する。どちらも無ければ「浮いている」として失格。
```

### 7.2 床の明度勾配が 40〜60m 帯で反転する

`ground-pave-bright` が 40-60m 帯に82個あり、明るい舗装の比率が 20.0% → 30.9% へ戻る。
リング街路を明るくしたためで、原則6の「目標へ近づくほど明るく」を局所的に壊している。
→ 40m以遠の `ground-pave-bright` を `ground-pave-mid`/`outer` へ振り替える。
`map_oshioi_ground.js` の所有者が行う作業。

### 7.3 拠点の識別性が弱い

`audit_site_identity.mjs`: 各拠点の固有語彙は **4.3〜6.9%**（shiogama 4.6 / kado 5.6 /
ami 4.3 / kazami 6.9）。残り95%は5拠点共通。テスト
「the five sites no longer share one identical vocabulary」は通るが、
「どこにいても現在地が分かる」には固有語彙が薄い。
→ 拠点ごとの固有装置（塩窯の窯口・浮棚市場の浮標・乾ドックの門扉・網橋運河の索・
造船所の船台）のインスタンス数を増やすか、拠点ごとに屋根材質の偏りを強める。

### 7.4 南北の櫓の三重被覆

`canonical-130` / `canonical-131`（6x6x4m の箱ひとつ）に **32層・146インスタンス**が
site_cladding（大窯）・core_cladding（集会堂）・landmarks（大煙突）の3モジュールから載っている。
南北で非対称にする（煙突を南だけに残す）案は、北櫓の煙道が偽の遮蔽の修正対象そのもので、
実測をやり直すことになるため今回は見送った。

### 7.5 下段（z<3.5、渚・浅瀬帯）の遮蔽間隔

母数 29個で帯内率 37.9%。**直せない理由**: 下段はすべて legacy コアの中央窪地
（|x|<48, |y|<36）にある。追加可能な `ring-*` は `insideCore()` でコアを丸ごと除外している。
除外を外すと legacy の authored ルート（`map_oshioi.js` 側）との離隔検証が必要だが、
`ring_geometry.js` から `map_oshioi.js` を import すると
`map_oshioi → presentation → site_cladding → ring_geometry` の循環になる。
**先にルートSSOTを独立モジュールへ切り出すこと。** それまでは着手しない。

### 7.6 その他（着手見送りの判断とその理由）

- **禁止寸法帯 3.0〜4.0m の対 14件**。飛べないが「飛べそう」に見える寸法。
  対の多くは同じ高台へ至る階段どうしで実害が小さい一方、`tryCover`/`buildOutwardStair` の
  再配置は ring geometry 全体を振り直す。**費用対効果で見送り。**
- **高コスト primitive の回収**。境界外80m以遠の `metropolis-roof-vents`(cylinder) などを
  box/dodecaLow へ落とせば回収できるが、三角形は 465,976/1,200,000（38.8%）で余っている。
  **回収先の当てが無い以上、見た目を劣化させるだけなので実施しない。**
- **`dome` は 0 のまま**。屋根の曲面を増やす指摘と「白漆喰の大質量＋金の円錐頂華＋
  尖頭アーチが実在文化の様式として読まれうる」という指摘は両立しない。
  **絶対規則3を優先**し、曲面は barrelRoof（半円筒）で稼ぐ。
- **祭儀灯柱の高さ**。`docs/phase1_design_v1.0_FROZEN.md:1236, 2135` は
  「マップ最高点+14m」と定めるが、実装は `BEACON_TIP = 36.4m`。
  マップが 92x68 → 252x184 へ拡張された結果としては妥当だが、FROZEN文書との差分が
  記録されていなかった。**ここに記録する**（設計書は凍結対象なので書き換えない）。
- **建物の高さ階層は4段**（小4.5-7m / 中8-11.5m / 大13-18m / ランドマーク19-27m）。
  5段に増やすとシルエットがさらに豊かになる。
- **予算残**: 三角形 734,024 / ドローコール 47 / 層 12（ソフト予算まで）。

---

## 8. 既知の赤（自分が壊したと誤認しないこと）

### 8.1 テストの現状（2026-07-29 最終監査）

| テストファイル | 結果 |
|---|---|
| `tests/map_site_cladding.test.js` | **5/5 緑** |
| `tests/map_collision.test.js` | **11/11 緑** |
| `tests/map_layer_budget.test.js` | **7/7 緑** |
| `tests/map_presentation.test.js` | **3/3 緑** |
| `tests/map_authoring.test.js` | **4/4 緑** |
| `tests/map_flashpoint.test.js` | **6/6 緑** |
| `tests/authored_map.test.js` | **4/4 緑** |
| `tests/collision_broadphase.test.js` | **22/22 緑** |
| `tests/map_flashpoint_runtime.test.js` | 3/4（**1赤 = 作業前から**） |
| `tests/flashpoint_world.test.js` | 0/3（**3赤 = 作業前から**） |

**今回の7モジュール企画で新たに赤くなったテストは 0 件。**

`node --test "tests/*.test.js"` は全体だと10分でも終わらない。**必ず対象を絞る。**

### 8.2 作業前から赤で、今も赤のもの

- `flashpoint_world.test.js` ×3（`activeSiteId` が undefined＝5拠点モードがランタイム未接続）。
- `map_flashpoint_runtime.test.js` の **`kado-west-shallows-runtime is unsafe at segment 2->3`**。
  実測した原因: 経路 `[-12,-64,4] → [20,-66,4]` が
  `flash-spawn-east-forward-south-side-east`（x[15.4,16], y[-78,-66]）と
  `flash-spawn-east-forward-south-face-4` の角から **0.250m** しか離れておらず、
  プレイヤー半径 0.40m に食い込む。
  **どちらも `flash-*`＝絶対規則4で変更禁止。** 経路データ側
  （flashpoint の `routesBySite.kado.west.shallows`）か flash-* のどちらかを直さないと解けない。
- **5拠点はランタイム未接続**: `shared/sim/sim.js` は flashpoint を1度も参照せず、
  `server/index.js` は `mode_shioura.json` を読む。data とテストだけの存在。
- 東西非対称: `kado/west` の3ルートは `kado/east` より最大34.5m不利。

### 8.3 今回新たに実測で見つけた、まだ直していないもの

- **敵対スポーンが同一の出口座標を宣言している。**
  `map_oshioi_flashpoint.js` の `spawnNetworks`:
  - `east.east-forward-north.exits[0] = [0, 66, 4]` と `west.west-forward-north.exits[0] = [0, 66, 4]`
  - `east.east-forward-south.exits[0] = [0, -66, 4]` と `west.west-forward-south.exits[0] = [0, -66, 4]`

  同一点なので「スポーン出口が相互に視認できない」という不変条件を定義上満たせない。
  ジオメトリを通した視線は残り47対すべて遮蔽されているので、**データの問題**。
  `map_oshioi_flashpoint.js` は7モジュールのいずれの所有でもないので今回は触っていない。
- **§5.9 の浮いている灯籠 約660個**（→ §7.1）。

---

## 9. 元ツリーへの取り込み

Codexが `C:/Users/rambo/Documents/Codex/.../kagariai-1.0.0-rc.4` で並行作業中。
**そのツリーは読み書き禁止**（絶対規則1）。取り込みはCodex側の担当が行う。

### 衝突しうるファイル（既存ファイルへの変更）

| ファイル | 変更内容 | 衝突時の解き方 |
|---|---|---|
| `client/render.js` | 原始形状7種追加（archWall/archGate/lattice/colonnade/dome/spire/terrace）、材質に farShell/farRoof/farAccent/farGlow/farGlowWarm/farGlowDim/foliage/foliageLight/lanternGold/indigo系 を追加、係船環の三角形78,000回収 | **追加のみ。既存の形状・材質は削っていない**ので、追加分を取り込めばよい |
| `shared/data/map_oshioi.js` | ring geometry を合成（`ring-*` 693個） | 合成の1行だけ。`canonical-*`/`flash-*` は無変更 |
| `tests/map_collision.test.js` | `ring-*` を第3ソースとして計上 | 期待値の更新のみ |
| `shared/data/map_oshioi_presentation.js` | 層予算 32→128・6400→24000、5被覆モジュールを spread で接続 | 新規扱いでよい（元ツリーでは未追跡） |

### 衝突しないファイル（すべて新規）

```
shared/data/map_oshioi_ring_geometry.js      当たり判定 ring-* 693個
shared/data/map_oshioi_site_cladding.js      被覆 56層 / 4,104
shared/data/map_oshioi_ground.js             床 8層 / 3,380
shared/data/map_oshioi_vegetation.js         植生 7層 / 1,304
shared/data/map_oshioi_landmarks.js          ランドマーク 9層 / 804
shared/data/map_oshioi_core_cladding.js      中央コア被覆 9層 / 2,061
tests/map_site_cladding.test.js              安全テスト（緩めない）
tests/map_layer_budget.test.js               層・インスタンス・三角形の予算テスト
tests/map_presentation.test.js
tools/capture_map_views.mjs                  10視点スクリーンショット
tools/audit_*.mjs                            監査ツール9本
client/map-preview.html / client/map-preview.js   レビュー用ビューア
vendor/three.module.js                       静的サーバー用
docs/AAA_MAP_HANDOFF.md                      本書
```

### 取り込み後の検証手順

```bash
node --test tests/map_site_cladding.test.js tests/map_collision.test.js \
  tests/map_layer_budget.test.js tests/map_presentation.test.js tests/map_authoring.test.js
# 全部緑になること。map_flashpoint_runtime の1赤と flashpoint_world の3赤は §8.2 の既知分。

node tools/audit_perf_views.mjs --outdir outputs/postmerge
# layers 108 / instances 14,753 / 最悪視点 network で calls 203・tris 465,976 になること。

node tools/capture_map_views.mjs --outdir outputs/postmerge --views aerial,network,objective,spawn,orbit,site-shiogama,site-mizuichi,site-kado,site-ami,site-kazami
# 10枚を目視。特に objective を拡大して灯籠の接地を確認する（§7.1が未対応なら浮いている）。
```
