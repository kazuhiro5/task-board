# task-board

自分専用のタスク管理Webアプリ。スマホ・PC・iPadから同じタスクを追加・確認できる。

- 公開URL：https://kazuhiro5.github.io/task-board/
- 中身：HTML/CSS/JavaScript（ビルドなし）＋ Firebase（Googleログイン・Firestore）
- データは本人のGoogleアカウントでログインした時だけ読み書きできる（`firestore.rules`）。このリポジトリにタスクの中身は入っていない

## ローカルで動かす

```
python -m http.server 8765
```

`http://localhost:8765/?demo=1` を開くと、ログインせずに見本データで画面を確かめられる。

## ルールを反映する

```
firebase deploy --only firestore:rules
```
