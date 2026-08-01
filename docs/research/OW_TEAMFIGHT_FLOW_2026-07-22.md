# Overwatch のチームファイト構造から抽出する設計原則

調査日: 2026-07-22  
対象: Kagariai の 5v5 Bot 戦、前線、回復、側面圧力、再集合、対一方的展開

## 結論

Kagariai が参照すべきものは、特定ヒーローの数値や能力ではなく、次の戦闘循環である。

1. 敗者が人数を揃えて再集合する。
2. タンクが射線と遮蔽を使い、味方が活動できる前線を作る。
3. 支援は有限の回復・防御・移動資源を回し、タンクを永続的に不死身にはしない。
4. DPS は前線の圧力を利用して正面火力、角度、限定的な裏取りを選ぶ。
5. 回復・軽減・攻撃能力を交換したあと、射線切れ、資源切れ、側面圧力、実行リスクを伴うバーストから決着窓が生まれる。
6. 勝者は目標進行へ変換し、敗者は一人ずつ再突入せず次の戦闘へ戻る。

長時間戦闘そのものを目的にしてはいけない。高い軽減と無制限に近い回復は、DPS の決定機を消し、必殺技だけが膠着を終わらせる状態を作る。一方、戦闘が一度のバーストで終わると、タンクの空間確保、支援の資源判断、DPS の角度選択が発生しない。目標は「複数の能力交換に耐えるが、対抗可能な決着窓を持つ戦闘」である。

## 一次資料から確認できる事実

### ロールと 5v5

- Blizzard は 5v5 を、チーム依存を残しつつ個人の影響力を増やし、軽減・CCを減らして射撃、角度、側面、決闘の余地を増やす形式として説明している。
- 1タンクは試合への影響と責任が大きい。タンクは戦闘を受け止めつつ味方の撃破を可能にするが、早く溶ける状態と倒せない状態の両方が問題になる。
- 支援は回復だけに拘束されず、攻撃や決闘へ参加できる余地が必要である。
- DPS には、支援の回復を無効化し過ぎない範囲で、撃破へ変換する主体性が必要である。

### 一方的展開と再集合

- Blizzard の分析では Group Respawn は一方的な試合の削減に非常に大きく寄与し、単独で繰り返し突入する行動を抑えた。
- その欠点を減らすため Wave Respawn が導入され、近い時間に死亡した味方を同時に復帰させ、より多くのチームファイトを起こす意図が説明されている。
- 2026年の開発説明でも、速い試合は爽快である一方、序盤の必殺技経済や敗北した戦闘からの steamroll が不公平感を強めるとされている。

### マップ

- 公式マップ解説は、チョークや折り返しが緊張とチームファイトを発生させ、目標物の視覚誘導がプレイヤーを戦闘地点へ集めると説明している。
- 同時に、5v5 では遮蔽を増やし、複数方向を監視する porous な経路と側面選択を持たせている。
- 公式改修例では、過剰な分岐がチーム分断を起こす場合は整理し、狭すぎるチョーク、長い復帰、スポーン射線、一方的な最終地点には、遮蔽、別出口、経路接続、復帰時間、目標ルールを組み合わせて対処している。

### 持続と決着窓

- Blizzard は、複数タンクの軽減と高く妨害されない回復が、必殺技が来るまで終わらない戦闘や進行しない防御を生んだと説明している。
- 全体HP増加は一撃・瞬間バーストを抑える一方、戦闘中回復の効率を抑え、DPSが撃破へ変換できるよう同時調整された。
- 強い防御・回復効果は、短い持続、有限資源、クールダウン、射線、位置、可視の回復低下、実行失敗時の反撃など、相手が利用できる窓と組にされている。

## Kagariai への安全な一般化

- 1-2-2 は維持する。ただし支援2枠のうち最低1枠は、味方のHPを実際に回復できる「持続支援」でなければならない。
- タンクの耐久は常時無条件のHP増加ではなく、支援射線、近接する味方数、防御能力、遮蔽、退避可能性と結び付ける。
- DPS の側面行動は、タンクが前線を作った時だけ深くし、人数不利や前線崩壊時は撤退・再集合へ切り替える。
- 回復、軽減、火力、必殺技を個別に調整せず、有効HP、戦闘中HPS、短時間バースト、能力稼働率、決着時間を同じ監査で扱う。
- 再出撃だけでなく、Bot の「待つ判断」を実装する。近くに味方が1人いるだけで再突入してはならない。
- 3経路は距離、危険、得られる角度の交換条件を持つ。長い側道には、前線と同期して到着できる接続または短縮路が必要である。

## 数値についての限界

Blizzard は、普遍的なチームファイト秒数、TTK、回復対火力の比率、必殺技/分、スタッガー率の正解値を公開していない。したがって Kagariai の受入値は Overwatch の数値ではなく、自作ゲーム内の最初の品質ラチェットとして定義し、複数seedと人間プレイで更新する。

## 主要一次資料

- Blizzard, [Director's Take: Opening up the conversation on 5v5 and 6v6](https://news.blizzard.com/en-us/article/24104605/director-s-take-opening-up-the-conversation-on-5v5-and-6v6), 特に `Why we switched to 5v5`。
- Blizzard, [Director's Take: Future Formats](https://news.blizzard.com/en-us/article/24289101/director-s-take-future-formats), `Hypothesizing` と `Collecting Data`。
- Blizzard, [Director’s Take: Competitive Updates for Season 12](https://overwatch.blizzard.com/en-us/news/24122265/director-s-take-competitive-updates-for-season-12/), `Introducing Wave Respawn`。
- Blizzard, [Uniting gameplay and style: Behind Overwatch 2's complex map design](https://overwatch.blizzard.com/en-us/news/23785339/uniting-gameplay-and-style-behind-overwatch-2-s-complex-map-design/), Push、cover、flank、switchback/choke の節。
- Blizzard, [Director’s Take – Building on Feedback](https://news.blizzard.com/en-us/article/24064843/directors-take-building-on-feedback), Season 9 の burst、in-combat healing、Damage agency。
- Blizzard, [Director's Take - Empowering Tanks in Midseason](https://news.blizzard.com/en-us/article/24072110/director-s-take-empowering-tanks-in-midseason), タンクの前線保持と burst/不死身の両極。
- Blizzard, [Weekly Recall: Flashpoint Map Reworks](https://news.blizzard.com/en-us/article/24215719/weekly-recall-flashpoint-map-reworks), 読みやすさ、遮蔽、側道、復帰経路。

## 証拠上の注意

- 公式記事は Blizzard の設計意図と個別調整を示す一次資料だが、Kagariai の楽しさを直接証明するものではない。
- 過去のパッチ値は時期固有であり、コピーしない。
- 「再集合 → 前線形成 → 資源交換 → 決着 → 再集合」という循環は、複数の公式説明から導いた Kagariai 向けの設計推論である。
