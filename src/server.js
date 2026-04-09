import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";

import { buildDashboardForUser, calculateScenarioForDeal } from "./calculations.js";
import {
  createDealAllocation,
  createManagedUser,
  getAppDataSnapshot,
  getUserByEmail,
  getUserById,
  updateDeal
} from "./database.js";

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

function destroySession(request) {
  const cookies = parseCookies(request);

  if (cookies.sessionId) {
    sessions.delete(cookies.sessionId);
  }

  return "sessionId=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax";
}

async function getCurrentUser(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies.sessionId;

  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  return getUserById(session.userId);
}

async function requireUser(request, response) {
  const user = await getCurrentUser(request);

  if (!user) {
    sendJson(response, 401, { error: "Authentication required." });
    return null;
  }

  return user;
}

async function requireManager(request, response) {
  const user = await requireUser(request, response);

  if (!user) {
    return null;
  }

  if (user.role !== "manager") {
    sendJson(response, 403, { error: "Manager access is required." });
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
  try {
    const method = request.method ?? "GET";
    const url = new URL(request.url, `http://${request.headers.host}`);
    const dealUpdateMatch = url.pathname.match(/^\/api\/admin\/deals\/([^/]+)$/);

    if (method === "POST" && url.pathname === "/api/login") {
      const body = await readJsonBody(request);

      if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
        sendJson(response, 400, { error: "Email and password are required." });
        return;
      }

      const user = await getUserByEmail(body.email);

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
      sendJson(response, 200, { ok: true }, { "Set-Cookie": destroySession(request) });
      return;
    }

    if (method === "GET" && url.pathname === "/api/session") {
      const user = await getCurrentUser(request);
      sendJson(response, 200, { user: user ? stripUserSecrets(user) : null });
      return;
    }

    if (method === "GET" && url.pathname === "/api/dashboard") {
      const user = await requireUser(request, response);

      if (!user) {
        return;
      }

      const snapshot = await getAppDataSnapshot();
      sendJson(response, 200, buildDashboardForUser(user, snapshot));
      return;
    }

    if (method === "POST" && url.pathname === "/api/calculator") {
      const user = await requireUser(request, response);

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

      const snapshot = await getAppDataSnapshot();
      const scenario = calculateScenarioForDeal(
        body.dealId,
        {
          salePrice: body.salePrice,
          holdMonths: body.holdMonths,
          prefRate: body.prefRate
        },
        snapshot
      );

      if (!scenario) {
        sendJson(response, 404, { error: "Deal not found." });
        return;
      }

      sendJson(response, 200, scenario);
      return;
    }

    if (method === "POST" && url.pathname === "/api/admin/users") {
      const manager = await requireManager(request, response);

      if (!manager) {
        return;
      }

      const body = await readJsonBody(request);

      if (!body) {
        sendJson(response, 400, { error: "A valid request body is required." });
        return;
      }

      try {
        const createdUser = await createManagedUser(body);
        sendJson(response, 201, { user: stripUserSecrets(createdUser) });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "POST" && url.pathname === "/api/admin/allocations") {
      const manager = await requireManager(request, response);

      if (!manager) {
        return;
      }

      const body = await readJsonBody(request);

      if (!body) {
        sendJson(response, 400, { error: "A valid request body is required." });
        return;
      }

      try {
        await createDealAllocation(body);
        sendJson(response, 201, { ok: true });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "PATCH" && dealUpdateMatch) {
      const manager = await requireManager(request, response);

      if (!manager) {
        return;
      }

      const body = await readJsonBody(request);

      if (!body) {
        sendJson(response, 400, { error: "A valid request body is required." });
        return;
      }

      try {
        await updateDeal(decodeURIComponent(dealUpdateMatch[1]), body);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "GET") {
      await serveStatic(request, response);
      return;
    }

    response.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Method not allowed." }));
  } catch (error) {
    sendJson(response, 500, {
      error: "Internal server error.",
      detail: error.message
    });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Deal app running at http://${HOST}:${PORT}\n`);
});
