# Kagariai チーム戦修復仕様

日付: 2026-07-22  
状態: 実装・検証中  
対象: 人間runtime編成、canonical Bot比較fixture、動的な前線・回復担当、再集合、交換、側面圧力、能力整合性、チーム戦telemetry

## 目的と独自設計の境界

Kagariai のチーム戦は、空間を作る、回復接続を保つ、交戦を開始する、能力を交換する、人数差へ短く応答する、離脱して再集合する、という対戦アクションゲームの一般的な戦闘文法を参照する。その文法を、Kagariai のヒーローSSOT、マップ、能力、Bot判断、権威simulation、telemetryから独自に実装する。

Overwatch の固有名、公開数値、台詞、造形、マップ、VFX、音声、その他の資産はコピーしない。本書の名称、閾値、比較fixtureはKagariaiの回帰ラチェットであり、他作品の値を移植したものではない。この独自設計方針は、それ自体で全ヒーロー、UI、音響、配布資産の権利確認完了を意味しない。権利・非複製レビューは別の出荷ゲートとする。

## 編成契約を分離する

### 人間runtime: role-open

人間が参加するlive runtimeの合法性は、表示ロールの枠数ではなく次の能力契約で判定する。

- 1チームはちょうど5人とする。
- `space >= 1` と `recovery >= 1` を必須とする。
- `space` はヒーローSSOTの `teamFunctions` にある `space` で数える。
- `recovery` は `sustain` または `continuous_sustain` で数える。
- frontline、damage、supportの人数は固定しない。frontline 0人の編成も、能力契約を満たせば合法である。
- frontlineや、いわゆるタンク役を必須にしない。damageヒーローなどが `space` や `recovery` を担ってよい。
- ロール名、日本語の説明文、ブランド名、見た目から能力を推定せず、SSOTの機械可読タグだけを使う。

live選択は候補編成を投影してから、5人と両能力をサーバー権威で検証する。最後の `space` または `recovery` を失う選択は `team_capability_required` と不足能力でfail closedにし、合法なロール変更をBotとの強制swapへ変換しない。join、select、restart、Bot補充を含む最終編成は、commit前に同じruntime能力契約へ到達しなければならない。

`ROLE_SLOTS`、`validateSustainComposition`、`projectHeroSelection` はcanonical Botと旧表示互換の契約であり、人間runtimeの合法性判定には使わない。

### canonical Bot: 比較fixture

決定論的Bot監査は、人間runtimeとは別に比較可能性を固定する。

- 各チーム5人、1 frontline / 2 damage / 2 supportとする。
- 同一チームのヒーロー重複を認めない。
- 各チームにsupportかつ `continuous_sustain` のヒーローを1人以上含める。
- 正典3 matchupを、それぞれ物理陣営だけ反転して6 runにする。

この1/2/2は、Bot同士の差分を比較するためのfixtureである。人間の選択規則、唯一の正解編成、将来のメタを定義しない。人間混在試合でcanonical候補からBotを補充する場合も、完成したlive編成の最終判定はrole-openな5人＋能力契約で行う。

## 動的な戦闘責務

### pressure anchor

前線責務は固定のタンクスロットではなく、戦闘中の `pressure anchor` として選ぶ。

- 生存し、無敵・非実体状態でない、frontlineまたは `space` / `mitigation` 能力を持つヒーローを候補にする。
- 原則として目的地に近い候補を選ぶ。frontlineが最良候補から6m以内ならfrontlineを優先する。
- frontlineが死亡または過伸長している時は、より接続されたdamage等がanchorになれる。
- 同距離の決定は物理player IDではなくヒーローとlogical identityで安定させ、鏡像実行の割当差を判断差へ混入させない。

静的な人間編成で `space` を満たす条件と、戦闘中に `mitigation` をanchor fallbackへ含める条件は別である。`mitigation` だけでruntimeの `space` 予算を満たしたことにはしない。

### recovery provider

回復責務も固定のsupportスロットではなく、現在のanchorに対する `recovery provider` として選ぶ。

- 生存し有効な `sustain` / `continuous_sustain` 保持者を、ロールを問わず候補にする。
- anchorに近い候補を選び、継続回復担当が最良候補から6m以内なら接続の安定を優先する。
- damageヒーローがproviderになった場合、そのBotは側面担当を中断して前面の回復接続へ戻る。

`frontline`、`tank`、`sustain support` という旧telemetry名は移行用aliasに限る。新しい実装・判定・文書ではanchor/providerを正とする。

## Botのチーム戦状態機械

### 再集合と圧力開始

- `regroup` ではcollision-checked pathで共有stagingへ戻る。経路探索失敗は短くrate-limitして再試行し、壁抜けや直線切りを許さない。
- canonical Botは全5人生存、anchor/provider生存、4人以上がstaging半径11m内、かつanchor/provider自身もstagedになってからreleaseする。
- `approach` からの通常pressure開始は、anchorがfront 18m内、providerがanchorから18m内、4人がfront-ready、かつanchorの実pressureがあることを要求する。
- 接続された前線が先に攻撃された場合は、3人front-readyでも防御的commitを許す。
- 成立済みpressureは1.5秒のmemoryで保持する。維持中だけprovider距離を20mまで許容し、1 tickの揺れで全員の標的と経路を消さない。

これらはcanonical Botの決定論的回帰パラメータであり、人間runtimeのロール制限ではない。

### bounded trade

- 同数交換または人数有利では、接続が残る間は戦闘を継続する。
- 1人不利は、最初の未回答死亡から2.5秒だけ交換窓を持つ。追加死亡でtimerを延長しない。
- provider死亡後の継続は、既にpressure中でanchorが前線を保持し、1人差かつ交換窓内の場合だけ認める。
- core喪失、2人以上の不利、交換窓終了、圧力接続喪失では全体をregroupへ戻す。

### bounded side pressure

- full rosterからdamage 1人だけを安定したside flankerに指定する。死亡のたびに相方へ担当を移さず、respawn後もlogical assignmentを維持する。
- flankerはapproach/pressureに同期し、anchorより最大7mの先行、横4〜12mの範囲を守る。pressure前の単独交戦を開始しない。
- 範囲外または危険な角度では標的を捨て、遠いstagingへの全面replanではなく、まず局所的なcollision-checked復帰を使う。
- 指定flankerだけがpressure中に露出したrecovery対象へ独立圧力をかけられる。そのfocusを無条件で前線全員へ共有しない。
- 通常対象は最大2 attackers、HP 70%以下のfinish対象だけ最大3 attackersとする。4〜5人の集中はfail closedにする。

## 能力整合性

能力の価値は入力bitの存在ではなく、権威simulationで意味のある発動、効果、eventへ到達したことで判定する。

- 全canonicalヒーローは4 actionの固有Bot policyを持ち、距離、HP、密度、資源、弾薬、cooldown、cast、link、戦術状態を参照する。
- cooldown、resource、ultimate gauge、必須target、link、設置物等の前提を満たさない操作は発動せず、CD・資源・gauge・`ability_used` eventを消費しない。
- cast中はtargetと意図した方向を保持する。中断は `ability_interrupted` と返却率を権威eventへ残し、成功時だけ `ability_used` / `ultimate_used` を出す。
- held入力はedgeで発動し、押し続けただけで同じ能力eventを毎tick重複生成しない。
- frontlineの防御は通常攻撃判断より先に評価し、同じ短時間に防御を重ねない。critical時は短い応答を許すが、安全な移動経路と退避方向を迂回しない。
- ultimate gaugeを長く保持したBotにはliveness候補を与えるが、射程、対象、利益、戦闘状態の条件を無視して浪費しない。
- テストは「選択した」だけでなく、windup、権威効果、target、event、cooldown/resource会計まで確認する。

## Telemetryの意味契約

### 採用する観測

- 公開 `World`、権威event、pre-tick player/barrier snapshot、Bot controllerの公開状態から計測する。
- ACTIVE中の既知actorと有効な敵targetだけを採用する。PREP、ghost、同陣営target、不正barrier、非正数damage/heal、無効な回復参加者を除外する。
- objective近傍は3次元距離と有効playerで計算する。両軍contestは、各軍3人以上と両軍の動的anchorがfront 18m内にいるACTIVE時間だけを積算する。
- `shot` は試行であって接触証拠ではない。fight clockを開始・延長するのは、有効な敵への `hit`、敵barrierへの `barrier_hit`、`kill` だけとする。
- healや能力setupはrole参加には数えられるが、敵対接触が止まった戦闘を延長しない。最後の敵対接触から3秒を超えた時に閉じる。
- pressure-anchor回復は、その時点の動的anchorに対する正の味方回復だけを数え、front外の回復と分ける。
- killはengagement内外の理由とともに一意に帰属し、global合計とengagement合計の整合を出す。
- 同時刻または逆順の観測、同一観測内の重複killを拒否する。受入に必須の方向別証拠が欠損または非有限ならfail closedにする。

### 意味上の限界

- full-role参加は、canonical 1/2/2 fixtureの一つの交戦中に、両軍の各表示roleが有効activityを1回以上出した累積条件である。同時参加、全5人参加、両DPS個別参加を意味しない。
- DPS offensive eventの `total` は `shots + hostileContacts` である。実damage量、target保持、LOS、focusの品質を単独では証明しない。
- regroupのstagger率は両軍合算で、遷移0件は現行算式上0になる。0件は良好な再集合の独立証拠として扱わない。
- pair差分は比較指標であり、現行evaluatorが数値上限を持たない項目を、未実装のbalance gateとして解釈しない。

## 自動受入条件

以下はすべてKagariai固有のinclusiveな回帰ラチェットである。

### 1 runのsemantic gate

- 各軍のpressure anchorがfrontで100以上の回復を受け、かつ2回以上の回復窓、または最長7秒以上の連続窓を持つ。
- 両軍のanchorが成立する二方向contestを10秒以上持つ。各軍のanchor objective時間は有限値でなければならない。
- bilateral hostile contactと両軍full-role activityを持つresolved teamfightを1件以上持つ。
- resolved teamfightのcontact span中央値を7〜30秒、最初のcasualtyまでの中央値を3〜20秒とする。
- anchor-engaged中のDPS offensive eventは多い側が10以上、少ない側 / 多い側が1/3以上である。
- global killの多い側が4以上なら、少ない側 / 多い側を0.4以上とする。
- staggered regroup exit率とstaggered fight entry率を、それぞれ25%以下とする。

### paired mirror gate

- match index `0..5` をちょうど1件ずつ要求し、欠落、重複、範囲外をfail closedにする。
- pairは `0↔3`、`1↔4`、`2↔5` とし、同じseed、同じcanonical lineup、同じlogical RNG identityを使い、物理teamだけを反転する。
- 6 runすべてが1 runのsemantic gateを通過しなければならない。
- lineupに揃えたkill share、最初のcasualty、contact span、二方向contest、各軍objective時間、front回復量・回復窓の差分を出す。差分が有限で比較可能であることは必須だが、現行実装にない差分上限を捏造しない。
- 片側killや一方向contactは、mirror差分が0でも各runのsemantic gateと診断flagで隠さない。

## 証跡と完了条件

現時点では実装・検証中であり、最終6-runの測定値は本書に固定しない。勝敗、kill、回復、戦闘時間、contest、pair差分の最終値は、統合後の同一source snapshotから取得した最終証跡で確定する。旧match 0、旧ロスター、旧telemetry schemaの数値を現行結果として再掲しない。

完了には次を要求する。

1. runtime編成、canonical Botロスター、動的anchor/provider、regroup/trade/side pressure、能力整合性、telemetry semantic gateのfocused testsが通る。
2. 全Node suite、map check、headless、サーバーprotocolとブラウザsmokeを、統合後の同一treeで通す。
3. canonical 6 runのraw結果、paired evaluation、artifact SHA-256、audit schema v3 provenance、core source manifest、acceptance evaluator自身のhashを同一captureとして保存する。
4. 6 runの欠落・重複がなく、全runと全pairが現行evaluatorで合格したことを保存済み証跡から再計算できる。
5. 実ブラウザでHUD、能力、前線交代、回復接続、死亡、交換、再集合を目視確認する。
6. 人間プレイテスト、公開ネットワーク、配布物の権利・非複製レビューを別ゲートとして完了する。

## Bot試験が証明しないこと

決定論的Bot試験が証明するのは、固定fixtureでの回帰、計測意味、比較可能性だけである。次は証明しない。

- 人間10人が面白いと感じること。
- プレイヤーがrole-openな責務、能力交換、再集合を理解できること。
- 人間入力、実ブラウザ、実端末、公開ネットワークで同じ品質になること。
- すべてのヒーロー、UI、音響、アセットが権利・非複製確認済みであること。
- 世界向けリリース品質、運用準備、公開可否。

したがってBotの6-run合格だけを世界リリースの根拠にしてはならない。最終証跡と人間E2Eは別々に合格させる。
