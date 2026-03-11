import type { IncomingMessage, ServerResponse } from "http";
import { timingSafeEqual } from "crypto";
import type { AgentManager } from "./agentManager";
import type { SimulationEngine } from "./engine";
import { AdminUsernameBodySchema, AdminLlmToggleSchema } from "./schemas";

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, maxBytes = 10_240): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    };
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        fail(new Error("body_too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString());
    });
    req.on("error", (err) => fail(err));
  });
}

function checkBasicAuth(req: IncomingMessage): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;

  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return false;

  const user = decoded.slice(0, colonIdx);
  const pass = decoded.slice(colonIdx + 1);
  if (user !== "admin") return false;

  const a = Buffer.from(pass);
  const b = Buffer.from(adminPassword);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface AdminAPIOptions {
  getLlmStatus: () => { available: boolean; enabled: boolean };
  setLlmEnabled: (enabled: boolean) => void;
}

export async function handleAdminAPI(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  agentManager: AgentManager,
  engine: SimulationEngine,
  options: AdminAPIOptions,
): Promise<void> {
  const method = req.method ?? "GET";

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN ?? "https://clawsoc.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Auth check
  if (!checkBasicAuth(req)) {
    return jsonResponse(res, 401, { error: "Unauthorized" });
  }

  // GET /api/admin/users
  if (pathname === "/api/admin/users" && method === "GET") {
    const users = await agentManager.getAllRegisteredUsers(engine);
    return jsonResponse(res, 200, { users });
  }

  // POST /api/admin/ban
  if (pathname === "/api/admin/ban" && method === "POST") {
    const raw = await readBody(req);
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(raw);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }
    const parsed = AdminUsernameBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonResponse(res, 400, { error: "Invalid request body" });
    }
    const username = parsed.data.username?.trim();
    if (!username) {
      return jsonResponse(res, 400, { error: "username is required" });
    }
    await agentManager.banUser(username, engine);
    return jsonResponse(res, 200, { ok: true, banned: username });
  }

  // POST /api/admin/unban
  if (pathname === "/api/admin/unban" && method === "POST") {
    const raw = await readBody(req);
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(raw);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }
    const parsed = AdminUsernameBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonResponse(res, 400, { error: "Invalid request body" });
    }
    const username = parsed.data.username?.trim();
    if (!username) {
      return jsonResponse(res, 400, { error: "username is required" });
    }
    await agentManager.unbanUser(username);
    return jsonResponse(res, 200, { ok: true, unbanned: username });
  }

  // POST /api/admin/delete
  if (pathname === "/api/admin/delete" && method === "POST") {
    const raw = await readBody(req);
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(raw);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }
    const parsed = AdminUsernameBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonResponse(res, 400, { error: "Invalid request body" });
    }
    const username = parsed.data.username?.trim();
    if (!username) {
      return jsonResponse(res, 400, { error: "username is required" });
    }
    await agentManager.deleteUser(username, engine);
    return jsonResponse(res, 200, { ok: true, deleted: username });
  }

  // GET /api/admin/banned
  if (pathname === "/api/admin/banned" && method === "GET") {
    return jsonResponse(res, 200, { banned: agentManager.getBannedUsers() });
  }

  // GET /api/admin/llm
  if (pathname === "/api/admin/llm" && method === "GET") {
    return jsonResponse(res, 200, options.getLlmStatus());
  }

  // POST /api/admin/llm
  if (pathname === "/api/admin/llm" && method === "POST") {
    if (!options.getLlmStatus().available) {
      return jsonResponse(res, 400, { error: "LLM not available — no OPENAI_API_KEY configured" });
    }
    const raw = await readBody(req);
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(raw);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON" });
    }
    const parsed = AdminLlmToggleSchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonResponse(res, 400, { error: "Body must include { enabled: boolean }" });
    }
    options.setLlmEnabled(parsed.data.enabled);
    return jsonResponse(res, 200, { ok: true, enabled: parsed.data.enabled });
  }

  return jsonResponse(res, 404, { error: "Not found" });
}
