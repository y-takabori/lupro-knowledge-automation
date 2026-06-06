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

1. Notionで、対象の親ページにNotion連携を招待します。
2. Netlifyまたはローカル環境に `NOTION_API_KEY` と `NOTION_PARENT_PAGE_ID` を設定します。
3. 次のコマンドを実行します。

```bash
npm run create:notion-db
```

4. 表示された `database_id` をNetlifyの `NOTION_DATABASE_ID` に登録します。

このスクリプトはAPIキーを表示しません。

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
3. Notionの親ページに「LUPRO実践ナレッジDB」が作られていることを確認します。
4. Netlifyの環境変数に `NOTION_DATABASE_ID` を登録します。
5. ChatGPTで相談内容を `examples/sample-knowledge.json` と同じ形式の固定JSONにします。
6. スマホからでも使えるHTTPリクエストツール、またはChatGPTの連携ワークフローから保存APIへPOSTします。
7. Notion DBに新しいページが作成されていることを確認します。

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
