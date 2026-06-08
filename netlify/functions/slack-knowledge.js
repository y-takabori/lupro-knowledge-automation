import {
  env,
  jsonResponse,
  knowledgeTypeFolders,
  saveKnowledgeToGitHub,
  verifySlackSignature
} from "./knowledge-archive-core.js";

const statusOptions = ["draft", "saved", "active", "article_candidate", "published", "archived"];
const inputTypeOptions = ["markdown", "json", "plain_text", "url"];
const saveModeOptions = ["new", "update", "upsert"];

function slackText(text) {
  return { type: "plain_text", text, emoji: false };
}

function option(value, label = value) {
  return {
    text: slackText(label),
    value
  };
}

async function slackApi(method, body) {
  const token = env("SLACK_BOT_TOKEN");
  if (!token) throw new Error("Missing SLACK_BOT_TOKEN.");
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

function buildModal(privateMetadata = {}) {
  const initialBody = privateMetadata.body_short || "";
  return {
    type: "modal",
    callback_id: "knowledge_save_modal",
    private_metadata: JSON.stringify(privateMetadata),
    title: slackText("LUPRO Knowledge"),
    submit: slackText("保存"),
    close: slackText("キャンセル"),
    blocks: [
      inputBlock("title", "title", "タイトル", "plain_text_input"),
      {
        type: "input",
        block_id: "knowledge_type",
        label: slackText("ナレッジ種別"),
        element: {
          type: "static_select",
          action_id: "knowledge_type",
          options: Object.keys(knowledgeTypeFolders).map((type) => option(type))
        }
      },
      inputBlock("project_key", "project_key", "保存キー", "plain_text_input", "invoice-ai-assistant"),
      inputBlock("category", "category", "カテゴリ", "plain_text_input", "AI業務効率化"),
      {
        type: "input",
        block_id: "status",
        label: slackText("ステータス"),
        element: {
          type: "static_select",
          action_id: "status",
          options: statusOptions.map((status) => option(status))
        }
      },
      inputBlock("tools", "tools", "使用ツール。カンマ区切り", "plain_text_input", "ChatGPT, Codex"),
      inputBlock("summary", "summary", "概要", "plain_text_input"),
      {
        type: "input",
        block_id: "input_type",
        label: slackText("入力タイプ"),
        element: {
          type: "static_select",
          action_id: "input_type",
          options: inputTypeOptions.map((type) => option(type))
        }
      },
      inputBlock("body_short", "body_short", "短めの本文・メモ", "plain_text_input", "", true, initialBody),
      inputBlock("file_reference", "file_reference", "SlackファイルURLまたはファイルID", "plain_text_input", "任意。長文ファイル用", true),
      {
        type: "input",
        block_id: "save_mode",
        label: slackText("保存モード"),
        element: {
          type: "static_select",
          action_id: "save_mode",
          initial_option: option("upsert"),
          options: saveModeOptions.map((mode) => option(mode))
        }
      }
    ]
  };
}

function inputBlock(blockId, actionId, label, type, placeholder = "", optional = false, initialValue = "") {
  const element = {
    type,
    action_id: actionId
  };
  if (placeholder) element.placeholder = slackText(placeholder);
  if (initialValue) element.initial_value = initialValue.slice(0, 2900);
  if (type === "plain_text_input" && (blockId === "summary" || blockId === "body_short")) {
    element.multiline = true;
  }
  return {
    type: "input",
    block_id: blockId,
    optional,
    label: slackText(label),
    element
  };
}

function getValue(state, blockId, actionId) {
  const item = state?.values?.[blockId]?.[actionId];
  if (!item) return "";
  if (item.type === "static_select") return item.selected_option?.value || "";
  return item.value || "";
}

async function fetchSlackFile(reference) {
  if (!reference) return "";
  const token = env("SLACK_BOT_TOKEN");
  if (!token) throw new Error("Missing SLACK_BOT_TOKEN.");
  let url = reference;
  if (/^F[A-Z0-9]+$/.test(reference)) {
    const data = await slackApi("files.info", { file: reference });
    url = data.file?.url_private_download || data.file?.url_private;
  }
  if (!/^https:\/\/files\.slack\.com\//.test(url)) {
    throw new Error("Slack file reference must be a Slack file ID or private Slack file URL.");
  }
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new Error("Failed to download Slack file.");
  }
  return response.text();
}

function payloadFromView(payload) {
  const state = payload.view.state;
  return {
    title: getValue(state, "title", "title"),
    knowledge_type: getValue(state, "knowledge_type", "knowledge_type"),
    project_key: getValue(state, "project_key", "project_key"),
    category: getValue(state, "category", "category"),
    status: getValue(state, "status", "status"),
    tools: getValue(state, "tools", "tools"),
    summary: getValue(state, "summary", "summary"),
    input_type: getValue(state, "input_type", "input_type"),
    body_short: getValue(state, "body_short", "body_short"),
    file_reference: getValue(state, "file_reference", "file_reference"),
    save_mode: getValue(state, "save_mode", "save_mode"),
    source: "slack"
  };
}

async function postResponse(responseUrl, text) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      response_type: "ephemeral",
      text
    })
  }).catch(() => {});
}

function successMessage(result) {
  const rawUrl = result.raw_json_url || result.raw_txt_url;
  return [
    "保存しました",
    `title: ${result.title}`,
    `knowledge_type: ${result.knowledge_type}`,
    `project_key: ${result.project_key}`,
    `save_mode: ${result.save_mode}`,
    `index.md: ${result.index_url}`,
    `raw: ${rawUrl}`,
    `Web貼り付け画面: ${env("URL") || ""}/public/knowledge-ingest.html`
  ].filter(Boolean).join("\n");
}

function errorMessage(error) {
  return `保存に失敗しました: ${error.message || "unknown error"}`;
}

async function processSave(payload, responseUrl) {
  try {
    let body = payload.body_short || "";
    if (payload.file_reference) {
      body = await fetchSlackFile(payload.file_reference);
    }
    const result = await saveKnowledgeToGitHub({
      ...payload,
      body
    });
    await postResponse(responseUrl, successMessage(result));
  } catch (error) {
    await postResponse(responseUrl, errorMessage(error));
  }
}

function ack(text = "") {
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

async function handleSlashCommand(params) {
  const triggerId = params.get("trigger_id");
  await slackApi("views.open", {
    trigger_id: triggerId,
    view: buildModal({ response_url: params.get("response_url") || "" })
  });
  return ack();
}

async function handleInteraction(payload, context) {
  if (payload.type === "message_action") {
    const text = payload.message?.text || "";
    await slackApi("views.open", {
      trigger_id: payload.trigger_id,
      view: buildModal({
        response_url: payload.response_url || "",
        body_short: text
      })
    });
    return ack();
  }

  if (payload.type === "view_submission" && payload.view?.callback_id === "knowledge_save_modal") {
    const privateMetadata = JSON.parse(payload.view.private_metadata || "{}");
    const savePayload = payloadFromView(payload);
    const responseUrl = privateMetadata.response_url || payload.response_url || "";
    const work = processSave(savePayload, responseUrl);
    if (context?.waitUntil) {
      context.waitUntil(work);
    }
    return jsonResponse(200, {
      response_action: "clear"
    });
  }

  return ack();
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
  if (params.has("command")) {
    return handleSlashCommand(params);
  }

  if (params.has("payload")) {
    let payload;
    try {
      payload = JSON.parse(params.get("payload"));
    } catch {
      return jsonResponse(400, { error: "Invalid Slack payload." });
    }
    return handleInteraction(payload, context);
  }

  return jsonResponse(400, { error: "Unsupported Slack request." });
};
