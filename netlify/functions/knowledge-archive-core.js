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
  if (trimmed.includes("{") && trimmed.includes("}")) return "json";
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

function compactText(value, maxLength = 300) {
  const formatted = formatValue(value)
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!formatted) return "";
  return formatted.length > maxLength ? `${formatted.slice(0, maxLength - 1)}…` : formatted;
}

function humanText(value, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return compactText(value) || fallback;
  }
  if (Array.isArray(value)) {
    return compactText(value.map((item) => humanText(item)).filter(Boolean).join(", "), 300) || fallback;
  }
  if (isPlainObject(value)) {
    const preferredKeys = [
      "summary",
      "text",
      "value",
      "name",
      "description",
      "body",
      "implementation_summary",
      "article_main_message",
      "facts",
      "inferences"
    ];
    for (const key of preferredKeys) {
      const extracted = humanText(value[key]);
      if (extracted) return extracted;
    }
    return compactText(value, 300) || fallback;
  }
  return compactText(value) || fallback;
}

function extractYamlFrontmatter(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const match = source.match(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (!item) continue;
    frontmatter[item[1]] = normalizeSmartQuotes(item[2]).replace(/^["']|["']$/g, "").trim();
  }
  return frontmatter;
}

function extractLabeledValue(text, labels) {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`^(?:${escaped})\\s*[:：]\\s*(.+)$`, "im");
  const match = String(text || "").match(pattern);
  return match?.[1]?.trim() || "";
}

function extractLabeledValueClean(text, labels) {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`^(?:${escaped})\\s*[:：]\\s*(.+)$`, "im");
  const match = String(text || "").match(pattern);
  return match?.[1]?.trim() || "";
}

function cleanFrontmatterValue(value) {
  return normalizeSmartQuotes(String(value || ""))
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function extractFrontmatterFields(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;
  if (lines[index]?.trim() !== "---") {
    return { data: {}, detected: false, closed: false, endIndex: 0 };
  }

  const data = {};
  let closed = false;
  let cursor = index + 1;
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    const trimmed = line.trim();
    if (trimmed === "---") {
      closed = true;
      cursor += 1;
      break;
    }
    if (!trimmed && Object.keys(data).length > 0) {
      cursor += 1;
      break;
    }
    if (!trimmed) continue;
    const item = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (!item) {
      if (Object.keys(data).length > 0) break;
      continue;
    }
    data[item[1]] = cleanFrontmatterValue(item[2]);
  }

  return {
    data,
    detected: Object.keys(data).length > 0,
    closed,
    endIndex: cursor
  };
}

function removeFrontmatterBlock(text, frontmatterInfo) {
  if (!frontmatterInfo?.detected) return String(text || "");
  return String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).slice(frontmatterInfo.endIndex).join("\n");
}

function extractLabeledValueSafe(text, labels) {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`^(?:${escaped})\\s*[:：]\\s*(.+)$`, "im");
  const match = String(text || "").match(pattern);
  return match?.[1]?.trim() || "";
}

function markdownHeading(text) {
  const generic = new Set([
    "タイトル案",
    "タイトル",
    "要確認ポイント",
    "概要",
    "本文",
    "メモ",
    "補足",
    "次にやること",
    "公開時に伏せる情報"
  ]);
  const headings = Array.from(String(text || "").matchAll(/^#{1,6}\s+(.+)$/gm))
    .map((match) => match[1].trim())
    .filter(Boolean);
  return headings.find((heading) => !generic.has(heading)) || "";
}

function isGenericSectionLabel(value) {
  return [
    "タイトル案",
    "タイトル",
    "要確認ポイント",
    "概要",
    "本文",
    "メモ",
    "補足",
    "次にやること",
    "公開時に伏せる情報"
  ].includes(String(value || "").trim());
}

function filenameTitle(fileName) {
  return String(fileName || "")
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function keywordSlugTokens(text) {
  const source = String(text || "").toLowerCase();
  const dictionary = [
    [/lupro/i, "lupro"],
    [/\bai\b|AI|ＡＩ/i, "ai"],
    [/実践ログ|会社の資産|資産化/i, "knowledge"],
    [/slack/i, "slack"],
    [/github/i, "github"],
    [/google\s*sheets?|スプレッドシート|シート/i, "sheets"],
    [/json/i, "json"],
    [/markdown|\.md\b/i, "markdown"],
    [/note/i, "note"],
    [/wordpress/i, "wordpress"],
    [/\bx\b|twitter/i, "x"],
    [/threads/i, "threads"],
    [/保存|save/i, "save"],
    [/テスト|test/i, "test"],
    [/長文|long/i, "long"],
    [/添付|ファイル|file/i, "file"],
    [/ナレッジ|knowledge/i, "knowledge"],
    [/業務効率化|効率化|automation/i, "automation"],
    [/管理|management/i, "management"],
    [/改善|改善案|improve|improvement/i, "improvement"],
    [/記事|content|article/i, "content"],
    [/有料|paid/i, "paid"],
    [/マニュアル|manual/i, "manual"],
    [/営業|sales/i, "sales"],
    [/テンプレート|template/i, "template"]
  ];
  const tokens = [];
  for (const [pattern, token] of dictionary) {
    if (pattern.test(source) && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

function slugFromKnownTokens(...values) {
  const tokens = keywordSlugTokens(values.filter(Boolean).join(" "));
  const priority = ["lupro", "ai", "knowledge", "slack", "github", "sheets", "note", "json", "save", "test", "automation", "management", "improvement", "content", "paid", "manual", "sales", "template"];
  const ordered = [
    ...priority.filter((token) => tokens.includes(token)),
    ...tokens.filter((token) => !priority.includes(token))
  ];
  if (ordered.length >= 2) return ordered.slice(0, 5).join("-");
  return "";
}

function slugifyMeaningful(value, fallbackSource = "") {
  const tokenSlug = slugFromKnownTokens(value, fallbackSource);
  if (tokenSlug && /[^\x00-\x7F]/.test(String(value || "")) && !genericProjectKey(tokenSlug)) return tokenSlug;
  if (tokenSlug.split("-").length >= 4 && !genericProjectKey(tokenSlug)) return tokenSlug;
  const ascii = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  if (ascii && !genericProjectKey(ascii)) return ascii;
  if (tokenSlug && !genericProjectKey(tokenSlug)) return tokenSlug;
  return "";
}

function inferCategory(text) {
  const source = String(text || "");
  if (/営業|sales/i.test(source)) return "営業";
  if (/マーケ|marketing|広告|施策/i.test(source)) return "マーケティング";
  if (/WordPress|note|Threads|コンテンツ|記事|発信/i.test(source)) return "コンテンツ";
  if (/Slack|GitHub|Netlify|Google Sheets|スプレッドシート|自動化|AI/i.test(source)) return "AI業務効率化";
  if (/顧客|提案|client/i.test(source)) return "顧客提案";
  return "未分類";
}

function inferCategoryFromText(text) {
  const source = String(text || "");
  const categories = [];
  if (/Slack|GitHub|Netlify|Google Sheets|スプレッドシート|自動化|AI|業務効率化/i.test(source)) {
    categories.push("AI業務効率化");
  }
  if (/ナレッジ|knowledge|保存|管理|index\.json|Markdown|JSON/i.test(source)) {
    categories.push("ナレッジ管理");
  }
  if (/WordPress|note|Threads|X\/Threads|コンテンツ|記事|発信/i.test(source)) {
    categories.push("発信戦略");
  }
  if (/営業|sales/i.test(source)) categories.push("営業");
  if (/マーケ|marketing|広告|施策/i.test(source)) categories.push("マーケティング");
  if (/顧客|提案|client/i.test(source)) categories.push("顧客提案");
  return categories.length ? [...new Set(categories)].slice(0, 3).join(" / ") : "未分類";
}

function inferProjectKey({ parsed, frontmatter, title, titleSource, heading, fileName, body }) {
  const explicit = firstNonEmpty(parsed.project_key, frontmatter.project_key);
  if (explicit) {
    return {
      projectKey: String(explicit).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""),
      source: parsed.project_key ? "json.project_key" : "frontmatter.project_key"
    };
  }
  const titleSlug = slugifyMeaningful(title);
  if (titleSlug) return { projectKey: titleSlug, source: titleSource === "frontmatter.title" ? "frontmatter.title" : "title_slug" };
  const headingSlug = slugifyMeaningful(heading);
  if (headingSlug) return { projectKey: headingSlug, source: "markdown_heading_slug" };
  const fileSlug = slugifyMeaningful(filenameTitle(fileName));
  if (fileSlug) return { projectKey: fileSlug, source: "file_name_slug" };
  const keywordSlug = slugFromKnownTokens(title, heading, fileName, body);
  if (keywordSlug && !genericProjectKey(keywordSlug)) return { projectKey: keywordSlug, source: "keyword_slug" };
  return { projectKey: slugifyTitle("", `${title}:${fileName}:${body}`), source: "fallback_hash" };
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

function buildAutoKnowledgePayloadLegacy({ text, fileName = "", supplementalText = "", source = "slack_event", slack = {} }) {
  const body = String(text || "").trim();
  const supplemental = String(supplementalText || "").trim();
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
  const warnings = detectSensitiveWarnings(`${body}\n${supplemental}`);
  const hasAttachment = Boolean(slack.file_name || fileName);
  const sourceType = slack.source_type || (
    hasAttachment && supplemental ? "slack_text_and_file" :
      hasAttachment ? "slack_file" :
        source === "web" ? "web_paste" : "slack_text"
  );

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
    supplemental_text: supplemental,
    save_mode: "upsert",
    source,
    source_type: sourceType,
    file_name: slack.file_name || fileName || "",
    file_size: Number(slack.file_size || 0) || 0,
    char_count: body.length,
    has_attachment: hasAttachment,
    has_supplemental_text: Boolean(supplemental),
    parsed_json_available: Boolean(jsonResult?.valid),
    slack_channel: slack.channel || "",
    slack_ts: slack.ts || "",
    slack_user: slack.user || "",
    slack_message_url: slack.message_url || "",
    slack_event_id: slack.event_id || "",
    json_parse_warning: inputType === "json" && jsonResult && !jsonResult.valid
      ? "JSONとしては壊れていますが、原文保存しました。"
      : "",
    json_parse_warning: inputType === "json" && jsonResult && !jsonResult.valid
      ? "JSONとしては解析できませんでしたが、テキストとして保存できます。"
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
    },
    created_at: parsed.created_at || "",
    updated_at: parsed.updated_at || "",
    theme: parsed.media_theme || parsed.theme || ""
  };
}

function buildAutoKnowledgePayloadCurrent({ text, fileName = "", supplementalText = "", source = "slack_event", slack = {} }) {
  const body = String(text || "").trim();
  const supplemental = String(supplementalText || "").trim();
  const inputType = detectInputType(body, fileName);
  const jsonResult = inputType === "json" ? parseFlexibleJson(body) : null;
  const parsed = jsonResult?.valid && isPlainObject(jsonResult.parsed) ? jsonResult.parsed : {};
  const frontmatter = extractYamlFrontmatter(body);
  const heading = body.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() || "";
  const labeledTitle = extractLabeledValue(body, ["タイトル案", "タイトル", "title"]);
  const labeledCategory = extractLabeledValue(body, ["カテゴリ", "category"]);
  const labeledSummary = extractLabeledValue(body, ["概要", "summary"]);
  const firstParagraph = body
    .replace(/^---[\s\S]*?---/, "")
    .split(/\r?\n\s*\r?\n/)
    .map((item) => item.split(/\r?\n/).filter((line) => !/^#{1,6}\s+/.test(line.trim())).join("\n"))
    .map((item) => item.replace(/^[-*\s]+/, "").trim())
    .find(Boolean) || "";

  const title = humanText(firstNonEmpty(
    parsed.title,
    parsed.project_title,
    frontmatter.title,
    heading,
    labeledTitle,
    filenameTitle(fileName),
    "無題ナレッジ"
  ), "無題ナレッジ");
  const category = humanText(firstNonEmpty(
    parsed.category,
    parsed.project_category,
    frontmatter.category,
    labeledCategory,
    inferCategoryFromText(`${title}\n${body}`)
  ), "未分類");
  const rawStatus = humanText(firstNonEmpty(parsed.status, frontmatter.status, "saved"), "saved");
  const status = statuses.has(rawStatus) ? rawStatus : "saved";
  const summary = humanText(firstNonEmpty(
    parsed.summary,
    parsed.implementation_summary,
    parsed.article_main_message,
    frontmatter.summary,
    labeledSummary,
    firstParagraph ? firstParagraph.slice(0, 280) : ""
  ), "概要未設定");
  const rawKnowledgeType = String(firstNonEmpty(parsed.knowledge_type, parsed.type, frontmatter.knowledge_type, "notes"));
  const knowledgeType = knowledgeTypeFolders[rawKnowledgeType] ? rawKnowledgeType : "notes";
  const { projectKey, source: projectKeySource } = inferProjectKey({ parsed, frontmatter, title, heading, fileName, body });
  const tools = extractKnownTools(body, parsed.tools_used || parsed.tools || frontmatter.tools || "");
  const warnings = detectSensitiveWarnings(`${body}\n${supplemental}`);
  const hasAttachment = Boolean(slack.file_name || fileName);
  const sourceType = slack.source_type || (
    hasAttachment && supplemental ? "slack_text_and_file" :
      hasAttachment ? "slack_file" :
        source === "web" ? "web_paste" : "slack_text"
  );
  const jsonParseWarning = inputType === "json" && jsonResult && !jsonResult.valid
    ? "JSONとしては解析できませんでしたが、テキストとして保存できます。"
    : "";

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
    supplemental_text: supplemental,
    save_mode: "upsert",
    source,
    source_type: sourceType,
    file_name: slack.file_name || fileName || "",
    file_size: Number(slack.file_size || 0) || 0,
    char_count: body.length,
    has_attachment: hasAttachment,
    has_supplemental_text: Boolean(supplemental),
    parsed_json_available: Boolean(jsonResult?.valid),
    slack_channel: slack.channel || "",
    slack_ts: slack.ts || "",
    slack_user: slack.user || "",
    slack_message_url: slack.message_url || "",
    slack_event_id: slack.event_id || "",
    json_parse_warning: jsonParseWarning,
    warnings,
    extracted: {
      private_or_sensitive_info_to_hide: parsed.private_or_sensitive_info_to_hide || warnings,
      media_theme: parsed.media_theme || parsed.theme || "",
      article_main_message: humanText(parsed.article_main_message),
      content_strategy: humanText(parsed.content_strategy),
      wordpress_article_angles: parsed.wordpress_article_angles || "",
      note_article_angles: parsed.note_article_angles || "",
      x_threads_post_ideas: parsed.x_threads_post_ideas || ""
    },
    created_at: humanText(parsed.created_at || frontmatter.created_at),
    updated_at: humanText(parsed.updated_at || frontmatter.updated_at),
    theme: humanText(parsed.media_theme || parsed.theme || frontmatter.theme)
  };
}

function buildAutoKnowledgePayloadStrictFrontmatter({ text, fileName = "", supplementalText = "", source = "slack_event", slack = {} }) {
  const body = String(text || "").replace(/^\uFEFF/, "").trim();
  const supplemental = String(supplementalText || "").trim();
  const inputType = detectInputType(body, fileName);
  const jsonResult = inputType === "json" ? parseFlexibleJson(body) : null;
  const parsed = jsonResult?.valid && isPlainObject(jsonResult.parsed) ? jsonResult.parsed : {};
  const frontmatter = extractYamlFrontmatter(body);
  const hasFrontmatter = Object.keys(frontmatter).length > 0;
  const heading = markdownHeading(body);
  const labeledTitle = extractLabeledValueClean(body, ["タイトル案", "タイトル", "title"]);
  const labeledCategory = extractLabeledValueClean(body, ["カテゴリ", "category"]);
  const labeledSummary = extractLabeledValueClean(body, ["概要", "summary"]);
  const firstParagraph = body
    .replace(/^\s*---[\s\S]*?\r?\n---/, "")
    .split(/\r?\n\s*\r?\n/)
    .map((item) => item.split(/\r?\n/).filter((line) => !/^#{1,6}\s+/.test(line.trim())).join("\n"))
    .map((item) => item.replace(/^[-*\s]+/, "").trim())
    .filter((item) => !isGenericSectionLabel(item))
    .find(Boolean) || "";

  const titleCandidates = [
    ["json.project_key_title", ""],
    ["json.title", parsed.title],
    ["json.project_title", parsed.project_title],
    ["frontmatter.title", frontmatter.title],
    ["markdown_heading", heading],
    ["labeled_title", labeledTitle],
    ["file_name", filenameTitle(fileName)],
    ["fallback", "無題ナレッジ"]
  ];
  const titleCandidate = titleCandidates.find(([, value]) => firstNonEmpty(value)) || titleCandidates.at(-1);
  const titleSource = titleCandidate[0];
  const title = humanText(titleCandidate[1], "無題ナレッジ");
  const category = humanText(firstNonEmpty(
    parsed.category,
    parsed.project_category,
    frontmatter.category,
    labeledCategory,
    inferCategoryFromText(`${title}\n${body}`)
  ), "未分類");
  const rawStatus = humanText(firstNonEmpty(parsed.status, frontmatter.status, "saved"), "saved");
  const status = statuses.has(rawStatus) ? rawStatus : "saved";
  const summary = humanText(firstNonEmpty(
    parsed.summary,
    parsed.implementation_summary,
    parsed.article_main_message,
    frontmatter.summary,
    labeledSummary,
    firstParagraph ? firstParagraph.slice(0, 280) : ""
  ), "概要未設定");
  const rawKnowledgeType = String(firstNonEmpty(parsed.knowledge_type, parsed.type, frontmatter.knowledge_type, "notes"));
  const knowledgeType = knowledgeTypeFolders[rawKnowledgeType] ? rawKnowledgeType : "notes";
  const { projectKey, source: projectKeySource } = inferProjectKey({ parsed, frontmatter, title, titleSource, heading, fileName, body });
  const tools = extractKnownTools(body, parsed.tools_used || parsed.tools || frontmatter.tools || "");
  const warnings = detectSensitiveWarnings(`${body}\n${supplemental}`);
  const hasAttachment = Boolean(slack.file_name || fileName);
  const sourceType = slack.source_type || (
    hasAttachment && supplemental ? "slack_text_and_file" :
      hasAttachment ? "slack_file" :
        source === "web" ? "web_paste" : "slack_text"
  );
  const jsonParseWarning = inputType === "json" && jsonResult && !jsonResult.valid
    ? "JSONとしては解析できませんでしたが、テキストとして保存できます。"
    : "";

  return {
    title,
    title_source: titleSource,
    knowledge_type: knowledgeType,
    project_key: projectKey,
    project_key_source: projectKeySource,
    category,
    status,
    tools,
    summary,
    input_type: inputType,
    has_frontmatter: hasFrontmatter,
    body,
    supplemental_text: supplemental,
    save_mode: "upsert",
    source,
    source_type: sourceType,
    file_name: slack.file_name || fileName || "",
    file_size: Number(slack.file_size || 0) || 0,
    char_count: body.length,
    has_attachment: hasAttachment,
    has_supplemental_text: Boolean(supplemental),
    parsed_json_available: Boolean(jsonResult?.valid),
    slack_channel: slack.channel || "",
    slack_ts: slack.ts || "",
    slack_user: slack.user || "",
    slack_message_url: slack.message_url || "",
    slack_event_id: slack.event_id || "",
    json_parse_warning: jsonParseWarning,
    warnings,
    extracted: {
      private_or_sensitive_info_to_hide: parsed.private_or_sensitive_info_to_hide || warnings,
      media_theme: parsed.media_theme || parsed.theme || "",
      article_main_message: humanText(parsed.article_main_message),
      content_strategy: humanText(parsed.content_strategy),
      wordpress_article_angles: parsed.wordpress_article_angles || "",
      note_article_angles: parsed.note_article_angles || "",
      x_threads_post_ideas: parsed.x_threads_post_ideas || ""
    },
    created_at: humanText(parsed.created_at || frontmatter.created_at),
    updated_at: humanText(parsed.updated_at || frontmatter.updated_at),
    theme: humanText(parsed.media_theme || parsed.theme || frontmatter.theme)
  };
}

export function buildAutoKnowledgePayload({ text, fileName = "", supplementalText = "", source = "slack_event", slack = {} }) {
  const body = String(text || "").replace(/^\uFEFF/, "").trim();
  const supplemental = String(supplementalText || "").trim();
  const inputType = detectInputType(body, fileName);
  const jsonResult = inputType === "json" ? parseFlexibleJson(body) : null;
  const parsed = jsonResult?.valid && isPlainObject(jsonResult.parsed) ? jsonResult.parsed : {};
  const frontmatterInfo = extractFrontmatterFields(body);
  const frontmatter = frontmatterInfo.data;
  const hasFrontmatter = frontmatterInfo.detected;
  const bodyWithoutFrontmatter = removeFrontmatterBlock(body, frontmatterInfo);
  const heading = markdownHeading(bodyWithoutFrontmatter);
  const labeledTitle = extractLabeledValueSafe(bodyWithoutFrontmatter, ["タイトル案", "タイトル", "title"]);
  const labeledCategory = extractLabeledValueSafe(bodyWithoutFrontmatter, ["カテゴリ", "category"]);
  const labeledSummary = extractLabeledValueSafe(bodyWithoutFrontmatter, ["概要", "summary"]);
  const firstParagraph = bodyWithoutFrontmatter
    .split(/\r?\n\s*\r?\n/)
    .map((item) => item.split(/\r?\n/).filter((line) => !/^#{1,6}\s+/.test(line.trim())).join("\n"))
    .map((item) => item.replace(/^[-*\s]+/, "").trim())
    .filter((item) => !isGenericSectionLabel(item))
    .find(Boolean) || "";

  const titleCandidates = [
    ["json.title", parsed.title],
    ["json.project_title", parsed.project_title],
    ["frontmatter.title", frontmatter.title],
    ["markdown_heading", heading],
    ["labeled_title", labeledTitle],
    ["file_name", filenameTitle(fileName)],
    ["fallback", "無題ナレッジ"]
  ];
  const titleCandidate = titleCandidates.find(([, value]) => firstNonEmpty(value)) || titleCandidates.at(-1);
  const titleSource = titleCandidate[0];
  const title = humanText(titleCandidate[1], "無題ナレッジ");

  const categoryCandidates = [
    ["json.category", parsed.category],
    ["json.project_category", parsed.project_category],
    ["frontmatter.category", frontmatter.category],
    ["labeled_category", labeledCategory],
    ["keyword", inferCategoryFromText(`${title}\n${bodyWithoutFrontmatter}`)]
  ];
  const categoryCandidate = categoryCandidates.find(([, value]) => firstNonEmpty(value)) || ["fallback", "未分類"];
  const categorySource = categoryCandidate[0];
  const category = humanText(categoryCandidate[1], "未分類");

  const rawStatus = humanText(firstNonEmpty(parsed.status, frontmatter.status, "saved"), "saved");
  const status = statuses.has(rawStatus) ? rawStatus : "saved";
  const summary = humanText(firstNonEmpty(
    parsed.summary,
    parsed.implementation_summary,
    parsed.article_main_message,
    frontmatter.summary,
    labeledSummary,
    firstParagraph ? firstParagraph.slice(0, 280) : ""
  ), "概要未設定");
  const rawKnowledgeType = String(firstNonEmpty(parsed.knowledge_type, parsed.type, frontmatter.knowledge_type, "notes"));
  const knowledgeType = knowledgeTypeFolders[rawKnowledgeType] ? rawKnowledgeType : "notes";
  const { projectKey, source: projectKeySource } = inferProjectKey({ parsed, frontmatter, title, titleSource, heading, fileName, body });
  const tools = extractKnownTools(body, parsed.tools_used || parsed.tools || frontmatter.tools || "");
  const warnings = detectSensitiveWarnings(`${body}\n${supplemental}`);
  const hasAttachment = Boolean(slack.file_name || fileName);
  const sourceType = slack.source_type || (
    hasAttachment && supplemental ? "slack_text_and_file" :
      hasAttachment ? "slack_file" :
        source === "web" ? "web_paste" : "slack_text"
  );
  const jsonParseWarning = inputType === "json" && jsonResult && !jsonResult.valid
    ? "JSONとしては解析できませんでしたが、テキストとして保存できます。"
    : "";

  return {
    title,
    title_source: titleSource,
    knowledge_type: knowledgeType,
    project_key: projectKey,
    project_key_source: projectKeySource,
    category,
    category_source: categorySource,
    status,
    tools,
    summary,
    input_type: inputType,
    has_frontmatter: hasFrontmatter,
    frontmatter_closed: frontmatterInfo.closed,
    body,
    supplemental_text: supplemental,
    save_mode: "upsert",
    source,
    source_type: sourceType,
    file_name: slack.file_name || fileName || "",
    file_size: Number(slack.file_size || 0) || 0,
    char_count: body.length,
    has_attachment: hasAttachment,
    has_supplemental_text: Boolean(supplemental),
    parsed_json_available: Boolean(jsonResult?.valid),
    slack_channel: slack.channel || "",
    slack_ts: slack.ts || "",
    slack_user: slack.user || "",
    slack_message_url: slack.message_url || "",
    slack_event_id: slack.event_id || "",
    json_parse_warning: jsonParseWarning,
    warnings,
    extracted: {
      private_or_sensitive_info_to_hide: parsed.private_or_sensitive_info_to_hide || warnings,
      media_theme: parsed.media_theme || parsed.theme || "",
      article_main_message: humanText(parsed.article_main_message),
      content_strategy: humanText(parsed.content_strategy),
      wordpress_article_angles: parsed.wordpress_article_angles || "",
      note_article_angles: parsed.note_article_angles || "",
      x_threads_post_ideas: parsed.x_threads_post_ideas || ""
    },
    created_at: humanText(parsed.created_at || frontmatter.created_at),
    updated_at: humanText(parsed.updated_at || frontmatter.updated_at),
    theme: humanText(parsed.media_theme || parsed.theme || frontmatter.theme)
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
    title: humanText(input.title).trim(),
    knowledge_type: String(input.knowledge_type || "other").trim(),
    project_key: String(input.project_key || "").trim(),
    category: humanText(input.category).trim(),
    status: String(input.status || "draft").trim(),
    tools: parseTools(input.tools),
    summary: humanText(input.summary).trim(),
    input_type: String(input.input_type || "plain_text").trim(),
    body: String(input.body ?? input.body_short ?? "").trim(),
    supplemental_text: String(input.supplemental_text || "").trim(),
    source_type: String(input.source_type || "").trim(),
    file_name: String(input.file_name || "").trim(),
    file_size: Number(input.file_size || 0) || 0,
    char_count: Number(input.char_count || 0) || 0,
    has_attachment: Boolean(input.has_attachment),
    has_frontmatter: Boolean(input.has_frontmatter),
    has_supplemental_text: Boolean(input.has_supplemental_text || input.supplemental_text),
    parsed_json_available: Boolean(input.parsed_json_available),
    save_mode: String(input.save_mode || "upsert").trim(),
    source: String(input.source || "web").trim(),
    file_reference: String(input.file_reference || "").trim(),
    project_key_source: String(input.project_key_source || "").trim(),
    title_source: String(input.title_source || "").trim(),
    category_source: String(input.category_source || "").trim(),
    created_at: String(input.created_at || "").trim(),
    updated_at: String(input.updated_at || "").trim(),
    theme: String(input.theme || "").trim(),
    slack_channel: String(input.slack_channel || "").trim(),
    slack_ts: String(input.slack_ts || "").trim(),
    slack_user: String(input.slack_user || "").trim(),
    slack_message_url: String(input.slack_message_url || "").trim(),
    slack_event_id: String(input.slack_event_id || "").trim(),
    json_parse_warning: String(input.json_parse_warning || "").trim(),
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
    extracted: isPlainObject(input.extracted) ? input.extracted : {}
  };
  if (!payload.source_type) {
    payload.source_type = payload.has_attachment && payload.supplemental_text
      ? "slack_text_and_file"
      : payload.has_attachment
        ? "slack_file"
        : payload.source === "web"
          ? "web_paste"
          : payload.source.startsWith("slack")
            ? "slack_text"
            : payload.source;
  }
  if (!payload.char_count) payload.char_count = payload.body.length;

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
  if (payload.supplemental_text) {
    bodySections.splice(1, 0, markdownSection("Slack補足コメント", payload.supplemental_text));
  }

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

  async getContent(path) {
    const { response, data } = await this.request(`${path}?ref=${encodeURIComponent(this.branch)}`, {
      method: "GET"
    });
    if (response.status === 404) return null;
    return data;
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

  async deleteFile(path, message) {
    const current = await this.getFile(path);
    if (!current?.sha) return false;
    await this.request(path, {
      method: "DELETE",
      body: JSON.stringify({
        message,
        sha: current.sha,
        branch: this.branch
      })
    });
    return true;
  }

  async deletePath(path, message) {
    const content = await this.getContent(path);
    if (!content) return [];
    if (Array.isArray(content)) {
      const deleted = [];
      const items = [...content].sort((a, b) => String(b.path).localeCompare(String(a.path)));
      for (const item of items) {
        deleted.push(...await this.deletePath(item.path, message));
      }
      return deleted;
    }
    const ok = await this.deleteFile(path, message);
    return ok ? [path] : [];
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
  const warnings = [
    ...(Array.isArray(payload.warnings) ? payload.warnings : []),
    payload.json_parse_warning || ""
  ].filter(Boolean);
  const outputs = normalizeOutputs(existingMetadata?.outputs);
  const outputsSummary = outputSummary(outputs);
  return {
    title: payload.title,
    project_key: payload.project_key,
    project_key_source: payload.project_key_source || existingMetadata?.project_key_source || "",
    title_source: payload.title_source || existingMetadata?.title_source || "",
    category_source: payload.category_source || existingMetadata?.category_source || "",
    knowledge_type: payload.knowledge_type,
    category: payload.category,
    status: payload.status,
    tools: parseTools(payload.tools),
    summary: payload.summary,
    theme: payload.extracted?.media_theme || payload.theme || "",
    source: payload.source,
    source_type: payload.source_type,
    input_type: payload.input_type,
    file_name: payload.file_name,
    file_size: payload.file_size,
    char_count: payload.char_count || payload.body.length,
    has_attachment: payload.has_attachment,
    has_frontmatter: payload.has_frontmatter,
    frontmatter_closed: payload.frontmatter_closed,
    has_supplemental_text: payload.has_supplemental_text || Boolean(payload.supplemental_text),
    parsed_json_available: payload.parsed_json_available || false,
    save_mode: payload.save_mode,
    path: paths.indexPath,
    raw_json_path: paths.rawJsonPath,
    raw_md_path: paths.rawMdPath,
    raw_txt_path: paths.rawTxtPath,
    supplemental_path: paths.supplementalPath,
    raw_path: paths.rawPath,
    created: existingMetadata?.created || created,
    updated,
    created_at: payload.created_at || existingMetadata?.created_at || created,
    updated_at: payload.updated_at || updated,
    slack_channel: payload.slack_channel || existingMetadata?.slack_channel || "",
    slack_message_url: payload.slack_message_url || existingMetadata?.slack_message_url || "",
    supplemental_text: payload.supplemental_text || existingMetadata?.supplemental_text || "",
    warnings: warnings.length ? warnings : existingMetadata?.warnings || [],
    extracted: payload.extracted || existingMetadata?.extracted || {},
    outputs,
    latest_output_at: outputsSummary.latest_output_at,
    output_count: outputsSummary.output_count
  };
}

function indexEntry(metadata) {
  const outputsSummary = outputSummary(metadata.outputs);
  return {
    title: metadata.title,
    project_key: metadata.project_key,
    knowledge_type: metadata.knowledge_type,
    category: metadata.category,
    status: metadata.status,
    tools: metadata.tools,
    summary: metadata.summary,
    theme: metadata.theme,
    path: metadata.path,
    raw_json_path: metadata.raw_json_path,
    raw_md_path: metadata.raw_md_path,
    raw_txt_path: metadata.raw_txt_path,
    raw_path: metadata.raw_path,
    supplemental_path: metadata.supplemental_path,
    source_type: metadata.source_type,
    file_name: metadata.file_name,
    file_size: metadata.file_size,
    char_count: metadata.char_count,
    has_attachment: metadata.has_attachment,
    has_frontmatter: metadata.has_frontmatter,
    has_supplemental_text: metadata.has_supplemental_text,
    note_output_url: outputsSummary.note_output_url,
    x_threads_output_url: outputsSummary.x_threads_output_url,
    paid_manual_output_url: outputsSummary.paid_manual_output_url,
    template_readme_output_url: outputsSummary.template_readme_output_url,
    sales_output_url: outputsSummary.sales_output_url,
    latest_output_at: outputsSummary.latest_output_at,
    output_count: outputsSummary.output_count,
    created: metadata.created,
    updated: metadata.updated
  };
}

export async function updateGlobalIndex(client, metadata) {
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

async function removeIndexEntry(client, indexPath, knowledgeType, projectKey) {
  const current = await client.getFile(indexPath);
  if (!current?.content) {
    return { removed: false, missing: true };
  }
  let entries = [];
  try {
    entries = JSON.parse(current.content);
  } catch {
    return { removed: false, missing: false, invalid: true };
  }
  if (!Array.isArray(entries)) {
    return { removed: false, missing: false, invalid: true };
  }
  const next = entries.filter((entry) => !(
    entry?.project_key === projectKey &&
    (!knowledgeType || entry?.knowledge_type === knowledgeType)
  ));
  if (next.length === entries.length) {
    return { removed: false, missing: false };
  }
  await client.putFile(indexPath, `${JSON.stringify(next, null, 2)}\n`, `Remove knowledge index entry for ${projectKey}`);
  return { removed: true, missing: false };
}

function deletionMetadata(entry, metadata, deletedAt, source, deletedPaths) {
  return {
    title: metadata?.title || entry?.title || "",
    project_key: metadata?.project_key || entry?.project_key || "",
    knowledge_type: metadata?.knowledge_type || entry?.knowledge_type || "",
    category: metadata?.category || entry?.category || "",
    status: metadata?.status || entry?.status || "",
    path: metadata?.path || entry?.path || "",
    raw_path: metadata?.raw_path || entry?.raw_path || "",
    metadata_path: metadata?.metadata_path || "",
    created: metadata?.created || entry?.created || "",
    updated: metadata?.updated || entry?.updated || "",
    deleted_at: deletedAt,
    deleted_source: source,
    deleted_paths: deletedPaths
  };
}

export const outputTypes = new Set(["note", "x_threads", "paid_manual", "template_readme", "sales"]);

export function emptyOutputs() {
  return {
    note: [],
    x_threads: [],
    paid_manual: [],
    template_readme: [],
    sales: []
  };
}

export function normalizeOutputs(value) {
  const base = emptyOutputs();
  if (!isPlainObject(value)) return base;
  for (const key of Object.keys(base)) {
    base[key] = Array.isArray(value[key]) ? value[key] : [];
  }
  return base;
}

export function outputSummary(outputsValue) {
  const outputs = normalizeOutputs(outputsValue);
  const summary = {
    note_output_url: "",
    x_threads_output_url: "",
    paid_manual_output_url: "",
    template_readme_output_url: "",
    sales_output_url: "",
    latest_output_at: "",
    output_count: 0
  };
  for (const [type, records] of Object.entries(outputs)) {
    summary.output_count += records.length;
    const latest = [...records].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
    if (latest?.url) summary[`${type}_output_url`] = latest.url;
    if (latest?.created_at && latest.created_at > summary.latest_output_at) summary.latest_output_at = latest.created_at;
  }
  return summary;
}

export async function deleteKnowledgeFromGitHub(input) {
  const knowledgeType = String(input.knowledge_type || "").trim();
  const projectKey = String(input.project_key || "").trim();
  if (!knowledgeTypeFolders[knowledgeType]) {
    const error = new Error("knowledge_type is invalid.");
    error.status = 400;
    throw error;
  }
  if (!/^[a-zA-Z0-9-]+$/.test(projectKey)) {
    const error = new Error("project_key must contain only half-width letters, numbers, and hyphens.");
    error.status = 400;
    throw error;
  }

  const client = new GitHubContentsClient(requireGitHubConfig());
  const folder = knowledgeTypeFolders[knowledgeType];
  const basePath = `knowledge/${folder}/${projectKey}`;
  const metadataPath = `${basePath}/metadata.json`;
  const indexPath = `${basePath}/index.md`;
  const tombstonePath = `knowledge/.deleted/${folder}/${projectKey}/metadata.json`;
  const htmlBase = `https://github.com/${env("GITHUB_OWNER")}/${env("GITHUB_REPO")}/blob/${env("GITHUB_BRANCH") || "main"}`;
  const deletedAt = nowJst();

  const globalIndex = await client.getFile("knowledge/index.json");
  let globalEntries = [];
  if (globalIndex?.content) {
    try {
      globalEntries = JSON.parse(globalIndex.content);
    } catch {
      globalEntries = [];
    }
  }
  const entry = Array.isArray(globalEntries)
    ? globalEntries.find((item) => item?.knowledge_type === knowledgeType && item?.project_key === projectKey)
    : null;

  const metadataFile = await client.getFile(metadataPath);
  let metadata = null;
  if (metadataFile?.content) {
    try {
      metadata = JSON.parse(metadataFile.content);
    } catch {
      metadata = null;
    }
  }
  const tombstoneFile = await client.getFile(tombstonePath);
  let tombstoneMetadata = null;
  if (tombstoneFile?.content) {
    try {
      tombstoneMetadata = JSON.parse(tombstoneFile.content);
    } catch {
      tombstoneMetadata = null;
    }
  }

  const exists = Boolean(await client.getContent(basePath));
  if (!exists && !entry && !tombstoneMetadata) {
    const error = new Error("Knowledge was not found.");
    error.status = 404;
    throw error;
  }

  const deletedPaths = exists
    ? await client.deletePath(basePath, `Delete knowledge ${knowledgeType}/${projectKey}`)
    : [];
  const tombstone = deletionMetadata(entry || tombstoneMetadata, metadata || tombstoneMetadata, deletedAt, input.source || "slack", deletedPaths);
  await client.putFile(
    tombstonePath,
    `${JSON.stringify(tombstone, null, 2)}\n`,
    `Record deleted knowledge ${knowledgeType}/${projectKey}`
  );

  const globalIndexResult = await removeIndexEntry(client, "knowledge/index.json", knowledgeType, projectKey);
  const typeIndexResult = await removeIndexEntry(client, `knowledge/${folder}/index.json`, knowledgeType, projectKey);

  return {
    message: "Deleted knowledge from GitHub.",
    title: tombstone.title || projectKey,
    knowledge_type: knowledgeType,
    project_key: projectKey,
    save_mode: "delete",
    source: input.source || "slack",
    deleted_at: deletedAt,
    deleted_paths: deletedPaths,
    deleted_metadata_path: tombstonePath,
    index_path: indexPath,
    index_url: `${htmlBase}/${indexPath}`,
    metadata_url: metadata?.path ? `${htmlBase}/${metadataPath}` : "",
    raw_url: entry?.raw_path ? `${htmlBase}/${entry.raw_path}` : "",
    global_index_removed: globalIndexResult.removed,
    type_index_removed: typeIndexResult.removed,
    type_index_missing: typeIndexResult.missing
  };
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
    supplementalPath: `${basePath}/supplemental.md`,
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
  payload.parsed_json_available = Boolean(jsonResult?.valid);
  if (jsonResult?.valid && isPlainObject(jsonResult.parsed)) {
    payload = normalizeJsonPayload(jsonResult.parsed, payload);
  }

  const created = existingMetadata?.created || updated;
  const isUpdate = exists && (payload.save_mode === "update" || payload.save_mode === "upsert");
  const updatePath = `${basePath}/updates/${updateStamp}.md`;
  const updateJsonPath = `${basePath}/updates/${updateStamp}.json`;
  const updateTxtPath = `${basePath}/updates/${updateStamp}.txt`;
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
    if (payload.input_type === "json" && jsonResult?.valid) {
      await client.putFile(updateJsonPath, `${jsonResult.formatted}\n`, `Add knowledge JSON update for ${payload.project_key}`);
    } else if (payload.input_type === "plain_text") {
      await client.putFile(updateTxtPath, `${payload.body}\n`, `Add knowledge text update for ${payload.project_key}`);
    }
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
  if (payload.supplemental_text) {
    await client.putFile(paths.supplementalPath, `${payload.supplemental_text}\n`, `Save Slack supplemental text for ${payload.project_key}`);
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
    supplementalPath: paths.supplementalPath,
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
    supplemental_path: metadata.supplemental_path,
    update_path: isUpdate ? updatePath : "",
    update_json_path: isUpdate && payload.input_type === "json" && jsonResult?.valid ? updateJsonPath : "",
    update_txt_path: isUpdate && payload.input_type === "plain_text" ? updateTxtPath : "",
    created: metadata.created,
    updated: metadata.updated,
    index_url: indexFile.html_url || `${htmlBase}/${paths.indexPath}`,
    raw_json_url: `${htmlBase}/${metadata.raw_json_path}`,
    raw_md_url: `${htmlBase}/${metadata.raw_md_path}`,
    raw_txt_url: `${htmlBase}/${metadata.raw_txt_path}`,
    raw_url: `${htmlBase}/${metadata.raw_path}`,
    metadata_url: `${htmlBase}/${paths.metadataPath}`,
    supplemental_url: payload.supplemental_text ? `${htmlBase}/${metadata.supplemental_path}` : "",
    update_url: isUpdate ? `${htmlBase}/${updatePath}` : "",
    update_json_url: isUpdate && payload.input_type === "json" && jsonResult?.valid ? `${htmlBase}/${updateJsonPath}` : "",
    update_txt_url: isUpdate && payload.input_type === "plain_text" ? `${htmlBase}/${updateTxtPath}` : "",
    is_update: isUpdate,
    json_parse_warning: payload.json_parse_warning || ""
  };
}

export async function saveKnowledgeOutputToGitHub(input) {
  const knowledgeType = String(input.knowledge_type || "").trim();
  const projectKey = String(input.project_key || "").trim();
  const outputType = String(input.output_type || "").trim();
  if (!knowledgeTypeFolders[knowledgeType]) {
    const error = new Error("knowledge_type is invalid.");
    error.status = 400;
    throw error;
  }
  if (!/^[a-zA-Z0-9-]+$/.test(projectKey)) {
    const error = new Error("project_key must contain only half-width letters, numbers, and hyphens.");
    error.status = 400;
    throw error;
  }
  if (!outputTypes.has(outputType)) {
    const error = new Error("output_type is invalid.");
    error.status = 400;
    throw error;
  }
  const body = String(input.body || "").trim();
  if (!body) {
    const error = new Error("body is required.");
    error.status = 400;
    throw error;
  }

  const client = new GitHubContentsClient(requireGitHubConfig());
  const folder = knowledgeTypeFolders[knowledgeType];
  const basePath = `knowledge/${folder}/${projectKey}`;
  const metadataPath = `${basePath}/metadata.json`;
  const metadataFile = await client.getFile(metadataPath);
  if (!metadataFile?.content) {
    const error = new Error("Source knowledge metadata was not found.");
    error.status = 404;
    throw error;
  }
  let metadata;
  try {
    metadata = JSON.parse(metadataFile.content);
  } catch {
    const error = new Error("Source knowledge metadata is invalid JSON.");
    error.status = 500;
    throw error;
  }

  const createdAt = nowJst();
  const stamp = updateTimestampForPath(createdAt);
  const outputPath = `${basePath}/outputs/${outputType}/${stamp}.md`;
  const htmlBase = `https://github.com/${env("GITHUB_OWNER")}/${env("GITHUB_REPO")}/blob/${env("GITHUB_BRANCH") || "main"}`;
  const outputUrl = `${htmlBase}/${outputPath}`;
  const outputTitle = humanText(input.title, `${outputType} output`);
  const outputMarkdown = `---\ntitle: ${yamlQuote(outputTitle)}\noutput_type: ${yamlQuote(outputType)}\nsource_project_key: ${yamlQuote(projectKey)}\nknowledge_type: ${yamlQuote(knowledgeType)}\nstatus: ${yamlQuote(input.status || "draft")}\ncreated_at: ${yamlQuote(createdAt)}\ncreated_by: ${yamlQuote(input.created_by || "")}\nmodel: ${yamlQuote(input.model || "")}\n---\n\n# ${outputTitle}\n\n${body}\n`;
  await client.putFile(outputPath, outputMarkdown, `Save ${outputType} output for ${projectKey}`);

  const outputs = normalizeOutputs(metadata.outputs);
  const outputRecord = {
    title: outputTitle,
    url: outputUrl,
    path: outputPath,
    created_at: createdAt,
    output_type: outputType,
    created_by: String(input.created_by || ""),
    model: String(input.model || ""),
    status: String(input.status || "draft"),
    note: humanText(input.note)
  };
  outputs[outputType].push(outputRecord);
  const outputsSummary = outputSummary(outputs);
  const nextMetadata = {
    ...metadata,
    outputs,
    latest_output_at: outputsSummary.latest_output_at,
    output_count: outputsSummary.output_count,
    updated: createdAt,
    updated_at: createdAt
  };
  await client.putFile(metadataPath, `${JSON.stringify(nextMetadata, null, 2)}\n`, `Update outputs metadata for ${projectKey}`);
  await updateGlobalIndex(client, nextMetadata);

  return {
    ok: true,
    message: "Saved knowledge output to GitHub.",
    title: nextMetadata.title || projectKey,
    knowledge_type: knowledgeType,
    project_key: projectKey,
    output_type: outputType,
    output_title: outputTitle,
    output_url: outputUrl,
    output_path: outputPath,
    created_at: createdAt,
    metadata_url: `${htmlBase}/${metadataPath}`,
    index_url: `${htmlBase}/${basePath}/index.md`,
    output_record: outputRecord,
    output_summary: outputsSummary,
    metadata: nextMetadata
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
