# AGENTS.md — task-board

AIの担当が作業の前に読む。コードを読めば分かることは書かない。

## 書類（正本はVault側。このリポジトリの1つ上のフォルダ）
- 何を作るか・受け入れ基準：`../要件定義書.md`
- どう作るか：`../設計書.md`、なぜそうしたか：`../決定/`
- 進み具合：`../plan.md`

## 決まり
- **ビルドなし**。HTML/CSS/ESモジュールのJSだけ。npm の依存を足さない。外部の読み込みは Firebase（gstatic）だけ
- 画面は Firestore を直接触らない。`js/store.js` の `subscribe / addTask / updateTask / deleteTask / projectNames` だけを使う
- 日付は `js/dates.js`（'YYYY-MM-DD' の文字列、週は月曜始まり）。分類の選択肢は `js/constants.js`
- **担当のファイル以外は書き換えない**。共通ファイル（app.js・store.js・style.css など）を変えたい時は、変えずに報告する
- 色は `css/style.css` の変数（`--accent` など）を使う。ダークモードでも読めること
- スマホ幅（375px）で横にはみ出さない。押せる所は高さ40px以上
- 文言は日本語。短く

## 動かし方・確かめ方
- `python -m http.server 8765` をこのフォルダで動かし、`http://localhost:8765/?demo=1` を開く（ログインなし・見本データ）
- 画面の確認は Playwright（python）で、幅375pxと1280pxのスクリーンショットを撮る。コンソールのエラーが0であること

## GitHubの進め方
- 1機能＝1 Issue。ブランチ `feat/<名前>` で作業し、PR本文に `Closes #番号`
- 並行作業は `git worktree` で別フォルダに分ける
