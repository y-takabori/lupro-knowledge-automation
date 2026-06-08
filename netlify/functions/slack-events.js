import {
  buildAutoKnowledgePayload,
  env,
  GitHubContentsClient,
  jsonResponse,
  saveKnowledgeToGitHub,
  verifySlackSignature
} from "./knowledge-archive-core.js";
import { syncKnowledgeToGoogleSheets } from "./google-sheets-sync.js";

function ack(body = { ok: true }) {
  return jsonResponse(200, body);
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

async function postChannelMessage(channel, threadTs, text) {
  await slackApi("chat.postMessage", {
    channel,
    thread_ts: threadTs,
    text,
    unfurl_links: false,
    unfurl_media: false
  }).catch(() => {});
}

async function getPermalink(channel, messageTs) {
  try {
    const data = await slackApi("chat.getPermalink", {
      channel,
      message_ts: messageTs
    });
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
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new Error("ファイル取得に失敗しました。Web貼り付け画面を使ってください。");
  }
  return {
    text: await response.text(),
    name: file.name || file.title || ""
  };
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

function eventMarkerPath(dedupeKey) {
  return `knowledge/.events/${dedupeKey}.json`;
}

async function isDuplicateEvent(dedupeKey) {
  const client = getGitHubClient();
  return Boolean(await client.getFile(eventMarkerPath(dedupeKey)));
}

async function markEventProcessed(dedupeKey, details) {
  const client = getGitHubClient();
  await client.putFile(
    eventMarkerPath(dedupeKey),
    `${JSON.stringify(details, null, 2)}\n`,
    `Mark Slack knowledge event ${dedupeKey} processed`
  );
}

function shouldIgnoreEvent(body, event) {
  if (!event || event.type !== "message") return true;
  if (event.subtype && event.subtype !== "file_share") return true;
  if (event.bot_id || event.bot_profile) return true;
  if (env("SLACK_BOT_USER_ID") && event.user === env("SLACK_BOT_USER_ID")) return true;
  const targetChannel = env("SLACK_KNOWLEDGE_CHANNEL_ID");
  if (targetChannel && event.channel !== targetChannel) return true;
  if (body.authorizations?.some((auth) => auth.user_id && auth.user_id === event.user && auth.is_bot)) return true;
  return false;
}

function successMessage(result, sheets, warning = "") {
  const rawUrl = result.raw_url || result.raw_json_url || result.raw_md_url || result.raw_txt_url;
  const sheetsText = sheets?.ok
    ? (sheets.url || "Sheets更新済み")
    : sheets?.skipped
      ? "Sheets未設定"
      : sheets?.message
        ? `Sheets更新失敗: ${sheets.message}`
        : "Sheets未更新";
  return [
    warning,
    "保存しました",
    `title: ${result.title}`,
    `knowledge_type: ${result.knowledge_type}`,
    `project_key: ${result.project_key}`,
    `index.md: ${result.index_url}`,
    `raw: ${rawUrl}`,
    `Google Sheets: ${sheetsText}`,
    `Web貼り付け画面: ${env("URL") || ""}/public/knowledge-ingest.html`
  ].filter(Boolean).join("\n");
}

function failureMessage(error) {
  return [
    "ナレッジ保存に失敗しました。",
    error.message || "不明なエラーです。",
    "GitHub/Slack/Google Sheetsの環境変数と権限を確認してください。",
    `長文の場合は ${env("URL") || ""}/public/knowledge-ingest.html から保存できます。`
  ].join("\n");
}

async function processSlackEvent(body) {
  const event = body.event;
  if (shouldIgnoreEvent(body, event)) return;

  const dedupeKey = body.event_id || event.client_msg_id || `${event.channel}-${event.ts}`;
  if (!dedupeKey) return;
  if (await isDuplicateEvent(dedupeKey)) return;

  let text = event.text || "";
  let fileName = "";
  if (Array.isArray(event.files) && event.files.length > 0) {
    try {
      const file = await fetchSlackFile(event.files[0]);
      text = file.text || text;
      fileName = file.name;
    } catch (error) {
      await postChannelMessage(event.channel, event.ts, `ファイル取得に失敗しました。Web貼り付け画面を使ってください。\n${error.message}`);
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

  let result;
  try {
    result = await saveKnowledgeToGitHub(payload);
  } catch (error) {
    await postChannelMessage(event.channel, event.ts, `GitHub保存に失敗しました。\n${failureMessage(error)}`);
    return;
  }

  let sheets = null;
  try {
    sheets = await syncKnowledgeToGoogleSheets(payload, result);
  } catch (error) {
    sheets = {
      ok: false,
      skipped: false,
      message: error.message
    };
  }

  await markEventProcessed(dedupeKey, {
    event_id: body.event_id || "",
    client_msg_id: event.client_msg_id || "",
    channel: event.channel,
    ts: event.ts,
    project_key: result.project_key,
    knowledge_type: result.knowledge_type,
    index_url: result.index_url
  });

  const warning = payload.json_parse_warning || "";
  const sheetsFailure = sheets?.ok || sheets?.skipped ? "" : "Google Sheets更新に失敗しましたが、GitHub保存は成功しました。";
  await postChannelMessage(event.channel, event.ts, successMessage(result, sheets, [warning, sheetsFailure].filter(Boolean).join("\n")));
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

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  if (body.type === "url_verification") {
    return jsonResponse(200, { challenge: body.challenge });
  }

  if (body.type !== "event_callback") {
    return ack();
  }

  const work = processSlackEvent(body);
  if (context?.waitUntil) {
    context.waitUntil(work);
  }
  return ack();
};
