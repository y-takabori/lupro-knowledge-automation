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
  "slack_ts"
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
  "source"
];

const sheetFormatState = new Set();

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
    source: 130
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
    payload.slack_ts || ""
  ];
}

function buildEventRow(payload, result, options = {}) {
  return [
    payload.slack_event_id || `${result.project_key || payload.project_key}-${result.updated || Date.now()}`,
    result.updated || "",
    options.eventType || eventType(payload, result),
    result.save_mode || payload.save_mode || "",
    result.project_key || payload.project_key || "",
    result.title || payload.title || "",
    result.knowledge_type || payload.knowledge_type || "",
    payload.category || "",
    payload.input_type || "",
    payload.slack_user || "",
    result.index_url || "",
    rawUrl(result),
    result.metadata_url || "",
    updateUrl(result),
    options.note || "",
    payload.slack_channel || "",
    payload.slack_ts || "",
    payload.source || ""
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
  const knowledgeSheetProperties = await ensureHeaders(config, token, config.knowledgeSheetName, knowledgeHeaders);
  const eventsSheetProperties = await ensureHeaders(config, token, config.eventsSheetName, eventHeaders);
  await applySheetFormatting(config, token, config.knowledgeSheetName, knowledgeHeaders, "knowledge", knowledgeSheetProperties);
  await applySheetFormatting(config, token, config.eventsSheetName, eventHeaders, "events", eventsSheetProperties);

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
    event_type: type,
    note
  };
}
