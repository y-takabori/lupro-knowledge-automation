import {
  env,
  jsonResponse,
  saveKnowledgeOutputToGitHub
} from "./knowledge-archive-core.js";
import { syncKnowledgeOutputToGoogleSheets } from "./google-sheets-sync.js";

function verifySaveToken(request) {
  const expected = env("KNOWLEDGE_SAVE_TOKEN");
  if (!expected) return false;
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const headerToken = request.headers.get("x-knowledge-save-token") || "";
  return bearer === expected || headerToken === expected;
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }
  if (!verifySaveToken(request)) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  try {
    const result = await saveKnowledgeOutputToGitHub(body);
    let sheets;
    try {
      sheets = await syncKnowledgeOutputToGoogleSheets(result.metadata, result);
    } catch (error) {
      sheets = { ok: false, skipped: false, message: error.message };
    }
    return jsonResponse(200, {
      ok: true,
      result: {
        title: result.title,
        knowledge_type: result.knowledge_type,
        project_key: result.project_key,
        output_type: result.output_type,
        output_title: result.output_title,
        output_url: result.output_url,
        metadata_url: result.metadata_url,
        index_url: result.index_url,
        created_at: result.created_at
      },
      sheets: {
        ok: Boolean(sheets?.ok),
        skipped: Boolean(sheets?.skipped),
        message: sheets?.message || "",
        knowledge_sheet: sheets?.knowledge_sheet || "",
        output_history_sheet: sheets?.output_history_sheet || ""
      }
    });
  } catch (error) {
    return jsonResponse(error.status || 500, {
      ok: false,
      error: error.message || "Failed to save knowledge output."
    });
  }
};
