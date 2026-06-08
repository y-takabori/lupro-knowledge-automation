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
  return slackApi("chat.postMessage", {
    channel,
    thread_ts: threadTs,
    text,
    blocks,
    unfurl_links: false,
    unfurl_media: false
  }).catch(() => ({}));
}

async function updateSlackMessage(channel, ts, text, blocks = null) {
  if (!channel || !ts) return null;
  return slackApi("chat.update", {
    channel,
    ts,
    text,
    blocks,
    unfurl_links: false,
    unfurl_media: false
  }).catch(() => null);
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

function similarityDetails(payload, entry) {
  if (payload.project_key && payload.project_key === entry.project_key) {
    return { score: 100, reason: "保存キーが一致" };
  }
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
  const score = overlap + titleHit + categoryHit;
  const reasons = [];
  if (titleHit) reasons.push("タイトル・本文が近い");
  if (categoryHit) reasons.push("カテゴリが近い");
  if (overlap && !titleHit) reasons.push("本文の語句が近い");
  return { score, reason: reasons.join(" / ") || "関連語句が近い" };
}

async function findSimilarKnowledge(client, payload) {
  const entries = await readJsonFile(client, "knowledge/index.json", []);
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      const details = similarityDetails(payload, entry);
      return { ...entry, score: details.score, similar_reason: details.reason };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function warningsText(warnings) {
  return Array.isArray(warnings) && warnings.length ? warnings.join(" / ") : "なし";
}

async function fetchSlackFileReference(reference) {
  if (!reference) return "";
  let url = reference;
  if (/^F[A-Z0-9]+$/.test(reference)) {
    const data = await slackApi("files.info", { file: reference });
    url = data.file?.url_private_download || data.file?.url_private;
  }
  if (!/^https:\/\/files\.slack\.com\//.test(url)) {
    throw new Error("SlackファイルIDまたはSlack private file URLを指定してください。");
  }
  const token = env("SLACK_BOT_TOKEN");
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Slackファイル取得に失敗しました。");
  return response.text();
}

async function postResponseUrl(responseUrl, text) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", text })
  }).catch(() => {});
}

function safeLog(message, details = {}) {
  console.info(message, JSON.stringify(details));
}

function candidateText(candidates) {
  if (!candidates.length) return "なし";
  return candidates
    .map((item, index) => [
      `${index + 1}. ${item.title || item.project_key}`,
      `   保存先: ${item.knowledge_type}/${item.project_key}`,
      `   類似理由: ${item.similar_reason || "関連語句が近い"}`
    ].join("\n"))
    .join("\n");
}

function recommendedText(candidates) {
  if (!candidates.length) return "新規作成";
  const first = candidates[0];
  return `${first.title || first.project_key}（${first.knowledge_type}/${first.project_key}）`;
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
        `*保存キー生成元:*\n${payload.project_key_source || "不明"}`,
        `*推定入力タイプ:*\n${inputLabels[payload.input_type] || payload.input_type}`,
        `*推定使用ツール:*\n${parseTools(payload.tools).join(", ") || "未取得"}`,
        `*公開時に注意が必要そうな情報:*\n${warningsText(payload.warnings)}`,
        `*類似ナレッジ候補:*\n${candidateText(pending.candidates || [])}`,
        `*おすすめ更新先:*\n${recommendedText(pending.candidates || [])}`,
        candidate
          ? "このボタンを押すと、上記の既存ナレッジに追記・更新します。"
          : "類似候補がないため、新規保存がおすすめです。",
        "",
        "*操作を選んでください:*",
        "新規保存: 新しいナレッジとして保存します",
        "候補1に追記: おすすめ更新先の既存ナレッジに追記します",
        "更新先を選ぶ: 別の既存ナレッジを選んで追記します",
        "内容を編集: タイトル・分類・保存先を直してから保存します",
        "キャンセル: 保存せず終了します",
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
          text: slackText(candidate ? "候補1に追記" : "候補なし"),
          style: candidate ? "primary" : undefined,
          action_id: "knowledge_confirm_recommended_update",
          value: pending.pending_key
        },
        {
          type: "button",
          text: slackText("更新先を選ぶ"),
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

function finishedBlocks(title, detail) {
  return [
    {
      type: "section",
      text: mrkdwn(`*${title}*\n${detail}`)
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
    `project_key_source: ${result.project_key_source || ""}`,
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

async function finishConfirmationCard(pending, title, detail) {
  await updateSlackMessage(
    pending.channel,
    pending.confirmation_message_ts,
    `${title}\n${detail}`,
    finishedBlocks(title, detail)
  );
}

async function createPendingFromEvent(body) {
  const event = body.event;
  if (shouldIgnoreEvent(body, event)) return;

  const dedupeKey = body.event_id || event.client_msg_id || `${event.channel}-${event.ts}`;
  const pendingKey = safePendingKey(`${event.channel}-${event.ts}`);
  const client = getGitHubClient();
  safeLog("slack_event_received", {
    event_id: body.event_id || "",
    event_type: event.type,
    channel: event.channel,
    has_files: Array.isArray(event.files) && event.files.length > 0
  });
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
  const confirmationMessage = await postThread(
    event.channel,
    event.ts,
    "ナレッジ候補を読み取りました。まだ保存していません。",
    confirmationBlocks(pending)
  );
  if (confirmationMessage?.ts) {
    await putJsonFile(client, pendingPath(pendingKey), {
      ...pending,
      confirmation_message_ts: confirmationMessage.ts
    }, `Store pending confirmation message ${pendingKey}`);
  }
}

async function openChooseModal(triggerId, pending) {
  const client = getGitHubClient();
  const entries = await readJsonFile(client, "knowledge/index.json", []);
  if (!Array.isArray(entries) || entries.length === 0) {
    await postThread(pending.channel, pending.thread_ts, "候補を取得できませんでした。knowledge/index.json が空、または取得できませんでした。");
    return;
  }
  const similarKeys = new Set((pending.candidates || []).map((entry) => `${entry.knowledge_type}|${entry.project_key}`));
  const similar = (pending.candidates || []).filter((entry) => entry.knowledge_type && entry.project_key);
  const recent = entries
    .filter((entry) => !similarKeys.has(`${entry.knowledge_type}|${entry.project_key}`))
    .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
  const options = [...similar, ...recent]
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
      title: slackText("更新先ナレッジを選択"),
      submit: slackText("このナレッジに追記する"),
      close: slackText("キャンセル"),
      blocks: [
        {
          type: "section",
          text: mrkdwn("この投稿を追記・更新する既存ナレッジを選んでください。")
        },
        {
          type: "input",
          block_id: "target",
          label: slackText("更新する既存ナレッジ"),
          element: {
            type: "static_select",
            action_id: "target",
            options
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
  safeLog("slack_interaction_received", {
    type: payload.type,
    action_id: action.action_id,
    channel: payload.channel?.id || "",
    user: payload.user?.id || ""
  });
  const client = getGitHubClient();
  const pending = await readJsonFile(client, pendingPath(action.value), null);
  if (!pending || pending.status !== "pending") {
    const status = pending?.status;
    const message = status === "cancelled"
      ? "この確認はすでにキャンセル済みです。保存したい場合は、もう一度ナレッジ本文を投稿してください。"
      : status === "saved"
        ? "この確認はすでに保存済みです。追加で保存したい場合は、もう一度ナレッジ本文を投稿してください。"
        : "この確認は期限切れ、または処理できない状態です。保存したい場合は、もう一度ナレッジ本文を投稿してください。";
    await postThread(payload.channel?.id, payload.message?.thread_ts || payload.message?.ts, message);
    return;
  }

  if (action.action_id === "knowledge_confirm_cancel") {
    await markPending(client, pending, "cancelled");
    const title = "キャンセルしました。";
    const detail = "GitHub本保存・Google Sheets更新は行っていません。保存したい場合は、もう一度ナレッジ本文を投稿してください。";
    await finishConfirmationCard(pending, title, detail);
    await postThread(pending.channel, pending.thread_ts, `${title}\n${detail}`);
    return;
  }

  if (action.action_id === "knowledge_confirm_choose_existing") {
    try {
      await openChooseModal(payload.trigger_id, pending);
    } catch (error) {
      await postThread(pending.channel, pending.thread_ts, `候補を取得できませんでした。\n${error.message}`);
    }
    return;
  }

  if (action.action_id === "knowledge_confirm_edit") {
    try {
      await openEditModal(payload.trigger_id, pending);
    } catch (error) {
      await postThread(pending.channel, pending.thread_ts, `編集モーダルを開けませんでした。\n${error.message}`);
    }
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

  try {
    const saved = await saveApprovedPending(pending, overrides);
    await markPending(client, pending, "saved", { result: saved.result });
    await finishConfirmationCard(
      pending,
      "保存済みです。",
      `GitHub本保存を完了しました。\n保存先: ${saved.result.knowledge_type}/${saved.result.project_key}`
    );
    await postThread(pending.channel, pending.thread_ts, resultMessage(saved.result, saved.sheets));
  } catch (error) {
    await postThread(pending.channel, pending.thread_ts, `保存に失敗しました。\n${error.message}`);
  }
}

function modalValue(state, blockId, actionId = blockId) {
  const item = state?.values?.[blockId]?.[actionId];
  if (!item) return "";
  if (item.type === "static_select") return item.selected_option?.value || "";
  return item.value || "";
}

function modalSuccessMessage(result, sheets) {
  const sheetsText = sheets?.ok
    ? (sheets.url || "Sheets更新済み")
    : sheets?.skipped
      ? "Sheets未設定"
      : sheets?.message
        ? `Sheets更新失敗: ${sheets.message}`
        : "Sheets未更新";
  return [
    "保存しました",
    `title: ${result.title}`,
    `knowledge_type: ${result.knowledge_type}`,
    `project_key: ${result.project_key}`,
    `save_mode: ${result.save_mode}`,
    `index.md: ${result.index_url}`,
    `raw: ${result.raw_url || result.raw_json_url || result.raw_md_url || result.raw_txt_url}`,
    `Google Sheets: ${sheetsText}`,
    `Web貼り付け画面: ${env("URL") || ""}/public/knowledge-ingest.html`
  ].join("\n");
}

async function handleLegacyKnowledgeModal(payload) {
  const privateMetadata = JSON.parse(payload.view.private_metadata || "{}");
  const state = payload.view.state;
  const fileReference = modalValue(state, "file_reference", "file_reference");
  let body = modalValue(state, "body_short", "body_short");
  if (fileReference) body = await fetchSlackFileReference(fileReference);
  const savePayload = {
    title: modalValue(state, "title", "title"),
    knowledge_type: modalValue(state, "knowledge_type", "knowledge_type"),
    project_key: modalValue(state, "project_key", "project_key"),
    category: modalValue(state, "category", "category"),
    status: modalValue(state, "status", "status"),
    tools: modalValue(state, "tools", "tools"),
    summary: modalValue(state, "summary", "summary"),
    input_type: modalValue(state, "input_type", "input_type"),
    save_mode: modalValue(state, "save_mode", "save_mode"),
    body,
    source: "slack"
  };
  try {
    const result = await saveKnowledgeToGitHub(savePayload);
    let sheets;
    try {
      sheets = await syncKnowledgeToGoogleSheets(savePayload, result);
    } catch (error) {
      sheets = { ok: false, skipped: false, message: error.message };
    }
    await postResponseUrl(privateMetadata.response_url || "", modalSuccessMessage(result, sheets));
  } catch (error) {
    await postResponseUrl(privateMetadata.response_url || "", `保存に失敗しました: ${error.message}`);
  }
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

  try {
    const saved = await saveApprovedPending(pending, overrides);
    await markPending(client, pending, "saved", { result: saved.result });
    await finishConfirmationCard(
      pending,
      "保存済みです。",
      `GitHub本保存を完了しました。\n保存先: ${saved.result.knowledge_type}/${saved.result.project_key}`
    );
    await postThread(pending.channel, pending.thread_ts, resultMessage(saved.result, saved.sheets));
  } catch (error) {
    await postThread(pending.channel, pending.thread_ts, `保存に失敗しました。\n${error.message}`);
  }
}

export async function handleSlackInteractivity(payload, context) {
  if (payload.type === "view_submission") {
    const work = payload.view?.callback_id === "knowledge_save_modal"
      ? handleLegacyKnowledgeModal(payload)
      : handleViewSubmission(payload);
    if (context?.waitUntil) context.waitUntil(work);
    return jsonResponse(200, { response_action: "clear" });
  }

  const actionId = payload.actions?.[0]?.action_id || "";
  if (actionId === "knowledge_confirm_choose_existing" || actionId === "knowledge_confirm_edit") {
    await handleAction(payload);
    return jsonResponse(200, {});
  }

  const work = handleAction(payload);
  if (context?.waitUntil) context.waitUntil(work);
  return jsonResponse(200, {});
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
    return handleSlackInteractivity(payload, context);
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
