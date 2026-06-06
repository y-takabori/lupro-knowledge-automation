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

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
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

async function main() {
  const notionApiKey = requiredEnv("NOTION_API_KEY");
  const parentPageId = requiredEnv("NOTION_PARENT_PAGE_ID");

  const response = await fetch("https://api.notion.com/v1/databases", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${notionApiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION
    },
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

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.message || "Failed to create Notion database.";
    throw new Error(`Notion database creation failed: ${message}`);
  }

  console.log(JSON.stringify({
    message: "Notion database created.",
    database_id: data.id,
    url: data.url
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
