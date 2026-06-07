# LUPRO実践ナレッジ自動保存

ChatGPTで整理した「LUPRO実践ナレッジ化」の固定JSONを、Netlify Functions経由でNotionの「LUPRO実践ナレッジDB」に保存するためのプロジェクトです。

## できること

- Notionの親ページ配下に「LUPRO実践ナレッジDB」をコードで作成する
- `/.netlify/functions/save-lupro-knowledge` にJSONをPOSTしてNotion DBへ保存する
- APIキーや保存用トークンをコードに直書きせず、Netlify環境変数から読み込む

## 必要な環境変数

Netlifyのプロジェクト設定で、次の環境変数を登録してください。

| 変数名 | 用途 |
| --- | --- |
| `NOTION_API_KEY` | Notion APIを呼び出すための内部連携シークレット |
| `NOTION_PARENT_PAGE_ID` | DBを作成する親ページID |
| `NOTION_DATABASE_ID` | 作成後の「LUPRO実践ナレッジDB」のDatabase ID |
| `LUPRO_KNOWLEDGE_SAVE_TOKEN` | 保存APIを呼ぶためのBearerトークン |

秘密情報はGitHubに置かず、Netlifyの環境変数だけに保存してください。

## Notion DBを作成する手順

### Netlify上の環境変数で作成する

1. Notionで、対象の親ページにNotion連携を招待します。
2. NetlifyのDeployが成功していることを確認します。
3. ブラウザで `https://YOUR-NETLIFY-SITE.netlify.app/public/admin.html` を開きます。
4. `LUPRO_KNOWLEDGE_SAVE_TOKEN` の値を画面に入力し、「Notion DBを作成」を押します。
5. 既に「LUPRO実践ナレッジDB」が存在する場合は新規作成せず、既存DBのDatabase IDとURLを表示します。
6. 表示されたDatabase IDをNetlifyの環境変数 `NOTION_DATABASE_ID` に登録します。

管理ページに入力したトークンはブラウザに保存しません。AuthorizationヘッダーでFunctionへ送るためだけに使います。

### ローカルで作成する

ローカル環境に `NOTION_API_KEY` と `NOTION_PARENT_PAGE_ID` がある場合だけ、次のコマンドでも作成できます。

```bash
npm run create:notion-db
```

このスクリプトはAPIキーを表示しません。ローカルで `.env` を使う場合もGitHubへコミットしないでください。

## Notion DB作成API

エンドポイント:

```text
POST /.netlify/functions/create-notion-database
```

認証ヘッダー:

```text
Authorization: Bearer ${LUPRO_KNOWLEDGE_SAVE_TOKEN}
```

動作:

- 認証なし、または不正なトークンでは401を返します。
- 作成前にNotion検索で「LUPRO実践ナレッジDB」の既存DBを確認します。
- 既存DBがある場合は新規作成せず、既存の `database_id` と `url` を返します。
- 新規作成した場合も `database_id` と `url` を返します。
- `NOTION_API_KEY` と `LUPRO_KNOWLEDGE_SAVE_TOKEN` の値はレスポンスに含めません。

## 保存API

エンドポイント:

```text
POST /.netlify/functions/save-lupro-knowledge
```

認証ヘッダー:

```text
Authorization: Bearer ${LUPRO_KNOWLEDGE_SAVE_TOKEN}
```

必須項目:

- `project_title`
- `project_category`
- `status`
- `background_issue`
- `what_user_wanted_to_achieve`
- `tools_used`
- `implementation_summary`
- `private_or_sensitive_info_to_hide`

`status` はNotion保存前に既存のステータス選択肢へ正規化されます。推奨値は `planning`, `in_progress`, `completed`, `archived` です。
既存DBが日本語ステータス選択肢の場合も、対応する既存選択肢に変換して保存します。

正規化ルール:

- `planning`, `plan` -> `planning`
- `in_progress`, `progress`, `implementing`, `testing` -> `in_progress`
- `mvp_test_completed`, `mvp_completed`, `completed`, `done` -> `completed`
- `archived` -> `archived`
- 未定義の値 -> `planning`

サンプル送信:

```bash
curl -X POST "https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/save-lupro-knowledge" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SAVE_TOKEN" \
  --data @examples/sample-knowledge.json
```

成功するとNotionページの `page_id` と `url` が返ります。

## スマホから確認する流れ

1. GitHubにこのコードがpushされていることを確認します。
2. Netlifyの対象サイトでDeployが成功していることを確認します。
3. `https://YOUR-NETLIFY-SITE.netlify.app/public/admin.html` を開きます。
4. 保存トークンを入力して「Notion DBを作成」を押します。
5. 画面に表示されたDatabase IDをNetlifyの環境変数 `NOTION_DATABASE_ID` に登録します。
6. Notionの親ページに「LUPRO実践ナレッジDB」が作られていることを確認します。
7. ChatGPTで相談内容を `examples/sample-knowledge.json` と同じ形式の固定JSONにします。
8. スマホからでも使えるHTTPリクエストツール、またはChatGPTの連携ワークフローから保存APIへPOSTします。
9. Notion DBに新しいページが作成されていることを確認します。

## 確認観点

- Notion DBが指定した親ページ配下に作成される
- DBプロパティの型が意図どおりになる
- 正常なJSONを送るとNotionにページが作成される
- 必須項目が足りないJSONは保存されず、400が返る
- 認証トークンなし、または不正なトークンでは401が返る
- APIキーやトークンがログやレスポンスに出ない

## ローカル確認

構文チェック:

```bash
npm run check
```

Netlify Functionsのローカル起動:

```bash
npm run dev
```

ローカルでNotionに実保存する場合も、環境変数は `.env` などに保存し、GitHubへコミットしないでください。
