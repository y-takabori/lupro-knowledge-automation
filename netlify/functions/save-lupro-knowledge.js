const NOTION_VERSION = "2022-06-28";
const MAX_RICH_TEXT_CHUNK = 1900;
const MAX_RICH_TEXT_CHUNKS = 20;

const requiredFields = [
  "project_title",
  "project_category",
  "status",
  "background_issue",
  "what_user_wanted_to_achieve",
  "tools_used",
  "implementation_summary",
  "private_or_sensitive_info_to_hide"
];

const statusMap = {
  planning: "planning",
  plan: "planning",
  in_progress: "in_progress",
  progress: "in_progress",
  implementing: "in_progress",
  testing: "in_progress",
  mvp_test_completed: "completed",
  mvp_completed: "completed",
  completed: "completed",
  done: "completed",
  archived: "archived"
};

const legacyStatusMap = {
  planning: "下書き",
  in_progress: "検証中",
  completed: "保存済み",
  archived: "記事化候補"
};

const propertyMap = {
  project_title: "タイトル",
  project_category: "カテゴリ",
  status: "ステータス",
  tools_used: "使用ツール",
  background_issue: "背景課題",
  what_user_wanted_to_achieve: "実現したいこと",
  worries_or_uncertainties: "悩み・迷い",
  implementation_summary: "実装内容",
  decision_reason: "判断理由",
  blockers: "詰まったこと",
  solution: "解決策",
  actual_effect: "実際の効果",
  things_to_prepare_beforehand: "事前にやっておくべきこと",
  learnings_applicable_to_other_companies: "他社にも応用できる学び",
  wordpress_article_angle: "WordPress記事化の切り口",
  note_article_angle: "note記事化の切り口",
  x_threads_post_ideas: "X/Threads投稿案",
  private_or_sensitive_info_to_hide: "公開時に伏せるべき情報",
  security_memo: "セキュリティメモ"
};

const propertyAliases = {
  decision_reason: ["decision_reasons"],
  blockers: ["stuck_points"],
  actual_effect: ["actual_effects"],
  things_to_prepare_beforehand: [
    "things_to_prepare_before_starting",
    "things_to_prepare_beforehand"
  ],
  learnings_applicable_to_other_companies: ["lessons_for_other_companies"],
  wordpress_article_angle: ["wordpress_article_angles"],
  note_article_angle: ["note_article_angles"],
  worries_or_uncertainties: ["user_pain_points"]
};

const additionalPropertyMap = {
  future_improvement_ideas: "Future improvement ideas",
  human_review_points: "Human review points"
};

function env(name) {
  if (globalThis.Netlify?.env?.get) {
    return Netlify.env.get(name);
  }
  return process.env[name];
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

function isMissing(value) {
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null || String(value).trim() === "";
}

function validateRequiredFields(payload) {
  return requiredFields.filter((field) => isMissing(payload[field]));
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return statusMap[status] || "planning";
}

function resolveStatusOptionName(normalizedStatus, statusOptionNames) {
  if (statusOptionNames.includes(normalizedStatus)) {
    return normalizedStatus;
  }

  const legacyStatus = legacyStatusMap[normalizedStatus];
  if (legacyStatus && statusOptionNames.includes(legacyStatus)) {
    return legacyStatus;
  }

  if (statusOptionNames.includes("planning")) {
    return "planning";
  }

  if (statusOptionNames.includes(legacyStatusMap.planning)) {
    return legacyStatusMap.planning;
  }

  return normalizedStatus;
}

function normalizePayload(payload, statusOptionNames = []) {
  const normalizedStatus = normalizeStatus(payload.status);
  return {
    ...payload,
    status: resolveStatusOptionName(normalizedStatus, statusOptionNames)
  };
}

async function getDatabaseStatusOptionNames(notionApiKey, databaseId) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${notionApiKey}`,
      "Notion-Version": NOTION_VERSION
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      statusOptionNames: [],
      databaseProperties: null
    };
  }

  const options = data?.properties?.[propertyMap.status]?.status?.options;
  const statusOptionNames = Array.isArray(options)
    ? options
      .map((option) => option?.name)
      .filter(Boolean)
    : [];

  return {
    statusOptionNames,
    databaseProperties: data?.properties || null
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasObjectItem(values) {
  return values.some((item) => item !== null && typeof item === "object");
}

function formatObject(value, indent = "") {
  return Object.entries(value)
    .map(([key, item]) => {
      const formatted = toText(item, `${indent}  `);
      if (formatted.includes("\n")) {
        return `${indent}${key}:\n${formatted}`;
      }
      return `${indent}${key}: ${formatted}`;
    })
    .join("\n");
}

function toText(value, indent = "") {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    if (!hasObjectItem(value)) {
      return value.map((item) => String(item)).join("\n");
    }

    return value
      .map((item, index) => {
        const formatted = toText(item, `${indent}  `);
        if (formatted.includes("\n")) {
          return `${indent}${index + 1}.\n${formatted}`;
        }
        return `${indent}${index + 1}. ${formatted}`;
      })
      .join("\n\n");
  }
  if (isPlainObject(value)) return formatObject(value, indent);
  return String(value);
}

function richText(value) {
  const text = toText(value);
  if (!text) return [];

  const chunks = [];
  for (let index = 0; index < text.length && chunks.length < MAX_RICH_TEXT_CHUNKS; index += MAX_RICH_TEXT_CHUNK) {
    chunks.push({
      type: "text",
      text: {
        content: text.slice(index, index + MAX_RICH_TEXT_CHUNK)
      }
    });
  }
  return chunks;
}

function multiSelect(value) {
  const values = Array.isArray(value) ? value : String(value).split(",");
  return values
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

function hasDatabaseProperty(databaseProperties, notionPropertyName) {
  if (!databaseProperties) return true;
  return Object.prototype.hasOwnProperty.call(databaseProperties, notionPropertyName);
}

function getMappedValue(payload, jsonKey) {
  const candidateKeys = [jsonKey, ...(propertyAliases[jsonKey] || [])];
  for (const candidateKey of candidateKeys) {
    if (!isMissing(payload[candidateKey])) {
      return payload[candidateKey];
    }
  }
  return "";
}

function assignRichTextProperty(properties, databaseProperties, notionPropertyName, value) {
  if (!hasDatabaseProperty(databaseProperties, notionPropertyName)) return;
  properties[notionPropertyName] = {
    rich_text: richText(value)
  };
}

function buildPageProperties(payload, databaseProperties = null) {
  const properties = {
    [propertyMap.project_title]: {
      title: richText(payload.project_title)
    },
    [propertyMap.project_category]: {
      select: {
        name: String(payload.project_category).trim()
      }
    },
    [propertyMap.status]: {
      status: {
        name: String(payload.status).trim()
      }
    },
    [propertyMap.tools_used]: {
      multi_select: multiSelect(payload.tools_used)
    }
  };

  assignRichTextProperty(
    properties,
    databaseProperties,
    "JSON原文",
    JSON.stringify(payload, null, 2)
  );

  for (const [jsonKey, notionPropertyName] of Object.entries(propertyMap)) {
    if (["project_title", "project_category", "status", "tools_used"].includes(jsonKey)) {
      continue;
    }
    assignRichTextProperty(
      properties,
      databaseProperties,
      notionPropertyName,
      getMappedValue(payload, jsonKey)
    );
  }

  for (const [jsonKey, notionPropertyName] of Object.entries(additionalPropertyMap)) {
    assignRichTextProperty(
      properties,
      databaseProperties,
      notionPropertyName,
      payload[jsonKey]
    );
  }

  return properties;
}

function buildJsonChildren(payload) {
  const rawJson = JSON.stringify(payload, null, 2);
  const blocks = [
    {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "JSON原文" } }]
      }
    }
  ];

  for (let index = 0; index < rawJson.length; index += MAX_RICH_TEXT_CHUNK) {
    blocks.push({
      object: "block",
      type: "code",
      code: {
        language: "json",
        rich_text: [
          {
            type: "text",
            text: {
              content: rawJson.slice(index, index + MAX_RICH_TEXT_CHUNK)
            }
          }
        ]
      }
    });
  }

  return blocks.slice(0, 100);
}

function checkAuthorization(request, expectedToken) {
  if (!expectedToken) return false;
  const authorization = request.headers.get("Authorization") || "";
  return authorization === `Bearer ${expectedToken}`;
}

async function createNotionPage(payload, notionApiKey, databaseId) {
  const { statusOptionNames, databaseProperties } = await getDatabaseStatusOptionNames(notionApiKey, databaseId);
  const normalizedPayload = normalizePayload(payload, statusOptionNames);
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${notionApiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION
    },
    body: JSON.stringify({
      parent: {
        type: "database_id",
        database_id: databaseId
      },
      properties: buildPageProperties(normalizedPayload, databaseProperties),
      children: buildJsonChildren(normalizedPayload)
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.message || "Notion page creation failed.";
    throw new Error(message);
  }

  return {
    page_id: data.id,
    url: data.url
  };
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  const notionApiKey = env("NOTION_API_KEY");
  const databaseId = env("NOTION_DATABASE_ID");
  const saveToken = env("LUPRO_KNOWLEDGE_SAVE_TOKEN");

  if (!checkAuthorization(request, saveToken)) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  if (!notionApiKey || !databaseId) {
    return jsonResponse(500, {
      error: "Server configuration is incomplete. Required Notion environment variables are missing."
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const missingFields = validateRequiredFields(payload);
  if (missingFields.length > 0) {
    return jsonResponse(400, {
      error: "Required fields are missing.",
      missing_fields: missingFields
    });
  }

  try {
    const result = await createNotionPage(payload, notionApiKey, databaseId);
    return jsonResponse(200, {
      message: "Saved to Notion.",
      ...result
    });
  } catch (error) {
    return jsonResponse(502, {
      error: "Failed to save to Notion.",
      message: error.message
    });
  }
};
