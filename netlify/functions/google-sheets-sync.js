import crypto from "node:crypto";
import { env, formatValue, outputSummary, parseTools } from "./knowledge-archive-core.js";

const knowledgeHeaders = [
  "project_key",
  "title",
  "knowledge_type",
  "category",
  "status",
  "summary",
  "tools",
  "created_at",
  "updated_at",
  "update_count",
  "last_event_type",
  "github_index_url",
  "raw_url",
  "metadata_url",
  "last_update_url",
  "source",
  "input_type",
  "sensitive_info",
  "slack_user",
  "slack_channel",
  "slack_ts",
  "source_type",
  "file_name",
  "file_size",
  "char_count",
  "has_attachment",
  "has_supplemental_text",
  "note_output_url",
  "x_threads_output_url",
  "paid_manual_output_url",
  "template_readme_output_url",
  "sales_output_url",
  "latest_output_at",
  "output_count"
];

const eventHeaders = [
  "event_id",
  "event_time",
  "event_type",
  "save_mode",
  "project_key",
  "title",
  "knowledge_type",
  "category",
  "input_type",
  "slack_user",
  "github_index_url",
  "raw_url",
  "metadata_url",
  "update_url",
  "note",
  "slack_channel",
  "slack_ts",
  "source",
  "source_type",
  "file_name",
  "file_size",
  "char_count",
  "has_attachment",
  "has_supplemental_text"
];

const outputHistoryHeaders = [
  "output_id",
  "project_key",
  "knowledge_type",
  "source_title",
  "output_type",
  "output_title",
  "output_url",
  "created_at",
  "created_by",
  "model",
  "status",
  "note"
];

const sheetFormatState = new Set();
const testCleanupProjectKeys = new Set([
  "google-sheets",
  "google-sheets-2",
  "google-sheets-3",
  "slack",
  "20260609-0758-12345b5e",
  "test-knowledge"
]);

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
  const knowledgeSheetName = env("GOOGLE_SHEETS_KNOWLEDGE_SHEET_NAME") || env("GOOGLE_SHEETS_WORKSHEET_NAME") || "\u30ca\u30ec\u30c3\u30b8\u4e00\u89a7";
  const eventsSheetName = env("GOOGLE_SHEETS_EVENTS_SHEET_NAME") || "\u66f4\u65b0\u5c65\u6b74";
  const outputHistorySheetName = env("GOOGLE_SHEETS_OUTPUTS_SHEET_NAME") || "\u51fa\u529b\u5c65\u6b74";
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
  return { enabled: true, email, privateKey, spreadsheetId, knowledgeSheetName, eventsSheetName, outputHistorySheetName };
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
  const existing = metadata.sheets?.find((sheet) => sheet.properties?.title === sheetName);
  if (existing) return existing.properties;
  await googleRequest(config, token, `${sheetsApiBase(config)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    })
  });
  const nextMetadata = await googleRequest(config, token, sheetsApiBase(config), { method: "GET" });
  return nextMetadata.sheets?.find((sheet) => sheet.properties?.title === sheetName)?.properties;
}

async function ensureHeaders(config, token, sheetName, headers) {
  const sheetProperties = await ensureSheetExists(config, token, sheetName);
  const endCol = colName(headers.length);
  const readPath = rangePath(sheetName, "A1:ZZ1");
  const writePath = rangePath(sheetName, `A1:${endCol}1`);
  const data = await valuesRequest(config, token, readPath, { method: "GET" }).catch(() => ({}));
  const existing = data.values?.[0] || [];
  if (existing.join("\t") === headers.join("\t")) return sheetProperties;
  if (existing.length > 0) {
    await migrateRowsToHeaders(config, token, sheetName, existing, headers);
    return sheetProperties;
  }
  await valuesRequest(config, token, `${writePath}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({
      range: `'${sheetName}'!A1:${endCol}1`,
      majorDimension: "ROWS",
      values: [headers]
    })
  });
  return sheetProperties;
}

async function migrateRowsToHeaders(config, token, sheetName, existingHeaders, targetHeaders) {
  const existingEndCol = colName(Math.max(existingHeaders.length, targetHeaders.length));
  const allDataPath = rangePath(sheetName, `A1:${existingEndCol}`);
  const data = await valuesRequest(config, token, allDataPath, { method: "GET" }).catch(() => ({ values: [] }));
  const rows = data.values || [];
  const sourceHeaders = rows[0] || existingHeaders;
  const sourceIndex = new Map(sourceHeaders.map((header, index) => [header, index]));
  const unknownHeaders = sourceHeaders.filter((header) => header && !targetHeaders.includes(header));
  const nextHeaders = [...targetHeaders, ...unknownHeaders];
  const nextRows = rows.slice(1).map((row) => nextHeaders.map((header) => {
    const index = sourceIndex.get(header);
    return index === undefined ? "" : row[index] || "";
  }));
  const endCol = colName(nextHeaders.length);
  const writePath = rangePath(sheetName, `A1:${endCol}${Math.max(nextRows.length + 1, 1)}`);
  await valuesRequest(config, token, `${writePath}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({
      range: `'${sheetName}'!A1:${endCol}${Math.max(nextRows.length + 1, 1)}`,
      majorDimension: "ROWS",
      values: [nextHeaders, ...nextRows]
    })
  });
}

async function getSheetProperties(config, token, sheetName) {
  const metadata = await googleRequest(config, token, sheetsApiBase(config), { method: "GET" });
  return metadata.sheets?.find((sheet) => sheet.properties?.title === sheetName)?.properties;
}

function headerIndex(headers, name) {
  const index = headers.indexOf(name);
  return index >= 0 ? index : null;
}

function dimensionRequest(sheetId, index, pixelSize) {
  if (index === null) return null;
  return {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: index,
        endIndex: index + 1
      },
      properties: { pixelSize },
      fields: "pixelSize"
    }
  };
}

function repeatColumnFormat(sheetId, headers, name, format) {
  const index = headerIndex(headers, name);
  if (index === null) return null;
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: index,
        endColumnIndex: index + 1
      },
      cell: { userEnteredFormat: format },
      fields: Object.keys(format).map((key) => `userEnteredFormat.${key}`).join(",")
    }
  };
}

function formattingRequests(sheetId, headers, kind) {
  const urlColumns = headers.filter((header) => header.includes("url"));
  const dateColumns = headers.filter((header) => header.endsWith("_at") || header.endsWith("_time"));
  const widthMap = {
    project_key: 160,
    event_id: 160,
    event_time: 140,
    title: 220,
    knowledge_type: 120,
    category: 140,
    status: 100,
    summary: 360,
    tools: 180,
    created_at: 150,
    updated_at: 150,
    update_count: 90,
    last_event_type: 120,
    event_type: 110,
    save_mode: 110,
    input_type: 110,
    sensitive_info: 220,
    note: 260,
    slack_user: 120,
    slack_channel: 130,
    slack_ts: 130,
    source: 130,
    source_type: 150,
    file_name: 180,
    file_size: 110,
    char_count: 110,
    has_attachment: 120,
    has_supplemental_text: 150,
    output_id: 160,
    output_type: 130,
    output_title: 240,
    source_title: 220,
    note_output_url: 150,
    x_threads_output_url: 150,
    paid_manual_output_url: 150,
    template_readme_output_url: 150,
    sales_output_url: 150,
    latest_output_at: 150,
    output_count: 90,
    created_by: 120,
    model: 120
  };

  const requests = [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 }
        },
        fields: "gridProperties.frozenRowCount"
      }
    },
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: 0,
            startColumnIndex: 0,
            endColumnIndex: headers.length
          }
        }
      }
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: headers.length
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: kind === "knowledge"
              ? { red: 0.08, green: 0.32, blue: 0.55 }
              : { red: 0.26, green: 0.34, blue: 0.18 },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
            textFormat: {
              bold: true,
              fontSize: 10,
              foregroundColor: { red: 1, green: 1, blue: 1 }
            }
          }
        },
        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: headers.length
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "TOP",
            wrapStrategy: "CLIP",
            textFormat: { fontSize: 10 }
          }
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy,textFormat.fontSize)"
      }
    },
    {
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: 0,
          startColumnIndex: 0,
          endColumnIndex: headers.length
        },
        top: { style: "SOLID", width: 1, color: { red: 0.8, green: 0.84, blue: 0.9 } },
        bottom: { style: "SOLID", width: 1, color: { red: 0.8, green: 0.84, blue: 0.9 } },
        left: { style: "SOLID", width: 1, color: { red: 0.8, green: 0.84, blue: 0.9 } },
        right: { style: "SOLID", width: 1, color: { red: 0.8, green: 0.84, blue: 0.9 } },
        innerHorizontal: { style: "SOLID", width: 1, color: { red: 0.88, green: 0.9, blue: 0.94 } },
        innerVertical: { style: "SOLID", width: 1, color: { red: 0.88, green: 0.9, blue: 0.94 } }
      }
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: 0,
          endIndex: 1
        },
        properties: { pixelSize: 34 },
        fields: "pixelSize"
      }
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: 1,
          endIndex: 1000
        },
        properties: { pixelSize: 30 },
        fields: "pixelSize"
      }
    }
  ];

  for (const header of headers) {
    const width = header.includes("url") ? 150 : widthMap[header] || 120;
    requests.push(dimensionRequest(sheetId, headerIndex(headers, header), width));
  }

  requests.push(repeatColumnFormat(sheetId, headers, "summary", { wrapStrategy: "WRAP" }));
  requests.push(repeatColumnFormat(sheetId, headers, "note", { wrapStrategy: "WRAP" }));
  requests.push(repeatColumnFormat(sheetId, headers, "sensitive_info", { wrapStrategy: "WRAP" }));

  for (const header of urlColumns) {
    requests.push(repeatColumnFormat(sheetId, headers, header, {
      wrapStrategy: "CLIP",
      textFormat: {
        foregroundColor: { red: 0.06, green: 0.32, blue: 0.72 },
        underline: true,
        fontSize: 9
      }
    }));
  }

  for (const header of dateColumns) {
    requests.push(repeatColumnFormat(sheetId, headers, header, {
      numberFormat: {
        type: "DATE_TIME",
        pattern: "yyyy-mm-dd hh:mm"
      }
    }));
  }

  return requests.filter(Boolean);
}

async function applySheetFormatting(config, token, sheetName, headers, kind, sheetProperties = null) {
  const cacheKey = `${config.spreadsheetId}:${sheetName}:${headers.join("|")}`;
  if (sheetFormatState.has(cacheKey)) return;
  const properties = sheetProperties?.sheetId !== undefined
    ? sheetProperties
    : await getSheetProperties(config, token, sheetName);
  if (properties?.sheetId === undefined) return;
  await googleRequest(config, token, `${sheetsApiBase(config)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: formattingRequests(properties.sheetId, headers, kind)
    })
  });
  sheetFormatState.add(cacheKey);
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

function sheetValue(value, maxLength = 300) {
  const formatted = formatValue(value)
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!formatted) return "";
  return formatted.length > maxLength ? `${formatted.slice(0, maxLength - 1)}…` : formatted;
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
  return result.update_url || result.update_json_url || result.update_txt_url || "";
}

function rawUrl(result) {
  return result.raw_url || result.raw_json_url || result.raw_md_url || result.raw_txt_url || "";
}

function githubBlobUrl(path) {
  if (!path) return "";
  const owner = env("GITHUB_OWNER");
  const repo = env("GITHUB_REPO");
  const branch = env("GITHUB_BRANCH") || "main";
  if (!owner || !repo) return "";
  return `https://github.com/${owner}/${repo}/blob/${branch}/${path}`;
}

function resultOutputSummary(payload, result) {
  return result.output_summary || outputSummary(result.metadata?.outputs || payload.outputs || payload.metadata?.outputs || {});
}

function buildKnowledgeRow(payload, result, options = {}) {
  const createdAt = options.createdAt || result.created || result.updated || "";
  const updatedAt = result.updated || "";
  const outputs = resultOutputSummary(payload, result);
  return [
    result.project_key || payload.project_key || "",
    sheetValue(result.title || payload.title || "", 160),
    result.knowledge_type || payload.knowledge_type || "",
    sheetValue(payload.category || "", 120),
    sheetValue(payload.status || "", 80),
    sheetValue(payload.summary || "", 300),
    sheetValue(parseTools(payload.tools).join(", "), 180),
    createdAt,
    updatedAt,
    String(options.updateCount ?? 0),
    options.lastEventType || eventType(payload, result),
    result.index_url || "",
    rawUrl(result),
    result.metadata_url || "",
    options.lastUpdateUrl || updateUrl(result),
    payload.source || "",
    payload.input_type || "",
    sensitiveInfo(payload),
    payload.slack_user || "",
    payload.slack_channel || "",
    payload.slack_ts || "",
    payload.source_type || "",
    payload.file_name || "",
    payload.file_size ? String(payload.file_size) : "",
    payload.char_count ? String(payload.char_count) : "",
    payload.has_attachment ? "yes" : "no",
    payload.has_supplemental_text || payload.supplemental_text ? "yes" : "no",
    outputs.note_output_url || "",
    outputs.x_threads_output_url || "",
    outputs.paid_manual_output_url || "",
    outputs.template_readme_output_url || "",
    outputs.sales_output_url || "",
    outputs.latest_output_at || "",
    outputs.output_count ? String(outputs.output_count) : ""
  ];
}

function buildEventRow(payload, result, options = {}) {
  return [
    payload.slack_event_id || `${result.project_key || payload.project_key}-${result.updated || Date.now()}`,
    result.updated || "",
    options.eventType || eventType(payload, result),
    result.save_mode || payload.save_mode || "",
    result.project_key || payload.project_key || "",
    sheetValue(result.title || payload.title || "", 160),
    result.knowledge_type || payload.knowledge_type || "",
    sheetValue(payload.category || "", 120),
    payload.input_type || "",
    payload.slack_user || "",
    result.index_url || "",
    rawUrl(result),
    result.metadata_url || "",
    updateUrl(result),
    options.note || "",
    payload.slack_channel || "",
    payload.slack_ts || "",
    payload.source || "",
    payload.source_type || "",
    payload.file_name || "",
    payload.file_size ? String(payload.file_size) : "",
    payload.char_count ? String(payload.char_count) : "",
    payload.has_attachment ? "yes" : "no",
    payload.has_supplemental_text || payload.supplemental_text ? "yes" : "no"
  ];
}

function buildOutputHistoryRow(metadata, result) {
  const record = result.output_record || {};
  return [
    `${result.project_key}-${result.output_type}-${result.created_at || Date.now()}`,
    result.project_key || metadata.project_key || "",
    result.knowledge_type || metadata.knowledge_type || "",
    sheetValue(metadata.title || result.title || "", 160),
    result.output_type || record.output_type || "",
    sheetValue(result.output_title || record.title || "", 180),
    result.output_url || record.url || "",
    result.created_at || record.created_at || "",
    sheetValue(record.created_by || "", 120),
    sheetValue(record.model || "", 120),
    sheetValue(record.status || "draft", 80),
    sheetValue(record.note || "", 260)
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

async function deleteSheetRow(config, token, sheetProperties, rowNumber) {
  if (sheetProperties?.sheetId === undefined || !rowNumber) return false;
  await googleRequest(config, token, `${sheetsApiBase(config)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetProperties.sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            }
          }
        }
      ]
    })
  });
  return true;
}

async function deleteSheetRows(config, token, sheetProperties, rowNumbers) {
  if (sheetProperties?.sheetId === undefined || !Array.isArray(rowNumbers) || rowNumbers.length === 0) {
    return 0;
  }
  const requests = [...rowNumbers]
    .filter((rowNumber) => Number.isInteger(rowNumber) && rowNumber > 1)
    .sort((a, b) => b - a)
    .map((rowNumber) => ({
      deleteDimension: {
        range: {
          sheetId: sheetProperties.sheetId,
          dimension: "ROWS",
          startIndex: rowNumber - 1,
          endIndex: rowNumber
        }
      }
    }));
  if (!requests.length) return 0;
  await googleRequest(config, token, `${sheetsApiBase(config)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests })
  });
  return requests.length;
}

function rowToKnowledgeEntry(row) {
  return {
    project_key: row[0] || "",
    title: row[1] || "",
    knowledge_type: row[2] || "",
    category: row[3] || "",
    status: row[4] || "",
    summary: row[5] || "",
    tools: row[6] || "",
    created_at: row[7] || "",
    updated_at: row[8] || "",
    github_index_url: row[11] || "",
    raw_url: row[12] || "",
    metadata_url: row[13] || "",
    source: row[15] || "",
    input_type: row[16] || "",
    sensitive_info: row[17] || "",
    slack_user: row[18] || "",
    slack_channel: row[19] || "",
    slack_ts: row[20] || "",
    source_type: row[21] || "",
    file_name: row[22] || "",
    file_size: row[23] || "",
    char_count: row[24] || "",
    has_attachment: row[25] || "",
    has_supplemental_text: row[26] || "",
    note_output_url: row[27] || "",
    x_threads_output_url: row[28] || "",
    paid_manual_output_url: row[29] || "",
    template_readme_output_url: row[30] || "",
    sales_output_url: row[31] || "",
    latest_output_at: row[32] || "",
    output_count: row[33] || ""
  };
}

function sheetsNotConfiguredResult(config) {
  return {
    ok: false,
    skipped: true,
    message: `Google Sheets environment variables are missing: ${config.missing.join(", ")}`
  };
}

async function getConfiguredSheets() {
  const config = getSheetsConfig();
  if (!config.enabled) return { config, skipped: sheetsNotConfiguredResult(config) };
  const token = await getAccessToken(config);
  const knowledgeSheetProperties = await ensureHeaders(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const eventsSheetProperties = await ensureHeaders(config, token, config.eventsSheetName, eventHeaders);
  const outputHistorySheetProperties = await ensureHeaders(config, token, config.outputHistorySheetName, outputHistoryHeaders);
  await applySheetFormatting(config, token, config.knowledgeSheetName, knowledgeHeaders, "knowledge", knowledgeSheetProperties);
  await applySheetFormatting(config, token, config.eventsSheetName, eventHeaders, "events", eventsSheetProperties);
  await applySheetFormatting(config, token, config.outputHistorySheetName, outputHistoryHeaders, "outputs", outputHistorySheetProperties);
  return { config, token, knowledgeSheetProperties, eventsSheetProperties, outputHistorySheetProperties };
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
  const knowledgeSheetProperties = await ensureHeaders(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const eventsSheetProperties = await ensureHeaders(config, token, config.eventsSheetName, eventHeaders);
  const outputHistorySheetProperties = await ensureHeaders(config, token, config.outputHistorySheetName, outputHistoryHeaders);
  await applySheetFormatting(config, token, config.knowledgeSheetName, knowledgeHeaders, "knowledge", knowledgeSheetProperties);
  await applySheetFormatting(config, token, config.eventsSheetName, eventHeaders, "events", eventsSheetProperties);
  await applySheetFormatting(config, token, config.outputHistorySheetName, outputHistoryHeaders, "outputs", outputHistorySheetProperties);

  const rows = await readRows(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const key = result.project_key || payload.project_key;
  const existingIndex = rows.findIndex((row) => row[0] === key);
  const type = eventType(payload, result);
  let note = "";

  if (existingIndex >= 0) {
    const current = rows[existingIndex];
    const currentUpdateCount = Number.parseInt(current[9] || "0", 10) || 0;
    const nextUpdateCount = type === "updated" ? currentUpdateCount + 1 : currentUpdateCount;
    const row = buildKnowledgeRow(payload, result, {
      createdAt: current[7] || result.created || result.updated || "",
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
    message: "Sheets譖ｴ譁ｰ貂医∩",
    url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`,
    knowledge_sheet: config.knowledgeSheetName,
    events_sheet: config.eventsSheetName,
    output_history_sheet: config.outputHistorySheetName,
    event_type: type,
    note
  };
}

export async function syncKnowledgeOutputToGoogleSheets(metadata, result) {
  const sheets = await getConfiguredSheets();
  if (sheets.skipped) return sheets.skipped;
  const { config, token } = sheets;
  const rows = await readRows(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const key = result.project_key || metadata.project_key;
  const existingIndex = rows.findIndex((row) => row[0] === key);
  const payload = {
    ...metadata,
    summary: metadata.summary || "",
    tools: metadata.tools || [],
    source: metadata.source || "output",
    input_type: metadata.input_type || "",
    outputs: metadata.outputs || {}
  };
  const knowledgeResult = {
    ...result,
    title: metadata.title || result.title || key,
    knowledge_type: metadata.knowledge_type || result.knowledge_type || "",
    project_key: key,
    updated: result.created_at || metadata.updated || "",
    created: metadata.created || metadata.created_at || "",
    index_url: result.index_url || "",
    raw_url: metadata.raw_url || "",
    metadata_url: result.metadata_url || "",
    output_summary: result.output_summary || outputSummary(metadata.outputs || {})
  };
  if (existingIndex >= 0) {
    const current = rows[existingIndex];
    knowledgeResult.index_url ||= current[11] || "";
    knowledgeResult.raw_url ||= current[12] || "";
    knowledgeResult.metadata_url ||= current[13] || "";
    const row = buildKnowledgeRow(payload, knowledgeResult, {
      createdAt: current[7] || knowledgeResult.created || knowledgeResult.updated || "",
      updateCount: Number.parseInt(current[9] || "0", 10) || 0,
      lastEventType: current[10] || "output_created",
      lastUpdateUrl: current[14] || ""
    });
    await putRow(config, token, config.knowledgeSheetName, existingIndex + 2, knowledgeHeaders, row);
  } else {
    knowledgeResult.index_url ||= githubBlobUrl(metadata.path);
    knowledgeResult.raw_url ||= githubBlobUrl(metadata.raw_path);
    knowledgeResult.metadata_url ||= githubBlobUrl(`${metadata.path || ""}`.replace(/index\.md$/, "metadata.json"));
    await appendRow(config, token, config.knowledgeSheetName, knowledgeHeaders, buildKnowledgeRow(payload, knowledgeResult, {
      createdAt: knowledgeResult.created || knowledgeResult.updated || "",
      updateCount: 0,
      lastEventType: "output_created",
      lastUpdateUrl: ""
    }));
  }
  await appendRow(config, token, config.outputHistorySheetName, outputHistoryHeaders, buildOutputHistoryRow(metadata, result));
  return {
    ok: true,
    skipped: false,
    message: "Output synced to Sheets.",
    url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`,
    knowledge_sheet: config.knowledgeSheetName,
    output_history_sheet: config.outputHistorySheetName
  };
}

export async function syncKnowledgeDeletionToGoogleSheets(entry, result) {
  const config = getSheetsConfig();
  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      message: `Google Sheets environment variables are missing: ${config.missing.join(", ")}`
    };
  }

  const token = await getAccessToken(config);
  const knowledgeSheetProperties = await ensureHeaders(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const eventsSheetProperties = await ensureHeaders(config, token, config.eventsSheetName, eventHeaders);
  await applySheetFormatting(config, token, config.knowledgeSheetName, knowledgeHeaders, "knowledge", knowledgeSheetProperties);
  await applySheetFormatting(config, token, config.eventsSheetName, eventHeaders, "events", eventsSheetProperties);

  const projectKey = result.project_key || entry.project_key || "";
  const rows = await readRows(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const existingIndex = rows.findIndex((row) => row[0] === projectKey);
  const rowDeleted = existingIndex >= 0
    ? await deleteSheetRow(config, token, knowledgeSheetProperties, existingIndex + 2)
    : false;
  const eventResult = {
    ...result,
    title: result.title || entry.title || projectKey,
    project_key: projectKey,
    knowledge_type: result.knowledge_type || entry.knowledge_type || "",
    save_mode: "delete",
    updated: result.deleted_at || new Date().toISOString(),
    index_url: result.index_url || entry.index_url || "",
    raw_url: result.raw_url || entry.raw_url || "",
    metadata_url: result.metadata_url || entry.metadata_url || "",
    update_url: ""
  };
  const eventPayload = {
    ...entry,
    save_mode: "delete",
    source: entry.source || result.source || "cleanup",
    input_type: entry.input_type || "",
    slack_user: entry.slack_user || "",
    slack_channel: entry.slack_channel || "",
    slack_ts: entry.slack_ts || "",
    slack_event_id: entry.slack_event_id || `delete-${projectKey}-${eventResult.updated}`
  };
  await appendRow(config, token, config.eventsSheetName, eventHeaders, buildEventRow(eventPayload, eventResult, {
    eventType: "deleted",
    note: entry.note || "test knowledge cleanup"
  }));

  return {
    ok: true,
    skipped: false,
    message: "Sheets deletion synced.",
    url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`,
    knowledge_sheet: config.knowledgeSheetName,
    events_sheet: config.eventsSheetName,
    event_type: "deleted",
    row_deleted: rowDeleted,
    note: rowDeleted ? "" : "project_key not found in knowledge sheet"
  };
}

export async function findKnowledgeInGoogleSheets(query = {}) {
  const sheets = await getConfiguredSheets();
  if (sheets.skipped) return { ...sheets.skipped, entry: null };
  const { config, token } = sheets;
  const rows = await readRows(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const projectKey = String(query.project_key || "").trim();
  const knowledgeType = String(query.knowledge_type || "").trim();
  const matches = rows
    .map((row, index) => ({ row, row_number: index + 2, entry: rowToKnowledgeEntry(row) }))
    .filter((item) => {
      if (projectKey && item.entry.project_key !== projectKey) return false;
      if (knowledgeType && item.entry.knowledge_type && item.entry.knowledge_type !== knowledgeType) return false;
      return Boolean(item.entry.project_key);
    });
  return {
    ok: true,
    skipped: false,
    knowledge_sheet: config.knowledgeSheetName,
    events_sheet: config.eventsSheetName,
    matches
  };
}

export async function getTestKnowledgeCleanupPreview(projectKeys = [...testCleanupProjectKeys]) {
  const sheets = await getConfiguredSheets();
  if (sheets.skipped) return { ...sheets.skipped, knowledge_count: 0, history_count: 0, project_keys: projectKeys };
  const { config, token } = sheets;
  const keySet = new Set(projectKeys);
  const knowledgeRows = await readRows(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const eventRows = await readRows(config, token, config.eventsSheetName, eventHeaders);
  const knowledgeMatches = knowledgeRows
    .map((row, index) => ({ row, row_number: index + 2, project_key: row[0] || "" }))
    .filter((item) => keySet.has(item.project_key));
  const eventMatches = eventRows
    .map((row, index) => ({ row, row_number: index + 2, project_key: row[4] || "" }))
    .filter((item) => keySet.has(item.project_key));
  return {
    ok: true,
    skipped: false,
    knowledge_sheet: config.knowledgeSheetName,
    events_sheet: config.eventsSheetName,
    project_keys: projectKeys,
    knowledge_count: knowledgeMatches.length,
    history_count: eventMatches.length,
    knowledge_matches: knowledgeMatches,
    history_matches: eventMatches
  };
}

export async function syncSheetsOnlyKnowledgeDeletion(entry, options = {}) {
  const sheets = await getConfiguredSheets();
  if (sheets.skipped) return sheets.skipped;
  const { config, token, knowledgeSheetProperties, eventsSheetProperties } = sheets;
  const projectKey = entry.project_key || "";
  const rows = await readRows(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const knowledgeRowNumbers = rows
    .map((row, index) => ({ row, row_number: index + 2 }))
    .filter((item) => item.row[0] === projectKey)
    .map((item) => item.row_number);
  const knowledgeRowsDeleted = await deleteSheetRows(config, token, knowledgeSheetProperties, knowledgeRowNumbers);

  let historyRowsDeleted = 0;
  let deletedEventAdded = false;
  const deleteHistory = options.deleteHistory ?? testCleanupProjectKeys.has(projectKey);
  if (deleteHistory) {
    const eventRows = await readRows(config, token, config.eventsSheetName, eventHeaders);
    const eventRowNumbers = eventRows
      .map((row, index) => ({ row, row_number: index + 2 }))
      .filter((item) => item.row[4] === projectKey)
      .map((item) => item.row_number);
    historyRowsDeleted = await deleteSheetRows(config, token, eventsSheetProperties, eventRowNumbers);
  } else {
    const timestamp = new Date().toISOString();
    const eventResult = {
      title: entry.title || projectKey,
      project_key: projectKey,
      knowledge_type: entry.knowledge_type || "",
      save_mode: "delete",
      updated: timestamp,
      index_url: entry.github_index_url || "",
      raw_url: entry.raw_url || "",
      metadata_url: entry.metadata_url || "",
      update_url: ""
    };
    const eventPayload = {
      ...entry,
      save_mode: "delete",
      source: entry.source || "slack",
      slack_event_id: entry.slack_event_id || `sheets-delete-${projectKey}-${timestamp}`
    };
    await appendRow(config, token, config.eventsSheetName, eventHeaders, buildEventRow(eventPayload, eventResult, {
      eventType: "deleted",
      note: options.note || "sheets only knowledge deletion"
    }));
    deletedEventAdded = true;
  }

  return {
    ok: true,
    skipped: false,
    message: "Sheets-only deletion synced.",
    url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`,
    knowledge_sheet: config.knowledgeSheetName,
    events_sheet: config.eventsSheetName,
    event_type: deleteHistory ? "hard_deleted" : "deleted",
    delete_history: deleteHistory,
    knowledge_rows_deleted: knowledgeRowsDeleted,
    history_rows_deleted: historyRowsDeleted,
    deleted_event_added: deletedEventAdded
  };
}

export async function cleanupTestKnowledgeInGoogleSheets(projectKeys = [...testCleanupProjectKeys]) {
  const preview = await getTestKnowledgeCleanupPreview(projectKeys);
  if (preview.skipped) return preview;
  const sheets = await getConfiguredSheets();
  const { config, token, knowledgeSheetProperties, eventsSheetProperties } = sheets;
  const knowledgeRowsDeleted = await deleteSheetRows(
    config,
    token,
    knowledgeSheetProperties,
    preview.knowledge_matches.map((item) => item.row_number)
  );
  const historyRowsDeleted = await deleteSheetRows(
    config,
    token,
    eventsSheetProperties,
    preview.history_matches.map((item) => item.row_number)
  );
  return {
    ok: true,
    skipped: false,
    message: "Test knowledge sheets cleanup synced.",
    url: `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}`,
    knowledge_sheet: config.knowledgeSheetName,
    events_sheet: config.eventsSheetName,
    event_type: "hard_deleted",
    delete_history: true,
    project_keys: projectKeys,
    knowledge_rows_deleted: knowledgeRowsDeleted,
    history_rows_deleted: historyRowsDeleted
  };
}
