import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";

import { buildDashboardForUser, calculateScenarioForDeal } from "./calculations.js";
import { assertDatabaseReady } from "./migrations.js";
import { closeDatabasePool } from "./postgres.js";
import {
  castDealIssueVote,
  castInvestorPoolVote,
  createCompanyResource,
  createDeal,
  createDealAllocation,
  createDealIssue,
  createInvestorPool,
  createManagedUser,
  deleteCompanyResource,
  deleteDeal,
  deleteUserAccount,
  ensureInitialManagerUser,
  fundInvestorPool,
  getAppDataSnapshot,
  getCompanyResourceDownload,
  getUserByEmail,
  getUserById,
  markUserLogin,
  requestPasswordReset,
  reviewEarlyWithdrawalRequest,
  resetPasswordWithToken,
  setUserAccountActive,
  updateUserCategory,
  upsertInvestorPoolCommitment,
  upsertEarlyWithdrawalRequest,
  upsertDistributionElection,
  updateOwnProfile,
  updateDeal,
  updateUserPassword
} from "./database.js";

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = join(process.cwd(), "public");
const SESSION_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
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
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
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

function buildAttachmentDisposition(fileName) {
  const safeFileName = String(fileName ?? "download")
    .replaceAll('"', "")
    .replaceAll("\r", "")
    .replaceAll("\n", "");

  return `attachment; filename="${safeFileName}"`;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl ?? "").match(/^data:([^;,]+)?(;base64)?,([\s\S]+)$/);

  if (!match) {
    throw new Error("Stored file payload is invalid.");
  }

  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  const buffer = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");

  return {
    mimeType,
    buffer
  };
}

function createSession(userId) {
  const now = Date.now();
  const sessionId = randomBytes(24).toString("hex");
  sessions.set(sessionId, {
    userId,
    createdAt: now,
    lastActivityAt: now
  });
  return sessionId;
}

function clearSessionCookie() {
  return "sessionId=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax";
}

function destroySession(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies.sessionId;

  if (sessionId) {
    sessions.delete(sessionId);
  }

  return clearSessionCookie();
}

function getSessionState(request, { touch = true } = {}) {
  const cookies = parseCookies(request);
  const sessionId = cookies.sessionId;

  if (!sessionId) {
    return {
      sessionId: null,
      session: null,
      expired: false
    };
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return {
      sessionId,
      session: null,
      expired: false
    };
  }

  const now = Date.now();

  if (now - session.lastActivityAt >= SESSION_INACTIVITY_TIMEOUT_MS) {
    sessions.delete(sessionId);
    return {
      sessionId,
      session: null,
      expired: true
    };
  }

  if (touch) {
    session.lastActivityAt = now;
  }

  return {
    sessionId,
    session,
    expired: false
  };
}

async function getCurrentUser(request, options = {}) {
  const sessionState = getSessionState(request, options);

  if (!sessionState.session) {
    return {
      user: null,
      sessionId: sessionState.sessionId,
      expired: sessionState.expired
    };
  }

  const user = await getUserById(sessionState.session.userId);

  if (!user) {
    if (sessionState.sessionId) {
      sessions.delete(sessionState.sessionId);
    }

    return {
      user: null,
      sessionId: sessionState.sessionId,
      expired: false
    };
  }

  return {
    user,
    sessionId: sessionState.sessionId,
    expired: false
  };
}

async function requireUser(request, response) {
  const { user, expired } = await getCurrentUser(request);

  if (!user) {
    sendJson(
      response,
      401,
      {
        error: expired
          ? "Session expired after 15 minutes of inactivity."
          : "Authentication required.",
        code: expired ? "SESSION_EXPIRED" : "AUTH_REQUIRED"
      },
      expired ? { "Set-Cookie": clearSessionCookie() } : {}
    );
    return null;
  }

  return user;
}

async function requireManager(request, response) {
  const user = await requireUnlockedUser(request, response);

  if (!user) {
    return null;
  }

  if (user.role !== "manager") {
    sendJson(response, 403, { error: "Manager access is required." });
    return null;
  }

  return user;
}

async function requireUnlockedUser(request, response) {
  const user = await requireUser(request, response);

  if (!user) {
    return null;
  }

  if (user.mustChangePassword) {
    sendJson(response, 403, {
      error: "Password change required before continuing.",
      code: "PASSWORD_CHANGE_REQUIRED"
    });
    return null;
  }

  return user;
}

function stripUserSecrets(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    category: user.category,
    mustChangePassword: Boolean(user.mustChangePassword)
  };
}

const server = createServer(async (request, response) => {
  try {
    const method = request.method ?? "GET";
    const url = new URL(request.url, `http://${request.headers.host}`);
    const dealUpdateMatch = url.pathname.match(/^\/api\/admin\/deals\/([^/]+)$/);
    const issueVoteMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/vote$/);
    const userStatusMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
    const userCategoryMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/category$/);
    const userDeleteMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    const resourceDeleteMatch = url.pathname.match(/^\/api\/admin\/resources\/([^/]+)$/);
    const resourceDownloadMatch = url.pathname.match(/^\/api\/resources\/([^/]+)\/download$/);
    const adminDistributionElectionMatch = url.pathname.match(
      /^\/api\/admin\/deals\/([^/]+)\/distribution-elections\/([^/]+)$/
    );
    const adminEarlyWithdrawalMatch = url.pathname.match(
      /^\/api\/admin\/deals\/([^/]+)\/withdrawal-requests\/([^/]+)$/
    );
    const distributionElectionMatch = url.pathname.match(
      /^\/api\/deals\/([^/]+)\/distribution-election$/
    );
    const earlyWithdrawalMatch = url.pathname.match(/^\/api\/deals\/([^/]+)\/withdrawal-request$/);
    const poolVoteMatch = url.pathname.match(/^\/api\/pools\/([^/]+)\/vote$/);
    const adminPoolCommitmentMatch = url.pathname.match(
      /^\/api\/admin\/pools\/([^/]+)\/commitments$/
    );
    const adminPoolFundMatch = url.pathname.match(/^\/api\/admin\/pools\/([^/]+)\/fund$/);

    if (method === "POST" && url.pathname === "/api/password/forgot") {
      const body = await readJsonBody(request);

      if (!body || typeof body.email !== "string") {
        sendJson(response, 400, { error: "A valid email is required." });
        return;
      }

      try {
        await requestPasswordReset(body.email);
        sendJson(response, 200, {
          ok: true,
          message:
            "If an active account matches that email, a password reset link has been sent."
        });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "POST" && url.pathname === "/api/password/reset") {
      const body = await readJsonBody(request);

      if (
        !body ||
        typeof body.token !== "string" ||
        typeof body.newPassword !== "string"
      ) {
        sendJson(response, 400, {
          error: "A valid reset token and new password are required."
        });
        return;
      }

      try {
        await resetPasswordWithToken(body.token, body.newPassword);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

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

      await markUserLogin(user.id);
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
      const { user, expired } = await getCurrentUser(request);
      sendJson(
        response,
        200,
        {
          user: user ? stripUserSecrets(user) : null,
          expired
        },
        expired ? { "Set-Cookie": clearSessionCookie() } : {}
      );
      return;
    }

    if (method === "GET" && url.pathname === "/api/session/ping") {
      const user = await requireUser(request, response);

      if (!user) {
        return;
      }

      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "GET" && url.pathname === "/api/dashboard") {
      const user = await requireUnlockedUser(request, response);

      if (!user) {
        return;
      }

      const snapshot = await getAppDataSnapshot();
      sendJson(response, 200, buildDashboardForUser(user, snapshot));
      return;
    }

    if (method === "PUT" && poolVoteMatch) {
      const user = await requireUnlockedUser(request, response);

      if (!user) {
        return;
      }

      const body = await readJsonBody(request);

      if (!body || typeof body.dealId !== "string") {
        sendJson(response, 400, { error: "A valid project selection is required." });
        return;
      }

      try {
        const result = await castInvestorPoolVote(
          decodeURIComponent(poolVoteMatch[1]),
          user.id,
          body.dealId
        );
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "GET" && resourceDownloadMatch) {
      const user = await requireUnlockedUser(request, response);

      if (!user) {
        return;
      }

      try {
        const resource = await getCompanyResourceDownload(
          decodeURIComponent(resourceDownloadMatch[1])
        );
        const decoded = decodeDataUrl(resource.fileDataUrl);

        response.writeHead(200, {
          "Content-Type": resource.fileMimeType || decoded.mimeType,
          "Content-Disposition": buildAttachmentDisposition(resource.fileName),
          "Cache-Control": "private, max-age=0, must-revalidate"
        });
        response.end(decoded.buffer);
      } catch (error) {
        sendJson(response, 404, { error: error.message });
      }

      return;
    }

    if (method === "POST" && url.pathname === "/api/calculator") {
      const user = await requireUnlockedUser(request, response);

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
          prefRate: body.prefRate,
          taxExpense: body.taxExpense
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

    if (method === "POST" && url.pathname === "/api/profile/password") {
      const user = await requireUser(request, response);

      if (!user) {
        return;
      }

      const body = await readJsonBody(request);

      if (
        !body ||
        typeof body.currentPassword !== "string" ||
        typeof body.newPassword !== "string"
      ) {
        sendJson(response, 400, {
          error: "Current password and new password are required."
        });
        return;
      }

      if (!verifyPassword(user, body.currentPassword)) {
        sendJson(response, 400, { error: "Current password is incorrect." });
        return;
      }

      if (body.currentPassword === body.newPassword) {
        sendJson(response, 400, {
          error: "New password must be different from the current password."
        });
        return;
      }

      try {
        const updatedUser = await updateUserPassword(user.id, body.newPassword);
        sendJson(response, 200, { user: stripUserSecrets(updatedUser) });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "PATCH" && url.pathname === "/api/profile") {
      const user = await requireUnlockedUser(request, response);

      if (!user) {
        return;
      }

      const body = await readJsonBody(request);

      if (!body) {
        sendJson(response, 400, { error: "A valid request body is required." });
        return;
      }

      try {
        const updatedUser = await updateOwnProfile(user.id, body);
        sendJson(response, 200, { user: stripUserSecrets(updatedUser) });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "PUT" && distributionElectionMatch) {
      const user = await requireUnlockedUser(request, response);

      if (!user) {
        return;
      }

      if (user.role === "manager") {
        sendJson(response, 403, {
          error: "Managers cannot save investor distribution elections."
        });
        return;
      }

      const body = await readJsonBody(request);

      if (!body) {
        sendJson(response, 400, { error: "A valid request body is required." });
        return;
      }

      try {
        const election = await upsertDistributionElection(
          decodeURIComponent(distributionElectionMatch[1]),
          user.id,
          body
        );
        sendJson(response, 200, { election });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "PUT" && earlyWithdrawalMatch) {
      const user = await requireUnlockedUser(request, response);

      if (!user) {
        return;
      }

      if (user.role === "manager") {
        sendJson(response, 403, {
          error: "Managers cannot submit investor early withdrawal requests."
        });
        return;
      }

      const body = await readJsonBody(request);

      if (!body) {
        sendJson(response, 400, { error: "A valid request body is required." });
        return;
      }

      try {
        const requestResult = await upsertEarlyWithdrawalRequest(
          decodeURIComponent(earlyWithdrawalMatch[1]),
          user.id,
          body
        );
        sendJson(response, 200, { request: requestResult });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

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
        sendJson(response, 201, {
          user: stripUserSecrets(createdUser.user),
          notification: createdUser.notification
        });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "POST" && url.pathname === "/api/admin/pools") {
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
        const result = await createInvestorPool(body, manager.id);
        sendJson(response, 201, result);
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "POST" && adminPoolCommitmentMatch) {
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
        const result = await upsertInvestorPoolCommitment(
          decodeURIComponent(adminPoolCommitmentMatch[1]),
          body
        );
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "POST" && adminPoolFundMatch) {
      const manager = await requireManager(request, response);

      if (!manager) {
        return;
      }

      const body = await readJsonBody(request);

      try {
        const result = await fundInvestorPool(
          decodeURIComponent(adminPoolFundMatch[1]),
          manager.id,
          body ?? {}
        );
        sendJson(response, 200, result);
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
        const allocation = await createDealAllocation(body);
        sendJson(response, allocation.action === "created" ? 201 : 200, allocation);
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "POST" && url.pathname === "/api/admin/deals") {
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
        const result = await createDeal(body);
        sendJson(response, 201, result);
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "POST" && url.pathname === "/api/admin/resources") {
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
        const resource = await createCompanyResource(body, manager.id);
        sendJson(response, 201, { resource });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "POST" && url.pathname === "/api/admin/issues") {
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
        const result = await createDealIssue(body, manager.id);
        sendJson(response, 201, result);
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "PUT" && adminDistributionElectionMatch) {
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
        const election = await upsertDistributionElection(
          decodeURIComponent(adminDistributionElectionMatch[1]),
          manager.id,
          {
            ...body,
            participantId: decodeURIComponent(adminDistributionElectionMatch[2])
          }
        );
        sendJson(response, 200, { election });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "PUT" && adminEarlyWithdrawalMatch) {
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
        const requestResult = await reviewEarlyWithdrawalRequest(
          decodeURIComponent(adminEarlyWithdrawalMatch[1]),
          decodeURIComponent(adminEarlyWithdrawalMatch[2]),
          manager.id,
          body
        );
        sendJson(response, 200, { request: requestResult });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "PATCH" && issueVoteMatch) {
      const user = await requireUnlockedUser(request, response);

      if (!user) {
        return;
      }

      if (user.role === "manager") {
        sendJson(response, 403, { error: "Managers cannot vote on investor issues." });
        return;
      }

      const body = await readJsonBody(request);

      if (!body || typeof body.voteChoice !== "string") {
        sendJson(response, 400, { error: "A valid vote choice is required." });
        return;
      }

      try {
        const vote = await castDealIssueVote(
          decodeURIComponent(issueVoteMatch[1]),
          user.id,
          body.voteChoice
        );
        sendJson(response, 200, { vote });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "DELETE" && dealUpdateMatch) {
      const manager = await requireManager(request, response);

      if (!manager) {
        return;
      }

      try {
        await deleteDeal(decodeURIComponent(dealUpdateMatch[1]), manager.id);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "DELETE" && resourceDeleteMatch) {
      const manager = await requireManager(request, response);

      if (!manager) {
        return;
      }

      try {
        await deleteCompanyResource(decodeURIComponent(resourceDeleteMatch[1]), manager.id);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "PATCH" && userStatusMatch) {
      const manager = await requireManager(request, response);

      if (!manager) {
        return;
      }

      const body = await readJsonBody(request);

      if (!body || typeof body.isActive !== "boolean") {
        sendJson(response, 400, { error: "A valid active status is required." });
        return;
      }

      try {
        const user = await setUserAccountActive(
          decodeURIComponent(userStatusMatch[1]),
          body.isActive,
          manager.id
        );
        sendJson(response, 200, { user: stripUserSecrets(user) });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "PATCH" && userCategoryMatch) {
      const manager = await requireManager(request, response);

      if (!manager) {
        return;
      }

      const body = await readJsonBody(request);

      if (!body || typeof body.category !== "string") {
        sendJson(response, 400, { error: "A valid user category is required." });
        return;
      }

      try {
        const user = await updateUserCategory(
          decodeURIComponent(userCategoryMatch[1]),
          body.category,
          manager.id
        );
        sendJson(response, 200, { user: stripUserSecrets(user) });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    if (method === "DELETE" && userDeleteMatch) {
      const manager = await requireManager(request, response);

      if (!manager) {
        return;
      }

      try {
        await deleteUserAccount(decodeURIComponent(userDeleteMatch[1]), manager.id);
        sendJson(response, 200, { ok: true });
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

server.on("error", (error) => {
  const message =
    error.code === "EADDRINUSE"
      ? `Port ${PORT} is already in use. Stop the existing process or change PORT in .env.`
      : error.message;

  process.stderr.write(`${message}\n`);
  void closeDatabasePool().finally(() => {
    process.exit(1);
  });
});

async function shutdown(exitCode = 0) {
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closeDatabasePool();
  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

try {
  await assertDatabaseReady();
  const initialManager = await ensureInitialManagerUser();

  if (initialManager.created) {
    process.stdout.write(
      `Created initial manager account for ${initialManager.user.email}.\n`
    );

    if (initialManager.notification?.provider === "smtp") {
      process.stdout.write("Credential email sent through SMTP.\n");
    } else if (initialManager.notification?.localPath) {
      process.stdout.write(
        `Credential email saved to ${initialManager.notification.localPath}.\n`
      );
    }
  }

  server.listen(PORT, HOST, () => {
    process.stdout.write(`Deal app running at http://${HOST}:${PORT}\n`);
  });
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  await closeDatabasePool();
  process.exit(1);
}
