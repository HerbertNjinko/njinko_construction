import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { buildPoolDistributionContexts, calculateWaterfall } from "./calculations.js";
import { seedData } from "./data.js";
import { assertDatabaseReady } from "./migrations.js";
import {
  sendAccountApprovedNotification,
  sendAccountRejectedNotification,
  sendCredentialNotification,
  sendDistributionElectionApprovedNotification,
  sendDistributionElectionAlertNotification,
  sendDistributionElectionRequestNotification,
  sendEarlyWithdrawalApprovedNotification,
  sendEarlyWithdrawalRejectedNotification,
  sendEarlyWithdrawalRequestAlertNotification,
  sendIdentityReviewAlertNotification,
  sendIssueCreatedNotification,
  sendNewDealAnnouncementNotification,
  sendPasswordResetNotification,
  sendPoolCommitmentNotification,
  sendPoolVoteAlertNotification,
  sendProjectAllocationNotification
} from "./notifications.js";
import { pool, queryAll, queryOne, withTransaction } from "./postgres.js";

const PASSWORD_RESET_TTL_MINUTES = 60;
const ID_CARD_UPLOAD_MAX_BYTES = readPositiveIntegerEnv(
  "ID_CARD_UPLOAD_MAX_BYTES",
  3 * 1024 * 1024
);
const RESOURCE_UPLOAD_MAX_BYTES = readPositiveIntegerEnv(
  "RESOURCE_UPLOAD_MAX_BYTES",
  10 * 1024 * 1024
);
const PAYMENT_PROOF_UPLOAD_MAX_BYTES = readPositiveIntegerEnv(
  "PAYMENT_PROOF_UPLOAD_MAX_BYTES",
  10 * 1024 * 1024
);
const DEFAULT_EARLY_WITHDRAWAL_PENALTY_RATE = 0.3;
const DISTRIBUTION_ELECTION_DEADLINE_DAYS = readPositiveIntegerEnv(
  "DISTRIBUTION_ELECTION_DEADLINE_DAYS",
  14
);
const ALLOWED_ID_CARD_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const ALLOWED_PAYMENT_PROOF_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const ALLOWED_RESOURCE_MIME_TYPES = new Set([
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/plain"
]);
const ACCOUNT_APPROVAL_STATUSES = new Set([
  "profile_required",
  "pending_review",
  "approved",
  "rejected"
]);
export const LEGAL_DOCUMENT_DEFINITIONS = [
  {
    key: "contractor_equity_election_form",
    title: "Contractor Equity Election Form",
    version: "2026-04-30",
    fileName: "documents/contractors/new_user/Contractor Equity Election Form + Tracking System.pdf",
    requiredCategories: ["contractor"],
    requiresDeferredAmount: true,
    onboardingOnly: true
  },
  {
    key: "subscription_agreement_237_ville",
    title: "Subscription Agreement and Deal Sheet",
    version: "2026-04-30",
    fileName: "documents/all/237 Ville Investor Package (subscription Agreement + Deal Sheet).pdf",
    requiredCategories: ["investor", "pool_member"],
    requiresInvestmentAmount: true,
    requiresPaymentProof: true
  },
  {
    key: "operating_agreement_237_ville",
    title: "Operating Agreement of 237_Ville Development Group LLC",
    version: "2026-04-30",
    fileName: "Project Llc Operating Agreement (real Estate Deal).pdf",
    requiredCategories: ["investor", "pool_member", "contractor"]
  }
];
const DOCUMENT_APPLIES_TO_ALL_CATEGORIES = ["investor", "pool_member", "contractor"];
const INVESTOR_DOCUMENT_CATEGORIES = ["investor", "pool_member"];
const CONTRACTOR_DOCUMENT_CATEGORIES = ["contractor"];
const LEGAL_DOCUMENT_ROOTS = ["documents", "document"];
const LEGAL_DOCUMENT_DIRECTORY_SCOPES = [
  {
    relativeDir: "all",
    requiredCategories: DOCUMENT_APPLIES_TO_ALL_CATEGORIES,
    onboardingOnly: false
  },
  {
    relativeDir: "contractors",
    requiredCategories: CONTRACTOR_DOCUMENT_CATEGORIES,
    onboardingOnly: false
  },
  {
    relativeDir: "contractors/new_user",
    requiredCategories: CONTRACTOR_DOCUMENT_CATEGORIES,
    onboardingOnly: true
  },
  {
    relativeDir: "contractors/new_users",
    requiredCategories: CONTRACTOR_DOCUMENT_CATEGORIES,
    onboardingOnly: true
  },
  {
    relativeDir: "investors",
    requiredCategories: INVESTOR_DOCUMENT_CATEGORIES,
    onboardingOnly: false
  },
  {
    relativeDir: "investors/new_user",
    requiredCategories: INVESTOR_DOCUMENT_CATEGORIES,
    onboardingOnly: true
  },
  {
    relativeDir: "investors/new_users",
    requiredCategories: INVESTOR_DOCUMENT_CATEGORIES,
    onboardingOnly: true
  },
  {
    relativeDir: "investores/new_use",
    requiredCategories: INVESTOR_DOCUMENT_CATEGORIES,
    onboardingOnly: true
  },
  {
    relativeDir: "investores/new_uses",
    requiredCategories: INVESTOR_DOCUMENT_CATEGORIES,
    onboardingOnly: true
  }
];
const STATIC_LEGAL_DOCUMENTS_BY_FILE = new Map(
  LEGAL_DOCUMENT_DEFINITIONS.map((document) => [normalizeDocumentPath(document.fileName), document])
);

function normalizeDocumentPath(filePath) {
  return String(filePath ?? "").replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function formatLegalDocumentTitle(fileName) {
  return basename(fileName, extname(fileName))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createDynamicLegalDocumentKey(filePath) {
  return `document_${createHash("sha256")
    .update(normalizeDocumentPath(filePath))
    .digest("hex")
    .slice(0, 20)}`;
}

function createDynamicLegalDocumentVersion(filePath) {
  const fileBuffer = readFileSync(filePath);

  return `sha256-${createHash("sha256").update(fileBuffer).digest("hex").slice(0, 16)}`;
}

function inferDynamicLegalDocumentRequirements(title, requiredCategories) {
  const normalizedTitle = title.toLowerCase();
  const investorFacing = requiredCategories.some((category) =>
    INVESTOR_DOCUMENT_CATEGORIES.includes(category)
  );
  const contractorFacing = requiredCategories.includes("contractor");
  const isSubscriptionLike =
    investorFacing &&
    normalizedTitle.includes("subscription") &&
    normalizedTitle.includes("agreement");
  const isContractorEquityLike =
    contractorFacing &&
    normalizedTitle.includes("contractor") &&
    (normalizedTitle.includes("equity") || normalizedTitle.includes("election"));

  return {
    requiresInvestmentAmount: isSubscriptionLike,
    requiresPaymentProof: isSubscriptionLike,
    requiresDeferredAmount: isContractorEquityLike
  };
}

function readLegalDocumentsFromDirectory(root, scope) {
  const directoryPath = join(root, scope.relativeDir);

  if (!existsSync(directoryPath)) {
    return [];
  }

  return readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".pdf")
    .map((entry) => {
      const fileName = normalizeDocumentPath(join(directoryPath, entry.name));
      const staticDocument = STATIC_LEGAL_DOCUMENTS_BY_FILE.get(fileName);

      if (staticDocument) {
        return {
          ...mapLegalDocumentDefinition(staticDocument),
          fileName,
          onboardingOnly: Boolean(staticDocument.onboardingOnly)
        };
      }

      const title = formatLegalDocumentTitle(entry.name);
      const supplementRequirements = inferDynamicLegalDocumentRequirements(
        title,
        scope.requiredCategories
      );

      return {
        key: createDynamicLegalDocumentKey(fileName),
        title,
        version: createDynamicLegalDocumentVersion(fileName),
        fileName,
        requiredCategories: [...scope.requiredCategories],
        ...supplementRequirements,
        onboardingOnly: Boolean(scope.onboardingOnly)
      };
    });
}

export function getLegalDocumentDefinitions({ includeNewUserDocuments = true } = {}) {
  const documentsByKey = new Map(
    LEGAL_DOCUMENT_DEFINITIONS.map((document) => [
      document.key,
      {
        ...mapLegalDocumentDefinition(document),
        onboardingOnly: Boolean(document.onboardingOnly)
      }
    ])
  );

  for (const root of LEGAL_DOCUMENT_ROOTS) {
    if (!existsSync(root)) {
      continue;
    }

    for (const scope of LEGAL_DOCUMENT_DIRECTORY_SCOPES) {
      for (const document of readLegalDocumentsFromDirectory(root, scope)) {
        documentsByKey.set(document.key, document);
      }
    }
  }

  return Array.from(documentsByKey.values())
    .filter((document) => includeNewUserDocuments || !document.onboardingOnly)
    .sort((left, right) => {
      const categoryCompare = left.requiredCategories.join(",").localeCompare(
        right.requiredCategories.join(",")
      );

      return categoryCompare !== 0 ? categoryCompare : left.title.localeCompare(right.title);
    });
}

function readPositiveIntegerEnv(name, fallback) {
  const parsed = Number(process.env[name]);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatByteLimit(bytes) {
  const megabytes = bytes / (1024 * 1024);

  return Number.isInteger(megabytes) ? `${megabytes} MB` : `${bytes} bytes`;
}

function nowTimestamp() {
  return new Date().toISOString();
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysToDateStamp(dateStamp, days) {
  const [year, month, day] = String(dateStamp ?? todayStamp())
    .split("-")
    .map((item) => Number(item));
  const baseDate = new Date(Date.UTC(year, month - 1, day));

  if (Number.isNaN(baseDate.getTime())) {
    throw new Error("Date must use the YYYY-MM-DD format.");
  }

  baseDate.setUTCDate(baseDate.getUTCDate() + days);

  return baseDate.toISOString().slice(0, 10);
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function normalizeOptionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeOptionalDateInput(value, fieldLabel) {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldLabel} must use the YYYY-MM-DD format.`);
  }

  return normalized;
}

function normalizeRequiredTextInput(value, fieldLabel, { minLength = 1 } = {}) {
  const normalized = normalizeOptionalText(value);

  if (!normalized || normalized.length < minLength) {
    throw new Error(`${fieldLabel} is required.`);
  }

  return normalized;
}

function normalizeBooleanInput(value) {
  return value === true || value === "true" || value === "on" || value === "1" || value === 1;
}

function normalizeRequiredDateInput(value, fieldLabel) {
  const normalized = normalizeOptionalDateInput(value, fieldLabel);

  if (!normalized) {
    throw new Error(`${fieldLabel} is required.`);
  }

  const [year, month, day] = normalized.split("-").map((item) => Number(item));
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`${fieldLabel} must be a valid calendar date.`);
  }

  return normalized;
}

function assertValidIdentityDocumentDates(issueDate, expirationDate) {
  const today = todayStamp();

  if (issueDate > today) {
    throw new Error("ID issue date cannot be in the future.");
  }

  if (expirationDate <= issueDate) {
    throw new Error("ID expiration date must be after the issue date.");
  }

  if (expirationDate < today) {
    throw new Error("ID document is expired.");
  }
}

function normalizeMonthInput(value, fieldLabel) {
  const normalized = String(value ?? "").trim();

  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldLabel} must use the YYYY-MM format.`);
  }

  const [year, month] = normalized.split("-").map((item) => Number(item));

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error(`${fieldLabel} must be a valid calendar month.`);
  }

  return normalized;
}

function isInvestmentWindowClosed(investmentCloseOn, asOfDate = todayStamp()) {
  const normalizedCloseDate = normalizeOptionalText(investmentCloseOn);
  return Boolean(normalizedCloseDate && normalizedCloseDate < asOfDate);
}

function normalizeConfigValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+#.*$/, "")
    .trim();
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl ?? "").match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);

  if (!match) {
    throw new Error("Uploads must be sent as a valid data URL.");
  }

  const mimeType = normalizeOptionalText(match[1])?.toLowerCase() ?? "";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  let byteLength = 0;

  try {
    byteLength = isBase64
      ? Buffer.from(payload, "base64").length
      : Buffer.byteLength(decodeURIComponent(payload), "utf8");
  } catch {
    throw new Error("Uploaded file data is invalid.");
  }

  return {
    mimeType,
    byteLength
  };
}

function assertUploadedFileData({ dataUrl, mimeType, maxBytes, allowedMimeTypes, maxBytesLabel }) {
  const normalizedMimeType = String(mimeType ?? "").trim().toLowerCase();
  const parsed = parseDataUrl(dataUrl);

  if (parsed.mimeType && parsed.mimeType !== normalizedMimeType) {
    throw new Error("Uploaded file type does not match the file data.");
  }

  if (!allowedMimeTypes.has(normalizedMimeType)) {
    throw new Error("Uploaded file type is not allowed.");
  }

  if (parsed.byteLength <= 0 || parsed.byteLength > maxBytes) {
    throw new Error(`Uploads must be smaller than ${maxBytesLabel}.`);
  }
}

function mapLegalDocumentDefinition(document) {
  return {
    key: document.key,
    title: document.title,
    version: document.version,
    fileName: document.fileName,
    requiredCategories: [...document.requiredCategories],
    requiresInvestmentAmount: Boolean(document.requiresInvestmentAmount),
    requiresPaymentProof: Boolean(document.requiresPaymentProof),
    requiresDeferredAmount: Boolean(document.requiresDeferredAmount),
    onboardingOnly: Boolean(document.onboardingOnly)
  };
}

export function getLegalDocumentDefinition(documentKey) {
  const key = String(documentKey ?? "").trim();
  const document = getLegalDocumentDefinitions().find((item) => item.key === key);

  return document ? mapLegalDocumentDefinition(document) : null;
}

export function getRequiredLegalDocumentsForCategory(
  category,
  { includeNewUserDocuments = true } = {}
) {
  const normalizedCategory = normalizeCategory(category);

  if (!normalizedCategory || normalizedCategory === "manager") {
    return [];
  }

  return getLegalDocumentDefinitions({ includeNewUserDocuments }).filter((document) =>
    document.requiredCategories.includes(normalizedCategory)
  );
}

export function isInvestorQuestionnaireRequired(category) {
  return ["investor", "pool_member"].includes(normalizeCategory(category));
}

function roundNumber(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sumDebtServiceInterest(entries = []) {
  return roundNumber(
    entries.reduce((sum, entry) => sum + Number(entry?.interestPaid ?? 0), 0)
  );
}

function sumDealExpenses(entries = []) {
  return roundNumber(entries.reduce((sum, entry) => sum + Number(entry?.amountPaid ?? 0), 0));
}

function computeDistributionAmounts(election, totalPayout) {
  const normalizedTotalPayout = roundNumber(Math.max(0, Number(totalPayout ?? 0)));
  let reinvestAmount = 0;

  if (election?.electionMode === "reinvest_all") {
    reinvestAmount = normalizedTotalPayout;
  } else if (election?.electionMode === "split_percentage") {
    reinvestAmount = roundNumber(normalizedTotalPayout * Number(election?.reinvestPercent ?? 0));
  } else if (election?.electionMode === "split_amount") {
    reinvestAmount = roundNumber(Number(election?.reinvestAmount ?? 0));
  }

  reinvestAmount = roundNumber(Math.max(0, Math.min(reinvestAmount, normalizedTotalPayout)));
  const cashPayoutAmount = roundNumber(normalizedTotalPayout - reinvestAmount);

  return {
    totalPayout: normalizedTotalPayout,
    reinvestAmount,
    cashPayoutAmount
  };
}

function computeEarlyWithdrawalAmounts(capitalAmount, penaltyRate) {
  const normalizedCapitalAmount = roundNumber(Math.max(0, Number(capitalAmount ?? 0)));
  const normalizedPenaltyRate = roundNumber(
    Math.max(0, Math.min(1, Number(penaltyRate ?? DEFAULT_EARLY_WITHDRAWAL_PENALTY_RATE)))
  );
  const penaltyAmount = roundNumber(normalizedCapitalAmount * normalizedPenaltyRate);
  const payoutAmount = roundNumber(Math.max(normalizedCapitalAmount - penaltyAmount, 0));

  return {
    capitalAmount: normalizedCapitalAmount,
    penaltyRate: normalizedPenaltyRate,
    penaltyAmount,
    payoutAmount
  };
}

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function normalizePositiveCurrencyAmount(value, fieldLabel) {
  const amount = roundNumber(Number(value));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${fieldLabel} must be greater than zero.`);
  }

  return amount;
}

function normalizePoolStatus(status) {
  const normalized = String(status ?? "").trim();

  if (!["open", "voting", "funded"].includes(normalized)) {
    throw new Error("Pool status is invalid.");
  }

  return normalized;
}

function isPoolVotingClosed(voteClosesOn, asOfDate = todayStamp()) {
  const normalizedCloseDate = normalizeOptionalText(voteClosesOn);
  return Boolean(normalizedCloseDate && normalizedCloseDate < asOfDate);
}

async function getInvestorPoolById(poolId, executor = pool) {
  const normalizedPoolId = String(poolId ?? "").trim();

  if (!normalizedPoolId) {
    return null;
  }

  const row = await queryOne(
    `
      SELECT
        id,
        name,
        pool_participant_id AS "poolParticipantId",
        minimum_capital_amount AS "minimumCapitalAmount",
        status,
        vote_closes_on AS "voteClosesOn",
        selected_deal_id AS "selectedDealId",
        funded_on AS "fundedOn",
        created_by_user_id AS "createdByUserId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM investor_pools
      WHERE id = $1
    `,
    [normalizedPoolId],
    executor
  );

  if (!row) {
    return null;
  }

  return {
    ...row,
    minimumCapitalAmount: Number(row.minimumCapitalAmount)
  };
}

async function getInvestorPoolCommitments(poolId, executor = pool) {
  return (await queryAll(
    `
      SELECT
        id,
        pool_id AS "poolId",
        participant_id AS "participantId",
        commitment_amount AS "commitmentAmount",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM investor_pool_commitments
      WHERE pool_id = $1
      ORDER BY created_at, id
    `,
    [poolId],
    executor
  )).map((row) => ({
    ...row,
    commitmentAmount: Number(row.commitmentAmount)
  }));
}

async function getInvestorPoolVoteSummary(poolId, executor = pool) {
  return (await queryAll(
    `
      SELECT
        votes.deal_id AS "dealId",
        COALESCE(SUM(commitments.commitment_amount), 0)::float AS "voteWeightAmount",
        COUNT(votes.id)::int AS "voteCount"
      FROM investor_pool_votes votes
      JOIN investor_pool_commitments commitments
        ON commitments.pool_id = votes.pool_id
       AND commitments.participant_id = votes.participant_id
      WHERE votes.pool_id = $1
      GROUP BY votes.deal_id
      ORDER BY "voteWeightAmount" DESC, votes.deal_id
    `,
    [poolId],
    executor
  )).map((row) => ({
    ...row,
    voteWeightAmount: Number(row.voteWeightAmount),
    voteCount: Number(row.voteCount)
  }));
}

async function syncInvestorPoolStatus(poolId, executor = pool) {
  const investmentPool = await getInvestorPoolById(poolId, executor);

  if (!investmentPool) {
    return null;
  }

  const commitmentTotalRow = await queryOne(
    `
      SELECT COALESCE(SUM(commitment_amount), 0)::float AS "totalCommitted"
      FROM investor_pool_commitments
      WHERE pool_id = $1
    `,
    [poolId],
    executor
  );
  const totalCommitted = Number(commitmentTotalRow?.totalCommitted ?? 0);
  const nextStatus = investmentPool.selectedDealId
    ? "funded"
    : totalCommitted >= investmentPool.minimumCapitalAmount
      ? "voting"
      : "open";

  if (nextStatus !== investmentPool.status) {
    await executor.query(
      `
        UPDATE investor_pools
        SET status = $1, updated_at = $2
        WHERE id = $3
      `,
      [nextStatus, nowTimestamp(), poolId]
    );
  }

  return {
    ...investmentPool,
    status: nextStatus,
    totalCommitted
  };
}

async function getEligiblePoolTargetDeal(dealId, executor = pool) {
  const normalizedDealId = String(dealId ?? "").trim();

  if (!normalizedDealId) {
    throw new Error("A valid target project is required.");
  }

  const deal = await queryOne(
    `
      SELECT
        id,
        name,
        status,
        investment_close_on AS "investmentCloseOn"
      FROM deals
      WHERE id = $1
    `,
    [normalizedDealId],
    executor
  );

  if (!deal) {
    throw new Error("Target project not found.");
  }

  if (deal.status === "sold") {
    throw new Error("Sold projects cannot receive pooled capital.");
  }

  if (isInvestmentWindowClosed(deal.investmentCloseOn)) {
    throw new Error(
      `Investments for ${deal.name} closed on ${deal.investmentCloseOn}. This pool cannot be deployed there.`
    );
  }

  return deal;
}

async function getArchiveActorSnapshot(userId, executor = pool) {
  const normalizedUserId = String(userId ?? "").trim();

  if (!normalizedUserId) {
    return null;
  }

  return queryOne(
    `
      SELECT
        users.id AS id,
        users.role AS role,
        users.email AS email,
        participants.name AS name
      FROM users
      LEFT JOIN participants ON participants.id = users.participant_id
      WHERE users.id = $1
    `,
    [normalizedUserId],
    executor
  );
}

function hashResetToken(token) {
  return createHash("sha256").update(String(token ?? "")).digest("hex");
}

function buildPasswordResetUrl(token) {
  const appUrl =
    normalizeConfigValue(process.env.APP_URL) || "https://investors.njinkofarm.com/";
  const separator = appUrl.includes("?") ? "&" : "?";
  return `${appUrl}${separator}resetToken=${encodeURIComponent(token)}`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");

  return {
    salt,
    hash
  };
}

function splitName(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return {
      firstName: "",
      middleName: "",
      lastName: ""
    };
  }

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      middleName: "",
      lastName: ""
    };
  }

  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts.at(-1)
  };
}

function buildFullName(firstName, middleName, lastName, fallbackName = "") {
  const parts = [firstName, middleName, lastName]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return parts.join(" ") || String(fallbackName ?? "").trim();
}

function normalizeIdCardFile(file) {
  if (!file || typeof file !== "object") {
    return null;
  }

  const fileName = normalizeOptionalText(file.name);
  const mimeType = normalizeOptionalText(file.type);
  const dataUrl = normalizeOptionalText(file.dataUrl);
  const size = Number(file.size ?? 0);

  if (!fileName || !mimeType || !dataUrl) {
    throw new Error("ID card uploads must include a file name, mime type, and file data.");
  }

  if (!Number.isFinite(size) || size <= 0 || size > ID_CARD_UPLOAD_MAX_BYTES) {
    throw new Error(
      `ID card uploads must be smaller than ${formatByteLimit(ID_CARD_UPLOAD_MAX_BYTES)}.`
    );
  }

  assertUploadedFileData({
    dataUrl,
    mimeType,
    maxBytes: ID_CARD_UPLOAD_MAX_BYTES,
    maxBytesLabel: formatByteLimit(ID_CARD_UPLOAD_MAX_BYTES),
    allowedMimeTypes: ALLOWED_ID_CARD_MIME_TYPES
  });

  return {
    fileName,
    mimeType,
    dataUrl
  };
}

function normalizeResourceFile(file) {
  if (!file || typeof file !== "object") {
    return null;
  }

  const fileName = normalizeOptionalText(file.name);
  const mimeType = normalizeOptionalText(file.type);
  const dataUrl = normalizeOptionalText(file.dataUrl);
  const size = Number(file.size ?? 0);

  if (!fileName || !mimeType || !dataUrl) {
    throw new Error("Uploads must include a file name, mime type, and file data.");
  }

  if (!Number.isFinite(size) || size <= 0 || size > RESOURCE_UPLOAD_MAX_BYTES) {
    throw new Error(
      `Uploads must be smaller than ${formatByteLimit(RESOURCE_UPLOAD_MAX_BYTES)}.`
    );
  }

  assertUploadedFileData({
    dataUrl,
    mimeType,
    maxBytes: RESOURCE_UPLOAD_MAX_BYTES,
    maxBytesLabel: formatByteLimit(RESOURCE_UPLOAD_MAX_BYTES),
    allowedMimeTypes: ALLOWED_RESOURCE_MIME_TYPES
  });

  return {
    fileName,
    mimeType,
    dataUrl
  };
}

function normalizePaymentProofFile(file) {
  if (!file || typeof file !== "object") {
    return null;
  }

  const fileName = normalizeOptionalText(file.name);
  const mimeType = normalizeOptionalText(file.type);
  const dataUrl = normalizeOptionalText(file.dataUrl);
  const size = Number(file.size ?? 0);

  if (!fileName || !mimeType || !dataUrl) {
    throw new Error("Proof of payment uploads must include a file name, mime type, and file data.");
  }

  if (!Number.isFinite(size) || size <= 0 || size > PAYMENT_PROOF_UPLOAD_MAX_BYTES) {
    throw new Error(
      `Proof of payment uploads must be smaller than ${formatByteLimit(PAYMENT_PROOF_UPLOAD_MAX_BYTES)}.`
    );
  }

  assertUploadedFileData({
    dataUrl,
    mimeType,
    maxBytes: PAYMENT_PROOF_UPLOAD_MAX_BYTES,
    maxBytesLabel: formatByteLimit(PAYMENT_PROOF_UPLOAD_MAX_BYTES),
    allowedMimeTypes: ALLOWED_PAYMENT_PROOF_MIME_TYPES
  });

  return {
    fileName,
    mimeType,
    dataUrl
  };
}

function normalizeCategory(category) {
  return String(category ?? "").trim();
}

function normalizePersonInput(input) {
  const firstName = String(input.firstName ?? "").trim();
  const middleName = String(input.middleName ?? "").trim();
  const lastName = String(input.lastName ?? "").trim();
  const email = normalizeEmail(input.email ?? "");
  const password = String(input.password ?? "");
  const contactPhone = normalizeOptionalText(input.contactPhone ?? input.contact);
  const currentAddress = normalizeOptionalText(input.currentAddress);
  const mailingAddress = normalizeOptionalText(input.mailingAddress);
  const driverLicenseNumber = normalizeOptionalText(input.driverLicenseNumber);
  const payoutMethod = normalizeOptionalText(input.payoutMethod);
  const bankAccountName = normalizeOptionalText(input.bankAccountName);
  const bankName = normalizeOptionalText(input.bankName);
  const bankRoutingNumber = normalizeOptionalText(input.bankRoutingNumber);
  const bankAccountNumber = normalizeOptionalText(input.bankAccountNumber);
  const zelleDetails = normalizeOptionalText(input.zelleDetails);
  const cashAppHandle = normalizeOptionalText(input.cashAppHandle);
  const payoutNotes = normalizeOptionalText(input.payoutNotes);
  const idCardFile = normalizeIdCardFile(input.idCardFile);

  return {
    firstName,
    middleName,
    lastName,
    fullName: buildFullName(firstName, middleName, lastName),
    email,
    password,
    contactPhone,
    currentAddress,
    mailingAddress,
    driverLicenseNumber,
    payoutMethod,
    bankAccountName,
    bankName,
    bankRoutingNumber,
    bankAccountNumber,
    zelleDetails,
    cashAppHandle,
    payoutNotes,
    idCardFile
  };
}

function normalizeAccountApprovalStatus(value, fallback = "approved") {
  const normalized = String(value ?? "").trim();
  return ACCOUNT_APPROVAL_STATUSES.has(normalized) ? normalized : fallback;
}

function getInitialAccountApprovalStatus(category, explicitStatus = null) {
  if (explicitStatus) {
    return normalizeAccountApprovalStatus(explicitStatus, "profile_required");
  }

  return category === "manager" ? "approved" : "profile_required";
}

function normalizeIdentityReviewInput(input, { hasExistingIdCard = false } = {}) {
  const contactPhone = normalizeRequiredTextInput(input?.contactPhone ?? input?.contact, "Contact");
  const driverLicenseNumber = normalizeRequiredTextInput(
    input?.driverLicenseNumber,
    "Driver's license number"
  );
  const currentAddress = normalizeRequiredTextInput(input?.currentAddress, "Current address");
  const mailingAddress = normalizeRequiredTextInput(input?.mailingAddress, "Mailing address");
  const idDocumentIssueDate = normalizeRequiredDateInput(
    input?.idDocumentIssueDate,
    "ID issue date"
  );
  const idDocumentExpirationDate = normalizeRequiredDateInput(
    input?.idDocumentExpirationDate,
    "ID expiration date"
  );
  const idCardFile = normalizeIdCardFile(input?.idCardFile);

  assertValidIdentityDocumentDates(idDocumentIssueDate, idDocumentExpirationDate);

  if (!idCardFile && !hasExistingIdCard) {
    throw new Error("A copy of the driver's license or ID card is required.");
  }

  return {
    contactPhone,
    driverLicenseNumber,
    currentAddress,
    mailingAddress,
    idDocumentIssueDate,
    idDocumentExpirationDate,
    idCardFile
  };
}

function normalizeLegalAcknowledgementInput(input, currentUser) {
  const requiredDocuments = getRequiredLegalDocumentsForCategory(currentUser?.category);

  if (!requiredDocuments.length) {
    return [];
  }

  const submittedDocuments = Array.isArray(input?.legalAcknowledgements)
    ? input.legalAcknowledgements
    : [];
  const submittedByKey = new Map(
    submittedDocuments
      .map((item) => [String(item?.documentKey ?? "").trim(), item])
      .filter(([documentKey]) => Boolean(documentKey))
  );

  return requiredDocuments.map((document) => {
    const acknowledgement = submittedByKey.get(document.key);
    const accepted =
      acknowledgement?.accepted === true ||
      acknowledgement?.accepted === "true" ||
      acknowledgement?.accepted === "on";

    if (!accepted) {
      throw new Error(`${document.title} must be acknowledged before account review.`);
    }

    const signerName = normalizeRequiredTextInput(
      acknowledgement?.signerName,
      `${document.title} signature`,
      { minLength: 2 }
    );
    const investmentAmount = document.requiresInvestmentAmount
      ? normalizePositiveCurrencyAmount(
          acknowledgement?.investmentAmount,
          `${document.title} investment amount`
        )
      : null;
    const deferredAmount = document.requiresDeferredAmount
      ? normalizePositiveCurrencyAmount(
          acknowledgement?.deferredAmount,
          `${document.title} deferred amount`
        )
      : null;
    const proofOfPaymentFile = document.requiresPaymentProof
      ? normalizePaymentProofFile(acknowledgement?.proofOfPaymentFile)
      : null;

    if (document.requiresPaymentProof && !proofOfPaymentFile) {
      throw new Error(`${document.title} requires proof of payment upload.`);
    }

    return {
      documentKey: document.key,
      documentTitle: document.title,
      documentVersion: document.version,
      documentFileName: document.fileName,
      requiredForCategory: currentUser.category,
      signerName,
      investmentAmount,
      deferredAmount,
      proofOfPaymentFile
    };
  });
}

function normalizeRequiredLegalAcknowledgementInput(input, currentUser, pendingDocuments) {
  if (!pendingDocuments.length) {
    return [];
  }

  const submittedDocuments = Array.isArray(input?.legalAcknowledgements)
    ? input.legalAcknowledgements
    : [];
  const submittedByKey = new Map(
    submittedDocuments
      .map((item) => [String(item?.documentKey ?? "").trim(), item])
      .filter(([documentKey]) => Boolean(documentKey))
  );

  return pendingDocuments.map((document) => {
    const acknowledgement = submittedByKey.get(document.key);
    const accepted =
      acknowledgement?.accepted === true ||
      acknowledgement?.accepted === "true" ||
      acknowledgement?.accepted === "on";

    if (!accepted) {
      throw new Error(`${document.title} must be acknowledged before continuing.`);
    }

    const signerName = normalizeRequiredTextInput(
      acknowledgement?.signerName,
      `${document.title} signature`,
      { minLength: 2 }
    );

    return {
      documentKey: document.key,
      documentTitle: document.title,
      documentVersion: document.version,
      documentFileName: document.fileName,
      requiredForCategory: currentUser.category,
      signerName
    };
  });
}

function normalizeInvestorQuestionnaireInput(input, currentUser, identity) {
  if (!isInvestorQuestionnaireRequired(currentUser?.category)) {
    return null;
  }

  const questionnaire = input?.investorQuestionnaire ?? {};
  const nameEntity = normalizeRequiredTextInput(
    questionnaire.nameEntity ?? currentUser?.name,
    "Investor questionnaire name/entity",
    { minLength: 2 }
  );
  const address = normalizeRequiredTextInput(
    questionnaire.address ?? identity?.currentAddress,
    "Investor questionnaire address",
    { minLength: 3 }
  );
  const email = normalizeEmail(questionnaire.email ?? currentUser?.email ?? "");
  const phone = normalizeRequiredTextInput(
    questionnaire.phone ?? identity?.contactPhone,
    "Investor questionnaire phone",
    { minLength: 3 }
  );
  const investmentExperience = normalizeRequiredTextInput(
    questionnaire.investmentExperience,
    "Investment experience",
    { minLength: 3 }
  );

  if (!email.includes("@")) {
    throw new Error("Investor questionnaire email must be valid.");
  }

  return {
    nameEntity,
    address,
    email,
    phone,
    incomeOver200k: normalizeBooleanInput(questionnaire.incomeOver200k),
    netWorthOver100k: normalizeBooleanInput(questionnaire.netWorthOver100k),
    entityOver5mAssets: normalizeBooleanInput(questionnaire.entityOver5mAssets),
    investmentExperience
  };
}

function validateUserProfileForCreation(profile, category) {
  if (!["investor", "contractor", "manager", "pool_member"].includes(category)) {
    throw new Error("User category must be investor, contractor, manager, or pool member.");
  }

  if (profile.firstName.length < 2) {
    throw new Error("First name must be at least 2 characters.");
  }

  if (profile.lastName.length < 2) {
    throw new Error("Last name must be at least 2 characters.");
  }

  if (!profile.email.includes("@")) {
    throw new Error("A valid email is required.");
  }

  if (profile.password.length < 8) {
    throw new Error("Temporary password must be at least 8 characters.");
  }
}

function mapParticipantRow(row) {
  const fallback = splitName(row.name);

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    firstName: row.firstName ?? fallback.firstName,
    middleName: row.middleName ?? fallback.middleName,
    lastName: row.lastName ?? fallback.lastName,
    driverLicenseNumber: row.driverLicenseNumber ?? "",
    idCardFileName: row.idCardFileName ?? "",
    hasIdCard: Boolean(row.hasIdCard ?? row.idCardFileName),
    idDocumentIssueDate: row.idDocumentIssueDate ?? "",
    idDocumentExpirationDate: row.idDocumentExpirationDate ?? "",
    currentAddress: row.currentAddress ?? "",
    mailingAddress: row.mailingAddress ?? "",
    contactPhone: row.contactPhone ?? "",
    payoutMethod: row.payoutMethod ?? "",
    bankAccountName: row.bankAccountName ?? "",
    bankName: row.bankName ?? "",
    bankRoutingNumber: row.bankRoutingNumber ?? "",
    bankAccountNumber: row.bankAccountNumber ?? "",
    zelleDetails: row.zelleDetails ?? "",
    cashAppHandle: row.cashAppHandle ?? "",
    payoutNotes: row.payoutNotes ?? ""
  };
}

function mapUserRow(row) {
  if (!row) {
    return null;
  }

  const fallback = splitName(row.name);

  return {
    id: row.id,
    participantId: row.participantId,
    role: row.role,
    name: row.name,
    email: row.email,
    category: row.category,
    firstName: row.firstName ?? fallback.firstName,
    middleName: row.middleName ?? fallback.middleName,
    lastName: row.lastName ?? fallback.lastName,
    currentAddress: row.currentAddress ?? "",
    mailingAddress: row.mailingAddress ?? "",
    contactPhone: row.contactPhone ?? "",
    driverLicenseNumber: row.driverLicenseNumber ?? "",
    idCardFileName: row.idCardFileName ?? "",
    idDocumentIssueDate: row.idDocumentIssueDate ?? "",
    idDocumentExpirationDate: row.idDocumentExpirationDate ?? "",
    passwordSalt: row.passwordSalt,
    passwordHash: row.passwordHash,
    isActive: Boolean(row.isActive),
    mustChangePassword: Boolean(row.mustChangePassword),
    accountApprovalStatus: normalizeAccountApprovalStatus(row.accountApprovalStatus, "approved"),
    accountRejectionComment: row.accountRejectionComment ?? "",
    accountReviewedByUserId: row.accountReviewedByUserId ?? null,
    accountReviewedAt: row.accountReviewedAt ?? null,
    onboardingSubmittedAt: row.onboardingSubmittedAt ?? null,
    lastLoginAt: row.lastLoginAt ?? null,
    notificationStatus: row.notificationStatus ?? null,
    notificationProvider: row.notificationProvider ?? null,
    notificationLocalPath: row.notificationLocalPath ?? null
  };
}

function mapLegalAcknowledgementRow(row) {
  return {
    id: row.id,
    userId: row.userId,
    participantId: row.participantId,
    documentKey: row.documentKey,
    documentTitle: row.documentTitle,
    documentVersion: row.documentVersion,
    documentFileName: row.documentFileName ?? "",
    requiredForCategory: row.requiredForCategory,
    signerName: row.signerName,
    investmentAmount:
      row.investmentAmount === null || row.investmentAmount === undefined
        ? null
        : Number(row.investmentAmount),
    deferredAmount:
      row.deferredAmount === null || row.deferredAmount === undefined
        ? null
        : Number(row.deferredAmount),
    proofOfPaymentFileName: row.proofOfPaymentFileName ?? "",
    acknowledgedAt: row.acknowledgedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapInvestorQuestionnaireRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.userId,
    participantId: row.participantId,
    nameEntity: row.nameEntity,
    address: row.address,
    email: row.email,
    phone: row.phone,
    incomeOver200k: Boolean(row.incomeOver200k),
    netWorthOver100k: Boolean(row.netWorthOver100k),
    entityOver5mAssets: Boolean(row.entityOver5mAssets),
    investmentExperience: row.investmentExperience,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function getLegalAcknowledgementsForUser(userId, executor = pool) {
  const normalizedUserId = String(userId ?? "").trim();

  if (!normalizedUserId) {
    return [];
  }

  return (await queryAll(
    `
      SELECT
        id,
        user_id AS "userId",
        participant_id AS "participantId",
        document_key AS "documentKey",
        document_title AS "documentTitle",
        document_version AS "documentVersion",
        document_file_name AS "documentFileName",
        required_for_category AS "requiredForCategory",
        signer_name AS "signerName",
        investment_amount AS "investmentAmount",
        deferred_amount AS "deferredAmount",
        proof_of_payment_file_name AS "proofOfPaymentFileName",
        acknowledged_at AS "acknowledgedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM user_legal_acknowledgements
      WHERE user_id = $1
      ORDER BY acknowledged_at DESC, document_title
    `,
    [normalizedUserId],
    executor
	  )).map((row) => mapLegalAcknowledgementRow(row));
}

export async function getPendingLegalAcknowledgementDocuments(userId, category, executor = pool) {
  const requiredDocuments = getRequiredLegalDocumentsForCategory(category, {
    includeNewUserDocuments: false
  });

  if (!requiredDocuments.length) {
    return [];
  }

  const acknowledgements = await getLegalAcknowledgementsForUser(userId, executor);
  const signedDocuments = new Set(
    acknowledgements.map(
      (acknowledgement) =>
        `${acknowledgement.documentKey}:${acknowledgement.documentVersion}`
    )
  );

  return requiredDocuments.filter(
    (document) => !signedDocuments.has(`${document.key}:${document.version}`)
  );
}

async function getInvestorQuestionnaireForUser(userId, executor = pool) {
  const normalizedUserId = String(userId ?? "").trim();

  if (!normalizedUserId) {
    return null;
  }

  const row = await queryOne(
    `
      SELECT
        id,
        user_id AS "userId",
        participant_id AS "participantId",
        name_entity AS "nameEntity",
        address,
        email,
        phone,
        income_over_200k AS "incomeOver200k",
        net_worth_over_100k AS "netWorthOver100k",
        entity_over_5m_assets AS "entityOver5mAssets",
        investment_experience AS "investmentExperience",
        submitted_at AS "submittedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM investor_questionnaires
      WHERE user_id = $1
    `,
    [normalizedUserId],
    executor
  );

  return mapInvestorQuestionnaireRow(row);
}

async function syncDealEquity(dealId, executor = pool) {
  const result = await queryOne(
    `
      SELECT COALESCE(SUM(contribution_amount), 0)::float AS "totalEquity"
      FROM positions
      WHERE deal_id = $1
    `,
    [dealId],
    executor
  );

  await executor.query(
    `
      UPDATE deals
      SET total_equity = $1, updated_at = $2
      WHERE id = $3
    `,
    [roundNumber(result?.totalEquity ?? 0), nowTimestamp(), dealId]
  );
}

async function insertSeedData(executor) {
  const timestamp = nowTimestamp();

  for (const participant of seedData.participants) {
    await executor.query(
      `
        INSERT INTO participants (id, name, category, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [participant.id, participant.name, participant.category, timestamp, timestamp]
    );
  }

  for (const user of seedData.users) {
    await executor.query(
      `
        INSERT INTO users (
          id,
          participant_id,
          role,
          email,
          password_salt,
          password_hash,
          is_active,
          must_change_password,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        user.id,
        user.participantId,
        user.role,
        normalizeEmail(user.email),
        user.passwordSalt,
        user.passwordHash,
        1,
        0,
        timestamp,
        timestamp
      ]
    );
  }

  for (const deal of seedData.deals) {
    await executor.query(
      `
        INSERT INTO deals (
          id,
          name,
          location,
          total_equity,
          debt,
          tax_expense,
          debt_interest_rate,
          total_interest_paid,
          early_withdrawal_penalty_rate,
          budgeted_project_cost,
          actual_project_cost,
          sale_price,
          hold_months,
          pref_rate,
          status,
          current_phase,
          funded_on,
          investment_close_on,
          projected_exit_on,
          actual_exit_on,
          timeline_progress,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          $21,
          $22,
          $23
        )
      `,
      [
        deal.id,
        deal.name,
        deal.location,
        deal.totalEquity,
        deal.debt,
        deal.taxExpense ?? 0,
        deal.debtInterestRate ?? 0,
        deal.totalInterestPaid ?? sumDebtServiceInterest(deal.debtServiceEntries),
        deal.earlyWithdrawalPenaltyRate ?? DEFAULT_EARLY_WITHDRAWAL_PENALTY_RATE,
        deal.budgetedProjectCost ?? deal.totalProjectCost,
        deal.actualProjectCost ?? deal.budgetedProjectCost ?? deal.totalProjectCost,
        deal.salePrice,
        deal.holdMonths,
        deal.prefRate,
        deal.status,
        deal.currentPhase,
        deal.fundedOn,
        deal.investmentCloseOn ?? null,
        deal.projectedExitOn ?? null,
        deal.actualExitOn ?? null,
        deal.timelineProgress,
        timestamp,
        timestamp
      ]
    );

    for (const [index, tier] of deal.promoteTiers.entries()) {
      await executor.query(
        `
        INSERT INTO promote_tiers (
          id,
          deal_id,
          label,
          hurdle,
          investor_share,
          sponsor_share,
          is_enabled,
          sort_order,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        createId("tier"),
        deal.id,
        tier.label,
        tier.hurdle,
        tier.investorShare,
        tier.sponsorShare,
        tier.isEnabled === false ? 0 : 1,
        index + 1,
        timestamp,
        timestamp
      ]
      );
    }

    for (const [index, milestone] of deal.timeline.entries()) {
      await executor.query(
        `
          INSERT INTO deal_timeline_items (
            id,
            deal_id,
            label,
            milestone_date,
            status,
            sort_order,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          createId("timeline"),
          deal.id,
          milestone.label,
          milestone.date,
          milestone.status,
          index + 1,
          timestamp,
          timestamp
        ]
      );
    }

    for (const entry of deal.debtServiceEntries ?? []) {
      await executor.query(
        `
          INSERT INTO deal_debt_service_entries (
            id,
            deal_id,
            interest_month,
            draw_balance,
            interest_paid,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          createId("debt-service"),
          deal.id,
          entry.serviceMonth,
          entry.drawBalance ?? 0,
          entry.interestPaid ?? 0,
          timestamp,
          timestamp
        ]
      );
    }

    for (const [index, entry] of (deal.expenseEntries ?? []).entries()) {
      await executor.query(
        `
          INSERT INTO deal_expense_entries (
            id,
            deal_id,
            stage_label,
            payee_name,
            amount_paid,
            paid_on,
            notes,
            sort_order,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          createId("expense"),
          deal.id,
          entry.stageLabel,
          entry.payeeName,
          entry.amountPaid ?? 0,
          entry.paidOn ?? null,
          entry.notes ?? null,
          index + 1,
          timestamp,
          timestamp
        ]
      );
    }
  }

  for (const position of seedData.positions) {
    await executor.query(
      `
        INSERT INTO positions (
          id,
          deal_id,
          participant_id,
          class_type,
          contribution_type,
          contribution_amount,
          distributions_to_date,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        position.id,
        position.dealId,
        position.participantId,
        position.classType,
        position.contributionType,
        position.contributionAmount,
        position.distributionsToDate ?? 0,
        timestamp,
        timestamp
      ]
    );
  }

  for (const contractor of seedData.contractors) {
    await executor.query(
      `
        INSERT INTO contractor_participation (
          id,
          deal_id,
          participant_id,
          trade,
          total_contract_value,
          cash_paid,
          deferred_amount,
          contribution_type,
          hybrid,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        contractor.id,
        contractor.dealId,
        contractor.participantId,
        contractor.trade,
        contractor.totalContractValue,
        contractor.cashPaid,
        contractor.deferredAmount,
        contractor.contributionType,
        contractor.hybrid ? 1 : 0,
        contractor.status,
        timestamp,
        timestamp
      ]
    );
  }

  for (const resource of seedData.companyResources ?? []) {
    await executor.query(
      `
        INSERT INTO company_resources (
          id,
          title,
          deal_id,
          resource_type,
          summary_text,
          body_text,
          file_name,
          file_mime_type,
          file_data_url,
          published_at,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        resource.id,
        resource.title,
        resource.dealId ?? null,
        resource.resourceType,
        resource.summary ?? null,
        resource.bodyText ?? null,
        resource.fileName || null,
        resource.fileMimeType || null,
        resource.fileDataUrl || null,
        resource.publishedAt ?? timestamp,
        seedData.users.find((user) => user.role === "manager")?.id ?? null,
        timestamp,
        timestamp
      ]
    );
  }

  for (const election of seedData.distributionElections ?? []) {
    await executor.query(
      `
        INSERT INTO distribution_elections (
          id,
          deal_id,
          participant_id,
          election_mode,
          reinvest_percent,
          reinvest_amount,
          rollover_target_deal_id,
          notes,
          submitted_by_user_id,
          submitted_by_role,
          approval_status,
          approved_reinvest_amount,
          approved_cash_payout_amount,
          payout_expected_on,
          reviewed_by_user_id,
          reviewed_at,
          manager_override,
          override_notes,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )
      `,
      [
        election.id,
        election.dealId,
        election.participantId,
        election.electionMode,
        election.reinvestPercent,
        election.reinvestAmount,
        election.rolloverTargetDealId ?? null,
        election.notes ?? null,
        election.submittedByUserId ?? null,
        election.submittedByRole ?? null,
        election.approvalStatus ?? (election.reviewedAt ? "approved" : "pending"),
        election.approvedReinvestAmount ?? null,
        election.approvedCashPayoutAmount ?? null,
        election.payoutExpectedOn ?? null,
        election.reviewedByUserId ?? null,
        election.reviewedAt ?? null,
        election.managerOverride ? 1 : 0,
        election.overrideNotes ?? null,
        timestamp,
        timestamp
      ]
    );
  }

  for (const request of seedData.earlyWithdrawalRequests ?? []) {
    await executor.query(
      `
        INSERT INTO early_withdrawal_requests (
          id,
          deal_id,
          participant_id,
          position_id,
          class_type,
          requested_capital_amount,
          penalty_rate,
          penalty_amount,
          approved_payout_amount,
          investor_notes,
          manager_notes,
          request_status,
          payout_expected_on,
          requested_by_user_id,
          reviewed_by_user_id,
          reviewed_at,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
      `,
      [
        request.id,
        request.dealId,
        request.participantId,
        request.positionId ?? null,
        request.classType ?? null,
        request.requestedCapitalAmount ?? 0,
        request.penaltyRate ?? DEFAULT_EARLY_WITHDRAWAL_PENALTY_RATE,
        request.penaltyAmount ?? 0,
        request.approvedPayoutAmount ?? null,
        request.investorNotes ?? null,
        request.managerNotes ?? null,
        request.requestStatus ?? "pending",
        request.payoutExpectedOn ?? null,
        request.requestedByUserId ?? null,
        request.reviewedByUserId ?? null,
        request.reviewedAt ?? null,
        timestamp,
        timestamp
      ]
    );
  }

  for (const deal of seedData.deals) {
    await syncDealEquity(deal.id, executor);
  }
}

export async function seedDatabase({ force = false } = {}) {
  await assertDatabaseReady();

  const counts = await queryOne(`
    SELECT
      (SELECT COUNT(*)::int FROM participants) AS participants,
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM deals) AS deals
  `);
  const hasExistingData =
    (counts?.participants ?? 0) > 0 || (counts?.users ?? 0) > 0 || (counts?.deals ?? 0) > 0;

  if (hasExistingData && !force) {
    throw new Error(
      "Database already contains data. Run `npm run seed -- --force` if you want to replace it."
    );
  }

  await withTransaction(async (client) => {
    if (force) {
      await client.query(`
        TRUNCATE TABLE
          investor_pool_votes,
          investor_pool_commitments,
          investor_pools,
          deal_issue_votes,
          deal_issues,
          email_notifications,
          company_resources,
          contractor_participation,
          distribution_elections,
          early_withdrawal_requests,
          positions,
          deal_expense_entries,
          deal_debt_service_entries,
          deal_timeline_items,
          promote_tiers,
          user_legal_acknowledgements,
          users,
          deals,
          participants
      `);
    }

    await insertSeedData(client);
  });

  return {
    participants: seedData.participants.length,
    users: seedData.users.length,
    deals: seedData.deals.length,
    positions: seedData.positions.length
  };
}

const USER_SELECT_FRAGMENT = `
  SELECT
    users.id AS id,
    users.participant_id AS "participantId",
    users.role AS role,
    participants.name AS name,
    participants.category AS category,
    participants.first_name AS "firstName",
    participants.middle_name AS "middleName",
    participants.last_name AS "lastName",
    participants.driver_license_number AS "driverLicenseNumber",
    participants.id_card_file_name AS "idCardFileName",
    participants.id_document_issue_date AS "idDocumentIssueDate",
    participants.id_document_expiration_date AS "idDocumentExpirationDate",
    participants.current_address AS "currentAddress",
    participants.mailing_address AS "mailingAddress",
    participants.contact_phone AS "contactPhone",
    users.email AS email,
    users.password_salt AS "passwordSalt",
    users.password_hash AS "passwordHash",
    users.is_active AS "isActive",
    users.must_change_password AS "mustChangePassword",
    users.account_approval_status AS "accountApprovalStatus",
    users.account_rejection_comment AS "accountRejectionComment",
    users.account_reviewed_by_user_id AS "accountReviewedByUserId",
    users.account_reviewed_at AS "accountReviewedAt",
    users.onboarding_submitted_at AS "onboardingSubmittedAt",
    users.last_login_at AS "lastLoginAt",
    notification.status AS "notificationStatus",
    notification.provider AS "notificationProvider",
    notification.local_path AS "notificationLocalPath"
  FROM users
  JOIN participants ON participants.id = users.participant_id
  LEFT JOIN LATERAL (
    SELECT status, provider, local_path
    FROM email_notifications
    WHERE user_id = users.id
    ORDER BY created_at DESC
    LIMIT 1
  ) notification ON TRUE
`;

async function getUserAccountById(userId, { includeInactive = false } = {}) {
  const row = await queryOne(
    `
      ${USER_SELECT_FRAGMENT}
      WHERE users.id = $1
      ${includeInactive ? "" : "AND users.is_active = 1"}
    `,
    [userId]
  );

  return mapUserRow(row);
}

async function countActiveManagers(executor = pool) {
  const row = await queryOne(
    `
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE role = 'manager'
        AND is_active = 1
    `,
    [],
    executor
  );

  return Number(row?.count ?? 0);
}

async function getActiveManagerRecipients({ excludeUserId = null } = {}) {
  return queryAll(
    `
      SELECT
        users.id AS "userId",
        users.participant_id AS "participantId",
        users.email AS email,
        participants.name AS "fullName"
      FROM users
      JOIN participants ON participants.id = users.participant_id
      WHERE users.role = 'manager'
        AND users.is_active = 1
        AND ($1::text IS NULL OR users.id <> $1)
      ORDER BY participants.name
    `,
    [excludeUserId]
  );
}

async function getActiveUserRecipientForParticipant(participantId, executor = pool) {
  const normalizedParticipantId = String(participantId ?? "").trim();

  if (!normalizedParticipantId) {
    return null;
  }

  return queryOne(
    `
      SELECT
        users.id AS "userId",
        users.participant_id AS "participantId",
        users.email AS email,
        participants.name AS "fullName",
        participants.category AS category
      FROM users
      JOIN participants ON participants.id = users.participant_id
      WHERE users.participant_id = $1
        AND users.is_active = 1
      ORDER BY users.created_at
      LIMIT 1
    `,
    [normalizedParticipantId],
    executor
  );
}

export async function getUserByEmail(email) {
  const row = await queryOne(
    `
      ${USER_SELECT_FRAGMENT}
      WHERE LOWER(users.email) = $1
        AND users.is_active = 1
    `,
    [normalizeEmail(email)]
  );

  return mapUserRow(row);
}

export async function getUserById(userId) {
  return getUserAccountById(userId, { includeInactive: false });
}

export async function getAppDataSnapshot({ skipAutomation = false } = {}) {
  await applyClosedPenaltyRateIssueResolutions();

  if (!skipAutomation) {
    await ensureDistributionElectionRequestsForSoldDeals();
    await applyOverdueDistributionElectionDefaults();
  }

  const participants = (await queryAll(
    `
      SELECT
        id,
        name,
        category,
        first_name AS "firstName",
        middle_name AS "middleName",
        last_name AS "lastName",
        driver_license_number AS "driverLicenseNumber",
        id_card_file_name AS "idCardFileName",
        id_document_issue_date AS "idDocumentIssueDate",
        id_document_expiration_date AS "idDocumentExpirationDate",
        current_address AS "currentAddress",
        mailing_address AS "mailingAddress",
        contact_phone AS "contactPhone",
        payout_method AS "payoutMethod",
        bank_account_name AS "bankAccountName",
        bank_name AS "bankName",
        bank_routing_number AS "bankRoutingNumber",
        bank_account_number AS "bankAccountNumber",
        zelle_details AS "zelleDetails",
        cash_app_handle AS "cashAppHandle",
        payout_notes AS "payoutNotes",
        (id_card_file_name IS NOT NULL) AS "hasIdCard"
      FROM participants
      ORDER BY name
    `
  )).map((row) => mapParticipantRow(row));

  const users = (await queryAll(
    `
      ${USER_SELECT_FRAGMENT}
      ORDER BY participants.name
    `
  )).map((row) => mapUserRow(row));
  const userLegalAcknowledgements = (await queryAll(
    `
      SELECT
        id,
        user_id AS "userId",
        participant_id AS "participantId",
        document_key AS "documentKey",
        document_title AS "documentTitle",
        document_version AS "documentVersion",
        document_file_name AS "documentFileName",
        required_for_category AS "requiredForCategory",
        signer_name AS "signerName",
        investment_amount AS "investmentAmount",
        deferred_amount AS "deferredAmount",
        proof_of_payment_file_name AS "proofOfPaymentFileName",
        acknowledged_at AS "acknowledgedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM user_legal_acknowledgements
      ORDER BY acknowledged_at DESC, document_title
    `
  )).map((row) => mapLegalAcknowledgementRow(row));
  const investorQuestionnaires = (await queryAll(
    `
      SELECT
        id,
        user_id AS "userId",
        participant_id AS "participantId",
        name_entity AS "nameEntity",
        address,
        email,
        phone,
        income_over_200k AS "incomeOver200k",
        net_worth_over_100k AS "netWorthOver100k",
        entity_over_5m_assets AS "entityOver5mAssets",
        investment_experience AS "investmentExperience",
        submitted_at AS "submittedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM investor_questionnaires
      ORDER BY submitted_at DESC, name_entity
    `
  )).map((row) => mapInvestorQuestionnaireRow(row));

  const deals = (await queryAll(
    `
      SELECT
        id,
        name,
        location,
        total_equity AS "totalEquity",
        debt,
        tax_expense AS "taxExpense",
        debt_interest_rate AS "debtInterestRate",
        total_interest_paid AS "totalInterestPaid",
        early_withdrawal_penalty_rate AS "earlyWithdrawalPenaltyRate",
        budgeted_project_cost AS "budgetedProjectCost",
        actual_project_cost AS "actualProjectCost",
        sale_price AS "salePrice",
        hold_months AS "holdMonths",
        pref_rate AS "prefRate",
        status,
        current_phase AS "currentPhase",
        funded_on AS "fundedOn",
        investment_close_on AS "investmentCloseOn",
        projected_exit_on AS "projectedExitOn",
        actual_exit_on AS "actualExitOn",
        timeline_progress AS "timelineProgress",
        distribution_election_due_on AS "distributionElectionDueOn",
        distribution_election_notice_sent_at AS "distributionElectionNoticeSentAt"
      FROM deals
      ORDER BY name
    `
  )).map((row) => ({
    ...row,
    totalEquity: Number(row.totalEquity),
    debt: Number(row.debt),
    taxExpense: Number(row.taxExpense),
    debtInterestRate: Number(row.debtInterestRate),
    totalInterestPaid: Number(row.totalInterestPaid),
    earlyWithdrawalPenaltyRate: Number(row.earlyWithdrawalPenaltyRate),
    budgetedProjectCost: Number(row.budgetedProjectCost),
    actualProjectCost:
      row.actualProjectCost === null || row.actualProjectCost === undefined
        ? null
        : Number(row.actualProjectCost),
    salePrice: Number(row.salePrice),
    holdMonths: Number(row.holdMonths),
    prefRate: Number(row.prefRate),
    timelineProgress: Number(row.timelineProgress),
    promoteTiers: [],
    timeline: [],
    expenseEntries: [],
    debtServiceEntries: []
  }));

  const dealMap = new Map(deals.map((deal) => [deal.id, deal]));

  for (const row of await queryAll(
    `
      SELECT
        deal_id AS "dealId",
        label,
        hurdle,
        investor_share AS "investorShare",
        sponsor_share AS "sponsorShare",
        is_enabled AS "isEnabled",
        sort_order AS "sortOrder"
      FROM promote_tiers
      ORDER BY deal_id, sort_order
    `
  )) {
    dealMap.get(row.dealId)?.promoteTiers.push({
      label: row.label,
      hurdle: Number(row.hurdle),
      investorShare: Number(row.investorShare),
      sponsorShare: Number(row.sponsorShare),
      isEnabled: Boolean(row.isEnabled),
      description: `${row.label} promote hurdle`,
      sortOrder: Number(row.sortOrder)
    });
  }

  for (const row of await queryAll(
    `
      SELECT
        deal_id AS "dealId",
        label,
        milestone_date AS date,
        status,
        sort_order AS "sortOrder"
      FROM deal_timeline_items
      ORDER BY deal_id, sort_order
    `
  )) {
    dealMap.get(row.dealId)?.timeline.push({
      label: row.label,
      date: row.date,
      status: row.status,
      sortOrder: Number(row.sortOrder)
    });
  }

  for (const row of await queryAll(
    `
      SELECT
        deal_id AS "dealId",
        stage_label AS "stageLabel",
        payee_name AS "payeeName",
        amount_paid AS "amountPaid",
        paid_on AS "paidOn",
        notes,
        sort_order AS "sortOrder"
      FROM deal_expense_entries
      ORDER BY deal_id, sort_order
    `
  )) {
    dealMap.get(row.dealId)?.expenseEntries.push({
      stageLabel: row.stageLabel,
      payeeName: row.payeeName,
      amountPaid: Number(row.amountPaid),
      paidOn: row.paidOn,
      notes: row.notes ?? "",
      sortOrder: Number(row.sortOrder)
    });
  }

  for (const row of await queryAll(
    `
      SELECT
        deal_id AS "dealId",
        interest_month AS "serviceMonth",
        draw_balance AS "drawBalance",
        interest_paid AS "interestPaid"
      FROM deal_debt_service_entries
      ORDER BY deal_id, interest_month
    `
  )) {
    dealMap.get(row.dealId)?.debtServiceEntries.push({
      serviceMonth: row.serviceMonth,
      drawBalance: Number(row.drawBalance),
      interestPaid: Number(row.interestPaid)
    });
  }

  const positions = (await queryAll(
    `
      SELECT
        id,
        deal_id AS "dealId",
        participant_id AS "participantId",
        class_type AS "classType",
        contribution_type AS "contributionType",
        contribution_amount AS "contributionAmount",
        distributions_to_date AS "distributionsToDate"
      FROM positions
      ORDER BY deal_id, participant_id
    `
  )).map((row) => ({
    ...row,
    contributionAmount: Number(row.contributionAmount),
    distributionsToDate: Number(row.distributionsToDate)
  }));

  const investorPools = (await queryAll(
    `
      SELECT
        id,
        name,
        pool_participant_id AS "poolParticipantId",
        minimum_capital_amount AS "minimumCapitalAmount",
        status,
        vote_closes_on AS "voteClosesOn",
        selected_deal_id AS "selectedDealId",
        funded_on AS "fundedOn",
        created_by_user_id AS "createdByUserId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM investor_pools
      ORDER BY created_at DESC, id
    `
  )).map((row) => ({
    ...row,
    minimumCapitalAmount: Number(row.minimumCapitalAmount)
  }));

  const investorPoolCommitments = (await queryAll(
    `
      SELECT
        id,
        pool_id AS "poolId",
        participant_id AS "participantId",
        commitment_amount AS "commitmentAmount",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM investor_pool_commitments
      ORDER BY created_at, id
    `
  )).map((row) => ({
    ...row,
    commitmentAmount: Number(row.commitmentAmount)
  }));

  const investorPoolVotes = await queryAll(
    `
      SELECT
        id,
        pool_id AS "poolId",
        participant_id AS "participantId",
        deal_id AS "dealId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM investor_pool_votes
      ORDER BY updated_at DESC, id
    `
  );

  const contractors = (await queryAll(
    `
      SELECT
        contractor_participation.id AS id,
        contractor_participation.deal_id AS "dealId",
        contractor_participation.participant_id AS "participantId",
        participants.name AS "contractorName",
        contractor_participation.trade AS trade,
        contractor_participation.total_contract_value AS "totalContractValue",
        contractor_participation.cash_paid AS "cashPaid",
        contractor_participation.deferred_amount AS "deferredAmount",
        contractor_participation.contribution_type AS "contributionType",
        contractor_participation.hybrid AS hybrid,
        contractor_participation.status AS status
      FROM contractor_participation
      JOIN participants ON participants.id = contractor_participation.participant_id
      ORDER BY contractor_participation.deal_id, participants.name
    `
  )).map((row) => ({
    ...row,
    totalContractValue: Number(row.totalContractValue),
    cashPaid: Number(row.cashPaid),
    deferredAmount: Number(row.deferredAmount),
    hybrid: Boolean(row.hybrid)
  }));

  const distributionElections = (await queryAll(
    `
      SELECT
        id,
        deal_id AS "dealId",
        participant_id AS "participantId",
        election_mode AS "electionMode",
        reinvest_percent AS "reinvestPercent",
        reinvest_amount AS "reinvestAmount",
        rollover_target_deal_id AS "rolloverTargetDealId",
        notes,
        submitted_by_user_id AS "submittedByUserId",
        submitted_by_role AS "submittedByRole",
        approval_status AS "approvalStatus",
        approved_reinvest_amount AS "approvedReinvestAmount",
        approved_cash_payout_amount AS "approvedCashPayoutAmount",
        payout_expected_on AS "payoutExpectedOn",
        reviewed_by_user_id AS "reviewedByUserId",
        reviewed_at AS "reviewedAt",
        manager_override AS "managerOverride",
        override_notes AS "overrideNotes",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM distribution_elections
      ORDER BY updated_at DESC, id
    `
  )).map((row) => ({
    ...row,
    reinvestPercent:
      row.reinvestPercent === null || row.reinvestPercent === undefined
        ? null
        : Number(row.reinvestPercent),
    reinvestAmount:
      row.reinvestAmount === null || row.reinvestAmount === undefined
        ? null
        : Number(row.reinvestAmount),
    approvedReinvestAmount:
      row.approvedReinvestAmount === null || row.approvedReinvestAmount === undefined
        ? null
        : Number(row.approvedReinvestAmount),
    approvedCashPayoutAmount:
      row.approvedCashPayoutAmount === null || row.approvedCashPayoutAmount === undefined
        ? null
        : Number(row.approvedCashPayoutAmount),
    managerOverride: Boolean(row.managerOverride)
  }));

  const earlyWithdrawalRequests = (await queryAll(
    `
      SELECT
        id,
        deal_id AS "dealId",
        participant_id AS "participantId",
        position_id AS "positionId",
        class_type AS "classType",
        requested_capital_amount AS "requestedCapitalAmount",
        penalty_rate AS "penaltyRate",
        penalty_amount AS "penaltyAmount",
        approved_payout_amount AS "approvedPayoutAmount",
        investor_notes AS "investorNotes",
        manager_notes AS "managerNotes",
        request_status AS "requestStatus",
        payout_expected_on AS "payoutExpectedOn",
        requested_by_user_id AS "requestedByUserId",
        reviewed_by_user_id AS "reviewedByUserId",
        reviewed_at AS "reviewedAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM early_withdrawal_requests
      ORDER BY updated_at DESC, id
    `
  )).map((row) => ({
    ...row,
    requestedCapitalAmount: Number(row.requestedCapitalAmount),
    penaltyRate: Number(row.penaltyRate),
    penaltyAmount: Number(row.penaltyAmount),
    approvedPayoutAmount:
      row.approvedPayoutAmount === null || row.approvedPayoutAmount === undefined
        ? null
        : Number(row.approvedPayoutAmount)
  }));

  const emailNotifications = await queryAll(
    `
      SELECT
        id,
        user_id AS "userId",
        participant_id AS "participantId",
        recipient_email AS "recipientEmail",
        subject,
        body_text AS "bodyText",
        status,
        provider,
        local_path AS "localPath",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        sent_at AS "sentAt",
        read_at AS "readAt"
      FROM email_notifications
      ORDER BY created_at DESC, id DESC
    `
  );

  const companyResources = (await queryAll(
    `
      SELECT
        company_resources.id AS id,
        company_resources.title AS title,
        company_resources.deal_id AS "dealId",
        deals.name AS "dealName",
        company_resources.resource_type AS "resourceType",
        company_resources.summary_text AS "summaryText",
        company_resources.body_text AS "bodyText",
        company_resources.file_name AS "fileName",
        company_resources.file_mime_type AS "fileMimeType",
        (company_resources.file_name IS NOT NULL AND company_resources.file_data_url IS NOT NULL) AS "hasFile",
        company_resources.published_at AS "publishedAt",
        company_resources.created_at AS "createdAt",
        company_resources.updated_at AS "updatedAt"
      FROM company_resources
      LEFT JOIN deals ON deals.id = company_resources.deal_id
      ORDER BY company_resources.published_at DESC, company_resources.created_at DESC, company_resources.id DESC
    `
  )).map((row) => ({
    ...row,
    hasFile: Boolean(row.hasFile)
  }));

  const dealIssues = (await queryAll(
    `
      SELECT
        id,
        deal_id AS "dealId",
        issue_type AS "issueType",
        title,
        description,
        approval_threshold AS "approvalThreshold",
        proposed_penalty_rate AS "proposedPenaltyRate",
        closes_on AS "closesOn",
        resolution_result AS "resolutionResult",
        resolution_applied_at AS "resolutionAppliedAt",
        created_by_user_id AS "createdByUserId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM deal_issues
      ORDER BY created_at DESC, id
    `
  )).map((row) => ({
    ...row,
    approvalThreshold: Number(row.approvalThreshold),
    proposedPenaltyRate:
      row.proposedPenaltyRate === null || row.proposedPenaltyRate === undefined
        ? null
        : Number(row.proposedPenaltyRate)
  }));

  const issueVotes = await queryAll(
    `
      SELECT
        id,
        issue_id AS "issueId",
        participant_id AS "participantId",
        vote_choice AS "voteChoice",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM deal_issue_votes
      ORDER BY updated_at DESC, id
    `
  );
  const archivedRecords = await queryAll(
    `
      SELECT
        id,
        entity_type AS "entityType",
        entity_id AS "entityId",
        source_table AS "sourceTable",
        display_name AS "displayName",
        related_deal_id AS "relatedDealId",
        related_participant_id AS "relatedParticipantId",
        deleted_by_user_id AS "deletedByUserId",
        deleted_by_role AS "deletedByRole",
        deleted_by_email AS "deletedByEmail",
        deleted_by_name AS "deletedByName",
        deleted_at AS "deletedAt",
        payload_json AS "payloadJson",
        created_at AS "createdAt"
      FROM archived_records
      ORDER BY deleted_at DESC, id
    `
  );

  return {
    asOfDate: todayStamp(),
    legalDocuments: getLegalDocumentDefinitions(),
    participants,
    users,
    userLegalAcknowledgements,
    investorQuestionnaires,
    deals,
    positions,
    investorPools,
    investorPoolCommitments,
    investorPoolVotes,
    contractors,
    distributionElections,
    earlyWithdrawalRequests,
    emailNotifications,
    companyResources,
    dealIssues,
    issueVotes,
    archivedRecords
  };
}

export async function markUserNotificationsRead(userId, notificationIds = []) {
  const normalizedUserId = String(userId ?? "").trim();

  if (!normalizedUserId) {
    throw new Error("User id is required.");
  }

  const normalizedIds = Array.isArray(notificationIds)
    ? notificationIds.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const timestamp = nowTimestamp();
  const result = normalizedIds.length
    ? await pool.query(
        `
          UPDATE email_notifications
          SET read_at = COALESCE(read_at, $1)
          WHERE user_id = $2
            AND id = ANY($3::text[])
            AND read_at IS NULL
        `,
        [timestamp, normalizedUserId, normalizedIds]
      )
    : await pool.query(
        `
          UPDATE email_notifications
          SET read_at = COALESCE(read_at, $1)
          WHERE user_id = $2
            AND read_at IS NULL
        `,
        [timestamp, normalizedUserId]
      );

  return {
    updatedCount: result.rowCount ?? 0,
    readAt: timestamp
  };
}

async function createUserRecord(
  input,
  { mustChangePassword = true, sendNotification = true } = {}
) {
  const normalizedCategory = normalizeCategory(input.category);
  const profile = normalizePersonInput(input);
  validateUserProfileForCreation(profile, normalizedCategory);

  const existingUser = await queryOne(
    `
      SELECT id
      FROM users
      WHERE LOWER(email) = $1
    `,
    [profile.email]
  );

  if (existingUser) {
    throw new Error("A user with that email already exists.");
  }

  const passwordRecord = hashPassword(profile.password);
  const timestamp = nowTimestamp();
  const participantId = createId("participant");
  const userId = createId("user");
  const role = normalizedCategory === "manager" ? "manager" : "investor";
  const accountApprovalStatus = getInitialAccountApprovalStatus(
    normalizedCategory,
    input.accountApprovalStatus
  );

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO participants (
          id,
          name,
          category,
          first_name,
          middle_name,
          last_name,
          driver_license_number,
          id_card_file_name,
          id_card_mime_type,
          id_card_data_url,
          id_document_issue_date,
          id_document_expiration_date,
          current_address,
          mailing_address,
          contact_phone,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `,
      [
        participantId,
        profile.fullName,
        normalizedCategory,
        profile.firstName,
        profile.middleName || null,
        profile.lastName,
        profile.driverLicenseNumber,
        profile.idCardFile?.fileName ?? null,
        profile.idCardFile?.mimeType ?? null,
        profile.idCardFile?.dataUrl ?? null,
        input.idDocumentIssueDate ?? null,
        input.idDocumentExpirationDate ?? null,
        profile.currentAddress,
        profile.mailingAddress,
        profile.contactPhone,
        timestamp,
        timestamp
      ]
    );

    await client.query(
      `
        INSERT INTO users (
          id,
          participant_id,
          role,
          email,
          password_salt,
          password_hash,
          is_active,
          must_change_password,
          account_approval_status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        userId,
        participantId,
        role,
        profile.email,
        passwordRecord.salt,
        passwordRecord.hash,
        1,
        mustChangePassword ? 1 : 0,
        accountApprovalStatus,
        timestamp,
        timestamp
      ]
    );
  });

  const user = await getUserById(userId);
  let notification;

  if (sendNotification) {
    try {
      notification = await sendCredentialNotification({
        userId,
        participantId,
        fullName: profile.fullName,
        email: profile.email,
        role,
        temporaryPassword: profile.password
      });
    } catch (error) {
      notification = {
        status: "failed",
        provider: "notification_error",
        localPath: null,
        errorMessage: error.message
      };
    }
  } else {
    notification = null;
  }

  return {
    user,
    notification
  };
}

export async function createManagedUser(input) {
  const category = normalizeCategory(input?.category || "investor");

  return createUserRecord(
    {
      ...input,
      category,
      accountApprovalStatus: category === "manager" ? "approved" : "profile_required"
    },
    {
      mustChangePassword: true,
      sendNotification: true
    }
  );
}

function normalizeInvestorPoolInput(input) {
  const name = String(input?.name ?? "").trim();
  const minimumCapitalAmount = normalizePositiveCurrencyAmount(
    input?.minimumCapitalAmount,
    "Minimum capital"
  );
  const voteClosesOn = normalizeOptionalDateInput(input?.voteClosesOn, "Vote close date");

  if (name.length < 3) {
    throw new Error("Pool name must be at least 3 characters.");
  }

  if (!voteClosesOn) {
    throw new Error("Vote close date is required.");
  }

  return {
    name,
    minimumCapitalAmount,
    voteClosesOn
  };
}

export async function createInvestorPool(input, userId) {
  const investmentPool = normalizeInvestorPoolInput(input);
  const timestamp = nowTimestamp();
  const poolId = createId("pool");
  const poolParticipantId = createId("participant");

  const existingPool = await queryOne(
    `
      SELECT id
      FROM investor_pools
      WHERE LOWER(name) = LOWER($1)
    `,
    [investmentPool.name]
  );

  if (existingPool) {
    throw new Error("A pooled capital group with that name already exists.");
  }

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO participants (
          id,
          name,
          category,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [poolParticipantId, investmentPool.name, "pool", timestamp, timestamp]
    );

    await client.query(
      `
        INSERT INTO investor_pools (
          id,
          name,
          pool_participant_id,
          minimum_capital_amount,
          status,
          vote_closes_on,
          selected_deal_id,
          funded_on,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        poolId,
        investmentPool.name,
        poolParticipantId,
        investmentPool.minimumCapitalAmount,
        "open",
        investmentPool.voteClosesOn,
        null,
        null,
        String(userId ?? "").trim() || null,
        timestamp,
        timestamp
      ]
    );
  });

  return {
    pool: await getInvestorPoolById(poolId)
  };
}

export async function upsertInvestorPoolCommitment(poolId, input) {
  const normalizedPoolId = String(poolId ?? "").trim();
  const participantId = String(input?.participantId ?? "").trim();
  const commitmentAmount = normalizePositiveCurrencyAmount(
    input?.commitmentAmount,
    "Commitment amount"
  );

  if (!normalizedPoolId) {
    throw new Error("A valid pooled capital group is required.");
  }

  if (!participantId) {
    throw new Error("A valid pooled member is required.");
  }

  const member = await queryOne(
    `
      SELECT
        participants.id AS id,
        participants.name AS name,
        participants.category AS category,
        users.id AS "userId",
        users.is_active AS "isActive"
      FROM participants
      LEFT JOIN users ON users.participant_id = participants.id
      WHERE participants.id = $1
    `,
    [participantId]
  );

  if (!member || member.category !== "pool_member") {
    throw new Error("Only pooled-member users can be added to a pooled capital group.");
  }

  if (!member.userId || !Boolean(member.isActive)) {
    throw new Error("This pooled member must have an active portal login before being added.");
  }

  const investmentPool = await getInvestorPoolById(normalizedPoolId);

  if (!investmentPool) {
    throw new Error("Pooled capital group not found.");
  }

  if (normalizePoolStatus(investmentPool.status) === "funded" || investmentPool.selectedDealId) {
    throw new Error("This pooled capital group has already been funded and can no longer change.");
  }

  const timestamp = nowTimestamp();
  let action = "created";

  await withTransaction(async (client) => {
    const existingCommitment = await queryOne(
      `
        SELECT id
        FROM investor_pool_commitments
        WHERE pool_id = $1
          AND participant_id = $2
      `,
      [normalizedPoolId, participantId],
      client
    );

    if (existingCommitment) {
      action = "updated";
      await client.query(
        `
          UPDATE investor_pool_commitments
          SET commitment_amount = $1, updated_at = $2
          WHERE id = $3
        `,
        [commitmentAmount, timestamp, existingCommitment.id]
      );
    } else {
      await client.query(
        `
          INSERT INTO investor_pool_commitments (
            id,
            pool_id,
            participant_id,
            commitment_amount,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [createId("pool-commitment"), normalizedPoolId, participantId, commitmentAmount, timestamp, timestamp]
      );
    }

    await syncInvestorPoolStatus(normalizedPoolId, client);
  });

  const updatedPool = await getInvestorPoolById(normalizedPoolId);
  const updatedCommitments = await getInvestorPoolCommitments(normalizedPoolId);
  const totalCommitted = roundNumber(
    updatedCommitments.reduce((sum, commitment) => sum + commitment.commitmentAmount, 0)
  );
  let notification = null;
  const recipient = await getActiveUserRecipientForParticipant(participantId);

  if (recipient?.email) {
    try {
      notification = await sendPoolCommitmentNotification({
        userId: recipient.userId,
        participantId: recipient.participantId,
        fullName: recipient.fullName,
        email: recipient.email,
        poolName: updatedPool?.name ?? investmentPool.name,
        commitmentAmount,
        totalCommitted,
        poolStatus: updatedPool?.status ?? "open",
        action
      });
    } catch (error) {
      notification = {
        status: "failed",
        provider: "notification_error",
        localPath: null,
        errorMessage: error.message
      };
    }
  }

  return {
    action,
    poolId: normalizedPoolId,
    participantId,
    participantName: member.name,
    commitmentAmount,
    totalCommitted,
    poolStatus: updatedPool?.status ?? "open",
    notification
  };
}

export async function castInvestorPoolVote(poolId, userId, dealId) {
  const normalizedPoolId = String(poolId ?? "").trim();
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedDealId = String(dealId ?? "").trim();

  if (!normalizedPoolId) {
    throw new Error("A valid pooled capital group is required.");
  }

  if (!normalizedDealId) {
    throw new Error("Select a project before voting.");
  }

  const user = await getUserAccountById(normalizedUserId);

  if (!user || user.category !== "pool_member") {
    throw new Error("Only pooled-member users can vote on pooled capital placements.");
  }

  const investmentPool = await getInvestorPoolById(normalizedPoolId);

  if (!investmentPool) {
    throw new Error("Pooled capital group not found.");
  }

  if (investmentPool.status !== "voting" || investmentPool.selectedDealId) {
    throw new Error("This pooled capital group is not currently open for voting.");
  }

  if (isPoolVotingClosed(investmentPool.voteClosesOn)) {
    throw new Error("Voting for this pooled capital group has already closed.");
  }

  const memberCommitment = await queryOne(
    `
      SELECT commitment_amount AS "commitmentAmount"
      FROM investor_pool_commitments
      WHERE pool_id = $1
        AND participant_id = $2
    `,
    [normalizedPoolId, user.participantId]
  );

  if (!memberCommitment || Number(memberCommitment.commitmentAmount) <= 0) {
    throw new Error("You must be an assigned member of this pooled capital group before voting.");
  }

  const targetDeal = await getEligiblePoolTargetDeal(normalizedDealId);

  const timestamp = nowTimestamp();
  let action = "created";

  await withTransaction(async (client) => {
    const existingVote = await queryOne(
      `
        SELECT id
        FROM investor_pool_votes
        WHERE pool_id = $1
          AND participant_id = $2
      `,
      [normalizedPoolId, user.participantId],
      client
    );

    if (existingVote) {
      action = "updated";
      await client.query(
        `
          UPDATE investor_pool_votes
          SET deal_id = $1, updated_at = $2
          WHERE id = $3
        `,
        [normalizedDealId, timestamp, existingVote.id]
      );
    } else {
      await client.query(
        `
          INSERT INTO investor_pool_votes (
            id,
            pool_id,
            participant_id,
            deal_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [createId("pool-vote"), normalizedPoolId, user.participantId, normalizedDealId, timestamp, timestamp]
      );
    }
  });

  const commitments = await getInvestorPoolCommitments(normalizedPoolId);
  const voteCountRow = await queryOne(
    `
      SELECT COUNT(*)::int AS count
      FROM investor_pool_votes
      WHERE pool_id = $1
    `,
    [normalizedPoolId]
  );
  const voteCount = Number(voteCountRow?.count ?? 0);
  const totalCommitted = roundNumber(
    commitments.reduce((sum, commitment) => sum + commitment.commitmentAmount, 0)
  );
  const readyToFund =
    investmentPool.status === "voting" &&
    totalCommitted >= Number(investmentPool.minimumCapitalAmount ?? 0) &&
    (isPoolVotingClosed(investmentPool.voteClosesOn) || voteCount >= commitments.length);
  const managerRecipients = await getActiveManagerRecipients();
  const notifications = await Promise.all(
    managerRecipients.map(async (managerRecipient) => {
      try {
        return await sendPoolVoteAlertNotification({
          userId: managerRecipient.userId,
          participantId: managerRecipient.participantId,
          managerName: managerRecipient.fullName,
          email: managerRecipient.email,
          voterName: user.name,
          voterEmail: user.email,
          poolName: investmentPool.name,
          dealName: targetDeal.name,
          voteCount,
          memberCount: commitments.length,
          totalCommitted,
          readyToFund,
          submittedAt: timestamp
        });
      } catch (error) {
        return {
          status: "failed",
          provider: "notification_error",
          localPath: null,
          errorMessage: error.message
        };
      }
    })
  );

  return {
    vote: {
      poolId: normalizedPoolId,
      participantId: user.participantId,
      dealId: normalizedDealId,
      action,
      readyToFund,
      notifications
    }
  };
}

export async function fundInvestorPool(poolId, userId, input = {}) {
  const normalizedPoolId = String(poolId ?? "").trim();
  const requestedDealId = normalizeOptionalText(input?.dealId);

  if (!normalizedPoolId) {
    throw new Error("A valid pooled capital group is required.");
  }

  const timestamp = nowTimestamp();
  let fundedPoolSummary = null;

  await withTransaction(async (client) => {
    const investmentPool = await getInvestorPoolById(normalizedPoolId, client);

    if (!investmentPool) {
      throw new Error("Pooled capital group not found.");
    }

    if (investmentPool.status === "funded" || investmentPool.selectedDealId) {
      throw new Error("This pooled capital group has already been funded.");
    }

    const commitments = await getInvestorPoolCommitments(normalizedPoolId, client);

    if (!commitments.length) {
      throw new Error("Add pooled-member commitments before funding this group.");
    }

    const totalCommitted = roundNumber(
      commitments.reduce((sum, commitment) => sum + commitment.commitmentAmount, 0)
    );

    if (totalCommitted < investmentPool.minimumCapitalAmount) {
      throw new Error(
        `This pooled capital group has only raised ${totalCommitted.toFixed(
          2
        )} and cannot be funded until it reaches the minimum capital target.`
      );
    }

    const voteRows = await queryAll(
      `
        SELECT COUNT(*)::int AS count
        FROM investor_pool_votes
        WHERE pool_id = $1
      `,
      [normalizedPoolId],
      client
    );
    const totalVotes = Number(voteRows[0]?.count ?? 0);

    if (!isPoolVotingClosed(investmentPool.voteClosesOn) && totalVotes < commitments.length) {
      throw new Error(
        "Funding is only allowed after the vote closes or after every pooled member has voted."
      );
    }

    const voteSummary = await getInvestorPoolVoteSummary(normalizedPoolId, client);

    if (!voteSummary.length) {
      throw new Error("This pooled capital group does not yet have any recorded project votes.");
    }

    const topWeight = voteSummary[0].voteWeightAmount;
    const leaders = voteSummary.filter((row) => row.voteWeightAmount === topWeight);

    if (leaders.length !== 1) {
      throw new Error("This pooled capital group is tied across multiple projects and cannot be funded yet.");
    }

    const winningDealId = leaders[0].dealId;

    if (requestedDealId && requestedDealId !== winningDealId) {
      throw new Error("The selected project does not match the current weighted vote winner.");
    }

    const targetDeal = await getEligiblePoolTargetDeal(requestedDealId ?? winningDealId, client);
    const existingPoolPosition = await queryOne(
      `
        SELECT id
        FROM positions
        WHERE participant_id = $1
      `,
      [investmentPool.poolParticipantId],
      client
    );

    if (existingPoolPosition) {
      throw new Error("This pooled capital group already has a linked deal position.");
    }

    const positionId = createId("position");
    await client.query(
      `
        INSERT INTO positions (
          id,
          deal_id,
          participant_id,
          class_type,
          contribution_type,
          contribution_amount,
          distributions_to_date,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        positionId,
        targetDeal.id,
        investmentPool.poolParticipantId,
        "Class A",
        "Pooled member capital",
        totalCommitted,
        0,
        timestamp,
        timestamp
      ]
    );

    await client.query(
      `
        UPDATE investor_pools
        SET
          selected_deal_id = $1,
          funded_on = $2,
          status = $3,
          updated_at = $4
        WHERE id = $5
      `,
      [targetDeal.id, timestamp, "funded", timestamp, normalizedPoolId]
    );

    await syncDealEquity(targetDeal.id, client);

    fundedPoolSummary = {
      poolId: normalizedPoolId,
      dealId: targetDeal.id,
      dealName: targetDeal.name,
      totalCommitted,
      fundedByUserId: String(userId ?? "").trim() || null
    };
  });

  return {
    pool: fundedPoolSummary
  };
}

export async function ensureInitialManagerUser() {
  await assertDatabaseReady();

  const existingManager = await queryOne(
    `
      SELECT id
      FROM users
      WHERE role = 'manager'
        AND is_active = 1
      LIMIT 1
    `
  );

  if (existingManager) {
    return {
      created: false,
      user: await getUserById(existingManager.id),
      notification: null
    };
  }

  const email = normalizeConfigValue(process.env.DEFAULT_MANAGER_EMAIL);
  const password = normalizeConfigValue(process.env.DEFAULT_MANAGER_PASSWORD);
  const firstName = normalizeConfigValue(process.env.DEFAULT_MANAGER_FIRST_NAME);
  const lastName = normalizeConfigValue(process.env.DEFAULT_MANAGER_LAST_NAME);
  const middleName = normalizeConfigValue(process.env.DEFAULT_MANAGER_MIDDLE_NAME);
  const contactPhone = normalizeConfigValue(process.env.DEFAULT_MANAGER_PHONE);
  const address = normalizeConfigValue(process.env.DEFAULT_MANAGER_ADDRESS);
  const missing = [];

  if (!email) {
    missing.push("DEFAULT_MANAGER_EMAIL");
  }

  if (!password) {
    missing.push("DEFAULT_MANAGER_PASSWORD");
  }

  if (!firstName) {
    missing.push("DEFAULT_MANAGER_FIRST_NAME");
  }

  if (!lastName) {
    missing.push("DEFAULT_MANAGER_LAST_NAME");
  }

  if (missing.length) {
    throw new Error(
      `No active manager account exists. Set ${missing.join(", ")} in .env so the initial manager can be created.`
    );
  }

  const createdUser = await createUserRecord(
    {
      category: "manager",
      firstName,
      middleName,
      lastName,
      email,
      password,
      contactPhone,
      currentAddress: address,
      mailingAddress: address
    },
    {
      mustChangePassword: false,
      sendNotification: true
    }
  );

  return {
    created: true,
    ...createdUser
  };
}

export async function markUserLogin(userId) {
  await pool.query(
    `
      UPDATE users
      SET last_login_at = $1
      WHERE id = $2
    `,
    [nowTimestamp(), userId]
  );
}

export async function submitIdentityReview(userId, input) {
  const currentUser = await getUserById(userId);

  if (!currentUser) {
    throw new Error("User not found.");
  }

  if (currentUser.role === "manager") {
    throw new Error("Manager accounts do not require identity review.");
  }

  if (currentUser.mustChangePassword) {
    throw new Error("Change your temporary password before submitting identity information.");
  }

  if (currentUser.accountApprovalStatus === "pending_review") {
    throw new Error("Your identity information is already waiting for manager review.");
  }

  if (currentUser.accountApprovalStatus === "approved") {
    throw new Error("This account has already been approved.");
  }

  const identity = normalizeIdentityReviewInput(input, {
    hasExistingIdCard: Boolean(currentUser.idCardFileName)
  });
  const legalAcknowledgements = normalizeLegalAcknowledgementInput(input, currentUser);
  const investorQuestionnaire = normalizeInvestorQuestionnaireInput(input, currentUser, identity);
  const timestamp = nowTimestamp();

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE participants
        SET
          driver_license_number = $1,
          id_card_file_name = COALESCE($2, id_card_file_name),
          id_card_mime_type = COALESCE($3, id_card_mime_type),
          id_card_data_url = COALESCE($4, id_card_data_url),
          id_document_issue_date = $5,
          id_document_expiration_date = $6,
          current_address = $7,
          mailing_address = $8,
          contact_phone = $9,
          updated_at = $10
        WHERE id = $11
      `,
      [
        identity.driverLicenseNumber,
        identity.idCardFile?.fileName ?? null,
        identity.idCardFile?.mimeType ?? null,
        identity.idCardFile?.dataUrl ?? null,
        identity.idDocumentIssueDate,
        identity.idDocumentExpirationDate,
        identity.currentAddress,
        identity.mailingAddress,
        identity.contactPhone,
        timestamp,
        currentUser.participantId
      ]
    );

    await client.query(
      `
        DELETE FROM user_legal_acknowledgements
        WHERE user_id = $1
      `,
      [userId]
    );

    for (const acknowledgement of legalAcknowledgements) {
      await client.query(
        `
          INSERT INTO user_legal_acknowledgements (
            id,
            user_id,
            participant_id,
            document_key,
            document_title,
            document_version,
            document_file_name,
            required_for_category,
            signer_name,
            investment_amount,
            deferred_amount,
            proof_of_payment_file_name,
            proof_of_payment_mime_type,
            proof_of_payment_data_url,
            acknowledged_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $15)
        `,
        [
          createId("legal-ack"),
          userId,
          currentUser.participantId,
          acknowledgement.documentKey,
          acknowledgement.documentTitle,
          acknowledgement.documentVersion,
          acknowledgement.documentFileName,
          acknowledgement.requiredForCategory,
          acknowledgement.signerName,
          acknowledgement.investmentAmount,
          acknowledgement.deferredAmount,
          acknowledgement.proofOfPaymentFile?.fileName ?? null,
          acknowledgement.proofOfPaymentFile?.mimeType ?? null,
          acknowledgement.proofOfPaymentFile?.dataUrl ?? null,
          timestamp
        ]
      );
    }

    if (investorQuestionnaire) {
      await client.query(
        `
          INSERT INTO investor_questionnaires (
            id,
            user_id,
            participant_id,
            name_entity,
            address,
            email,
            phone,
            income_over_200k,
            net_worth_over_100k,
            entity_over_5m_assets,
            investment_experience,
            submitted_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $12)
          ON CONFLICT (user_id)
          DO UPDATE SET
            participant_id = EXCLUDED.participant_id,
            name_entity = EXCLUDED.name_entity,
            address = EXCLUDED.address,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            income_over_200k = EXCLUDED.income_over_200k,
            net_worth_over_100k = EXCLUDED.net_worth_over_100k,
            entity_over_5m_assets = EXCLUDED.entity_over_5m_assets,
            investment_experience = EXCLUDED.investment_experience,
            submitted_at = EXCLUDED.submitted_at,
            updated_at = EXCLUDED.updated_at
        `,
        [
          createId("questionnaire"),
          userId,
          currentUser.participantId,
          investorQuestionnaire.nameEntity,
          investorQuestionnaire.address,
          investorQuestionnaire.email,
          investorQuestionnaire.phone,
          investorQuestionnaire.incomeOver200k ? 1 : 0,
          investorQuestionnaire.netWorthOver100k ? 1 : 0,
          investorQuestionnaire.entityOver5mAssets ? 1 : 0,
          investorQuestionnaire.investmentExperience,
          timestamp
        ]
      );
    }

    await client.query(
      `
        UPDATE users
        SET
          account_approval_status = 'pending_review',
          account_rejection_comment = NULL,
          account_reviewed_by_user_id = NULL,
          account_reviewed_at = NULL,
          onboarding_submitted_at = $1,
          updated_at = $1
        WHERE id = $2
      `,
      [timestamp, userId]
    );
  });

  const updatedUser = await getUserById(userId);
  const managerRecipients = await getActiveManagerRecipients();

  await Promise.all(
    managerRecipients.map(async (managerRecipient) => {
      try {
        return await sendIdentityReviewAlertNotification({
          userId: managerRecipient.userId,
          participantId: managerRecipient.participantId,
          managerName: managerRecipient.fullName,
          email: managerRecipient.email,
          investorName: updatedUser.name,
          investorEmail: updatedUser.email,
          category: updatedUser.category,
          submittedAt: timestamp
        });
      } catch {
        return null;
      }
    })
  );

  return updatedUser;
}

export async function submitRequiredLegalAcknowledgements(userId, input) {
  const currentUser = await getUserById(userId);

  if (!currentUser) {
    throw new Error("User not found.");
  }

  if (currentUser.role === "manager") {
    throw new Error("Manager accounts do not require legal document acknowledgements.");
  }

  if (currentUser.mustChangePassword) {
    throw new Error("Change your temporary password before signing legal documents.");
  }

  if (currentUser.accountApprovalStatus !== "approved") {
    throw new Error("Account approval is required before signing amended legal documents.");
  }

  const pendingDocuments = await getPendingLegalAcknowledgementDocuments(
    currentUser.id,
    currentUser.category
  );
  const legalAcknowledgements = normalizeRequiredLegalAcknowledgementInput(
    input,
    currentUser,
    pendingDocuments
  );

  if (!legalAcknowledgements.length) {
    return currentUser;
  }

  const timestamp = nowTimestamp();

  await withTransaction(async (client) => {
    for (const acknowledgement of legalAcknowledgements) {
      await client.query(
        `
          INSERT INTO user_legal_acknowledgements (
            id,
            user_id,
            participant_id,
            document_key,
            document_title,
            document_version,
            document_file_name,
            required_for_category,
            signer_name,
            investment_amount,
            deferred_amount,
            proof_of_payment_file_name,
            proof_of_payment_mime_type,
            proof_of_payment_data_url,
            acknowledged_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL, NULL, NULL, NULL, $10, $10, $10)
          ON CONFLICT (user_id, document_key, document_version)
          DO UPDATE SET
            document_title = EXCLUDED.document_title,
            document_file_name = EXCLUDED.document_file_name,
            required_for_category = EXCLUDED.required_for_category,
            signer_name = EXCLUDED.signer_name,
            acknowledged_at = EXCLUDED.acknowledged_at,
            updated_at = EXCLUDED.updated_at
        `,
        [
          createId("legal-ack"),
          currentUser.id,
          currentUser.participantId,
          acknowledgement.documentKey,
          acknowledgement.documentTitle,
          acknowledgement.documentVersion,
          acknowledgement.documentFileName,
          acknowledgement.requiredForCategory,
          acknowledgement.signerName,
          timestamp
        ]
      );
    }
  });

  return getUserById(userId);
}

export async function updateOwnProfile(userId, input) {
  const currentUser = await getUserById(userId);

  if (!currentUser) {
    throw new Error("User not found.");
  }

  const profile = normalizePersonInput(input);
  const isManager = currentUser.role === "manager";
  const payoutMethod = isManager ? null : profile.payoutMethod;

  if (profile.firstName.length < 2) {
    throw new Error("First name must be at least 2 characters.");
  }

  if (profile.lastName.length < 2) {
    throw new Error("Last name must be at least 2 characters.");
  }

  if (!profile.email.includes("@")) {
    throw new Error("A valid email is required.");
  }

  if (payoutMethod && !["bank", "zelle", "cash_app", "other"].includes(payoutMethod)) {
    throw new Error("Preferred payout method is invalid.");
  }

  const existingUser = await queryOne(
    `
      SELECT id
      FROM users
      WHERE LOWER(email) = $1
        AND id <> $2
    `,
    [profile.email, userId]
  );

  if (existingUser) {
    throw new Error("That email address is already in use.");
  }

  const timestamp = nowTimestamp();

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE participants
        SET
          name = $1,
          first_name = $2,
          middle_name = $3,
          last_name = $4,
          current_address = $5,
          mailing_address = $6,
          contact_phone = $7,
          payout_method = $8,
          bank_account_name = $9,
          bank_name = $10,
          bank_routing_number = $11,
          bank_account_number = $12,
          zelle_details = $13,
          cash_app_handle = $14,
          payout_notes = $15,
          updated_at = $16
        WHERE id = $17
      `,
      [
        profile.fullName,
        profile.firstName,
        profile.middleName || null,
        profile.lastName,
        profile.currentAddress,
        profile.mailingAddress,
        profile.contactPhone,
        payoutMethod,
        isManager ? null : profile.bankAccountName,
        isManager ? null : profile.bankName,
        isManager ? null : profile.bankRoutingNumber,
        isManager ? null : profile.bankAccountNumber,
        isManager ? null : profile.zelleDetails,
        isManager ? null : profile.cashAppHandle,
        isManager ? null : profile.payoutNotes,
        timestamp,
        currentUser.participantId
      ]
    );

    await client.query(
      `
        UPDATE users
        SET email = $1, updated_at = $2
        WHERE id = $3
      `,
      [profile.email, timestamp, userId]
    );
  });

  return getUserById(userId);
}

export async function updateUserPassword(userId, newPassword) {
  const normalizedPassword = String(newPassword ?? "");

  if (normalizedPassword.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  const passwordRecord = hashPassword(normalizedPassword);

  await pool.query(
    `
      UPDATE users
      SET
        password_salt = $1,
        password_hash = $2,
        must_change_password = 0,
        updated_at = $3
      WHERE id = $4
    `,
    [passwordRecord.salt, passwordRecord.hash, nowTimestamp(), userId]
  );

  return getUserById(userId);
}

export async function requestPasswordReset(email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail.includes("@")) {
    throw new Error("A valid email is required.");
  }

  const user = await getUserByEmail(normalizedEmail);

  if (!user) {
    return {
      requested: true,
      notification: null
    };
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);
  const tokenId = createId("reset");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE password_reset_tokens
        SET used_at = $1
        WHERE user_id = $2
          AND used_at IS NULL
      `,
      [createdAt.toISOString(), user.id]
    );

    await client.query(
      `
        INSERT INTO password_reset_tokens (
          id,
          user_id,
          token_hash,
          expires_at,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [tokenId, user.id, tokenHash, expiresAt.toISOString(), createdAt.toISOString()]
    );
  });

  const notification = await sendPasswordResetNotification({
    userId: user.id,
    participantId: user.participantId,
    fullName: user.name,
    email: user.email,
    resetUrl: buildPasswordResetUrl(rawToken),
    expiresInMinutes: PASSWORD_RESET_TTL_MINUTES
  });

  return {
    requested: true,
    notification
  };
}

export async function resetPasswordWithToken(token, newPassword) {
  const normalizedToken = String(token ?? "").trim();
  const normalizedPassword = String(newPassword ?? "");

  if (!normalizedToken) {
    throw new Error("A valid password reset token is required.");
  }

  if (normalizedPassword.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  const tokenHash = hashResetToken(normalizedToken);
  const resetRecord = await queryOne(
    `
      SELECT
        password_reset_tokens.id AS id,
        password_reset_tokens.user_id AS "userId",
        users.is_active AS "isActive"
      FROM password_reset_tokens
      JOIN users ON users.id = password_reset_tokens.user_id
      WHERE password_reset_tokens.token_hash = $1
        AND password_reset_tokens.used_at IS NULL
        AND password_reset_tokens.expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash]
  );

  if (!resetRecord || !Boolean(resetRecord.isActive)) {
    throw new Error("This password reset link is invalid or has expired.");
  }

  const passwordRecord = hashPassword(normalizedPassword);
  const usedAt = nowTimestamp();

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE users
        SET
          password_salt = $1,
          password_hash = $2,
          must_change_password = 0,
          updated_at = $3
        WHERE id = $4
      `,
      [passwordRecord.salt, passwordRecord.hash, usedAt, resetRecord.userId]
    );

    await client.query(
      `
        UPDATE password_reset_tokens
        SET used_at = $1
        WHERE user_id = $2
          AND used_at IS NULL
      `,
      [usedAt, resetRecord.userId]
    );
  });

  return {
    ok: true
  };
}

export async function createDealAllocation(input) {
  const dealId = String(input.dealId ?? "").trim();
  const participantId = String(input.participantId ?? "").trim();
  const classType = String(input.classType ?? "").trim() || "Class A";
  const contributionType = String(input.contributionType ?? "").trim();
  const contributionAmount = Number(input.contributionAmount);
  const trade = String(input.trade ?? "").trim();
  const totalContractValue = Number(input.totalContractValue ?? 0);
  const cashPaid = Number(input.cashPaid ?? 0);
  const contractorStatus = String(input.contractorStatus ?? "Active").trim() || "Active";

  if (!dealId) {
    throw new Error("Deal selection is required.");
  }

  if (!participantId) {
    throw new Error("Participant selection is required.");
  }

  if (!["Class A", "Class B", "Class C"].includes(classType)) {
    throw new Error("Class type is invalid.");
  }

  if (!Number.isFinite(contributionAmount) || contributionAmount <= 0) {
    throw new Error("Contribution amount must be greater than zero.");
  }

  const deal = await queryOne(
    `
      SELECT id, name, status, investment_close_on AS "investmentCloseOn"
      FROM deals
      WHERE id = $1
    `,
    [dealId]
  );

  if (!deal) {
    throw new Error("Deal not found.");
  }

  if (deal.status === "sold") {
    throw new Error("Sold projects are closed and cannot accept new allocations.");
  }

  if (isInvestmentWindowClosed(deal.investmentCloseOn)) {
    throw new Error(
      `Investments for ${deal.name} closed on ${deal.investmentCloseOn}. You can no longer add allocations to this project.`
    );
  }

  const participant = await queryOne(
    `
      SELECT id, name, category
      FROM participants
      WHERE id = $1
    `,
    [participantId]
  );

  if (!participant) {
    throw new Error("Participant not found.");
  }

  if (!["investor", "contractor"].includes(participant.category)) {
    throw new Error("Only investor and contractor participants can be allocated to deals.");
  }

  const existingPosition = await queryOne(
    `
      SELECT
        id,
        class_type AS "classType",
        contribution_type AS "contributionType",
        contribution_amount AS "contributionAmount"
      FROM positions
      WHERE deal_id = $1
        AND participant_id = $2
    `,
    [dealId, participantId]
  );

  if (participant.category === "contractor" && classType !== "Class C") {
    throw new Error("Contractor participants must be assigned as Class C.");
  }

  if (participant.category === "contractor") {
    if (!trade) {
      throw new Error("Trade is required for contractor participants.");
    }

    if (!Number.isFinite(totalContractValue) || totalContractValue <= 0) {
      throw new Error("Total contract value must be greater than zero for contractors.");
    }

    if (!Number.isFinite(cashPaid) || cashPaid < 0) {
      throw new Error("Cash paid must be zero or greater.");
    }

    if (cashPaid + contributionAmount > totalContractValue) {
      throw new Error("Cash paid plus deferred amount cannot exceed the total contract value.");
    }

    if (!["Active", "Completed", "Paid"].includes(contractorStatus)) {
      throw new Error("Contractor status is invalid.");
    }
  }

  const timestamp = nowTimestamp();
  const positionId = createId("position");

  await withTransaction(async (client) => {
    if (existingPosition) {
      if (existingPosition.classType !== classType) {
        throw new Error(
          `This participant already has a ${existingPosition.classType} position in ${deal.name}. Use the same class type to increase the position.`
        );
      }

      await client.query(
        `
          UPDATE positions
          SET
            contribution_type = $1,
            contribution_amount = $2,
            updated_at = $3
          WHERE id = $4
        `,
        [
          contributionType || existingPosition.contributionType,
          roundNumber(Number(existingPosition.contributionAmount ?? 0) + contributionAmount),
          timestamp,
          existingPosition.id
        ]
      );

      if (participant.category === "contractor") {
        const existingContractor = await queryOne(
          `
            SELECT
              id,
              trade,
              total_contract_value AS "totalContractValue",
              cash_paid AS "cashPaid",
              deferred_amount AS "deferredAmount",
              contribution_type AS "contributionType",
              status
            FROM contractor_participation
            WHERE deal_id = $1
              AND participant_id = $2
          `,
          [dealId, participantId],
          client
        );

        const updatedTotalContractValue = roundNumber(
          Number(existingContractor?.totalContractValue ?? 0) + totalContractValue
        );
        const updatedCashPaid = roundNumber(Number(existingContractor?.cashPaid ?? 0) + cashPaid);
        const updatedDeferredAmount = roundNumber(
          Number(existingContractor?.deferredAmount ?? 0) + contributionAmount
        );

        if (updatedCashPaid + updatedDeferredAmount > updatedTotalContractValue) {
          throw new Error("Cash paid plus deferred amount cannot exceed the total contract value.");
        }

        if (existingContractor) {
          await client.query(
            `
              UPDATE contractor_participation
              SET
                trade = $1,
                total_contract_value = $2,
                cash_paid = $3,
                deferred_amount = $4,
                contribution_type = $5,
                hybrid = $6,
                status = $7,
                updated_at = $8
              WHERE id = $9
            `,
            [
              trade || existingContractor.trade,
              updatedTotalContractValue,
              updatedCashPaid,
              updatedDeferredAmount,
              contributionType || existingContractor.contributionType,
              updatedCashPaid > 0 && updatedCashPaid < updatedTotalContractValue ? 1 : 0,
              contractorStatus || existingContractor.status,
              timestamp,
              existingContractor.id
            ]
          );
        }
      }
    } else {
      await client.query(
        `
          INSERT INTO positions (
            id,
            deal_id,
            participant_id,
            class_type,
            contribution_type,
            contribution_amount,
            distributions_to_date,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          positionId,
          dealId,
          participantId,
          classType,
          contributionType ||
            (participant.category === "contractor" ? "Deferred compensation" : "Cash equity"),
          roundNumber(contributionAmount),
          0,
          timestamp,
          timestamp
        ]
      );

      if (participant.category === "contractor") {
        await client.query(
          `
            INSERT INTO contractor_participation (
              id,
              deal_id,
              participant_id,
              trade,
              total_contract_value,
              cash_paid,
              deferred_amount,
              contribution_type,
              hybrid,
              status,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `,
          [
            createId("contractor"),
            dealId,
            participantId,
            trade,
            roundNumber(totalContractValue),
            roundNumber(cashPaid),
            roundNumber(contributionAmount),
            "Class C",
            cashPaid > 0 && cashPaid < totalContractValue ? 1 : 0,
            contractorStatus,
            timestamp,
            timestamp
          ]
        );
      }
    }

    await syncDealEquity(dealId, client);
  });

  let notification = null;
  const allocationAction = existingPosition ? "increased" : "created";
  const recipient = await getActiveUserRecipientForParticipant(participantId);

  if (recipient?.email) {
    try {
      notification = await sendProjectAllocationNotification({
        userId: recipient.userId,
        participantId: recipient.participantId,
        fullName: recipient.fullName,
        email: recipient.email,
        dealName: deal.name,
        participantCategory: participant.category,
        classType,
        contributionAmount,
        action: allocationAction
      });
    } catch (error) {
      notification = {
        status: "failed",
        provider: "notification_error",
        localPath: null,
        errorMessage: error.message
      };
    }
  }

  return {
    action: allocationAction,
    dealId,
    dealName: deal.name,
    participantId,
    participantName: participant.name,
    positionId: existingPosition?.id ?? positionId,
    notification
  };
}

async function applyApprovedReinvestmentAllocation({
  client,
  targetDealId,
  participantId,
  classType,
  amount
}) {
  const normalizedAmount = roundNumber(Number(amount ?? 0));

  if (!targetDealId || !participantId || normalizedAmount <= 0) {
    return null;
  }

  const timestamp = nowTimestamp();
  const existingPosition = await queryOne(
    `
      SELECT id, contribution_amount AS "contributionAmount"
      FROM positions
      WHERE deal_id = $1
        AND participant_id = $2
    `,
    [targetDealId, participantId],
    client
  );

  if (existingPosition) {
    await client.query(
      `
        UPDATE positions
        SET
          contribution_amount = $1,
          updated_at = $2
        WHERE id = $3
      `,
      [
        roundNumber(Number(existingPosition.contributionAmount ?? 0) + normalizedAmount),
        timestamp,
        existingPosition.id
      ]
    );

    await syncDealEquity(targetDealId, client);

    return existingPosition.id;
  }

  const positionId = createId("position");

  await client.query(
    `
      INSERT INTO positions (
        id,
        deal_id,
        participant_id,
        class_type,
        contribution_type,
        contribution_amount,
        distributions_to_date,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      positionId,
      targetDealId,
      participantId,
      classType,
      "Reinvested proceeds",
      normalizedAmount,
      0,
      timestamp,
      timestamp
    ]
  );

  await syncDealEquity(targetDealId, client);

  return positionId;
}

function normalizeDealInput(input) {
  const name = String(input.name ?? "").trim();
  const location = String(input.location ?? "").trim();
  const currentPhase = String(input.currentPhase ?? "").trim();
  const status = String(input.status ?? "").trim();
  const fundedOn = normalizeOptionalDateInput(input.fundedOn, "Funded on");
  const investmentCloseOn = normalizeOptionalDateInput(
    input.investmentCloseOn,
    "Investment close date"
  );
  const projectedExitOn = normalizeOptionalDateInput(input.projectedExitOn, "Projected exit");
  const actualExitOn = normalizeOptionalDateInput(input.actualExitOn, "Actual exit");
  const debt = Number(input.debt);
  const taxExpense = Number(input.taxExpense ?? 0);
  const debtInterestRate = Number(input.debtInterestRate ?? 0);
  const expenseEntries = normalizeDealExpenseEntries(input.expenseEntries);
  const debtServiceEntries = normalizeDealDebtServiceEntries(input.debtServiceEntries);
  const totalInterestPaid =
    debtServiceEntries === null
      ? Number(input.totalInterestPaid ?? 0)
      : sumDebtServiceInterest(debtServiceEntries);
  const earlyWithdrawalPenaltyRate = Number(
    input.earlyWithdrawalPenaltyRate ?? DEFAULT_EARLY_WITHDRAWAL_PENALTY_RATE
  );
  const budgetedProjectCost = Number(input.budgetedProjectCost ?? input.totalProjectCost);
  const actualProjectCost =
    expenseEntries === null
      ? (() => {
          const actualProjectCostRaw = normalizeOptionalText(
            input.actualProjectCost ?? input.actual_project_cost
          );
          return actualProjectCostRaw === null ? null : Number(actualProjectCostRaw);
        })()
      : sumDealExpenses(expenseEntries);
  const salePrice = Number(input.salePrice);
  const holdMonths = Number(input.holdMonths);
  const prefRate = Number(input.prefRate);
  const timelineProgress = Number(input.timelineProgress);

  if (!name || !location || !currentPhase || !fundedOn || !investmentCloseOn) {
    throw new Error("Name, location, phase, funded date, and investment close date are required.");
  }

  if (!["under_construction", "listed", "sold"].includes(status)) {
    throw new Error("Deal status is invalid.");
  }

  if (!Number.isFinite(debt) || debt < 0) {
    throw new Error("Debt must be zero or greater.");
  }

  if (!Number.isFinite(taxExpense) || taxExpense < 0) {
    throw new Error("Tax expense must be zero or greater.");
  }

  if (!Number.isFinite(debtInterestRate) || debtInterestRate < 0 || debtInterestRate > 1) {
    throw new Error("Debt interest rate must be between 0 and 1.");
  }

  if (!Number.isFinite(totalInterestPaid) || totalInterestPaid < 0) {
    throw new Error("Total interest paid must be zero or greater.");
  }

  if (
    !Number.isFinite(earlyWithdrawalPenaltyRate) ||
    earlyWithdrawalPenaltyRate < 0 ||
    earlyWithdrawalPenaltyRate > 1
  ) {
    throw new Error("Early withdrawal penalty rate must be between 0 and 1.");
  }

  if (!Number.isFinite(budgetedProjectCost) || budgetedProjectCost < 0) {
    throw new Error("Budgeted project cost must be zero or greater.");
  }

  if (
    actualProjectCost !== null &&
    (!Number.isFinite(actualProjectCost) || actualProjectCost < 0)
  ) {
    throw new Error("Actual project cost must be zero or greater.");
  }

  if (!Number.isFinite(salePrice) || salePrice < 0) {
    throw new Error("Sale price must be zero or greater.");
  }

  if (!Number.isFinite(holdMonths) || holdMonths <= 0) {
    throw new Error("Hold months must be greater than zero.");
  }

  if (!Number.isFinite(prefRate) || prefRate < 0) {
    throw new Error("Preferred return rate must be zero or greater.");
  }

  if (!Number.isFinite(timelineProgress) || timelineProgress < 0 || timelineProgress > 100) {
    throw new Error("Timeline progress must be between 0 and 100.");
  }

  return {
    name,
    location,
    currentPhase,
    status,
    fundedOn,
    investmentCloseOn,
    projectedExitOn,
    actualExitOn,
    debt: roundNumber(debt),
    taxExpense: roundNumber(taxExpense),
    debtInterestRate: roundNumber(debtInterestRate),
    expenseEntries,
    totalInterestPaid: roundNumber(totalInterestPaid),
    debtServiceEntries,
    earlyWithdrawalPenaltyRate: roundNumber(earlyWithdrawalPenaltyRate),
    budgetedProjectCost: roundNumber(budgetedProjectCost),
    actualProjectCost: actualProjectCost === null ? null : roundNumber(actualProjectCost),
    salePrice: roundNumber(salePrice),
    holdMonths: Math.round(holdMonths),
    prefRate: roundNumber(prefRate),
    timelineProgress: status === "sold" ? 100 : Math.round(timelineProgress)
  };
}

function normalizeIssueInput(input) {
  const dealId = String(input.dealId ?? "").trim();
  const issueType = String(input.issueType ?? "general")
    .trim()
    .toLowerCase();
  const title = String(input.title ?? "").trim();
  const description = String(input.description ?? "").trim();
  const approvalThreshold = Number(input.approvalThreshold ?? 0.75);
  const closesOn = String(input.closesOn ?? "").trim();
  const proposedPenaltyRate =
    input.proposedPenaltyRate === null ||
    input.proposedPenaltyRate === undefined ||
    String(input.proposedPenaltyRate).trim() === ""
      ? null
      : Number(input.proposedPenaltyRate);

  if (!dealId) {
    throw new Error("A deal selection is required.");
  }

  if (!["general", "penalty_rate_change"].includes(issueType)) {
    throw new Error("Issue type is invalid.");
  }

  if (!title) {
    throw new Error("Issue title is required.");
  }

  if (!description) {
    throw new Error("Issue description is required.");
  }

  if (!Number.isFinite(approvalThreshold) || approvalThreshold <= 0 || approvalThreshold > 1) {
    throw new Error("Approval threshold must be between 0 and 1.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(closesOn) || Number.isNaN(new Date(closesOn).getTime())) {
    throw new Error("A valid vote close date is required.");
  }

  if (closesOn < todayStamp()) {
    throw new Error("Vote close date cannot be in the past.");
  }

  if (issueType === "penalty_rate_change") {
    if (
      proposedPenaltyRate === null ||
      !Number.isFinite(proposedPenaltyRate) ||
      proposedPenaltyRate < 0 ||
      proposedPenaltyRate > 1
    ) {
      throw new Error("Penalty rate proposal must be between 0 and 1.");
    }
  }

  return {
    dealId,
    issueType,
    title,
    description,
    approvalThreshold: roundNumber(approvalThreshold),
    closesOn,
    proposedPenaltyRate:
      issueType === "penalty_rate_change" ? roundNumber(proposedPenaltyRate) : null
  };
}

function normalizeVoteChoice(value) {
  const voteChoice = String(value ?? "").trim().toLowerCase();

  if (!["yes", "no"].includes(voteChoice)) {
    throw new Error("Vote choice must be either yes or no.");
  }

  return voteChoice;
}

async function applyClosedPenaltyRateIssueResolutions() {
  const unresolvedIssues = await queryAll(
    `
      SELECT
        id,
        deal_id AS "dealId",
        approval_threshold AS "approvalThreshold",
        proposed_penalty_rate AS "proposedPenaltyRate"
      FROM deal_issues
      WHERE issue_type = 'penalty_rate_change'
        AND proposed_penalty_rate IS NOT NULL
        AND closes_on IS NOT NULL
        AND closes_on < $1
        AND resolution_applied_at IS NULL
      ORDER BY closes_on, created_at, id
    `,
    [todayStamp()]
  );

  for (const unresolvedIssue of unresolvedIssues) {
    await withTransaction(async (client) => {
      const issue = await queryOne(
        `
          SELECT
            id,
            deal_id AS "dealId",
            approval_threshold AS "approvalThreshold",
            proposed_penalty_rate AS "proposedPenaltyRate"
          FROM deal_issues
          WHERE id = $1
            AND issue_type = 'penalty_rate_change'
            AND proposed_penalty_rate IS NOT NULL
            AND resolution_applied_at IS NULL
          FOR UPDATE
        `,
        [unresolvedIssue.id],
        client
      );

      if (!issue) {
        return;
      }

      const capitalRows = await queryAll(
        `
          SELECT
            positions.participant_id AS "participantId",
            COALESCE(SUM(positions.contribution_amount), 0)::float AS amount
          FROM positions
          JOIN participants ON participants.id = positions.participant_id
          WHERE positions.deal_id = $1
            AND participants.category IN ('investor', 'contractor')
          GROUP BY positions.participant_id
          HAVING COALESCE(SUM(positions.contribution_amount), 0) > 0
        `,
        [issue.dealId],
        client
      );
      const votes = await queryAll(
        `
          SELECT
            participant_id AS "participantId",
            vote_choice AS "voteChoice"
          FROM deal_issue_votes
          WHERE issue_id = $1
        `,
        [issue.id],
        client
      );

      const capitalByParticipant = new Map(
        capitalRows.map((row) => [row.participantId, Number(row.amount ?? 0)])
      );
      const eligibleInvestment = [...capitalByParticipant.values()].reduce(
        (sum, amount) => sum + amount,
        0
      );
      let explicitYesInvestment = 0;
      let noInvestment = 0;

      for (const vote of votes) {
        const investedAmount = capitalByParticipant.get(vote.participantId) ?? 0;

        if (vote.voteChoice === "yes") {
          explicitYesInvestment += investedAmount;
        } else if (vote.voteChoice === "no") {
          noInvestment += investedAmount;
        }
      }

      const unresolvedInvestment = Math.max(
        0,
        eligibleInvestment - explicitYesInvestment - noInvestment
      );
      const yesInvestment = explicitYesInvestment + unresolvedInvestment;
      const yesPct = eligibleInvestment > 0 ? yesInvestment / eligibleInvestment : 0;
      const passed = eligibleInvestment > 0 && yesPct >= Number(issue.approvalThreshold ?? 0);
      const timestamp = nowTimestamp();

      if (passed) {
        await client.query(
          `
            UPDATE deals
            SET
              early_withdrawal_penalty_rate = $1,
              updated_at = $2
            WHERE id = $3
          `,
          [roundNumber(issue.proposedPenaltyRate), timestamp, issue.dealId]
        );
      }

      await client.query(
        `
          UPDATE deal_issues
          SET
            resolution_result = $1,
            resolution_applied_at = $2,
            updated_at = $2
          WHERE id = $3
        `,
        [passed ? "passed" : "failed", timestamp, issue.id]
      );
    });
  }
}

function normalizeCompanyResourceInput(input) {
  const title = String(input.title ?? "").trim();
  const resourceType = String(input.resourceType ?? "").trim();
  const dealId = normalizeOptionalText(input.dealId);
  const summaryText = normalizeOptionalText(input.summaryText ?? input.summary);
  const bodyText = normalizeOptionalText(input.bodyText);
  const resourceFile = normalizeResourceFile(input.resourceFile);

  if (!title) {
    throw new Error("A resource title is required.");
  }

  if (!["bylaw_document", "announcement", "project_balance_sheet"].includes(resourceType)) {
    throw new Error(
      "Resource type must be bylaw document, announcement, or project balance sheet."
    );
  }

  if (resourceType === "bylaw_document" && !resourceFile) {
    throw new Error("Bylaw documents must include an uploaded file.");
  }

  if (resourceType === "project_balance_sheet") {
    if (!dealId) {
      throw new Error("Project balance sheets must be linked to a deal.");
    }

    if (!resourceFile) {
      throw new Error("Project balance sheets must include an uploaded file.");
    }
  }

  if (resourceType === "announcement" && !summaryText && !bodyText && !resourceFile) {
    throw new Error("Announcements must include text or an attachment.");
  }

  return {
    title,
    dealId: resourceType === "project_balance_sheet" ? dealId : null,
    resourceType,
    summaryText,
    bodyText,
    resourceFile
  };
}

function normalizeDistributionElectionInput(input) {
  const electionMode = String(input.electionMode ?? "").trim();
  const targetDealId = normalizeOptionalText(input.targetDealId);
  const notes = normalizeOptionalText(input.notes);
  const rawPercent = String(input.reinvestPercent ?? "").trim();
  const rawAmount = String(input.reinvestAmount ?? "").trim();
  const reinvestPercent =
    rawPercent === "" ? null : roundNumber(Number(rawPercent));
  const reinvestAmount =
    rawAmount === "" ? null : roundNumber(Number(rawAmount));

  if (
    !["payout_all", "reinvest_all", "split_percentage", "split_amount"].includes(electionMode)
  ) {
    throw new Error("Choose a valid distribution instruction.");
  }

  if (electionMode === "split_percentage") {
    if (
      reinvestPercent === null ||
      !Number.isFinite(reinvestPercent) ||
      reinvestPercent < 0 ||
      reinvestPercent > 1
    ) {
      throw new Error("Reinvestment percentage must be between 0 and 1.");
    }
  }

  if (electionMode === "split_amount") {
    if (
      reinvestAmount === null ||
      !Number.isFinite(reinvestAmount) ||
      reinvestAmount < 0
    ) {
      throw new Error("Reinvestment amount must be zero or greater.");
    }
  }

  return {
    electionMode,
    reinvestPercent,
    reinvestAmount,
    targetDealId,
    notes
  };
}

function normalizeDealDebtServiceEntries(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  const entries = items.reduce((rows, item, index) => {
    const serviceMonthRaw = String(item?.serviceMonth ?? "").trim();
    const drawBalanceRaw = String(item?.drawBalance ?? "").trim();
    const interestPaidRaw = String(item?.interestPaid ?? "").trim();
    const isBlank = !serviceMonthRaw && !drawBalanceRaw && !interestPaidRaw;

    if (isBlank) {
      return rows;
    }

    const serviceMonth = normalizeMonthInput(serviceMonthRaw, `Debt service month ${index + 1}`);
    const drawBalance = Number(drawBalanceRaw);
    const interestPaid = Number(interestPaidRaw);

    if (!Number.isFinite(drawBalance) || drawBalance < 0) {
      throw new Error(`Debt service month ${index + 1} must have a valid draw balance.`);
    }

    if (!Number.isFinite(interestPaid) || interestPaid < 0) {
      throw new Error(`Debt service month ${index + 1} must have a valid interest paid amount.`);
    }

    rows.push({
      serviceMonth,
      drawBalance: roundNumber(drawBalance),
      interestPaid: roundNumber(interestPaid)
    });

    return rows;
  }, []);

  const seenMonths = new Set();

  for (const entry of entries) {
    if (seenMonths.has(entry.serviceMonth)) {
      throw new Error(`Debt service month ${entry.serviceMonth} was entered more than once.`);
    }

    seenMonths.add(entry.serviceMonth);
  }

  return entries.sort((left, right) => left.serviceMonth.localeCompare(right.serviceMonth));
}

function normalizeDealExpenseEntries(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.reduce((entries, item, index) => {
    const stageLabel = String(item?.stageLabel ?? "").trim();
    const payeeName = String(item?.payeeName ?? "").trim();
    const amountPaidRaw = String(item?.amountPaid ?? "").trim();
    const paidOnRaw = String(item?.paidOn ?? "").trim();
    const notes = String(item?.notes ?? "").trim();
    const isBlank = !stageLabel && !payeeName && !amountPaidRaw && !paidOnRaw && !notes;

    if (isBlank) {
      return entries;
    }

    const amountPaid = Number(amountPaidRaw);

    if (!stageLabel || !payeeName || !amountPaidRaw) {
      throw new Error(
        `Expense row ${index + 1} must include a stage, payee, and amount paid.`
      );
    }

    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      throw new Error(`Expense row ${index + 1} must have a valid amount paid.`);
    }

    entries.push({
      stageLabel,
      payeeName,
      amountPaid: roundNumber(amountPaid),
      paidOn: paidOnRaw ? normalizeOptionalDateInput(paidOnRaw, `Expense date ${index + 1}`) : null,
      notes,
      sortOrder: entries.length + 1
    });

    return entries;
  }, []);
}

function normalizeTimelineItems(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.reduce((timeline, item, index) => {
    const label = String(item?.label ?? "").trim();
    const date = String(item?.date ?? "").trim();
    const status = String(item?.status ?? "").trim();
    const isBlank = !label && !date && !status;

    if (isBlank) {
      return timeline;
    }

    if (!label || !date || !status) {
      throw new Error(`Timeline row ${index + 1} must include a label, date, and status.`);
    }

    if (!["complete", "in_progress", "upcoming"].includes(status)) {
      throw new Error(`Timeline row ${index + 1} has an invalid status.`);
    }

    timeline.push({
      label,
      date,
      status,
      sortOrder: timeline.length + 1
    });

    return timeline;
  }, []);
}

function normalizePromoteTiers(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  return items.reduce((tiers, item, index) => {
    const label = String(item?.label ?? "").trim();
    const hurdleRaw = String(item?.hurdle ?? "").trim();
    const investorShareRaw = String(item?.investorShare ?? "").trim();
    const sponsorShareRaw = String(item?.sponsorShare ?? "").trim();
    const isEnabled = item?.isEnabled !== false;
    const isBlank = !label && !hurdleRaw && !investorShareRaw && !sponsorShareRaw;

    if (isBlank) {
      return tiers;
    }

    const hurdle = Number(hurdleRaw);
    const investorShare = Number(investorShareRaw);
    const sponsorShare = Number(sponsorShareRaw);

    if (!label) {
      throw new Error(`Promote tier ${index + 1} must include a label.`);
    }

    if (!Number.isFinite(hurdle) || hurdle < 0) {
      throw new Error(`Promote tier ${index + 1} must have a valid hurdle.`);
    }

    if (!Number.isFinite(investorShare) || investorShare < 0 || investorShare > 1) {
      throw new Error(`Promote tier ${index + 1} must have a valid investor share.`);
    }

    if (!Number.isFinite(sponsorShare) || sponsorShare < 0 || sponsorShare > 1) {
      throw new Error(`Promote tier ${index + 1} must have a valid sponsor share.`);
    }

    if (Math.abs(investorShare + sponsorShare - 1) > 0.001) {
      throw new Error(
        `Promote tier ${index + 1} must have investor and sponsor shares that total 1.0.`
      );
    }

    tiers.push({
      label,
      hurdle: roundNumber(hurdle),
      investorShare: roundNumber(investorShare),
      sponsorShare: roundNumber(sponsorShare),
      isEnabled,
      sortOrder: tiers.length + 1
    });

    return tiers;
  }, []);
}

async function replaceDealTimeline(dealId, timelineItems, executor) {
  const timestamp = nowTimestamp();

  await executor.query(
    `
      DELETE FROM deal_timeline_items
      WHERE deal_id = $1
    `,
    [dealId]
  );

  for (const item of timelineItems) {
    await executor.query(
      `
        INSERT INTO deal_timeline_items (
          id,
          deal_id,
          label,
          milestone_date,
          status,
          sort_order,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        createId("timeline"),
        dealId,
        item.label,
        item.date,
        item.status,
        item.sortOrder,
        timestamp,
        timestamp
      ]
    );
  }
}

async function replaceDealDebtServiceEntries(dealId, entries, executor) {
  const timestamp = nowTimestamp();

  await executor.query(
    `
      DELETE FROM deal_debt_service_entries
      WHERE deal_id = $1
    `,
    [dealId]
  );

  for (const entry of entries) {
    await executor.query(
      `
        INSERT INTO deal_debt_service_entries (
          id,
          deal_id,
          interest_month,
          draw_balance,
          interest_paid,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        createId("debt-service"),
        dealId,
        entry.serviceMonth,
        entry.drawBalance,
        entry.interestPaid,
        timestamp,
        timestamp
      ]
    );
  }
}

async function replaceDealExpenseEntries(dealId, entries, executor) {
  const timestamp = nowTimestamp();

  await executor.query(
    `
      DELETE FROM deal_expense_entries
      WHERE deal_id = $1
    `,
    [dealId]
  );

  for (const entry of entries) {
    await executor.query(
      `
        INSERT INTO deal_expense_entries (
          id,
          deal_id,
          stage_label,
          payee_name,
          amount_paid,
          paid_on,
          notes,
          sort_order,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        createId("expense"),
        dealId,
        entry.stageLabel,
        entry.payeeName,
        entry.amountPaid,
        entry.paidOn,
        entry.notes || null,
        entry.sortOrder,
        timestamp,
        timestamp
      ]
    );
  }
}

async function replacePromoteTiers(dealId, tiers, executor) {
  const timestamp = nowTimestamp();

  await executor.query(
    `
      DELETE FROM promote_tiers
      WHERE deal_id = $1
    `,
    [dealId]
  );

  for (const tier of tiers) {
    await executor.query(
      `
        INSERT INTO promote_tiers (
          id,
          deal_id,
          label,
          hurdle,
          investor_share,
          sponsor_share,
          is_enabled,
          sort_order,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        createId("tier"),
        dealId,
        tier.label,
        tier.hurdle,
        tier.investorShare,
        tier.sponsorShare,
        tier.isEnabled ? 1 : 0,
        tier.sortOrder,
        timestamp,
        timestamp
      ]
    );
  }
}

export async function createDeal(input) {
  const deal = normalizeDealInput(input);
  const expenseEntries = deal.expenseEntries;
  const debtServiceEntries = deal.debtServiceEntries;
  const timelineItems = normalizeTimelineItems(input.timeline);
  const promoteTiers = normalizePromoteTiers(input.promoteTiers);
  const existingDeal = await queryOne(
    `
      SELECT id
      FROM deals
      WHERE LOWER(name) = LOWER($1)
    `,
    [deal.name]
  );

  if (existingDeal) {
    throw new Error("A deal with that name already exists.");
  }

  const timestamp = nowTimestamp();
  const dealId = createId("deal");

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO deals (
          id,
          name,
          location,
          total_equity,
          debt,
          tax_expense,
          debt_interest_rate,
          total_interest_paid,
          early_withdrawal_penalty_rate,
          budgeted_project_cost,
          actual_project_cost,
          sale_price,
          hold_months,
          pref_rate,
          status,
          current_phase,
          funded_on,
          investment_close_on,
          projected_exit_on,
          actual_exit_on,
          timeline_progress,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          $21,
          $22,
          $23
        )
      `,
      [
        dealId,
        deal.name,
        deal.location,
        0,
        deal.debt,
        deal.taxExpense,
        deal.debtInterestRate,
        deal.totalInterestPaid,
        deal.earlyWithdrawalPenaltyRate,
        deal.budgetedProjectCost,
        deal.actualProjectCost,
        deal.salePrice,
        deal.holdMonths,
        deal.prefRate,
        deal.status,
        deal.currentPhase,
        deal.fundedOn,
        deal.investmentCloseOn,
        deal.projectedExitOn,
        deal.actualExitOn,
        deal.timelineProgress,
        timestamp,
        timestamp
      ]
    );

    if (timelineItems) {
      await replaceDealTimeline(dealId, timelineItems, client);
    }

    if (expenseEntries !== null) {
      await replaceDealExpenseEntries(dealId, expenseEntries, client);
    }

    if (debtServiceEntries !== null) {
      await replaceDealDebtServiceEntries(dealId, debtServiceEntries, client);
    }

    if (promoteTiers) {
      await replacePromoteTiers(dealId, promoteTiers, client);
    }
  });

  const recipients = await queryAll(
    `
      SELECT
        users.id AS "userId",
        users.participant_id AS "participantId",
        users.email AS email,
        participants.name AS "fullName"
      FROM users
      JOIN participants ON participants.id = users.participant_id
      WHERE users.role = 'investor'
        AND users.is_active = 1
      ORDER BY participants.name
    `
  );

  const notifications = await Promise.all(
    recipients.map(async (recipient) => {
      try {
        return await sendNewDealAnnouncementNotification({
          userId: recipient.userId,
          participantId: recipient.participantId,
          fullName: recipient.fullName,
          email: recipient.email,
          dealName: deal.name,
          location: deal.location,
          currentPhase: deal.currentPhase,
          investmentCloseOn: deal.investmentCloseOn
        });
      } catch (error) {
        return {
          status: "failed",
          provider: "notification_error",
          localPath: null,
          errorMessage: error.message,
          recipientEmail: recipient.email
        };
      }
    })
  );

  const createdDeal = await queryOne(
    `
      SELECT id, name
      FROM deals
      WHERE id = $1
    `,
    [dealId]
  );

  return {
    deal: createdDeal,
    notifications
  };
}

export async function updateDeal(dealId, input) {
  const id = String(dealId ?? "").trim();

  if (!id) {
    throw new Error("Deal id is required.");
  }

  const existingDeal = await queryOne(
    `
      SELECT
        id,
        status,
        distribution_election_due_on AS "distributionElectionDueOn"
      FROM deals
      WHERE id = $1
    `,
    [id]
  );

  if (!existingDeal) {
    throw new Error("Deal not found.");
  }

  if (existingDeal.status === "sold") {
    throw new Error(
      "Sold projects are locked and cannot be edited. Archive the sold project instead."
    );
  }

  const deal = normalizeDealInput(input);
  const isClosingDeal = existingDeal.status !== "sold" && deal.status === "sold";
  const closingElectionDueOn =
    existingDeal.distributionElectionDueOn ||
    addDaysToDateStamp(todayStamp(), DISTRIBUTION_ELECTION_DEADLINE_DAYS);
  const expenseEntries = deal.expenseEntries;
  const debtServiceEntries = deal.debtServiceEntries;
  const timelineItems = normalizeTimelineItems(input.timeline);
  const promoteTiers = normalizePromoteTiers(input.promoteTiers);
  const duplicateDeal = await queryOne(
    `
      SELECT id
      FROM deals
      WHERE LOWER(name) = LOWER($1)
        AND id <> $2
    `,
    [deal.name, id]
  );

  if (duplicateDeal) {
    throw new Error("A deal with that name already exists.");
  }

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE deals
        SET
          name = $1,
          location = $2,
          debt = $3,
          tax_expense = $4,
          debt_interest_rate = $5,
          total_interest_paid = $6,
          early_withdrawal_penalty_rate = $7,
          budgeted_project_cost = $8,
          actual_project_cost = $9,
          sale_price = $10,
          hold_months = $11,
          pref_rate = $12,
          status = $13,
          current_phase = $14,
          funded_on = $15,
          investment_close_on = $16,
          projected_exit_on = $17,
          actual_exit_on = $18,
          timeline_progress = $19,
          updated_at = $20
        WHERE id = $21
      `,
      [
        deal.name,
        deal.location,
        deal.debt,
        deal.taxExpense,
        deal.debtInterestRate,
        deal.totalInterestPaid,
        deal.earlyWithdrawalPenaltyRate,
        deal.budgetedProjectCost,
        deal.actualProjectCost,
        deal.salePrice,
        deal.holdMonths,
        deal.prefRate,
        deal.status,
        deal.currentPhase,
        deal.fundedOn,
        deal.investmentCloseOn,
        deal.projectedExitOn,
        deal.actualExitOn,
        deal.timelineProgress,
        nowTimestamp(),
        id
      ]
    );

    if (timelineItems) {
      await replaceDealTimeline(id, timelineItems, client);
    }

    if (expenseEntries !== null) {
      await replaceDealExpenseEntries(id, expenseEntries, client);
    }

    if (debtServiceEntries !== null) {
      await replaceDealDebtServiceEntries(id, debtServiceEntries, client);
    }

    if (promoteTiers) {
      await replacePromoteTiers(id, promoteTiers, client);
    }

    if (isClosingDeal) {
      await client.query(
        `
          UPDATE deals
          SET
            distribution_election_due_on = COALESCE(distribution_election_due_on, $1),
            distribution_election_notice_sent_at = NULL,
            updated_at = $2
          WHERE id = $3
        `,
        [closingElectionDueOn, nowTimestamp(), id]
      );
    }
  });

  if (isClosingDeal) {
    return {
      dealId: id,
      distributionElectionDueOn: closingElectionDueOn,
      notifications: await sendDistributionElectionRequestNotificationsForDeal(id)
    };
  }
}

export async function createCompanyResource(input, createdByUserId) {
  const resource = normalizeCompanyResourceInput(input);
  const resourceId = createId("resource");
  const timestamp = nowTimestamp();

  if (resource.dealId) {
    const linkedDeal = await queryOne(
      `
        SELECT id
        FROM deals
        WHERE id = $1
      `,
      [resource.dealId]
    );

    if (!linkedDeal) {
      throw new Error("Choose a valid deal for the project balance sheet.");
    }
  }

  await pool.query(
    `
      INSERT INTO company_resources (
        id,
        title,
        deal_id,
        resource_type,
        summary_text,
        body_text,
        file_name,
        file_mime_type,
        file_data_url,
        published_at,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
    [
      resourceId,
      resource.title,
      resource.dealId,
      resource.resourceType,
      resource.summaryText,
      resource.bodyText,
      resource.resourceFile?.fileName ?? null,
      resource.resourceFile?.mimeType ?? null,
      resource.resourceFile?.dataUrl ?? null,
      timestamp,
      createdByUserId,
      timestamp,
      timestamp
    ]
  );

  return {
    id: resourceId,
    title: resource.title,
    dealId: resource.dealId,
    resourceType: resource.resourceType
  };
}

export async function getCompanyResourceDownload(resourceId) {
  const normalizedResourceId = String(resourceId ?? "").trim();

  if (!normalizedResourceId) {
    throw new Error("Resource id is required.");
  }

  const resource = await queryOne(
    `
      SELECT
        id,
        title,
        file_name AS "fileName",
        file_mime_type AS "fileMimeType",
        file_data_url AS "fileDataUrl"
      FROM company_resources
      WHERE id = $1
    `,
    [normalizedResourceId]
  );

  if (!resource) {
    throw new Error("Resource not found.");
  }

  if (!resource.fileName || !resource.fileDataUrl) {
    throw new Error("This resource does not have a downloadable file.");
  }

  return resource;
}

export async function getUserIdentityDocumentDownload(userId) {
  const normalizedUserId = String(userId ?? "").trim();

  if (!normalizedUserId) {
    throw new Error("A valid user is required.");
  }

  const document = await queryOne(
    `
      SELECT
        users.id AS "userId",
        participants.name AS "fullName",
        participants.id_card_file_name AS "fileName",
        participants.id_card_mime_type AS "fileMimeType",
        participants.id_card_data_url AS "fileDataUrl"
      FROM users
      JOIN participants ON participants.id = users.participant_id
      WHERE users.id = $1
    `,
    [normalizedUserId]
  );

  if (!document) {
    throw new Error("User not found.");
  }

  if (!document.fileName || !document.fileDataUrl) {
    throw new Error("This user has not uploaded an identity document.");
  }

  return document;
}

export async function getLegalAcknowledgementPaymentProofDownload(acknowledgementId) {
  const normalizedAcknowledgementId = String(acknowledgementId ?? "").trim();

  if (!normalizedAcknowledgementId) {
    throw new Error("A valid legal acknowledgement is required.");
  }

  const document = await queryOne(
    `
      SELECT
        user_legal_acknowledgements.id,
        user_legal_acknowledgements.document_title AS "documentTitle",
        user_legal_acknowledgements.proof_of_payment_file_name AS "fileName",
        user_legal_acknowledgements.proof_of_payment_mime_type AS "fileMimeType",
        user_legal_acknowledgements.proof_of_payment_data_url AS "fileDataUrl",
        participants.name AS "participantName"
      FROM user_legal_acknowledgements
      JOIN participants ON participants.id = user_legal_acknowledgements.participant_id
      WHERE user_legal_acknowledgements.id = $1
    `,
    [normalizedAcknowledgementId]
  );

  if (!document) {
    throw new Error("Legal acknowledgement not found.");
  }

  if (!document.fileName || !document.fileDataUrl) {
    throw new Error("This legal acknowledgement does not have proof of payment.");
  }

  return document;
}

async function insertArchivedRecord(client, archiveInput) {
  const entityType = String(archiveInput?.entityType ?? "").trim();
  const entityId = String(archiveInput?.entityId ?? "").trim();
  const sourceTable = String(archiveInput?.sourceTable ?? "").trim();

  if (!entityType || !entityId || !sourceTable) {
    throw new Error("Archive entries require entity type, entity id, and source table.");
  }

  const deletedAt = nowTimestamp();
  const actor = await getArchiveActorSnapshot(archiveInput?.deletedByUserId, client);
  const archiveRecord = {
    id: createId("archive"),
    entityType,
    entityId,
    sourceTable,
    displayName: normalizeOptionalText(archiveInput?.displayName),
    relatedDealId: normalizeOptionalText(archiveInput?.relatedDealId),
    relatedParticipantId: normalizeOptionalText(archiveInput?.relatedParticipantId),
    deletedByUserId: actor?.id ?? normalizeOptionalText(archiveInput?.deletedByUserId),
    deletedByRole: actor?.role ?? null,
    deletedByEmail: actor?.email ?? null,
    deletedByName: actor?.name ?? null,
    deletedAt,
    payloadJson: archiveInput?.payload ?? {},
    createdAt: deletedAt
  };

  await client.query(
    `
      INSERT INTO archived_records (
        id,
        entity_type,
        entity_id,
        source_table,
        display_name,
        related_deal_id,
        related_participant_id,
        deleted_by_user_id,
        deleted_by_role,
        deleted_by_email,
        deleted_by_name,
        deleted_at,
        payload_json,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
    `,
    [
      archiveRecord.id,
      archiveRecord.entityType,
      archiveRecord.entityId,
      archiveRecord.sourceTable,
      archiveRecord.displayName,
      archiveRecord.relatedDealId,
      archiveRecord.relatedParticipantId,
      archiveRecord.deletedByUserId,
      archiveRecord.deletedByRole,
      archiveRecord.deletedByEmail,
      archiveRecord.deletedByName,
      archiveRecord.deletedAt,
      JSON.stringify(archiveRecord.payloadJson ?? {}),
      archiveRecord.createdAt
    ]
  );

  return archiveRecord;
}

async function buildCompanyResourceArchivePayload(resourceId, executor = pool) {
  return queryOne(
    `
      SELECT
        company_resources.*,
        deals.name AS deal_name,
        creator.email AS created_by_email,
        creator_participant.name AS created_by_name
      FROM company_resources
      LEFT JOIN deals ON deals.id = company_resources.deal_id
      LEFT JOIN users AS creator ON creator.id = company_resources.created_by_user_id
      LEFT JOIN participants AS creator_participant
        ON creator_participant.id = creator.participant_id
      WHERE company_resources.id = $1
    `,
    [resourceId],
    executor
  );
}

async function buildDealArchivePayload(dealId, executor = pool) {
  const deal = await queryOne(
    `
      SELECT *
      FROM deals
      WHERE id = $1
    `,
    [dealId],
    executor
  );

  if (!deal) {
    return null;
  }

  const promoteTiers = await queryAll(
    `
      SELECT *
      FROM promote_tiers
      WHERE deal_id = $1
      ORDER BY sort_order, id
    `,
    [dealId],
    executor
  );
  const timelineItems = await queryAll(
    `
      SELECT *
      FROM deal_timeline_items
      WHERE deal_id = $1
      ORDER BY sort_order, id
    `,
    [dealId],
    executor
  );
  const expenseEntries = await queryAll(
    `
      SELECT *
      FROM deal_expense_entries
      WHERE deal_id = $1
      ORDER BY sort_order, id
    `,
    [dealId],
    executor
  );
  const debtServiceEntries = await queryAll(
    `
      SELECT *
      FROM deal_debt_service_entries
      WHERE deal_id = $1
      ORDER BY interest_month, id
    `,
    [dealId],
    executor
  );
  const positions = await queryAll(
    `
      SELECT
        positions.*,
        participants.name AS participant_name,
        participants.category AS participant_category
      FROM positions
      LEFT JOIN participants ON participants.id = positions.participant_id
      WHERE positions.deal_id = $1
      ORDER BY positions.created_at, positions.id
    `,
    [dealId],
    executor
  );
  const contractorParticipation = await queryAll(
    `
      SELECT
        contractor_participation.*,
        participants.name AS participant_name,
        participants.category AS participant_category
      FROM contractor_participation
      LEFT JOIN participants ON participants.id = contractor_participation.participant_id
      WHERE contractor_participation.deal_id = $1
      ORDER BY contractor_participation.created_at, contractor_participation.id
    `,
    [dealId],
    executor
  );
  const distributionElections = await queryAll(
    `
      SELECT
        distribution_elections.*,
        participants.name AS participant_name,
        rollover_deal.name AS rollover_target_deal_name,
        submitter.email AS submitted_by_email,
        submitter_participant.name AS submitted_by_name,
        reviewer.email AS reviewed_by_email,
        reviewer_participant.name AS reviewed_by_name
      FROM distribution_elections
      LEFT JOIN participants ON participants.id = distribution_elections.participant_id
      LEFT JOIN deals AS rollover_deal
        ON rollover_deal.id = distribution_elections.rollover_target_deal_id
      LEFT JOIN users AS submitter
        ON submitter.id = distribution_elections.submitted_by_user_id
      LEFT JOIN participants AS submitter_participant
        ON submitter_participant.id = submitter.participant_id
      LEFT JOIN users AS reviewer
        ON reviewer.id = distribution_elections.reviewed_by_user_id
      LEFT JOIN participants AS reviewer_participant
        ON reviewer_participant.id = reviewer.participant_id
      WHERE distribution_elections.deal_id = $1
      ORDER BY distribution_elections.created_at, distribution_elections.id
    `,
    [dealId],
    executor
  );
  const investorPools = await queryAll(
    `
      SELECT
        investor_pools.*,
        pool_participant.name AS pool_participant_name
      FROM investor_pools
      LEFT JOIN participants AS pool_participant
        ON pool_participant.id = investor_pools.pool_participant_id
      WHERE investor_pools.selected_deal_id = $1
      ORDER BY investor_pools.created_at, investor_pools.id
    `,
    [dealId],
    executor
  );
  const investorPoolCommitments = investorPools.length
    ? await queryAll(
        `
          SELECT
            investor_pool_commitments.*,
            participants.name AS participant_name
          FROM investor_pool_commitments
          LEFT JOIN participants ON participants.id = investor_pool_commitments.participant_id
          WHERE investor_pool_commitments.pool_id = ANY($1::text[])
          ORDER BY investor_pool_commitments.created_at, investor_pool_commitments.id
        `,
        [investorPools.map((poolRow) => poolRow.id)],
        executor
      )
    : [];
  const investorPoolVotes = investorPools.length
    ? await queryAll(
        `
          SELECT
            investor_pool_votes.*,
            participants.name AS participant_name,
            deals.name AS deal_name
          FROM investor_pool_votes
          LEFT JOIN participants ON participants.id = investor_pool_votes.participant_id
          LEFT JOIN deals ON deals.id = investor_pool_votes.deal_id
          WHERE investor_pool_votes.pool_id = ANY($1::text[])
          ORDER BY investor_pool_votes.created_at, investor_pool_votes.id
        `,
        [investorPools.map((poolRow) => poolRow.id)],
        executor
      )
    : [];
  const companyResources = await queryAll(
    `
      SELECT
        company_resources.*,
        creator.email AS created_by_email,
        creator_participant.name AS created_by_name
      FROM company_resources
      LEFT JOIN users AS creator ON creator.id = company_resources.created_by_user_id
      LEFT JOIN participants AS creator_participant
        ON creator_participant.id = creator.participant_id
      WHERE company_resources.deal_id = $1
      ORDER BY company_resources.created_at, company_resources.id
    `,
    [dealId],
    executor
  );
  const issues = await queryAll(
    `
      SELECT
        deal_issues.*,
        creator.email AS created_by_email,
        creator_participant.name AS created_by_name
      FROM deal_issues
      LEFT JOIN users AS creator ON creator.id = deal_issues.created_by_user_id
      LEFT JOIN participants AS creator_participant
        ON creator_participant.id = creator.participant_id
      WHERE deal_issues.deal_id = $1
      ORDER BY deal_issues.created_at, deal_issues.id
    `,
    [dealId],
    executor
  );
  const issueVotes = await queryAll(
    `
      SELECT
        deal_issue_votes.*,
        deal_issues.title AS issue_title,
        participants.name AS participant_name
      FROM deal_issue_votes
      JOIN deal_issues ON deal_issues.id = deal_issue_votes.issue_id
      LEFT JOIN participants ON participants.id = deal_issue_votes.participant_id
      WHERE deal_issues.deal_id = $1
      ORDER BY deal_issue_votes.created_at, deal_issue_votes.id
    `,
    [dealId],
    executor
  );

  return {
    deal,
    promoteTiers,
    timelineItems,
    expenseEntries,
    debtServiceEntries,
    positions,
    contractorParticipation,
    distributionElections,
    investorPools,
    investorPoolCommitments,
    investorPoolVotes,
    companyResources,
    issues,
    issueVotes,
    counts: {
      promoteTiers: promoteTiers.length,
      timelineItems: timelineItems.length,
      expenseEntries: expenseEntries.length,
      positions: positions.length,
      contractorParticipation: contractorParticipation.length,
      distributionElections: distributionElections.length,
      investorPools: investorPools.length,
      investorPoolCommitments: investorPoolCommitments.length,
      investorPoolVotes: investorPoolVotes.length,
      companyResources: companyResources.length,
      issues: issues.length,
      issueVotes: issueVotes.length
    }
  };
}

function buildInvestorPoolArchivePayload(poolRow, dealArchivePayload) {
  const poolId = poolRow?.id;

  return {
    investorPool: poolRow,
    investorPoolCommitments: (dealArchivePayload?.investorPoolCommitments ?? []).filter(
      (commitment) => commitment.pool_id === poolId
    ),
    investorPoolVotes: (dealArchivePayload?.investorPoolVotes ?? []).filter(
      (vote) => vote.pool_id === poolId
    ),
    archivedWithDeal: {
      id: dealArchivePayload?.deal?.id ?? null,
      name: dealArchivePayload?.deal?.name ?? null,
      status: dealArchivePayload?.deal?.status ?? null
    }
  };
}

async function buildUserArchivePayload(userId, executor = pool) {
  const user = await queryOne(
    `
      SELECT
        users.*,
        participants.name AS participant_name,
        participants.category AS participant_category,
        participants.first_name,
        participants.middle_name,
        participants.last_name,
        participants.driver_license_number,
        participants.id_card_file_name,
        participants.id_card_mime_type,
        participants.id_card_data_url,
        participants.id_document_issue_date,
        participants.id_document_expiration_date,
        participants.current_address,
        participants.mailing_address,
        participants.contact_phone,
        participants.payout_method,
        participants.bank_account_name,
        participants.bank_name,
        participants.bank_routing_number,
        participants.bank_account_number,
        participants.zelle_details,
        participants.cash_app_handle,
        participants.payout_notes
      FROM users
      JOIN participants ON participants.id = users.participant_id
      WHERE users.id = $1
    `,
    [userId],
    executor
  );

  if (!user) {
    return null;
  }

  const positions = await queryAll(
    `
      SELECT
        positions.*,
        deals.name AS deal_name
      FROM positions
      LEFT JOIN deals ON deals.id = positions.deal_id
      WHERE positions.participant_id = $1
      ORDER BY positions.created_at, positions.id
    `,
    [user.participant_id],
    executor
  );
  const contractorParticipation = await queryAll(
    `
      SELECT
        contractor_participation.*,
        deals.name AS deal_name
      FROM contractor_participation
      LEFT JOIN deals ON deals.id = contractor_participation.deal_id
      WHERE contractor_participation.participant_id = $1
      ORDER BY contractor_participation.created_at, contractor_participation.id
    `,
    [user.participant_id],
    executor
  );
  const distributionElections = await queryAll(
    `
      SELECT
        distribution_elections.*,
        deals.name AS deal_name,
        rollover_deal.name AS rollover_target_deal_name
      FROM distribution_elections
      LEFT JOIN deals ON deals.id = distribution_elections.deal_id
      LEFT JOIN deals AS rollover_deal
        ON rollover_deal.id = distribution_elections.rollover_target_deal_id
      WHERE distribution_elections.participant_id = $1
      ORDER BY distribution_elections.created_at, distribution_elections.id
    `,
    [user.participant_id],
    executor
  );
  const emailNotifications = await queryAll(
    `
      SELECT *
      FROM email_notifications
      WHERE user_id = $1
      ORDER BY created_at, id
    `,
    [userId],
    executor
  );
  const passwordResetTokens = await queryAll(
    `
      SELECT *
      FROM password_reset_tokens
      WHERE user_id = $1
      ORDER BY created_at, id
    `,
    [userId],
    executor
  );
  const createdCompanyResources = await queryAll(
    `
      SELECT
        company_resources.*,
        deals.name AS deal_name
      FROM company_resources
      LEFT JOIN deals ON deals.id = company_resources.deal_id
      WHERE company_resources.created_by_user_id = $1
      ORDER BY company_resources.created_at, company_resources.id
    `,
    [userId],
    executor
  );
  const createdDealIssues = await queryAll(
    `
      SELECT
        deal_issues.*,
        deals.name AS deal_name
      FROM deal_issues
      LEFT JOIN deals ON deals.id = deal_issues.deal_id
      WHERE deal_issues.created_by_user_id = $1
      ORDER BY deal_issues.created_at, deal_issues.id
    `,
    [userId],
    executor
  );
  const reviewedDistributionElections = await queryAll(
    `
      SELECT
        distribution_elections.*,
        deals.name AS deal_name,
        participants.name AS participant_name
      FROM distribution_elections
      LEFT JOIN deals ON deals.id = distribution_elections.deal_id
      LEFT JOIN participants ON participants.id = distribution_elections.participant_id
      WHERE distribution_elections.submitted_by_user_id = $1
         OR distribution_elections.reviewed_by_user_id = $1
      ORDER BY distribution_elections.updated_at, distribution_elections.id
    `,
    [userId],
    executor
  );

  return {
    user,
    positions,
    contractorParticipation,
    distributionElections,
    emailNotifications,
    passwordResetTokens,
    createdCompanyResources,
    createdDealIssues,
    reviewedDistributionElections,
    counts: {
      positions: positions.length,
      contractorParticipation: contractorParticipation.length,
      distributionElections: distributionElections.length,
      emailNotifications: emailNotifications.length,
      passwordResetTokens: passwordResetTokens.length,
      createdCompanyResources: createdCompanyResources.length,
      createdDealIssues: createdDealIssues.length,
      reviewedDistributionElections: reviewedDistributionElections.length
    }
  };
}

export async function deleteCompanyResource(resourceId, actingUserId = null) {
  const normalizedResourceId = String(resourceId ?? "").trim();

  if (!normalizedResourceId) {
    throw new Error("Resource id is required.");
  }

  const archive = await withTransaction(async (client) => {
    const existing = await buildCompanyResourceArchivePayload(normalizedResourceId, client);

    if (!existing) {
      throw new Error("Resource not found.");
    }

    const archiveRecord = await insertArchivedRecord(client, {
      entityType: "company_resource",
      entityId: normalizedResourceId,
      sourceTable: "company_resources",
      displayName: existing.title,
      relatedDealId: existing.deal_id,
      deletedByUserId: actingUserId,
      payload: existing
    });

    await client.query(
      `
        DELETE FROM company_resources
        WHERE id = $1
      `,
      [normalizedResourceId]
    );

    return archiveRecord;
  });

  return {
    ok: true,
    deletedResourceId: normalizedResourceId,
    archivedRecordId: archive.id
  };
}

function participantHasPayoutInstructions(participant) {
  return Boolean(
    participant?.payoutMethod ||
      participant?.bankAccountName ||
      participant?.bankName ||
      participant?.bankRoutingNumber ||
      participant?.bankAccountNumber ||
      participant?.zelleDetails ||
      participant?.cashAppHandle ||
      participant?.payoutNotes
  );
}

function resolveDistributionElectionContext(snapshot, dealId, participantId) {
  const deal = snapshot.deals.find((item) => item.id === dealId);

  if (!deal) {
    throw new Error("Deal not found.");
  }

  const participant = snapshot.participants.find((item) => item.id === participantId);
  const position = snapshot.positions.find(
    (item) => item.dealId === dealId && item.participantId === participantId
  );

  if (position && participant?.category === "investor") {
    const dealPositions = snapshot.positions.filter((item) => item.dealId === dealId);
    const waterfall = calculateWaterfall({ deal, positions: dealPositions });
    const positionResult = waterfall.participantResults.find(
      (item) => item.positionId === position.id
    );

    if (!positionResult || positionResult.totalPayout <= 0) {
      throw new Error("No exited proceeds are available for this position.");
    }

    return {
      kind: "direct",
      deal,
      participant,
      position,
      classType: position.classType,
      totalPayout: roundNumber(positionResult.totalPayout),
      capitalReturned: roundNumber(positionResult.capitalReturned),
      profitReturned: roundNumber(positionResult.prefEarned + positionResult.profitShare),
      sourcePoolNames: []
    };
  }

  const pooledContext = buildPoolDistributionContexts(snapshot, {
    participantId,
    dealId
  })[0];

  if (pooledContext) {
    return {
      kind: "pooled",
      deal,
      participant,
      position: null,
      classType: "Class A",
      totalPayout: roundNumber(pooledContext.totalPayout),
      capitalReturned: roundNumber(pooledContext.capitalReturned),
      profitReturned: roundNumber(pooledContext.profitReturned),
      sourcePoolNames: pooledContext.sourcePoolNames
    };
  }

  throw new Error("You do not have an eligible distribution balance in this deal.");
}

function resolveDistributionElectionStatus(election) {
  if (!election) {
    return "missing";
  }

  const approvalStatus = election.approvalStatus ?? (election.reviewedAt ? "approved" : "pending");

  return approvalStatus === "approved" ? "approved" : "pending";
}

function findDefaultReinvestmentTargetDeal(snapshot, sourceDealId) {
  return (
    [...(snapshot.deals ?? [])]
      .filter((deal) => deal.id !== sourceDealId && deal.status !== "sold")
      .sort((left, right) => {
        const leftDate = left.investmentCloseOn || left.projectedExitOn || left.fundedOn || "9999-12-31";
        const rightDate =
          right.investmentCloseOn || right.projectedExitOn || right.fundedOn || "9999-12-31";
        const dateCompare = String(leftDate).localeCompare(String(rightDate));

        return dateCompare !== 0 ? dateCompare : left.name.localeCompare(right.name);
      })[0] ?? null
  );
}

function buildDistributionElectionRequirementContexts(snapshot, dealId) {
  const deal = (snapshot.deals ?? []).find((item) => item.id === dealId);

  if (!deal || deal.status !== "sold") {
    return [];
  }

  const participantMap = new Map((snapshot.participants ?? []).map((item) => [item.id, item]));
  const userMap = new Map((snapshot.users ?? []).map((item) => [item.participantId, item]));
  const electionMap = new Map(
    (snapshot.distributionElections ?? []).map((item) => [
      `${item.dealId}:${item.participantId}`,
      item
    ])
  );
  const dealPositions = (snapshot.positions ?? []).filter((position) => position.dealId === dealId);
  const waterfall = calculateWaterfall({ deal, positions: dealPositions });
  const resultMap = new Map(
    (waterfall.participantResults ?? []).map((result) => [result.positionId, result])
  );
  const requirements = [];
  const seenKeys = new Set();

  for (const position of dealPositions) {
    const participant = participantMap.get(position.participantId);

    if (participant?.category !== "investor") {
      continue;
    }

    const result = resultMap.get(position.id);

    if (!result || result.totalPayout <= 0) {
      continue;
    }

    const key = `${dealId}:${position.participantId}`;
    const election = electionMap.get(key) ?? null;

    requirements.push({
      key,
      kind: "direct",
      dealId,
      dealName: deal.name,
      participantId: position.participantId,
      participantName: participant.name,
      participantEmail: userMap.get(position.participantId)?.email ?? "",
      user: userMap.get(position.participantId) ?? null,
      sourcePoolNames: [],
      totalPayout: roundNumber(result.totalPayout),
      capitalReturned: roundNumber(result.capitalReturned),
      profitReturned: roundNumber(result.prefEarned + result.profitShare),
      status: resolveDistributionElectionStatus(election),
      election
    });
    seenKeys.add(key);
  }

  for (const context of buildPoolDistributionContexts(snapshot, { dealId })) {
    const key = `${dealId}:${context.participantId}`;

    if (seenKeys.has(key)) {
      continue;
    }

    requirements.push({
      key,
      kind: "pooled",
      dealId,
      dealName: context.dealName,
      participantId: context.participantId,
      participantName: context.participantName,
      participantEmail: context.participantEmail,
      user: userMap.get(context.participantId) ?? null,
      sourcePoolNames: context.sourcePoolNames,
      totalPayout: roundNumber(context.totalPayout),
      capitalReturned: roundNumber(context.capitalReturned),
      profitReturned: roundNumber(context.profitReturned),
      status: resolveDistributionElectionStatus(context.distributionPlan?.hasElection
        ? context.distributionPlan
        : electionMap.get(key) ?? null),
      election: electionMap.get(key) ?? null
    });
    seenKeys.add(key);
  }

  return requirements.filter((requirement) => requirement.totalPayout > 0);
}

function getUnresolvedDistributionElectionRequirements(snapshot, dealId) {
  return buildDistributionElectionRequirementContexts(snapshot, dealId).filter(
    (requirement) => requirement.status !== "approved"
  );
}

async function getAutomationManagerUser() {
  const row = await queryOne(
    `
      ${USER_SELECT_FRAGMENT}
      WHERE users.role = 'manager'
        AND users.is_active = 1
      ORDER BY users.created_at, users.id
      LIMIT 1
    `
  );

  return mapUserRow(row);
}

async function sendDistributionElectionRequestNotificationsForDeal(dealId) {
  const timestamp = nowTimestamp();
  const claimedDeal = await queryOne(
    `
      UPDATE deals
      SET distribution_election_notice_sent_at = $1
      WHERE id = $2
        AND status = 'sold'
        AND distribution_election_notice_sent_at IS NULL
      RETURNING
        id,
        name,
        distribution_election_due_on AS "distributionElectionDueOn"
    `,
    [timestamp, dealId]
  );

  if (!claimedDeal) {
    return [];
  }

  const snapshot = await getAppDataSnapshot({ skipAutomation: true });
  const defaultTargetDeal = findDefaultReinvestmentTargetDeal(snapshot, dealId);
  const requirements = buildDistributionElectionRequirementContexts(snapshot, dealId).filter(
    (requirement) => requirement.status !== "approved"
  );

  return Promise.all(
    requirements
      .filter(
        (requirement) =>
          requirement.user?.role === "investor" &&
          requirement.user?.isActive &&
          requirement.user?.accountApprovalStatus === "approved" &&
          requirement.user?.email
      )
      .map(async (requirement) => {
        try {
          return await sendDistributionElectionRequestNotification({
            userId: requirement.user.id,
            participantId: requirement.participantId,
            fullName: requirement.participantName,
            email: requirement.user.email,
            dealName: claimedDeal.name,
            dueOn: claimedDeal.distributionElectionDueOn,
            totalPayout: requirement.totalPayout,
            defaultTargetDealName: defaultTargetDeal?.name ?? null
          });
        } catch (error) {
          return {
            status: "failed",
            provider: "notification_error",
            localPath: null,
            errorMessage: error.message,
            recipientEmail: requirement.user.email
          };
        }
      })
  );
}

async function ensureDistributionElectionRequestsForSoldDeals() {
  const soldDealsNeedingElectionSetup = await queryAll(
    `
      SELECT
        id,
        distribution_election_due_on AS "distributionElectionDueOn",
        distribution_election_notice_sent_at AS "distributionElectionNoticeSentAt"
      FROM deals
      WHERE status = 'sold'
        AND (
          distribution_election_due_on IS NULL
          OR distribution_election_notice_sent_at IS NULL
        )
      ORDER BY actual_exit_on NULLS LAST, updated_at, id
    `
  );

  for (const deal of soldDealsNeedingElectionSetup) {
    if (!deal.distributionElectionDueOn) {
      await pool.query(
        `
          UPDATE deals
          SET
            distribution_election_due_on = $1,
            updated_at = $2
          WHERE id = $3
            AND distribution_election_due_on IS NULL
        `,
        [
          addDaysToDateStamp(todayStamp(), DISTRIBUTION_ELECTION_DEADLINE_DAYS),
          nowTimestamp(),
          deal.id
        ]
      );
    }

    if (!deal.distributionElectionNoticeSentAt) {
      await sendDistributionElectionRequestNotificationsForDeal(deal.id);
    }
  }
}

async function approveDefaultDistributionElection({
  snapshot,
  dealId,
  participantId,
  targetDeal,
  managerUser
}) {
  const distributionContext = resolveDistributionElectionContext(snapshot, dealId, participantId);
  const participant = distributionContext.participant;
  const deal = distributionContext.deal;
  const timestamp = nowTimestamp();
  const notes =
    "Auto-submitted to reinvest all exit proceeds because no election was submitted by the deadline.";
  const overrideNotes = `Auto-submitted after the election deadline for ${deal.name}.`;
  const approvedTargetPositionId = await withTransaction(async (client) => {
    const existingElection = await queryOne(
      `
        SELECT id, approval_status AS "approvalStatus"
        FROM distribution_elections
        WHERE deal_id = $1
          AND participant_id = $2
        FOR UPDATE
      `,
      [dealId, participantId],
      client
    );

    if (existingElection) {
      return null;
    }

    if (
      distributionContext.kind === "pooled" &&
      distributionContext.totalPayout > 0 &&
      participant?.category !== "investor"
    ) {
      const reinvestmentConflicts = getPoolMemberReinvestmentConflictIssues(
        snapshot,
        participantId,
        dealId
      );

      if (reinvestmentConflicts.length) {
        throw new Error(
          `This pooled member cannot roll proceeds into a direct investor position yet. ${reinvestmentConflicts.join(
            " "
          )}`
        );
      }

      await client.query(
        `
          UPDATE participants
          SET category = 'investor', updated_at = $1
          WHERE id = $2
        `,
        [timestamp, participantId]
      );
    }

    await client.query(
      `
        INSERT INTO distribution_elections (
          id,
          deal_id,
          participant_id,
          election_mode,
          reinvest_percent,
          reinvest_amount,
          rollover_target_deal_id,
          notes,
          submitted_by_user_id,
          submitted_by_role,
          approval_status,
          approved_reinvest_amount,
          approved_cash_payout_amount,
          payout_expected_on,
          reviewed_by_user_id,
          reviewed_at,
          manager_override,
          override_notes,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, 'reinvest_all', NULL, NULL, $4, $5, $6, 'manager',
          'approved', $7, 0, NULL, $8, $9, 0, $10, $11, $12
        )
      `,
      [
        createId("distribution"),
        dealId,
        participantId,
        targetDeal.id,
        notes,
        managerUser?.id ?? null,
        roundNumber(distributionContext.totalPayout),
        managerUser?.id ?? null,
        timestamp,
        overrideNotes,
        timestamp,
        timestamp
      ]
    );

    return applyApprovedReinvestmentAllocation({
      client,
      targetDealId: targetDeal.id,
      participantId,
      classType: distributionContext.classType,
      amount: distributionContext.totalPayout
    });
  });

  const linkedInvestorUser = (snapshot.users ?? []).find(
    (account) =>
      account.participantId === participantId &&
      account.role === "investor" &&
      account.isActive &&
      account.accountApprovalStatus === "approved"
  );
  let notifications = [];

  if (approvedTargetPositionId && linkedInvestorUser?.email) {
    try {
      notifications = [
        await sendDistributionElectionApprovedNotification({
          userId: linkedInvestorUser.id,
          participantId: linkedInvestorUser.participantId,
          fullName: linkedInvestorUser.name,
          email: linkedInvestorUser.email,
          dealName: deal.name,
          electionMode: "reinvest_all",
          approvedAt: timestamp,
          payoutExpectedOn: null,
          payoutMethod: participant?.payoutMethod ?? "",
          cashPayoutAmount: 0,
          reinvestAmount: distributionContext.totalPayout,
          rolloverTargetDealName: targetDeal.name,
          managerOverride: false,
          overrideNotes,
          notes
        })
      ];
    } catch (error) {
      notifications = [
        {
          status: "failed",
          provider: "notification_error",
          localPath: null,
          errorMessage: error.message,
          recipientEmail: linkedInvestorUser.email
        }
      ];
    }
  }

  return {
    dealId,
    participantId,
    targetDealId: targetDeal.id,
    reinvestAmount: distributionContext.totalPayout,
    approvedTargetPositionId,
    notifications
  };
}

async function applyOverdueDistributionElectionDefaults() {
  const snapshot = await getAppDataSnapshot({ skipAutomation: true });
  const overdueDeals = (snapshot.deals ?? []).filter(
    (deal) =>
      deal.status === "sold" &&
      deal.distributionElectionDueOn &&
      deal.distributionElectionDueOn < todayStamp()
  );

  if (!overdueDeals.length) {
    return [];
  }

  const managerUser = await getAutomationManagerUser();
  const results = [];

  for (const deal of overdueDeals) {
    const defaultTargetDeal = findDefaultReinvestmentTargetDeal(snapshot, deal.id);

    if (!defaultTargetDeal) {
      continue;
    }

    const missingRequirements = buildDistributionElectionRequirementContexts(
      snapshot,
      deal.id
    ).filter((requirement) => requirement.status === "missing");

    for (const requirement of missingRequirements) {
      try {
        results.push(
          await approveDefaultDistributionElection({
            snapshot,
            dealId: deal.id,
            participantId: requirement.participantId,
            targetDeal: defaultTargetDeal,
            managerUser
          })
        );
      } catch (error) {
        results.push({
          dealId: deal.id,
          participantId: requirement.participantId,
          errorMessage: error.message
        });
      }
    }
  }

  return results;
}

function getPoolMemberReinvestmentConflictIssues(snapshot, participantId, sourceDealId) {
  const poolMap = new Map((snapshot.investorPools ?? []).map((pool) => [pool.id, pool]));
  const dealMap = new Map((snapshot.deals ?? []).map((deal) => [deal.id, deal]));
  const commitments = (snapshot.investorPoolCommitments ?? []).filter(
    (commitment) => commitment.participantId === participantId
  );
  const issues = [];

  for (const commitment of commitments) {
    const investmentPool = poolMap.get(commitment.poolId);

    if (!investmentPool) {
      continue;
    }

    if (investmentPool.selectedDealId === sourceDealId) {
      continue;
    }

    if (!investmentPool.selectedDealId) {
      issues.push(`${investmentPool.name} is still raising capital or waiting on a vote.`);
      continue;
    }

    const linkedDeal = dealMap.get(investmentPool.selectedDealId);

    if (!linkedDeal || linkedDeal.status !== "sold") {
      issues.push(`${investmentPool.name} is still tied to an active pooled project.`);
      continue;
    }

    issues.push(
      `${investmentPool.name} still exists as a separate pooled distribution history on another sold project.`
    );
  }

  return issues;
}

function normalizeEarlyWithdrawalRequestInput(input) {
  return {
    investorNotes: normalizeOptionalText(input?.investorNotes ?? input?.notes)
  };
}

function normalizeEarlyWithdrawalReviewInput(input) {
  const decision = String(input?.decision ?? "")
    .trim()
    .toLowerCase();

  if (!["approve", "reject"].includes(decision)) {
    throw new Error("Manager decision must be approve or reject.");
  }

  return {
    decision,
    managerNotes: normalizeOptionalText(input?.managerNotes ?? input?.overrideNotes),
    payoutExpectedOn: normalizeOptionalDateInput(
      input?.payoutExpectedOn,
      "Expected payout date"
    )
  };
}

export async function upsertEarlyWithdrawalRequest(dealId, userId, input) {
  const normalizedDealId = String(dealId ?? "").trim();

  if (!normalizedDealId) {
    throw new Error("Deal id is required.");
  }

  const user = await getUserById(userId);

  if (!user) {
    throw new Error("User not found.");
  }

  if (user.role === "manager") {
    throw new Error("Managers cannot create investor early withdrawal requests.");
  }

  const snapshot = await getAppDataSnapshot();
  const deal = snapshot.deals.find((item) => item.id === normalizedDealId);

  if (!deal) {
    throw new Error("Deal not found.");
  }

  if (deal.status === "sold") {
    throw new Error("Early withdrawals are only available while the project is still active.");
  }

  const participant = snapshot.participants.find((item) => item.id === user.participantId);

  if (!["investor", "contractor"].includes(participant?.category ?? "")) {
    throw new Error("Only participant positions with portal access can request an early withdrawal.");
  }

  const position = snapshot.positions.find(
    (item) => item.dealId === normalizedDealId && item.participantId === user.participantId
  );

  if (!position || position.contributionAmount <= 0) {
    throw new Error("You do not have an active invested position in this project.");
  }

  if (!participantHasPayoutInstructions(participant)) {
    throw new Error(
      "Save your payout method or payout instructions in Profile & Payout Details before submitting a withdrawal request."
    );
  }

  const request = normalizeEarlyWithdrawalRequestInput(input);
  const existingRequest = await queryOne(
    `
      SELECT
        id,
        request_status AS "requestStatus"
      FROM early_withdrawal_requests
      WHERE deal_id = $1
        AND participant_id = $2
    `,
    [normalizedDealId, user.participantId]
  );

  if (existingRequest?.requestStatus === "approved") {
    throw new Error("This position already has an approved early withdrawal request.");
  }

  const timestamp = nowTimestamp();
  const { capitalAmount, penaltyRate, penaltyAmount, payoutAmount } = computeEarlyWithdrawalAmounts(
    position.contributionAmount,
    deal.earlyWithdrawalPenaltyRate
  );

  await withTransaction(async (client) => {
    if (existingRequest) {
      await client.query(
        `
          UPDATE early_withdrawal_requests
          SET
            position_id = $1,
            class_type = $2,
            requested_capital_amount = $3,
            penalty_rate = $4,
            penalty_amount = $5,
            approved_payout_amount = NULL,
            investor_notes = $6,
            manager_notes = NULL,
            request_status = 'pending',
            payout_expected_on = NULL,
            requested_by_user_id = $7,
            reviewed_by_user_id = NULL,
            reviewed_at = NULL,
            updated_at = $8
          WHERE id = $9
        `,
        [
          position.id,
          position.classType,
          capitalAmount,
          penaltyRate,
          penaltyAmount,
          request.investorNotes,
          user.id,
          timestamp,
          existingRequest.id
        ]
      );
    } else {
      await client.query(
        `
          INSERT INTO early_withdrawal_requests (
            id,
            deal_id,
            participant_id,
            position_id,
            class_type,
            requested_capital_amount,
            penalty_rate,
            penalty_amount,
            approved_payout_amount,
            investor_notes,
            manager_notes,
            request_status,
            payout_expected_on,
            requested_by_user_id,
            reviewed_by_user_id,
            reviewed_at,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, NULL, 'pending', NULL, $10, NULL, NULL, $11, $12
          )
        `,
        [
          createId("withdrawal"),
          normalizedDealId,
          user.participantId,
          position.id,
          position.classType,
          capitalAmount,
          penaltyRate,
          penaltyAmount,
          request.investorNotes,
          user.id,
          timestamp,
          timestamp
        ]
      );
    }
  });

  const managerRecipients = await getActiveManagerRecipients();
  const notifications = await Promise.all(
    managerRecipients.map(async (managerRecipient) => {
      try {
        return await sendEarlyWithdrawalRequestAlertNotification({
          userId: managerRecipient.userId,
          participantId: managerRecipient.participantId,
          managerName: managerRecipient.fullName,
          email: managerRecipient.email,
          investorName: participant?.name ?? "Investor",
          dealName: deal.name,
          requestedCapitalAmount: capitalAmount,
          penaltyRate,
          penaltyAmount,
          payoutAmount,
          payoutMethod: participant?.payoutMethod ?? "",
          notes: request.investorNotes,
          submittedAt: timestamp
        });
      } catch (error) {
        return {
          status: "failed",
          provider: "notification_error",
          localPath: null,
          errorMessage: error.message,
          recipientEmail: managerRecipient.email
        };
      }
    })
  );

  return {
    dealId: normalizedDealId,
    participantId: user.participantId,
    positionId: position.id,
    classType: position.classType,
    requestStatus: "pending",
    requestedCapitalAmount: capitalAmount,
    penaltyRate,
    penaltyAmount,
    estimatedPayoutAmount: payoutAmount,
    payoutExpectedOn: null,
    investorNotes: request.investorNotes,
    managerNotes: null,
    reviewedAt: null,
    notifications
  };
}

export async function reviewEarlyWithdrawalRequest(dealId, participantId, userId, input) {
  const normalizedDealId = String(dealId ?? "").trim();
  const normalizedParticipantId = String(participantId ?? "").trim();

  if (!normalizedDealId || !normalizedParticipantId) {
    throw new Error("Deal and participant ids are required.");
  }

  const user = await getUserById(userId);

  if (!user || user.role !== "manager") {
    throw new Error("Only managers can review early withdrawal requests.");
  }

  const review = normalizeEarlyWithdrawalReviewInput(input);
  const snapshot = await getAppDataSnapshot();
  const deal = snapshot.deals.find((item) => item.id === normalizedDealId);

  if (!deal) {
    throw new Error("Deal not found.");
  }

  const participant = snapshot.participants.find((item) => item.id === normalizedParticipantId);

  if (!["investor", "contractor"].includes(participant?.category ?? "")) {
    throw new Error("Only participant positions with portal access can be reviewed for early withdrawal.");
  }

  const existingRequest = await queryOne(
    `
      SELECT
        id,
        position_id AS "positionId",
        class_type AS "classType",
        requested_capital_amount AS "requestedCapitalAmount",
        penalty_rate AS "penaltyRate",
        penalty_amount AS "penaltyAmount",
        approved_payout_amount AS "approvedPayoutAmount",
        investor_notes AS "investorNotes",
        manager_notes AS "managerNotes",
        request_status AS "requestStatus",
        payout_expected_on AS "payoutExpectedOn",
        requested_by_user_id AS "requestedByUserId",
        reviewed_by_user_id AS "reviewedByUserId",
        reviewed_at AS "reviewedAt"
      FROM early_withdrawal_requests
      WHERE deal_id = $1
        AND participant_id = $2
    `,
    [normalizedDealId, normalizedParticipantId]
  );

  if (!existingRequest) {
    throw new Error("No early withdrawal request was found for this investor and project.");
  }

  if (existingRequest.requestStatus !== "pending") {
    throw new Error("This early withdrawal request has already been reviewed.");
  }

  const position = snapshot.positions.find(
    (item) => item.dealId === normalizedDealId && item.participantId === normalizedParticipantId
  );
  const requestedCapitalAmount = roundNumber(existingRequest.requestedCapitalAmount ?? 0);
  const penaltyRate = roundNumber(existingRequest.penaltyRate ?? deal.earlyWithdrawalPenaltyRate);
  const penaltyAmount = roundNumber(existingRequest.penaltyAmount ?? 0);
  const payoutAmount = roundNumber(
    Math.max(requestedCapitalAmount - penaltyAmount, 0)
  );

  if (review.decision === "approve") {
    if (!position || position.contributionAmount <= 0) {
      throw new Error("No active capital remains on this position to withdraw.");
    }

    if (!participantHasPayoutInstructions(participant)) {
      throw new Error(
        "The investor must save payout instructions before the request can be approved."
      );
    }

    if (!review.payoutExpectedOn) {
      throw new Error("Expected payout date is required when approving a withdrawal request.");
    }
  }

  const timestamp = nowTimestamp();

  await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE early_withdrawal_requests
        SET
          request_status = $1,
          approved_payout_amount = $2,
          manager_notes = $3,
          payout_expected_on = $4,
          reviewed_by_user_id = $5,
          reviewed_at = $6,
          updated_at = $7
        WHERE id = $8
      `,
      [
        review.decision === "approve" ? "approved" : "rejected",
        review.decision === "approve" ? payoutAmount : null,
        review.managerNotes,
        review.decision === "approve" ? review.payoutExpectedOn : null,
        user.id,
        timestamp,
        timestamp,
        existingRequest.id
      ]
    );

    if (review.decision === "approve" && position) {
      await client.query(
        `
          UPDATE positions
          SET contribution_amount = 0, updated_at = $1
          WHERE id = $2
        `,
        [timestamp, position.id]
      );

      await syncDealEquity(normalizedDealId, client);
    }
  });

  const linkedInvestorUser = snapshot.users.find(
    (account) => account.participantId === normalizedParticipantId && account.role === "investor"
  );
  let notifications = [];

  if (linkedInvestorUser?.email) {
    try {
      notifications = [
        review.decision === "approve"
          ? await sendEarlyWithdrawalApprovedNotification({
              userId: linkedInvestorUser.id,
              participantId: linkedInvestorUser.participantId,
              fullName: linkedInvestorUser.name,
              email: linkedInvestorUser.email,
              dealName: deal.name,
              approvedAt: timestamp,
              requestedCapitalAmount,
              penaltyRate,
              penaltyAmount,
              payoutAmount,
              payoutExpectedOn: review.payoutExpectedOn,
              payoutMethod: participant?.payoutMethod ?? "",
              investorNotes: existingRequest.investorNotes,
              managerNotes: review.managerNotes
            })
          : await sendEarlyWithdrawalRejectedNotification({
              userId: linkedInvestorUser.id,
              participantId: linkedInvestorUser.participantId,
              fullName: linkedInvestorUser.name,
              email: linkedInvestorUser.email,
              dealName: deal.name,
              reviewedAt: timestamp,
              requestedCapitalAmount,
              penaltyRate,
              payoutAmount,
              investorNotes: existingRequest.investorNotes,
              managerNotes: review.managerNotes
            })
      ];
    } catch (error) {
      notifications = [
        {
          status: "failed",
          provider: "notification_error",
          localPath: null,
          errorMessage: error.message,
          recipientEmail: linkedInvestorUser.email
        }
      ];
    }
  }

  return {
    dealId: normalizedDealId,
    participantId: normalizedParticipantId,
    positionId: existingRequest.positionId ?? position?.id ?? null,
    classType: existingRequest.classType ?? position?.classType ?? null,
    requestStatus: review.decision === "approve" ? "approved" : "rejected",
    requestedCapitalAmount,
    penaltyRate,
    penaltyAmount,
    approvedPayoutAmount: review.decision === "approve" ? payoutAmount : 0,
    payoutExpectedOn: review.decision === "approve" ? review.payoutExpectedOn : null,
    investorNotes: existingRequest.investorNotes ?? null,
    managerNotes: review.managerNotes,
    reviewedAt: timestamp,
    notifications
  };
}

export async function upsertDistributionElection(dealId, userId, input) {
  const normalizedDealId = String(dealId ?? "").trim();

  if (!normalizedDealId) {
    throw new Error("Deal id is required.");
  }

  const user = await getUserById(userId);

  if (!user) {
    throw new Error("User not found.");
  }

  const isManagerActing = user.role === "manager";
  const targetParticipantId = String(
    input?.participantId ?? user.participantId ?? ""
  ).trim();

  if (!targetParticipantId) {
    throw new Error("Participant id is required.");
  }

  if (!isManagerActing && targetParticipantId !== user.participantId) {
    throw new Error("You can only save elections for your own investor position.");
  }

  const election = normalizeDistributionElectionInput(input);
  const overrideNotes = normalizeOptionalText(input?.overrideNotes);
  const payoutExpectedOn = normalizeOptionalDateInput(
    input?.payoutExpectedOn,
    "Expected payout date"
  );
  const snapshot = await getAppDataSnapshot();
  const deal = snapshot.deals.find((item) => item.id === normalizedDealId);

  if (!deal) {
    throw new Error("Deal not found.");
  }

  if (deal.status !== "sold") {
    throw new Error("Reinvestment elections can only be saved after the project has sold.");
  }

  const distributionContext = resolveDistributionElectionContext(
    snapshot,
    normalizedDealId,
    targetParticipantId
  );
  const participant = distributionContext.participant;
  const position = distributionContext.position;

  const { totalPayout, reinvestAmount, cashPayoutAmount } = computeDistributionAmounts(
    election,
    distributionContext.totalPayout
  );
  const rolloverTargetDealId = reinvestAmount > 0 ? election.targetDealId : null;

  if (reinvestAmount > 0 && !rolloverTargetDealId) {
    throw new Error("Choose a target project for reinvestment.");
  }

  if (rolloverTargetDealId) {
    const rolloverTarget = snapshot.deals.find((item) => item.id === rolloverTargetDealId);

    if (!rolloverTarget) {
      throw new Error("Choose a valid target project for reinvestment.");
    }

    if (rolloverTarget.id === normalizedDealId) {
      throw new Error("Reinvestment target must be a different project.");
    }

    if (rolloverTarget.status === "sold") {
      throw new Error("Reinvestment target must still be an active project.");
    }
  }

  if (cashPayoutAmount > 0 && !participantHasPayoutInstructions(participant)) {
    throw new Error(
      "Save your payout method or payout instructions in Profile & Payout Details before requesting a cash payout."
    );
  }

  if (isManagerActing && cashPayoutAmount > 0 && !payoutExpectedOn) {
    throw new Error("Expected payout date is required when approving a cash payout.");
  }

  const existingElection = await queryOne(
    `
      SELECT
        id,
        election_mode AS "electionMode",
        reinvest_percent AS "reinvestPercent",
        reinvest_amount AS "reinvestAmount",
        rollover_target_deal_id AS "rolloverTargetDealId",
        notes,
        submitted_by_user_id AS "submittedByUserId",
        submitted_by_role AS "submittedByRole",
        approval_status AS "approvalStatus",
        approved_reinvest_amount AS "approvedReinvestAmount",
        approved_cash_payout_amount AS "approvedCashPayoutAmount",
        payout_expected_on AS "payoutExpectedOn",
        reviewed_by_user_id AS "reviewedByUserId",
        reviewed_at AS "reviewedAt",
        manager_override AS "managerOverride",
        override_notes AS "overrideNotes"
      FROM distribution_elections
      WHERE deal_id = $1
        AND participant_id = $2
    `,
    [normalizedDealId, targetParticipantId]
  );

  const timestamp = nowTimestamp();
  const hasInstructionChange =
    !existingElection ||
    existingElection.electionMode !== election.electionMode ||
    Number(existingElection.reinvestPercent ?? 0) !== Number(election.reinvestPercent ?? 0) ||
    Number(existingElection.reinvestAmount ?? 0) !==
      Number(election.electionMode === "split_amount" ? reinvestAmount : 0) ||
    String(existingElection.rolloverTargetDealId ?? "") !== String(rolloverTargetDealId ?? "") ||
    String(existingElection.notes ?? "") !== String(election.notes ?? "");
  const rolloverTargetDealName = rolloverTargetDealId
    ? snapshot.deals.find((item) => item.id === rolloverTargetDealId)?.name ?? null
    : null;

  if (!isManagerActing && existingElection?.approvalStatus === "approved") {
    throw new Error("This distribution election has already been approved and cannot be changed.");
  }

  let notifications = [];

  if (!isManagerActing) {
    await withTransaction(async (client) => {
      if (existingElection) {
        await client.query(
          `
            UPDATE distribution_elections
            SET
              election_mode = $1,
              reinvest_percent = $2,
              reinvest_amount = $3,
              rollover_target_deal_id = $4,
              notes = $5,
              submitted_by_user_id = $6,
              submitted_by_role = $7,
              approval_status = $8,
              approved_reinvest_amount = NULL,
              approved_cash_payout_amount = NULL,
              payout_expected_on = NULL,
              reviewed_by_user_id = NULL,
              reviewed_at = NULL,
              manager_override = 0,
              override_notes = NULL,
              updated_at = $9
            WHERE id = $10
          `,
          [
            election.electionMode,
            election.electionMode === "split_percentage" ? election.reinvestPercent : null,
            election.electionMode === "split_amount" ? reinvestAmount : null,
            rolloverTargetDealId,
            election.notes,
            user.id,
            "investor",
            "pending",
            timestamp,
            existingElection.id
          ]
        );
      } else {
        await client.query(
          `
            INSERT INTO distribution_elections (
              id,
              deal_id,
              participant_id,
              election_mode,
              reinvest_percent,
              reinvest_amount,
              rollover_target_deal_id,
              notes,
              submitted_by_user_id,
              submitted_by_role,
              approval_status,
              reviewed_by_user_id,
              reviewed_at,
              manager_override,
              override_notes,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, NULL, 0, NULL, $12, $13)
          `,
          [
            createId("distribution"),
            normalizedDealId,
            targetParticipantId,
            election.electionMode,
            election.electionMode === "split_percentage" ? election.reinvestPercent : null,
            election.electionMode === "split_amount" ? reinvestAmount : null,
            rolloverTargetDealId,
            election.notes,
            user.id,
            "investor",
            "pending",
            timestamp,
            timestamp
          ]
        );
      }
    });

    const managerRecipients = await getActiveManagerRecipients();
    notifications = await Promise.all(
      managerRecipients.map(async (managerRecipient) => {
        try {
          return await sendDistributionElectionAlertNotification({
            userId: managerRecipient.userId,
            participantId: managerRecipient.participantId,
            managerName: managerRecipient.fullName,
            email: managerRecipient.email,
            investorName: participant?.name ?? "Investor",
            dealName: deal.name,
            electionMode: election.electionMode,
            cashPayoutAmount,
            reinvestAmount,
            rolloverTargetDealName,
            notes: election.notes,
            submittedAt: timestamp
          });
        } catch (error) {
          return {
            status: "failed",
            provider: "notification_error",
            localPath: null,
            errorMessage: error.message,
            recipientEmail: managerRecipient.email
          };
        }
      })
    );

    return {
      dealId: normalizedDealId,
      participantId: targetParticipantId,
      electionMode: election.electionMode,
      totalPayout,
      reinvestAmount,
      cashPayoutAmount,
      rolloverTargetDealId,
      approvalStatus: "pending",
      managerOverride: false,
      reviewedAt: null,
      payoutExpectedOn: null,
      notifications
    };
  }

  if (existingElection?.approvalStatus === "approved") {
    throw new Error("This distribution election has already been approved and applied.");
  }

  const submittedByUserId = existingElection?.submittedByUserId ?? user.id;
  const submittedByRole = existingElection?.submittedByRole ?? "manager";
  const managerOverride = Boolean(
    existingElection?.id &&
      existingElection.submittedByRole === "investor" &&
      hasInstructionChange
  );
  const approvedTargetPositionId = await withTransaction(async (client) => {
    if (existingElection) {
      await client.query(
        `
          UPDATE distribution_elections
          SET
            election_mode = $1,
            reinvest_percent = $2,
            reinvest_amount = $3,
            rollover_target_deal_id = $4,
            notes = $5,
            submitted_by_user_id = $6,
            submitted_by_role = $7,
            approval_status = $8,
            approved_reinvest_amount = $9,
            approved_cash_payout_amount = $10,
            payout_expected_on = $11,
            reviewed_by_user_id = $12,
            reviewed_at = $13,
            manager_override = $14,
            override_notes = $15,
            updated_at = $16
          WHERE id = $17
        `,
        [
          election.electionMode,
          election.electionMode === "split_percentage" ? election.reinvestPercent : null,
          election.electionMode === "split_amount" ? reinvestAmount : null,
          rolloverTargetDealId,
          election.notes,
          submittedByUserId,
          submittedByRole,
          "approved",
          reinvestAmount > 0 ? reinvestAmount : 0,
          cashPayoutAmount > 0 ? cashPayoutAmount : 0,
          cashPayoutAmount > 0 ? payoutExpectedOn : null,
          user.id,
          timestamp,
          managerOverride ? 1 : 0,
          overrideNotes,
          timestamp,
          existingElection.id
        ]
      );
    } else {
      await client.query(
        `
          INSERT INTO distribution_elections (
            id,
            deal_id,
            participant_id,
            election_mode,
            reinvest_percent,
            reinvest_amount,
            rollover_target_deal_id,
            notes,
            submitted_by_user_id,
            submitted_by_role,
            approval_status,
            approved_reinvest_amount,
            approved_cash_payout_amount,
            payout_expected_on,
            reviewed_by_user_id,
            reviewed_at,
            manager_override,
            override_notes,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
          )
        `,
        [
          createId("distribution"),
          normalizedDealId,
          targetParticipantId,
          election.electionMode,
          election.electionMode === "split_percentage" ? election.reinvestPercent : null,
          election.electionMode === "split_amount" ? reinvestAmount : null,
          rolloverTargetDealId,
          election.notes,
          user.id,
          "manager",
          "approved",
          reinvestAmount > 0 ? reinvestAmount : 0,
          cashPayoutAmount > 0 ? cashPayoutAmount : 0,
          cashPayoutAmount > 0 ? payoutExpectedOn : null,
          user.id,
          timestamp,
          0,
          overrideNotes,
          timestamp,
          timestamp
        ]
      );
    }

    if (
      distributionContext.kind === "pooled" &&
      reinvestAmount > 0 &&
      rolloverTargetDealId &&
      participant?.category !== "investor"
    ) {
      const reinvestmentConflicts = getPoolMemberReinvestmentConflictIssues(
        snapshot,
        targetParticipantId,
        normalizedDealId
      );

      if (reinvestmentConflicts.length) {
        throw new Error(
          `This pooled member cannot roll proceeds into a direct investor position yet. ${reinvestmentConflicts.join(
            " "
          )}`
        );
      }

      await client.query(
        `
          UPDATE participants
          SET category = 'investor', updated_at = $1
          WHERE id = $2
        `,
        [timestamp, targetParticipantId]
      );
    }

    return applyApprovedReinvestmentAllocation({
      client,
      targetDealId: rolloverTargetDealId,
      participantId: targetParticipantId,
      classType: distributionContext.classType,
      amount: reinvestAmount
    });
  });

  const linkedInvestorUser = snapshot.users.find(
    (account) => account.participantId === targetParticipantId && account.role === "investor"
  );

  if (linkedInvestorUser?.email) {
    try {
      notifications = [
        await sendDistributionElectionApprovedNotification({
          userId: linkedInvestorUser.id,
          participantId: linkedInvestorUser.participantId,
          fullName: linkedInvestorUser.name,
          email: linkedInvestorUser.email,
          dealName: deal.name,
          electionMode: election.electionMode,
          approvedAt: timestamp,
          payoutExpectedOn: cashPayoutAmount > 0 ? payoutExpectedOn : null,
          payoutMethod: participant?.payoutMethod ?? "",
          cashPayoutAmount,
          reinvestAmount,
          rolloverTargetDealName,
          managerOverride,
          overrideNotes,
          notes: election.notes
        })
      ];
    } catch (error) {
      notifications = [
        {
          status: "failed",
          provider: "notification_error",
          localPath: null,
          errorMessage: error.message,
          recipientEmail: linkedInvestorUser.email
        }
      ];
    }
  }

  return {
    dealId: normalizedDealId,
    participantId: targetParticipantId,
    electionMode: election.electionMode,
    totalPayout,
    reinvestAmount,
    cashPayoutAmount,
    rolloverTargetDealId,
    approvedTargetPositionId,
    approvalStatus: "approved",
    managerOverride,
    reviewedAt: timestamp,
    payoutExpectedOn: cashPayoutAmount > 0 ? payoutExpectedOn : null,
    notifications
  };
}

export async function createDealIssue(input, createdByUserId) {
  const issue = normalizeIssueInput(input);
  const deal = await queryOne(
    `
      SELECT id, name, early_withdrawal_penalty_rate AS "earlyWithdrawalPenaltyRate"
      FROM deals
      WHERE id = $1
    `,
    [issue.dealId]
  );

  if (!deal) {
    throw new Error("Deal not found.");
  }

  if (
    issue.issueType === "penalty_rate_change" &&
    Number(deal.earlyWithdrawalPenaltyRate) === Number(issue.proposedPenaltyRate)
  ) {
    throw new Error("The proposed penalty rate matches the current project penalty rate.");
  }

  const recipients = await queryAll(
    `
      SELECT
        users.id AS "userId",
        users.participant_id AS "participantId",
        users.email AS email,
        participants.name AS "fullName",
        COALESCE(SUM(positions.contribution_amount), 0)::float AS "contributionAmount"
      FROM positions
      JOIN participants ON participants.id = positions.participant_id
      JOIN users ON users.participant_id = positions.participant_id
      WHERE positions.deal_id = $1
        AND participants.category IN ('investor', 'contractor')
        AND users.is_active = 1
      GROUP BY users.id, users.participant_id, users.email, participants.name
      HAVING COALESCE(SUM(positions.contribution_amount), 0) > 0
      ORDER BY participants.name
    `,
    [issue.dealId]
  );
  const totalRecipientContribution = recipients.reduce(
    (sum, recipient) => sum + Number(recipient.contributionAmount ?? 0),
    0
  );

  const timestamp = nowTimestamp();
  const issueId = createId("issue");

  await pool.query(
    `
      INSERT INTO deal_issues (
        id,
        deal_id,
        issue_type,
        title,
        description,
        approval_threshold,
        proposed_penalty_rate,
        closes_on,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      issueId,
      issue.dealId,
      issue.issueType,
      issue.title,
      issue.description,
      issue.approvalThreshold,
      issue.proposedPenaltyRate,
      issue.closesOn,
      createdByUserId,
      timestamp,
      timestamp
    ]
  );

  const notifications = await Promise.all(
    recipients.map(async (recipient) => {
      try {
        return await sendIssueCreatedNotification({
          userId: recipient.userId,
          participantId: recipient.participantId,
          fullName: recipient.fullName,
          email: recipient.email,
          dealName: deal.name,
          issueTitle: issue.title,
          issueDescription:
            issue.issueType === "penalty_rate_change"
              ? `${issue.description}\n\nProposed early withdrawal penalty rate: ${Math.round(
                  issue.proposedPenaltyRate * 1000
                ) / 10}%`
              : issue.description,
          approvalThreshold: issue.approvalThreshold,
          closesOn: issue.closesOn,
          weightPct:
            totalRecipientContribution > 0
              ? Number(recipient.contributionAmount ?? 0) / totalRecipientContribution
              : 0
        });
      } catch (error) {
        return {
          status: "failed",
          provider: "notification_error",
          localPath: null,
          errorMessage: error.message,
          recipientEmail: recipient.email
        };
      }
    })
  );

  return {
    issue: {
      id: issueId,
      dealId: issue.dealId,
      closesOn: issue.closesOn,
      title: issue.title,
      issueType: issue.issueType,
      proposedPenaltyRate: issue.proposedPenaltyRate
    },
    notifications
  };
}

export async function castDealIssueVote(issueId, userId, voteChoiceInput) {
  await applyClosedPenaltyRateIssueResolutions();

  const normalizedIssueId = String(issueId ?? "").trim();

  if (!normalizedIssueId) {
    throw new Error("Issue id is required.");
  }

  const voteChoice = normalizeVoteChoice(voteChoiceInput);
  const votingContext = await queryOne(
    `
      SELECT
        deal_issues.id AS id,
        deal_issues.deal_id AS "dealId",
        deal_issues.closes_on AS "closesOn",
        users.id AS "userId",
        users.participant_id AS "participantId",
        participants.category AS category,
        COALESCE(SUM(positions.contribution_amount), 0)::float AS "contributionAmount"
      FROM deal_issues
      JOIN users ON users.id = $2
      JOIN participants ON participants.id = users.participant_id
      LEFT JOIN positions
        ON positions.deal_id = deal_issues.deal_id
       AND positions.participant_id = users.participant_id
      WHERE deal_issues.id = $1
      GROUP BY deal_issues.id, deal_issues.deal_id, users.id, users.participant_id, participants.category
    `,
    [normalizedIssueId, userId]
  );

  if (!votingContext) {
    throw new Error("Issue not found.");
  }

  if (!["investor", "contractor"].includes(votingContext.category ?? "")) {
    throw new Error("Only investor or contractor participants can vote on major issues.");
  }

  if (Number(votingContext.contributionAmount) <= 0) {
    throw new Error("Only participants with capital in this deal can vote on this issue.");
  }

  if (votingContext.closesOn && todayStamp() > votingContext.closesOn) {
    throw new Error("Voting on this issue has already closed.");
  }

  const timestamp = nowTimestamp();

  await pool.query(
    `
      INSERT INTO deal_issue_votes (
        id,
        issue_id,
        participant_id,
        vote_choice,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (issue_id, participant_id)
      DO UPDATE SET
        vote_choice = EXCLUDED.vote_choice,
        updated_at = EXCLUDED.updated_at
    `,
    [
      createId("vote"),
      normalizedIssueId,
      votingContext.participantId,
      voteChoice,
      timestamp,
      timestamp
    ]
  );

  return {
    issueId: normalizedIssueId,
    participantId: votingContext.participantId,
    voteChoice
  };
}

export async function deleteDeal(dealId, actingUserId = null) {
  const id = String(dealId ?? "").trim();

  if (!id) {
    throw new Error("Deal id is required.");
  }

  const archive = await withTransaction(async (client) => {
    const existingDeal = await buildDealArchivePayload(id, client);

    if (!existingDeal) {
      throw new Error("Deal not found.");
    }

    if (existingDeal.deal?.status === "sold") {
      throw new Error("Sold projects cannot be deleted. Archive the sold project instead.");
    }

    const archiveRecord = await insertArchivedRecord(client, {
      entityType: "deal",
      entityId: id,
      sourceTable: "deals",
      displayName: existingDeal.deal?.name ?? id,
      relatedDealId: id,
      deletedByUserId: actingUserId,
      payload: existingDeal
    });

    await client.query(
      `
        DELETE FROM deals
        WHERE id = $1
      `,
      [id]
    );

    return archiveRecord;
  });

  return {
    ok: true,
    deletedDealId: id,
    archivedRecordId: archive.id
  };
}

export async function archiveDeal(dealId, actingUserId = null) {
  const id = String(dealId ?? "").trim();

  if (!id) {
    throw new Error("Deal id is required.");
  }

  await ensureDistributionElectionRequestsForSoldDeals();
  await applyOverdueDistributionElectionDefaults();

  const snapshot = await getAppDataSnapshot({ skipAutomation: true });
  const unresolvedElections = getUnresolvedDistributionElectionRequirements(snapshot, id);

  if (unresolvedElections.length) {
    const outstandingSummary = unresolvedElections
      .slice(0, 6)
      .map(
        (requirement) =>
          `${requirement.participantName} (${
            requirement.kind === "pooled" ? "pooled member" : "direct investor"
          }, ${requirement.status === "missing" ? "no election" : "pending approval"})`
      )
      .join(", ");
    const overflow = unresolvedElections.length > 6 ? ` and ${unresolvedElections.length - 6} more` : "";

    throw new Error(
      `This sold project cannot be archived until all direct and pooled investor distribution elections are submitted and approved. Outstanding: ${outstandingSummary}${overflow}.`
    );
  }

  const archive = await withTransaction(async (client) => {
    const existingDeal = await buildDealArchivePayload(id, client);

    if (!existingDeal) {
      throw new Error("Deal not found.");
    }

    if (existingDeal.deal?.status !== "sold") {
      throw new Error(
        "Only sold projects can be archived. Active projects can still be edited or deleted."
      );
    }

    const archiveRecord = await insertArchivedRecord(client, {
      entityType: "deal",
      entityId: id,
      sourceTable: "deals",
      displayName: existingDeal.deal?.name ?? id,
      relatedDealId: id,
      deletedByUserId: actingUserId,
      payload: existingDeal
    });
    const investorPools = existingDeal.investorPools ?? [];
    const poolArchiveRecords = [];

    for (const investorPool of investorPools) {
      const poolArchiveRecord = await insertArchivedRecord(client, {
        entityType: "investor_pool",
        entityId: investorPool.id,
        sourceTable: "investor_pools",
        displayName: investorPool.name ?? investorPool.pool_participant_name ?? investorPool.id,
        relatedDealId: id,
        relatedParticipantId: investorPool.pool_participant_id,
        deletedByUserId: actingUserId,
        payload: buildInvestorPoolArchivePayload(investorPool, existingDeal)
      });

      poolArchiveRecords.push(poolArchiveRecord);
    }

    if (investorPools.length) {
      await client.query(
        `
          DELETE FROM investor_pools
          WHERE id = ANY($1::text[])
        `,
        [investorPools.map((investorPool) => investorPool.id)]
      );
    }

    await client.query(
      `
        DELETE FROM deals
        WHERE id = $1
      `,
      [id]
    );

    return {
      archiveRecord,
      poolArchiveRecords
    };
  });

  return {
    ok: true,
    archivedDealId: id,
    archivedRecordId: archive.archiveRecord.id,
    archivedPoolIds: archive.poolArchiveRecords.map((archiveRecord) => archiveRecord.entityId),
    archivedPoolRecordIds: archive.poolArchiveRecords.map((archiveRecord) => archiveRecord.id)
  };
}

function getSettledPoolMemberCommitmentIssues(snapshot, participantId) {
  const poolMap = new Map((snapshot.investorPools ?? []).map((pool) => [pool.id, pool]));
  const dealMap = new Map((snapshot.deals ?? []).map((deal) => [deal.id, deal]));
  const commitments = (snapshot.investorPoolCommitments ?? []).filter(
    (commitment) => commitment.participantId === participantId
  );
  const issues = [];

  for (const commitment of commitments) {
    const investmentPool = poolMap.get(commitment.poolId);

    if (!investmentPool) {
      continue;
    }

    if (!investmentPool.selectedDealId) {
      issues.push(`${investmentPool.name} is still raising capital or waiting on a vote.`);
      continue;
    }

    const deal = dealMap.get(investmentPool.selectedDealId);

    if (!deal || deal.status !== "sold") {
      issues.push(`${investmentPool.name} is still tied to an active project.`);
      continue;
    }

    const poolPosition = (snapshot.positions ?? []).find(
      (position) =>
        position.dealId === investmentPool.selectedDealId &&
        position.participantId === investmentPool.poolParticipantId
    );

    if (!poolPosition) {
      issues.push(`${investmentPool.name} does not have a settled pooled position on file.`);
      continue;
    }

    const dealPositions = (snapshot.positions ?? []).filter(
      (position) => position.dealId === investmentPool.selectedDealId
    );
    const waterfall = calculateWaterfall({ deal, positions: dealPositions });
    const poolResult = waterfall.participantResults.find(
      (result) => result.positionId === poolPosition.id
    );
    const expectedTotalPayout = roundNumber(poolResult?.totalPayout ?? 0);
    const actualPayout = roundNumber(poolPosition.distributionsToDate ?? 0);

    if (actualPayout + 0.01 < expectedTotalPayout) {
      issues.push(
        `${investmentPool.name} has not been fully paid out yet (${actualPayout.toFixed(
          2
        )} of ${expectedTotalPayout.toFixed(2)} distributed).`
      );
    }
  }

  return issues;
}

async function assertUserIdentityReadyForApproval(targetUser) {
  const missing = [];

  if (!targetUser.contactPhone) {
    missing.push("contact");
  }

  if (!targetUser.driverLicenseNumber) {
    missing.push("driver's license number");
  }

  if (!targetUser.currentAddress) {
    missing.push("current address");
  }

  if (!targetUser.mailingAddress) {
    missing.push("mailing address");
  }

  if (!targetUser.idCardFileName) {
    missing.push("uploaded ID document");
  }

  if (!targetUser.idDocumentIssueDate) {
    missing.push("ID issue date");
  }

  if (!targetUser.idDocumentExpirationDate) {
    missing.push("ID expiration date");
  }

  if (missing.length) {
    throw new Error(`This account is missing ${missing.join(", ")}.`);
  }

  assertValidIdentityDocumentDates(
    targetUser.idDocumentIssueDate,
    targetUser.idDocumentExpirationDate
  );

  const requiredLegalDocuments = getRequiredLegalDocumentsForCategory(targetUser.category);
  const legalAcknowledgements = await getLegalAcknowledgementsForUser(targetUser.id);
  const signedDocuments = new Set(
    legalAcknowledgements.map(
      (acknowledgement) =>
        `${acknowledgement.documentKey}:${acknowledgement.documentVersion}`
    )
  );
  const missingLegalDocuments = requiredLegalDocuments.filter(
    (document) => !signedDocuments.has(`${document.key}:${document.version}`)
  );

  if (missingLegalDocuments.length) {
    throw new Error(
      `This account is missing signed legal documents: ${missingLegalDocuments
        .map((document) => document.title)
        .join(", ")}.`
    );
  }

  const legalAcknowledgementByDocumentKey = new Map(
    legalAcknowledgements.map((acknowledgement) => [acknowledgement.documentKey, acknowledgement])
  );
  const missingLegalDetails = [];

  for (const document of requiredLegalDocuments) {
    const acknowledgement = legalAcknowledgementByDocumentKey.get(document.key);

    if (!acknowledgement) {
      continue;
    }

    if (document.requiresInvestmentAmount && !(Number(acknowledgement.investmentAmount) > 0)) {
      missingLegalDetails.push(`${document.title} investment amount`);
    }

    if (document.requiresPaymentProof && !acknowledgement.proofOfPaymentFileName) {
      missingLegalDetails.push(`${document.title} proof of payment`);
    }

    if (document.requiresDeferredAmount && !(Number(acknowledgement.deferredAmount) > 0)) {
      missingLegalDetails.push(`${document.title} deferred amount`);
    }
  }

  if (missingLegalDetails.length) {
    throw new Error(`This account is missing ${missingLegalDetails.join(", ")}.`);
  }

  if (isInvestorQuestionnaireRequired(targetUser.category)) {
    const questionnaire = await getInvestorQuestionnaireForUser(targetUser.id);

    if (!questionnaire) {
      throw new Error("This account is missing the investor questionnaire.");
    }
  }
}

export async function reviewUserIdentity(userId, input, actingUserId) {
  const targetUser = await getUserAccountById(userId, { includeInactive: true });

  if (!targetUser) {
    throw new Error("User not found.");
  }

  if (targetUser.id === actingUserId) {
    throw new Error("You cannot review your own account.");
  }

  if (targetUser.role === "manager") {
    throw new Error("Manager accounts do not require identity review.");
  }

  if (targetUser.accountApprovalStatus !== "pending_review") {
    throw new Error("Only accounts waiting for identity review can be approved or rejected.");
  }

  const decision = String(input?.decision ?? "").trim();
  const isApproved = decision === "approved";
  const isRejected = decision === "rejected";

  if (!isApproved && !isRejected) {
    throw new Error("Review decision must be approved or rejected.");
  }

  const rejectionComment = normalizeOptionalText(input?.comment ?? input?.rejectionComment);

  if (isApproved) {
    await assertUserIdentityReadyForApproval(targetUser);
  } else if (!rejectionComment || rejectionComment.length < 3) {
    throw new Error("A rejection comment is required.");
  }

  const timestamp = nowTimestamp();
  await pool.query(
    `
      UPDATE users
      SET
        account_approval_status = $1,
        account_rejection_comment = $2,
        account_reviewed_by_user_id = $3,
        account_reviewed_at = $4,
        updated_at = $4
      WHERE id = $5
    `,
    [
      isApproved ? "approved" : "rejected",
      isApproved ? null : rejectionComment,
      actingUserId,
      timestamp,
      userId
    ]
  );

  const reviewedUser = await getUserAccountById(userId, { includeInactive: true });
  let notification;

  try {
    notification = isApproved
      ? await sendAccountApprovedNotification({
          userId: reviewedUser.id,
          participantId: reviewedUser.participantId,
          fullName: reviewedUser.name,
          email: reviewedUser.email
        })
      : await sendAccountRejectedNotification({
          userId: reviewedUser.id,
          participantId: reviewedUser.participantId,
          fullName: reviewedUser.name,
          email: reviewedUser.email,
          managerComment: rejectionComment
        });
  } catch (error) {
    notification = {
      status: "failed",
      provider: "notification_error",
      localPath: null,
      errorMessage: error.message
    };
  }

  return {
    user: reviewedUser,
    notification
  };
}

export async function updateUserCategory(userId, nextCategoryInput, actingUserId) {
  const targetUser = await getUserAccountById(userId, { includeInactive: true });

  if (!targetUser) {
    throw new Error("User not found.");
  }

  const nextCategory = normalizeCategory(nextCategoryInput);
  const currentCategory = normalizeCategory(targetUser.category);

  if (targetUser.id === actingUserId) {
    throw new Error("You cannot change your own category.");
  }

  if (!["investor", "pool_member"].includes(nextCategory)) {
    throw new Error("Only investor and pooled-member categories can be assigned here.");
  }

  if (!["investor", "pool_member"].includes(currentCategory)) {
    throw new Error(
      "Only investor and pooled-member accounts can be converted with this workflow."
    );
  }

  if (targetUser.role !== "investor") {
    throw new Error("Manager accounts cannot be reclassified with this workflow.");
  }

  if (currentCategory === nextCategory) {
    return targetUser;
  }

  const snapshot = await getAppDataSnapshot();

  if (currentCategory === "pool_member" && nextCategory === "investor") {
    const issues = getSettledPoolMemberCommitmentIssues(snapshot, targetUser.participantId);

    if (issues.length) {
      throw new Error(
        `This pooled member cannot become a direct investor yet. ${issues.join(" ")}`
      );
    }
  }

  if (currentCategory === "investor" && nextCategory === "pool_member") {
    const directPositions = (snapshot.positions ?? []).filter(
      (position) =>
        position.participantId === targetUser.participantId &&
        (Number(position.contributionAmount ?? 0) > 0 ||
          Number(position.distributionsToDate ?? 0) > 0)
    );

    if (directPositions.length) {
      throw new Error(
        "This investor already has direct project history. Keep the account in the investor category so the standard investor portfolio remains visible."
      );
    }
  }

  await pool.query(
    `
      UPDATE participants
      SET category = $1, updated_at = $2
      WHERE id = $3
    `,
    [nextCategory, nowTimestamp(), targetUser.participantId]
  );

  return getUserAccountById(userId, { includeInactive: true });
}

export async function setUserAccountActive(userId, isActive, actingUserId) {
  const targetUser = await getUserAccountById(userId, { includeInactive: true });

  if (!targetUser) {
    throw new Error("User not found.");
  }

  if (targetUser.id === actingUserId) {
    throw new Error("You cannot change the status of your own account.");
  }

  const nextActive = Boolean(isActive);

  if (!nextActive && targetUser.role === "manager") {
    const activeManagers = await countActiveManagers();

    if (targetUser.isActive && activeManagers <= 1) {
      throw new Error("At least one active manager account must remain.");
    }
  }

  await pool.query(
    `
      UPDATE users
      SET is_active = $1, updated_at = $2
      WHERE id = $3
    `,
    [nextActive ? 1 : 0, nowTimestamp(), userId]
  );

  return getUserAccountById(userId, { includeInactive: true });
}

export async function deleteUserAccount(userId, actingUserId) {
  const targetUser = await getUserAccountById(userId, { includeInactive: true });

  if (!targetUser) {
    throw new Error("User not found.");
  }

  if (targetUser.id === actingUserId) {
    throw new Error("You cannot delete your own account.");
  }

  if (targetUser.role === "manager" && targetUser.isActive) {
    const activeManagers = await countActiveManagers();

    if (activeManagers <= 1) {
      throw new Error("At least one active manager account must remain.");
    }
  }

  const archive = await withTransaction(async (client) => {
    const archivePayload = await buildUserArchivePayload(userId, client);

    if (!archivePayload) {
      throw new Error("User not found.");
    }

    const archiveRecord = await insertArchivedRecord(client, {
      entityType: "user",
      entityId: userId,
      sourceTable: "users",
      displayName: archivePayload.user?.participant_name ?? targetUser.name ?? targetUser.email,
      relatedParticipantId: archivePayload.user?.participant_id ?? targetUser.participantId ?? null,
      deletedByUserId: actingUserId,
      payload: archivePayload
    });

    await client.query(
      `
        DELETE FROM users
        WHERE id = $1
      `,
      [userId]
    );

    return archiveRecord;
  });

  return {
    ok: true,
    deletedUserId: userId,
    archivedRecordId: archive.id
  };
}
