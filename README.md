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

`slack-knowledge` はSlack Slash command `/knowledge-save` 用です。保存前確認ボタンやモーダル送信などのInteractivityは `slack-events` を推奨します。どちらもSlack署名を `SLACK_SIGNING_SECRET` で検証します。`save-knowledge-github` はWeb貼り付け画面用で、`Authorization: Bearer ${KNOWLEDGE_SAVE_TOKEN}` が必要です。

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

Interactivity & Shortcutsを有効化し、Request URLには `/.netlify/functions/slack-events` を設定します。可能であればMessage Shortcut「ナレッジ化する」を追加します。

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

## Slack投稿自動保存とGoogle Sheets一覧連携

Slackの「ナレッジ登録」チャンネルに長文JSON、Markdown、通常テキスト、`.json` / `.md` / `.txt` 添付を投稿すると、Slack Events経由でGitHubへ保存し、可能であればGoogleスプレッドシートにも一覧を追加・更新します。既存の `/knowledge-save` モーダルとWeb貼り付け画面は引き続き利用できます。

### Slack Event Subscriptions

Request URL:

```text
https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/slack-events
```

`url_verification` のchallengeに対応しています。Subscribe to bot eventsにはまず以下を設定してください。

- `message.channels`
- ファイル付き投稿を扱う場合は `file_shared` も追加候補

推奨OAuth scopes:

- `commands`
- `chat:write`
- `files:read`
- `channels:history`
- `links:read`

ナレッジ登録チャンネルだけを対象にする場合は、Netlify環境変数 `SLACK_KNOWLEDGE_CHANNEL_ID` に対象チャンネルIDを設定してください。未設定の場合は、Botが受け取れるメッセージイベントを処理対象にします。Bot自身の投稿、`bot_message`、保存完了通知には反応しません。

### 自動判定ルール

投稿本文または添付ファイル名から `json`, `markdown`, `plain_text`, `url` を判定します。JSONはスマートクォートを通常のダブルクォートに寄せ、コードフェンスを除去し、先頭の `{` から末尾の `}` までを抽出してパースします。壊れたJSONはエラー終了せず、原文を `raw.txt` に保存し、Slackには「JSONとしては壊れていますが、原文保存しました」と通知します。

Markdownは `raw.md`、通常テキストとファイル本文は `raw.txt`、JSONは `raw.json` に保存します。Slack通知のrawリンクも入力タイプに応じて正しいファイルURLを返します。

### 自動抽出されるメタデータ

JSONに以下のキーがあれば優先します。

- `project_title` / `title`
- `project_category` / `category`
- `status`
- `tools_used`
- `implementation_summary` / `summary`
- `created_at`
- `updated_at`
- `private_or_sensitive_info_to_hide`
- `media_theme`
- `article_main_message`
- `content_strategy`
- `wordpress_article_angles`
- `note_article_angles`
- `x_threads_post_ideas`

取得できない場合、タイトルは先頭見出しまたは冒頭50文字程度、`project_key` はslug化、slug化できない日本語タイトルは `yyyyMMdd-hash`、カテゴリは「未分類」、ステータスは `saved`、ナレッジ種別は `notes` にします。本文中に `ChatGPT`, `Codex`, `GitHub`, `Netlify`, `Slack`, `Notion`, `Google Sheets`, `WordPress`, `note`, `X`, `Threads` が含まれる場合は使用ツールとして抽出します。

### Google Sheets連携

Google Sheets APIはサービスアカウント方式を想定しています。対象スプレッドシートをサービスアカウントのメールアドレスへ共有してください。

必要なNetlify環境変数:

| 変数名 | 用途 |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | サービスアカウントのclient email |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | サービスアカウント秘密鍵。`\n` はFunction内で改行に復元 |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | 一覧を保存するSpreadsheet ID |
| `GOOGLE_SHEETS_WORKSHEET_NAME` | シート名。未設定時は `knowledge` |

現在の推奨環境変数:

| 変数名 | 用途 |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | サービスアカウントのclient email |
| `GOOGLE_PRIVATE_KEY` | サービスアカウント秘密鍵。Netlify環境変数の `\n` はFunction内で改行に復元 |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | 保存先スプレッドシートID |
| `GOOGLE_SHEETS_KNOWLEDGE_SHEET_NAME` | ナレッジ一覧シート名。未設定時は `ナレッジ一覧` |
| `GOOGLE_SHEETS_EVENTS_SHEET_NAME` | 更新履歴シート名。未設定時は `更新履歴` |

`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` も後方互換として読みますが、新規設定では `GOOGLE_PRIVATE_KEY` を使ってください。対象スプレッドシートは、サービスアカウントのメールアドレスへ編集者として共有してください。

想定列:

作成日、更新日、タイトル、保存キー、ナレッジ種別、カテゴリ、ステータス、使用ツール、概要、GitHub index URL、raw URL、source、Slack channel、Slack message URL、note展開候補、WordPress展開候補、X/Threads展開候補、公開時に伏せる情報、次にやること

Sheets環境変数が未設定、またはSheets API更新に失敗した場合でも、GitHub保存が成功していれば全体失敗にはしません。Slackには「GitHub保存: 成功」と「Google Sheets: 成功 / 未設定 / 失敗: 理由」を分けて通知します。

### Google Sheetsの表示整形

保存・更新時に、`ナレッジ一覧` と `更新履歴` の管理表としての見やすさを保つため、Google Sheets APIで軽量な書式設定を再適用します。

- 1行目を固定し、フィルタを有効化します。
- ヘッダー行は太字、背景色付き、白文字、中央揃えにします。
- 全体の文字サイズ、罫線、行高を読みやすい値に揃えます。
- `summary`、`note`、`sensitive_info` は折り返し表示にします。
- `github_index_url`、`raw_url`、`metadata_url`、`last_update_url`、`update_url` などのURL列は後ろ側に寄せ、幅を広げすぎない設定にします。
- `created_at`、`updated_at`、`event_time` などの日時列は日時形式にします。
- 既存ヘッダーが古い順序の場合は、列名を基準に推奨順へ並べ替えます。既存行は削除せず、未定義の独自列は既知列の後ろに残します。
- Functionインスタンス内では書式適用済みシートをキャッシュし、保存のたびに過剰な `batchUpdate` を投げないようにしています。

推奨列順:

`ナレッジ一覧`

```text
project_key, title, knowledge_type, category, status, summary, tools,
created_at, updated_at, update_count, last_event_type,
github_index_url, raw_url, metadata_url, last_update_url,
source, input_type, sensitive_info, slack_user, slack_channel, slack_ts
```

`更新履歴`

```text
event_id, event_time, event_type, save_mode, project_key, title,
knowledge_type, category, input_type, slack_user,
github_index_url, raw_url, metadata_url, update_url, note,
slack_channel, slack_ts, source
```

### Sheetsの2シート構成

`ナレッジ一覧` は「1ナレッジ = 1行」の管理用シートです。主な列は以下です。

```text
project_key, title, knowledge_type, category, status, summary, tools,
github_index_url, raw_url, metadata_url, created_at, updated_at,
update_count, last_event_type, last_update_url, source, input_type,
sensitive_info, slack_channel, slack_ts
```

`更新履歴` は「1保存イベント = 1行」の履歴用シートです。主な列は以下です。

```text
event_id, project_key, title, event_type, save_mode, knowledge_type,
category, input_type, github_index_url, raw_url, metadata_url,
update_url, created_at, slack_channel, slack_ts, slack_user, source, note
```

新規保存時:

- `ナレッジ一覧` に新しい行を追加
- `更新履歴` に `event_type=created` で1行追加
- `created_at` / `updated_at` は保存時刻
- `update_count=0`
- `last_event_type=created`

既存追記時:

- `ナレッジ一覧` で `project_key` が一致する行を探して更新
- `updated_at` を更新
- `update_count` を +1
- `last_event_type=updated`
- `last_update_url` に `updates/{timestamp}.md` またはJSON更新URLを保存
- `更新履歴` に `event_type=updated` で1行追加
- 一覧に `project_key` が見つからない場合は新規行として追加し、履歴の `note` に `project_key not found, inserted by update event` を残す

キャンセル時はGitHub本保存もGoogle Sheets更新も行いません。

### 重複保存防止

Slackの `event_id`、なければ `client_msg_id`、さらに `channel-ts` を使い、`knowledge/.events/{dedupeKey}.json` をGitHubに保存して処理済みマーカーにします。同じSlackイベントの再送では二重保存しません。

### セキュリティ注意点

Slack署名検証は `SLACK_SIGNING_SECRET` で必ず行います。APIキー、token、secret、メールアドレス、金額、顧客名らしき文字列が本文に含まれる場合は `metadata.json` の `warnings` と `private_or_sensitive_info_to_hide` に注意喚起を残します。ただし原文は勝手に削除せず、GitHub Privateリポジトリに保存します。公開記事化前に必ず人間が確認してください。

### エラー時の確認

- Slackに「必要な環境変数が不足しています」と出る場合はNetlify環境変数を確認
- 「GitHub保存に失敗しました」と出る場合は `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH` とFine-grained tokenの `Contents: Read and write` を確認
- 「ファイル取得に失敗しました」と出る場合は `SLACK_BOT_TOKEN` と `files:read`、またはWeb貼り付け画面を利用
- 「Sheets更新失敗」と出る場合はサービスアカウントの共有設定、Sheets API、`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` の改行復元を確認

### 追加確認手順

```bash
npm run check
```

確認項目:

- 既存の `/knowledge-save` モーダルが開く
- plain_text保存時に `raw.txt` リンクが出る
- JSON保存時に `raw.json` リンクが出る
- Slackチャンネルに短文を投稿しただけで保存される
- SlackチャンネルにJSONを貼っただけで保存される
- 壊れたJSONは `raw.txt` として保存され、エラーではなく警告になる
- `knowledge/index.json` が更新される
- Google Sheets環境変数がない場合でもGitHub保存は成功する
- Google Sheets環境変数がある場合は該当シートに行が追加または更新される
- bot自身の保存完了通知には反応しない
- 同じSlackイベントで二重保存されない

## Slack投稿の保存前確認フロー

Slackのナレッジ登録チャンネルに投稿された本文やファイルは、即GitHub本保存・Google Sheets更新されません。`/.netlify/functions/slack-events` が投稿を解析し、まず元投稿のスレッドに「ナレッジ候補を読み取りました。まだ保存していません。」という確認メッセージを返します。ユーザーがSlackボタンまたは編集モーダルで承認した場合だけ、GitHub保存とGoogle Sheets更新を実行します。

### Slack設定

Event SubscriptionsのRequest URL:

```text
https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/slack-events
```

Interactivity & ShortcutsのRequest URLも、確認ボタンを使うSlackアプリでは以下にしてください。

```text
https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/slack-events
```

既存の `/knowledge-save` モーダルを使う場合は、Slash commandのRequest URLは引き続き `/.netlify/functions/slack-knowledge` で利用できます。

Subscribe to bot events:

- `message.channels`
- privateチャンネルでも使う場合は `message.groups`

推奨OAuth scopes:

- `commands`
- `chat:write`
- `files:read`
- `channels:history`
- `groups:history`
- `links:read`

対象チャンネルを限定する場合は `SLACK_KNOWLEDGE_CHANNEL_ID` にチャンネルIDを設定してください。

### pending保存

確認待ちデータはGitHubの以下へ一時保存します。

```text
knowledge/.pending/{channel}-{ts}.json
```

pendingには推定メタデータ、原文、Slack channel/ts/message URL、類似ナレッジ候補、警告情報を保存します。この時点では `knowledge/{type}/{project_key}/index.md`、rawファイル、`knowledge/index.json`、Google Sheetsは更新しません。

保存完了またはキャンセル後はpendingの `status` を `saved` または `cancelled` に更新し、重複イベント防止のため以下へ処理済みマーカーを残します。

```text
knowledge/.events/{event_id または client_msg_id}.json
```

### 確認ボタンの挙動

- `新規保存`: 新しいナレッジとして保存します。
- `候補1に追記`: 確認カードに表示された「おすすめ更新先」の既存ナレッジに追記します。おすすめ更新先は類似候補の1番目です。
- `更新先を選ぶ`: `knowledge/index.json` から既存ナレッジを最大100件表示するモーダルを開きます。表示名は `タイトル（knowledge_type/project_key）` です。選択後、`このナレッジに追記する` で更新保存します。
- `内容を編集`: 推定タイトル、ナレッジ種別、カテゴリ、保存キー、保存モード、更新先project_key、概要を編集するモーダルを開きます。MVPではモーダル送信で保存まで実行します。
- `キャンセル`: GitHub本保存・Google Sheets更新を行わず、pendingを `cancelled` にします。元の確認カードは「キャンセルしました。GitHub本保存・Google Sheets更新は行っていません。」の終了表示に更新され、操作ボタンは消えます。

確認カード内には以下の説明を表示します。

- 新規保存: 新しいナレッジとして保存します
- 候補1に追記: おすすめ更新先の既存ナレッジに追記します
- 更新先を選ぶ: 別の既存ナレッジを選んで追記します
- 内容を編集: タイトル・分類・保存先を直してから保存します
- キャンセル: 保存せず終了します

処理済みの古い確認カードからボタン操作が届いた場合は、状態に応じて「この確認はすでにキャンセル済みです。保存したい場合は、もう一度ナレッジ本文を投稿してください。」または「この確認はすでに保存済みです。」と返します。

### 類似候補とproject_key

投稿内に `project_key` があれば優先します。`project_title` / `title` / Markdownの `# 見出し` があればタイトルとして使います。既存候補は `knowledge/index.json` の `title`, `project_key`, `summary`, `category` を簡易比較し、最大3件表示します。日本語タイトルなどslug化しにくい場合は `YYYYMMDD-HHmm-短いhash` 形式で `project_key` を生成します。

類似候補は確認カードに以下の形式で表示します。

```text
類似ナレッジ候補:
1. Slack自動保存テスト
   保存先: notes/slack-confirm-test
   類似理由: タイトル・本文が近い
```

### 事故防止

Bot自身の投稿、保存完了通知、確認メッセージへのスレッド返信、重複Slackイベントには反応しません。APIキー、token、メールアドレス、金額、顧客名らしき文字列は削除せず原文保存しますが、pendingとmetadataのwarning、および保存前確認メッセージの「公開時に注意が必要そうな情報」に表示します。

### 確認項目

- Slack通常投稿時に即保存されず、スレッドに保存前確認が出る
- 確認メッセージに「まだ保存していません」と表示される
- `新規保存` でGitHub本保存とSheets更新が走る
- 類似候補がある場合に `おすすめに更新` で既存へ追記できる
- `別の既存を選ぶ` でプルダウン選択できる
- `内容を編集` で推定値を編集できる
- `キャンセル` で本保存・Sheets更新が行われない
- plain_textは `raw.txt`、JSONは `raw.json`、Markdownは `raw.md` のリンクが返る
- 壊れたJSONは `raw.txt` 保存になりwarningが残る

### 長文JSONとファイル添付

ChatGPTが生成した長文JSONは、Slack本文へ直接貼り付けても、`.json` ファイルとして添付しても保存候補になります。Slack本文がJSONとしてパース可能な場合は `input_type=json` として扱い、承認後に `raw.json` と人間向けの `index.md`、一覧用の `metadata.json` を作成します。

JSONとして解析できない場合は保存候補カードに「JSONとしては解析できませんでしたが、テキストとして保存できます。」と表示し、承認後は `raw.txt` として保存します。この警告は `metadata.json` の `warnings` にも残します。

`.json` / `.txt` / `.md` ファイルが添付された場合は、BotがSlack file URLから本文を取得して保存候補にします。Slack投稿本文に補足コメントがある場合は、ファイル本文とは別に `supplemental_text` として `metadata.json` に残し、`index.md` にも「Slack補足コメント」として出します。

Slack本文が長い場合、確認カードに以下を表示します。

```text
長文の場合は .json / .txt / .md ファイル添付での保存を推奨します。
```

JSON新規保存時の構成:

```text
knowledge/{knowledge_type}/{project_key}/index.md
knowledge/{knowledge_type}/{project_key}/raw.json
knowledge/{knowledge_type}/{project_key}/metadata.json
```

JSONを既存ナレッジへ追記する場合は、通常の更新Markdownに加えてJSON差分も残します。

```text
knowledge/{knowledge_type}/{project_key}/updates/{timestamp}.md
knowledge/{knowledge_type}/{project_key}/updates/{timestamp}.json
```

保存完了メッセージは、新規保存と既存追記で表示を分けます。

- 新規保存: `新規保存しました`、タイトル、保存先、`index.md URL`、raw URL、`metadata.json URL`
- 既存追記: `既存ナレッジに追記しました`、更新先タイトル、更新先保存キー、今回の追記タイトル、追記ファイルURL、`index.md URL`、raw URL

## Slack URL設定の整理

現在の推奨設定は以下です。

| Slack設定 | Request URL |
| --- | --- |
| Slash command `/knowledge-save` | `https://lupro-knowledge-automation.netlify.app/.netlify/functions/slack-knowledge` |
| Slash command `/knowledge-delete` | `https://lupro-knowledge-automation.netlify.app/.netlify/functions/slack-events` |
| Event Subscriptions | `https://lupro-knowledge-automation.netlify.app/.netlify/functions/slack-events` |
| Interactivity & Shortcuts | `https://lupro-knowledge-automation.netlify.app/.netlify/functions/slack-events` |

保存前確認メッセージのボタン、既存選択プルダウン、編集モーダルは `slack-events` で処理します。`/knowledge-save` のSlash commandは `slack-knowledge` がモーダルを開きますが、モーダル送信先はSlackアプリ全体のInteractivity URLに送られるため、`slack-events` 側でも既存モーダル送信を処理できるようにしています。

互換性のため、Interactivity URLが古い `slack-knowledge` のままでも確認ボタンpayloadは `slack-events` のhandlerへルーティングします。ただし運用上はInteractivity URLを `slack-events` に統一してください。

Netlify Function logsでは、ボタン押下時に `slack_interaction_received`、通常投稿受信時に `slack_event_received` を出します。ログには `action_id`, `channel`, `user`, `event_id` などの識別情報だけを出し、APIキー、token、環境変数の実値は出しません。
## Slackからの確認付き削除

誤保存やテスト保存を安全に消すため、Slash command `/knowledge-delete` を追加できます。Request URLは `/.netlify/functions/slack-events` です。

使い方:

```text
/knowledge-delete notes/slack
/knowledge-delete notes google-sheets
/knowledge-delete test-knowledge
```

`knowledge_type/project_key`、`knowledge_type project_key`、または一意な `project_key` で指定できます。`project_key` だけで複数候補が見つかる場合は削除せず、`knowledge_type` の指定を求めます。

削除フロー:

- Slash command実行時点では削除しません。
- Botはタイトル、`project_key`、`knowledge_type`、GitHub保存先、Google Sheets反映予定を表示した確認カードを返します。
- `削除する` を押した場合だけ、GitHub上の `knowledge/{type}/{project_key}/` を削除します。
- 削除時は `knowledge/.deleted/{type}/{project_key}/metadata.json` に軽量な削除メタデータを残します。
- `knowledge/index.json` と、存在する場合は `knowledge/{type}/index.json` から該当レコードを削除します。
- Google Sheets連携が有効な場合、`ナレッジ一覧` の該当 `project_key` 行を削除し、`更新履歴` に `event_type=deleted`, `save_mode=delete` の履歴行を追加します。
- Google Sheets更新に失敗しても、GitHub削除が成功していれば削除自体は成功扱いにし、Slackには `Google Sheets: 失敗: 理由` を表示します。
- `キャンセル` を押した場合は、GitHub削除・Google Sheets更新を行いません。

### テストナレッジの一括クリーンアップ

今回のテストデータ6件は、保護付きFunction `/.netlify/functions/cleanup-test-knowledge` でも一括削除同期できます。デプロイ後、Netlify環境変数が入った状態で実行すると、GitHub側の削除確認とGoogle Sheets側の行削除・deleted履歴追加をまとめて行います。

```bash
curl -X POST \
  -H "Authorization: Bearer ${KNOWLEDGE_SAVE_TOKEN}" \
  https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/cleanup-test-knowledge
```

対象は以下に固定しています。

- `notes/google-sheets`
- `notes/google-sheets-2`
- `notes/google-sheets-3`
- `notes/slack`
- `notes/20260609-0758-12345b5e`
- `learnings/test-knowledge`

Sheets環境変数が未設定、またはSheets更新に失敗した場合でも、GitHub削除は成功扱いにし、レスポンス内の各targetにSheets結果を分けて返します。

### GitHub削除後にSheetsだけ残った場合

`/knowledge-delete` は、GitHubの `knowledge/index.json` と `.deleted` に対象が見つからない場合でも、Google Sheets連携が有効なら `ナレッジ一覧` シートの `project_key` を検索します。

GitHubには存在せずSheetsにだけ存在する場合、Botは以下の確認カードを返します。

- GitHub上のナレッジは見つからなかったこと
- Sheets上の `project_key`, `title`, `knowledge_type`
- 削除対象が `Google Sheetsのみ` であること
- `Sheetsから削除する` / `キャンセル` ボタン

`Sheetsから削除する` を押した場合、`ナレッジ一覧` の該当行を削除します。通常運用の削除では `更新履歴` に `deleted` イベントを追加します。以下のテスト用 `project_key` については、テストクリーンアップとして `更新履歴` の既存行も完全削除します。

- `google-sheets`
- `google-sheets-2`
- `google-sheets-3`
- `slack`
- `20260609-0758-12345b5e`
- `test-knowledge`

一括削除したい場合は、Slackから以下を実行します。

```text
/knowledge-delete cleanup-test
```

この場合も即削除せず、削除予定project_key、`ナレッジ一覧` の削除予定件数、`更新履歴` の削除予定件数、GitHub側が対象なし/削除済みであることを確認カードに表示します。`実行する` を押した場合のみ、Sheets上のテスト行を削除します。

### Slackファイル添付での長文ナレッジ保存

Slack本文の文字数制限を避けるため、長文のLUPRO実践ナレッジはSlack本文へ貼り付けず、`.json` / `.md` / `.txt` ファイルとして添付する運用を推奨します。Slack本文は補足メモとして扱えます。

対応形式:

- `.json`
- `.md`
- `.txt`

ファイル添付時の扱い:

- 添付ファイル本文を保存対象の本文として読み取ります。
- Slack本文が同時にある場合は、`supplemental_text` として扱い、GitHubには `supplemental.md` として保存します。
- 確認カードには全文を出さず、ファイル名、推定入力タイプ、文字数、補足メモ有無、先頭プレビューだけを表示します。
- 承認前にはGitHub保存・Google Sheets同期は行いません。

サイズ上限:

- 1MB以下: 通常処理
- 1MB超から5MB以下: 保存候補にはしますが、確認カードに警告を表示します
- 5MB超: 拒否します。5MB以下の `json` / `md` / `txt` に分割してください

JSON添付の扱い:

- JSONとして解析できた場合は `input_type=json` として扱い、`raw.json` に保存します。
- JSONとして解析できない場合も保存候補化し、原文を `raw.txt` に保存します。確認カードと `metadata.json` の `warnings` / `json_parse_warning` に注意を残します。
- `metadata.json` には `parsed_json_available` を保存します。

複数ファイル添付:

- 対応ファイルが1つだけなら、そのファイルを本文として使います。
- 対応ファイルが複数ある場合は未対応です。1ファイルずつ投稿してください。
- 将来的には複数ファイルを1ナレッジに束ねる対応を検討します。

保存後のGitHub構成:

```text
knowledge/{knowledge_type}/{project_key}/index.md
knowledge/{knowledge_type}/{project_key}/metadata.json
knowledge/{knowledge_type}/{project_key}/raw.json または raw.md または raw.txt
knowledge/{knowledge_type}/{project_key}/supplemental.md
knowledge/{knowledge_type}/{project_key}/updates/{timestamp}.md
knowledge/{knowledge_type}/{project_key}/updates/{timestamp}.json
knowledge/{knowledge_type}/{project_key}/updates/{timestamp}.txt
```

Google Sheetsには、既存のURLや分類情報に加えて以下を反映します。

- `source_type`: `slack_text`, `slack_file`, `slack_text_and_file`, `web_paste`
- `file_name`
- `file_size`
- `char_count`
- `has_attachment`
- `has_supplemental_text`
- `input_type`
- `raw_url`
- `metadata_url`
- `github_index_url`

Slack private file URLやBot Token、本文全文はログや確認カードに出さないでください。GitHubリポジトリはPrivate前提で運用してください。

## Slack添付ファイルの推定ルール

Slackに `.txt` / `.md` / `.json` を添付した場合、Botはファイル本文を主本文として読み取り、Slack本文は補足メモとして扱います。推定優先順位は以下です。

`.txt` 添付でも本文冒頭に YAML frontmatter があれば `.md` と同じように解析し、`title` / `category` / `status` を本文見出しより優先します。
closing `---` がない場合でも、冒頭に `title:` / `category:` / `status:` が並ぶ場合は loose frontmatter として最低限のメタデータを抽出します。Slack確認カードには `frontmatter検出`、`title_source`、`category_source`、`project_key_source` を表示します。

- `title`: JSON内の `title` / `project_title`、YAML frontmatterの `title`、Markdownの最初の `#` 見出し、本文中の `タイトル案:` / `タイトル:`、ファイル名、最後に `無題ナレッジ`
- `project_key`: JSONまたはfrontmatterの `project_key`、title由来slug、Markdown見出し由来slug、ファイル名由来slug、本文キーワード由来slug、最後に `YYYYMMDD-HHmm-hash`
- `category`: JSONまたはfrontmatterの `category`、本文中の `カテゴリ:`、本文キーワード推定、最後に `未分類`
- `summary`: JSONまたはfrontmatterの `summary`、本文中の `概要:`、本文冒頭200〜300字、最後に `概要未設定`

日本語タイトルは無理にローマ字変換しません。既知キーワードを含む場合は意味のある英数字slugへ寄せ、難しい場合だけ日時hashへフォールバックします。日時hashにフォールバックした場合、Slack確認カードに「内容を編集」から修正できる警告を表示します。

Google Sheetsへ書き込む値は、配列・オブジェクトをそのまま渡さず、人間が読める短文に整形します。`summary` が object / array の場合は `summary` / `text` / `value` / `description` / `body` / `implementation_summary` / `article_main_message` / `facts` / `inferences` などを優先して抽出し、`[object Object]` が出ないようにします。

## 出力物の紐づけ管理

保存済みナレッジから生成したnote記事草案、X/Threads投稿案、有料マニュアル、テンプレートREADME、営業メモは、元ナレッジ配下に保存できます。

```text
knowledge/{knowledge_type}/{project_key}/outputs/note/{timestamp}.md
knowledge/{knowledge_type}/{project_key}/outputs/x_threads/{timestamp}.md
knowledge/{knowledge_type}/{project_key}/outputs/paid_manual/{timestamp}.md
knowledge/{knowledge_type}/{project_key}/outputs/template_readme/{timestamp}.md
knowledge/{knowledge_type}/{project_key}/outputs/sales/{timestamp}.md
```

API入口:

```text
POST /.netlify/functions/save-knowledge-output
Authorization: Bearer {KNOWLEDGE_SAVE_TOKEN}
```

リクエスト例:

```json
{
  "knowledge_type": "notes",
  "project_key": "slack-json-save-test",
  "output_type": "note",
  "title": "note記事草案",
  "body": "# note記事草案\n\n...",
  "created_by": "Codex",
  "model": "gpt-5",
  "status": "draft",
  "note": "Slack保存ナレッジから生成"
}
```

`metadata.json` には `outputs`、`latest_output_at`、`output_count` を保存します。Google Sheetsの「ナレッジ一覧」には以下の列を追加し、各媒体の最新URLを確認できるようにします。

- `note_output_url`
- `x_threads_output_url`
- `paid_manual_output_url`
- `template_readme_output_url`
- `sales_output_url`
- `latest_output_at`
- `output_count`

Google Sheetsには「出力履歴」シートも作成します。1アウトプット = 1行で、`output_id`、`project_key`、`knowledge_type`、`source_title`、`output_type`、`output_title`、`output_url`、`created_at`、`created_by`、`model`、`status`、`note` を記録します。
