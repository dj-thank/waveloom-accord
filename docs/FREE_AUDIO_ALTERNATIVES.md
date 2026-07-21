# 無料で再現できるヒーローシューター音声の選定

調査日: 2026-07-21（Asia/Tokyo）

## 採用判断

公開版の90音は、**プロジェクト独自の決定論的ローカルDSP**で生成する。第三者の音源、生成モデル、モデル重み、API、アカウント、クォータを一切使わない。Node.jsの標準機能だけで44.1 kHz・mono・PCM16 WAVを生成し、IDごとの固定seed、生成器version、合成profile、ファイルSHA-256をmanifestに残す。

この経路なら、オフラインCPUで全件を一括再生成でき、外部モデルの利用条件や学習データの再配布条件をリリース物へ持ち込まない。音声の品質判断は、機械的な波形検査とは別に実機での聴感監査を必要とする。

## 比較した代替案

| 経路 | 公式条件 | 公開版での判断 |
|---|---|---|
| プロジェクト独自DSP | 自作コードと自作生成物。第三者sample/modelなし | **採用**。無料、オフライン、再現可能、CPUのみ |
| Stable Audio Open | [公式model card](https://huggingface.co/stabilityai/stable-audio-open-1.0) と [Stability AI Community License](https://stability.ai/license) の条件に従う | 技術検証候補。モデル導入、利用条件、noticeを追加で管理する必要があるため今回不採用 |
| AudioCraft AudioGen | [公式README](https://github.com/facebookresearch/audiocraft#license) はコードをMIT、モデル重みをCC BY-NC 4.0としている | 非商用条件のため世界向け商用公開版には不採用 |
| AudioLDM 2 | [公式model card](https://huggingface.co/cvssp/audioldm2-large) はCC BY-NC-SA 4.0 | 非商用・ShareAlike条件のため不採用 |
| TangoFlux | [公式README](https://github.com/declare-lab/TangoFlux#license) は研究・非商用利用の条件を掲げる | 社内の非商用試作に限定。公開版には不採用 |
| Freesound CC0 | [公式FAQ](https://freesound.org/help/faq/) 上、各素材の個別license確認が必要 | CC0素材だけを選べば利用可能だが、90件ごとの由来監査が増えるため今回は不採用 |

## 公開ゲート

- 18武器＋72アビリティの90件がすべて別ID・別hashで存在する。
- 全WAVがRIFF/WAVE、44,100 Hz、mono、PCM16で、長さ・peak・RMS・末尾fadeを検査できる。
- sourceとruntimeの同一bytes、内容hash付きファイル名、MIME、byte数をSSOTで照合する。
- manifestに生成器version、seed、profile、license宣言を保存する。
- 実機スピーカーとヘッドホンで、音量、反復疲労、能力識別、定位、戦闘中のマスキングを人間が監査する。

この文書は技術・ライセンス候補の選定記録であり、法的助言ではない。外部モデルを将来採用する場合は、その時点の公式licenseと学習データ条件を再確認する。
