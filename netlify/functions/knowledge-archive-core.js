import crypto from "node:crypto";

export const knowledgeTypeFolders = {
  tools: "tools",
  strategy: "strategy",
  content: "content",
  memo: "memo",
  notes: "notes",
  content_strategy: "content-strategy",
  projects: "projects",
  marketing: "marketing",
  sales: "sales",
  operations: "operations",
  client_work: "client-work",
  internal_rules: "internal-rules",
  learnings: "learnings",
  other: "other"
};

const statuses = new Set([
  "draft",
  "saved",
  "active",
  "in_progress",
  "completed",
  "article_candidate",
  "published",
  "archived"
]);

const saveModes = new Set(["new", "update", "upsert"]);
const inputTypes = new Set(["markdown", "json", "plain_text", "url", "file"]);

const jsonMarkdownFields = [
  ["background_issue", "背景"],
  ["user_pain_points", "悩み・迷い"],
  ["what_user_wanted_to_achieve", "実現したいこと"],
  ["decision_reasons", "判断理由"],
  ["implementation_summary", "実装内容"],
  ["implementation_details", "実装詳細"],
  ["stuck_points", "詰まったこと"],
  ["actual_effects", "実際の効果"],
  ["things_to_prepare_before_starting", "事前にやっておくべきこと"],
  ["lessons_for_other_companies", "他社にも応用できる学び"],
  ["wordpress_article_angles", "WordPress"],
  ["note_article_angles", "note"],
  ["x_threads_post_ideas", "X / Threads"],
  ["private_or_sensitive_info_to_hide", "公開時に伏せる情報"],
  ["security_notes", "セキュリティメモ"],
  ["future_improvement_ideas", "今後の改善"],
  ["article_main_message", "記事の主張"],
  ["media_theme", "メディアテーマ"],
  ["supporting_themes", "補助テーマ"],
  ["knowledge_detail", "詳細ナレッジ"],
  ["facts", "事実"],
  ["inferences", "推論"],
  ["options_considered", "検討した選択肢"],
  ["human_review_points", "人間の確認ポイント"]
];

export function env(name) {
  if (globalThis.Netlify?.env?.get) {
    return Netlify.env.get(name);
  }
  return process.env[name];
}

export function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...extraHeaders
    }
  });
}

export function parseTools(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function nowJst(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+09:00`;
}

export function timestampForPath(isoJst) {
  return isoJst
    .replace("+09:00", "")
    .replaceAll("-", "")
    .replace("T", "-")
    .replaceAll(":", "");
}

export function updateTimestampForPath(isoJst) {
  return isoJst
    .replace("+09:00", "")
    .replace("T", "-")
    .replaceAll(":", "");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function formatValue(value, indent = "") {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return value
      .map((item) => {
        const formatted = formatValue(item, `${indent}  `);
        return formatted.includes("\n")
          ? `${indent}-\n${formatted}`
          : `${indent}- ${formatted}`;
      })
      .join("\n");
  }
  if (isPlainObject(value)) {
    return Object.entries(value)
      .map(([key, item]) => {
        const formatted = formatValue(item, `${indent}  `);
        return formatted.includes("\n")
          ? `${indent}${key}:\n${formatted}`
          : `${indent}${key}: ${formatted}`;
      })
      .join("\n");
  }
  return String(value);
}

export function stripCodeFences(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function normalizeSmartQuotes(text) {
  return String(text || "")
    .replaceAll("\u201c", "\"")
    .replaceAll("\u201d", "\"")
    .replaceAll("\u201e", "\"")
    .replaceAll("\u201f", "\"")
    .replaceAll("\u301d", "\"")
    .replaceAll("\u301e", "\"")
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'");
}

export function extractJsonCandidate(text) {
  const normalized = normalizeSmartQuotes(stripCodeFences(text));
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start === -1 || end === -1 || start > end) return normalized;
  return normalized.slice(start, end + 1).trim();
}

export function parseFlexibleJson(text) {
  const candidate = extractJsonCandidate(text);
  try {
    const parsed = JSON.parse(candidate);
    return {
      valid: true,
      parsed,
      formatted: JSON.stringify(parsed, null, 2),
      candidate
    };
  } catch (error) {
    return {
      valid: false,
      parsed: null,
      formatted: candidate,
      candidate,
      error: error.message
    };
  }
}

function shortHash(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 8);
}

export function slugifyTitle(title, fallbackSource = "") {
  const ascii = String(title || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  if (ascii) return ascii;
  const current = nowJst();
  const stamp = `${current.slice(0, 10).replaceAll("-", "")}-${current.slice(11, 16).replace(":", "")}`;
  return `${stamp}-${shortHash(`${title}:${fallbackSource}`)}`;
}

function genericProjectKey(value) {
  return ["", "slack", "json", "markdown", "text", "memo", "note", "untitled"].includes(String(value || "").toLowerCase());
}

export function detectInputType(text, fileName = "") {
  const name = String(fileName || "").toLowerCase();
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (name.endsWith(".txt")) return "plain_text";
  const trimmed = String(text || "").trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return "url";
  const json = parseFlexibleJson(trimmed);
  if (trimmed.includes("{") && trimmed.includes("}") && (json.valid || /^```json/i.test(trimmed))) return "json";
  if (/^#{1,6}\s+/m.test(trimmed) || /```/.test(trimmed) || /\n[-*]\s+/.test(trimmed)) return "markdown";
  return "plain_text";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
}

export function extractKnownTools(text, explicitTools = "") {
  const tools = new Set(parseTools(explicitTools));
  const candidates = [
    "ChatGPT",
    "Codex",
    "GitHub",
    "Netlify",
    "Slack",
    "Notion",
    "Google Sheets",
    "WordPress",
    "note",
    "X",
    "Threads"
  ];
  for (const tool of candidates) {
    const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i").test(String(text || ""))) {
      tools.add(tool);
    }
  }
  return [...tools];
}

export function detectSensitiveWarnings(text) {
  const warnings = [];
  const source = String(text || "");
  if (/(api[_-]?key|secret|token|bearer\s+[a-z0-9._-]+)/i.test(source)) warnings.push("APIキー、secret、tokenらしき文字列が含まれている可能性があります。");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(source)) warnings.push("メールアドレスらしき文字列が含まれている可能性があります。");
  if (/(¥|￥|\$)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*\s?(円|万円|ドル)/.test(source)) warnings.push("金額情報らしき文字列が含まれている可能性があります。");
  if (/(株式会社|有限会社|合同会社|Inc\.|LLC|顧客|クライアント)/i.test(source)) warnings.push("顧客名や会社名らしき情報が含まれている可能性があります。");
  return warnings;
}

export function buildAutoKnowledgePayload({ text, fileName = "", source = "slack_event", slack = {} }) {
  const body = String(text || "").trim();
  const inputType = detectInputType(body, fileName);
  const jsonResult = inputType === "json" ? parseFlexibleJson(body) : null;
  const parsed = jsonResult?.valid && isPlainObject(jsonResult.parsed) ? jsonResult.parsed : {};
  const heading = body.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
  const plainTitle = body.split(/\r?\n/).find((line) => line.trim())?.replace(/^[-*#\s]+/, "").trim();
  const title = String(firstNonEmpty(
    parsed.project_title,
    parsed.title,
    heading,
    plainTitle ? plainTitle.slice(0, 50) : ""
  ) || "untitled").trim();
  const category = String(firstNonEmpty(parsed.project_category, parsed.category, "未分類"));
  const rawStatus = String(firstNonEmpty(parsed.status, "saved"));
  const status = statuses.has(rawStatus) ? rawStatus : "saved";
  const summary = String(firstNonEmpty(parsed.implementation_summary, parsed.summary, parsed.article_main_message, body.slice(0, 160)));
  const rawKnowledgeType = String(firstNonEmpty(parsed.knowledge_type, parsed.type, "notes"));
  const knowledgeType = knowledgeTypeFolders[rawKnowledgeType] ? rawKnowledgeType : "notes";
  let projectKey = "";
  let projectKeySource = "";
  if (firstNonEmpty(parsed.project_key)) {
    projectKey = String(parsed.project_key);
    projectKeySource = "json.project_key";
  } else {
    projectKey = slugifyTitle(title, body);
    projectKeySource = heading
      ? "markdown_heading"
      : parsed.project_title
        ? "json.project_title"
        : parsed.title
          ? "json.title"
          : "title_or_body_hash";
  }
  if (!firstNonEmpty(parsed.project_key) && genericProjectKey(projectKey)) {
    projectKey = slugifyTitle("", body);
    projectKeySource = "body_hash";
  }
  const tools = extractKnownTools(body, parsed.tools_used || parsed.tools || "");
  const warnings = detectSensitiveWarnings(body);

  return {
    title,
    knowledge_type: knowledgeType,
    project_key: projectKey,
    project_key_source: projectKeySource,
    category,
    status,
    tools,
    summary,
    input_type: inputType,
    body,
    save_mode: "upsert",
    source,
    slack_channel: slack.channel || "",
    slack_ts: slack.ts || "",
    slack_message_url: slack.message_url || "",
    slack_event_id: slack.event_id || "",
    json_parse_warning: inputType === "json" && jsonResult && !jsonResult.valid
      ? "JSONとしては壊れていますが、原文保存しました。"
      : "",
    warnings,
    extracted: {
      private_or_sensitive_info_to_hide: parsed.private_or_sensitive_info_to_hide || warnings,
      media_theme: parsed.media_theme || "",
      article_main_message: parsed.article_main_message || "",
      content_strategy: parsed.content_strategy || "",
      wordpress_article_angles: parsed.wordpress_article_angles || "",
      note_article_angles: parsed.note_article_angles || "",
      x_threads_post_ideas: parsed.x_threads_post_ideas || ""
    }
  };
}

function yamlQuote(value) {
  return JSON.stringify(String(value || ""));
}

function markdownSection(title, value) {
  const formatted = formatValue(value).trim();
  return `## ${title}\n\n${formatted || "_未入力_"}`;
}

function normalizeJsonPayload(parsedJson, payload) {
  return {
    ...payload,
    title: payload.title || parsedJson.project_title || "",
    category: payload.category || parsedJson.project_category || "",
    status: payload.status || parsedJson.status || "draft",
    tools: parseTools(payload.tools).length ? payload.tools : parsedJson.tools_used || "",
    summary: payload.summary || parsedJson.implementation_summary || parsedJson.article_main_message || ""
  };
}

export function normalizeKnowledgePayload(input) {
  const payload = {
    title: String(input.title || "").trim(),
    knowledge_type: String(input.knowledge_type || "other").trim(),
    project_key: String(input.project_key || "").trim(),
    category: String(input.category || "").trim(),
    status: String(input.status || "draft").trim(),
    tools: parseTools(input.tools),
    summary: String(input.summary || "").trim(),
    input_type: String(input.input_type || "plain_text").trim(),
    body: String(input.body ?? input.body_short ?? "").trim(),
    save_mode: String(input.save_mode || "upsert").trim(),
    source: String(input.source || "web").trim(),
    file_reference: String(input.file_reference || "").trim(),
    project_key_source: String(input.project_key_source || "").trim(),
    slack_channel: String(input.slack_channel || "").trim(),
    slack_ts: String(input.slack_ts || "").trim(),
    slack_message_url: String(input.slack_message_url || "").trim(),
    slack_event_id: String(input.slack_event_id || "").trim(),
    json_parse_warning: String(input.json_parse_warning || "").trim(),
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    extracted: isPlainObject(input.extracted) ? input.extracted : {}
  };

  const errors = [];
  if (!payload.title) errors.push("title is required.");
  if (!knowledgeTypeFolders[payload.knowledge_type]) errors.push("knowledge_type is invalid.");
  if (!/^[a-zA-Z0-9-]+$/.test(payload.project_key)) {
    errors.push("project_key must contain only half-width letters, numbers, and hyphens.");
  }
  if (!statuses.has(payload.status)) errors.push("status is invalid.");
  if (!inputTypes.has(payload.input_type)) errors.push("input_type is invalid.");
  if (!saveModes.has(payload.save_mode)) errors.push("save_mode is invalid.");
  if (!payload.body && !payload.file_reference) errors.push("body or file_reference is required.");

  return { payload, errors };
}

function parseJsonInput(body) {
  return parseFlexibleJson(body);
}

function buildMarkdown(payload, options) {
  const { created, updated, parsedJson, jsonValid, jsonError, updateLinks } = options;
  const normalized = parsedJson ? normalizeJsonPayload(parsedJson, payload) : payload;
  const tools = parseTools(normalized.tools);
  const frontmatterTools = tools.length
    ? tools.map((tool) => `  - ${yamlQuote(tool)}`).join("\n")
    : "  - \"\"";
  const bodySections = [
    markdownSection("概要", normalized.summary),
    markdownSection("背景", parsedJson?.background_issue),
    markdownSection("悩み・迷い", parsedJson?.user_pain_points),
    markdownSection("実現したいこと", parsedJson?.what_user_wanted_to_achieve),
    markdownSection("判断理由", parsedJson?.decision_reasons),
    markdownSection("実装内容", parsedJson?.implementation_summary || normalized.body),
    markdownSection("詰まったこと", parsedJson?.stuck_points),
    markdownSection("解決策", parsedJson?.solution),
    markdownSection("実際の効果", parsedJson?.actual_effects),
    markdownSection("事前にやっておくべきこと", parsedJson?.things_to_prepare_before_starting),
    markdownSection("他社にも応用できる学び", parsedJson?.lessons_for_other_companies),
    "## 記事化案\n\n" +
      [
        markdownSection("WordPress", parsedJson?.wordpress_article_angles),
        markdownSection("note", parsedJson?.note_article_angles),
        markdownSection("X / Threads", parsedJson?.x_threads_post_ideas)
      ].join("\n\n"),
    markdownSection(
      "公開時に伏せる情報",
      parsedJson?.private_or_sensitive_info_to_hide || [
        "APIキー",
        "トークン",
        "認証情報",
        "顧客情報",
        "個人情報",
        "金額情報"
      ]
    ),
    markdownSection("今後の改善", parsedJson?.future_improvement_ideas)
  ];

  const extraJsonSections = parsedJson
    ? jsonMarkdownFields
      .filter(([key]) => !bodySections.join("\n").includes(formatValue(parsedJson[key]).trim()))
      .map(([key, label]) => parsedJson[key] ? markdownSection(label, parsedJson[key]) : "")
      .filter(Boolean)
    : [];

  const rawNote = payload.input_type === "json" && !jsonValid
    ? `JSONとしては未検証です。パースエラー: ${jsonError || "unknown"}`
    : "詳細な元データは raw.json または raw.txt を確認してください。";

  const history = updateLinks.length
    ? updateLinks.map((link) => `- [${link.label}](${link.path})`).join("\n")
    : "- 初回作成";

  return `---\ntitle: ${yamlQuote(normalized.title)}\nproject_key: ${yamlQuote(normalized.project_key)}\nknowledge_type: ${yamlQuote(normalized.knowledge_type)}\ncategory: ${yamlQuote(normalized.category)}\nstatus: ${yamlQuote(normalized.status)}\ntools:\n${frontmatterTools}\nsource: ${yamlQuote(normalized.source)}\ncreated: ${yamlQuote(created)}\nupdated: ${yamlQuote(updated)}\n---\n\n# ${normalized.title}\n\n${bodySections.join("\n\n")}\n\n${extraJsonSections.join("\n\n")}\n\n## 更新履歴\n\n${history}\n\n## 元データ\n\n${rawNote}\n`;
}

function buildUpdateMarkdown(payload, updated, parsedJson, jsonValid, jsonError) {
  const title = payload.title || parsedJson?.project_title || payload.project_key;
  const rawNote = payload.input_type === "json" && !jsonValid
    ? `JSONとしては未検証です。パースエラー: ${jsonError || "unknown"}`
    : "この更新の元データは同時刻の raw-* ファイルを確認してください。";
  return `---\ntitle: ${yamlQuote(title)}\nproject_key: ${yamlQuote(payload.project_key)}\nknowledge_type: ${yamlQuote(payload.knowledge_type)}\nstatus: ${yamlQuote(payload.status)}\nsource: ${yamlQuote(payload.source)}\nupdated: ${yamlQuote(updated)}\n---\n\n# ${title}\n\n${markdownSection("概要", payload.summary)}\n\n${markdownSection("更新内容", parsedJson ? parsedJson : payload.body)}\n\n## 元データ\n\n${rawNote}\n`;
}

function refreshExistingMarkdown(content, updated, updateLinks) {
  const history = updateLinks.length
    ? updateLinks.map((link) => `- [${link.label}](${link.path})`).join("\n")
    : "- 初回作成";
  let next = content.replace(/^updated: .+$/m, `updated: ${yamlQuote(updated)}`);
  if (next.includes("## 更新履歴")) {
    next = next.replace(/## 更新履歴\n\n[\s\S]*?(?=\n## 元データ|\n*$)/, `## 更新履歴\n\n${history}\n`);
  } else {
    next = `${next.trim()}\n\n## 更新履歴\n\n${history}\n`;
  }
  return next.endsWith("\n") ? next : `${next}\n`;
}

function base64(content) {
  return Buffer.from(content, "utf8").toString("base64");
}

export class GitHubContentsClient {
  constructor({ token, owner, repo, branch }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || "main";
    this.baseUrl = `https://api.github.com/repos/${owner}/${repo}/contents`;
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}/${path}`, {
      ...options,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 404) {
      throw new Error(data?.message || `GitHub API failed for ${path}.`);
    }
    return { response, data };
  }

  async getFile(path) {
    const { response, data } = await this.request(`${path}?ref=${encodeURIComponent(this.branch)}`, {
      method: "GET"
    });
    if (response.status === 404) return null;
    const content = data.content
      ? Buffer.from(String(data.content).replace(/\n/g, ""), "base64").toString("utf8")
      : "";
    return { sha: data.sha, content, html_url: data.html_url };
  }

  async putFile(path, content, message) {
    const current = await this.getFile(path);
    const body = {
      message,
      content: base64(content),
      branch: this.branch
    };
    if (current?.sha) body.sha = current.sha;
    const { data } = await this.request(path, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    return data?.content || {};
  }
}

function requireGitHubConfig() {
  const config = {
    token: env("GITHUB_TOKEN"),
    owner: env("GITHUB_OWNER"),
    repo: env("GITHUB_REPO"),
    branch: env("GITHUB_BRANCH") || "main"
  };
  const missing = Object.entries(config)
    .filter(([key, value]) => key !== "branch" && !value)
    .map(([key]) => `GITHUB_${key.toUpperCase()}`);
  if (missing.length) {
    throw new Error(`Missing GitHub environment variables: ${missing.join(", ")}`);
  }
  return config;
}

function buildMetadata(payload, created, updated, paths, existingMetadata = null) {
  return {
    title: payload.title,
    project_key: payload.project_key,
    project_key_source: payload.project_key_source || existingMetadata?.project_key_source || "",
    knowledge_type: payload.knowledge_type,
    category: payload.category,
    status: payload.status,
    tools: parseTools(payload.tools),
    summary: payload.summary,
    source: payload.source,
    input_type: payload.input_type,
    save_mode: payload.save_mode,
    path: paths.indexPath,
    raw_json_path: paths.rawJsonPath,
    raw_md_path: paths.rawMdPath,
    raw_txt_path: paths.rawTxtPath,
    raw_path: paths.rawPath,
    created: existingMetadata?.created || created,
    updated,
    slack_channel: payload.slack_channel || existingMetadata?.slack_channel || "",
    slack_message_url: payload.slack_message_url || existingMetadata?.slack_message_url || "",
    warnings: payload.warnings || existingMetadata?.warnings || [],
    extracted: payload.extracted || existingMetadata?.extracted || {}
  };
}

function indexEntry(metadata) {
  return {
    title: metadata.title,
    project_key: metadata.project_key,
    knowledge_type: metadata.knowledge_type,
    category: metadata.category,
    status: metadata.status,
    tools: metadata.tools,
    summary: metadata.summary,
    path: metadata.path,
    raw_json_path: metadata.raw_json_path,
    raw_md_path: metadata.raw_md_path,
    raw_txt_path: metadata.raw_txt_path,
    raw_path: metadata.raw_path,
    created: metadata.created,
    updated: metadata.updated
  };
}

async function updateGlobalIndex(client, metadata) {
  const indexPath = "knowledge/index.json";
  const current = await client.getFile(indexPath);
  let entries = [];
  if (current?.content) {
    try {
      entries = JSON.parse(current.content);
    } catch {
      entries = [];
    }
  }
  const nextEntry = indexEntry(metadata);
  const existingIndex = entries.findIndex((entry) =>
    entry.knowledge_type === nextEntry.knowledge_type &&
    entry.project_key === nextEntry.project_key
  );
  if (existingIndex >= 0) {
    entries[existingIndex] = { ...entries[existingIndex], ...nextEntry };
  } else {
    entries.push(nextEntry);
  }
  entries.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  await client.putFile(indexPath, `${JSON.stringify(entries, null, 2)}\n`, `Update knowledge index for ${metadata.project_key}`);
}

export async function saveKnowledgeToGitHub(input) {
  const normalized = normalizeKnowledgePayload(input);
  if (normalized.errors.length) {
    const error = new Error(normalized.errors.join(" "));
    error.status = 400;
    throw error;
  }

  let payload = normalized.payload;
  const folder = knowledgeTypeFolders[payload.knowledge_type];
  const basePath = `knowledge/${folder}/${payload.project_key}`;
  const paths = {
    indexPath: `${basePath}/index.md`,
    rawJsonPath: `${basePath}/raw.json`,
    rawMdPath: `${basePath}/raw.md`,
    rawTxtPath: `${basePath}/raw.txt`,
    metadataPath: `${basePath}/metadata.json`
  };
  const updated = nowJst();
  const rawStamp = timestampForPath(updated);
  const updateStamp = updateTimestampForPath(updated);
  const client = new GitHubContentsClient(requireGitHubConfig());
  const existingIndex = await client.getFile(paths.indexPath);
  const exists = Boolean(existingIndex);

  if (payload.save_mode === "new" && exists) {
    const error = new Error("Knowledge already exists. Use save_mode update or upsert.");
    error.status = 409;
    throw error;
  }

  const metadataFile = await client.getFile(paths.metadataPath);
  let existingMetadata = null;
  if (metadataFile?.content) {
    try {
      existingMetadata = JSON.parse(metadataFile.content);
    } catch {
      existingMetadata = null;
    }
  }

  const jsonResult = payload.input_type === "json" ? parseJsonInput(payload.body) : null;
  if (jsonResult?.valid && isPlainObject(jsonResult.parsed)) {
    payload = normalizeJsonPayload(jsonResult.parsed, payload);
  }

  const created = existingMetadata?.created || updated;
  const isUpdate = exists && (payload.save_mode === "update" || payload.save_mode === "upsert");
  const updatePath = `${basePath}/updates/${updateStamp}.md`;
  const updateLinks = isUpdate ? [{ label: updateStamp, path: `updates/${updateStamp}.md` }] : [];
  const existingUpdateLinks = existingIndex?.content
    ? Array.from(existingIndex.content.matchAll(/- \[([^\]]+)\]\((updates\/[^)]+)\)/g))
      .map((match) => ({ label: match[1], path: match[2] }))
    : [];
  const allUpdateLinks = [...existingUpdateLinks, ...updateLinks];

  const rawJsonPath = isUpdate ? `${basePath}/raw-${rawStamp}.json` : paths.rawJsonPath;
  const rawMdPath = isUpdate ? `${basePath}/raw-${rawStamp}.md` : paths.rawMdPath;
  const rawTxtPath = isUpdate ? `${basePath}/raw-${rawStamp}.txt` : paths.rawTxtPath;
  let rawPath = rawTxtPath;

  if (isUpdate) {
    const updateMarkdown = buildUpdateMarkdown(
      payload,
      updated,
      jsonResult?.parsed,
      jsonResult?.valid ?? true,
      jsonResult?.error
    );
    await client.putFile(updatePath, updateMarkdown, `Add knowledge update for ${payload.project_key}`);
  }

  if (payload.input_type === "json") {
    if (jsonResult.valid) {
      await client.putFile(rawJsonPath, `${jsonResult.formatted}\n`, `Save raw JSON for ${payload.project_key}`);
      rawPath = rawJsonPath;
    } else {
      await client.putFile(rawTxtPath, `${payload.body}\n`, `Save unverified JSON text for ${payload.project_key}`);
      rawPath = rawTxtPath;
    }
  } else if (payload.input_type === "markdown") {
    await client.putFile(rawMdPath, `${payload.body}\n`, `Save raw Markdown for ${payload.project_key}`);
    rawPath = rawMdPath;
  } else {
    await client.putFile(rawTxtPath, `${payload.body}\n`, `Save raw text for ${payload.project_key}`);
    rawPath = rawTxtPath;
  }

  const markdown = isUpdate && existingIndex?.content
    ? refreshExistingMarkdown(existingIndex.content, updated, allUpdateLinks)
    : buildMarkdown(payload, {
      created,
      updated,
      parsedJson: jsonResult?.valid ? jsonResult.parsed : null,
      jsonValid: jsonResult?.valid ?? true,
      jsonError: jsonResult?.error,
      updateLinks: allUpdateLinks
    });
  const indexFile = await client.putFile(paths.indexPath, markdown, `Save knowledge markdown for ${payload.project_key}`);
  const metadata = buildMetadata(payload, created, updated, {
    ...paths,
    rawJsonPath: payload.input_type === "json" && jsonResult?.valid ? rawJsonPath : paths.rawJsonPath,
    rawMdPath: payload.input_type === "markdown" ? rawMdPath : paths.rawMdPath,
    rawTxtPath: payload.input_type === "json" && jsonResult?.valid ? paths.rawTxtPath : rawTxtPath,
    rawPath
  }, existingMetadata);

  await client.putFile(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, `Save metadata for ${payload.project_key}`);
  await updateGlobalIndex(client, metadata);

  const htmlBase = `https://github.com/${env("GITHUB_OWNER")}/${env("GITHUB_REPO")}/blob/${env("GITHUB_BRANCH") || "main"}`;
  return {
    message: "Saved knowledge to GitHub.",
    title: payload.title,
    knowledge_type: payload.knowledge_type,
    project_key: payload.project_key,
    project_key_source: metadata.project_key_source,
    save_mode: payload.save_mode,
    index_path: paths.indexPath,
    raw_json_path: metadata.raw_json_path,
    raw_md_path: metadata.raw_md_path,
    raw_txt_path: metadata.raw_txt_path,
    raw_path: metadata.raw_path,
    metadata_path: paths.metadataPath,
    created: metadata.created,
    updated: metadata.updated,
    index_url: indexFile.html_url || `${htmlBase}/${paths.indexPath}`,
    raw_json_url: `${htmlBase}/${metadata.raw_json_path}`,
    raw_md_url: `${htmlBase}/${metadata.raw_md_path}`,
    raw_txt_url: `${htmlBase}/${metadata.raw_txt_path}`,
    raw_url: `${htmlBase}/${metadata.raw_path}`,
    json_parse_warning: payload.json_parse_warning || ""
  };
}

export function verifySlackSignature({ signingSecret, timestamp, signature, rawBody }) {
  if (!signingSecret || !timestamp || !signature) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${crypto.createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}
