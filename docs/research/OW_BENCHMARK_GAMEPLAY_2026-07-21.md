# Overwatch gameplay benchmark for Kagariai rc.5

調査日: 2026-07-21 (JST)  
対象: Kagariai 1.0.0-rc.4 を rc.5 に引き上げるための中立的な対戦ゲームプレイ検証。Overwatch の名称・ルールを実装要求にコピーせず、「観測可能な品質特性」へ変換する。

## 読み方と証拠の扱い

「事実」は Blizzard の一次情報に明記された内容、「推論」はその事実から Kagariai 用に導いたテスト設計である。数値閾値は Overwatch の再現ではなく、rc.5 の回帰を検出するための提案値。各 URL は調査日に解決確認済み。

## ベンチマーク基準マトリクス

| ID / 特性 | 一次情報（事実、アクセス日） | Kagariai でのテスト可能な受入基準（推論） |
|---|---|---|
| G-01 役割の相互補完 | 公式ヒーロー一覧は Damage を攻撃、Support を回復・強化・妨害、Tank を被ダメージ吸収と狭い chokepoint の突破として説明する。[Heroes](https://overwatch.blizzard.com/en-us/heroes/?blzcmp=app) (2026-07-21) | 代表編成（前衛/火力/支援）で各役割に固有の勝ち筋を持たせる。各役割を1人抜いた対戦を10回ずつ行い、残役割だけで同じ効率にならない（目的進行時間または生存率が20%以上低下）ことを確認。 |
| G-02 役割内サブロールの可読性 | Blizzard はサブロールを Hero のプレイスタイルに合わせた passives とし、Flanker/Recon/Survivor/Tactician 等を例示している。[Weekly Recall: Sub-Role Call](https://overwatch.blizzard.com/en-us/news/24243646/) (2026-07-21) | キャラクター選択・HUD・戦闘ログから「得意距離/支援方法/離脱条件」が5秒以内に識別できる。初見テスター8人中7人以上が各キャラの主目的を正答。 |
| G-03 アビリティの敵味方判別 | 公式パッチでは Sonic Arrow の敵向け衝撃音・初回 VFX を追加し、敵への認知性を高めた。[Patch Notes June 2023](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/06/) (2026-07-21) | 重要な敵アビリティ（範囲/拘束/高ダメージ）を、遮蔽越しでも音または短い VFX で判別可能にする。ブラインド音声テストで正答率80%以上、誤警告率10%以下。 |
| G-04 戦闘音の空間情報 | 開発記事は敵/自分の音を分け、飛行ヒーローにも距離に応じた存在音を与える設計を説明する。[Inside Echo’s Audio](https://overwatch.blizzard.com/en-us/news/23411614/from-zero-hour-to-hero-inside-echo-s-audio/) (2026-07-21) | 左右・距離（近/中/遠）・敵味方が音だけで区別できる。ヘッドホン試験20シナリオで方向正答90%、距離カテゴリ70%以上。 |
| G-05 目的の視覚誘導 | マップ開発者は環境デザインで capture point 等の重要地点を象徴化し、世界がゲームモードを導くと説明する。[Complex map design](https://overwatch.blizzard.com/en-us/news/23785339/diseno-de-mapas-en-overwatch-2/) (2026-07-21) | 初回プレイで目的地点・次の進行方向をミニマップなしに把握できる。説明なしのテスター10人中8人が30秒以内に正しいルートを選択。 |
| G-06 チョークと高低差 | 同記事は Circuit Royal の switchback を choke とし、集団での突破と team fight を促すと述べる。また Push は flanking のため複数方向を監視する porous 設計。[Complex map design](https://overwatch.blizzard.com/en-us/news/23785339/diseno-de-mapas-en-overwatch-2/) (2026-07-21) | 各マップに (a) 集団突破を要求する狭窄部、(b) 迂回/側面経路、(c) リスク付き高所を最低1つ配置。50試合の経路ログで単一 chokepoint 使用率70%未満、迂回利用率15%以上。 |
| G-07 目的競合と逆転余地 | Flashpoint は中央目標を奪い合い、99%で contest なら Overtime、次の地点へ即時移動し、5地点中3地点先取で勝利する。[Flashpoint patch notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/08/) (2026-07-21) | 目標が contest 中に不可逆完了しない。終了直前の contest/再奪取を含むシナリオを自動試験し、状態遷移（進行停止、延長、勝敗）が仕様通り100%一致。 |
| G-08 カバーと人数差の戦術 | マップ記事は「タンク1人減少」に対応して既存マップへ cover を追加したと説明する。[Complex map design](https://overwatch.blizzard.com/en-us/news/23785339/diseno-de-mapas-en-overwatch-2/) (2026-07-21) | 前衛1人編成でも即時集中砲火にならない遮蔽を主要交戦地点ごとに用意。遮蔽有/無の同条件試合で、無遮蔽側の初回全滅時間が25%以上短くならないことを確認（過度な安全地帯もDPSログで検出）。 |
| G-09 練習・AI・カスタム | 公式は Practice vs AI / Play vs AI / Custom Game に AI ヒーローを追加した履歴を持つ。[PTR notes](https://overwatch.blizzard.com/en-us/news/20157263/) (2026-07-21)。Hero Mastery Gauntlet は訓練 bot の複数波・難易度選択・trained AI を提供する。[Gauntlet](https://overwatch.blizzard.com/en-us/news/24073414/test-your-teamwork-in-hero-mastery-gauntlet/) (2026-07-21) | 新規プレイヤーがソロで、移動・照準・目的・主要アビリティを再現可能な練習シナリオから選べる。Bot は少なくとも直進、遠距離、突撃の3行動を持ち、難易度3段階。各シナリオ完了条件をイベントログで検証。 |
| G-10 カスタム拡張性 | Workshop は既存モードへ rule/condition/action を追加し、移動・ダメージ・回復・HUD表示まで変更できる。[Introducing Workshop](https://overwatch.blizzard.com/en-us/news/22938941/introducing-the-overwatch-workshop/) (2026-07-21) | QA 用カスタムルール（無限クールダウン、ダミー、時間停止）を公開API/設定だけで作成・保存・再実行できる。再起動後も設定ハッシュが一致し、標準対戦へ副作用ゼロ。 |
| G-11 編成の選択幅 | Open Queue は Role Queue の固定構成と異なる編成を許し、別 SR で運用する。[Open Queue](https://overwatch.blizzard.com/en-us/news/23466964/) (2026-07-21) | 固定ロール編成と自由編成を別キュー/ルールとして扱い、マッチ結果・レーティング・テレメトリを混同しない。各編成の勝率が10%ポイント以上乖離したら警告を出し、即時ナーフではなくデータ確認へ送る。 |
| G-12 競技メタの変化耐性 | Hero Bans は同時投票・役割ごとの上限を備え、ランク/地域/マップ別の ban データを収集する設計。[Hero Bans](https://overwatch.blizzard.com/en-us/news/24197272/) (2026-07-21)。開発チームは pick/win rate を用い、目標勝率帯を45–55%と説明する。[Balancing Act](https://overwatch.blizzard.com/en-us/news/24214498/) (2026-07-21) | 編成/カウンターを固定ハードコードせず、ピック率・勝率・ban率をバージョン別に記録。直近100試合で勝率45–55%帯から外れる役割/キャラを「要調査」とし、因果を断定しない。 |
| G-13 競技情報と学習 | Competitive 更新は複数試合（7勝/20敗）をまとめ、scoreboard はチームの needs/戦略調整に役立つと公式説明。[Competitive systems](https://overwatch.blizzard.com/en-us/news/23857518/initializing-systems-updating-competitive-play-for/) (2026-07-21) | 試合後に目的進行、死亡原因、役割別寄与を表示し、単一試合の順位変動だけで評価しない。直近20試合の傾向をエクスポート可能にし、個人識別情報を含めない。 |

## rc.5 で先に確認するトップ10ギャップ

1. 役割を入れ替えても勝ち筋が変わらない（G-01）。
2. 各キャラの役割/カウンターが初見で判別できない（G-02）。
3. 敵の高危険アビリティに音・VFX警告がない、または味方色と衝突する（G-03）。
4. 空間音だけで敵の方向・距離を追えない（G-04）。
5. 目的地点と次のルートが環境から読めず、UI waypoint 依存（G-05）。
6. 単一 choke の封鎖で迂回・高所・側面の選択が消える（G-06）。
7. contest/延長/再奪取の境界で勝敗が不定になる（G-07）。
8. 前衛1人編成の遮蔽不足、または遮蔽による無敵ポケット（G-08）。
9. 練習 bot が一種類の直進だけで、難易度・カスタム条件がない（G-09/G-10）。
10. 編成・メタの変化を計測せず、勝率偏差を即座に個別バランスへ反映する（G-11〜G-13）。

## 検証手順と限界

- 自動: 目標状態機械、イベントログ、設定ハッシュ、勝率/ピック率集計。
- 人手: 初見可読性、音方向、ルート選択を同一ビルドでブラインド試験。
- 合格は上表の閾値を満たすこと。ただし閾値自体は Kagariai のプレイヤー調査で再校正する。
- Overwatch の内部テレメトリ、実際のプレイヤー母集団、未公開仕様にはアクセスしていない。したがって本書は「類似性の証明」ではなく、観測可能な品質リスクの検出票である。
