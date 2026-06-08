import {
  buildAutoKnowledgePayload,
  env,
  GitHubContentsClient,
  jsonResponse,
  parseTools,
  saveKnowledgeToGitHub,
  verifySlackSignature
} from "./knowledge-archive-core.js";
import { syncKnowledgeToGoogleSheets } from "./google-sheets-sync.js";

const typeLabels = {
  learnings: "学び・気づき",
  projects: "プロジェクト",
  tools: "ツール",
  strategy: "戦略・方針",
  content: "記事・発信",
  memo: "メモ",
  notes: "ノート",
  content_strategy: "コンテンツ方針",
  marketing: "マーケティング",
  sales: "営業",
  operations: "業務改善",
  client_work: "顧客提案",
  internal_rules: "社内ルール",
  other: "その他"
};

const statusLabels = {
  saved: "保存済み",
  draft: "下書き",
  in_progress: "進行中",
  active: "運用中",
  completed: "完了",
  article_candidate: "記事候補",
  published: "公開済み",
  archived: "アーカイブ"
};

const inputLabels = {
  json: "JSON",
  markdown: "Markdown",
  plain_text: "通常テキスト",
  url: "URL",
  file: "ファイル"
};

function slackText(text) {
  return { type: "plain_text", text: String(text || ""), emoji: false };
}

function mrkdwn(text) {
  return { type: "mrkdwn", text: String(text || "") };
}

function option(value, label) {
  return {
    text: slackText(label || value),
    value
  };
}

function safePendingKey(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 120);
}

function getGitHubClient() {
  const token = env("GITHUB_TOKEN");
  const owner = env("GITHUB_OWNER");
  const repo = env("GITHUB_REPO");
  if (!token || !owner || !repo) {
    throw new Error("必要なGitHub環境変数が不足しています。");
  }
  return new GitHubContentsClient({
    token,
    owner,
    repo,
    branch: env("GITHUB_BRANCH") || "main"
  });
}

function pendingPath(pendingKey) {
  return `knowledge/.pending/${safePendingKey(pendingKey)}.json`;
}

function eventPath(dedupeKey) {
  return `knowledge/.events/${safePendingKey(dedupeKey)}.json`;
}

async function readJsonFile(client, path, fallback) {
  const file = await client.getFile(path);
  if (!file?.content) return fallback;
  try {
    return JSON.parse(file.content);
  } catch {
    return fallback;
  }
}

async function putJsonFile(client, path, data, message) {
  await client.putFile(path, `${JSON.stringify(data, null, 2)}\n`, message);
}

async function slackApi(method, body) {
  const token = env("SLACK_BOT_TOKEN");
  if (!token) throw new Error("SLACK_BOT_TOKEN が未設定です。");
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Slack API ${method} failed.`);
  }
  return data;
}

async function postThread(channel, threadTs, text, blocks = null) {
  await slackApi("chat.postMessage", {
    channel,
    thread_ts: threadTs,
    text,
    blocks,
    unfurl_links: false,
    unfurl_media: false
  }).catch(() => {});
}

async function getPermalink(channel, messageTs) {
  try {
    const data = await slackApi("chat.getPermalink", { channel, message_ts: messageTs });
    return data.permalink || "";
  } catch {
    return "";
  }
}

async function fetchSlackFile(file) {
  const token = env("SLACK_BOT_TOKEN");
  if (!token) throw new Error("SLACK_BOT_TOKEN が未設定です。");
  const url = file?.url_private_download || file?.url_private;
  if (!url) throw new Error("SlackファイルURLを取得できませんでした。");
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error("ファイル取得に失敗しました。Web貼り付け画面を使ってください。");
  }
  return {
    text: await response.text(),
    name: file.name || file.title || ""
  };
}

function shouldIgnoreEvent(body, event) {
  if (!event || event.type !== "message") return true;
  if (event.subtype && event.subtype !== "file_share") return true;
  if (event.bot_id || event.bot_profile) return true;
  if (event.thread_ts && event.thread_ts !== event.ts) return true;
  if (env("SLACK_BOT_USER_ID") && event.user === env("SLACK_BOT_USER_ID")) return true;
  const targetChannel = env("SLACK_KNOWLEDGE_CHANNEL_ID");
  if (targetChannel && event.channel !== targetChannel) return true;
  if (body.authorizations?.some((auth) => auth.user_id && auth.user_id === event.user && auth.is_bot)) return true;
  return false;
}

function tokenSet(entry) {
  return new Set(String([
    entry.title,
    entry.project_key,
    entry.summary,
    entry.category
  ].filter(Boolean).join(" ")).toLowerCase().split(/[\s\-_/、。,.]+/).filter(Boolean));
}

function similarity(payload, entry) {
  if (payload.project_key && payload.project_key === entry.project_key) return 100;
  const a = tokenSet({
    title: payload.title,
    project_key: payload.project_key,
    summary: payload.summary,
    category: payload.category
  });
  const b = tokenSet(entry);
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  const titleHit = payload.title && entry.title && (
    String(payload.title).includes(entry.title) ||
    String(entry.title).includes(payload.title)
  ) ? 5 : 0;
  const categoryHit = payload.category && payload.category === entry.category ? 2 : 0;
  return overlap + titleHit + categoryHit;
}

async function findSimilarKnowledge(client, payload) {
  const entries = await readJsonFile(client, "knowledge/index.json", []);
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({ ...entry, score: similarity(payload, entry) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function warningsText(warnings) {
  return Array.isArray(warnings) && warnings.length ? warnings.join(" / ") : "なし";
}

function candidateText(candidates) {
  if (!candidates.length) return "なし";
  return candidates
    .map((item, index) => `${index + 1}. ${item.title || item.project_key} (${item.knowledge_type}/${item.project_key})`)
    .join("\n");
}

function recommendedText(candidates) {
  if (!candidates.length) return "新規作成";
  const first = candidates[0];
  return `既存ナレッジ「${first.title || first.project_key}」に更新`;
}

function confirmationBlocks(pending) {
  const payload = pending.payload;
  const candidate = pending.candidates?.[0];
  return [
    {
      type: "section",
      text: mrkdwn([
        "*ナレッジ候補を読み取りました。まだ保存していません。*",
        "",
        `*推定タイトル:*\n${payload.title}`,
        `*推定ナレッジ種別:*\n${typeLabels[payload.knowledge_type] || payload.knowledge_type}`,
        `*推定カテゴリ:*\n${payload.category || "未分類"}`,
        `*推定保存キー:*\n${payload.project_key}`,
        `*推定入力タイプ:*\n${inputLabels[payload.input_type] || payload.input_type}`,
        `*推定使用ツール:*\n${parseTools(payload.tools).join(", ") || "未取得"}`,
        `*公開時に注意が必要そうな情報:*\n${warningsText(payload.warnings)}`,
        `*類似ナレッジ候補:*\n${candidateText(pending.candidates || [])}`,
        `*おすすめ保存方法:*\n${recommendedText(pending.candidates || [])}`,
        "",
        "この内容で保存しますか？"
      ].join("\n"))
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: slackText("新規保存"),
          style: candidate ? undefined : "primary",
          action_id: "knowledge_confirm_new",
          value: pending.pending_key
        },
        {
          type: "button",
          text: slackText("おすすめに更新"),
          style: candidate ? "primary" : undefined,
          action_id: "knowledge_confirm_recommended_update",
          value: pending.pending_key
        },
        {
          type: "button",
          text: slackText("別の既存を選ぶ"),
          action_id: "knowledge_confirm_choose_existing",
          value: pending.pending_key
        },
        {
          type: "button",
          text: slackText("内容を編集"),
          action_id: "knowledge_confirm_edit",
          value: pending.pending_key
        },
        {
          type: "button",
          text: slackText("キャンセル"),
          style: "danger",
          action_id: "knowledge_confirm_cancel",
          value: pending.pending_key
        }
      ]
    }
  ];
}

function resultMessage(result, sheets) {
  const sheetsText = sheets?.ok
    ? "成功"
    : sheets?.skipped
      ? "未設定"
      : `失敗${sheets?.message ? `: ${sheets.message}` : ""}`;
  return [
    "保存しました。",
    "",
    `title: ${result.title}`,
    `knowledge_type: ${result.knowledge_type}`,
    `project_key: ${result.project_key}`,
    `save_mode: ${result.save_mode}`,
    `GitHub index.md: ${result.index_url}`,
    `raw: ${result.raw_url || result.raw_json_url || result.raw_md_url || result.raw_txt_url}`,
    `Google Sheets: ${sheetsText}`,
    `Web貼り付け画面: ${env("URL") || ""}/public/knowledge-ingest.html`
  ].join("\n");
}

async function saveApprovedPending(pending, overrides = {}) {
  const payload = {
    ...pending.payload,
    ...overrides
  };
  const result = await saveKnowledgeToGitHub(payload);
  let sheets;
  try {
    sheets = await syncKnowledgeToGoogleSheets(payload, result);
  } catch (error) {
    sheets = { ok: false, skipped: false, message: error.message };
  }
  return { result, sheets, payload };
}

async function markPending(client, pending, status, extra = {}) {
  const next = {
    ...pending,
    status,
    updated_at: new Date().toISOString(),
    ...extra
  };
  await putJsonFile(client, pendingPath(pending.pending_key), next, `Update pending knowledge ${pending.pending_key}`);
  if (status === "saved" || status === "cancelled") {
    await putJsonFile(client, eventPath(pending.dedupe_key), {
      pending_key: pending.pending_key,
      status,
      updated_at: next.updated_at,
      project_key: extra.result?.project_key || pending.payload.project_key
    }, `Mark Slack knowledge event ${pending.dedupe_key} ${status}`);
  }
}

async function createPendingFromEvent(body) {
  const event = body.event;
  if (shouldIgnoreEvent(body, event)) return;

  const dedupeKey = body.event_id || event.client_msg_id || `${event.channel}-${event.ts}`;
  const pendingKey = safePendingKey(`${event.channel}-${event.ts}`);
  const client = getGitHubClient();
  if (await client.getFile(eventPath(dedupeKey))) return;
  if (await client.getFile(pendingPath(pendingKey))) return;

  let text = event.text || "";
  let fileName = "";
  if (Array.isArray(event.files) && event.files.length > 0) {
    try {
      const file = await fetchSlackFile(event.files[0]);
      text = file.text || text;
      fileName = file.name;
    } catch (error) {
      await postThread(event.channel, event.ts, `ファイル取得に失敗しました。まだ保存していません。\n${error.message}\nWeb貼り付け画面: ${env("URL") || ""}/public/knowledge-ingest.html`);
      return;
    }
  }
  if (!String(text || "").trim()) return;

  const slackMessageUrl = await getPermalink(event.channel, event.ts);
  const payload = buildAutoKnowledgePayload({
    text,
    fileName,
    source: "slack_event",
    slack: {
      channel: event.channel,
      ts: event.ts,
      message_url: slackMessageUrl,
      event_id: dedupeKey
    }
  });
  const candidates = await findSimilarKnowledge(client, payload);
  const pending = {
    pending_key: pendingKey,
    dedupe_key: dedupeKey,
    status: "pending",
    created_at: new Date().toISOString(),
    channel: event.channel,
    thread_ts: event.ts,
    user: event.user || "",
    payload,
    candidates
  };
  await putJsonFile(client, pendingPath(pendingKey), pending, `Create pending knowledge ${pendingKey}`);
  await postThread(
    event.channel,
    event.ts,
    "ナレッジ候補を読み取りました。まだ保存していません。",
    confirmationBlocks(pending)
  );
}

async function openChooseModal(triggerId, pending) {
  const client = getGitHubClient();
  const entries = await readJsonFile(client, "knowledge/index.json", []);
  const options = (Array.isArray(entries) ? entries : [])
    .slice(0, 100)
    .map((entry) => option(
      `${entry.knowledge_type}|${entry.project_key}`,
      `${entry.title || entry.project_key} (${entry.knowledge_type}/${entry.project_key})`.slice(0, 75)
    ));
  await slackApi("views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "knowledge_choose_existing_submit",
      private_metadata: pending.pending_key,
      title: slackText("更新先を選択"),
      submit: slackText("更新保存"),
      close: slackText("キャンセル"),
      blocks: [
        {
          type: "input",
          block_id: "target",
          label: slackText("更新する既存ナレッジ"),
          element: {
            type: "static_select",
            action_id: "target",
            options: options.length ? options : [option("none|none", "候補がありません")]
          }
        }
      ]
    }
  });
}

function inputBlock(blockId, label, initialValue = "", multiline = false) {
  return {
    type: "input",
    block_id: blockId,
    label: slackText(label),
    element: {
      type: "plain_text_input",
      action_id: blockId,
      initial_value: String(initialValue || "").slice(0, 2900),
      multiline
    }
  };
}

async function openEditModal(triggerId, pending) {
  const payload = pending.payload;
  await slackApi("views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "knowledge_edit_submit",
      private_metadata: pending.pending_key,
      title: slackText("保存内容を編集"),
      submit: slackText("保存"),
      close: slackText("キャンセル"),
      blocks: [
        inputBlock("title", "タイトル", payload.title),
        inputBlock("project_key", "保存キー project_key", payload.project_key),
        inputBlock("knowledge_type", "ナレッジ種別", payload.knowledge_type),
        inputBlock("category", "カテゴリ", payload.category),
        inputBlock("status", "ステータス", payload.status),
        inputBlock("tools", "使用ツール", parseTools(payload.tools).join(", ")),
        inputBlock("summary", "概要", payload.summary, true),
        inputBlock("save_mode", "保存モード new / update / upsert", payload.save_mode || "upsert"),
        inputBlock("target_project_key", "更新対象 project_key", payload.project_key)
      ]
    }
  });
}

function viewValue(state, blockId) {
  const item = state?.values?.[blockId]?.[blockId];
  if (!item) return "";
  if (item.type === "static_select") return item.selected_option?.value || "";
  return item.value || "";
}

async function handleAction(payload) {
  const action = payload.actions?.[0];
  if (!action?.value) return;
  const client = getGitHubClient();
  const pending = await readJsonFile(client, pendingPath(action.value), null);
  if (!pending || pending.status !== "pending") {
    await postThread(payload.channel?.id, payload.message?.thread_ts || payload.message?.ts, "この確認は処理済み、または期限切れです。");
    return;
  }

  if (action.action_id === "knowledge_confirm_cancel") {
    await markPending(client, pending, "cancelled");
    await postThread(pending.channel, pending.thread_ts, "キャンセルしました。GitHub本保存・Google Sheets更新は行っていません。");
    return;
  }

  if (action.action_id === "knowledge_confirm_choose_existing") {
    await openChooseModal(payload.trigger_id, pending);
    return;
  }

  if (action.action_id === "knowledge_confirm_edit") {
    await openEditModal(payload.trigger_id, pending);
    return;
  }

  let overrides = {};
  if (action.action_id === "knowledge_confirm_new") {
    overrides = { save_mode: "new" };
  } else if (action.action_id === "knowledge_confirm_recommended_update") {
    const candidate = pending.candidates?.[0];
    if (!candidate) {
      overrides = { save_mode: "new" };
    } else {
      overrides = {
        save_mode: "update",
        knowledge_type: candidate.knowledge_type,
        project_key: candidate.project_key
      };
    }
  }

  const saved = await saveApprovedPending(pending, overrides);
  await markPending(client, pending, "saved", { result: saved.result });
  await postThread(pending.channel, pending.thread_ts, resultMessage(saved.result, saved.sheets));
}

async function handleViewSubmission(payload) {
  const client = getGitHubClient();
  const pending = await readJsonFile(client, pendingPath(payload.view.private_metadata), null);
  if (!pending || pending.status !== "pending") return;

  let overrides = {};
  if (payload.view.callback_id === "knowledge_choose_existing_submit") {
    const selected = viewValue(payload.view.state, "target");
    const [knowledgeType, projectKey] = selected.split("|");
    if (!knowledgeType || !projectKey || knowledgeType === "none") {
      await postThread(pending.channel, pending.thread_ts, "更新先が選択されなかったため保存しませんでした。");
      return;
    }
    overrides = {
      save_mode: "update",
      knowledge_type: knowledgeType,
      project_key: projectKey
    };
  } else if (payload.view.callback_id === "knowledge_edit_submit") {
    const targetProjectKey = viewValue(payload.view.state, "target_project_key");
    overrides = {
      title: viewValue(payload.view.state, "title"),
      project_key: targetProjectKey || viewValue(payload.view.state, "project_key"),
      knowledge_type: viewValue(payload.view.state, "knowledge_type"),
      category: viewValue(payload.view.state, "category"),
      status: viewValue(payload.view.state, "status"),
      tools: viewValue(payload.view.state, "tools"),
      summary: viewValue(payload.view.state, "summary"),
      save_mode: viewValue(payload.view.state, "save_mode") || "upsert"
    };
  }

  const saved = await saveApprovedPending(pending, overrides);
  await markPending(client, pending, "saved", { result: saved.result });
  await postThread(pending.channel, pending.thread_ts, resultMessage(saved.result, saved.sheets));
}

export default async (request, context) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  const rawBody = await request.text();
  const verified = verifySlackSignature({
    signingSecret: env("SLACK_SIGNING_SECRET"),
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    rawBody
  });
  if (!verified) {
    return jsonResponse(401, { error: "Invalid Slack signature." });
  }

  const params = new URLSearchParams(rawBody);
  if (params.has("payload")) {
    let payload;
    try {
      payload = JSON.parse(params.get("payload"));
    } catch {
      return jsonResponse(400, { error: "Invalid Slack payload." });
    }
    const work = payload.type === "view_submission"
      ? handleViewSubmission(payload)
      : handleAction(payload);
    if (context?.waitUntil) context.waitUntil(work);
    return payload.type === "view_submission" ? jsonResponse(200, { response_action: "clear" }) : jsonResponse(200, {});
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  if (body.type === "url_verification") {
    return jsonResponse(200, { challenge: body.challenge });
  }
  if (body.type === "event_callback") {
    const work = createPendingFromEvent(body);
    if (context?.waitUntil) context.waitUntil(work);
  }
  return jsonResponse(200, { ok: true });
};
