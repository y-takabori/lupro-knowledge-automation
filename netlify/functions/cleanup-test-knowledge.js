import {
  deleteKnowledgeFromGitHub,
  env,
  jsonResponse
} from "./knowledge-archive-core.js";
import { syncKnowledgeDeletionToGoogleSheets } from "./google-sheets-sync.js";

const cleanupTargets = [
  { knowledge_type: "notes", project_key: "google-sheets" },
  { knowledge_type: "notes", project_key: "google-sheets-2" },
  { knowledge_type: "notes", project_key: "google-sheets-3" },
  { knowledge_type: "notes", project_key: "slack" },
  { knowledge_type: "notes", project_key: "20260609-0758-12345b5e" },
  { knowledge_type: "learnings", project_key: "test-knowledge" }
];

function authorized(request) {
  const expected = env("KNOWLEDGE_SAVE_TOKEN") || env("LUPRO_KNOWLEDGE_SAVE_TOKEN");
  const header = request.headers.get("authorization") || "";
  return Boolean(expected && header === `Bearer ${expected}`);
}

async function cleanupTarget(target) {
  const result = await deleteKnowledgeFromGitHub({
    ...target,
    source: "cleanup"
  });
  let sheets;
  try {
    sheets = await syncKnowledgeDeletionToGoogleSheets({
      ...target,
      title: result.title,
      source: "cleanup",
      note: "test knowledge cleanup"
    }, result);
  } catch (error) {
    sheets = { ok: false, skipped: false, message: error.message };
  }
  return {
    title: result.title,
    knowledge_type: result.knowledge_type,
    project_key: result.project_key,
    github_deleted: true,
    sheets
  };
}

export default async (request) => {
  if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }
  if (!authorized(request)) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  const results = [];
  for (const target of cleanupTargets) {
    try {
      results.push(await cleanupTarget(target));
    } catch (error) {
      results.push({
        knowledge_type: target.knowledge_type,
        project_key: target.project_key,
        github_deleted: false,
        error: error.message
      });
    }
  }
  return jsonResponse(200, { ok: true, results });
};
