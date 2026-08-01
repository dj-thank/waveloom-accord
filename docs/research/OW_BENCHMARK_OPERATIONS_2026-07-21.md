# Overwatch運用ベンチマーク（Kagariai rc.5）

作成日: 2026-07-21（一次情報を同日確認）。対象は Overwatch/Blizzard の公式ニュース、サポート、法務ページのみ。Blizzardの仕様はKagariaiの要件ではなく、観測可能な比較基準として扱う。

## 事実（一次情報）

- **マッチメイク/MMR・ロール**: Blizzardは全モードで表示ランクではなく内部MMRを使い、検索時間に応じて許容差を広げると説明している。Competitive Role Queueではパーティーのプレイヤー差を別に扱い、キューごとにパラメータを調整できる。[Matchmaker deep dive](https://overwatch.blizzard.com/en-us/news/23896785/2/)、[Making a Great Match](https://overwatch.blizzard.com/en-us/news/23922958/)
- **離脱/再接続・補充**: Quick Play等では通常すぐバックフィルする一方、Competitiveは離脱時15分停止から違反ごとに増加し、シーズン中の参加停止に至り得る。[Deterring Leavers](https://overwatch.blizzard.com/en-us/news/24009615/)。2023年の変更ではキュー別に離脱累積を分離し、シーズン移行で停止・BANの重さを完全リセットしない。[Competitive patch notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/04/)
- **競技整合性**: Top 500は役割/キュー/地域ごとに25勝が必要。[Patch notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/04/)。Season 9では各試合後のランク更新と、勝敗予測等のModifier表示を導入。[Competitive update](https://overwatch.blizzard.com/en-us/news/24056255/)
- **地域/レイテンシ**: PTRはAmericasリージョンのみで、域外参加は性能低下・高レイテンシを予告。別の公式ベータ記事でもAmericas/Europe（後日Asia）のゲーム地域区分と地域別の高遅延・長いキューを説明している。[PTR FAQ](https://overwatch.blizzard.com/en-us/news/20157263/)、[Closed Beta FAQ](https://overwatch.blizzard.com/en-us/news/19932055/%7Coverwatch/)
- **報告/モデレーション**: Defense Matrixはテキストフィルタ、音声の機械学習による識別・文字起こし、報告による継続的な違反者検証を使用。報告は早いほど音声が捕捉されやすく、措置通知も改善中。[Defense Matrix reporting](https://overwatch.blizzard.com/en-us/news/23985150/)。離脱は直近20試合中4回で10分停止（継続で30分）、Competitiveは別の厳格な停止。[Deterring Leavers](https://overwatch.blizzard.com/en-us/news/24009615/)
- **アンチチート**: Blizzardは不正プログラムを禁止し、RAM・ゲームプロセス・Windowsプロセス/ハンドルの限定スキャンを行うと法務ページに記載。[Anti-cheating Agreement](https://www.blizzard.com/legal/cd5930c0-2784-420c-a23d-1e0d6ff8599b/anti-cheating-vereinbarung)。Defense Matrixはチート・ボット検出と報告を継続運用。[Defense Matrix](https://overwatch.blizzard.com/en-us/news/23985150/)
- **進行/ライブサービス**: Overwatch 2は9週間のシーズン cadence（新マップ、ヒーロー、モード、定期バランス）を掲げた。[Season cadence](https://overwatch.blizzard.com/en-us/news/23824005/)。2025–26公式パッチはリプレイコードのパッチ単位有効性、継続的ホットフィックス、Hero/Account progressionを示す。[Patch notes](https://overwatch.blizzard.com/en-us/news/patch-notes/ps/)
- **クロスプレイ/進行**: Battle.netアカウントを全プラットフォームで必須とし、リンク済みコンソールの進行・コスメを統合する。[Cross-progression FAQ](https://overwatch.blizzard.com/en-us/news/23824001/cross-progression-is-coming-t/)
- **リプレイ/観戦**: 公式パッチは「In-Game Replay Codes and Highlights」をパッチ更新時に削除/有効期限化すると明記。[Patch notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2025/08/)。したがって再生可能性は永続保存ではない。
- **プライバシー/可観測性**: Blizzardはアカウント、活動ログ、IP由来地域、チャット、試合詳細、ゲーム進行を収集し、ゲーム機能・不正検知・制裁に利用。ゲームデータ共有はBattle.net設定でオプトアウト可能。[Privacy Policy](https://www.blizzard.com/en-us/legal/41e60b3d-244d-4776-be75-e2c6b3eba9a3/blizzard-entertainment-privacy-policy)、[Chat Agreement](https://www.blizzard.com/en-us/legal/966f03a4-29e1-440c-b142-e54ee091e52d/chat-agreement)

## Kagariai rc.5 リリース判定マトリクス

|領域|必須のテスト可能ゲート|証跡/合否|
|---|---|---|
|キュー/ロール|役割別キュー、MMR/レート分離、待ち時間に応じた探索上限を設定|負荷試験でp50/p95待ち時間・レート差を記録。上限超過は**Blocker**|
|切断/再接続|切断、再接続、試合終了、バックフィルを状態機械で一貫処理|故障注入100回で重複報酬/二重参加0。再接続不能は**Blocker**|
|ランク整合性|途中離脱・再接続・サーバー敗北を公平に反映し、シーズン跨ぎで累積を保持|イベントログと再計算ハッシュ一致。改ざん/不整合は**Blocker**|
|地域/遅延|地域選択/自動選択、RTT・ジッタ・パケット損失を表示し閾値で拒否|3地域×劣化ネットワークでSLO。高遅延試合の無警告開始は**Blocker**|
|報告/モデレーション|試合中報告、テキスト/音声証拠の最小保持、措置通知、異議申立て|E2Eで報告→ケース→通知を追跡。証拠欠落は**Blocker**|
|アンチチート|クライアント改変/ボット検出、サーバー権威判定、誤検知救済|既知チートシミュレーションと誤検知テスト。サイレント失敗は**Blocker**|
|進行/シーズン|シーズン識別子、報酬付与の冪等性、ロール/モード別集計|再送・ロール変更・パッチ更新で重複/消失0。報酬不整合は**Blocker**|
|クロスプラットフォーム|アカウントリンク、入力プール、クロス進行、権限/プライバシー同意|PC/コンソール相互試験。別アカウント混線は**Blocker**|
|リプレイ/観戦|リプレイID、バージョン互換性、期限、観戦者権限とPIIマスキング|期限切れ・権限外アクセスが拒否される。漏えいは**Blocker**|
|運用可観測性|match_id/queue/region/build、RTT、切断理由、制裁・報告を相関可能な監査ログへ|ダッシュボードとアラート、改ざん検知、保持/削除ジョブを実演。欠落は**Blocker**|

## 起動ブロッカーと後続ロードマップ

**起動ブロッカー**は、競技結果の非決定性（切断/報酬/ランク）、認証・クロス進行の混線、チートによる優位、PII/音声証拠の過剰収集、地域閾値を超える試合の無警告開始、監査不能な制裁である。これは上表のテストが一つでも失敗した場合の推論であり、Blizzardの同一実装を要求するものではない。

**後続**は、MMR推定の高度化、avoid/ブロック優先順位、音声多言語モデル、リプレイUI、シーズンイベント、詳細なプレイヤーアンケートである。これらは品質向上だが、上記の整合性・安全・監査ゲート合格後に実施する。

## まだ不足している本番システム（Top 10）

1. サーバー権威の試合状態と再接続トークン
2. キュー/ロール/MMRの分離可能なマッチメーカー
3. 地域選択、RTT/ジッタ測定、劣化時のキュー拒否
4. 離脱累積・制裁・シーズン跨ぎ状態ストア
5. 冪等な報酬/進行台帳（監査ハッシュ付き）
6. クライアント改変・ボット検出と誤検知救済
7. 報告ケース管理、音声/テキスト証拠の保持・削除・異議申立て
8. クロスプラットフォームアカウントリンクと入力プール隔離
9. バージョン付きリプレイ/観戦サービスとPIIマスキング
10. match_id中心のSLOダッシュボード、アラート、改ざん耐性ログ

## 不確実性と境界

Blizzardの公開記事は内部閾値、実際のサーバー配置、検出モデル精度、データ保持期間の全てを開示していない。したがって本書は「公式に確認できる運用特性」から導いた検証項目であり、Overwatchとの互換性・法的適合性・本番E2Eを証明しない。Kagariaiの実測（負荷、実機、地域、法務レビュー）が別途必要。
