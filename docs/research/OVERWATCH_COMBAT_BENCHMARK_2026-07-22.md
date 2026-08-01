# Overwatch combat benchmark

調査日: 2026-07-22  
用途: Kagariai の戦闘テンポ、回復、耐久、クールダウン、前線形成を調整するための外部基準  
境界: 名称、台詞、造形、マップ、VFX は模倣せず、公開されたゲームプレイ数値と設計理由だけを比較基準にする。

## 結論

前線は frontline ロールの生存だけで成立させない。次の二つを毎tick動的に判定する。

- `pressureAnchor`: 現在、射線、遮蔽、耐久、軽減、機動力のいずれかで敵の注意と空間を引き受けているプレイヤー。
- `recoveryProvider`: 現在、回復、overhealth、damage reduction、lifesteal、退避支援のいずれかを味方へ供給できるプレイヤー。

通常は frontline が最有力の `pressureAnchor` になるが固定しない。Damage が回復場を置いて Support を維持する、Support が相互回復しながら角度を取る、Damage が機動力と自己回復で短時間だけ前線を代行する局面も正規の戦闘として扱う。

## 公式値から取る基準

| 分類 | Overwatch の公開例 | Kagariai の初期基準 |
|---|---|---|
| Damageによる味方回復 | Soldier: 76 の Biotic Field は自分と味方を回復。公式変更で 35→40 HPS | 汎用中距離Damage 1人に半径4m、40 HPS、5秒、18秒CDの回復場を持たせる |
| 継続回復 | Mercy は 55 HPS。Lúcio は20 HPSの範囲回復例 | 単体55前後、範囲18〜40 HPSを基準。範囲・機動・火力を同時に持つほど下側へ置く |
| 即時救命 | Mercy Flash Heal は60、低HPへ2倍、12秒CD。Ana Biotic Grenade は90 damage/heal、12秒CD | 即時50〜90、低HP条件で最大120程度、9〜14秒CD。総回復を増やすより無回復窓を短くする |
| 混合回復 | Brigitte Inspire は12即時＋45継続へ変更 | 遅延回復だけの武器には小さな即時分を付け、命中の反応性を保証する |
| 高頻度投射回復 | Kiriko Healing Ofuda は12/発、7発/秒 | 理論最大84 HPSを上限参考にし、飛翔時間・命中率・遮蔽で実効値を下げる |
| Tankからの味方回復 | Roadhog の選択肢は Take a Breather の回復量50%を周囲へ配る | ロール横断utilityを許可し、`teamFunctions`から回復供給役を判定する |
| Tank耐久 | Winstonの6v6例は総HP525。Tankは瞬間溶解を避け、味方の撃破を可能にする役割 | 525〜700 HP帯を維持し、短時間burstだけで防御能力前に消えない。常時不死にはしない |
| 通常Damageの火力 | Soldier: 76 は19/発、Tracerは6/発、Illariは最大75/発の公開例 | 250 HPに対する胴撃ち単独TTKを概ね1.8〜2.8秒。精密・近距離・資源制約で上下させる |
| バースト | 2024 Season 9はHPを増やし、burstとone-shotを抑制 | 非ULTの単独一連入力で250 HPを確定させる場合は、照準・接近・複数CDなど明確な条件を要求する |
| 防御CD | Roadhog Hook 8秒、Ana grenade 12秒、Mercy burst 12秒、Immortality Fieldの旧例23秒 | 通常交換5〜14秒、戦闘を一度だけ覆す能力18〜25秒。1戦闘中に複数回回る能力と1回だけの能力を分ける |
| ULT頻度 | 公式patchでは強化後の火力に合わせてULT costを7〜30%調整 | 固定時間ではなくdamage/heal/mitigation寄与で調整し、標準試合で中央値約3回を自動監査する |

数値の時点は混同しない。Ana、Brigitte、Kiriko、Lúcio、Mercy は2026年のCore patch値を採用し、Soldier: 76 の40 HPSは2023年に公開された変更値を設計較正値として使う。2026年の公式HeroページでもBiotic FieldがDamageロールから自分と味方を回復する能力であることは継続して確認できるが、同ページはCoreのHPS数値を表示しないため、40 HPSを「2026年現在値」とは断定しない。

## テンポ契約

1. 250 HPの標準体は、単独の安定射撃だけなら約1.8〜2.8秒で倒れる。
2. 実戦の最初の死亡は、遮蔽、回復、回避、防御CDを含めて概ね3〜20秒の範囲へ置く。
3. 回復は射撃を無効化し続けない。Damage側には角度、focus、回復阻害、バースト合わせの決着窓を残す。
4. Tankまたは動的anchorは、少なくとも1回の防御・回復交換を行える一方、全CD枯渇後は集中射撃で倒れる。
5. 一人死亡後は2.5秒程度のtrade窓を許可し、それを越えた人数不利は再集合する。
6. 回復供給役のロールは問わない。能力が実際に味方HPまたは有効HPへ寄与したかで測る。

## マップ契約

- 1 Tank環境では自然遮蔽を増やし、正面以外の角度を成立させる。
- 正面チョークは集団戦の緊張を作るが、唯一の通路にはしない。
- front、cloister、shallows の三入口を実移動で検証し、各チームに正面Damage 1人とside Damage 1人を必ず割り当てる。
- 目標、主要チョーク、側道入口は環境の色・形・照明で読み取れるようにする。

## 参照した一次情報

- Blizzard, *Director's Take: Opening up the conversation on 5v5 and 6v6*: 1-2-2、個人のagency、角度・flank、過剰なmitigation/healingによる膠着。
  https://news.blizzard.com/en-us/article/24104605/director-s-take-opening-up-the-conversation-on-5v5-and-6v6
- Blizzard, *Director's Take: Future Formats*: single Tankの影響力、teamfight volatility、初期ULT economyからのsteamroll。
  https://news.blizzard.com/en-us/article/24289101/director-s-take-future-formats
- Blizzard, *Competitive Updates for Season 12*: Group/Wave Respawnが一方的試合を減らし、再集合と再交戦を増やした説明。
  https://overwatch.blizzard.com/en-us/news/24122265/director-s-take-competitive-updates-for-season-12/
- Blizzard, *Behind Overwatch 2's complex map design*: 1 Tank向けcover、porousなflank、複数監視点、chokeでのteamfight形成。
  https://overwatch.blizzard.com/en-us/news/23785339/uniting-gameplay-and-style-behind-overwatch-2-s-complex-map-design/
- Blizzard, *Building on Feedback*: burstとin-combat healingを同時に抑え、Damageの撃破agencyを作る方針。
  https://news.blizzard.com/en-us/article/24064843/directors-take-building-on-feedback
- Blizzard, *Empowering Tanks in Midseason*: Tankは攻撃を受けつつ味方の撃破を可能にし、瞬間溶解と不死の両極を避ける方針。全Heroの回復を10+最大HPの5%/秒へ変更した例。
  https://news.blizzard.com/en-us/article/24072110/director-s-take-empowering-tanks-in-midseason
- Blizzard, *Overwatch Retail Patch Notes – July 14, 2026*: Ana 90、Brigitte 12+45、Kiriko 12/発、Lúcio 22 damageなど最新のCore調整。
  https://overwatch.blizzard.com/en-us/news/patch-notes/NOTASINGLEMENTIONOFJUNKRAT/
- Blizzard, *Overwatch Retail Patch Notes – April 17, 2026*: Mercy 55 HPS、Flash Heal 60/12秒、Roadhogの周囲回復50%、Ana 12秒、Support passive撤去後の自己回復設計。
  https://overwatch.blizzard.com/en-us/news/patch-notes/live/2026/04/
- Blizzard, *Overwatch 2 Retail Patch Notes – July 11, 2023*: Soldier: 76 Biotic Field 40 HPS。
  https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/07/
- Blizzard, *Soldier: 76 hero page*: Damageロールが自分と味方を回復する正式なkit。
  https://overwatch.blizzard.com/en-us/heroes/soldier-76/
