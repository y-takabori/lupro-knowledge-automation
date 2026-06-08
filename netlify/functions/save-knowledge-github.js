import { jsonResponse, env, saveKnowledgeToGitHub } from "./knowledge-archive-core.js";

function checkAuthorization(request) {
  const expectedToken = env("KNOWLEDGE_SAVE_TOKEN");
  if (!expectedToken) return false;
  const authorization = request.headers.get("Authorization") || "";
  return authorization === `Bearer ${expectedToken}`;
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

  if (!checkAuthorization(request)) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  try {
    const result = await saveKnowledgeToGitHub({
      ...payload,
      source: payload.source || "web"
    });
    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(error.status || 502, {
      error: "Failed to save knowledge to GitHub.",
      message: error.message
    });
  }
};
