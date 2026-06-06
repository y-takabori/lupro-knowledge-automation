const NOTION_VERSION = "2022-06-28";
const DATABASE_TITLE = "LUPRO実践ナレッジDB";

const textPropertyNames = [
  "背景課題",
  "実現したいこと",
  "悩み・迷い",
  "実装内容",
  "判断理由",
  "詰まったこと",
  "解決策",
  "実際の効果",
  "事前にやっておくべきこと",
  "他社にも応用できる学び",
  "WordPress記事化の切り口",
  "note記事化の切り口",
  "X/Threads投稿案",
  "公開時に伏せるべき情報",
  "セキュリティメモ",
  "JSON原文"
];

const statusOptionIds = {
  draft: "11111111-1111-4111-8111-111111111111",
  testing: "22222222-2222-4222-8222-222222222222",
  saved: "33333333-3333-4333-8333-333333333333",
  articleCandidate: "44444444-4444-4444-8444-444444444444"
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

function checkAuthorization(request, expectedToken) {
  if (!expectedToken) return false;
  const authorization = request.headers.get("Authorization") || "";
  return authorization === `Bearer ${expectedToken}`;
}

function plainTitle(database) {
  return (database.title || []).map((item) => item.plain_text || "").join("");
}

function isSameParent(database, parentPageId) {
  return database.parent?.type === "page_id" && database.parent?.page_id === parentPageId;
}

function buildProperties() {
  const properties = {
    "タイトル": { title: {} },
    "カテゴリ": {
      select: {
        options: [
          { name: "業務改善", color: "blue" },
          { name: "ナレッジ化", color: "green" },
          { name: "自動化", color: "purple" }
        ]
      }
    },
    "ステータス": {
      status: {
        options: [
          { id: statusOptionIds.draft, name: "下書き", color: "default" },
          { id: statusOptionIds.testing, name: "検証中", color: "yellow" },
          { id: statusOptionIds.saved, name: "保存済み", color: "green" },
          { id: statusOptionIds.articleCandidate, name: "記事化候補", color: "blue" }
        ],
        groups: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "To-do",
            color: "gray",
            option_ids: [statusOptionIds.draft]
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "In progress",
            color: "yellow",
            option_ids: [statusOptionIds.testing]
          },
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            name: "Complete",
            color: "green",
            option_ids: [statusOptionIds.saved, statusOptionIds.articleCandidate]
          }
        ]
      }
    },
    "使用ツール": { multi_select: {} },
    "作成日": { created_time: {} },
    "更新日": { last_edited_time: {} }
  };

  for (const name of textPropertyNames) {
    properties[name] = { rich_text: {} };
  }

  return properties;
}

async function notionRequest(path, notionApiKey, init = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${notionApiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...init.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const code = data?.code || "notion_api_error";
    throw new Error(code);
  }

  return data;
}

async function findExistingDatabase(notionApiKey, parentPageId) {
  const data = await notionRequest("/search", notionApiKey, {
    method: "POST",
    body: JSON.stringify({
      query: DATABASE_TITLE,
      filter: {
        value: "database",
        property: "object"
      },
      page_size: 10
    })
  });

  const exactMatches = (data.results || []).filter((result) => {
    return result.object === "database" && plainTitle(result) === DATABASE_TITLE;
  });

  return exactMatches.find((database) => isSameParent(database, parentPageId)) || exactMatches[0] || null;
}

async function createDatabase(notionApiKey, parentPageId) {
  return notionRequest("/databases", notionApiKey, {
    method: "POST",
    body: JSON.stringify({
      parent: {
        type: "page_id",
        page_id: parentPageId
      },
      title: [
        {
          type: "text",
          text: {
            content: DATABASE_TITLE
          }
        }
      ],
      properties: buildProperties()
    })
  });
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
  const parentPageId = env("NOTION_PARENT_PAGE_ID");
  const saveToken = env("LUPRO_KNOWLEDGE_SAVE_TOKEN");

  if (!checkAuthorization(request, saveToken)) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  if (!notionApiKey || !parentPageId) {
    return jsonResponse(500, {
      error: "Server configuration is incomplete. Required Notion environment variables are missing."
    });
  }

  try {
    const existingDatabase = await findExistingDatabase(notionApiKey, parentPageId);
    const database = existingDatabase || await createDatabase(notionApiKey, parentPageId);

    return jsonResponse(200, {
      message: existingDatabase ? "Notion database already exists." : "Notion database created.",
      database_id: database.id,
      url: database.url,
      created: !existingDatabase
    });
  } catch (error) {
    return jsonResponse(502, {
      error: "Failed to create or find Notion database.",
      message: "Check that the Notion integration is invited to the parent page and the Netlify environment variables are set."
    });
  }
};
