import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";

import { seedData } from "./data.js";
import { buildDashboardForUser, calculateScenarioForDeal } from "./calculations.js";

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = join(process.cwd(), "public");
const sessions = new Map();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function parseCookies(request) {
  const header = request.headers.cookie;

  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, pair) => {
    const [rawKey, rawValue] = pair.split("=");

    if (!rawKey || !rawValue) {
      return cookies;
    }

    cookies[rawKey.trim()] = decodeURIComponent(rawValue.trim());
    return cookies;
  }, {});
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sanitizePath(pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  return normalize(safePath)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const filePath = join(PUBLIC_DIR, sanitizePath(url.pathname));

  try {
    const file = await readFile(filePath);
    const contentType = mimeTypes[extname(filePath)] ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function verifyPassword(user, password) {
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = scryptSync(password, user.passwordSalt, 64);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createSession(userId) {
  const sessionId = randomBytes(24).toString("hex");
  sessions.set(sessionId, {
    userId,
    createdAt: Date.now()
  });
  return sessionId;
}

function clearSession(request, response) {
  const cookies = parseCookies(request);

  if (cookies.sessionId) {
    sessions.delete(cookies.sessionId);
  }

  response.setHeader(
    "Set-Cookie",
    "sessionId=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax"
  );
}

function getCurrentUser(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies.sessionId;

  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  return seedData.users.find((user) => user.id === session.userId) ?? null;
}

function requireUser(request, response) {
  const user = getCurrentUser(request);

  if (!user) {
    sendJson(response, 401, { error: "Authentication required." });
    return null;
  }

  return user;
}

function stripUserSecrets(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (method === "POST" && url.pathname === "/api/login") {
    const body = await readJsonBody(request);

    if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
      sendJson(response, 400, { error: "Email and password are required." });
      return;
    }

    const user = seedData.users.find(
      (item) => item.email.toLowerCase() === body.email.trim().toLowerCase()
    );

    if (!user || !verifyPassword(user, body.password)) {
      sendJson(response, 401, { error: "Invalid credentials." });
      return;
    }

    const sessionId = createSession(user.id);
    sendJson(
      response,
      200,
      {
        user: stripUserSecrets(user)
      },
      {
        "Set-Cookie": `sessionId=${sessionId}; HttpOnly; Path=/; SameSite=Lax`
      }
    );
    return;
  }

  if (method === "POST" && url.pathname === "/api/logout") {
    clearSession(request, response);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/session") {
    const user = getCurrentUser(request);
    sendJson(response, 200, { user: user ? stripUserSecrets(user) : null });
    return;
  }

  if (method === "GET" && url.pathname === "/api/dashboard") {
    const user = requireUser(request, response);

    if (!user) {
      return;
    }

    sendJson(response, 200, buildDashboardForUser(user));
    return;
  }

  if (method === "POST" && url.pathname === "/api/calculator") {
    const user = requireUser(request, response);

    if (!user) {
      return;
    }

    if (user.role !== "manager") {
      sendJson(response, 403, { error: "Calculator access is limited to the sponsor view." });
      return;
    }

    const body = await readJsonBody(request);

    if (!body || typeof body.dealId !== "string") {
      sendJson(response, 400, { error: "A valid deal is required." });
      return;
    }

    const scenario = calculateScenarioForDeal(body.dealId, {
      salePrice: Number(body.salePrice),
      holdMonths: Number(body.holdMonths),
      prefRate: Number(body.prefRate)
    });

    if (!scenario) {
      sendJson(response, 404, { error: "Deal not found." });
      return;
    }

    sendJson(response, 200, scenario);
    return;
  }

  if (method === "GET") {
    await serveStatic(request, response);
    return;
  }

  response.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Method not allowed." }));
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Deal app running at http://${HOST}:${PORT}\n`);
});
