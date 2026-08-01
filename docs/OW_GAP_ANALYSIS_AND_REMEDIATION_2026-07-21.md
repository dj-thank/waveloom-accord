# Kagariai rc.5 — Overwatch 公開一次情報ベースのギャップ分析と是正計画

- 作成日: 2026-07-21（JST）
- 対象: `Kagariai 1.0.0-rc.4` から rc.5 へ進む現在の作業ツリー
- 比較入力: [`OW_BENCHMARK_GAMEPLAY_2026-07-21.md`](research/OW_BENCHMARK_GAMEPLAY_2026-07-21.md)、[`OW_BENCHMARK_OPERATIONS_2026-07-21.md`](research/OW_BENCHMARK_OPERATIONS_2026-07-21.md)、[`OW_BENCHMARK_PRESENTATION_2026-07-21.md`](research/OW_BENCHMARK_PRESENTATION_2026-07-21.md)
- 現状入力: [`PRODUCTION_CANDIDATE_REPORT.md`](PRODUCTION_CANDIDATE_REPORT.md)、[`BOT_NAVIGATION_QA.md`](BOT_NAVIGATION_QA.md)、[`AUDIO_LISTENING_QA.md`](AUDIO_LISTENING_QA.md)、[`ASSET_SSOT.md`](ASSET_SSOT.md)、[`RC5_ASSET_CANDIDATE_REPORT.md`](RC5_ASSET_CANDIDATE_REPORT.md) および本文中に示すコード・証跡

## 結論

Kagariai は、固定 5v5 の **篝手1・焔手2・灯手2**、共通 swept-cylinder 衝突、BOT の環境死監査、18ヒーロー/72アビリティ/90音声のアセット SSOT、必殺技のローカル頻度監視まで到達している。これらは明確な前進であり、以下の証拠範囲では「済」と判定できる。

一方、現状を Overwatch と同等、AAA、商用ライブサービス、または世界公開済みとは判定できない。主な差は、(1) 前線・役割・高低差・遮蔽が人間の対戦で実際に戦術差を生むか、(2) 敵味方アビリティ、空間音、VFX、シルエット、HUD が負荷下でも読めるか、(3) 初見プレイヤーを訓練できるか、(4) 永続ID、再接続、マッチメイク、通報、アンチチート、リプレイ、アクセシビリティ、プライバシー、ライブ運用を公開環境で成立させられるか、である。

本書の数値受入基準は、3研究文書が Blizzard 一次情報から Kagariai 用に導いた**検証用の設計推論**であり、Blizzard の内部SLOや Overwatch の合格値ではない。未測定は Fail ではなく「未検証」である。合格しても Overwatch 同等性は証明しない。

## 判定規則

### 深刻度

| 深刻度 | 本書での意味 |
|---|---|
| P0 | 世界公開、競技結果、安全、プライバシー、権利、復旧を止める。回帰時に公開を即停止する既実装契約も含む |
| P1 | 公開前に解消すべき中核ゲームプレイ、可読性、アクセシビリティ、人間QAの欠落 |
| P2 | 深さ、選択幅、分析、運用効率、規模拡大に必要だが、限定クローズド試験は明示的制約付きで可能 |
| P3 | ポリッシュまたは後続改善。欠落を隠して同等性を称してはならない |

### 状態

| 状態 | 判定 |
|---|---|
| 済 | 記載した受入基準と同じ範囲の実装・証拠がある。より広い品質は別行で評価する |
| 進行中 | 基礎実装はあるが、受入基準の一部または同一ビルド証拠がない |
| 未着手 | 調査範囲で実装・試験証拠を確認できない |
| 外部ゲート | 人間、実端末、権利者、公開ホスト、実回線、地域、運用組織など外部条件が必要 |

## 現在直っていることの証拠スナップショット

| 項目 | 現在の証拠 | 判定境界 |
|---|---|---|
| 役割 1/2/2 | サーバーが各チームの篝手1・焔手2・灯手2を強制し、`role_full` と `role_change_locked` を返す。[`PRODUCTION_READINESS_SPEC.md`](PRODUCTION_READINESS_SPEC.md)、[`server/PROTOCOL.md`](../server/PROTOCOL.md) | 編成枠の整合性は済。各役割が人間対戦で固有の勝ち筋を持つことは未測定 |
| BOTナビゲーション・環境死 | schema v2 accepted JSON 3本は各180秒・10 BOTなので合計 **5,400 BOT秒**（active round 3,949.36 BOT秒）。Falls 0、Violations 0、環境/void死 0/64、recovery 800開始＝797完了＋2 round/death中断＋1進行中、通常の最大無活動6.84秒、別指標の最大戦術的無活動23.65秒。全18ヒーローを正確な1/2/2で網羅。[`BOT_NAVIGATION_QA.md`](BOT_NAVIGATION_QA.md)、[`outputs/rc5-bot-evidence`](../outputs/rc5-bot-evidence/README.md) | 指定seed・現行mapの決定論的ローカル証拠であり、全seed、人間級計画、公開回線、10人対人の証明ではない |
| 衝突・高低差・遮蔽 | canonical collider 147 と presentation solid 147を同じblueprintから生成。目標床 z=2.5、市場 z=4、櫓 z=8、全身/半身cover、下段rock、`killZ=-12` がある。[`map_oshioi.js`](../shared/data/map_oshioi.js)、[`PRODUCTION_CANDIDATE_REPORT.md`](PRODUCTION_CANDIDATE_REPORT.md) | 形状と当たり判定の存在は済。50試合の経路率、遮蔽価値、人間の読みやすさは未測定 |
| AIの役割行動 | 前衛は味方・支援を見てcontest/撤退、焔手は限定crossfire、灯手は負傷優先・前衛後方へ退避。複数階層ground A*、到達候補検証、capsule clearance、swept shortcut、ledge brake、階段の移動所有権、戦闘中detourに加え、3秒の最終目撃位置、2.5秒のteam focus、安全な遮蔽物迂回を使用。非可視対象を追尾射撃しない。[`BOT_NAVIGATION_QA.md`](BOT_NAVIGATION_QA.md) | 説明可能なゲームAIとして済。学習AI、難易度段階、人間同等の読み合いではない |
| アセットSSOT | 18ヒーロー、18武器、72アビリティ、WebP 90/90、WAV 90/90、90固有音声hash、`complete=true`、`missingAudio=[]`、`contentSha256=6085...c92`。[`ASSET_SSOT.md`](ASSET_SSOT.md) | 同一性・完全性・ブラウザ照合は済。美術品質、戦闘可読性、聴感品質、権利の最終承認は別 |
| 必殺技頻度 | 最終候補3試合・30 player-matchで103回、平均3.433、中央値3.5、最小1、最大5、0回率0%。内部gateは平均2.0–4.5、中央値2–5、0回率15%以下、最大8以下。[`RC5_ASSET_CANDIDATE_REPORT.md`](RC5_ASSET_CANDIDATE_REPORT.md) | ローカルBOT分布は済。「1試合約3回」はKagariai内部目標であり Overwatch の公式値ではない。人間戦術上の妥当性は未測定 |
| 音声機械検査 | 90件すべてのPCM形式、hash、peak/RMS、fade等を検査し、代表WAVをChrome AudioContextでdecode。[`AUDIO_LISTENING_QA.md`](AUDIO_LISTENING_QA.md)、[`RC5_ASSET_CANDIDATE_REPORT.md`](RC5_ASSET_CANDIDATE_REPORT.md) | **NOT HUMAN-VERIFIED**。音量、疲労、定位、敵味方・役割識別は未承認 |
| ローカル候補 | 最終ツリーでNode全回帰471/471、BOT・物理・map集中回帰100/100、Python 8/8、map hash一致、音声90/90、headless 3試合、release 10接続、local TLS/WSS損失行列、Docker rootfs scanを再実行。[`RC5_ASSET_CANDIDATE_REPORT.md`](RC5_ASSET_CANDIDATE_REPORT.md)、[`outputs/rc5-bot-evidence`](../outputs/rc5-bot-evidence/README.md) | 公開DNS/実証明書、長時間soak、実端末、10人実プレイではない |
| 最終ブラウザ目視 | 現行ツリー専用のローカルserverへ接続し、Asagiで試合参加、能力発動、CT遷移、必殺ゲージ、役割責務、推奨行動、味方HP、目標状態をDOMと画面で確認。console warning/error 0。[`gameplay-live-final.png`](../outputs/rc5-bot-evidence/screenshots/gameplay-live-final.png) | 箱型blockout、大面積で低密度な壁面、専用3D character/animation不足、下部HUDの大きな占有を実画面でも確認。機能動作の証拠であり、OW級world art/HUD可読性の合格証拠ではない |

## 一次情報URL索引

表中の `G-*`、`P-*`、`O-*` は次の Blizzard / Overwatch 公式一次情報を指す。アクセス確認日は元研究文書の記録どおり 2026-07-21。URLが同じ項目も、研究上の用途が異なる場合は別IDを残した。

### ゲームプレイ

| ID | 一次情報 |
|---|---|
| G-S1 | [Heroes](https://overwatch.blizzard.com/en-us/heroes/?blzcmp=app) — Damage / Support / Tank の役割説明 |
| G-S2 | [Weekly Recall: Sub-Role Call](https://overwatch.blizzard.com/en-us/news/24243646/) — サブロールとplaystyle |
| G-S3 | [Patch Notes June 2023](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/06/) — 敵向け能力音・初回VFXの認知性 |
| G-S4 | [Inside Echo’s Audio](https://overwatch.blizzard.com/en-us/news/23411614/from-zero-hour-to-hero-inside-echo-s-audio/) — 敵/自分、距離、存在音 |
| G-S5 | [Complex map design](https://overwatch.blizzard.com/en-us/news/23785339/diseno-de-mapas-en-overwatch-2/) — 目的誘導、choke、flank、高低差、cover |
| G-S6 | [Flashpoint patch notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/08/) — contest、Overtime、目標遷移 |
| G-S7 | [PTR notes](https://overwatch.blizzard.com/en-us/news/20157263/) — Practice / Play vs AI / Custom Game のAI履歴 |
| G-S8 | [Hero Mastery Gauntlet](https://overwatch.blizzard.com/en-us/news/24073414/test-your-teamwork-in-hero-mastery-gauntlet/) — 複数波、難易度、訓練bot |
| G-S9 | [Introducing Workshop](https://overwatch.blizzard.com/en-us/news/22938941/introducing-the-overwatch-workshop/) — rule / condition / action によるカスタム |
| G-S10 | [Open Queue](https://overwatch.blizzard.com/en-us/news/23466964/) — Role Queueと別の編成・評価 |
| G-S11 | [Hero Bans](https://overwatch.blizzard.com/en-us/news/24197272/) — 同時投票、役割上限、層別データ |
| G-S12 | [Balancing Act](https://overwatch.blizzard.com/en-us/news/24214498/) — pick/win rate と45–55%の説明 |
| G-S13 | [Competitive systems](https://overwatch.blizzard.com/en-us/news/23857518/initializing-systems-updating-competitive-play-for/) — 複数試合評価、scoreboardによる学習 |

### プレゼンテーション・アクセシビリティ

| ID | 一次情報 |
|---|---|
| P-S1 | [Flashpoint Map Reworks](https://overwatch.blizzard.com/en-us/news/24215719/weekly-recall-flashpoint-map-reworks/) — 入口、視線、clutter、区域差、斜め移動の明確化 |
| P-S2 | [2017-01 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2017/01/) — Kill Feedの能力・headshot情報 |
| P-S3 | [2017-05 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2017/05/) — 環境/能力別icon、蘇生色 |
| P-S4 | [Season 3 accessibility](https://overwatch.blizzard.com/en-gb/news/23912175/) — subtitle scale、portrait、speaker、色、preview |
| P-S5 | [2023-02 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/02/) — 色、cursor、chat可読性設定 |
| P-S6 | [2023-04 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/04/) — health / armor / shield / overhealth色 |
| P-S7 | [Accessibility/current notes](https://overwatch.blizzard.com/en-us/news/patch-notes/there%E2%98%9D%EF%B8%8F/) — chatとPracticeの表示設定 |
| P-S8 | [2018-11 PTR notes](https://overwatch.blizzard.com/en-us/news/patch-notes/ptr/2018/11/) — Dolby Atmos / Windows Spatial Audio |
| P-S9 | [2022-05 beta notes](https://overwatch.blizzard.com/en-us/news/patch-notes/beta/2022/05/) — reverb方向性 |
| P-S10 | [2020-12 notes](https://overwatch.blizzard.com/en-gb/news/patch-notes/live/2020/12) — 第三者足音の強調 |
| P-S11 | [2025-06 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2025/06/) — visual noise低減 |
| P-S12 | [2020-11 PTR notes](https://overwatch.blizzard.com/en-us/news/patch-notes/ptr/2020/11/) — Replay ViewerのHUD・outline・FOV・音・速度toggle |
| P-S13 | [2020-04 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2020/04/) — damage連動hit marker |
| P-S14 | [2025-01 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2025/01/) — 初回5試合AIとunlock短縮 |

### 運用・ライブサービス

| ID | 一次情報 |
|---|---|
| O-S1 | [Matchmaker deep dive](https://overwatch.blizzard.com/en-us/news/23896785/2/) — 内部MMRと検索拡張 |
| O-S2 | [Making a Great Match](https://overwatch.blizzard.com/en-us/news/23922958/) — role queue、party差、queue別parameter |
| O-S3 | [Deterring Leavers](https://overwatch.blizzard.com/en-us/news/24009615/) — backfill、離脱累積と停止 |
| O-S4 | [Competitive patch notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/04/) — queue別離脱、Top 500、シーズン跨ぎ |
| O-S5 | [Competitive update](https://overwatch.blizzard.com/en-us/news/24056255/) — 試合後rank更新とmodifier |
| O-S6 | [PTR FAQ](https://overwatch.blizzard.com/en-us/news/20157263/) — 域外参加の高遅延注意 |
| O-S7 | [Closed Beta FAQ](https://overwatch.blizzard.com/en-us/news/19932055/%7Coverwatch/) — Americas / Europe / Asia の地域区分 |
| O-S8 | [Defense Matrix reporting](https://overwatch.blizzard.com/en-us/news/23985150/) — report、text filter、voice識別、措置通知、bot/cheat検出 |
| O-S9 | [Anti-cheating Agreement](https://www.blizzard.com/legal/cd5930c0-2784-420c-a23d-1e0d6ff8599b/anti-cheating-vereinbarung) — 不正禁止と限定process scan |
| O-S10 | [Season cadence](https://overwatch.blizzard.com/en-us/news/23824005/) — 9週season cadence |
| O-S11 | [Patch notes](https://overwatch.blizzard.com/en-us/news/patch-notes/ps/) — hotfix、progression、patch単位の運用 |
| O-S12 | [Cross-progression FAQ](https://overwatch.blizzard.com/en-us/news/23824001/cross-progression-is-coming-t/) — account linkとprogression統合 |
| O-S13 | [Replay patch notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2025/08/) — Replay Code / Highlightのpatch期限 |
| O-S14 | [Privacy Policy](https://www.blizzard.com/en-us/legal/41e60b3d-244d-4776-be75-e2c6b3eba9a3/blizzard-entertainment-privacy-policy) — account、activity、region、chat、match、progression data |
| O-S15 | [Chat Agreement](https://www.blizzard.com/en-us/legal/966f03a4-29e1-440c-b142-e54ee091e52d/chat-agreement) — chat dataの扱い |

## ギャップ表 A — コアゲームプレイ、前線、役割、マップ、AI、衝突

| 領域 | OW一次情報で確認できる基準 | 現状の実装 / 証拠 | ギャップ | 深刻度 | 対応 | 受入基準 | 状態 |
|---|---|---|---|---|---|---|---|
| A-01 固定編成の権威性 | G-S1は3役割の機能差を説明。固定1/2/2自体はKagariaiのルール | サーバーが篝手1・焔手2・灯手2を強制。join時BOT枠置換、`role_full`、ACTIVE中`role_change_locked`を実装 | ルール整合性の残ギャップなし。回帰すると正典試合が崩れる | P0 | ロスター不変条件とjoin/select契約をrelease gateに固定 | 10接続受理・11番目拒否、role-full拒否、3 auditの両teamがexact 1/2/2、全18ヒーロー網羅 | 済 |
| A-02 役割の相互補完 | G-S1: Tankは吸収/choke突破、Damageは攻撃、Supportは回復・強化・妨害 | BOTは前衛contest/撤退、焔手crossfire、灯手負傷優先を持つ。HUDに役割責務 | 役割を欠いた人間チームの目的進行・生存低下を未測定。固定枠だけでは相互補完の証明にならない | P1 | role-ablation試験と人間プレイテストを追加 | 各役割を1人抜く条件を10試合ずつ。同効率にならず、目的進行時間または生存率が基準編成より20%以上悪化 | 進行中 |
| A-03 サブロール / ヒーロー目的の可読性 | G-S2: playstyleに対応するサブロールを明示 | 選択画面にrole、HP、weapon、passive、4 action、HUDに射程・CT・推奨行動 | 得意距離、支援方法、離脱条件の初見理解率がない | P1 | hero cardへ3項目の定型要約を追加し、blind comprehensionを実施 | 初見8人中7人以上が5秒以内に各ヒーローの主目的・得意距離・離脱条件を正答 | 外部ゲート |
| A-04 ヒーローキットの完成度 | G-S1/G-S2: 役割とplaystyleをヒーロー単位で区別 | 18人・各4 actionが実行可能。詳細数値が凍結済みなのは6人、残12人はprototype調整値 | 12人の完全数値、cancel、animation/audio、対人counterplayが凍結されていない | P1 | 12人の数値spec、counterplay、cancel windowを凍結し、version付きで検証 | 全18人の能力状態機械・数値・counterplayが凍結specと一致。未処理behavior 0、対人レビュー承認 | 進行中 |
| A-05 必殺技経済 | G-S12: 公式はpick/win rateを用いて調整。公式の「1試合3回」という値はない | 最終30 player-match、103回、平均3.433、中央値3.5、0回率0%、最大5。内部fail-closed範囲内 | BOT分布のみ。人間の貯め方、雪だるま、温存、役割別偏り、試合長補正はA-14と人間play gateで継続評価 | P2 | build/hero/role/match length別のult獲得・使用telemetryを追加 | この行のローカルgateは平均2.0–4.5、中央値2–5、0回率15%以下、最大8以下。seed/build付き証拠を保存 | 済 |
| A-06 目的のcontest・延長・逆転 | G-S6: contest中のOvertimeと目的遷移 | `ShiouraObjective`がcontested、overtime、sudden death、round winnerを権威管理。専用unit testあり | Kagariai固有ルールでの終了直前contest、再奪取、切断同時発生をまとめたE2E行列がない | P0 | 状態機械のmodel-based testとイベントlog照合を追加 | 終了直前contest/再奪取/同時full/切断/round境界の100シナリオで状態・event・winner 100%一致 | 進行中 |
| A-07 主経路・側面・高低差 | G-S5: choke突破と複数方向を監視するporous/flank設計 | `front`、`cloister`、`shallows`の3route。戦闘床z=0/2.5/4、櫓z=8、階段を実装。BOT recovery audit合格 | 形状はあるが、単一路依存、side/high-ground利用率、勝率偏りを測っていない | P1 | route entry/exit、高所滞在、choke通過を権威eventへ記録 | 50試合で単一choke利用率70%未満、迂回15%以上。team/role別のroute偏差と詰まり0を保存 | 進行中 |
| A-08 前線1人を支える遮蔽 | G-S5: Tank減少に合わせcoverを追加した設計事実 | 目標内の全身井桁・半身潮壺、市場の射線分断柱/箱、下段rock。frontline botは支援人数でcontest判断 | coverの有効利用、射線滞在、無敵pocket、前衛の集中砲火時間を人間/統計で未測定 | P1 | cover graph、LOS exposure、retreat path、time-to-focusを計測 | 主要交戦地点すべてに前進coverと支援から見える退路。cover有無ABで不当な即死/無敵pocketを検出し承認 | 進行中 |
| A-09 衝突・床・環境死 | G-S5: map geometryが移動・遮蔽・戦術を支える | 歩行、段差、落下、しゃがみ、dash、押引、spawnを共通swept-cylinderへ統合。blueprintから表示/衝突147/147。環境死0/64のBOT監査 | 指定seed/現行map外、複雑な曲面、高ping中の移動能力、人間全route walkはB-01/C-05の別gate | P0 | 現行ローカル衝突gateを保持し、追加seedは継続回帰へ入れる | この行のローカルgateは3 seed × 180秒 × 10 BOT＝5,400 BOT秒でfall/violation 0、環境死0/64、800 recovery開始を797完了＋2中断＋1進行中へ精算 | 済 |
| A-10 BOTナビゲーションの健全性 | G-S7/G-S8: 複数AI行動と難易度・訓練用途 | 複数階層ground A*、8m→12m失敗時拡張、到達候補選択、floor/step/drop/full-capsule/sweep検証、replan、ledge brake、stair/air/recovery mobility safety、戦闘detourを実装。3秒の最終目撃位置、2.5秒のteam focus、bounded detourを使い、壁越しのlive追尾/射撃を禁止。accepted 5,400 BOT秒で違反0 | 通常のauthored route waypoint間はrecovery pathほど毎segmentのswept安全性を事前証明しない。現行map通過は実測済みだがmap編集回帰と、敵ult予測/bait/retreat coordination、focus品質の尺度がない | P1 | authored route全edgeのcompile-time traversal検査、bot decision reason、戦術scenario suiteを追加 | 全route edgeがfloor/step/drop/capsule/sweepを合格。focus/retreat/ult responseを再現し、30秒戦術無活動0、全decisionにreason | 進行中 |
| A-10b BOT戦闘知性の合格条件 | G-S8: 訓練botに複数波・難易度・trained AIを用いる | 前衛/焔手/灯手のrole heuristic、能力使用、短期target memory、team focusはある。accepted JSONは64 combat deathを記録するが、navigation violationにするのは環境/void死だけ | navigation PASSはcombat survival、target選択の質、team coordination、人間級知性を証明しない。combat death/respawn downtimeの品質上限も未定 | P1 | 役割別decision oracleとdeath/contribution分布を別gateにする | 固定30 scenario（各role 10）で期待reason/action 100%一致・seed再現。100試合のrole別death/respawn/目的/damage/heal分布を保存し、2倍超の外れ値を未審査で残さない | 進行中 |
| A-11 練習AIと難易度 | G-S7/G-S8: Practice/Play vs AI、複数波、難易度選択 | 通常試合をBOTで満たせる。専用solo training flowや難易度設定の証拠なし | 初見が移動・照準・目的・能力を反復できない。BOT難易度を選べない | P1 | Practiceシナリオ、3難易度、完了event、resetを実装 | soloで移動/照準/目的/3能力を選択実行。3難易度で行動差が再現され、完了条件をevent logで100%判定 | 未着手 |
| A-12 カスタムルール / QA sandbox | G-S9: rule/condition/actionでmode、damage、heal、HUD等を変更 | コード内test helperとCLIはあるが、公開設定だけで保存・再実行するsandboxなし | QAが無限CT、dummy、time stopを標準build上で再現できない | P2 | version付きcustom rule schemaとread-only preset loaderを実装 | 3 QA presetを設定だけで保存/再実行。再起動後hash一致、標準対戦への副作用0 | 未着手 |
| A-13 固定/自由編成の分離 | G-S10: Role QueueとOpen Queueを別評価で運用 | 固定1/2/2のみ。自由編成queue、別rating、別telemetryなし | 選択幅がない。ただし自由編成を製品要件にしない選択は可能 | P2 | 導入する場合のみmode/queue/ratingを完全分離。導入しない場合はscopeを明記 | 固定/自由のresult・rating・telemetryが混在0。勝率差10pp超で調査alert | 未着手 |
| A-14 メタ・pick/win/ban分析 | G-S11/G-S12: rank/region/map別ban、pick/win rateを分析 | headlessはhero使用、damage、heal、ultを集計。永続version別100試合集計なし | build/role/map別の選択・勝率を追えず、調整根拠がBOT少数試合へ偏る | P2 | anonymous match telemetryとversioned aggregationを設計 | 直近100試合のpick/win/role/map/buildを再計算可能。45–55%外は「要調査」で因果断定しない | 進行中 |
| A-15 試合後の学習 | G-S13: scoreboardをteam needsと戦略調整へ使う | snapshotにはkills/deaths/damage/healingがある。永続post-match trend/exportなし | 目的寄与、死亡原因、役割寄与、複数試合傾向を学べない | P2 | PIIを除いたmatch summaryと20試合trendを実装 | 目的進行/死亡原因/役割寄与を表示。20試合exportに直接識別子なし、単一試合だけでrank評価しない | 未着手 |
| A-16 マップ / モード一般化 | G-S5/G-S6: 異なるmodeとmapで目的・route構造を設計 | 現状は「潮占」1mode、「大潮井」1map。内部報告でも4mode/8map/練習場等は非対象 | 1mapの合格を他mapへ一般化できず、学習・meta・route多様性が限定 | P2 | 公開予定contentごとに本書のroute/cover/readability gateを適用 | 出荷対象すべてでcollision、3route、人間readability、50試合route telemetryに合格。必要数は製品側で明示 | 進行中 |

## ギャップ表 B — 視聴覚可読性、オンボーディング、アクセシビリティ、アセット

| 領域 | OW一次情報で確認できる基準 | 現状の実装 / 証拠 | ギャップ | 深刻度 | 対応 | 受入基準 | 状態 |
|---|---|---|---|---|---|---|---|
| B-01 目的・入口の初見可読性 | G-S5/P-S1: 環境で目的を象徴化し、入口・視線・区域差を明確にする | spawnを出口へ向け、4m clearanceとroute接続を自動検査。HUDに目標と推奨行動。ローカル画面監査あり | waypoint/HUDなしの初見理解を測っていない。worldは箱型blockoutと大面積壁が残る | P1 | HUD on/offの固定spawn blind walkを同一buildで収録 | 4/5が10秒以内に次入口を特定、誤方向中央値1以下。別の10人試験で8/10が30秒以内に正route | 外部ゲート |
| B-02 シルエット・敵味方識別 | P-S1、P-S5/P-S6: 区域差・色設定で情報を区別 | 18種類の非色依存silhouette契約、味方outline、18 hero concept artがある | 専用3D character/rig/animationがなく、3距離・lighting・0.5秒blind test未実施 | P1 | final mesh/animationとoutlineを同条件frame testへ固定 | 3距離×lighting×teamで0.5秒提示し、class/team識別90%以上。色だけに依存しない | 進行中 |
| B-03 敵味方アビリティの危険伝達 | G-S3: 敵向け衝撃音・初回VFXで認知性を上げる | 72 action専用atlas、90音、windup/use/interrupted event、領域/障壁/弾体表示 | 味方/敵、開始/終了、危険範囲、取消をblindで判別するsemantic contractがない | P1 | cue metadataにteam、danger、phase、priorityを追加し、audio-muted/occluded試験 | audioなしで開始/終了/危険を90%以上、20件中miss 1以下。音blindで敵危険正答80%以上、誤警告10%以下 | 進行中 |
| B-04 VFXノイズ・中心遮蔽 | P-S11: 公式変更でvisual noiseを明示的に低減 | bounded effect pool、quality budget、reduced-motion、90 ability atlasを実装 | 同時ult/zone/projectile時の中心ROI遮蔽時間と誤読率を測っていない | P1 | effect priority、opacity cap、ROI instrumentationを追加 | 中心ROI遮蔽0.25秒/event以下、誤解10%以下。敵/目的/味方HPを隠すframeを自動保存 | 進行中 |
| B-05 HUDの正確性・遅延 | P-S2/P-S3: Kill Feedに能力、headshot、環境等の区別 | HP、shield、weapon、resource、4 action、ult、teammate、kill feed、推奨行動を表示。event ringあり | authoritative eventからHUD表示開始までの遅延と分類精度を計測していない | P1 | server event IDとclient presentation timestampを関連付ける | event分類95%以上、表示開始100ms以下。drop/resync後もfull snapshotとHUDが収束 | 進行中 |
| B-06 kill / hit / assist / 環境死feedback | P-S2/P-S3/P-S13: ability/headshot/environment表示とdamage連動hit marker | shot/hit/kill/heal等のevent、命中/被弾/撃破cue、kill feedを実装 | assist、headshot、environment、summon/deployable死の一貫分類とmarker/sound一致の証拠がない | P1 | outcome taxonomyをSSOT化しvideo/event comparatorを追加 | 各10件のkill/assist/HS/environment/summonを100%分類、marker/sound欠落0 | 進行中 |
| B-07 空間音・方向・距離 | G-S4/P-S8/P-S9/P-S10: 敵/自分、距離、spatial audio、方向reverb、足音を区別 | `PRODUCTION_READINESS_SPEC`はHRTF panningを要求。90 WAVの形式・hash・decodeは検証 | 方向、上下、距離、遮蔽、足音、敵味方の人間試験なし。Foley/occlusion/final mixも未制作 | P1 | HRTF/occlusionを実装確認し、2ヘッドホンでblind matrixを収録 | 左右前後上下90%以上、近中遠70%以上、足音混同10%以下。設定on/offを同一buildで保存 | 外部ゲート |
| B-08 音声アセット完全性 | G-S3/G-S4は音の識別性を示すが、asset pipelineのhash規則はKagariai固有 | Local DSP WAV 90/90、全hash固有、44.1kHz mono PCM16、source/runtime同一bytes、ブラウザfail-closed | 機械的完全性の残ギャップなし。意味、音量、疲労、定位は別行 | P1 | SSOT strict gateをrelease前に再実行 | `complete=true`、missing 0、hash/byte/MIME一致90/90、未知IDはnull、意図しないprocedural fallback 0 | 済 |
| B-09 全90音の人間聴感 | G-S3/G-S4/P-S10: 危険・距離・足音の人間認知が重要 | 自動scorecardは全行uncheckedで **NOT HUMAN-VERIFIED** | identity、loudness、fatigue、role clarity、headphone/browser/volume差を未承認 | P1 | 独立reviewerが90 source/runtime pairを実耳監査し署名 | 90/90にidentity/音量/疲労/空間・役割/2 headphones/browser/volume notes。blocker 0 | 外部ゲート |
| B-10 非音声代替・字幕 | P-S4/P-S7: subtitle size、speaker、背景、preview等を設定可能 | 視覚的HUD、ARIA live、ability state、reduced-motionはある | 戦闘警告字幕、speaker、背景/size、audio mute時の同等情報、設定永続の証拠なし | P1 | semantic warningからsubtitle/visual fallbackを生成し設定を保存 | 音量0で重要警告認知90%以上。subtitle size/speaker/background設定がreload/mode変更後も保持 | 進行中 |
| B-11 色・cursor・chatアクセシビリティ | P-S5/P-S6/P-S7: custom color、cursor size、high-contrast chat、opacity | 非色依存silhouette、focus、ARIA、responsive 375px、`prefers-reduced-motion` | 3 color preset/custom、health種別色、cursor size、chat contrast、grayscale試験なし。chat自体を出荷しない選択は可能 | P1 | tokenized color scheme、critical signalの形状併用、設定永続を実装 | 3 preset＋customでfriend/enemy/warning 90%以上、criticalの色単独依存0、grayscale/luminance test合格 | 進行中 |
| B-12 リプレイ / 観戦の因果可読性 | P-S12: HUD/Kill Feed/health/nameplate/outline/FOV/objective sound/speedを個別toggle | 永続replay/observer UIなし | バグ、通報、balance、学習を同じ試合から再現できない | P2 | version付きevent+snapshot captureと最小viewerを作る | 3 observerが同一原因を再現。0.75x/1.75xでevent時刻誤差0.2秒以下、toggleで因果が失われない | 未着手 |
| B-13 初見オンボーディング | P-S14/G-S7/G-S8: 初回AI試合と練習導線 | hero card、入力、role責務、推奨行動、CT、射程をHUD表示。通常BOT戦は可能 | tutorial、AI-only first matches、skip/reset、初見成功率・所要時間なし | P1 | 5試合以内の段階導入、practice、理解telemetryを実装 | 初見4/5が3基本能力を説明・実行し、主要HUDを5試合以内に認識。時間/retry/skipを記録 | 外部ゲート |
| B-14 animation / state transition | P-S11のnoise低減とP-S1の明確な空間表現は、状態を誤読させない方向性 | 予兆・発動cueとatlas frame animationはある。専用rig、weapon animation、最終character animationなし | locomotion、hit、interrupt、cancel、deathの状態をsilhouetteから判別できない | P1 | state machineとrig animationをevent IDで結び、interrupt遷移を収録 | 10 ability×normal/hit/interruptで誤分類5%以下、60fps captureのdrop 0 | 未着手 |
| B-15 world art / landmark / material impact | P-S1/P-S11: clutterを減らし区域差・入口・視線を明確化 | gameplay blockoutとPBR材質はcollisionに一致。Poly Haven材質あり | 箱型silhouette、大面積壁、専用world art/landmark/LOD/occlusion/material impactが未完成 | P1 | collisionを変えず、区域ごとのlandmark・material language・LOD/occlusionを制作 | 同一collision hashを維持し、B-01/B-04の人間試験とGPU budgetに合格 | 進行中 |
| B-16 アセットSSOT / runtime整合 | 3研究文書にOWのasset build pipeline一次基準はない。これはKagariai内部gate | 18 hero/72 abilityを同一IDで結合、WebP/WAV 90/90、ブラウザ内byte/hash/MIME検証、未知IDはfail-closed | 内容完全性の残ギャップなし。見た目、聴感、権利は別行 | P1 | 生成・cache・package・browser照合を同じcandidate bytesで再実行 | 連続buildでSSOT hash一致、runtime参照欠落0、改ざんfixtureを100%拒否 | 済 |
| B-17 アセット / ソースの権利 | 3研究文書に直接対応するOW比較基準なし。公開権利はKagariai固有の停止条件 | ImageGen manifest、Local DSP provenance、Poly Haven CC0、MIT notice、Sketchfab CC BY sidecarを監査 | project `LICENSE`未決定。Sketchfab元page/rights-holder再確認とowner attestationが未完 | P0 | 権利者がlicenseを決定し、最小の不足権限を取得。NOTICE/manifest/hashをcandidateへ固定 | `LICENSE`あり、Sketchfab source/権利確認、ImageGen/Local DSP owner確認、final notice scan合格 | 外部ゲート |

## ギャップ表 C — マッチメイク、通報、アンチチート、リプレイ、ライブ運用

この表のP0は**公開された競技 / ライブサービスを名乗る場合**の判定である。ローカルの単一試合クローズドテストでは、機能を非対象として外部アクセスを閉じ、非対象を明記できる。

| 領域 | OW一次情報で確認できる基準 | 現状の実装 / 証拠 | ギャップ | 深刻度 | 対応 | 受入基準 | 状態 |
|---|---|---|---|---|---|---|---|
| C-01 プレイヤーID・認証・再接続 | O-S12: account linkを全platform進行の基礎にする | `join {name, heroId}`。切断後3秒でBOT引継ぎ、枠再利用、restartでname/team/heroを保持。永続account/tokenなし | 同一人の安全な再接続、session hijack防止、制裁/進行との結合ができない | P0 | short-lived reconnect token、account/session ID、match journalを導入 | 100故障注入で二重参加/乗っ取り/重複結果0。token期限・再利用・別matchを拒否 | 進行中 |
| C-02 role queue / MMR / matchmaking | O-S1/O-S2: 内部MMR、検索時間で許容幅拡大、queue別parameter | 単一processの空き枠へjoinし、BOTと置換。役割上限はあるがqueue/MMR/storageなし | skill/party/region/roleを分けたmatch形成と待ち時間SLOがない | P0 | queue service、versioned MMR、role/party constraints、search expansionを設計 | 負荷試験でp50/p95待ち時間、skill差、role充足を記録し上限内。queue間データ混在0 | 未着手 |
| C-03 離脱・backfill・制裁 | O-S3/O-S4: mode別backfillと累積離脱penalty | 切断3秒後にBOTが同hero/位置/HPを引継ぐ。永続leaver recordや人間backfillなし | crash/意図離脱/サーバー障害を区別せず、再接続・補充・結果・制裁を一貫処理できない | P0 | disconnect state machine、reason taxonomy、rejoin window、mode別backfill、persistent accumulationを実装 | 100故障注入で二重参加/重複報酬0。server faultをplayer penaltyにしない。season跨ぎpolicyを再計算可能 | 進行中 |
| C-04 rank / competitive integrity | O-S4/O-S5: role/queue/region別の条件と試合後modifier説明 | rank、rating、season、persistent result ledgerなし | rankedを出すと結果再計算、改ざん検出、途中離脱の公平処理ができない | P0 | idempotent match result ledger、rating event、season ID、audit hashを実装 | eventからratingを再計算してhash一致。再送/patch/restartで重複・消失0、modifier説明あり | 未着手 |
| C-05 地域・RTT・劣化回線 | O-S6/O-S7: 地域外参加の高遅延と地域区分を明示 | serverはRTT EMA、jitter EMA、rolling min、rewind capを計測。10client deterministic impairment harnessとlocal WSS smoke手順あり | region選択、実Internet/ISP/NAT、3地域SLO、高遅延のqueue拒否/警告なし | P0 | region selection、preflight RTT/loss、quality warning/reject、3地域probeを実装 | 3地域×20/100ms jitter×1/5/10% lossでSLO。閾値超過試合の無警告開始0 | 外部ゲート |
| C-06 通報・モデレーション・異議申立て | O-S8/O-S14/O-S15: report、text/voice evidence、措置通知とdata利用 | report UI、case store、moderator workflow、appealなし。現状はplayer name以外のchat/voice機能を確認せず | 公開communityでharassment/cheat reportを受付・追跡・救済できない | P0 | 最小dataのreport→case→decision→notice→appealを設計。voice/chatを出さないなら明示的に無効化 | E2Eでcase相関100%。権限外閲覧0、保持/削除期限を実演、appealとaudit trailあり | 未着手 |
| C-07 アンチチート / bot検出 / 救済 | O-S8/O-S9: cheat/bot検出を継続運用し、不正programを禁止 | server-authoritative simulation、input shape/seq/rate/rewind cap、origin/connection limitは実装 | client改変、aim/automation、collusion、tamper telemetry、誤検知救済がない | P0 | authoritative validationを維持し、known-cheat simulation、behavioral signal、review/appealを追加 | 既知改変・速度/射撃/seq abuseを検出/拒否。正常accessibility inputの誤検知試験、silent failure 0 | 進行中 |
| C-08 progression / reward / season | O-S10/O-S11: season cadence、hotfix、Hero/Account progression | 永続progression/reward/seasonなし | 出荷する場合、再送・rollback・patchで重複/消失を防げない | P0 | 機能を出さないか、idempotent ledger、season ID、migration/rollbackを先に作る | 再送/role変更/patch/rollbackで重複・消失0。season境界を監査・再計算可能 | 未着手 |
| C-09 cross-platform / input pool | O-S12: account linkとcross progression | browser KBM/gamepad入力はある。platform account link、cross progression、input pool分離なし | platform identity/entitlement/privacy、KBMとcontrollerの競技分離を扱えない | P2 | cross-playを出す時だけaccount link、consent、entitlement、input-pool policyを実装 | PC/console相互fixtureで別account混線0、input pool policy違反0、unlink/consent撤回を確認 | 未着手 |
| C-10 replay / spectator serviceとPII | O-S13/P-S12: replayには期限・versionがあり、viewer toggleを持つ | replay ID、observer authorization、version policy、PII maskingなし | 調査・観戦・通報証拠を再現できず、後付け実装では漏えいriskが高い | P1 | capture schema、build version、TTL、observer ACL、name maskingを先に設計 | 期限切れ/権限外access拒否、PII masked、同build replayを3 observerが再現 | 未着手 |
| C-11 match中心の可観測性 | O-S14: match/activity dataを機能・不正検知・制裁へ用いる | `/healthz`はuptime、connections、tick drop、input、lag、event ring、admission、close code等を返す。graceful shutdownあり | 永続`match_id`、queue/region/build、disconnect/report/sanction相関、dashboard、alert、tamper detectionなし | P0 | match IDを全log/event/resultへ伝播し、append-only auditとSLO dashboardを作る | 1試合をclient→server→result→reportまで追跡。alert実演、改ざん検知、保持/削除job合格 | 進行中 |
| C-12 privacy / consent / retention | O-S14/O-S15: account、activity、region、chat、match、progression dataの利用とcontrol | 現状は永続account/chat/report storeなし。公開向けdata inventory、retention、deletion、consent UIなし | 将来機能ごとのpurpose、最小化、保持、削除、access、未成年/地域要件が未定 | P0 | data mapとthreat/privacy reviewを先に作り、機能ごとに収集をfail-closed | fieldごとにpurpose/owner/TTL/法的根拠/削除を定義。export/delete/opt-outとaccess controlをE2E確認 | 未着手 |
| C-13 public deploy / TLS / WSS / capacity | O-S6/O-S7は地域性能を明示。OW内部構成は公開されず、同一構成は要求しない | non-root/read-only/cap-drop Docker、local self-signed HTTPS/WSS、10client smoke、health/ready、graceful stop | 公開DNS、実証明書、host firewall、実origin、同時接続負荷、長時間soak、backup/rollback未実施 | P0 | 指定hostへstagingし、real cert、load/soak、restore/rollback drillを実施 | 公開相当stagingでTLS/WSS、10 physical clients、負荷上限、24h soak、backup restore、rollback、restart/OOM 0 | 外部ゲート |
| C-14 rate limit / DDoS / abuse boundary | O-S8/O-S9は継続的なabuse/cheat対策を示す | WS message token bucket、32 transport上限、join timeout、static stream上限、Origin制限 | IP/account/device単位制限、proxy trust、bot flood、DDoS provider、abuse alert/runbookなし | P0 | trusted proxy境界、IP/account quota、load shed、provider protection、runbookを構成 | spoofed forwarding拒否、flood時に正常client SLO維持、alert・ban・解除・rollback drill合格 | 外部ゲート |
| C-15 live cadence / hotfix / rollback | O-S10/O-S11: season cadenceと継続hotfix、patch単位運用 | hashed source ZIP、Docker候補、protocol version fail-closed、deployment docsはある | release channel、migration、canary、rollback、version support、incident ownershipがない | P1 | semantic build ID、artifact signing、canary、rollback matrix、release ownerを定義 | 同一artifactをpromoteし、canary失敗で自動停止。前版へdata lossなくrollback、protocol mismatchを明示拒否 | 進行中 |
| C-16 security / supply chain final gate | OW一次情報はanti-cheat中心。KagariaiのSBOM/scan/signatureは独立した公開gate | rc.4報告ではdependency vulnerabilities 0、exported rootfs Critical/High 0/0。rc.5 package/hashあり | 最終candidate同一bytesでSBOM、secret scan、image scan、signature、host configを再実行していない | P0 | 最終candidateを一度captureし、同じbytesをscan/sign/promote | SBOM、dependency/rootfs/secret scan、signature/provenance、detached SHA-256合格。scan対象と配備bytes hash一致 | 進行中 |

## 今すぐ直す Top 10

これは公開運用組織や権利者を待たず、現在のコード/テストで先に閉じられる順序である。外部ゲートは次節へ分離した。

1. **`match_id` と再接続tokenの土台を作る。** join名だけの識別をやめ、全event、disconnect、resultへ同じmatch/session IDを伝播する。
2. **目的状態機械の100境界シナリオを追加する。** contest、Overtime、再奪取、同時full、切断、round境界をmodel-based testで固定する。
3. **route / 高所 / cover telemetryを権威側へ追加する。** front/cloister/shallows、高所滞在、LOS exposure、retreat pathを50試合で判定可能にする。
4. **敵味方・危険度・phaseを能力cueのSSOTにする。** 72 actionへteam/danger/start/end/interrupted/priorityを付け、音なし・遮蔽越し検査へつなぐ。
5. **HUD / Kill Feedのevent相関を計測する。** authoritative event ID、client表示timestamp、kill/assist/HS/environment/summon taxonomyを一致させる。
6. **VFX budgetに中心ROI遮蔽を加える。** 同時effect負荷で0.25秒超の遮蔽frameを自動保存し、priorityで抑制する。
7. **BOT戦術scenarioと3難易度のPracticeを作る。** focus、retreat、ult response、直進/遠距離/突撃をreason付きeventで再現する。
8. **非音声fallbackと色accessibilityを実装する。** 戦闘警告字幕、形状icon、3 color preset/custom、設定永続、grayscale testを追加する。
9. **5試合以内の初見導線を実装する。** role、移動、照準、目的、3能力を段階的に教え、retry/skip/完了を計測する。
10. **version付き最小replayを作る。** snapshot+event capture、build ID、TTL、name masking、0.75x/1.75x viewerを調査・QAの共通証拠にする。

## 本番公開を止めるゲート

### すべての世界公開で停止するゲート

1. **権利:** project `LICENSE` の権利者決定、Sketchfab元page/rights-holder再確認、ImageGen/Local DSP owner attestation、最終NOTICE/asset inventoryが未完なら停止。
2. **公開経路:** 指定hostの公開DNS、実証明書、HTTPS/WSS、Origin、firewall、rate limit、DDoS境界のE2Eがなければ停止。
3. **実回線:** 地域別RTT/jitter/loss、10実client、長時間soak、reconnect、負荷上限が未検証なら停止。ローカルharnessは代替にならない。
4. **人間のゲーム品質:** 10人対戦、KBM/gamepad、主要browser/GPU、低性能端末、reduced-motion、酔い、route/cover/role可読性が未承認なら停止。
5. **視聴覚・アクセシビリティ:** 90音人間聴感、空間定位、敵味方cue、VFX遮蔽、字幕/非音声fallback、色設定、初見導線が未承認なら停止。
6. **運用:** match ID、dashboard/alert、on-call、incident/runbook、backup/restore、rollback drill、保持/削除jobがなければ停止。
7. **最終artifact:** 同一candidate bytesの全回帰、SBOM、dependency/rootfs/secret scan、signature/provenance、detached hashが揃わなければ停止。

### 公開競技 / ライブサービスを名乗る場合に追加で停止するゲート

1. account/session identity、再接続token、二重参加防止。
2. role/party/skill/regionを分離するmatchmakingと待ち時間SLO。
3. 離脱/backfill/rank/rewardを一貫処理する永続・冪等ledger。
4. 通報、moderation、証拠の最小保持/削除、措置通知、異議申立て。
5. server-authoritative anti-cheat、改変/bot検出、誤検知救済。
6. privacy data map、consent、access control、export/delete/opt-out。
7. replay/spectatorのversion、TTL、ACL、PII masking。
8. progression、season、cross-platformを提供する場合のaccount link、input pool、migration/rollback。

これらを実装しない限定公開を選ぶ場合は、該当機能を技術的に無効化し、「匿名・単一試合・クローズドプレイテスト」等の境界を配布画面と運用文書に明記する。未実装機能を含む Overwatch 同等、競技サービス完成、AAA完成という表示はしない。

## 証拠更新ルール

- statusを「済」に変える時は、受入基準と同じbuild IDのlog、JSON、video/screenshot、音響設定、human scorecardを保存する。
- mutableな作業パスを再読して結果を後付けしない。候補bytesをcaptureし、hashを記録し、その同じbytesをtest/scan/promoteする。
- 自動gate、人間QA、公開回線、法務/権利、運用drillは相互代替にしない。
- Overwatchの公開記事が示すのは観測可能な設計・運用特性であり、未公開の内部閾値、検出精度、保持期間、配置構成は推測しない。
