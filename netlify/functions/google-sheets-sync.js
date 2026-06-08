import crypto from "node:crypto";
import { env, formatValue, parseTools } from "./knowledge-archive-core.js";

const sheetHeaders = [
  "作成日",
  "更新日",
  "タイトル",
  "保存キー",
  "ナレッジ種別",
  "カテゴリ",
  "ステータス",
  "使用ツール",
  "概要",
  "GitHub index URL",
  "raw URL",
  "source",
  "Slack channel",
  "Slack message URL",
  "note展開候補",
  "WordPress展開候補",
  "X/Threads展開候補",
  "公開時に伏せる情報",
  "次にやること"
];

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function getSheetsConfig() {
  const email = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")?.replace(/\\n/g, "\n");
  const spreadsheetId = env("GOOGLE_SHEETS_SPREADSHEET_ID");
  const worksheetName = env("GOOGLE_SHEETS_WORKSHEET_NAME") || "knowledge";
  if (!email || !privateKey || !spreadsheetId) {
    return {
      enabled: false,
      missing: [
        !email ? "GOOGLE_SERVICE_ACCOUNT_EMAIL" : "",
        !privateKey ? "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY" : "",
        !spreadsheetId ? "GOOGLE_SHEETS_SPREADSHEET_ID" : ""
      ].filter(Boolean)
    };
  }
  return { enabled: true, email, privateKey, spreadsheetId, worksheetName };
}

async function getAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const claim = {
    iss: config.email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(config.privateKey);
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google OAuth token request failed.");
  }
  return data.access_token;
}

function sheetsBase(config) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`;
}

async function sheetsRequest(config, token, path, options = {}) {
  const response = await fetch(`${sheetsBase(config)}/${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Google Sheets API request failed.");
  }
  return data;
}

function sheetValue(value) {
  return Array.isArray(value) ? value.join(", ") : formatValue(value);
}

function buildRow(payload, result) {
  const extracted = payload.extracted || {};
  return [
    result.created || "",
    result.updated || "",
    payload.title || result.title || "",
    payload.project_key || result.project_key || "",
    payload.knowledge_type || result.knowledge_type || "",
    payload.category || "",
    payload.status || "",
    parseTools(payload.tools).join(", "),
    payload.summary || "",
    result.index_url || "",
    result.raw_url || result.raw_json_url || result.raw_md_url || result.raw_txt_url || "",
    payload.source || "",
    payload.slack_channel || "",
    payload.slack_message_url || "",
    sheetValue(extracted.note_article_angles),
    sheetValue(extracted.wordpress_article_angles),
    sheetValue(extracted.x_threads_post_ideas),
    sheetValue(extracted.private_or_sensitive_info_to_hide || payload.warnings),
    sheetValue(extracted.next_actions || "")
  ];
}

function colName(index) {
  let value = "";
  let n = index;
  while (n > 0) {
    const mod = (n - 1) % 26;
    value = String.fromCharCode(65 + mod) + value;
    n = Math.floor((n - mod) / 26);
  }
  return value;
}

async function ensureHeaders(config, token) {
  const range = `${encodeURIComponent(config.worksheetName)}!A1:S1`;
  const data = await sheetsRequest(config, token, range, { method: "GET" }).catch(() => ({}));
  const existing = data.values?.[0] || [];
  if (existing.join("\t") === sheetHeaders.join("\t")) return;
  await sheetsRequest(config, token, `${range}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({
      range: `${config.worksheetName}!A1:S1`,
      majorDimension: "ROWS",
      values: [sheetHeaders]
    })
  });
}

export async function syncKnowledgeToGoogleSheets(payload, result) {
  const config = getSheetsConfig();
  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      message: `Google Sheets environment variables are missing: ${config.missing.join(", ")}`
    };
  }

  const token = await getAccessToken(config);
  await ensureHeaders(config, token);
  const readRange = `${encodeURIComponent(config.worksheetName)}!A2:S`;
  const data = await sheetsRequest(config, token, readRange, { method: "GET" }).catch(() => ({ values: [] }));
  const rows = data.values || [];
  const key = payload.project_key || result.project_key;
  const type = payload.knowledge_type || result.knowledge_type;
  const existingIndex = rows.findIndex((row) => row[3] === key && row[4] === type);
  const row = buildRow(payload, result);

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    const range = `${encodeURIComponent(config.worksheetName)}!A${rowNumber}:${colName(sheetHeaders.length)}${rowNumber}`;
    await sheetsRequest(config, token, `${range}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({
        range: `${config.worksheetName}!A${rowNumber}:${colName(sheetHeaders.length)}${rowNumber}`,
        majorDimension: "ROWS",
        values: [row]
      })
    });
  } else {
    const range = `${encodeURIComponent(config.worksheetName)}!A:S:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    await sheetsRequest(config, token, range, {
      method: "POST",
      body: JSON.stringify({
        values: [row]
      })
    });
  }

  return {
    ok: true,
    skipped: false,
    message: "Sheets更新済み",
    url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`
  };
}
