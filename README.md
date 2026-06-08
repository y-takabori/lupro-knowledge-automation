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

### 追加推奨プロパティ

既存のNotion DBに以下のプロパティがない場合、その項目はプロパティへは展開されません。JSON原文はこれまで通りページ本文に保存されるため、必要に応じてDBへ `rich_text` プロパティを追加してください。

| JSONキー | 推奨Notionプロパティ |
| --- | --- |
| `wordpress_article_angles` | `WordPress記事化の切り口` |
| `note_article_angles` | `note記事化の切り口` |
| `x_threads_post_ideas` | `X/Threads投稿案` |
| `actual_effects` | `実際の効果` |
| `user_pain_points` | `悩み・迷い` |
| `stuck_points` | `詰まったこと` |
| `decision_reasons` | `判断理由` |
| `lessons_for_other_companies` | `他社にも応用できる学び` |
| `future_improvement_ideas` | `Future improvement ideas` |
| `human_review_points` | `Human review points` |
| `things_to_prepare_before_starting` | `事前にやっておくべきこと` |

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

## Slack経由 GitHub Markdown保存MVP

既存のNotion保存機能は残したまま、Slackを入口にしてLUPRO実践ナレッジをGitHubリポジトリへ保存する機能を追加しています。保存単位は「1ナレッジ = 1フォルダ / 1Markdownファイル」です。Obsidianは必須ではなく、まずはGitHub上のMarkdownとSlackの保存完了リンクで閲覧・編集します。

### エンドポイント

```text
POST /.netlify/functions/slack-knowledge
POST /.netlify/functions/save-knowledge-github
```

`slack-knowledge` はSlack Slash commandとInteractivity用です。Slack署名を `SLACK_SIGNING_SECRET` で検証します。`save-knowledge-github` はWeb貼り付け画面用で、`Authorization: Bearer ${KNOWLEDGE_SAVE_TOKEN}` が必要です。

### 保存先構成

```text
knowledge/
  index.json
  tools/
    invoice-ai-assistant/
      index.md
      raw.json
      raw.txt
      metadata.json
      updates/
        2026-06-08-120000.md
  content-strategy/
  projects/
  marketing/
  sales/
  operations/
  client-work/
  internal-rules/
  learnings/
  other/
```

`knowledge_type` と保存フォルダの対応は、`tools -> knowledge/tools/`, `content_strategy -> knowledge/content-strategy/`, `projects -> knowledge/projects/`, `marketing -> knowledge/marketing/`, `sales -> knowledge/sales/`, `operations -> knowledge/operations/`, `client_work -> knowledge/client-work/`, `internal_rules -> knowledge/internal-rules/`, `learnings -> knowledge/learnings/`, `other -> knowledge/other/` です。

`project_key` は半角英数字とハイフンのみです。例: `notion-knowledge-automation`, `invoice-ai-assistant`, `wordpress-note-x-strategy`

同じ `knowledge_type + project_key` が存在する場合、`new` は既存ありでエラー、`update` は `updates/` に追記、`upsert` は存在すれば更新・なければ新規作成です。更新時は既存の `raw.json` / `raw.txt` を上書きせず、`raw-YYYYMMDD-HHMMSS.*` として保存します。

### 新規Slackアプリ設定

想定アプリ名は `LUPRO Knowledge Bot` です。Slash command `/knowledge-save` を追加し、Request URLに以下を設定します。

```text
https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/slack-knowledge
```

Interactivity & Shortcutsを有効化し、Request URLにも同じURLを設定します。可能であればMessage Shortcut「ナレッジ化する」を追加します。このFunctionは `message_action` を受けると、メッセージ本文を短文欄に入れたモーダルを開きます。

推奨Slack OAuth scopes:

- `commands`
- `chat:write`
- `files:read`
- `users:read`

SlackファイルURLまたはファイルIDから長文を取得する場合は `files:read` が必要です。

### 必要なNetlify環境変数

既存Notion用環境変数には触れません。GitHub/Slack保存用に以下を追加します。

| 変数名 | 用途 |
| --- | --- |
| `GITHUB_TOKEN` | GitHub Contents APIでファイルを作成・更新するトークン |
| `GITHUB_OWNER` | 保存先リポジトリのowner |
| `GITHUB_REPO` | 保存先リポジトリ名 |
| `GITHUB_BRANCH` | 保存先ブランチ。未設定時は `main` |
| `SLACK_SIGNING_SECRET` | Slackリクエスト署名検証 |
| `SLACK_BOT_TOKEN` | モーダル表示、ファイル取得、通知用 |
| `KNOWLEDGE_SAVE_TOKEN` | Web貼り付け画面から保存するためのBearer token |

GitHub Fine-grained tokenは対象リポジトリを限定し、`Contents: Read and write` を付与してください。トークン、APIキー、環境変数値はコード、ログ、Slackレスポンスに出さないでください。`raw.json` / `raw.txt` には機密情報が入り得るため、保存先GitHubリポジトリはPrivate前提です。

### Slackでの使い方

`/knowledge-save` を実行するとモーダルが開きます。入力項目は `title`, `knowledge_type`, `project_key`, `category`, `status`, `tools`, `summary`, `input_type`, `body_short`, SlackファイルURLまたはファイルID, `save_mode` です。

Slackリクエストは3秒以内にACKします。Slash commandではモーダルを開いて即時応答します。View submissionでは受付後、Netlifyの `context.waitUntil` が使える環境ではACK後にGitHub保存を継続し、`response_url` に短い結果を返します。環境によりACK後処理が安定しない場合は、長文保存の主ルートとしてWeb貼り付け画面を使ってください。

### 大量JSON・長文保存フロー

Slackモーダルの `body_short` は短いメモ用です。長文本文、ChatGPT相談ログ、固定JSON、実装ログは `/public/knowledge-ingest.html` を使ってください。`KNOWLEDGE_SAVE_TOKEN` の値を保存トークンに入力し、title、knowledge_type、project_key、status、input_type、save_mode、大量本文を入力して保存します。

Slackファイルを使う場合は、`.json` / `.txt` / `.md` ファイルをSlackへアップロードし、モーダルの「SlackファイルURLまたはファイルID」に貼り付けます。Botがファイルを取得して同じGitHub構成へ保存します。

### Markdownと元データ

保存時に `index.md` を生成します。Frontmatterには `title`, `project_key`, `knowledge_type`, `category`, `status`, `tools`, `source`, `created`, `updated` を入れます。本文には概要、背景、悩み、実装内容、詰まったこと、効果、記事化案、公開時に伏せる情報、今後の改善、更新履歴、元データへの案内を出します。

`input_type=json` の場合はJSONパースを試みます。成功した場合は整形して `raw.json` に保存し、主要項目を可能な範囲で `index.md` に展開します。配列やオブジェクトは `[object Object]` にならないように整形します。パースできない場合は `raw.txt` に保存し、Markdownに「JSONとしては未検証」と記載します。巨大な詳細データは削除せず `raw.json` または `raw.txt` に残します。

`input_type=markdown` または `plain_text` の場合は本文を `raw.txt` に保存し、タイトル、カテゴリ、概要などの入力情報を `index.md` に反映します。初期MVPではAI要約は行いません。

### index.jsonの役割

`knowledge/index.json` は全ナレッジ一覧です。新規保存時は追加し、更新時は該当 `knowledge_type + project_key` の `updated`, `summary`, `status` などを更新します。将来、スプレッドシート、OpenClaw、Obsidian、WordPress、note、X/Threadsなどへ展開するための入口として維持します。

### 既存Notion保存機能との違い

既存の `/.netlify/functions/save-lupro-knowledge` と `public/admin.html` はNotion DB保存用です。今回のGitHub/Markdown保存は `/.netlify/functions/slack-knowledge`, `/.netlify/functions/save-knowledge-github`, `public/knowledge-ingest.html` として分離しています。Notion DB作成・Notion保存・admin画面は削除していません。

### セキュリティと運用注意

- Slack署名検証を必ず有効にしてください。
- GitHub token、Slack token、保存トークンをレスポンスやログに出さないでください。
- Slackには長文の機密情報を返しません。
- GitHub APIで既存ファイルを更新する場合はshaを取得してからPUTします。
- 同じ `project_key` へ同時更新するとGitHub Contents APIの競合が起きる可能性があります。失敗した場合は再実行してください。
- 公開記事化前には `private_or_sensitive_info_to_hide` と `security_notes` を人間が確認してください。

### 確認手順

```bash
npm run check
```

追加確認として、`/knowledge-save` でモーダルが開くこと、短文保存で `knowledge/{folder}/{project_key}/index.md` が作成されること、JSON入力で `raw.json` が保存されること、同じ `project_key` の `update` で `updates/` 配下に追記ファイルが作成されること、`knowledge/index.json` が作成・更新されること、Slackに短い保存完了通知が返ることを確認してください。
