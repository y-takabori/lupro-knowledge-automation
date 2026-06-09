import {
  buildAutoKnowledgePayload,
  env,
  GitHubContentsClient,
  jsonResponse,
  deleteKnowledgeFromGitHub,
  knowledgeTypeFolders,
  parseTools,
  saveKnowledgeToGitHub,
  verifySlackSignature
} from "./knowledge-archive-core.js";
import {
  cleanupTestKnowledgeInGoogleSheets,
  findKnowledgeInGoogleSheets,
  getTestKnowledgeCleanupPreview,
  syncKnowledgeDeletionToGoogleSheets,
  syncKnowledgeToGoogleSheets,
  syncSheetsOnlyKnowledgeDeletion
} from "./google-sheets-sync.js";

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

async function postResponseUrl(responseUrl, text, blocks = null, extra = {}) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: "ephemeral",
      text,
      ...(blocks ? { blocks } : {}),
      ...extra
    })
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

function inputNoteText(payload) {
  const notes = [];
  if (payload.json_parse_warning) notes.push(payload.json_parse_warning);
  if (String(payload.body || "").length > 2500) {
    notes.push("長文の場合は .json / .txt / .md ファイル添付での保存を推奨します。");
  }
  if (payload.supplemental_text) {
    notes.push("Slack本文の補足コメントも保存します。");
  }
  return notes.length ? notes.join("\n") : "なし";
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
        `*入力メモ:*\n${inputNoteText(payload)}`,
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
    ? `成功\n更新シート: ${sheets.knowledge_sheet || "ナレッジ一覧"} / ${sheets.events_sheet || "更新履歴"}`
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

function improvedResultMessage(result, sheets, pendingTitle = "") {
  const sheetsText = sheets?.ok
    ? "成功"
    : sheets?.skipped
      ? "未設定"
      : `失敗${sheets?.message ? `: ${sheets.message}` : ""}`;
  const rawUrl = result.raw_url || result.raw_json_url || result.raw_md_url || result.raw_txt_url;
  const metadataUrl = result.metadata_url || "";
  if (result.is_update || result.save_mode === "update") {
    return [
      "既存ナレッジに追記しました",
      `更新先タイトル: ${result.title}`,
      `project_key: ${result.project_key}`,
      `save_mode: update`,
      `今回の追記タイトル: ${pendingTitle || result.title}`,
      `GitHub保存: 成功`,
      `GitHub index.md URL: ${result.index_url}`,
      `追記ファイルURL: ${result.update_url || result.update_json_url || ""}`,
      `raw: ${rawUrl}`,
      `Google Sheets: ${sheetsText}`,
      `Web貼り付け画面: ${env("URL") || ""}/public/knowledge-ingest.html`
    ].join("\n");
  }
  return [
    "新規保存しました",
    `title: ${result.title}`,
    `knowledge_type: ${result.knowledge_type}`,
    `project_key: ${result.project_key}`,
    `GitHub保存: 成功`,
    `GitHub index.md URL: ${result.index_url}`,
    `raw: ${rawUrl}`,
    `metadata.json URL: ${metadataUrl}`,
    `Google Sheets: ${sheetsText}`,
    `Web貼り付け画面: ${env("URL") || ""}/public/knowledge-ingest.html`
  ].join("\n");
}

function sheetsStatusText(sheets) {
  if (sheets?.ok) {
    return `成功\n更新シート: ${sheets.knowledge_sheet || "ナレッジ一覧"} / ${sheets.events_sheet || "更新履歴"}`;
  }
  if (sheets?.skipped) return "未設定";
  return `失敗${sheets?.message ? `: ${sheets.message}` : ""}`;
}

function improvedResultMessageV2(result, sheets, pendingTitle = "") {
  const sheetsText = sheetsStatusText(sheets);
  const rawUrl = result.raw_url || result.raw_json_url || result.raw_md_url || result.raw_txt_url;
  const metadataUrl = result.metadata_url || "";
  if (result.is_update || result.save_mode === "update") {
    return [
      "既存ナレッジに追記しました",
      `更新先タイトル: ${result.title}`,
      `project_key: ${result.project_key}`,
      "save_mode: update",
      `今回の追記タイトル: ${pendingTitle || result.title}`,
      "GitHub保存: 成功",
      `GitHub index.md URL: ${result.index_url}`,
      `追記ファイルURL: ${result.update_url || result.update_json_url || ""}`,
      `raw: ${rawUrl}`,
      `Google Sheets: ${sheetsText}`,
      `Web貼り付け画面: ${env("URL") || ""}/public/knowledge-ingest.html`
    ].join("\n");
  }
  return [
    "新規保存しました",
    `title: ${result.title}`,
    `knowledge_type: ${result.knowledge_type}`,
    `project_key: ${result.project_key}`,
    "GitHub保存: 成功",
    `GitHub index.md URL: ${result.index_url}`,
    `raw: ${rawUrl}`,
    `metadata.json URL: ${metadataUrl}`,
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

function parseDeleteCommandText(text) {
  const value = String(text || "").trim();
  if (!value) return { error: "削除対象を指定してください。例: /knowledge-delete notes/slack" };
  const first = value.split(/\s+/)[0] || "";
  if (first.includes("/")) {
    const [knowledgeType, projectKey] = first.split("/");
    return { knowledge_type: knowledgeType, project_key: projectKey };
  }
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { knowledge_type: parts[0], project_key: parts[1] };
  }
  return { project_key: first };
}

async function findKnowledgeForDelete(client, parsed) {
  const entries = await readJsonFile(client, "knowledge/index.json", []);
  if (!Array.isArray(entries)) return { error: "knowledge/index.json を読み取れませんでした。" };
  const matches = entries.filter((entry) => {
    if (parsed.knowledge_type && entry.knowledge_type !== parsed.knowledge_type) return false;
    return entry.project_key === parsed.project_key;
  });
  if (matches.length > 1) {
    return { error: `project_key が複数見つかりました。knowledge_type も指定してください: ${matches.map((item) => `${item.knowledge_type}/${item.project_key}`).join(", ")}` };
  }
  if (matches.length === 0) {
    const deletedTypes = parsed.knowledge_type
      ? [parsed.knowledge_type]
      : Object.keys(knowledgeTypeFolders);
    const deletedMatches = [];
    for (const knowledgeType of deletedTypes) {
      const folder = knowledgeTypeFolders[knowledgeType];
      if (!folder) continue;
      const deleted = await readJsonFile(client, `knowledge/.deleted/${folder}/${parsed.project_key}/metadata.json`, null);
      if (deleted?.project_key) deletedMatches.push({ knowledgeType, folder, deleted });
    }
    if (deletedMatches.length > 1) {
      return { error: `削除済みproject_keyが複数見つかりました。knowledge_type も指定してください: ${deletedMatches.map((item) => `${item.knowledgeType}/${parsed.project_key}`).join(", ")}` };
    }
    if (deletedMatches.length === 1) {
      const { knowledgeType, deleted } = deletedMatches[0];
      return {
        entry: {
          title: deleted.title || parsed.project_key,
          project_key: parsed.project_key,
          knowledge_type: knowledgeType,
          path: deleted.original_path || deleted.path || `knowledge/${knowledgeType}/${parsed.project_key}/index.md`,
          already_deleted: true
        }
      };
    }
  }
  if (matches.length === 0) return { error: "指定されたナレッジが見つかりませんでした。" };
  return { entry: matches[0] };
}

function deletePendingKey(channel, user, knowledgeType, projectKey) {
  return safePendingKey(`delete-${channel}-${user}-${knowledgeType}-${projectKey}`);
}

function parseDeleteCommandTextV2(text) {
  const value = String(text || "").trim();
  if (!value) return { error: "削除対象を指定してください。例: /knowledge-delete notes/slack" };
  const first = value.split(/\s+/)[0] || "";
  if (first === "cleanup-test") return { cleanup_test: true };
  if (first.includes("/")) {
    const [knowledgeType, projectKey] = first.split("/");
    return { knowledge_type: knowledgeType, project_key: projectKey };
  }
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { knowledge_type: parts[0], project_key: parts[1] };
  }
  return { project_key: first };
}

function sheetEntryFromMatch(match, parsed) {
  const entry = match.entry || {};
  return {
    title: entry.title || parsed.project_key,
    project_key: entry.project_key || parsed.project_key,
    knowledge_type: parsed.knowledge_type || entry.knowledge_type || "notes",
    category: entry.category || "",
    status: entry.status || "",
    summary: entry.summary || "",
    source: entry.source || "google_sheets",
    input_type: entry.input_type || "",
    raw_url: entry.raw_url || "",
    metadata_url: entry.metadata_url || "",
    github_index_url: entry.github_index_url || "",
    slack_user: entry.slack_user || "",
    slack_channel: entry.slack_channel || "",
    slack_ts: entry.slack_ts || "",
    sheets_only: true,
    sheets_row_number: match.row_number
  };
}

async function findKnowledgeForDeleteV2(client, parsed) {
  const entries = await readJsonFile(client, "knowledge/index.json", []);
  if (!Array.isArray(entries)) return { error: "knowledge/index.json を読み取れませんでした。" };
  const matches = entries.filter((entry) => {
    if (parsed.knowledge_type && entry.knowledge_type !== parsed.knowledge_type) return false;
    return entry.project_key === parsed.project_key;
  });
  if (matches.length > 1) {
    return { error: `project_key が複数見つかりました。knowledge_type も指定してください: ${matches.map((item) => `${item.knowledge_type}/${item.project_key}`).join(", ")}` };
  }
  if (matches.length === 1) return { entry: matches[0] };

  const deletedTypes = parsed.knowledge_type ? [parsed.knowledge_type] : Object.keys(knowledgeTypeFolders);
  const deletedMatches = [];
  for (const knowledgeType of deletedTypes) {
    const folder = knowledgeTypeFolders[knowledgeType];
    if (!folder) continue;
    const deleted = await readJsonFile(client, `knowledge/.deleted/${folder}/${parsed.project_key}/metadata.json`, null);
    if (deleted?.project_key) deletedMatches.push({ knowledgeType, folder, deleted });
  }
  if (deletedMatches.length > 1) {
    return { error: `削除済みproject_keyが複数見つかりました。knowledge_type も指定してください: ${deletedMatches.map((item) => `${item.knowledgeType}/${parsed.project_key}`).join(", ")}` };
  }
  if (deletedMatches.length === 1) {
    const { knowledgeType, deleted } = deletedMatches[0];
    return {
      entry: {
        title: deleted.title || parsed.project_key,
        project_key: parsed.project_key,
        knowledge_type: knowledgeType,
        path: deleted.original_path || deleted.path || `knowledge/${knowledgeType}/${parsed.project_key}/index.md`,
        already_deleted: true
      }
    };
  }

  const sheets = await findKnowledgeInGoogleSheets(parsed);
  if (sheets.ok && Array.isArray(sheets.matches) && sheets.matches.length > 0) {
    if (sheets.matches.length > 1) {
      return { error: `Google Sheets上にproject_keyが複数見つかりました。knowledge_type も指定してください: ${sheets.matches.map((item) => `${item.entry.knowledge_type || "unknown"}/${item.entry.project_key}`).join(", ")}` };
    }
    return { entry: sheetEntryFromMatch(sheets.matches[0], parsed) };
  }
  if (sheets.skipped) {
    return { error: `指定されたナレッジはGitHub上に見つかりませんでした。Google Sheets検索も未設定のため実行できません: ${sheets.message}` };
  }
  return { error: "指定されたナレッジがGitHub / Google Sheetsのどちらにも見つかりませんでした。" };
}

function deleteConfirmationBlocks(pending) {
  const entry = pending.delete_entry;
  if (entry.sheets_only) {
    return [
      {
        type: "section",
        text: mrkdwn([
          "*GitHub上のナレッジは見つかりませんでしたが、Google Sheets上に該当行が見つかりました。*",
          "",
          "*削除対象:*",
          `project_key: ${entry.project_key}`,
          `title: ${entry.title || entry.project_key}`,
          `knowledge_type: ${entry.knowledge_type}`,
          "削除対象: Google Sheetsのみ",
          "",
          "このSheets行を削除しますか？",
          testCleanupProjectKey(entry.project_key)
            ? "このproject_keyはテストクリーンアップ対象のため、更新履歴の既存行も完全削除します。"
            : "通常運用の削除として、更新履歴には deleted イベントを追加します。"
        ].join("\n"))
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: slackText("Sheetsから削除する"),
            style: "danger",
            action_id: "knowledge_delete_confirm",
            value: pending.pending_key
          },
          {
            type: "button",
            text: slackText("キャンセル"),
            action_id: "knowledge_delete_cancel",
            value: pending.pending_key
          }
        ]
      }
    ];
  }
  return [
    {
      type: "section",
      text: mrkdwn([
        "*ナレッジ削除の確認です。まだ削除していません。*",
        "",
        `*タイトル:*\n${entry.title || entry.project_key}`,
        `*project_key:*\n${entry.project_key}`,
        `*knowledge_type:*\n${entry.knowledge_type}`,
        `*GitHub保存先:*\n${entry.path || `knowledge/${entry.knowledge_type}/${entry.project_key}/index.md`}`,
        "*Google Sheets反映予定:*\nナレッジ一覧の該当行を削除し、更新履歴に deleted イベントを追加します。",
        "",
        "削除する場合だけ、下の「削除する」を押してください。"
      ].join("\n"))
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: slackText("削除する"),
          style: "danger",
          action_id: "knowledge_delete_confirm",
          value: pending.pending_key
        },
        {
          type: "button",
          text: slackText("キャンセル"),
          action_id: "knowledge_delete_cancel",
          value: pending.pending_key
        }
      ]
    }
  ];
}

function testCleanupProjectKey(projectKey) {
  return new Set([
    "google-sheets",
    "google-sheets-2",
    "google-sheets-3",
    "slack",
    "20260609-0758-12345b5e",
    "test-knowledge"
  ]).has(projectKey);
}

function cleanupPendingKey(channel, user) {
  return safePendingKey(`cleanup-test-${channel}-${user}`);
}

function cleanupConfirmationBlocks(pending) {
  const preview = pending.cleanup_preview || {};
  const projectKeys = preview.project_keys || [];
  return [
    {
      type: "section",
      text: mrkdwn([
        "*テストナレッジのGoogle Sheets一括クリーンアップ確認です。まだ削除していません。*",
        "",
        "*削除予定project_key:*",
        projectKeys.map((key) => `- ${key}`).join("\n"),
        "",
        `ナレッジ一覧から削除予定: ${preview.knowledge_count ?? 0}行`,
        `更新履歴から削除予定: ${preview.history_count ?? 0}行`,
        "GitHub: 対象なし / 削除済みの想定",
        "",
        "実行する場合だけ、下の「実行する」を押してください。"
      ].join("\n"))
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: slackText("実行する"),
          style: "danger",
          action_id: "knowledge_cleanup_test_confirm",
          value: pending.pending_key
        },
        {
          type: "button",
          text: slackText("キャンセル"),
          action_id: "knowledge_cleanup_test_cancel",
          value: pending.pending_key
        }
      ]
    }
  ];
}

function deleteResultMessage(result, sheets) {
  return [
    "削除しました。",
    `title: ${result.title}`,
    `knowledge_type: ${result.knowledge_type}`,
    `project_key: ${result.project_key}`,
    "GitHub: 削除成功",
    `Google Sheets: ${sheetsStatusText(sheets)}`
  ].join("\n");
}

async function createDeletePendingFromCommand(params) {
  const responseUrl = params.get("response_url") || "";
  const channel = params.get("channel_id") || "";
  const user = params.get("user_id") || "";
  const parsed = parseDeleteCommandTextV2(params.get("text") || "");
  if (parsed.error) {
    await postResponseUrl(responseUrl, parsed.error);
    return;
  }
  const client = getGitHubClient();
  if (parsed.cleanup_test) {
    const preview = await getTestKnowledgeCleanupPreview();
    if (preview.skipped) {
      await postResponseUrl(responseUrl, `Google Sheets連携が未設定のため、テストクリーンアップ件数を確認できません: ${preview.message}`);
      return;
    }
    const pending = {
      pending_key: cleanupPendingKey(channel, user),
      status: "cleanup_test_pending",
      created_at: new Date().toISOString(),
      channel,
      user,
      response_url: responseUrl,
      cleanup_preview: preview
    };
    await putJsonFile(client, pendingPath(pending.pending_key), pending, "Create pending test knowledge cleanup");
    await postResponseUrl(
      responseUrl,
      "テストナレッジのGoogle Sheets一括クリーンアップ確認です。",
      cleanupConfirmationBlocks(pending),
      { replace_original: true }
    );
    return;
  }
  const found = await findKnowledgeForDeleteV2(client, parsed);
  if (found.error) {
    await postResponseUrl(responseUrl, found.error);
    return;
  }
  const entry = found.entry;
  const pending = {
    pending_key: deletePendingKey(channel, user, entry.knowledge_type, entry.project_key),
    status: "delete_pending",
    created_at: new Date().toISOString(),
    channel,
    user,
    response_url: responseUrl,
    delete_entry: entry
  };
  await putJsonFile(client, pendingPath(pending.pending_key), pending, `Create pending knowledge deletion ${entry.knowledge_type}/${entry.project_key}`);
  await postResponseUrl(
    responseUrl,
    `削除確認: ${entry.knowledge_type}/${entry.project_key}`,
    deleteConfirmationBlocks(pending),
    { replace_original: true }
  );
}

async function handleDeleteAction(payload) {
  const action = payload.actions?.[0];
  const pendingKey = action?.value || "";
  const client = getGitHubClient();
  const pending = await readJsonFile(client, pendingPath(pendingKey), null);
  if (!pending || pending.status !== "delete_pending") {
    await postResponseUrl(payload.response_url || "", "この削除確認は処理済み、または期限切れです。削除したい場合は、もう一度 /knowledge-delete を実行してください。");
    return;
  }

  if (action.action_id === "knowledge_delete_cancel") {
    await putJsonFile(client, pendingPath(pendingKey), {
      ...pending,
      status: "cancelled",
      updated_at: new Date().toISOString()
    }, `Cancel pending knowledge deletion ${pendingKey}`);
    await postResponseUrl(
      payload.response_url || pending.response_url || "",
      "削除をキャンセルしました。\nGitHub削除・Google Sheets更新は行っていません。",
      finishedBlocks("削除をキャンセルしました。", "GitHub削除・Google Sheets更新は行っていません。"),
      { replace_original: true }
    );
    return;
  }

  try {
    const entry = pending.delete_entry;
    const result = await deleteKnowledgeFromGitHub({
      knowledge_type: entry.knowledge_type,
      project_key: entry.project_key,
      source: "slack"
    });
    let sheets;
    try {
      sheets = await syncKnowledgeDeletionToGoogleSheets({
        ...entry,
        source: "slack",
        slack_user: payload.user?.id || pending.user || "",
        slack_channel: payload.channel?.id || pending.channel || "",
        note: "slack knowledge deletion"
      }, result);
    } catch (error) {
      sheets = { ok: false, skipped: false, message: error.message };
    }
    await putJsonFile(client, pendingPath(pendingKey), {
      ...pending,
      status: "deleted",
      updated_at: new Date().toISOString(),
      result
    }, `Mark pending knowledge deletion ${pendingKey} deleted`);
    await postResponseUrl(
      payload.response_url || pending.response_url || "",
      deleteResultMessage(result, sheets),
      finishedBlocks("削除しました。", deleteResultMessage(result, sheets)),
      { replace_original: true }
    );
  } catch (error) {
    await postResponseUrl(payload.response_url || pending.response_url || "", `削除に失敗しました。\n${error.message}`);
  }
}

function sheetsOnlyDeleteResultMessage(result, sheets) {
  return [
    testCleanupProjectKey(result.project_key)
      ? "Google Sheetsのテストデータを削除しました。"
      : "Google Sheetsのナレッジ行を削除しました。",
    `title: ${result.title}`,
    `knowledge_type: ${result.knowledge_type}`,
    `project_key: ${result.project_key}`,
    `ナレッジ一覧: ${sheets?.knowledge_rows_deleted ?? 0}行削除`,
    sheets?.delete_history
      ? `更新履歴: ${sheets?.history_rows_deleted ?? 0}行削除`
      : `更新履歴: deletedイベント追加${sheets?.deleted_event_added ? "済み" : "なし"}`,
    "GitHub: 対象なし / 削除済み"
  ].join("\n");
}

async function handleDeleteActionV2(payload) {
  const action = payload.actions?.[0];
  const pendingKey = action?.value || "";
  const client = getGitHubClient();
  const pending = await readJsonFile(client, pendingPath(pendingKey), null);
  if (!pending || pending.status !== "delete_pending") {
    await postResponseUrl(payload.response_url || "", "この削除確認は処理済み、または期限切れです。削除したい場合は、もう一度 /knowledge-delete を実行してください。");
    return;
  }

  if (action.action_id === "knowledge_delete_cancel") {
    await putJsonFile(client, pendingPath(pendingKey), {
      ...pending,
      status: "cancelled",
      updated_at: new Date().toISOString()
    }, `Cancel pending knowledge deletion ${pendingKey}`);
    await postResponseUrl(
      payload.response_url || pending.response_url || "",
      "削除をキャンセルしました。\nGitHub削除・Google Sheets更新は行っていません。",
      finishedBlocks("削除をキャンセルしました。", "GitHub削除・Google Sheets更新は行っていません。"),
      { replace_original: true }
    );
    return;
  }

  try {
    const entry = pending.delete_entry;
    let result;
    let sheets;
    if (entry.sheets_only) {
      sheets = await syncSheetsOnlyKnowledgeDeletion({
        ...entry,
        source: "slack",
        slack_user: payload.user?.id || pending.user || "",
        slack_channel: payload.channel?.id || pending.channel || "",
        note: testCleanupProjectKey(entry.project_key)
          ? "test knowledge cleanup hard delete"
          : "sheets only knowledge deletion"
      }, {
        deleteHistory: testCleanupProjectKey(entry.project_key)
      });
      result = {
        title: entry.title || entry.project_key,
        knowledge_type: entry.knowledge_type,
        project_key: entry.project_key,
        source: "slack",
        sheets_only: true
      };
    } else {
      result = await deleteKnowledgeFromGitHub({
        knowledge_type: entry.knowledge_type,
        project_key: entry.project_key,
        source: "slack"
      });
      try {
        sheets = await syncKnowledgeDeletionToGoogleSheets({
          ...entry,
          source: "slack",
          slack_user: payload.user?.id || pending.user || "",
          slack_channel: payload.channel?.id || pending.channel || "",
          note: "slack knowledge deletion"
        }, result);
      } catch (error) {
        sheets = { ok: false, skipped: false, message: error.message };
      }
    }

    await putJsonFile(client, pendingPath(pendingKey), {
      ...pending,
      status: "deleted",
      updated_at: new Date().toISOString(),
      result
    }, `Mark pending knowledge deletion ${pendingKey} deleted`);
    const message = entry.sheets_only
      ? sheetsOnlyDeleteResultMessage(result, sheets)
      : deleteResultMessage(result, sheets);
    await postResponseUrl(
      payload.response_url || pending.response_url || "",
      message,
      finishedBlocks(entry.sheets_only ? "Google Sheetsのデータを削除しました。" : "削除しました。", message),
      { replace_original: true }
    );
  } catch (error) {
    await postResponseUrl(payload.response_url || pending.response_url || "", `削除に失敗しました。\n${error.message}`);
  }
}

async function handleCleanupTestAction(payload) {
  const action = payload.actions?.[0];
  const pendingKey = action?.value || "";
  const client = getGitHubClient();
  const pending = await readJsonFile(client, pendingPath(pendingKey), null);
  if (!pending || pending.status !== "cleanup_test_pending") {
    await postResponseUrl(payload.response_url || "", "このクリーンアップ確認は処理済み、または期限切れです。もう一度 /knowledge-delete cleanup-test を実行してください。");
    return;
  }
  if (action.action_id === "knowledge_cleanup_test_cancel") {
    await putJsonFile(client, pendingPath(pendingKey), {
      ...pending,
      status: "cancelled",
      updated_at: new Date().toISOString()
    }, `Cancel pending test knowledge cleanup ${pendingKey}`);
    await postResponseUrl(
      payload.response_url || pending.response_url || "",
      "テストクリーンアップをキャンセルしました。\nGoogle Sheets更新は行っていません。",
      finishedBlocks("テストクリーンアップをキャンセルしました。", "Google Sheets更新は行っていません。"),
      { replace_original: true }
    );
    return;
  }

  try {
    const sheets = await cleanupTestKnowledgeInGoogleSheets(pending.cleanup_preview?.project_keys);
    await putJsonFile(client, pendingPath(pendingKey), {
      ...pending,
      status: "cleaned",
      updated_at: new Date().toISOString(),
      result: sheets
    }, `Mark pending test knowledge cleanup ${pendingKey} cleaned`);
    const message = [
      "Google Sheetsのテストデータを削除しました。",
      `ナレッジ一覧: ${sheets.knowledge_rows_deleted ?? 0}行削除`,
      `更新履歴: ${sheets.history_rows_deleted ?? 0}行削除`,
      "GitHub: 対象なし / 削除済み"
    ].join("\n");
    await postResponseUrl(
      payload.response_url || pending.response_url || "",
      message,
      finishedBlocks("Google Sheetsのテストデータを削除しました。", message),
      { replace_original: true }
    );
  } catch (error) {
    await postResponseUrl(payload.response_url || pending.response_url || "", `テストクリーンアップに失敗しました。\n${error.message}`);
  }
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
  let supplementalText = "";
  let fileName = "";
  if (Array.isArray(event.files) && event.files.length > 0) {
    try {
      const file = await fetchSlackFile(event.files[0]);
      supplementalText = event.text || "";
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
    supplementalText,
    source: "slack_event",
    slack: {
      channel: event.channel,
      ts: event.ts,
      user: event.user || "",
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
    await postThread(pending.channel, pending.thread_ts, improvedResultMessageV2(saved.result, saved.sheets, pending.payload.title));
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
    await postThread(pending.channel, pending.thread_ts, improvedResultMessageV2(saved.result, saved.sheets, pending.payload.title));
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
  if (actionId === "knowledge_cleanup_test_confirm" || actionId === "knowledge_cleanup_test_cancel") {
    const work = handleCleanupTestAction(payload);
    if (context?.waitUntil) context.waitUntil(work);
    return jsonResponse(200, {});
  }
  if (actionId === "knowledge_delete_confirm" || actionId === "knowledge_delete_cancel") {
    const work = handleDeleteActionV2(payload);
    if (context?.waitUntil) context.waitUntil(work);
    return jsonResponse(200, {});
  }
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
  if (params.has("command")) {
    if (params.get("command") === "/knowledge-delete") {
      const work = createDeletePendingFromCommand(params);
      if (context?.waitUntil) context.waitUntil(work);
      return jsonResponse(200, {
        response_type: "ephemeral",
        text: "削除候補を確認しています。確認カードを表示します。"
      });
    }
    return jsonResponse(200, {
      response_type: "ephemeral",
      text: "このSlash commandは slack-events では処理していません。"
    });
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
