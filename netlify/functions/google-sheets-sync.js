import crypto from "node:crypto";
import { env, formatValue, parseTools } from "./knowledge-archive-core.js";

const knowledgeHeaders = [
  "project_key",
  "title",
  "knowledge_type",
  "category",
  "status",
  "summary",
  "tools",
  "github_index_url",
  "raw_url",
  "metadata_url",
  "created_at",
  "updated_at",
  "update_count",
  "last_event_type",
  "last_update_url",
  "source",
  "input_type",
  "sensitive_info",
  "slack_channel",
  "slack_ts"
];

const eventHeaders = [
  "event_id",
  "project_key",
  "title",
  "event_type",
  "save_mode",
  "knowledge_type",
  "category",
  "input_type",
  "github_index_url",
  "raw_url",
  "metadata_url",
  "update_url",
  "created_at",
  "slack_channel",
  "slack_ts",
  "slack_user",
  "source",
  "note"
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
  const privateKey = (env("GOOGLE_PRIVATE_KEY") || env("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"))?.replace(/\\n/g, "\n");
  const spreadsheetId = env("GOOGLE_SHEETS_SPREADSHEET_ID");
  const knowledgeSheetName = env("GOOGLE_SHEETS_KNOWLEDGE_SHEET_NAME") || env("GOOGLE_SHEETS_WORKSHEET_NAME") || "ナレッジ一覧";
  const eventsSheetName = env("GOOGLE_SHEETS_EVENTS_SHEET_NAME") || "更新履歴";
  if (!email || !privateKey || !spreadsheetId) {
    return {
      enabled: false,
      missing: [
        !email ? "GOOGLE_SERVICE_ACCOUNT_EMAIL" : "",
        !privateKey ? "GOOGLE_PRIVATE_KEY" : "",
        !spreadsheetId ? "GOOGLE_SHEETS_SPREADSHEET_ID" : ""
      ].filter(Boolean)
    };
  }
  return { enabled: true, email, privateKey, spreadsheetId, knowledgeSheetName, eventsSheetName };
}

async function getAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
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
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

function sheetsApiBase(config) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}`;
}

function valuesApiBase(config) {
  return `${sheetsApiBase(config)}/values`;
}

function rangePath(sheetName, range) {
  return encodeURIComponent(`'${sheetName}'!${range}`);
}

async function googleRequest(config, token, url, options = {}) {
  const response = await fetch(url, {
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

async function valuesRequest(config, token, path, options = {}) {
  return googleRequest(config, token, `${valuesApiBase(config)}/${path}`, options);
}

async function ensureSheetExists(config, token, sheetName) {
  const metadata = await googleRequest(config, token, sheetsApiBase(config), { method: "GET" });
  const exists = metadata.sheets?.some((sheet) => sheet.properties?.title === sheetName);
  if (exists) return;
  await googleRequest(config, token, `${sheetsApiBase(config)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    })
  });
}

async function ensureHeaders(config, token, sheetName, headers) {
  await ensureSheetExists(config, token, sheetName);
  const endCol = colName(headers.length);
  const readPath = rangePath(sheetName, `A1:${endCol}1`);
  const data = await valuesRequest(config, token, readPath, { method: "GET" }).catch(() => ({}));
  const existing = data.values?.[0] || [];
  if (existing.join("\t") === headers.join("\t")) return;
  await valuesRequest(config, token, `${readPath}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({
      range: `'${sheetName}'!A1:${endCol}1`,
      majorDimension: "ROWS",
      values: [headers]
    })
  });
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

function sheetValue(value) {
  return Array.isArray(value) ? value.join(", ") : formatValue(value);
}

function sensitiveInfo(payload) {
  const extracted = payload.extracted || {};
  return sheetValue(extracted.private_or_sensitive_info_to_hide || payload.warnings || "");
}

function eventType(payload, result) {
  if (result.is_update || payload.save_mode === "update") return "updated";
  return "created";
}

function updateUrl(result) {
  return result.update_url || result.update_json_url || "";
}

function rawUrl(result) {
  return result.raw_url || result.raw_json_url || result.raw_md_url || result.raw_txt_url || "";
}

function buildKnowledgeRow(payload, result, options = {}) {
  const createdAt = options.createdAt || result.created || result.updated || "";
  const updatedAt = result.updated || "";
  return [
    result.project_key || payload.project_key || "",
    result.title || payload.title || "",
    result.knowledge_type || payload.knowledge_type || "",
    payload.category || "",
    payload.status || "",
    payload.summary || "",
    parseTools(payload.tools).join(", "),
    result.index_url || "",
    rawUrl(result),
    result.metadata_url || "",
    createdAt,
    updatedAt,
    String(options.updateCount ?? 0),
    options.lastEventType || eventType(payload, result),
    options.lastUpdateUrl || updateUrl(result),
    payload.source || "",
    payload.input_type || "",
    sensitiveInfo(payload),
    payload.slack_channel || "",
    payload.slack_ts || ""
  ];
}

function buildEventRow(payload, result, options = {}) {
  return [
    payload.slack_event_id || `${result.project_key || payload.project_key}-${result.updated || Date.now()}`,
    result.project_key || payload.project_key || "",
    result.title || payload.title || "",
    options.eventType || eventType(payload, result),
    result.save_mode || payload.save_mode || "",
    result.knowledge_type || payload.knowledge_type || "",
    payload.category || "",
    payload.input_type || "",
    result.index_url || "",
    rawUrl(result),
    result.metadata_url || "",
    updateUrl(result),
    result.updated || "",
    payload.slack_channel || "",
    payload.slack_ts || "",
    payload.slack_user || "",
    payload.source || "",
    options.note || ""
  ];
}

async function readRows(config, token, sheetName, headers) {
  const endCol = colName(headers.length);
  const path = rangePath(sheetName, `A2:${endCol}`);
  const data = await valuesRequest(config, token, path, { method: "GET" }).catch(() => ({ values: [] }));
  return data.values || [];
}

async function putRow(config, token, sheetName, rowNumber, headers, row) {
  const endCol = colName(headers.length);
  const path = rangePath(sheetName, `A${rowNumber}:${endCol}${rowNumber}`);
  await valuesRequest(config, token, `${path}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({
      range: `'${sheetName}'!A${rowNumber}:${endCol}${rowNumber}`,
      majorDimension: "ROWS",
      values: [row]
    })
  });
}

async function appendRow(config, token, sheetName, headers, row) {
  const endCol = colName(headers.length);
  const path = rangePath(sheetName, `A:${endCol}`);
  await valuesRequest(config, token, `${path}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [row] })
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
  await ensureHeaders(config, token, config.knowledgeSheetName, knowledgeHeaders);
  await ensureHeaders(config, token, config.eventsSheetName, eventHeaders);

  const rows = await readRows(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const key = result.project_key || payload.project_key;
  const existingIndex = rows.findIndex((row) => row[0] === key);
  const type = eventType(payload, result);
  let note = "";

  if (existingIndex >= 0) {
    const current = rows[existingIndex];
    const currentUpdateCount = Number.parseInt(current[12] || "0", 10) || 0;
    const nextUpdateCount = type === "updated" ? currentUpdateCount + 1 : currentUpdateCount;
    const row = buildKnowledgeRow(payload, result, {
      createdAt: current[10] || result.created || result.updated || "",
      updateCount: nextUpdateCount,
      lastEventType: type,
      lastUpdateUrl: updateUrl(result)
    });
    await putRow(config, token, config.knowledgeSheetName, existingIndex + 2, knowledgeHeaders, row);
  } else {
    if (type === "updated") {
      note = "project_key not found, inserted by update event";
    }
    const row = buildKnowledgeRow(payload, result, {
      createdAt: result.created || result.updated || "",
      updateCount: type === "updated" ? 1 : 0,
      lastEventType: type,
      lastUpdateUrl: updateUrl(result)
    });
    await appendRow(config, token, config.knowledgeSheetName, knowledgeHeaders, row);
  }

  await appendRow(config, token, config.eventsSheetName, eventHeaders, buildEventRow(payload, result, {
    eventType: type,
    note
  }));

  return {
    ok: true,
    skipped: false,
    message: "Sheets更新済み",
    url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`,
    knowledge_sheet: config.knowledgeSheetName,
    events_sheet: config.eventsSheetName,
    event_type: type,
    note
  };
}
