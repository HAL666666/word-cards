# ことばアルバム（word-cards）

家族の YouTube Shorts で出てきた「ことば」を、えいご・にほんご・ちゅうごくご（繁體字）のカードでおぼえる、子ども向けの PWA。
バニラ JS・ビルドなし・オフライン対応・ホーム画面に追加できます。

- 公開URL: https://hal666666.github.io/word-cards/
- 画面: `screens/`（390×844 ヘッドレス Chrome）

## できること
- **カード**：ビデオ（おでかけ）ごとに写真つきで並ぶ。1まい開くと EN / JA / ZH（ピンイン）/ 英語のよみ（ひらがな）、タップで発音
- **めくる**：タップでくるっと裏返し。🇺🇸🇯🇵🇹🇼 で発音。「⭕ おぼえた」「🔁 もういちど」でかんたん間隔反復（箱 0〜6：0,1,2,4,7,14,30日）
- **クイズ**：写真を見て、えいごを3つから選ぶ。まちがえても やりなおせる。いっぱつ正解で ⭐
- **おとなメニュー**（ホームの「おとな」を長おし）：カードをつくる（カメラ／アルバム）、あたらしいカードをさがす（cards.json 同期）、JSON 読み込み、バックアップ書き出し、表示する言語、声のはやさ、自動よみあげ、効果音、クイズの問題数、データ保護
- 発音：付属カードは mp3（edge-tts：en-US-AnaNeural / ja-JP-NanamiNeural / zh-TW-HsiaoChenNeural）。自分で作ったカードは Web Speech API（端末の声）

## カードの追加（リポジトリ経由）
1. 写真を `media/img/<id>.jpg`（正方形・640px くらい。家族以外の顔・個人情報なし）に置く
2. `cards.json` の `cards` に追記（同じビデオなら `videos` も）
3. `python3 tools/gen-audio.py` で `media/audio/<id>.<en|ja|zh>.mp3` を作る（cards.json の audio も自動で埋まる）
4. `npm test`（ファイルの存在・形式チェック）→ commit & push
5. アプリは起動時（オンライン時）とおとなメニューの「あたらしいカードをさがす」で取り込む。
   すでにあるカードを直したときは **`rev` を 1 増やす**（増えていないと端末側は更新しない）。
   端末で直した・消したカードは、同期で上書きされません。

```json
{
  "format": "word-cards", "version": 1,
  "videos": [ { "id": "cebu-2026-08", "title": "…", "date": "2026-08-23", "place": "Oslob, Cebu", "url": "https://youtube.com/shorts/…", "emoji": "🏝️" } ],
  "cards": [ {
    "id": "whale-shark", "video": "cebu-2026-08",
    "en": "whale shark", "kana": "ほえーる しゃーく", "ja": "じんべえざめ", "zh": "鯨鯊", "pinyin": "jīng shā",
    "image": "media/img/whale-shark.jpg",
    "audio": { "en": "media/audio/whale-shark.en.mp3", "ja": "media/audio/whale-shark.ja.mp3", "zh": "media/audio/whale-shark.zh.mp3" },
    "at": 5.0, "note": "Look! A whale shark!", "rev": 1
  } ]
}
```
必須は `en` だけ。`id` を省くと英語から作ります。`at` は動画の何秒目か（YouTube リンクに `t=` をつける）。
`image` / `audio` は相対パス・https・`data:` URL（JSON ファイル読み込み時）が使えます。

## データ
IndexedDB `word-cards-db`（cards / videos / progress / media / meta）。バージョンアップは「ストアを足すだけ」。
起動時に `navigator.storage.persist()`。バックアップ（`format: word-cards-backup`）は写真を data URL で含み、そのまま読み込み直せます。

## 開発
- `npm test` … node のユニットテスト（core ロジック・cards.json・SW/manifest/DB）
- `npm run e2e` … ヘッドレス Chrome 390×844 で一通り操作し `screens/` を撮る
- 本体を変えたら `sw.js` の `CACHE` の番号を上げる（media は別キャッシュ）

## 引っ越し（機種変更）用：データを書き出す／データを読み込む

おとなメニュー →「📦 引っ越し（機種変更）」。

- **データを書き出す**：IndexedDB の全部（カード・ビデオ・おぼえた記録・自分で撮った写真/録音（Base64）・設定）を `kotoba-album-all-v2-YYYY-MM-DD.json` 1つに。iPhone は共有シート（「"ファイル"に保存」や Google ドライブ）、そのほかはダウンロード。共有できなかったときは画面に保存リンクが出ます。
- **データを読み込む**：`app: "kotoba-album"` と版（v2 まで）を確認 → 件数を見せて確認 → **置き換え（既定）** か 統合。1つのトランザクションで書くので、途中で失敗しても今のデータはそのまま。以前の `word-cards-backup`（v1）は統合で読みます。
- テスト：`npm test`（tests/transfer.test.js）と `python3 tests/e2e_transfer.py`
